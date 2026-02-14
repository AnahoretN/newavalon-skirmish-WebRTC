/**
 * Guest Manager
 *
 * Manages guest-side WebRTC P2P game logic
 * Handles connection to host, action sending, and state synchronization
 */

import type { GameState, Player, DeckType } from '../../types'
import type { WebrtcMessage, WebrtcConnectionEvent, ReconnectionData, GuestConfig } from '../types'
import type { WebrtcManager as WebrtcManagerType } from '../../utils/webrtcManager'
import { messageBuilder } from '../shared/messages'
import { ConnectionBase } from '../shared/ConnectionBase'
import { logger } from '../../utils/logger'

interface GuestConfig extends ConnectionBase {
  reconnectDelay: number         // override from ConnectionBase
  maxReconnectAttempts: number
}

export class GuestManager extends ConnectionBase {
  private gameState: GameState | null = null
  private localPlayerId: number | null = null
  private reconnectAttempts: number = 0
  private isReconnecting: boolean = false

  constructor(manager: WebrtcManagerType, config: GuestConfig) {
    super(manager)

    // Default guest config
    this.config = {
      reconnectDelay: 2000,           // 2 seconds
      maxReconnectAttempts: 10,
      connectionTimeout: 30000,         // 30 seconds
      ...config
    }
  }

  /**
   * Initialize guest connection to host
   */
  async connectToHost(hostPeerId: string): Promise<boolean> {
    try {
      this.isReconnecting = false
      this.reconnectAttempts = 0

      this.manager.initializeAsGuest(hostPeerId)
      return new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout)

        this.on('connected_to_host', () => {
          clearTimeout(timeout)
          resolve(true)
        })

        this.on('error', (data) => {
          clearTimeout(timeout)
          reject(data.error || new Error('Connection failed'))
        })

        this.on('host_disconnected', () => {
          clearTimeout(timeout)
          this.startReconnect(hostPeerId)
        })
      })
    } catch (err) {
      logger.error('[GuestManager] Failed to connect to host:', err)
      return false
    }
  }

  /**
   * Reconnect to host after disconnect
   */
  private startReconnect(hostPeerId: string): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.warn('[GuestManager] Max reconnect attempts reached, giving up')
      this.emit('failed', { error: 'Max reconnect attempts reached' })
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    logger.info(`[GuestManager] Attempting reconnect to host ${hostPeerId} (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`)

    setTimeout(() => {
      this.connectToHost(hostPeerId)
    }, this.config.reconnectDelay)
  }

  /**
   * Send action to host
   */
  sendAction(actionType: string, actionData: any): boolean {
    const message = messageBuilder.action(actionType, actionData, this.localPlayerId!, this.manager.getPeerId())
    return this.sendMessage(this.manager.getHostPeerId(), message)
  }

  /**
   * Send state delta to host
   */
  sendStateDelta(delta: any): boolean {
    const message = messageBuilder.stateDelta(delta, this.manager.getPeerId())
    return this.sendMessage(this.manager.getHostPeerId(), message)
  }

  /**
   * Handle incoming message from host
   */
  private handleMessage(message: WebrtcMessage): void {
    logger.debug(`[GuestManager] Received ${message.type}`)

    switch (message.type) {
      case 'JOIN_ACCEPT_MINIMAL':
      this.handleJoinAcceptMinimal(message)
        break

      case 'JOIN_ACCEPT':
        this.handleJoinAccept(message)
        break

      case 'STATE_DELTA':
        this.handleStateDelta(message)
        break

      case 'CHANGE_PLAYER_DECK':
        // Host updated deck for some player
        break

      case 'PLAYER_LEAVE':
        this.handlePlayerLeave(message)
        break

      case 'GAME_RESET':
        this.handleGameReset(message)
        break

      case 'HOST_READY':
      case 'START_READY_CHECK':
      case 'CANCEL_READY_CHECK':
      case 'PLAYER_READY':
        // Ready check related
        break

      case 'NEXT_PHASE':
      case 'PREV_PHASE':
      case 'SET_PHASE':
        case 'TOGGLE_AUTO_ABILITIES':
      case 'TOGGLE_AUTO_DRAW':
      case 'TOGGLE_ACTIVE_PLAYER':
        case 'START_NEXT_ROUND':
      case 'START_NEW_MATCH':
        // Phase and game management
        break

      case 'UPDATE_PLAYER_NAME':
      case 'CHANGE_PLAYER_COLOR':
      case 'UPDATE_PLAYER_SCORE':
        // Player settings
        break

      case 'DRAW_CARD':
      case 'SHUFFLE_PLAYER_DECK':
      case 'PLAY_CARD':
      case 'MOVE_CARD':
      case 'RETURN_CARD_TO_HAND':
      case 'ANNOUNCE_CARD':
      case 'END_TURN':
      case 'PLAY_COUNTER':
      case 'PLAY_TOKEN':
      case 'DESTROY_CARD':
        // Game actions
        break

      case 'ADD_COMMAND':
      case 'CANCEL_COMMAND':
      case 'EXECUTE_COMMAND':
      case 'RESET_DEPLOY_STATUS':
        // Command related
        break

      case 'TRIGGER_HIGHLIGHT':
      case 'TRIGGER_NO_TARGET':
      case 'TRIGGER_FLOATING_TEXT':
      case 'SYNC_HIGHLIGHTS':
      case 'SYNC_VALID_TARGETS':
      case 'SET_TARGETING_MODE':
      case 'CLEAR_TARGETING_MODE':
        // Visual effects and targeting
        break

      case 'REVEAL_REQUEST':
        // Reveal requests
        break

      case 'ERROR':
        logger.error('[GuestManager] Error from host:', message.data?.error)
        break

      default:
        logger.warn(`[GuestManager] Unknown message type: ${message.type}`)
    }
  }

  /**
   * Handle JOIN_ACCEPT_MINIMAL
   */
  private handleJoinAcceptMinimal(message: WebrtcMessage): void {
    const minimalInfo = message.data
    const playerId = message.playerId

    if (!playerId) {
      logger.error('[GuestManager] No playerId in JOIN_ACCEPT_MINIMAL')
      return
    }

    this.localPlayerId = playerId

    // Check if host sent full card data for reconnecting player
    const playerInfo = minimalInfo.players?.find((p: any) => p.id === playerId)
    const hasFullCardData = playerInfo?.hand && playerInfo?.deck &&
      playerInfo.hand.length > 0 &&
      !playerInfo.hand.some((c: any) => c.isPlaceholder)

    logger.info(`[GuestManager] Received minimal info, hasFullCardData: ${hasFullCardData}`)

    // Build game state from minimal info
    const gameState: GameState = {
      gameId: minimalInfo.gameId,
      isPrivate: false,
      activeGridSize: minimalInfo.activeGridSize,
      gameMode: minimalInfo.gameMode,
      dummyPlayerCount: 0,
      players: minimalInfo.players.map((p: any) => {
        // For reconnecting player with full data, use it
        // For other players, create placeholders
        if (p.id === playerId && hasFullCardData) {
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            isDummy: p.isDummy,
            isReady: p.isReady,
            score: p.score,
            selectedDeck: p.selectedDeck,
            hand: p.hand,
            deck: p.deck,
            discard: p.discard,
            announcedCard: null,
            boardHistory: [],
            autoDrawEnabled: true,
          }
        }

        // For dummy players, use provided card data
        if (p.isDummy && p.hand && p.deck && p.discard) {
          return {
            ...p,
            boardHistory: [],
          }
        }

        // Real players - create deck locally
        const deckType = p.selectedDeck || 'SynchroTech'
        const deckData = this.createDeck(deckType, p.id, p.name)

        return {
          ...p,
          hand: [],
          deck: deckData,
          discard: [],
          boardHistory: [],
        }
      }),
      deckSelections: minimalInfo.deckSelections || [],
      gameMode: minimalInfo.gameMode,
      currentRound: minimalInfo.currentRound || 1,
      currentPhase: minimalInfo.currentPhase || 0,
      activePlayerId: minimalInfo.activePlayerId || null,
      startingPlayerId: minimalInfo.startingPlayerId || null,
      isGameStarted: minimalInfo.isGameStarted || false,
      preserveDeployAbilities: false,
      autoAbilitiesEnabled: true,
      autoDrawEnabled: true,
      currentTurn: 1,
      board: minimalInfo.board || this.createEmptyBoard(minimalInfo.activeGridSize),
      hostId: 1,
      localPlayerId: null,
      isSpectator: false,
      floatingTexts: [],
      highlights: [],
      deckSelections: [],
      handCardSelections: [],
      targetingMode: null,
      spectators: [],
      revealRequests: [],
      isReadyCheckActive: false,
      isRoundEndModalOpen: false,
      gameWinner: null,
      roundWinners: {},
    }

    this.gameState = gameState
    this.emit('state_changed', gameState)
  }

  // Helper functions
  private createEmptyBoard(gridSize: number): any[][] {
    const board: any[][] = []
    for (let i = 0; i < gridSize; i++) {
      const row: any[] = []
      for (let j = 0; j < gridSize; j++) {
        row.push({ card: null })
      }
      board.push(row)
    }
    return board
  }

  private createDeck(deckType: DeckType, playerId: number, playerName: string): any[] {
    // This should use the same deck creation logic as useGameState
    // For now, simplified placeholder
    const deck: any[] = []
    for (let i = 0; i < 30; i++) {
      deck.push({
        id: `card_${playerId}_${i}`,
        name: 'Card',
        ownerId: playerId,
        deck: deckType,
      })
    }
    return deck
  }

  /**
   * Handle STATE_DELTA
   */
  private handleStateDelta(message: WebrtcMessage): void {
    const delta = message.data?.delta
    if (!delta) return

    logger.info('[GuestManager] Applying state delta')
    // Apply delta logic here...
  }

  /**
   * Handle PLAYER_LEAVE
   */
  private handlePlayerLeave(message: WebrtcMessage): void {
    const leavingPlayerId = message.playerId

    this.updateGameState((state: GameState | null) => {
      if (!state) return state

      return {
        ...state,
        players: state.players.filter(p => p.id !== leavingPlayerId)
      }
    })
  }

  /**
   * Handle GAME_RESET
   */
  private handleGameReset(message: WebrtcMessage): void {
    this.emit('reset')

    // Reset local game state
    this.gameState = null
    this.localPlayerId = null
  }
}
