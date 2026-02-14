/**
 * Host Manager
 *
 * Manages host-side WebRTC P2P game logic
 * Handles guest connections, state management, and reconnection
 */

import type { GameState, Player } from '../../types'
import type { WebrtcMessage, WebrtcConnectionEvent, ReconnectionData } from '../types'
import { messageBuilder } from '../shared/messages'
import { ConnectionBase } from '../shared/ConnectionBase'
import { logger } from '../../utils/logger'
import type { WebrtcManager as WebrtcManagerType } from '../../utils/webrtcManager'

interface HostConfig {
  autoSaveState: boolean
  autoBroadcastState: boolean
  stateSaveInterval: number
}

export class HostManager extends ConnectionBase {
  private gameState: GameState | null = null
  private playerIdCounter: number = 1
  private config: HostConfig

  constructor(manager: WebrtcManagerType, config: HostConfig = {}) {
    super(manager)

    // Default host config
    this.config = {
      autoSaveState: true,
      autoBroadcastState: true,
      stateSaveInterval: 5000,  // 5 seconds
      ...config
    }

    this.setupEventHandlers()
  }

  /**
   * Initialize host
   */
  async initialize(existingPeerId?: string): Promise<string | null> {
    try {
      this.manager.initializeAsHost(existingPeerId)

      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Host init timeout')), 10000)

        this.on('peer_open', (data) => {
          clearTimeout(timeout)
          this.emit('initialized', data)
          resolve(data.peerId as string)
        })

        this.on('error', (data) => {
          clearTimeout(timeout)
          reject(data.error)
        })
      })
    } catch (err) {
      logger.error('[HostManager] Failed to initialize:', err)
      return null
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.on('guest_connected', (data) => {
      logger.info(`[HostManager] Guest connected: ${data.peerId}`)
      this.connections.set(data.peerId, { connection: data.connection, playerId: null })
      this.emit('guest_joined', { peerId: data.peerId })
    })

    this.on('guest_disconnected', (data) => {
      logger.info(`[HostManager] Guest disconnected: ${data.peerId}`)
      this.handleGuestDisconnect(data.peerId)
    })

    this.on('message_received', (data) => {
      logger.debug(`[HostManager] Message received: ${data.message.type}`)
      this.handleMessage(data.message)
    })
  }

  /**
   * Handle guest disconnect
   */
  private handleGuestDisconnect(peerId: string): void {
    const connection = this.connections.get(peerId)
    if (connection) {
      const playerId = connection.playerId
      this.connections.delete(peerId)

      logger.info(`[HostManager] Player ${playerId} disconnected, players remaining: ${this.connections.size}`)

      // Notify other guests
      this.broadcast(messageBuilder.playerLeave(), peerId)

      // If no guests left, update game state
      if (this.connections.size === 0) {
        this.emit('no_guests_remaining')
      }
    }
  }

  /**
   * Handle incoming message from guest
   */
  private handleMessage(message: WebrtcMessage): void {
    switch (message.type) {
      case 'JOIN_REQUEST':
        this.handleJoinRequest(message)
        break

      case 'PLAYER_RECONNECT':
        this.handlePlayerReconnect(message)
        break

      case 'ACTION':
        this.handleAction(message)
        break

      case 'CHANGE_PLAYER_DECK':
        this.handleChangePlayerDeck(message)
        break

      default:
        logger.warn(`[HostManager] Unhandled message type: ${message.type}`)
    }
  }

  /**
   * Handle join request from new guest
   */
  private handleJoinRequest(message: WebrtcMessage): void {
    const newPlayerId = this.playerIdCounter++

    // Create new player
    const newPlayer: Player = {
      id: newPlayerId,
      name: `Player ${newPlayerId}`,
      color: 'blue' as any,
      isDummy: false,
      isReady: false,
      score: 0,
      selectedDeck: 'Random',
      deck: [],
      hand: [],
      discard: [],
      announcedCard: null,
      boardHistory: [],
      autoDrawEnabled: true,
    }

    // Add to game state
    this.updateGameState((state: GameState | null) => {
      if (!state) {
        logger.error('[HostManager] No game state to add player to')
        return null
      }

      return {
        ...state,
        players: [...state.players, newPlayer]
      }
    })

    // Accept guest with minimal info (to avoid size limit)
    this.acceptGuest(message.senderId!, newPlayerId)
  }

  /**
   * Handle player reconnect
   */
  private handlePlayerReconnect(message: WebrtcMessage): void {
    const playerId = message.playerId
    const senderId = message.senderId!

    logger.info(`[HostManager] Player ${playerId} reconnecting from ${senderId}`)

    // Find player in current state
    if (!this.gameState) {
      logger.warn('[HostManager] No game state for reconnect')
      return
    }

    const player = this.gameState.players?.find(p => p.id === playerId)
    if (!player) {
      logger.warn(`[HostManager] Player ${playerId} not found for reconnect`)
      return
    }

    // Accept guest with minimal info including full card data
    this.acceptGuestReconnect(senderId, playerId, player)
  }

  /**
   * Accept guest with minimal game info
   */
  private acceptGuest(peerId: string, playerId: number): void {
    const minimalInfo = this.buildMinimalInfo(playerId)
    this.sendMessage(peerId, messageBuilder.joinAcceptMinimal(playerId, minimalInfo, this.manager.getPeerId()))
  }

  /**
   * Accept reconnecting guest with full card data
   */
  private acceptGuestReconnect(peerId: string, playerId: number, player: Player): void {
    const minimalInfo = this.buildReconnectInfo(playerId, player)
    this.sendMessage(peerId, messageBuilder.joinAcceptMinimal(playerId, minimalInfo, this.manager.getPeerId()))
  }

  /**
   * Handle action message from guest
   */
  private handleAction(message: WebrtcMessage): void {
    const actionData = message.data
    if (!actionData) return

    const { actionType, actionData: data } = actionData
    const playerId = message.playerId

    logger.info(`[HostManager] Action: ${actionType} from player ${playerId}`)

    // Handle different action types
    switch (actionType) {
      case 'DRAW_CARD':
      case 'PLAY_CARD':
      case 'MOVE_CARD':
      case 'RETURN_CARD_TO_HAND':
      case 'ANNOUNCE_CARD':
      case 'END_TURN':
      case 'PLAY_COUNTER':
      case 'PLAY_TOKEN':
      case 'DESTROY_CARD':
      case 'ADD_COMMAND':
      case 'CANCEL_COMMAND':
      case 'EXECUTE_COMMAND':
      case 'RESET_DEPLOY_STATUS':
      case 'TRIGGER_HIGHLIGHT':
      case 'TRIGGER_NO_TARGET':
      case 'TRIGGER_FLOATING_TEXT':
      case 'SYNC_HIGHLIGHTS':
      case 'SYNC_VALID_TARGETS':
      case 'SET_TARGETING_MODE':
      case 'CLEAR_TARGETING_MODE':
      case 'UPDATE_PLAYER_NAME':
      case 'CHANGE_PLAYER_COLOR':
      case 'UPDATE_PLAYER_SCORE':
      case 'LOAD_CUSTOM_DECK':
      case 'SHUFFLE_PLAYER_DECK':
        // Actions handled by state update
        this.emit('action', { playerId, actionType, data })
        break

      default:
        logger.warn(`[HostManager] Unknown action type: ${actionType}`)
    }
  }

  /**
   * Handle change player deck
   */
  private handleChangePlayerDeck(message: WebrtcMessage): void {
    const { playerId, deckType } = message.data
    const player = this.gameState?.players?.find(p => p.id === playerId)

    if (!player) {
      logger.warn(`[HostManager] Player ${playerId} not found for deck change`)
      return
    }

    // Only create new deck if player doesn't already have this deck
    if (player.selectedDeck === deckType && player.deck.length > 0) {
      logger.info(`[HostManager] Player ${playerId} already has deck ${deckType}, skipping deck creation`)
      return
    }

    logger.info(`[HostManager] Creating deck ${deckType} for player ${playerId}`)

    // Create new deck and update player
    // Note: Deck creation happens in useGameState, this just emits event
    this.emit('deck_change', { playerId, deckType })
  }

  /**
   * Build minimal info for new guest
   */
  private buildMinimalInfo(playerId: number): any {
    if (!this.gameState) {
      logger.error('[HostManager] No game state for minimal info')
      return {}
    }

    return {
      playerId,
      gameId: this.gameState.gameId,
      isGameStarted: this.gameState.isGameStarted,
      players: this.gameState.players.map(p => ({
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
      deckSelections: this.gameState.players.map(p => ({ id: p.id, selectedDeck: p.selectedDeck })),
      gameMode: this.gameState.gameMode,
      currentRound: this.gameState.currentRound,
      currentPhase: this.gameState.currentPhase,
      activePlayerId: this.gameState.activePlayerId,
      startingPlayerId: this.gameState.startingPlayerId,
      activeGridSize: this.gameState.activeGridSize,
      board: this.gameState.board,
    }
  }

  /**
   * Build reconnect info for reconnecting guest
   */
  private buildReconnectInfo(playerId: number, player: Player): any {
    if (!this.gameState) {
      logger.error('[HostManager] No game state for reconnect info')
      return {}
    }

    return {
      playerId,
      gameId: this.gameState.gameId,
      isGameStarted: this.gameState.isGameStarted,
      players: this.gameState.players.map(p => {
        if (p.id === playerId) {
          // Return full card data for reconnecting player
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            isDummy: p.isDummy,
            isReady: p.isReady,
            score: p.score,
            selectedDeck: p.selectedDeck,
            hand: player.hand || [],
            deck: player.deck || [],
            discard: player.discard || [],
          }
        }
        // Other players: minimal info
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          isDummy: p.isDummy,
          isReady: p.isReady,
          score: p.score,
          selectedDeck: p.selectedDeck,
          deckSize: p.deck?.length || 0,
          handSize: p.hand?.length || 0,
          discardSize: p.discard?.length || 0,
        }
      }),
      deckSelections: this.gameState.players.map(p => ({ id: p.id, selectedDeck: p.selectedDeck })),
      gameMode: this.gameState.gameMode,
      currentRound: this.gameState.currentRound,
      currentPhase: this.gameState.currentPhase,
      activePlayerId: this.gameState.activePlayerId,
      startingPlayerId: this.gameState.startingPlayerId,
      activeGridSize: this.gameState.activeGridSize,
      board: this.gameState.board,
    }
  }

  /**
   * Update game state
   */
  updateGameState(updater: (state: GameState | null) => GameState): void {
    const prevState = this.gameState
    this.gameState = updater(this.gameState)

    if (this.config.autoBroadcastState && this.gameState !== prevState) {
      this.emit('state_changed', this.gameState)
    }
  }

  /**
   * Set game state
   */
  setGameState(state: GameState): void {
    this.gameState = state
    this.emit('state_changed', state)

    if (this.config.autoSaveState) {
      this.saveStateToStorage()
    }
  }

  /**
   * Save state to localStorage for recovery
   */
  private saveStateToStorage(): void {
    if (!this.gameState) return

    try {
      const data: ReconnectionData = {
        hostPeerId: this.manager.getPeerId() || '',
        playerId: 1, // Host is always player 1
        gameState: this.gameState,
        timestamp: Date.now(),
        isHost: true,
      }
      localStorage.setItem('webrtc_host_data', JSON.stringify(data))
      logger.debug('[HostManager] Saved host data to localStorage')
    } catch (err) {
      logger.error('[HostManager] Failed to save state:', err)
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    super.cleanup()
    this.gameState = null
  }
}
