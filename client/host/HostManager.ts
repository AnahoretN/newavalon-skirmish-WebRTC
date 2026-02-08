/**
 * Host Manager
 * Main entry point for WebRTC host functionality
 * Combines connection management, state management, and all game systems
 *
 * Architecture:
 * - Host acts as the "source of truth" for all game state
 * - When host's state changes, broadcast to all guests
 * - When guest sends state change, apply to host state, then broadcast to all guests
 * - Host is also a player, so their actions go through the same pipeline
 */

import type { GameState, StateDelta, HighlightData, FloatingTextData, TargetingModeData } from '../types'
import type { HostConfig, WebrtcEvent } from './types'
import { HostConnectionManager } from './HostConnectionManager'
import { HostStateManager } from './HostStateManager'
import { VisualEffectsManager } from './VisualEffects'
import { TimerSystem, TIMER_CONFIG } from './TimerSystem'
import { GameLogger } from './GameLogger'
import {
  nextPhase,
  prevPhase,
  setPhase,
  toggleActivePlayer,
  toggleAutoDraw,
  resetDeployStatus
} from './PhaseManagement'
import { checkRoundEnd, endRound, startNextRound } from './RoundManagement'
import { logger } from '../utils/logger'

export interface HostManagerConfig extends HostConfig {
  onStateUpdate?: (newState: GameState) => void
  onPlayerJoin?: (playerId: number, peerId: string) => void
  onPlayerLeave?: (playerId: number, peerId: string) => void
  onGuestConnected?: (peerId: string) => void
  onGuestDisconnected?: (peerId: string) => void
  onRoundEnd?: (winners: number[], roundNumber: number) => void
  onGameEnd?: (winnerId: number | null) => void
  enableTimers?: boolean
  enableLogging?: boolean
}

export class HostManager {
  private connectionManager: HostConnectionManager
  private stateManager: HostStateManager
  private visualEffects: VisualEffectsManager
  private timerSystem: TimerSystem
  private gameLogger: GameLogger
  private initialized: boolean = false
  private localPlayerId: number | null = null
  private config: HostManagerConfig

  constructor(config: HostManagerConfig = {}) {
    this.config = config

    // Extract connection-specific config
    const connectionConfig: HostConfig = {
      maxGuests: config.maxGuests,
      autoAcceptGuests: config.autoAcceptGuests,
      enableReconnection: config.enableReconnection
    }

    // Initialize connection manager
    this.connectionManager = new HostConnectionManager(connectionConfig)

    // Initialize state manager
    this.stateManager = new HostStateManager(this.connectionManager)

    // Initialize visual effects manager
    this.visualEffects = new VisualEffectsManager(this.connectionManager)

    // Initialize timer system with event handlers
    this.timerSystem = new TimerSystem(this.connectionManager, {
      onPlayerDisconnectTimeout: (playerId) => this.handlePlayerDisconnectTimeout(playerId),
      onGameInactivityTimeout: () => this.handleInactivityTimeout(),
      onGameCleanupTimeout: () => this.handleGameCleanupTimeout(),
      onTurnTimeout: (playerId) => this.handleTurnTimeout(playerId)
    })

    // Initialize game logger
    this.gameLogger = new GameLogger(this.connectionManager, {
      enableConsoleLogging: config.enableLogging ?? true
    })

    // Subscribe to connection events
    this.connectionManager.on((event: WebrtcEvent) => {
      this.handleConnectionEvent(event)
    })

    // Subscribe to connection manager's message events
    this.connectionManager.on((event: WebrtcEvent) => {
      if (event.type === 'message_received') {
        this.handleIncomingMessage(event.data.message, event.data.fromPeerId)
      }
    })
  }

  /**
   * Handle connection events
   */
  private handleConnectionEvent(event: WebrtcEvent): void {
    switch (event.type) {
      case 'guest_connected':
        if (this.config.onGuestConnected) {
          this.config.onGuestConnected(event.data.peerId)
        }
        break
      case 'guest_disconnected':
        if (this.config.onGuestDisconnected) {
          this.config.onGuestDisconnected(event.data.peerId)
        }
        // Handle player leave
        const guest = this.connectionManager.getGuest(event.data.peerId)
        if (guest && guest.playerId) {
          this.handlePlayerDisconnect(guest.playerId, event.data.peerId)
        }
        break
    }
  }

  /**
   * Handle player disconnect
   */
  private handlePlayerDisconnect(playerId: number, peerId: string): void {
    const state = this.stateManager.getState()
    if (!state) return

    // Mark player as disconnected
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, isDisconnected: true } : p
    )

    const newState: GameState = {
      ...state,
      players: updatedPlayers
    }

    this.stateManager.setInitialState(newState)

    // Start disconnect timer if enabled
    if (this.config.enableTimers !== false) {
      this.timerSystem.startPlayerDisconnectTimer(playerId)
    }

    // Log the disconnect
    this.gameLogger.logPlayerDisconnect(playerId, 'Connection lost')

    // Notify callback
    if (this.config.onPlayerLeave) {
      this.config.onPlayerLeave(playerId, peerId)
    }

    // Broadcast to all guests
    this.broadcast({
      type: 'PLAYER_DISCONNECTED',
      senderId: this.connectionManager.getPeerId(),
      data: { playerId },
      timestamp: Date.now()
    })
  }

  /**
   * Handle player reconnect
   */
  handlePlayerReconnect(playerId: number, _peerId: string): void {
    const state = this.stateManager.getState()
    if (!state) return

    // Cancel disconnect timer
    this.timerSystem.cancelPlayerDisconnectTimer(playerId)

    // Mark player as connected
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, isDisconnected: false } : p
    )

    const newState: GameState = {
      ...state,
      players: updatedPlayers
    }

    this.stateManager.setInitialState(newState)

    // Log the reconnect
    this.gameLogger.logPlayerReconnect(playerId)

    // Broadcast to all guests
    this.broadcast({
      type: 'PLAYER_RECONNECTED',
      senderId: this.connectionManager.getPeerId(),
      data: { playerId },
      timestamp: Date.now()
    })
  }

  /**
   * Handle player disconnect timeout (convert to dummy)
   */
  private handlePlayerDisconnectTimeout(playerId: number): void {
    const state = this.stateManager.getState()
    if (!state) return

    // Convert player to dummy
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, isDummy: true, isDisconnected: true } : p
    )

    const newState: GameState = {
      ...state,
      players: updatedPlayers
    }

    this.stateManager.setInitialState(newState)

    // Log conversion
    this.gameLogger.logPlayerToDummy(playerId)

    // Broadcast to all guests
    this.broadcast({
      type: 'PLAYER_CONVERTED_TO_DUMMY',
      senderId: this.connectionManager.getPeerId(),
      data: { playerId },
      timestamp: Date.now()
    })
  }

  /**
   * Handle inactivity timeout
   */
  private handleInactivityTimeout(): void {
    logger.warn('[HostManager] Inactivity timeout reached')

    this.gameLogger.logAction('INACTIVITY_TIMEOUT', {
      duration: TIMER_CONFIG.INACTIVITY_TIMEOUT
    })

    // Start game cleanup timer
    this.timerSystem.scheduleGameTermination()
  }

  /**
   * Handle game cleanup timeout
   */
  private handleGameCleanupTimeout(): void {
    logger.warn('[HostManager] Game cleanup timeout - terminating')

    this.gameLogger.logAction('GAME_TERMINATED', { reason: 'cleanup_timeout' })

    // Notify all guests
    this.broadcast({
      type: 'GAME_TERMINATED',
      senderId: this.connectionManager.getPeerId(),
      data: { reason: 'inactivity' },
      timestamp: Date.now()
    })
  }

  /**
   * Handle turn timeout
   */
  private handleTurnTimeout(playerId: number): void {
    logger.warn(`[HostManager] Turn timeout for player ${playerId}`)

    this.gameLogger.logAction('TURN_TIMEOUT', { playerId })

    // Auto-advance turn
    this.advanceTurn()
  }

  /**
   * Handle incoming message from guest
   */
  private handleIncomingMessage(message: any, fromPeerId: string): void {
    if (!message || !message.type) return

    const guest = this.connectionManager.getGuest(fromPeerId)
    const guestPlayerId = guest?.playerId || message.playerId

    logger.info(`[HostManager] Received ${message.type} from ${fromPeerId} (player ${guestPlayerId})`)

    // Reset inactivity timer on any message
    if (this.config.enableTimers !== false) {
      this.timerSystem.resetInactivityTimer()
    }

    switch (message.type) {
      case 'JOIN_REQUEST':
        this.handleJoinRequest(fromPeerId)
        break

      case 'PLAYER_READY':
        if (guestPlayerId) {
          this.stateManager.setPlayerReady(guestPlayerId, true)
          this.gameLogger.logAction('PLAYER_READY', {}, guestPlayerId)
        }
        break

      case 'CHANGE_PLAYER_DECK':
        if (guestPlayerId && message.data) {
          this.stateManager.updatePlayerProperty(guestPlayerId, {
            selectedDeck: message.data.deckType
          })
          this.gameLogger.logAction('DECK_CHANGED', {
            deckType: message.data.deckType
          }, guestPlayerId)
        }
        break

      case 'UPDATE_PLAYER_NAME':
        if (guestPlayerId && message.data) {
          this.stateManager.updatePlayerProperty(guestPlayerId, {
            name: message.data.name
          })
        }
        break

      case 'CHANGE_PLAYER_COLOR':
        if (guestPlayerId && message.data) {
          this.stateManager.updatePlayerProperty(guestPlayerId, {
            color: message.data.color
          })
        }
        break;

      case 'UPDATE_PLAYER_SCORE':
        if (guestPlayerId && message.data) {
          const player = this.stateManager.getState()?.players.find(p => p.id === guestPlayerId)
          if (player) {
            const newScore = Math.max(0, player.score + message.data.delta)
            this.stateManager.updatePlayerProperty(guestPlayerId, {
              score: newScore
            })
            this.gameLogger.logScoreChange(guestPlayerId, player.score, newScore, message.data.reason || 'manual')
          }
        }
        break

      case 'ACTION':
        if (message.data) {
          const { actionType, actionData } = message.data
          this.handleAction(actionType, actionData, guestPlayerId, fromPeerId)
        }
        break

      // Phase management messages
      case 'NEXT_PHASE':
        this.advancePhase()
        break

      case 'PREV_PHASE':
        this.regressPhase()
        break

      case 'SET_PHASE':
        if (message.data?.phaseIndex !== undefined) {
          this.changePhase(message.data.phaseIndex)
        }
        break

      case 'TOGGLE_ACTIVE_PLAYER':
        if (message.data?.playerId !== undefined) {
          this.toggleActivePlayer(message.data.playerId)
        }
        break

      case 'TOGGLE_AUTO_DRAW':
        if (guestPlayerId !== undefined) {
          this.togglePlayerAutoDraw(guestPlayerId)
        }
        break

      case 'START_NEXT_ROUND':
        this.proceedToNextRound()
        break

      // Visual effects messages (rebroadcast to all)
      case 'TRIGGER_HIGHLIGHT':
        if (message.data?.highlightData) {
          this.visualEffects.broadcastHighlight(message.data.highlightData)
        }
        break

      case 'TRIGGER_FLOATING_TEXT':
        if (message.data?.textData) {
          this.visualEffects.broadcastFloatingText(message.data.textData)
        }
        break

      case 'TRIGGER_FLOATING_TEXT_BATCH':
        if (message.data?.batch) {
          this.visualEffects.broadcastFloatingTextBatch(message.data.batch)
        }
        break

      case 'TRIGGER_NO_TARGET':
        if (message.data?.coords) {
          this.visualEffects.broadcastNoTarget(message.data.coords)
        }
        break

      case 'SET_TARGETING_MODE':
        if (message.data?.targetingMode) {
          this.visualEffects.setTargetingMode(message.data.targetingMode)
        }
        break

      case 'CLEAR_TARGETING_MODE':
        this.visualEffects.clearTargetingMode()
        break

      default:
        logger.debug(`[HostManager] Unhandled message type: ${message.type}`)
        break
    }
  }

  /**
   * Handle action from guest
   */
  private handleAction(actionType: string, actionData: any, guestPlayerId: number | undefined, fromPeerId: string): void {
    if (guestPlayerId === undefined) {
      logger.warn(`[HostManager] No player ID for action ${actionType}`)
      return
    }

    switch (actionType) {
      case 'STATE_UPDATE':
        if (actionData?.gameState) {
          this.stateManager.updateFromGuest(guestPlayerId, actionData.gameState, fromPeerId)
        }
        break

      case 'STATE_DELTA':
        if (actionData?.delta) {
          this.stateManager.applyDeltaFromGuest(guestPlayerId, actionData.delta, fromPeerId)
        }
        break

      default:
        logger.debug(`[HostManager] Unhandled action type: ${actionType}`)
        break
    }
  }

  /**
   * Handle guest join request
   */
  private handleJoinRequest(guestPeerId: string): void {
    const currentState = this.stateManager.getState()
    if (!currentState) {
      logger.error('[HostManager] No game state, cannot accept guest')
      return
    }

    // Find next available player ID
    const existingPlayerIds = currentState.players.map(p => p.id)
    let newPlayerId = 1
    while (existingPlayerIds.includes(newPlayerId)) {
      newPlayerId++
    }

    // Create new player
    const { PLAYER_COLOR_NAMES } = require('../constants')
    const { DeckType } = require('../types')
    const newPlayer = {
      id: newPlayerId,
      name: `Player ${newPlayerId}`,
      color: PLAYER_COLOR_NAMES[existingPlayerIds.length % PLAYER_COLOR_NAMES.length],
      hand: [],
      deck: [],
      discard: [],
      announcedCard: null,
      score: 0,
      isDummy: false,
      isReady: false,
      selectedDeck: DeckType.Neutral,
      boardHistory: [],
      autoDrawEnabled: true,
    }

    // Update state with new player
    const oldState = currentState
    const newState: GameState = {
      ...oldState,
      players: [...oldState.players, newPlayer]
    }

    this.stateManager.setInitialState(newState)
    this.connectionManager.setGuestPlayerId(guestPeerId, newPlayerId)

    // Accept guest with minimal info
    this.connectionManager.acceptGuestMinimal(
      guestPeerId,
      this.stateManager.getStateForGuest(),
      newPlayerId
    )

    // Log player join
    this.gameLogger.logAction('PLAYER_JOINED', { playerId: newPlayerId }, newPlayerId)

    // Notify callback
    if (this.config.onPlayerJoin) {
      this.config.onPlayerJoin(newPlayerId, guestPeerId)
    }

    logger.info(`[HostManager] Added player ${newPlayerId} for guest ${guestPeerId}`)
  }

  /**
   * Initialize as host
   */
  async initialize(): Promise<string> {
    if (this.initialized) {
      logger.warn('[HostManager] Already initialized')
      return this.connectionManager.getPeerId() || ''
    }

    logger.info('[HostManager] Initializing...')

    try {
      const peerId = await this.connectionManager.initialize()
      this.initialized = true
      logger.info(`[HostManager] Initialized with peerId: ${peerId}`)
      return peerId
    } catch (err) {
      logger.error('[HostManager] Failed to initialize:', err)
      throw err
    }
  }

  /**
   * Set the initial game state
   */
  setInitialState(state: GameState): void {
    this.stateManager.setInitialState(state)
    this.gameLogger.setGameState(state)
    this.timerSystem.setGameState(state)
  }

  /**
   * Set the game state (for local updates)
   */
  setGameState(state: GameState): void {
    this.stateManager.setInitialState(state)
    this.gameLogger.setGameState(state)
    this.timerSystem.setGameState(state)
  }

  /**
   * Get the current game state
   */
  getGameState(): GameState | null {
    return this.stateManager.getState()
  }

  /**
   * Set the local player ID (host's player ID)
   */
  setLocalPlayerId(playerId: number): void {
    this.localPlayerId = playerId
    this.stateManager.setLocalPlayerId(playerId)
  }

  /**
   * Get the local player ID
   */
  getLocalPlayerId(): number | null {
    return this.localPlayerId
  }

  /**
   * Update state from local (host) action and broadcast to guests
   * This is called when host (as a player) makes an action
   */
  updateFromLocal(newState: GameState): void {
    const oldState = this.stateManager.getState()
    if (!oldState) {
      this.stateManager.setInitialState(newState)
      this.gameLogger.setGameState(newState)
      this.timerSystem.setGameState(newState)
      return
    }

    this.stateManager.updateFromLocal(newState)
    this.gameLogger.setGameState(newState)
    this.timerSystem.setGameState(newState)

    // Reset inactivity timer
    if (this.config.enableTimers !== false) {
      this.timerSystem.resetInactivityTimer()
    }

    // Notify callback
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(newState)
    }
  }

  // ==================== Phase Management ====================

  /**
   * Advance to next phase
   */
  advancePhase(): void {
    const state = this.stateManager.getState()
    if (!state) return

    const oldPhase = state.currentPhase
    const newState = nextPhase(state)

    if (oldPhase !== newState.currentPhase) {
      this.gameLogger.logPhaseTransition(oldPhase, newState.currentPhase)
    }

    // Check for round end when entering Setup phase
    if (newState.currentPhase === 1) { // Setup phase
      const { shouldEnd, roundWinners } = checkRoundEnd(newState)
      if (shouldEnd) {
        const endState = endRound(newState)
        this.updateFromLocal(endState)

        if (this.config.onRoundEnd) {
          this.config.onRoundEnd(roundWinners, endState.currentRound || 1)
        }

        if (endState.gameWinner && this.config.onGameEnd) {
          this.config.onGameEnd(endState.gameWinner)
        }

        return
      }
    }

    this.updateFromLocal(newState)
  }

  /**
   * Regress to previous phase
   */
  regressPhase(): void {
    const state = this.stateManager.getState()
    if (!state) return

    const oldPhase = state.currentPhase
    const newState = prevPhase(state)

    if (oldPhase !== newState.currentPhase) {
      this.gameLogger.logPhaseTransition(oldPhase, newState.currentPhase)
    }

    this.updateFromLocal(newState)
  }

  /**
   * Set specific phase
   */
  changePhase(phaseIndex: number): void {
    const state = this.stateManager.getState()
    if (!state) return

    const oldPhase = state.currentPhase
    const newState = setPhase(state, phaseIndex)

    if (oldPhase !== newState.currentPhase) {
      this.gameLogger.logPhaseTransition(oldPhase, newState.currentPhase)
    }

    this.updateFromLocal(newState)
  }

  /**
   * Toggle active player (select/deselect)
   * Matches server behavior: clicking same player deselects, clicking different player selects
   */
  toggleActivePlayer(playerId: number): void {
    const state = this.stateManager.getState()
    if (!state) return

    const oldPlayerId = state.activePlayerId
    const newState = toggleActivePlayer(state, playerId)

    this.gameLogger.logAction('ACTIVE_PLAYER_TOGGLED', {
      from: oldPlayerId,
      to: newState.activePlayerId,
      targetPlayer: playerId
    })

    if (oldPlayerId !== newState.activePlayerId) {
      // Cancel old turn timer, start new one if new player is selected
      if (this.config.enableTimers !== false) {
        if (oldPlayerId) this.timerSystem.cancelTurnTimer(oldPlayerId)
        if (newState.activePlayerId) {
          this.timerSystem.startTurnTimer(newState.activePlayerId)
        }
      }
    }

    this.updateFromLocal(newState)
  }

  /**
   * Advance to next turn (for auto-cycle, not manual toggle)
   * This is used when automatically moving to the next player in sequence
   */
  advanceTurn(): void {
    const state = this.stateManager.getState()
    if (!state) return

    // Get all connected players (including dummies)
    const allPlayers = state.players.filter(p => !p.isDisconnected)
    if (allPlayers.length === 0) return

    // Find current active player index
    const currentIndex = allPlayers.findIndex(p => p.id === state.activePlayerId)

    // Move to next player in sequence
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % allPlayers.length : 0
    const nextPlayerId = allPlayers[nextIndex].id

    this.toggleActivePlayer(nextPlayerId)
  }

  /**
   * Toggle auto-draw for a player
   */
  togglePlayerAutoDraw(playerId: number): void {
    const state = this.stateManager.getState()
    if (!state) return

    const newState = toggleAutoDraw(state, playerId)
    this.updateFromLocal(newState)
  }

  /**
   * Reset deploy status for all cards
   */
  clearDeployStatus(): void {
    const state = this.stateManager.getState()
    if (!state) return

    const newState = resetDeployStatus(state)
    this.updateFromLocal(newState)
  }

  /**
   * Proceed to next round
   */
  proceedToNextRound(): void {
    const state = this.stateManager.getState()
    if (!state) return

    const newState = startNextRound(state)
    this.updateFromLocal(newState)

    this.gameLogger.logRoundStart(newState.currentRound || 1)
  }

  // ==================== Visual Effects ====================

  /**
   * Broadcast highlight to all guests
   */
  broadcastHighlight(highlightData: HighlightData): void {
    this.visualEffects.broadcastHighlight(highlightData)
  }

  /**
   * Broadcast floating text to all guests
   */
  broadcastFloatingText(textData: FloatingTextData): void {
    this.visualEffects.broadcastFloatingText(textData)
  }

  /**
   * Broadcast batch of floating texts
   */
  broadcastFloatingTextBatch(batch: FloatingTextData[]): void {
    this.visualEffects.broadcastFloatingTextBatch(batch)
  }

  /**
   * Set targeting mode for all guests
   */
  setTargetingMode(targetingMode: TargetingModeData): void {
    this.visualEffects.setTargetingMode(targetingMode)
  }

  /**
   * Clear targeting mode for all guests
   */
  clearTargetingMode(): void {
    this.visualEffects.clearTargetingMode()
  }

  /**
   * Broadcast no-target overlay
   */
  broadcastNoTarget(coords: { row: number; col: number }): void {
    this.visualEffects.broadcastNoTarget(coords)
  }

  // ==================== Logging ====================

  /**
   * Get game logs
   */
  getLogs(): any[] {
    return this.gameLogger.getLogs()
  }

  /**
   * Get game statistics
   */
  getGameStatistics() {
    return this.gameLogger.getStatistics()
  }

  // ==================== Connection Management ====================

  /**
   * Get the host peer ID
   */
  getPeerId(): string | null {
    return this.connectionManager.getPeerId()
  }

  /**
   * Get connection info for all guests
   */
  getConnectionInfo() {
    return this.connectionManager.getConnectionInfo()
  }

  /**
   * Get guest by peer ID
   */
  getGuest(peerId: string) {
    return this.connectionManager.getGuest(peerId)
  }

  /**
   * Get guest by player ID
   */
  getGuestByPlayerId(playerId: number) {
    return this.connectionManager.getGuestByPlayerId(playerId)
  }

  /**
   * Get number of connected guests
   */
  getGuestCount(): number {
    return this.connectionManager.getGuestCount()
  }

  /**
   * Check if connected to any guests
   */
  hasGuests(): boolean {
    return this.connectionManager.hasGuests()
  }

  /**
   * Broadcast a message to all guests
   */
  broadcast(message: any, excludePeerId?: string): number {
    return this.connectionManager.broadcast(message, excludePeerId)
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
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No game state to broadcast')
      return
    }
    this.connectionManager.broadcastGameState(state, excludePeerId)
  }

  // ==================== Game Settings ====================

  /**
   * Start ready check
   */
  startReadyCheck(): void {
    this.stateManager.startReadyCheck()
  }

  /**
   * Cancel ready check
   */
  cancelReadyCheck(): void {
    this.stateManager.cancelReadyCheck()
  }

  /**
   * Set game mode
   */
  setGameMode(mode: string): void {
    const state = this.stateManager.getState()
    if (!state) return

    const newState: GameState = { ...state, gameMode: mode as any }
    this.stateManager.setInitialState(newState)

    this.broadcast({
      type: 'SET_GAME_MODE',
      senderId: this.connectionManager.getPeerId(),
      data: { mode },
      timestamp: Date.now()
    })

    this.gameLogger.logAction('GAME_MODE_CHANGED', { mode })
  }

  /**
   * Set game privacy
   */
  setGamePrivacy(isPrivate: boolean): void {
    const state = this.stateManager.getState()
    if (!state) return

    const newState: GameState = { ...state, isPrivate }
    this.stateManager.setInitialState(newState)

    this.broadcast({
      type: 'SET_GAME_PRIVACY',
      senderId: this.connectionManager.getPeerId(),
      data: { isPrivate },
      timestamp: Date.now()
    })

    this.gameLogger.logAction('PRIVACY_CHANGED', { isPrivate })
  }

  /**
   * Assign teams
   */
  assignTeams(assignments: Record<string, number[]>): void {
    const state = this.stateManager.getState()
    if (!state) return

    const updatedPlayers = state.players.map(p => {
      let teamId = p.teamId || 1
      for (const [team, playerIds] of Object.entries(assignments)) {
        const ids = playerIds as number[]
        if (ids.includes(p.id)) {
          teamId = parseInt(team)
          break
        }
      }
      return { ...p, teamId }
    })

    const newState: GameState = { ...state, players: updatedPlayers }
    this.stateManager.setInitialState(newState)

    this.broadcast({
      type: 'ASSIGN_TEAMS',
      senderId: this.connectionManager.getPeerId(),
      data: { assignments },
      timestamp: Date.now()
    })

    this.gameLogger.logAction('TEAMS_ASSIGNED', { assignments })
  }

  // ==================== Events ====================

  /**
   * Subscribe to events
   */
  on(eventHandler: (event: any) => void): () => void {
    return this.connectionManager.on(eventHandler)
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    logger.info('[HostManager] Cleaning up...')

    this.gameLogger.cleanup()
    this.timerSystem.cleanup()
    this.stateManager.cleanup()
    this.connectionManager.cleanup()

    this.initialized = false
    this.localPlayerId = null
  }
}

// Singleton instance
let hostManagerInstance: HostManager | null = null

export const getHostManager = (config?: HostManagerConfig): HostManager => {
  if (!hostManagerInstance) {
    hostManagerInstance = new HostManager(config)
  }
  return hostManagerInstance
}

export const cleanupHostManager = (): void => {
  if (hostManagerInstance) {
    hostManagerInstance.cleanup()
    hostManagerInstance = null
  }
}
