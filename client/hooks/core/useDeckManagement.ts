/**
 * useDeckManagement - Хук для управления колодами игроков
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - changePlayerDeck - смена колоды игрока
 * - loadCustomDeck - загрузка пользовательской колоды
 * - resurrectDiscardedCard - воскресить карту из сброса на стол
 * - reorderTopDeck - изменить порядок верхних карт колоды
 * - reorderCards - изменить порядок карт в колоде/сбросе
 * - recoverDiscardedCard - вернуть карту из сброса в руку
 */

import { useCallback } from 'react'
import { logger } from '../../utils/logger'
import { deepCloneState } from '../../utils/common'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import { initializeReadyStatuses } from '../../utils/autoAbilities'
import { shuffleDeck } from '@shared/utils/array'
import { syncLastPlayed } from './gameStateStorage'
import { DeckType } from '../../types'
import type { GameState, Card, CustomDeckFile } from '../../types'

interface UseDeckManagementProps {
  webrtcIsHostRef: React.MutableRefObject<boolean>
  sendWebrtcAction?: ((actionType: string, actionData: any) => void) | null
  webrtcManagerRef?: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
  localPlayerIdRef?: React.MutableRefObject<number | null>
  getCardDefinition: (cardId: string) => any
  commandCardIds: Set<string>
  createDeck: (deckType: DeckType, playerId: number, playerName: string) => Card[]
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function useDeckManagement(props: UseDeckManagementProps) {
  const {
    webrtcIsHostRef,
    sendWebrtcAction,
    webrtcManagerRef,
    localPlayerIdRef,
    getCardDefinition,
    commandCardIds,
    createDeck,
    updateState,
  } = props

  /**
   * Change player's deck to a predefined deck type
   *
   * IMPORTANT: For dummy players, only the HOST should create and manage the deck.
   * Non-host clients should only send the deck change request and let the host create the deck.
   */
  const changePlayerDeck = useCallback((playerId: number, deckType: DeckType) => {
    const isWebRTCMode = getWebRTCEnabled()
    let playerIsDummy = false

    // First, read current state to check if player is dummy
    updateState(currentState => {
      const targetPlayer = currentState.players.find(p => p.id === playerId)
      if (!targetPlayer) {
        return currentState
      }
      playerIsDummy = targetPlayer.isDummy || false

      // For dummy players in WebRTC mode:
      // - Host: creates deck locally and broadcasts to guests
      // - Guest: only updates selectedDeck locally, sends request to host, and waits for deck data
      const isDummy = playerIsDummy
      const isHost = webrtcIsHostRef.current
      const shouldCreateDeckLocally = !isDummy || isHost // Host creates deck for dummy, guests create deck for themselves

      // Save deck preference for WebRTC guest join
      if (isWebRTCMode && !isHost) {
        try {
          localStorage.setItem('webrtc_preferred_deck', deckType)
          logger.info(`[changePlayerDeck] Guest saved deck preference: ${deckType}`)
        } catch (e) {
          logger.warn('[changePlayerDeck] Failed to save deck preference:', e)
        }
      }

      // Create the new deck (only for non-dummy or host)
      const newDeck = shouldCreateDeckLocally ? createDeck(deckType, playerId, targetPlayer.name) : []

      // Log what we're doing
      if (isDummy) {
        logger.info(`[changePlayerDeck] Dummy player deck change: playerId=${playerId}, deckType=${deckType}, isHost=${isHost}, willCreateDeck=${shouldCreateDeckLocally}`)
      }

      if (!isWebRTCMode) {
        // Non-WebRTC mode: create deck locally
        return {
          ...currentState,
          players: currentState.players.map(p =>
            p.id === playerId
              ? { ...p, deck: newDeck, selectedDeck: deckType, hand: [], discard: [], announcedCard: null, boardHistory: [] }
              : p,
          ),
        }
      }

      // WebRTC mode
      if (!isHost) {
        // Guest mode: only update selectedDeck locally for now, don't update deck yet
        // We'll receive the full deck data from host via CHANGE_PLAYER_DECK message
        return {
          ...currentState,
          players: currentState.players.map(p =>
            p.id === playerId
              ? { ...p, selectedDeck: deckType } // Only update selectedDeck, deck will come from host
              : p,
          ),
        }
      }

      // Host mode: create deck and broadcast
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: newDeck, selectedDeck: deckType, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })

    // In WebRTC mode, send deck data for synchronization
    logger.info(`[changePlayerDeck] Checking WebRTC mode: isWebRTCMode=${isWebRTCMode}, isHost=${webrtcIsHostRef.current}, hasSendAction=${!!sendWebrtcAction}, hasManager=${!!webrtcManagerRef?.current}`)

    if (!isWebRTCMode) {
      logger.info(`[changePlayerDeck] Not WebRTC mode, skipping sync`)
      return
    }

    const isHost = webrtcIsHostRef.current

    if (isHost) {
      // Host: create deck data and broadcast to all guests
      const newDeck = createDeck(deckType, playerId, 'Player ' + playerId)
      const compactDeckData = newDeck.map(card => ({
        id: card.id,
        baseId: card.baseId,
        power: card.power,
        powerModifier: card.powerModifier || 0,
        isFaceDown: card.isFaceDown || false,
        statuses: card.statuses || []
      }))

      // Debug: log compact deck data being sent
      if (deckType === 'Optimates') {
        const baseIdCounts: Record<string, number> = {}
        compactDeckData.forEach(card => {
          const baseId = card.baseId || card.id
          baseIdCounts[baseId] = (baseIdCounts[baseId] || 0) + 1
        })
        logger.info(`[changePlayerDeck] Host sending Optimates deck data:`, {
          totalCards: compactDeckData.length,
          baseIdCounts
        })
      }

      if (webrtcManagerRef?.current) {
        webrtcManagerRef.current.broadcastToGuests({
          type: 'CHANGE_PLAYER_DECK',
          senderId: webrtcManagerRef.current.getPeerId(),
          timestamp: Date.now(),
          data: {
            playerId,
            deckType,
            deck: compactDeckData,
            deckSize: compactDeckData.length
          }
        })
        logger.info(`[changePlayerDeck] Host broadcasting deck data to all guests: player ${playerId}, deck ${deckType}, ${compactDeckData.length} cards, isDummy=${playerIsDummy}`)
      } else {
        logger.warn(`[changePlayerDeck] Host mode but no webrtcManagerRef available`)
      }
    } else {
      // Guest: send only the request (deckType) to host
      // Host will create the deck and send back the full data
      if (sendWebrtcAction) {
        sendWebrtcAction('CHANGE_PLAYER_DECK', {
          playerId,
          deckType,
          // Don't send deck data - let host create it
          deck: undefined,
          deckSize: 0
        })
        logger.info(`[changePlayerDeck] Guest sending deck change request to host: player ${playerId}, deck ${deckType}, isDummy=${playerIsDummy}`)
      } else {
        logger.warn(`[changePlayerDeck] Guest mode but no sendWebrtcAction available`)
      }
    }
  }, [updateState, createDeck, sendWebrtcAction, webrtcIsHostRef, webrtcManagerRef, localPlayerIdRef])

  /**
   * Load a custom deck for a player
   */
  const loadCustomDeck = useCallback((playerId: number, deckFile: CustomDeckFile) => {
    const isWebRTCMode = getWebRTCEnabled()

    let newDeck: Card[] = []
    const cardInstanceCounter = new Map<string, number>()
    for (const { cardId, quantity } of deckFile.cards) {
      const cardDef = getCardDefinition(cardId)
      if (!cardDef) {
        continue
      }
      const isCommandCard = commandCardIds.has(cardId)
      const deckType = isCommandCard ? DeckType.Command : DeckType.Custom
      const prefix = isCommandCard ? 'CMD' : 'CUS'
      for (let i = 0; i < quantity; i++) {
        const instanceNum = (cardInstanceCounter.get(cardId) || 0) + 1
        cardInstanceCounter.set(cardId, instanceNum)
        newDeck.push({
          ...cardDef,
          id: `${prefix}_${cardId.toUpperCase()}_${instanceNum}`,
          baseId: cardId, // Ensure baseId is set for localization and display
          deck: deckType,
          ownerId: playerId,
          ownerName: 'Player ' + playerId,
        })
      }
    }

    // Shuffle the deck
    newDeck = shuffleDeck(newDeck)

    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: newDeck, selectedDeck: DeckType.Custom, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })

    // In WebRTC mode, send compact deck data for synchronization
    if (!isWebRTCMode) {
      return
    }

    // Create compact card data
    const compactDeckData = newDeck.map(card => ({
      id: card.id,
      baseId: card.baseId,
      power: card.power,
      powerModifier: card.powerModifier || 0,
      isFaceDown: card.isFaceDown || false,
      statuses: card.statuses || []
    }))

    if (webrtcIsHostRef.current) {
      // Host: broadcast directly to all guests
      if (webrtcManagerRef?.current) {
        webrtcManagerRef.current.broadcastToGuests({
          type: 'CHANGE_PLAYER_DECK',
          senderId: webrtcManagerRef.current.getPeerId(),
          timestamp: Date.now(),
          data: {
            playerId,
            deckType: DeckType.Custom,
            deck: compactDeckData,
            deckSize: compactDeckData.length
          }
        })
        logger.info(`[loadCustomDeck] Host broadcasting custom deck data: player ${playerId}, ${compactDeckData.length} cards`)
      }
    } else {
      // Guest: send to host
      if (sendWebrtcAction) {
        sendWebrtcAction('CHANGE_PLAYER_DECK', {
          playerId,
          deckType: DeckType.Custom,
          deck: compactDeckData,
          deckSize: compactDeckData.length
        })
        logger.info(`[loadCustomDeck] Guest sending custom deck data to host: player ${playerId}, ${compactDeckData.length} cards`)
      }
    }
  }, [updateState, getCardDefinition, commandCardIds, sendWebrtcAction, webrtcIsHostRef, webrtcManagerRef, localPlayerIdRef])

  /**
   * Resurrect a discarded card onto the board
   */
  const resurrectDiscardedCard = useCallback((playerId: number, cardIndex: number, boardCoords: {row: number, col: number}, statuses?: {type: string}[]) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      if (currentState.board[boardCoords.row][boardCoords.col].card !== null) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player && player.discard.length > cardIndex) {
        const [card] = player.discard.splice(cardIndex, 1)
        card.enteredThisTurn = true

        // Initialize ready statuses for the resurrected card
        // This allows abilities to be used when card returns from discard
        initializeReadyStatuses(card, playerId)

        // Lucius Bonus if resurrected
        if (card.baseId === 'luciusTheImmortal' || card.name.includes('Lucius')) {
          if (card.powerModifier === undefined) {
            card.powerModifier = 0
          }
          card.powerModifier += 2
        }

        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: 'Resurrected', addedByPlayerId: playerId })
        if (statuses) {
          statuses.forEach(s => {
            if (s.type !== 'Resurrected') {
              card.statuses?.push({ type: s.type, addedByPlayerId: playerId })
            }
          })
        }

        // Add to history
        // FIX: Ensure boardHistory exists before pushing
        if (!player.boardHistory) {
          player.boardHistory = []
        }
        player.boardHistory.push(card.id)

        newState.board[boardCoords.row][boardCoords.col].card = card

        syncLastPlayed(newState.board, player)

        newState.board = recalculateBoardStatuses(newState)
      }
      return newState
    })
  }, [updateState])

  /**
   * Reorder the top of the deck
   * Moves specified cards to the top in the specified order
   */
  const reorderTopDeck = useCallback((playerId: number, newTopOrder: Card[]) => {
    updateState(currentState => {
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)

      if (player && newTopOrder.length > 0) {
        // 1. Identify which cards are being reordered (by ID)
        const topIds = new Set(newTopOrder.map(c => c.id))

        // 2. Separate deck into [Cards to be moved] and [Rest of deck]
        // Filter out the cards that are in the new top order from the current deck
        const remainingDeck = player.deck.filter(c => !topIds.has(c.id))

        // 3. Prepend the new top order
        // This effectively moves the selected cards to the top in the specified order
        // and keeps the rest of the deck in its original relative order.
        player.deck = [...newTopOrder, ...remainingDeck]
      }

      return newState
    })
  }, [updateState])

  /**
   * Reorder cards in a player's deck or discard pile
   *
   * This is a low-level API that should only be used from orchestrating components.
   * Use this when you need to change the order of cards in a deck or discard pile.
   *
   * @param playerId - The ID of the player whose cards are being reordered
   * @param newCards - The new ordered array of cards
   * @param source - Either 'deck' or 'discard' indicating which pile to reorder
   */
  const reorderCards = useCallback((playerId: number, newCards: Card[], source: 'deck' | 'discard') => {
    updateState(currentState => {
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)

      if (player) {
        if (source === 'deck') {
          player.deck = newCards
        } else if (source === 'discard') {
          player.discard = newCards
        }
      }

      return newState
    })
  }, [updateState])

  /**
   * Recover a discarded card back to hand
   */
  const recoverDiscardedCard = useCallback((playerId: number, cardIndex: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player && player.discard.length > cardIndex) {
        const [card] = player.discard.splice(cardIndex, 1)
        player.hand.push(card)
      }
      return newState
    })
  }, [updateState])

  return {
    changePlayerDeck,
    loadCustomDeck,
    resurrectDiscardedCard,
    reorderTopDeck,
    reorderCards,
    recoverDiscardedCard,
  }
}
