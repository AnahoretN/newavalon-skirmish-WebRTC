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

import type { GameState, StateDelta, HighlightData, FloatingTextData, TargetingModeData, AbilityAction } from '../types'
import type { HostConfig, WebrtcEvent } from './types'
import { HostConnectionManager } from './HostConnectionManager'
import { HostStateManager } from './HostStateManager'
import { VisualEffectsManager } from './VisualEffects'
import { TimerSystem, TIMER_CONFIG } from './TimerSystem'
import { GameLogger } from './GameLogger'
import { saveHostData, saveWebrtcState, clearWebrtcData } from './WebrtcStatePersistence'
import { logger } from '../utils/logger'
import { PLAYER_COLOR_NAMES } from '../constants'
import { DeckType } from '../types'
import { createDeck } from '../hooks/core/gameCreators'
import { getCardDefinition } from '../content'
import { calculateValidTargets } from '@shared/utils/targeting'
import { decodePhaseAction, parsePhaseMessage } from './phase/PhaseMessageCodec'

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

  // Phase system (initialized via HostPhaseIntegration)
  public _phaseManager?: any
  public _phaseSyncManager?: any

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
      {
        const guest = this.connectionManager.getGuest(event.data.peerId)
        if (guest && guest.playerId) {
          this.handlePlayerDisconnect(guest.playerId, event.data.peerId)
        }
      }
        break
    }
  }

  /**
   * Handle player disconnect
   */
  private handlePlayerDisconnect(playerId: number, peerId: string): void {
    const state = this.stateManager.getState()
    if (!state) {return}

    // Mark player as disconnected
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, isDisconnected: true } : p
    )

    const newState: GameState = {
      ...state,
      players: updatedPlayers
    }

    this.stateManager.setInitialState(newState)

    // Mark player as in reconnection window (30 seconds)
    this.connectionManager.markPlayerReconnecting(playerId, peerId)

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

    logger.info(`[HostManager] Player ${playerId} disconnected, reconnection window open for 30s`)
  }

  /**
   * Handle player reconnect
   */
  handlePlayerReconnect(playerId: number, _peerId: string): void {
    const state = this.stateManager.getState()
    if (!state) {return}

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
    if (!state) {return}

    // Convert player to dummy - dummy players are always ready and have auto-draw enabled
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, isDummy: true, isDisconnected: true, isReady: true, autoDrawEnabled: true } : p
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
    if (!message || !message.type) {
      logger.warn('[HostManager] Received invalid message:', message)
      return
    }

    // Ignore messages from host (loopback prevention)
    const hostPeerId = this.connectionManager.getPeerId()
    if (message.senderId === hostPeerId || fromPeerId === hostPeerId) {
      logger.debug(`[HostManager] Ignoring loopback message from self: ${message.type}`)
      return
    }

    const guest = this.connectionManager.getGuest(fromPeerId)
    const guestPlayerId = guest?.playerId || message.playerId

    // Detailed logging for targeting mode messages
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
      logger.info(`[HostManager] Received ${message.type} from ${fromPeerId} (player ${guestPlayerId})`, {
        hasData: !!message.data,
        hasTargetingMode: !!message.data?.targetingMode,
        targetingModePlayerId: message.data?.targetingMode?.playerId,
        mode: message.data?.targetingMode?.action?.mode,
        boardTargetsCount: message.data?.targetingMode?.boardTargets?.length || 0,
        handTargetsCount: message.data?.targetingMode?.handTargets?.length || 0
      })
    } else {
      logger.info(`[HostManager] Received ${message.type} from ${fromPeerId} (player ${guestPlayerId})`)
    }

    // Reset inactivity timer on any message
    if (this.config.enableTimers !== false) {
      this.timerSystem.resetInactivityTimer()
    }

    switch (message.type) {
      case 'JOIN_REQUEST':
        this.handleJoinRequest(fromPeerId, message.data)
        break

      case 'RECONNECT_REQUEST':
        this.handleReconnectRequest(fromPeerId, message.data)
        break

      case 'PLAYER_READY':
        if (guestPlayerId) {
          this.stateManager.setPlayerReady(guestPlayerId, true)
          this.gameLogger.logAction('PLAYER_READY', {}, guestPlayerId)
        }
        break

      case 'CHANGE_PLAYER_DECK':
        if (guestPlayerId && message.data) {
          this.handleChangePlayerDeck(guestPlayerId, message.data, fromPeerId)
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

      case 'STATE_UPDATE_COMPACT':
        // Guest sends compact state (with card IDs) for efficiency
        // This is the main way guests sync their state changes (like score)
        if (message.data?.gameState && guestPlayerId !== undefined) {
          const finalState = this.stateManager.updateFromGuest(guestPlayerId, message.data.gameState, fromPeerId)
          // CRITICAL: Call onStateUpdate to update host's React state
          // This is especially important when guestCompletedScoringStep triggers a turn pass
          if (finalState && this.config.onStateUpdate) {
            this.config.onStateUpdate(finalState)
          }
        }
        break

      case 'DECK_DATA_UPDATE':
        // Guest sends their full deck data to host (for deck view feature)
        // Host broadcasts this data to other guests so they can view the deck
        if (guestPlayerId && message.data?.deck) {
          this.handleDeckDataUpdate(guestPlayerId, message.data, fromPeerId)
        }
        break

      case 'REQUEST_GAME_RESET':
        // Guest requests game reset from host
        logger.info('[HostManager] Guest requested game reset')
        this.resetGame()
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
          // Update host's internal state and broadcast to all guests (excluding sender)
          this.stateManager.setTargetingMode(message.data.targetingMode, fromPeerId)
          // Also update host's UI
          const currentState = this.stateManager.getState()
          if (currentState && this.config.onStateUpdate) {
            this.config.onStateUpdate(currentState)
          }
        }
        break

      case 'CLEAR_TARGETING_MODE':
        // Update host's internal state and broadcast to all guests (excluding sender)
        logger.info(`[HostManager] Processing CLEAR_TARGETING_MODE from ${fromPeerId} (player ${guestPlayerId})`)
        this.stateManager.clearTargetingMode(fromPeerId)
        // Also update host's UI
        const currentStateForClear = this.stateManager.getState()
        if (currentStateForClear && this.config.onStateUpdate) {
          this.config.onStateUpdate(currentStateForClear)
        }
        break

      // NEW: ID-based visual effects messages
      case 'EFFECT_ADD':
        // Guest sent an effect to add - rebroadcast to all guests (excluding sender)
        if (message.data) {
          logger.debug(`[HostManager] EFFECT_ADD from ${fromPeerId}:`, message.data)
          this.connectionManager.broadcast({
            type: 'EFFECT_ADD',
            senderId: this.connectionManager.getPeerId(),
            data: message.data,
            timestamp: Date.now()
          }, fromPeerId) // Exclude sender
        }
        break

      case 'EFFECT_REMOVE':
        // Guest sent an effect to remove - rebroadcast to all guests (excluding sender)
        if (message.data) {
          logger.debug(`[HostManager] EFFECT_REMOVE from ${fromPeerId}:`, message.data)
          this.connectionManager.broadcast({
            type: 'EFFECT_REMOVE',
            senderId: this.connectionManager.getPeerId(),
            data: message.data,
            timestamp: Date.now()
          }, fromPeerId) // Exclude sender
        }
        break

      case 'EFFECT_CLEAR_ALL':
        // Guest requested to clear all effects - rebroadcast to all
        this.connectionManager.broadcast({
          type: 'EFFECT_CLEAR_ALL',
          senderId: this.connectionManager.getPeerId(),
          timestamp: Date.now()
        })
        break

      // Ability activation messages
      case 'ABILITY_ACTIVATED':
        if (message.data) {
          this.handleAbilityActivated(message.data, guestPlayerId, fromPeerId)
        }
        break

      case 'ABILITY_MODE_SET':
        // Set ability mode and rebroadcast to all guests
        if (message.data?.abilityMode) {
          logger.info('[HostManager] ABILITY_MODE_SET received from guest', {
            fromPeerId,
            guestPlayerId,
            mode: message.data.abilityMode.mode,
            boardTargetsCount: message.data.abilityMode.boardTargets?.length || 0,
            handTargetsCount: message.data.abilityMode.handTargets?.length || 0,
          })

          // Check if scoring mode is still active before broadcasting
          const currentState = this.stateManager.getState()
          if (currentState) {
            const isScoringMode = message.data.abilityMode.mode === 'SCORE_LAST_PLAYED_LINE'

            // Don't broadcast SCORING mode if isScoringStep is false
            if (isScoringMode && !currentState.isScoringStep) {
              logger.info('[HostManager] Ignoring ABILITY_MODE_SET for SCORING mode - isScoringStep is false')
              break
            }

            // Update host's internal state with both abilityMode and targetingMode
            const abilityModeData = message.data.abilityMode
            const newState = {
              ...currentState,
              abilityMode: abilityModeData,
              targetingMode: abilityModeData.boardTargets ? {
                playerId: abilityModeData.playerId || currentState.activePlayerId,
                action: { type: 'ENTER_MODE', mode: abilityModeData.mode },
                sourceCoords: abilityModeData.sourceCoords,
                timestamp: abilityModeData.timestamp || Date.now(),
                boardTargets: abilityModeData.boardTargets,
                handTargets: abilityModeData.handTargets,
              } : currentState.targetingMode,
            }
            const actualState = this.stateManager.setInitialState(newState)
            // Update host's UI with the actual state
            if (this.config.onStateUpdate && actualState) {
              this.config.onStateUpdate(actualState)
            }
          }

          // Broadcast to all OTHER guests (exclude sender to prevent echo)
          const successCount = this.connectionManager.broadcast({
            type: 'ABILITY_MODE_SET',
            senderId: this.connectionManager.getPeerId(),
            data: { abilityMode: message.data.abilityMode },
            timestamp: Date.now()
          }, fromPeerId) // Exclude the original sender
          logger.info(`[HostManager] Broadcast ABILITY_MODE_SET to ${successCount} other guests`)
        }
        break

      case 'ABILITY_TARGET_SELECTED':
        // Rebroadcast target selection to all guests WITH click wave effect
        if (message.data) {
          const { targetCoords, playerId } = message.data

          // First broadcast the target selection
          this.connectionManager.broadcast({
            type: 'ABILITY_TARGET_SELECTED',
            senderId: this.connectionManager.getPeerId(),
            data: message.data,
            timestamp: Date.now()
          })

          // Then broadcast click wave effect for visual feedback
          if (targetCoords) {
            const state = this.stateManager.getState()
            const player = state?.players.find(p => p.id === playerId)
            const wave = {
              timestamp: Date.now(),
              location: 'board',
              boardCoords: targetCoords,
              clickedByPlayerId: playerId,
              playerColor: player?.color || '#ffffff'
            }

            this.connectionManager.broadcast({
              type: 'CLICK_WAVE_TRIGGERED',
              senderId: this.connectionManager.getPeerId(),
              data: wave,
              timestamp: Date.now()
            })

            logger.info(`[HostManager] Player ${playerId} selected target at (${targetCoords.row}, ${targetCoords.col})`)
          }
        }
        break

      case 'ABILITY_COMPLETED':
        // Rebroadcast ability completion to all guests and clear targeting mode
        if (message.data) {
          this.connectionManager.broadcast({
            type: 'ABILITY_COMPLETED',
            senderId: this.connectionManager.getPeerId(),
            data: message.data,
            timestamp: Date.now()
          })

          // Clear targeting mode AND abilityMode on host
          const state = this.stateManager.getState()
          if (state) {
            const newState: GameState = {
              ...state,
              targetingMode: null,
              abilityMode: undefined
            }
            this.stateManager.setInitialState(newState)
            // Update host's UI
            if (this.config.onStateUpdate) {
              this.config.onStateUpdate(newState)
            }
          }
          logger.info('[HostManager] ABILITY_COMPLETED - cleared abilityMode and targetingMode')
        }
        break

      case 'ABILITY_CANCELLED':
        // Guest cancelled ability mode - update host's internal state
        // DO NOT rebroadcast CLEAR_TARGETING_MODE - it creates a loop
        // The guest who cancelled already knows, and other guests don't need
        // to be notified about individual guest cancellations
        const state = this.stateManager.getState()
        if (state) {
          const newState: GameState = {
            ...state,
            targetingMode: null,
          }
          this.stateManager.setInitialState(newState)

          // Update host's UI to sync the state change
          // This ensures the host's React state (including abilityMode) is updated
          if (this.config.onStateUpdate) {
            this.config.onStateUpdate(newState)
          }
        }
        break

      case 'SCORING_LINE_SELECTED':
        // Guest selected a scoring line - host processes it and broadcasts result
        if (message.data) {
          const { sourceCoords, selectedCoords, mode } = message.data
          logger.info('[HostManager] Guest selected scoring line', { guestPlayerId, sourceCoords, selectedCoords, mode })

          this.handleScoringLineSelection(message.data, guestPlayerId, fromPeerId)
        }
        break

      case 'REQUEST_PASS_TURN':
        // Guest requests to pass turn after scoring
        // Host uses phase manager to properly transition to next player with Preparation phase
        if (guestPlayerId === undefined) {
          logger.warn('[HostManager] No player ID for pass turn request')
          break
        }

        const stateForPass = this.stateManager.getState()
        if (!stateForPass) {
          logger.warn('[HostManager] No game state for pass turn')
          break
        }

        // Verify the requesting player is the active player
        if (stateForPass.activePlayerId !== guestPlayerId) {
          logger.warn(`[HostManager] Player ${guestPlayerId} requested pass turn but active player is ${stateForPass.activePlayerId}`)
          break
        }

        logger.info(`[HostManager] Guest ${guestPlayerId} requested pass turn`)

        // Use phase manager to pass turn (includes Preparation phase for next player)
        if ((this as any)._phaseManager) {
          try {
            // CRITICAL: Update phase manager state before handling action
            (this as any)._phaseManager.setState(stateForPass)

            const result = (this as any)._phaseManager.handleAction({
              action: 'PASS_TURN',
              playerId: guestPlayerId,
              data: { reason: 'scoring_complete' }
            })
            if (result) {
              logger.info('[HostManager] Phase manager passed turn after guest scoring', result)
            }
          } catch (error) {
            logger.error('[HostManager] Error passing turn via phase manager:', error)
          }
        }
        break

      case 'ABILITY_MODE_CLEAR':
        // Ability mode clear - specifically for closing scoring mode after completion
        // This is broadcast by host after scoring is done to close all guests' scoring modes
        this.visualEffects.clearTargetingMode()

        // Clear ability mode and set isScoringStep=false on host state
        const stateForClear = this.stateManager.getState()
        if (stateForClear) {
          const newState: GameState = {
            ...stateForClear,
            abilityMode: undefined,
            targetingMode: null,
            isScoringStep: false  // Important: mark scoring as complete
          }
          this.stateManager.setInitialState(newState)
          // Update host's UI
          if (this.config.onStateUpdate) {
            this.config.onStateUpdate(newState)
          }
          // Broadcast to all guests (if sent by a guest, rebroadcast to everyone)
          this.connectionManager.broadcast({
            type: 'ABILITY_MODE_CLEAR',
            senderId: this.connectionManager.getPeerId(),
            timestamp: Date.now(),
            data: {
              isScoringStep: false
            }
          })
          logger.info('[HostManager] ABILITY_MODE_CLEAR - cleared abilityMode and set isScoringStep=false')
        }
        break

      // Phase system messages
      case 'PHASE_STATE_UPDATE':
      case 'PHASE_TRANSITION':
      case 'TURN_CHANGE':
      case 'ROUND_END':
      case 'MATCH_END':
      case 'SCORING_MODE_START':
      case 'SCORING_MODE_COMPLETE':
      case 'PHASE_ACTION_REQUEST':
        // Forward to phase system if initialized
        if ((this as any)._phaseManager && (this as any)._phaseSyncManager) {
          this.handlePhaseMessage(message, fromPeerId)
        } else {
          logger.debug(`[HostManager] Phase system not initialized, ignoring ${message.type}`)
        }
        break

      case 'RESET_GAME':
      case 'GAME_RESET':
        // Reset game to lobby state (keeps players and decks)
        logger.info('[HostManager] Received RESET_GAME request')
        this.handleResetGame()
        break

      default:
        logger.debug(`[HostManager] Unhandled message type: ${message.type}`)
        break
    }
  }

  /**
   * Handle phase-related message from guest
   * DELEGATES TO PhaseManager for proper phase management
   */
  private handlePhaseMessage(message: any, fromPeerId: string): void {
    try {
      // Decode the phase action from binary message
      const binaryData = parsePhaseMessage(message)
      const phaseAction = decodePhaseAction(binaryData)

      if (!phaseAction) {
        logger.warn('[HostManager] Invalid phase action message')
        return
      }

      // Get player ID from guest connection
      const guest = this.connectionManager.getGuest(fromPeerId)
      if (!guest || !guest.playerId) {
        logger.warn('[HostManager] Unknown peer for phase action:', fromPeerId)
        return
      }

      const playerId = guest.playerId

      // Delegate to handlePhaseAction which uses PhaseManager
      this.handlePhaseAction(phaseAction.action, playerId, phaseAction.data)
    } catch (e) {
      logger.error('[HostManager] Failed to handle phase message:', e)
    }
  }

  /**
   * Public method to handle phase action (for host's own actions)
   * Called by usePhaseActions when host clicks phase buttons
   * Any player can change phases at any time
   */
  handlePhaseAction(actionType: number, playerId: number, data?: any): void {
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] handlePhaseAction: No state')
      return
    }

    logger.info(`[HostManager] handlePhaseAction called: actionType=${actionType}, playerId=${playerId}, currentPhase=${state.currentPhase}, activePlayerId=${state.activePlayerId}`)

    // Map actionType to PhaseManager action string
    const actionMap: Record<number, string> = {
      1: 'NEXT_PHASE',
      2: 'PREVIOUS_PHASE',
      3: 'PASS_TURN',
      4: 'START_SCORING',
      5: 'SELECT_LINE',
      6: 'ROUND_COMPLETE',
      7: 'START_NEXT_ROUND',
      8: 'START_NEW_MATCH',
    }

    const action = actionMap[actionType]

    // Use PhaseManager for all phase actions
    if ((this as any)._phaseManager) {
      try {
        // Update phase manager state before handling action
        ;(this as any)._phaseManager.setState(state)

        const result = (this as any)._phaseManager.handleAction({
          action,
          playerId,
          data
        })

        if (result && result.success) {
          logger.info(`[HostManager] PhaseManager handled ${action}: phase=${result.newPhase}, activePlayer=${result.newActivePlayer}`)
          // PhaseManager already broadcasted state via onStateUpdateRequired callback
          return
        }
      } catch (error) {
        logger.error('[HostManager] Error in PhaseManager:', error)
      }
    } else {
      logger.warn('[HostManager] PhaseManager not initialized, phase action ignored')
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
          const finalState = this.stateManager.updateFromGuest(guestPlayerId, actionData.gameState, fromPeerId)
          // CRITICAL: Call onStateUpdate to update host's React state
          if (finalState && this.config.onStateUpdate) {
            this.config.onStateUpdate(finalState)
          }
        }
        break

      case 'STATE_DELTA':
        if (actionData?.delta) {
          this.stateManager.applyDeltaFromGuest(guestPlayerId, actionData.delta, fromPeerId)
        }
        break

      case 'DECK_DATA_UPDATE':
        // Guest sends their full deck data to host
        // This is sent as an ACTION from guest, handle it here
        if (actionData?.deck) {
          logger.info(`[handleAction] DECK_DATA_UPDATE: Received ${actionData.deck?.length || 0} cards for guest ${guestPlayerId}`)
          this.handleDeckDataUpdate(guestPlayerId, actionData, fromPeerId)
        }
        break

      default:
        logger.debug(`[HostManager] Unhandled action type: ${actionType}`)
        break
    }
  }

  /**
   * Handle turn pass request from guest
   * Called when guest has no cards on board or wants to auto-pass turn (e.g., after scoring)
   */
  /**
   * Handle player deck change
   *
   * IMPORTANT RULE: Host is the single source of truth for dummy player decks.
   * - For dummy players: Host ALWAYS creates the deck, regardless of what guest sends
   * - For real players: Host uses the deck data provided by guest
   */
  private handleChangePlayerDeck(playerId: number, deckData: any, _fromPeerId: string): void {
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No state for deck change')
      return
    }

    const { deckType, deck: receivedDeck } = deckData
    const targetPlayer = state.players.find(p => p.id === playerId)
    if (!targetPlayer) {
      logger.warn(`[HostManager] Player ${playerId} not found for deck change`)
      return
    }

    const isDummy = targetPlayer.isDummy || false
    let finalDeck: any[] = []
    let compactDeckForBroadcast: any[] = []

    // Debug logging
    logger.info(`[HostManager] handleChangePlayerDeck: playerId=${playerId}, deckType=${deckType}, isDummy=${isDummy}, receivedDeck=${Array.isArray(receivedDeck)}, deckLength=${receivedDeck?.length || 0}`)

    // For dummy players, ALWAYS create deck on host (ignore guest's deck data)
    // For real players, use deck data from guest if provided
    if (isDummy || !receivedDeck || !Array.isArray(receivedDeck) || receivedDeck.length === 0) {
      // Create deck locally on host
      logger.info(`[HostManager] Creating deck locally for player ${playerId}: ${deckType}`)
      finalDeck = createDeck(deckType, playerId, targetPlayer.name)

      // Create compact version for broadcast (only essential data)
      compactDeckForBroadcast = finalDeck.map(card => ({
        id: card.id,
        baseId: card.baseId,
        power: card.power,
        powerModifier: card.powerModifier || 0,
        isFaceDown: card.isFaceDown || false,
        statuses: card.statuses || []
      }))

      logger.info(`[HostManager] Created deck for ${isDummy ? 'dummy' : 'real'} player ${playerId}: ${deckType}, ${finalDeck.length} cards`)
    } else {
      // Use deck data from guest (real player with custom deck data)

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

      logger.info(`[HostManager] Used guest's deck data for real player ${playerId}: ${deckType}, ${finalDeck.length} cards`)
    }

    // Update the player's deck
    // CRITICAL: If game has already started, don't clear hand/discard
    const gameStarted = state.isGameStarted
    this.stateManager.updatePlayerProperty(playerId, {
      selectedDeck: deckType,
      deck: finalDeck,
      ...(gameStarted ? {} : {
        hand: [],
        discard: [],
        announcedCard: null,
        boardHistory: []
      })
    })

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
    })

    this.gameLogger.logAction('DECK_CHANGED', {
      deckType
    }, playerId)
  }

  /**
   * Handle deck data update from guest (for deck view feature)
   * Guest opens deck view for another player -> sends their deck to host
   * Host broadcasts this to all guests so they can view the deck
   */
  private handleDeckDataUpdate(playerId: number, deckData: any, fromPeerId: string): void {
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No state for deck data update')
      return
    }

    const { deck: receivedDeck, deckSize } = deckData
    const targetPlayer = state.players.find(p => p.id === playerId)
    if (!targetPlayer) {
      logger.warn(`[HostManager] Player ${playerId} not found for deck data update`)
      return
    }

    // DECK_DATA_UPDATE is used for deck view feature
    // Auto-draw now works through updateState mechanism (like clicking deck)
    // Only update deck if hand is still empty or game not started
    const shouldUpdateDeck = !state.isGameStarted || targetPlayer.hand.length === 0

    if (shouldUpdateDeck) {
      // Use updatePlayerProperty to avoid race conditions with startGame
      this.stateManager.updatePlayerProperty(playerId, {
        deck: receivedDeck || [],
        selectedDeck: targetPlayer.selectedDeck // Preserve selectedDeck
      })
      logger.info(`[HostManager] Updated player ${playerId} deck in state: ${receivedDeck?.length || 0} cards`)
    } else {
      logger.warn(`[HostManager] Skipped deck update for player ${playerId}: game started and player already has ${targetPlayer.hand.length} cards`)
    }

    // Broadcast deck data to ALL other guests (excluding sender)
    // This allows guests to view each other's decks in the deck view modal
    this.connectionManager.broadcast({
      type: 'DECK_DATA_UPDATE',
      senderId: this.connectionManager.getPeerId(),
      playerId,
      data: {
        playerId,
        deck: receivedDeck,
        deckSize: deckSize || receivedDeck?.length || 0
      },
      timestamp: Date.now()
    }, fromPeerId) // Exclude sender since they already have their own deck

    logger.info(`[HostManager] Broadcasted deck data for player ${playerId}: ${receivedDeck?.length || 0} cards`)
  }

  /**
   * Handle game reset request
   * Resets game to lobby state but keeps players and their selected decks
   */
  private handleResetGame(): void {
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No game state for reset')
      return
    }

    logger.info('[HostManager] Resetting game to lobby state')

    // Reset game state but keep players and their decks
    const resetState: Partial<GameState> = {
      isGameStarted: false,
      isRoundEndModalOpen: false,
      currentPhase: 0, // Preparation phase
      currentRound: 1,
      turnNumber: 0,
      activePlayerId: null,
      startingPlayerId: null,
      gameWinner: null,
      roundWinners: {},
      isScoringStep: false,
      abilityMode: undefined,
      targetingMode: null,
      board: state.board.map(row => row.map(cell => ({
        ...cell,
        card: null
      }))),
      // Reset players but keep their deck and selectedDeck
      players: state.players.map(p => ({
        ...p,
        score: 0,
        hand: [],
        discard: [],
        announcedCard: null,
        boardHistory: [],
        isReady: false,
        // Keep: deck, selectedDeck, name, color, id
      })),
      // Clear visual effects
      highlights: [],
      floatingTexts: [],
      deckSelections: [],
      handCardSelections: [],
    }

    // Merge with current state
    const newState = { ...state, ...resetState }
    this.stateManager.setInitialState(newState)

    // Broadcast reset to all guests
    this.connectionManager.broadcast({
      type: 'GAME_RESET',
      senderId: this.connectionManager.getPeerId(),
      data: resetState,
      timestamp: Date.now()
    })

    // Update host's UI
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(newState)
    }

    this.gameLogger.logAction('GAME_RESET', {}, 0)
    logger.info('[HostManager] Game reset to lobby state')
  }

  /**
   * Handle ability activation from guest
   * Guest activates ability -> Host broadcasts ability mode to all clients
   *
   * SPECIAL CASE: Scoring abilities (SCORE_LAST_PLAYED_LINE, etc.)
   * When in Scoring phase (4) and guest selects a scoring line, process it directly
   */
  private handleAbilityActivated(data: any, guestPlayerId: number | undefined, _fromPeerId: string): void {
    if (guestPlayerId === undefined) {
      logger.warn('[HostManager] No player ID for ability activation')
      return
    }

    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No game state for ability activation')
      return
    }

    // Verify it's this player's turn
    // NOTE: For dummy players, allow any guest to activate
    const player = state.players.find(p => p.id === guestPlayerId)
    const isDummy = player?.isDummy || false
    if (state.activePlayerId !== guestPlayerId && !isDummy) {
      logger.warn(`[HostManager] Player ${guestPlayerId} tried to activate ability but it's player ${state.activePlayerId}'s turn`)
      return
    }

    // Find the card and verify it exists
    const { coords, cardId, cardName, abilityType: _abilityType, action, boardTargets, handTargets, mode } = data
    const card = state.board[coords.row]?.[coords.col]?.card
    if (!card) {
      logger.warn(`[HostManager] No card at coords (${coords.row}, ${coords.col})`)
      return
    }
    if (card.ownerId !== guestPlayerId) {
      logger.warn(`[HostManager] Player ${guestPlayerId} tried to activate card owned by ${card.ownerId}`)
      return
    }

    // SPECIAL CASE: Scoring line selection in Scoring phase
    // Modes like: SCORE_LAST_PLAYED_LINE, INTEGRATOR_LINE_SELECT, ZIUS_LINE_SELECT, IP_AGENT_THREAT_SCORING
    const isScoringMode = mode && (
      mode === 'SCORE_LAST_PLAYED_LINE' ||
      mode === 'INTEGRATOR_LINE_SELECT' ||
      mode === 'ZIUS_LINE_SELECT' ||
      mode === 'IP_AGENT_THREAT_SCORING' ||
      mode.includes('SCORING') ||
      mode.includes('LINE_SELECT')
    )

    if (isScoringMode && state.currentPhase === 4 && state.isScoringStep) {
      logger.info(`[HostManager] Player ${guestPlayerId} selected scoring line with mode: ${mode}, data:`, data)

      // For scoring in WebRTC mode, we need to:
      // 1. Score the line (add points to player)
      // 2. Clear isScoringStep
      // 3. Pass turn to next player

      // Process scoring - update player score based on line
      // For now, we'll pass the turn since the actual scoring should be handled by the guest's local state
      // and synced via STATE_UPDATE_COMPACT

      // Clear scoring step - turn passing logic removed
      let updatedState = {
        ...state,
        isScoringStep: false
      }

      // Update host state
      this.stateManager.setInitialState(updatedState)

      // Broadcast to all guests
      this.connectionManager.broadcast({
        type: 'SCORING_MODE_COMPLETE',
        senderId: this.connectionManager.getPeerId(),
        data: {
          activePlayerId: updatedState.activePlayerId,
          currentPhase: updatedState.currentPhase
        },
        timestamp: Date.now()
      })

      // Call onStateUpdate to update host's React state
      if (this.config.onStateUpdate) {
        this.config.onStateUpdate(updatedState)
      }

      logger.info(`[HostManager] Scoring complete, passed turn to player ${updatedState.activePlayerId}`)
      return
    }

    // Calculate valid targets if not provided by guest
    let finalBoardTargets = boardTargets
    if (!finalBoardTargets && action) {
      try {
        finalBoardTargets = calculateValidTargets(action, state, guestPlayerId)
      } catch (e) {
        logger.warn('[HostManager] Failed to calculate targets:', e)
        finalBoardTargets = []
      }
    }

    // Build targeting mode data for state
    const targetingModeData = {
      playerId: guestPlayerId,
      action: action || { type: 'ENTER_MODE' as const, mode: mode || 'SELECT_TARGET' },
      sourceCoords: coords,
      timestamp: Date.now(),
      boardTargets: finalBoardTargets || [],
      handTargets: handTargets || []
    }

    // Update host's targeting mode state
    const newState: GameState = {
      ...state,
      targetingMode: targetingModeData
    }
    this.stateManager.setInitialState(newState)

    // Broadcast ability mode with targeting info to all guests
    const abilityMode: any = {
      playerId: guestPlayerId,
      sourceCardId: cardId,
      sourceCardName: cardName || card.name,
      sourceCoords: coords,
      mode: mode || 'SELECT_TARGET',
      actionType: action?.payload?.actionType || data.actionType,
      boardTargets: finalBoardTargets || [],
      handTargets: handTargets || [],
      timestamp: Date.now()
    }

    this.connectionManager.broadcast({
      type: 'ABILITY_MODE_SET',
      senderId: this.connectionManager.getPeerId() ?? undefined,
      data: { abilityMode },
      timestamp: Date.now()
    })

    logger.info(`[HostManager] Player ${guestPlayerId} activated ${cardName} ability: ${mode}, targets: ${finalBoardTargets?.length || 0}`)
  }

  /**
   * Handle scoring line selection from guest
   * Guest calculated their score locally and sent the result
   * Host validates and broadcasts the score update to all guests
   */
  private handleScoringLineSelection(data: any, guestPlayerId: number | undefined, _fromPeerId: string): void {
    if (guestPlayerId === undefined) {
      logger.warn('[HostManager] No player ID for scoring line selection')
      return
    }

    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No game state for scoring')
      return
    }

    // Verify we're in scoring phase
    if (!state.isScoringStep || state.currentPhase !== 4) {
      logger.warn('[HostManager] Not in scoring phase, ignoring line selection')
      return
    }

    const { sourceCoords, selectedCoords, newScore, scoreEvents } = data
    if (!sourceCoords || !selectedCoords) {
      logger.warn('[HostManager] Invalid coords for scoring line selection')
      return
    }

    // Use the new total score from the guest (guest calculated it themselves)
    const player = state.players.find(p => p.id === guestPlayerId)
    if (!player) {
      logger.warn('[HostManager] Player not found for scoring')
      return
    }

    const oldScore = player.score
    logger.info(`[HostManager] Guest ${guestPlayerId} score: ${oldScore} -> ${newScore}`)

    // Broadcast floating texts to all guests
    if (scoreEvents && scoreEvents.length > 0) {
      const now = Date.now()
      const floatingTexts: FloatingTextData[] = scoreEvents.map((event: any) => ({
        ...event,
        timestamp: now
      }))
      this.visualEffects.broadcastFloatingTextBatch(floatingTexts)
    }

    // Clear targeting mode on host
    this.visualEffects.clearTargetingMode()

    // Update player score with the new total score from guest (not adding delta)
    const updatedPlayers = state.players.map(p =>
      p.id === guestPlayerId ? { ...p, score: newScore } : p
    )
    const updatedState: GameState = {
      ...state,
      players: updatedPlayers,
      abilityMode: undefined,  // Clear ability mode on host too
      targetingMode: null
    }
    this.stateManager.setInitialState(updatedState)
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(updatedState)
    }
    // CRITICAL: Broadcast the updated state to all guests so they see the score change
    this.connectionManager.broadcastGameState(updatedState)

    // Broadcast ABILITY_MODE_CLEARED to all guests to close scoring mode
    this.connectionManager.broadcast({
      type: 'ABILITY_MODE_CLEARED',
      senderId: this.connectionManager.getPeerId(),
      timestamp: Date.now(),
      data: {
        mode: 'SCORE_LAST_PLAYED_LINE',
        playerId: guestPlayerId,
        newScore,
        scoreEvents
      }
    })

    // Note: Turn passing is now handled by the guest sending REQUEST_PASS_TURN
    // This allows the guest to control when to pass turn after updating their score
    logger.info(`[HostManager] Scoring complete for guest ${guestPlayerId}, waiting for REQUEST_PASS_TURN`)
  }

  /**
   * Handle guest join request
   */
  private handleJoinRequest(guestPeerId: string, joinData?: any): void {
    const currentState = this.stateManager.getState()
    if (!currentState) {
      logger.error('[HostManager] No game state, cannot accept guest')
      return
    }

    // Get guest's preferred deck from join request
    const preferredDeck = joinData?.preferredDeck || DeckType.Random
    logger.info(`[HostManager] JOIN_REQUEST from ${guestPeerId}, preferredDeck: ${preferredDeck}`)

    // Find next available player ID
    const existingPlayerIds = currentState.players.map(p => p.id)
    let newPlayerId = 1
    while (existingPlayerIds.includes(newPlayerId)) {
      newPlayerId++
    }

    // Create new player with their preferred deck
    // CRITICAL: Create the deck on host so host has full card data
    const playerDeck = createDeck(preferredDeck, newPlayerId, `Player ${newPlayerId}`)

    const newPlayer = {
      id: newPlayerId,
      name: `Player ${newPlayerId}`,
      color: PLAYER_COLOR_NAMES[(newPlayerId - 1) % PLAYER_COLOR_NAMES.length],
      hand: [],
      deck: playerDeck,
      discard: [],
      announcedCard: null,
      score: 0,
      isDummy: false,
      isReady: false,
      selectedDeck: preferredDeck,
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

    // CRITICAL: Broadcast updated state to ALL existing guests so they see the new player
    this.connectionManager.broadcastGameState(newState, guestPeerId)

    // Also send PLAYER_CONNECTED event for consistency
    this.connectionManager.broadcastPlayerConnected(newPlayerId, newPlayer.name, guestPeerId)

    // Log player join
    this.gameLogger.logAction('PLAYER_JOINED', { playerId: newPlayerId }, newPlayerId)

    // Notify callback
    if (this.config.onPlayerJoin) {
      this.config.onPlayerJoin(newPlayerId, guestPeerId)
    }

    logger.info(`[HostManager] Added player ${newPlayerId} for guest ${guestPeerId}, broadcasted to existing guests`)
  }

  /**
   * Handle reconnection request from guest
   */
  private handleReconnectRequest(guestPeerId: string, data: any): void {
    const requestedPlayerId = data?.playerId
    const currentState = this.stateManager.getState()

    if (!currentState) {
      logger.error('[HostManager] No game state for reconnection')
      this.connectionManager.rejectPlayerReconnect(guestPeerId, 'timeout')
      return
    }

    // Check if player exists and is in reconnection window
    if (requestedPlayerId === undefined || requestedPlayerId === null) {
      // No specific player ID - treat as new join
      logger.info(`[Reconnection] No playerId specified, treating as new join`)
      this.handleJoinRequest(guestPeerId)
      return
    }

    const playerExists = currentState.players.some(p => p.id === requestedPlayerId)
    if (!playerExists) {
      logger.warn(`[Reconnection] Player ${requestedPlayerId} does not exist`)
      this.connectionManager.rejectPlayerReconnect(guestPeerId, 'timeout')
      return
    }

    // Check if player is in reconnection window
    if (!this.connectionManager.isPlayerReconnecting(requestedPlayerId)) {
      // Player exists but not marked as reconnecting - might be a new connection or expired
      logger.warn(`[Reconnection] Player ${requestedPlayerId} not in reconnection window`)
      // Still allow reconnection if the player exists
    }

    // Accept reconnection
    const success = this.connectionManager.acceptPlayerReconnect(
      guestPeerId,
      requestedPlayerId,
      currentState
    )

    if (success) {
      // Mark player as reconnected
      this.handlePlayerReconnect(requestedPlayerId, guestPeerId)

      // Broadcast to all players
      this.broadcast({
        type: 'PLAYER_RECONNECTED',
        senderId: this.connectionManager.getPeerId(),
        data: { playerId: requestedPlayerId },
        timestamp: Date.now()
      })
    } else {
      this.connectionManager.rejectPlayerReconnect(guestPeerId, 'timeout')
    }
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

      // Save host data for page reload recovery
      saveHostData({
        peerId,
        isHost: true
      })

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
    // Persist state for page reload recovery
    this.persistState()
  }

  /**
   * Set the game state (for local updates)
   */
  setGameState(state: GameState): void {
    this.stateManager.setInitialState(state)
    this.gameLogger.setGameState(state)
    this.timerSystem.setGameState(state)
    // Persist state for page reload recovery
    this.persistState()
  }

  /**
   * Persist current game state to localStorage for page reload recovery
   */
  private persistState(): void {
    const state = this.stateManager.getState()
    if (!state) {return}

    try {
      saveWebrtcState({
        gameState: state,
        localPlayerId: this.localPlayerId,
        isHost: true
      })
    } catch (e) {
      logger.warn('[HostManager] Failed to persist state:', e)
    }
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
  updateFromLocal(newState: GameState, excludePeerId?: string): void {
    const oldState = this.stateManager.getState()
    if (!oldState) {
      this.stateManager.setInitialState(newState)
      this.gameLogger.setGameState(newState)
      this.timerSystem.setGameState(newState)
      return
    }

    this.stateManager.updateFromLocal(newState, excludePeerId)
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
   * Update host player's score and broadcast to all guests
   * This is used when host scores points in scoring phase
   * The host calculates their own score and updates it directly (not adding delta)
   */
  updateHostPlayerScore(playerId: number, newScore: number): void {
    const state = this.stateManager.getState()
    if (!state) return

    const player = state.players.find(p => p.id === playerId)
    if (!player) return

    logger.info(`[HostManager] Updating host player ${playerId} score: ${player.score} -> ${newScore}`)

    // Update player score with new total (not adding delta)
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? { ...p, score: newScore } : p
    )
    const updatedState: GameState = {
      ...state,
      players: updatedPlayers
    }
    this.stateManager.setInitialState(updatedState)

    // Update host's UI
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(updatedState)
    }

    // Broadcast to all guests
    this.connectionManager.broadcastGameState(updatedState)
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
   * Alias for broadcast - for API compatibility with GuestConnectionManager
   */
  broadcastToGuests(message: any, excludePeerId?: string): number {
    return this.broadcast(message, excludePeerId)
  }

  /**
   * Broadcast state delta to all guests
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    this.connectionManager.broadcastStateDelta(delta, excludePeerId)
  }

  /**
   * Broadcast game state to all guests
   * Can be called with just excludePeerId (uses current state) or with explicit gameState
   */
  broadcastGameState(gameStateOrExcludePeerId?: GameState | string, excludePeerId?: string): void {
    // Check if first arg is a state object (has players array) or just excludePeerId
    if (gameStateOrExcludePeerId && typeof gameStateOrExcludePeerId !== 'string' && 'players' in gameStateOrExcludePeerId) {
      // Called with (gameState, excludePeerId)
      this.connectionManager.broadcastGameState(gameStateOrExcludePeerId as any, excludePeerId)
      return
    }
    // Called with just (excludePeerId) - use current state
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No game state to broadcast')
      return
    }
    this.connectionManager.broadcastGameState(state, gameStateOrExcludePeerId as string | undefined)
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
    if (!state) {return}

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
    if (!state) {return}

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
    if (!state) {return}

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

  // ==================== Additional Compatibility Methods ====================
  // These methods provide API compatibility with GuestConnectionManager
  // Only methods that don't exist elsewhere in the class

  /**
   * Accept guest with minimal info
   */
  acceptGuestMinimal(peerId: string, minimalInfo: any, playerId: number): void {
    this.connectionManager.acceptGuestMinimal(peerId, minimalInfo, playerId)
  }

  /**
   * Broadcast card status sync to all guests
   */
  broadcastCardStatusSync(changes: any[], excludePeerId?: string): number {
    return this.connectionManager.broadcastCardStatusSync(changes, excludePeerId)
  }

  /**
   * Broadcast board card sync to all guests
   */
  broadcastBoardCardSync(cards: any[], action: 'update' | 'remove' | 'replace', excludePeerId?: string): number {
    return this.connectionManager.broadcastBoardCardSync(cards, action, excludePeerId)
  }

  /**
   * Send message to specific guest
   */
  sendToGuest(peerId: string, message: any): boolean {
    return this.connectionManager.sendToGuest(peerId, message)
  }

  /**
   * Broadcast card state using codec
   */
  broadcastCardState(gameState: GameState, localPlayerId: number | null, excludePeerId?: string): number {
    return this.connectionManager.broadcastCardState(gameState, localPlayerId, excludePeerId)
  }

  /**
   * Broadcast ability effect
   */
  broadcastAbilityEffect(effectType: any, data: any, excludePeerId?: string): number {
    return this.connectionManager.broadcastAbilityEffect(effectType, data, excludePeerId)
  }

  /**
   * Broadcast session event
   */
  broadcastSessionEvent(eventType: number, data: any, excludePeerId?: string): number {
    return this.connectionManager.broadcastSessionEvent(eventType, data, excludePeerId)
  }

  /**
   * Check if player is reconnecting
   */
  isPlayerReconnecting(playerId: number): boolean {
    return this.connectionManager.isPlayerReconnecting(playerId)
  }

  /**
   * Set guest player ID
   */
  setGuestPlayerId(peerId: string, playerId: number): void {
    this.connectionManager.setGuestPlayerId(peerId, playerId)
  }

  // ==================== Compatibility Methods ====================
  // These methods provide API compatibility with GuestConnectionManager
  // to allow unified usage in hooks as WebRTCManager type

  /**
   * Get state manager (for compatibility with useReadyCheck)
   */
  getStateManager(): HostStateManager {
    return this.stateManager
  }

  /**
   * Send message to host (compatibility - host is always the "host" so this doesn't apply)
   * Included for WebRTCManager type compatibility
   */
  sendMessageToHost(_message: any): boolean {
    // Host doesn't send messages to itself
    logger.warn('[HostManager] sendMessageToHost called on host - no-op')
    return false
  }

  /**
   * Send full deck to host (compatibility - host already has its own deck)
   * Included for WebRTCManager type compatibility
   */
  sendFullDeckToHost(_playerId: number, _deck: any[], _deckSize: number): boolean {
    // Host doesn't need to send its deck to itself
    logger.warn('[HostManager] sendFullDeckToHost called on host - no-op')
    return false
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    logger.info('[HostManager] Cleaning up...')

    // Cleanup phase system if initialized
    if (this._phaseSyncManager) {
      try {
        this._phaseSyncManager.cleanup()
      } catch (e) {
        logger.warn('[HostManager] Failed to cleanup phase sync manager:', e)
      }
    }
    this._phaseManager = undefined
    this._phaseSyncManager = undefined

    this.gameLogger.cleanup()
    this.timerSystem.cleanup()
    this.stateManager.cleanup()
    this.connectionManager.cleanup()

    // Clear persisted data - player intentionally left
    try {
      clearWebrtcData()
    } catch (e) {
      logger.warn('[HostManager] Failed to clear persisted data:', e)
    }

    this.initialized = false
    this.localPlayerId = null
  }

  /**
   * Reset game to lobby state
   * Broadcasts GAME_RESET to all guests so they return to lobby
   */
  resetGame(): void {
    const state = this.stateManager.getState()
    if (!state) {
      logger.warn('[HostManager] No state to reset game')
      return
    }

    // Include player data so guests can recreate their state
    const playersData = state.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      selectedDeck: p.selectedDeck,
      isDummy: p.isDummy,
      isDisconnected: p.isDisconnected,
      autoDrawEnabled: p.autoDrawEnabled,
      // For dummies, include full card data
      ...(p.isDummy && {
        hand: p.hand.map((card: any) => ({
          id: card.id,
          baseId: card.baseId,
          name: card.name,
          imageUrl: card.imageUrl,
          power: card.power,
          powerModifier: card.powerModifier,
          ability: card.ability,
          ownerId: card.ownerId,
          color: card.color,
          deck: card.deck,
          isFaceDown: card.isFaceDown,
          types: card.types,
          faction: card.faction,
          statuses: card.statuses,
        })),
        deck: p.deck.map((card: any) => ({
          id: card.id,
          baseId: card.baseId,
          name: card.name,
          imageUrl: card.imageUrl,
          power: card.power,
          powerModifier: card.powerModifier,
          ability: card.ability,
          ownerId: card.ownerId,
          color: card.color,
          deck: card.deck,
          isFaceDown: card.isFaceDown,
          types: card.types,
          faction: card.faction,
          statuses: card.statuses,
        })),
        discard: p.discard.map((card: any) => ({
          id: card.id,
          baseId: card.baseId,
          name: card.name,
          imageUrl: card.imageUrl,
          power: card.power,
          powerModifier: card.powerModifier,
          ability: card.ability,
          ownerId: card.ownerId,
          color: card.color,
          deck: card.deck,
          isFaceDown: card.isFaceDown,
          types: card.types,
          faction: card.faction,
          statuses: card.statuses,
        })),
      }),
      score: p.score,
      isReady: p.isReady,
      announcedCard: p.announcedCard,
    }))

    this.broadcast({
      type: 'GAME_RESET',
      senderId: this.connectionManager.getPeerId(),
      data: {
        players: playersData,
        gameMode: state.gameMode,
        isPrivate: state.isPrivate,
        activeGridSize: state.activeGridSize,
        dummyPlayerCount: state.dummyPlayerCount,
        autoAbilitiesEnabled: state.autoAbilitiesEnabled,
        isGameStarted: false,
        currentPhase: 0,
        currentRound: 1,
        turnNumber: 1,
        activePlayerId: null,
        startingPlayerId: null,
        roundWinners: {},
        gameWinner: null,
        isRoundEndModalOpen: false,
        isReadyCheckActive: false,
      },
      timestamp: Date.now()
    })

    logger.info('[HostManager] Broadcasted GAME_RESET to all guests')
  }

  /**
   * Broadcast scoring mode to all guests when entering scoring phase
   * This ensures all players see the scoring line selection mode, regardless of whose turn it is
   * @param state - The current game state
   */
  private broadcastScoringMode(state: GameState): void {
    try {
      const activePlayerId = state.activePlayerId
      if (activePlayerId === null) {
        logger.warn('[HostManager] Cannot broadcast scoring mode - no active player')
        return
      }

      const gridSize = state.activeGridSize || 5
      let lastPlayedCoords = null
      let found = false

      // Find the card with LastPlayed status owned by ACTIVE PLAYER
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const cell = state.board[r]?.[c]
          const card = cell?.card
          if (card?.statuses?.some((s: any) => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)) {
            lastPlayedCoords = { row: r, col: c }
            found = true
            break
          }
        }
        if (found) break
      }

      if (!found || !lastPlayedCoords) {
        logger.info('[HostManager] No LastPlayed card found for scoring mode broadcast')
        return
      }

      // Calculate boardTargets for the line selection
      const boardTargets: {row: number, col: number}[] = []
      // Highlight horizontal line (same row)
      for (let c = 0; c < gridSize; c++) {
        boardTargets.push({ row: lastPlayedCoords.row, col: c })
      }
      // Highlight vertical line (same column)
      for (let r = 0; r < gridSize; r++) {
        boardTargets.push({ row: r, col: lastPlayedCoords.col })
      }

      // Create scoring action
      const scoringAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'SCORE_LAST_PLAYED_LINE',
        sourceCoords: lastPlayedCoords,
      }

      // Update host's abilityMode so host sees the scoring mode
      // All players (including host) should see line selection effects
      const updatedState: GameState = {
        ...state,
        abilityMode: scoringAction,
        targetingMode: {
          playerId: activePlayerId,
          action: { type: 'ENTER_MODE', mode: 'SCORE_LAST_PLAYED_LINE' },
          sourceCoords: lastPlayedCoords,
          timestamp: Date.now(),
          boardTargets,
        }
      }
      const actualUpdatedState = this.stateManager.setInitialState(updatedState)

      logger.info('[HostManager] broadcastScoringMode - setting state for host:', {
        hasAbilityMode: !!actualUpdatedState?.abilityMode,
        abilityMode: actualUpdatedState?.abilityMode,
        hasTargetingMode: !!actualUpdatedState?.targetingMode,
        targetingModePlayerId: actualUpdatedState?.targetingMode?.playerId,
        boardTargetsCount: actualUpdatedState?.targetingMode?.boardTargets?.length,
      })

      // Update host's UI with the actual state that was set
      if (this.config.onStateUpdate && actualUpdatedState) {
        this.config.onStateUpdate(actualUpdatedState)
        logger.info('[HostManager] Called onStateUpdate with scoring mode')
      } else {
        logger.warn('[HostManager] onStateUpdate callback missing or actualUpdatedState is null')
      }
      logger.info('[HostManager] Set scoring mode for all players including host')

      // Broadcast ABILITY_MODE_SET to all guests
      this.connectionManager.broadcast({
        type: 'ABILITY_MODE_SET',
        senderId: this.connectionManager.getPeerId(),
        data: {
          abilityMode: {
            ...scoringAction,
            playerId: activePlayerId,
            boardTargets,
            timestamp: Date.now()
          }
        },
        timestamp: Date.now()
      })

      logger.info('[HostManager] Broadcasted ABILITY_MODE_SET for scoring phase', {
        activePlayerId,
        lastPlayedCoords,
        boardTargetsCount: boardTargets.length
      })
    } catch (e) {
      logger.error('[HostManager] Failed to broadcast scoring mode:', e)
    }
  }

  /**
   * Configure or update callbacks after initialization
   * This allows setting the onStateUpdate callback after the singleton is created
   */
  configure(config: Partial<HostManagerConfig>): void {
    this.config = { ...this.config, ...config }
    logger.info('[HostManager] Configuration updated')
  }

  /**
   * Send action (compatibility - host handles actions directly via handleAction)
   * Included for WebRTCManager type compatibility
   */
  sendAction(_actionType: string, _actionData: any): boolean {
    // Host doesn't send actions to itself
    logger.warn('[HostManager] sendAction called on host - no-op')
    return false
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
