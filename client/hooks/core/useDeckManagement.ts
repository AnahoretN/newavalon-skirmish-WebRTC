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
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import { initializeReadyStatuses, removeAllReadyStatuses } from '../../utils/autoAbilities'
import { shuffleDeck } from '@shared/utils/array'
import { syncLastPlayed } from './gameStateStorage'
import { DeckType } from '../../types'
import type { GameState, Card, CustomDeckFile } from '../../types'

interface UseDeckManagementProps {
  webrtcIsHostRef: React.MutableRefObject<boolean>
  sendWebrtcAction?: ((actionType: string, actionData: any) => void) | null
  getCardDefinition: (cardId: string) => any
  commandCardIds: Set<string>
  createDeck: (deckType: DeckType, playerId: number, playerName: string) => Card[]
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function useDeckManagement(props: UseDeckManagementProps) {
  const {
    webrtcIsHostRef,
    sendWebrtcAction,
    getCardDefinition,
    commandCardIds,
    createDeck,
    updateState,
  } = props

  /**
   * Change player's deck to a predefined deck type
   */
  const changePlayerDeck = useCallback((playerId: number, deckType: DeckType) => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: createDeck(deckType, playerId, p.name), selectedDeck: deckType, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })

    // In WebRTC mode, also send deck change to host for broadcasting
    if (isWebRTCMode && !webrtcIsHostRef.current && sendWebrtcAction) {
      sendWebrtcAction('CHANGE_PLAYER_DECK', { playerId, deckType })
      logger.info(`[changePlayerDeck] Sent deck change to host: player ${playerId}, deck ${deckType}`)
    }
  }, [updateState, createDeck, sendWebrtcAction, webrtcIsHostRef])

  /**
   * Load a custom deck for a player
   */
  const loadCustomDeck = useCallback((playerId: number, deckFile: CustomDeckFile) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player) {
        return currentState
      }
      const newDeck: Card[] = []
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
            ownerName: player.name,
          })
        }
      }
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: shuffleDeck(newDeck), selectedDeck: DeckType.Custom, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })
  }, [updateState, getCardDefinition, commandCardIds])

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
