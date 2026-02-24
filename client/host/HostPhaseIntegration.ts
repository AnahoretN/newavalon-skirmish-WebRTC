/**
 * Host Phase Integration
 *
 * Extends HostManager with phase and turn management functionality.
 * This module integrates the PhaseManager and PhaseSyncManager with HostManager.
 *
 * Import this module to add phase management to an existing HostManager instance.
 */

import { HostManager } from './HostManager'
import type { GameState } from '../types'
import type {
  PhaseTransitionResult,
  PhaseSystemCallbacks,
  ScoringLine
} from './phase/PhaseTypes'
import { PhaseManager } from './phase/PhaseManager'
import { PhaseSyncManager, gameStateToPhaseState } from './phase/PhaseSyncManager'
import { logger } from '../utils/logger'

/**
 * Initialize phase system on HostManager
 * Call this after creating HostManager to enable phase management
 */
export function initializePhaseSystem(
  hostManager: HostManager,
  config?: {
    onPhaseChanged?: (result: PhaseTransitionResult) => void
    onRoundEnded?: (info: any) => void
    onMatchEnded?: (winnerId: number | null) => void
    onScoringModeStarted?: (mode: any) => void
    onScoringModeCompleted?: (playerId: number, line: ScoringLine, points: number) => void
  }
): void {
  // Access private members via type assertions
  const hm = hostManager as any
  const connectionManager = hm.connectionManager
  const stateManager = hm.stateManager

  if (!connectionManager || !stateManager) {
    logger.error('[HostPhaseIntegration] Cannot initialize phase system - missing connectionManager or stateManager')
    return
  }

  // Create PhaseSyncManager
  const phaseSyncManager = new PhaseSyncManager(connectionManager)

  // Create callbacks for PhaseManager
  const phaseCallbacks: PhaseSystemCallbacks = {
    onPhaseChanged: (result) => {
      // Broadcast phase transition to all guests
      phaseSyncManager.broadcastPhaseTransition(result)

      // Broadcast full phase state
      const state = stateManager.getState()
      if (state) {
        const phaseState = gameStateToPhaseState(state)
        phaseSyncManager.broadcastPhaseState(phaseState)
      }

      // Broadcast phase transition to all guests
      phaseSyncManager.broadcastPhaseTransition(result)

      // Call external callback
      config?.onPhaseChanged?.(result)
    },

    onRoundEnded: (info) => {
      // Broadcast round end to all guests
      phaseSyncManager.broadcastRoundEnd(info)

      // Call external callback
      config?.onRoundEnded?.(info)
    },

    onMatchEnded: (winnerId) => {
      // Broadcast match end to all guests
      phaseSyncManager.broadcastMatchEnd(winnerId)

      // Call external callback
      config?.onMatchEnded?.(winnerId)
    },

    onScoringModeStarted: (mode) => {
      // Broadcast scoring mode start
      phaseSyncManager.broadcastScoringModeStart(mode)

      // Call external callback
      config?.onScoringModeStarted?.(mode)
    },

    onScoringModeCompleted: (playerId, line, points) => {
      // Broadcast scoring complete
      phaseSyncManager.broadcastScoringModeComplete(playerId, line, points)

      // Call external callback
      config?.onScoringModeCompleted?.(playerId, line, points)
    },

    onStateUpdateRequired: (newState: GameState) => {
      // Update host's local state
      if (hm.config?.onStateUpdate) {
        hm.config.onStateUpdate(newState)
      }
      // Broadcast updated state to all guests
      hm.stateManager.setInitialState(newState)
      hm.connectionManager.broadcastGameState(newState)
    },
  }

  // Create PhaseManager
  const phaseManager = new PhaseManager({}, phaseCallbacks)

  // Store references on HostManager instance
  hm._phaseManager = phaseManager
  hm._phaseSyncManager = phaseSyncManager

  // Set initial state
  const initialState = stateManager.getState()
  if (initialState) {
    phaseManager.setState(initialState)
  }

  logger.info('[HostPhaseIntegration] Phase system initialized')
}

/**
 * Handle phase action message from guest
 * Call this from HostManager's message handler
 */
export function handlePhaseActionMessage(
  hostManager: HostManager,
  message: any
): void {
  const hm = hostManager as any
  const phaseSyncManager = hm._phaseSyncManager
  const phaseManager = hm._phaseManager

  if (!phaseSyncManager || !phaseManager) {
    logger.warn('[HostPhaseIntegration] Phase system not initialized')
    return
  }

  // Decode the action request
  const actionRequest = phaseSyncManager.handlePhaseActionRequest(message)
  if (!actionRequest) {
    logger.warn('[HostPhaseIntegration] Invalid phase action request')
    return
  }

  logger.info(`[HostPhaseIntegration] Phase action: ${actionRequest.action} from player ${actionRequest.playerId}`)

  // Process the action
  const result = phaseManager.handleAction({
    action: actionRequest.action,
    playerId: actionRequest.playerId,
    data: actionRequest.data,
  })

  // Send result back to the requesting guest
  if (result) {
    const resultMessage = phaseSyncManager.createActionResultMessage(
      result.success,
      result.newPhase,
      result.newActivePlayer
    )

    // Send to the guest who requested (we'd need their peerId here)
    // For now, broadcast to all (the requester will process it)
    hm.connectionManager.broadcast(resultMessage)
  }
}

/**
 * Get the PhaseManager instance
 */
export function getPhaseManager(hostManager: HostManager): PhaseManager | undefined {
  return (hostManager as any)._phaseManager
}

/**
 * Get the PhaseSyncManager instance
 */
export function getPhaseSyncManager(hostManager: HostManager): PhaseSyncManager | undefined {
  return (hostManager as any)._phaseSyncManager
}

/**
 * Start the game with phase system
 * Call this when all players are ready to begin
 */
export function startGameWithPhaseSystem(
  hostManager: HostManager,
  startingPlayerId: number
): PhaseTransitionResult | null {
  const hm = hostManager as any
  const phaseManager = hm._phaseManager

  if (!phaseManager) {
    logger.error('[HostPhaseIntegration] Phase system not initialized')
    return null
  }

  // Set the state before starting
  const state = hm.stateManager?.getState()
  if (state) {
    phaseManager.setState(state)
  }

  // Start the game
  return phaseManager.startGame(startingPlayerId)
}

/**
 * Update phase system state
 * Call this when game state changes externally
 */
export function updatePhaseSystemState(
  hostManager: HostManager,
  gameState: GameState
): void {
  const hm = hostManager as any
  const phaseManager = hm._phaseManager
  const phaseSyncManager = hm._phaseSyncManager

  if (phaseManager) {
    phaseManager.setState(gameState)
  }

  if (phaseSyncManager && phaseManager) {
    const phaseState = phaseManager.getPhaseState()
    phaseSyncManager.broadcastPhaseState(phaseState)
  }
}

/**
 * Cleanup phase system
 */
export function cleanupPhaseSystem(hostManager: HostManager): void {
  const hm = hostManager as any
  const phaseSyncManager = hm._phaseSyncManager

  if (phaseSyncManager) {
    phaseSyncManager.cleanup()
  }

  hm._phaseManager = undefined
  hm._phaseSyncManager = undefined

  logger.info('[HostPhaseIntegration] Phase system cleaned up')
}

/**
 * Extend HostManager prototype with phase methods
 * This allows calling phase methods directly on HostManager instances
 */
export function extendHostManagerPrototype(): void {
  const proto = (HostManager as any).prototype

  // Initialize phase system
  proto.initializePhaseSystem = function(config?: any) {
    initializePhaseSystem(this, config)
  }

  // Start game with phase system
  proto.startGameWithPhaseSystem = function(startingPlayerId: number) {
    return startGameWithPhaseSystem(this, startingPlayerId)
  }

  // NOTE: handlePhaseAction is now defined directly in HostManager.ts
  // with signature: handlePhaseAction(actionType: number, playerId: number)
  // We don't override it here to avoid conflicts

  // Alternative method name for handling phase action messages (if needed)
  proto.handlePhaseActionMessage = function(message: any) {
    handlePhaseActionMessage(this, message)
  }

  // Update phase system state
  proto.updatePhaseSystemState = function(gameState: GameState) {
    updatePhaseSystemState(this, gameState)
  }

  // Get phase manager
  proto.getPhaseManager = function() {
    return getPhaseManager(this)
  }

  // Get phase sync manager
  proto.getPhaseSyncManager = function() {
    return getPhaseSyncManager(this)
  }

  logger.info('[HostPhaseIntegration] HostManager prototype extended with phase methods')
}

// Auto-extend prototype on module import
extendHostManagerPrototype()

export default {
  initializePhaseSystem,
  handlePhaseActionMessage,
  getPhaseManager,
  getPhaseSyncManager,
  startGameWithPhaseSystem,
  updatePhaseSystemState,
  cleanupPhaseSystem,
  extendHostManagerPrototype,
}
