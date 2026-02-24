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

/**
 * Initialize phase system on GuestConnectionManager
 * Call this after creating GuestConnectionManager to enable phase handling
 */
export function initializePhaseSystemForGuest(
  guestConnection: GuestConnectionManager,
  config?: {
    gameStateRef?: React.MutableRefObject<GameState>
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

  // Create callbacks for GuestPhaseHandler
  const phaseCallbacks = {
    onPhaseStateChanged: (state: any) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        applyPhaseStateToGameState(config.gameStateRef.current, state)
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
      }

      // Call external callback
      config?.onPhaseTransition?.(oldPhase, newPhase, oldActivePlayer, newActivePlayer)
    },

    onTurnChanged: (oldPlayerId: number, newPlayerId: number) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.activePlayerId = newPlayerId
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

      // Call external callback
      config?.onRoundEnded?.(info)
    },

    onMatchEnded: (winnerId: number | null) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.gameWinner = winnerId
      }

      // Call external callback
      config?.onMatchEnded?.(winnerId)
    },

    onScoringModeStarted: (activePlayerId: number, validLinesCount: number) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.isScoringStep = true
      }

      // Call external callback
      config?.onScoringModeStarted?.(activePlayerId, validLinesCount)
    },

    onScoringModeCompleted: (info: any) => {
      // Update game state if ref provided
      if (config?.gameStateRef) {
        config.gameStateRef.current.isScoringStep = false
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
