/**
 * Host Message Handler
 * Processes incoming messages from guests and manages game state
 *
 * NOTE: This class is NOT currently used. All message handling is done in HostManager.
 * This code is kept for reference but should be integrated into HostManager if needed.
 */

import type { GameState, Player, DeckType } from '../types'
import type { StateDelta } from '../types'
import type { WebrtcMessage } from '../utils/webrtcManager'
import type { HostConnectionManager } from './HostConnectionManager'
// import type { HostStateManager } from './HostStateManager' // Not used, functionality in HostManager
import { logger } from '../utils/logger'
import { createDeltaFromStates, isDeltaEmpty, applyStateDelta } from '../utils/stateDelta'
import { PLAYER_COLOR_NAMES } from '../constants'

export interface HostMessageHandlerConfig {
  onStateUpdate?: (newState: GameState) => void
  onPlayerJoin?: (playerId: number, peerId: string) => void
  onPlayerLeave?: (playerId: number, peerId: string) => void
}

export class HostMessageHandler {
  private connectionManager: HostConnectionManager
  // private stateManager: HostStateManager // Not used, functionality in HostManager
  private gameState: GameState | null = null
  private localPlayerId: number | null = null
  private config: HostMessageHandlerConfig

  constructor(
    connectionManager: HostConnectionManager,
    // stateManager: HostStateManager, // Not used, functionality in HostManager
    config: HostMessageHandlerConfig = {}
  ) {
    this.connectionManager = connectionManager
    // this.stateManager = stateManager
    this.config = config

    // Subscribe to connection manager events
    connectionManager.on((event) => {
      if (event.type === 'message_received') {
        this.handleMessage(event.data.message, event.data.fromPeerId)
      }
    })
  }

  /**
   * Set the current game state
   */
  setGameState(state: GameState): void {
    this.gameState = state
  }

  /**
   * Set the local player ID
   */
  setLocalPlayerId(playerId: number): void {
    this.localPlayerId = playerId
  }

  /**
   * Get the current game state
   */
  getGameState(): GameState | null {
    return this.gameState
  }

  /**
   * Handle incoming message from guest
   */
  private handleMessage(message: WebrtcMessage, fromPeerId: string): void {
    if (!message || !message.type) {return}

    logger.info(`[HostMessageHandler] Received ${message.type} from ${fromPeerId}`)

    switch (message.type) {
      case 'JOIN_REQUEST':
        this.handleJoinRequest(fromPeerId, message.data)
        break

      case 'ACTION':
        this.handleAction(message, fromPeerId)
        break

      case 'PLAYER_READY':
        this.handlePlayerReady(message, fromPeerId)
        break

      case 'CHANGE_PLAYER_DECK':
        this.handleChangePlayerDeck(message, fromPeerId)
        break

      case 'UPDATE_PLAYER_NAME':
        this.handleUpdatePlayerName(message, fromPeerId)
        break

      case 'CHANGE_PLAYER_COLOR':
        this.handleChangePlayerColor(message, fromPeerId)
        break

      case 'UPDATE_PLAYER_SCORE':
        this.handleUpdatePlayerScore(message, fromPeerId)
        break

      case 'STATE_DELTA':
        this.handleStateDelta(message, fromPeerId)
        break

      case 'STATE_DELTA_BINARY':
        this.handleStateDeltaBinary(message, fromPeerId)
        break

      default:
        logger.warn(`[HostMessageHandler] Unhandled message type: ${message.type}`)
        break
    }
  }

  /**
   * Handle guest join request
   */
  private handleJoinRequest(guestPeerId: string, joinData?: any): void {
    if (!this.gameState) {
      logger.error('[HostMessageHandler] No game state, cannot accept guest')
      return
    }

    // Get guest's preferred deck from join request
    const preferredDeck = joinData?.preferredDeck || 'Random'
    logger.info(`[HostMessageHandler] Processing JOIN_REQUEST from ${guestPeerId}, preferredDeck: ${preferredDeck}`)

    // Find next available player ID
    const existingPlayerIds = this.gameState.players.map(p => p.id)
    let newPlayerId = 1
    while (existingPlayerIds.includes(newPlayerId)) {
      newPlayerId++
    }

    // Create new player with their preferred deck
    const newPlayer: Player = {
      id: newPlayerId,
      name: `Player ${newPlayerId}`,
      color: PLAYER_COLOR_NAMES[(newPlayerId - 1) % PLAYER_COLOR_NAMES.length],
      hand: [],
      deck: [],
      discard: [],
      announcedCard: null,
      score: 0,
      isDummy: false,
      isReady: false,
      selectedDeck: preferredDeck as DeckType,
      boardHistory: [],
      autoDrawEnabled: true,
    }

    // Add new player to state
    const newState = {
      ...this.gameState,
      players: [...this.gameState.players, newPlayer]
    }

    this.gameState = newState
    this.connectionManager.setGuestPlayerId(guestPeerId, newPlayerId)

    // Accept guest with minimal info
    this.connectionManager.acceptGuestMinimal(
      guestPeerId,
      {
        playerId: newPlayerId,
        gameId: this.gameState.gameId,
        isGameStarted: this.gameState.isGameStarted,
        players: newState.players.map(p => ({
          id: p.id,
          name: p.name,
          color: p.color,
          isDummy: p.isDummy,
          isReady: p.isReady,
          score: p.score,
          selectedDeck: p.selectedDeck,
          deckSize: p.deck.length,
          handSize: p.hand.length,
          discardSize: p.discard.length,
        })),
        deckSelections: newState.players.map(p => ({ id: p.id, selectedDeck: p.selectedDeck })),
        gameMode: this.gameState.gameMode,
        currentRound: this.gameState.currentRound,
        currentPhase: this.gameState.currentPhase,
        activePlayerId: this.gameState.activePlayerId,
        startingPlayerId: this.gameState.startingPlayerId,
        activeGridSize: this.gameState.activeGridSize,
      },
      newPlayerId
    )

    // Notify callback
    if (this.config.onPlayerJoin) {
      this.config.onPlayerJoin(newPlayerId, guestPeerId)
    }

    logger.info(`[HostMessageHandler] Added player ${newPlayerId} for guest ${guestPeerId}`)
  }

  /**
   * Handle action from guest
   */
  private handleAction(message: WebrtcMessage, fromPeerId: string): void {
    if (!message.data) {return}

    const { actionType, actionData } = message.data
    logger.info(`[HostMessageHandler] Received action: ${actionType}`)

    // Get the guest's player ID
    const guest = this.connectionManager.getGuest(fromPeerId)
    const guestPlayerId = guest?.playerId

    if (!guestPlayerId) {
      logger.warn(`[HostMessageHandler] No player ID for guest ${fromPeerId}`)
      return
    }

    // Handle different action types
    switch (actionType) {
      case 'STATE_UPDATE':
      case 'STATE_UPDATE_COMPACT': // Handle compact state updates from guests
        this.handleStateUpdateAction(actionData, guestPlayerId)
        break

      case 'STATE_DELTA':
        this.handleStateDeltaAction(actionData, guestPlayerId)
        break

      default:
        logger.warn(`[HostMessageHandler] Unhandled action type: ${actionType}`)
        break
    }
  }

  /**
   * Handle state update action from guest
   */
  private handleStateUpdateAction(actionData: any, guestPlayerId: number): void {
    if (!actionData?.gameState || !this.gameState) {return}

    const guestState = actionData.gameState

    // Import card database for reconstruction
    const { getCardDefinition } = require('@/contentDatabase')

    // Merge players: preserve deck/discard AND score from host state for players that aren't the guest
    // This prevents guest's stale data from overwriting other players' scores
    const mergedPlayers = guestState.players.map((guestPlayer: Player) => {
      const hostPlayer = this.gameState!.players.find(p => p.id === guestPlayer.id)

      if (guestPlayer.id === guestPlayerId) {
        // This is the guest who sent the update - preserve their score
        logger.info(`[handleStateUpdateAction] Guest ${guestPlayerId} score: ${guestPlayer.score}, host score: ${hostPlayer?.score}`)

        if ((guestPlayer as any).handCards && hostPlayer) {
          // CRITICAL FIX: Reconstruct hand from handCards for the guest player
          // Guest sends handCards (compact format with id, baseId, power, statuses)
          // Host needs to reconstruct full hand from card database
          const handCards = (guestPlayer as any).handCards
          const reconstructedHand = handCards.map((hc: any) => {
            const cardDef = getCardDefinition(hc.baseId)
            if (!cardDef) {
              return { id: hc.id, baseId: hc.baseId, name: 'Unknown', power: hc.power || 0, ability: '', types: [] }
            }
            return {
              ...cardDef,
              id: hc.id,
              power: hc.power,
              powerModifier: hc.powerModifier || 0,
              isFaceDown: hc.isFaceDown,
              statuses: hc.statuses || []
            }
          })

          // CRITICAL: Preserve deck/discard from host (for card privacy), but take score from guest
          const merged = {
            ...guestPlayer,
            hand: reconstructedHand,
            handCards: undefined, // Remove temporary handCards
            deck: hostPlayer.deck,
            discard: hostPlayer.discard,
          }
          logger.info(`[handleStateUpdateAction] Guest ${guestPlayerId} merged score: ${merged.score}`)
          return merged
        }

        // Guest sent update without handCards (e.g., score change only)
        // Preserve guest's score, use host's deck/discard
        const merged = {
          ...guestPlayer,
          deck: hostPlayer?.deck,
          discard: hostPlayer?.discard,
        }
        logger.info(`[handleStateUpdateAction] Guest ${guestPlayerId} (no handCards) merged score: ${merged.score}`)
        return merged
      }

      if (hostPlayer && guestPlayer.id !== guestPlayerId) {
        // This is another player (not guest) - check if guest sent handCards for them
        // This happens when guest places Revealed tokens on other players' cards
        if ((guestPlayer as any).handCards && hostPlayer.hand) {
          // Apply status updates from guest's handCards to host's hand
          const guestHandCards = (guestPlayer as any).handCards
          const updatedHand = hostPlayer.hand.map(hostCard => {
            // Find matching card in guest's handCards by id
            const guestCard = guestHandCards.find((gc: any) => gc.id === hostCard.id)
            if (guestCard && guestCard.statuses) {
              // Apply the statuses from guest's version
              return {
                ...hostCard,
                statuses: guestCard.statuses,
                isFaceDown: guestCard.isFaceDown, // Also update face-down status (revealed cards)
              }
            }
            return hostCard
          })

          return {
            ...hostPlayer,
            hand: updatedHand,
            deck: hostPlayer.deck || guestPlayer.deck,
            discard: hostPlayer.discard || guestPlayer.discard,
            score: hostPlayer.score,  // For other players, preserve host's score
            color: hostPlayer.color,  // CRITICAL: Preserve host's player color data
            handSize: updatedHand.length,
            deckSize: hostPlayer.deckSize ?? guestPlayer.deckSize,
            discardSize: hostPlayer.discardSize ?? guestPlayer.discardSize,
          }
        }

        // No handCards from guest - preserve host's data for this player
        return {
          ...guestPlayer,
          deck: hostPlayer.deck || guestPlayer.deck,
          discard: hostPlayer.discard || guestPlayer.discard,
          // CRITICAL: For non-guest players, use host's score (guest has stale data)
          // For the guest player themselves (handled below), preserve their score
          score: hostPlayer.score,
          color: hostPlayer.color,  // CRITICAL: Preserve host's player color data
          handSize: hostPlayer.handSize ?? guestPlayer.handSize,
          deckSize: hostPlayer.deckSize ?? guestPlayer.deckSize,
          discardSize: hostPlayer.discardSize ?? guestPlayer.discardSize,
        }
      }

      return guestPlayer
    })

    const mergedState = {
      ...guestState,
      players: mergedPlayers,
    }

    this.gameState = mergedState

    // Broadcast to all guests (including sender for consistency)
    this.connectionManager.broadcastGameState(mergedState)

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(mergedState)
    }
  }

  /**
   * Handle state delta action from guest
   */
  private handleStateDeltaAction(actionData: any, guestPlayerId: number): void {
    if (!actionData?.delta || !this.gameState) {return}

    const delta: StateDelta = actionData.delta

    // Apply delta to host state - IMPORTANT!
    // Host must apply the delta to its own gameState before broadcasting
    const newState = applyStateDelta(this.gameState, delta, guestPlayerId)

    this.gameState = newState

    // Broadcast to all guests (excluding sender if needed)
    logger.info(`[HostMessageHandler] Received STATE_DELTA from player ${guestPlayerId}, broadcasting to all`)
    this.connectionManager.broadcastStateDelta(delta)

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(newState)
    }
  }

  /**
   * Handle binary state delta action from guest (optimized format)
   */
  private handleStateDeltaBinary(message: WebrtcMessage, fromPeerId: string): void {
    const guest = this.connectionManager.getGuest(fromPeerId)
    const guestPlayerId = guest?.playerId

    if (!guestPlayerId) {
      logger.warn(`[HostMessageHandler] No player ID for STATE_DELTA_BINARY from ${fromPeerId}`)
      return
    }

    if (!message.data || !this.gameState) {return}

    // Deserialize delta from binary format
    try {
      const { deserializeDelta } = require('../utils/webrtcSerialization')
      const delta = deserializeDelta(message.data)

      logger.info(`[HostMessageHandler] Received STATE_DELTA_BINARY from player ${guestPlayerId}, boardCells=${delta.boardCells?.length || 0}`)

      // Apply delta using the same logic as STATE_DELTA
      const newState = applyStateDelta(this.gameState, delta, guestPlayerId)
      this.gameState = newState

      // Broadcast to all guests (excluding sender)
      this.connectionManager.broadcastStateDelta(delta)

      // Notify callback
      if (this.config.onStateUpdate) {
        this.config.onStateUpdate(newState)
      }
    } catch (error) {
      logger.error(`[HostMessageHandler] Failed to deserialize STATE_DELTA_BINARY:`, error)
    }
  }

  /**
   * Handle player ready
   */
  private handlePlayerReady(message: WebrtcMessage, fromPeerId: string): void {
    if (!this.gameState) {return}

    const guest = this.connectionManager.getGuest(fromPeerId)
    const playerId = guest?.playerId || message.playerId

    if (!playerId) {
      logger.warn(`[HostMessageHandler] No player ID for PLAYER_READY from ${fromPeerId}`)
      return
    }

    // Update player ready status
    const updatedPlayers = this.gameState.players.map(p =>
      p.id === playerId ? { ...p, isReady: true } : p
    )

    this.gameState = {
      ...this.gameState,
      players: updatedPlayers
    }

    // Broadcast ready status to other guests
    this.connectionManager.broadcast({
      type: 'PLAYER_READY',
      senderId: this.connectionManager.getPeerId(),
      playerId: playerId,
      data: { isReady: true },
      timestamp: Date.now()
    })

    // Check if all real players are ready
    const realPlayers = updatedPlayers.filter(p => !p.isDummy && !p.isDisconnected)
    const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady)

    if (allReady && !this.gameState.isGameStarted) {
      this.startGame()
    }

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.gameState)
    }
  }

  /**
   * Start the game
   */
  private startGame(): void {
    if (!this.gameState || !this.localPlayerId) {return}

    logger.info('[HostMessageHandler] All players ready! Starting game...')

    const allPlayers = this.gameState.players.filter(p => !p.isDisconnected)
    const randomIndex = Math.floor(Math.random() * allPlayers.length)
    const startingPlayerId = allPlayers[randomIndex].id

    // Draw initial hands for HOST and DUMMY players only
    // Guests will draw their own cards from their local decks when they receive GAME_START
    const finalState = { ...this.gameState }
    finalState.isReadyCheckActive = false
    finalState.isGameStarted = true
    finalState.startingPlayerId = startingPlayerId
    finalState.activePlayerId = startingPlayerId
    finalState.currentPhase = 0

    // Draw cards for host and dummy players only
    // Guests manage their own decks locally
    finalState.players = finalState.players.map(player => {
      // Only draw for host (local player) and dummies
      // Guests have their own local deck data
      const isHostOrDummy = player.id === this.localPlayerId || player.isDummy

      if (isHostOrDummy && player.hand.length === 0 && player.deck.length > 0) {
        const cardsToDraw = 6
        const newHand = [...player.hand]
        const newDeck = [...player.deck]

        for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
          const drawnCard = newDeck[0]
          newDeck.splice(0, 1)
          newHand.push(drawnCard)
        }

        logger.info(`[HostMessageHandler] Drew ${newHand.length} cards for player ${player.id}`)
        return { ...player, hand: newHand, deck: newDeck }
      }
      return player
    })

    // Use createDeltaFromStates to automatically detect all changes
    const initialDrawDelta = createDeltaFromStates(this.gameState, finalState, this.localPlayerId)
    logger.info(`[HostMessageHandler] Created delta with ${Object.keys(initialDrawDelta.playerDeltas || {}).length} player changes`)

    // Broadcast game start notification first
    this.connectionManager.broadcast({
      type: 'GAME_START',
      senderId: this.connectionManager.getPeerId(),
      data: {
        startingPlayerId,
        activePlayerId: startingPlayerId,
        isGameStarted: true,
        isReadyCheckActive: false
      },
      timestamp: Date.now()
    })

    // Then broadcast the delta
    setTimeout(() => {
      if (!isDeltaEmpty(initialDrawDelta)) {
        this.connectionManager.broadcastStateDelta(initialDrawDelta)
        logger.info('[HostMessageHandler] Broadcasted initial draw delta to guests')
      }
    }, 50)

    this.gameState = finalState

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(finalState)
    }
  }

  /**
   * Handle player deck change
   *
   * IMPORTANT RULE: Host is the single source of truth for dummy player decks.
   * - For dummy players: Host ALWAYS creates the deck, regardless of what guest sends
   * - For real players: Host uses the deck data provided by guest
   */
  private handleChangePlayerDeck(message: WebrtcMessage, _fromPeerId: string): void {
    if (!this.gameState || !message.data) {return}

    const { playerId, deckType, deck: receivedDeck } = message.data
    const targetPlayer = this.gameState.players.find(p => p.id === playerId)
    if (!targetPlayer) {
      logger.warn(`[handleChangePlayerDeck] Player ${playerId} not found`)
      return
    }

    const isDummy = targetPlayer.isDummy || false
    let finalDeck: any[] = []
    let compactDeckForBroadcast: any[] = []

    // For dummy players, ALWAYS create deck on host (ignore guest's deck data)
    // For real players, use deck data from guest if provided
    if (isDummy || !receivedDeck || !Array.isArray(receivedDeck) || receivedDeck.length === 0) {
      // Create deck locally on host
      const { createDeck } = require('../../hooks/core/gameCreators')
      finalDeck = createDeck(deckType, playerId, targetPlayer.name)

      // Create compact version for broadcast
      compactDeckForBroadcast = finalDeck.map(card => ({
        id: card.id,
        baseId: card.baseId,
        power: card.power,
        powerModifier: card.powerModifier || 0,
        isFaceDown: card.isFaceDown || false,
        statuses: card.statuses || []
      }))

      logger.info(`[handleChangePlayerDeck] Host created deck for ${isDummy ? 'dummy' : 'real'} player ${playerId}: ${deckType}, ${finalDeck.length} cards`)
    } else {
      // Use deck data from guest (real player with custom deck data)
      const { getCardDefinition } = require('../../contentDatabase')

      const reconstructedDeck = receivedDeck.map((compactCard: any) => {
        if (compactCard.baseId) {
          const cardDef = getCardDefinition(compactCard.baseId)
          if (cardDef) {
            return {
              ...cardDef,
              id: compactCard.id,
              baseId: compactCard.baseId,
              deck: deckType,
              ownerId: playerId,
              ownerName: targetPlayer.name,
              power: compactCard.power,
              powerModifier: compactCard.powerModifier || 0,
              isFaceDown: compactCard.isFaceDown || false,
              statuses: compactCard.statuses || []
            }
          }
          return {
            id: compactCard.id,
            baseId: compactCard.baseId,
            name: 'Unknown',
            deck: deckType,
            ownerId: playerId,
            ownerName: targetPlayer.name,
            power: compactCard.power || 0,
            powerModifier: 0,
            isFaceDown: false,
            statuses: [],
            imageUrl: '',
            ability: ''
          }
        }
        return {
          id: compactCard.id,
          baseId: compactCard.id,
          name: 'Unknown',
          deck: deckType,
          ownerId: playerId,
          ownerName: targetPlayer.name,
          power: compactCard.power || 0,
          powerModifier: 0,
          isFaceDown: false,
          statuses: [],
          imageUrl: '',
          ability: ''
        }
      })

      finalDeck = reconstructedDeck
      compactDeckForBroadcast = receivedDeck

      logger.info(`[handleChangePlayerDeck] Host used guest's deck data for real player ${playerId}: ${deckType}, ${finalDeck.length} cards`)
    }

    // Update the player's deck
    const updatedPlayers = this.gameState.players.map(p =>
      p.id === playerId
        ? { ...p, selectedDeck: deckType, deck: finalDeck, hand: [], discard: [], announcedCard: null, boardHistory: [] }
        : p
    )

    this.gameState = {
      ...this.gameState,
      players: updatedPlayers
    }

    // Broadcast full deck data to ALL guests (including original sender for confirmation)
    this.connectionManager.broadcast({
      type: 'CHANGE_PLAYER_DECK',
      senderId: this.connectionManager.getPeerId(),
      playerId,
      data: {
        playerId,
        deckType,
        deck: compactDeckForBroadcast,
        deckSize: compactDeckForBroadcast.length
      },
      timestamp: Date.now()
    }) // Don't exclude sender - everyone gets the same deck data from host

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.gameState)
    }
  }

  /**
   * Handle player name update
   */
  private handleUpdatePlayerName(message: WebrtcMessage, _fromPeerId: string): void {
    if (!this.gameState || !message.data) {return}

    const { playerId, name } = message.data

    const updatedPlayers = this.gameState.players.map(p =>
      p.id === playerId ? { ...p, name } : p
    )

    this.gameState = {
      ...this.gameState,
      players: updatedPlayers
    }

    // Broadcast to all guests
    this.connectionManager.broadcast({
      type: 'UPDATE_PLAYER_NAME',
      senderId: this.connectionManager.getPeerId(),
      playerId,
      data: { name },
      timestamp: Date.now()
    })

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.gameState)
    }
  }

  /**
   * Handle player color change
   */
  private handleChangePlayerColor(message: WebrtcMessage, _fromPeerId: string): void {
    if (!this.gameState || !message.data) {return}

    const { playerId, color } = message.data

    const updatedPlayers = this.gameState.players.map(p =>
      p.id === playerId ? { ...p, color } : p
    )

    this.gameState = {
      ...this.gameState,
      players: updatedPlayers
    }

    // Broadcast to all guests
    this.connectionManager.broadcast({
      type: 'CHANGE_PLAYER_COLOR',
      senderId: this.connectionManager.getPeerId(),
      playerId,
      data: { color },
      timestamp: Date.now()
    })

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.gameState)
    }
  }

  /**
   * Handle player score update
   */
  private handleUpdatePlayerScore(message: WebrtcMessage, _fromPeerId: string): void {
    if (!this.gameState || !message.data) {return}

    const { playerId, delta } = message.data

    const updatedPlayers = this.gameState.players.map(p => {
      if (p.id === playerId) {
        return { ...p, score: Math.max(0, p.score + delta) }
      }
      return p
    })

    this.gameState = {
      ...this.gameState,
      players: updatedPlayers
    }

    // Broadcast to all guests
    this.connectionManager.broadcast({
      type: 'UPDATE_PLAYER_SCORE',
      senderId: this.connectionManager.getPeerId(),
      playerId,
      data: { delta },
      timestamp: Date.now()
    })

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.gameState)
    }
  }

  /**
   * Handle state delta from guest
   */
  private handleStateDelta(message: WebrtcMessage, fromPeerId: string): void {
    if (!message.data?.delta || !this.gameState) {return}

    const delta: StateDelta = message.data.delta

    // Get the guest's player ID
    const guest = this.connectionManager.getGuest(fromPeerId)
    const guestPlayerId = guest?.playerId

    logger.info(`[HostMessageHandler] Received STATE_DELTA from ${fromPeerId}, player ${guestPlayerId}, broadcasting to all`)

    // Apply delta to host state - IMPORTANT!
    // Host must apply the delta to its own gameState before broadcasting
    if (guestPlayerId !== undefined) {
      const newState = applyStateDelta(this.gameState, delta, guestPlayerId)
      this.gameState = newState

      // Notify callback
      if (this.config.onStateUpdate) {
        this.config.onStateUpdate(newState)
      }
    }

    // Broadcast delta to all guests (excluding sender to avoid echo)
    this.connectionManager.broadcastStateDelta(delta, fromPeerId)
  }

  /**
   * Broadcast a message to all guests
   */
  broadcast(message: WebrtcMessage, excludePeerId?: string): number {
    return this.connectionManager.broadcast(message as any, excludePeerId)
  }

  /**
   * Broadcast state delta to all guests
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    this.connectionManager.broadcastStateDelta(delta, excludePeerId)
  }

  /**
   * Broadcast game state to all guests
   */
  broadcastGameState(excludePeerId?: string): void {
    if (!this.gameState) {return}
    this.connectionManager.broadcastGameState(this.gameState, excludePeerId)
  }

  /**
   * Get connection info
   */
  getConnectionInfo() {
    return this.connectionManager.getConnectionInfo()
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.gameState = null
    this.localPlayerId = null
  }
}
