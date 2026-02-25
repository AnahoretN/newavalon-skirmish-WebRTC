/**
 * Guest Phase Integration
 *
 * Extends GuestConnectionManager with phase handling functionality.
 * This module integrates the GuestPhaseHandler with GuestConnectionManager.
 *
 * Import this module to add phase handling to an existing GuestConnectionManager instance.
 */

import { GuestConnectionManager } from './GuestConnection'
import type { GameState } from '../types'
import type { GamePhase } from './phase/PhaseTypes'
import { GuestPhaseHandler, applyPhaseStateToGameState, initializePhaseStateFromGameState } from './phase/GuestPhaseHandler'
import { logger } from '../utils/logger'

// Track auto-draw per player to prevent duplicate draws in same turn
const autoDrawnThisTurn = new Set<number>()

/**
 * Initialize phase system on GuestConnectionManager
 * Call this after creating GuestConnectionManager to enable phase handling
 */
export function initializePhaseSystemForGuest(
  guestConnection: GuestConnectionManager,
  config?: {
    gameStateRef?: React.MutableRefObject<GameState>
    localPlayerId?: number | null  // Local player ID for auto-draw detection
    onDrawCard?: (playerId: number) => void  // Callback to draw card (same as clicking deck)
    onStateUpdate?: (newState: GameState) => void  // CRITICAL: Triggers React re-render
    onPhaseStateChanged?: (state: any) => void
    onPhaseTransition?: (
      oldPhase: GamePhase,
      newPhase: GamePhase,
      oldActivePlayer: number | null,
      newActivePlayer: number | null
    ) => void
    onTurnChanged?: (oldPlayerId: number, newPlayerId: number) => void
    onRoundEnded?: (info: any) => void
    onMatchEnded?: (winnerId: number | null) => void
    onScoringModeStarted?: (activePlayerId: number, validLinesCount: number) => void
    onScoringModeCompleted?: (info: any) => void
  }
): void {
  // Access private members via type assertions
  const gc = guestConnection as any

  // Track the last active player to detect when we become the active player
  let lastActivePlayer: number | null = null

  // Create callbacks for GuestPhaseHandler
  const phaseCallbacks = {
    onPhaseStateChanged: (state: any) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        applyPhaseStateToGameState(config.gameStateRef.current, state)
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      // Without this, UI won't update with new phase state!
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // CRITICAL: Local auto-draw for guest
      // Triggered when we become the active player and phase is Setup
      // This detects turn pass events even though Preparation auto-transitions to Setup
      if (config?.gameStateRef && config?.localPlayerId) {
        const localPlayerId = config.localPlayerId
        const activePlayerId = state.activePlayerId

        // Check if we just became the active player (transition from different player or null)
        const justBecameActive = lastActivePlayer !== activePlayerId

        // Only auto-draw if:
        // 1. We are the active player
        // 2. We just became active (transition from different player)
        // 3. The current phase is Setup (1), which means Preparation just completed
        // 4. Auto-draw is enabled for this player
        logger.info(`[GuestPhaseIntegration] Auto-draw check: justBecameActive=${justBecameActive}, lastActivePlayer=${lastActivePlayer}, activePlayerId=${activePlayerId}, localPlayerId=${localPlayerId}, currentPhase=${state.currentPhase}`)

        // Update tracking for next time
        lastActivePlayer = activePlayerId

        if (justBecameActive && activePlayerId === localPlayerId && state.currentPhase === 1) {
          const gameState = config.gameStateRef.current
          const player = gameState.players.find(p => p.id === localPlayerId)
          const autoDrawEnabled = player?.autoDrawEnabled !== false

          if (autoDrawEnabled && player && player.deck && player.deck.length > 0) {
            // Check if already drawn this turn
            if (!autoDrawnThisTurn.has(localPlayerId)) {
              logger.info(`[GuestPhaseIntegration] Local auto-draw for player ${localPlayerId} (became active player, phase is Setup)`)

              // Mark as drawn for this turn BEFORE calling drawCard
              autoDrawnThisTurn.add(localPlayerId)

              // Use onDrawCard callback - this works exactly like clicking deck
              // drawCard will call updateState which syncs to host and all guests
              if (config?.onDrawCard) {
                config.onDrawCard(localPlayerId)
              }
            }
          }
        }
      }

      // Call external callback
      config?.onPhaseStateChanged?.(state)
    },

    onPhaseTransition: (
      oldPhase: GamePhase,
      newPhase: GamePhase,
      oldActivePlayer: number | null,
      newActivePlayer: number | null
    ) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.currentPhase = newPhase
        config.gameStateRef.current.activePlayerId = newActivePlayer
        // CRITICAL: Set isScoringStep when entering Scoring phase (phase 4)
        // This ensures guests see the scoring UI when entering Scoring phase
        // Also clear it when leaving Scoring phase
        config.gameStateRef.current.isScoringStep = (newPhase === 4)
      }

      // Update last active player tracking
      lastActivePlayer = newActivePlayer

      // Reset auto-draw tracking when leaving Preparation
      if (oldPhase === 0 && newPhase !== 0) {
        autoDrawnThisTurn.clear()
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      // Without this, UI won't update with new phase!
      if (config?.onStateUpdate && config?.gameStateRef) {
        // Check for initial game start transition (0 -> 1)
        // We don't trigger update for this because CARD_STATE message will handle it
        const isInitialGameStartTransition = oldPhase === 0 && newPhase === 1
        if (!isInitialGameStartTransition) {
          config.onStateUpdate(config.gameStateRef.current)
        }
      }

      // Call external callback
      config?.onPhaseTransition?.(oldPhase, newPhase, oldActivePlayer, newActivePlayer)
    },

    onTurnChanged: (oldPlayerId: number, newPlayerId: number) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.activePlayerId = newPlayerId
      }

      // Update last active player tracking
      lastActivePlayer = newPlayerId

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      // Without this, UI won't update with new active player!
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // Call external callback
      config?.onTurnChanged?.(oldPlayerId, newPlayerId)
    },

    onRoundEnded: (info: any) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.roundWinners[info.roundNumber] = info.winners
        if (info.isMatchOver) {
          config.gameStateRef.current.gameWinner = info.matchWinner
        }
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // Call external callback
      config?.onRoundEnded?.(info)
    },

    onMatchEnded: (winnerId: number | null) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.gameWinner = winnerId
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // Call external callback
      config?.onMatchEnded?.(winnerId)
    },

    onScoringModeStarted: (activePlayerId: number, validLinesCount: number) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.isScoringStep = true
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // Call external callback
      config?.onScoringModeStarted?.(activePlayerId, validLinesCount)
    },

    onScoringModeCompleted: (info: any) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.isScoringStep = false
      }

      // CRITICAL: Trigger React re-render by calling onStateUpdate
      if (config?.onStateUpdate && config?.gameStateRef) {
        config.onStateUpdate(config.gameStateRef.current)
      }

      // Call external callback
      config?.onScoringModeCompleted?.(info)
    },

    onActionRejected: (reason: string) => {
      logger.warn(`[GuestPhaseIntegration] Action rejected: ${reason}`)
    },
  }

  // Create GuestPhaseHandler
  const guestPhaseHandler = new GuestPhaseHandler(phaseCallbacks)

  // Store reference on GuestConnectionManager instance
  gc._guestPhaseHandler = guestPhaseHandler

  // Initialize state from game state if provided
  if (config?.gameStateRef) {
    const phaseState = initializePhaseStateFromGameState(config.gameStateRef.current)
    guestPhaseHandler.getCurrentPhaseState = () => phaseState
  }

  logger.info('[GuestPhaseIntegration] Phase system initialized for guest')
}

/**
 * Get the GuestPhaseHandler instance
 */
export function getGuestPhaseHandler(guestConnection: GuestConnectionManager): any {
  return (guestConnection as any)._guestPhaseHandler
}

/**
 * Request a phase action from the host
 */
export function requestPhaseAction(
  guestConnection: GuestConnectionManager,
  action: string,
  playerId: number,
  data?: any
): boolean {
  const gc = guestConnection as any
  const guestPhaseHandler = gc._guestPhaseHandler

  if (!guestPhaseHandler) {
    logger.warn('[GuestPhaseIntegration] Phase system not initialized')
    return false
  }

  const message = guestPhaseHandler.requestPhaseAction(action, playerId, data)
  if (!message) {
    return false
  }

  return guestConnection.sendMessage(message)
}

/**
 * Update phase system state
 * Call this when game state changes externally
 */
export function updatePhaseSystemStateForGuest(
  guestConnection: GuestConnectionManager,
  _gameState: GameState
): void {
  const gc = guestConnection as any
  const guestPhaseHandler = gc._guestPhaseHandler

  if (guestPhaseHandler) {
    // Phase state will be updated via messages from host
    // This is just for local tracking
    guestPhaseHandler.reset()
  }
}

/**
 * Cleanup phase system
 */
export function cleanupPhaseSystemForGuest(guestConnection: GuestConnectionManager): void {
  const gc = guestConnection as any
  const guestPhaseHandler = gc._guestPhaseHandler

  if (guestPhaseHandler) {
    guestPhaseHandler.reset()
  }

  gc._guestPhaseHandler = undefined

  logger.info('[GuestPhaseIntegration] Phase system cleaned up for guest')
}

/**
 * Extend GuestConnectionManager prototype with phase methods
 */
export function extendGuestConnectionPrototype(): void {
  const proto = (GuestConnectionManager as any).prototype

  // Initialize phase system
  proto.initializePhaseSystem = function(config?: any) {
    initializePhaseSystemForGuest(this, config)
  }

  // Request phase action
  proto.requestPhaseAction = function(action: string, playerId: number, data?: any) {
    return requestPhaseAction(this, action, playerId, data)
  }

  // Get phase handler
  proto.getPhaseHandler = function() {
    return getGuestPhaseHandler(this)
  }

  logger.info('[GuestPhaseIntegration] GuestConnectionManager prototype extended with phase methods')
}

// Auto-extend prototype on module import
extendGuestConnectionPrototype()

export default {
  initializePhaseSystemForGuest,
  getGuestPhaseHandler,
  requestPhaseAction,
  updatePhaseSystemStateForGuest,
  cleanupPhaseSystemForGuest,
  extendGuestConnectionPrototype,
}
