/**
 * Host Phase Integration
 *
 * Extends HostManager with phase and turn management functionality.
 * This module integrates the PhaseManager and PhaseSyncManager with HostManager.
 *
 * Import this module to add phase management to an existing HostManager instance.
 */

import { HostManager } from './HostManager'
import type { GameState, Player } from '../types'
import type {
  PhaseTransitionResult,
  PhaseSystemCallbacks,
  ScoringLine
} from './phase/PhaseTypes'
import { PhaseManager } from './phase/PhaseManager'
import { PhaseSyncManager, gameStateToPhaseState } from './phase/PhaseSyncManager'
import { GamePhase } from './phase/PhaseTypes'
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

    onGuestShouldAutoDraw: (playerId: number) => {
      // Send a message to the guest telling them to auto-draw
      // The guest will draw locally and send updated state back to host
      const guestPeerId = hm.connectionManager.getPeerIdForPlayer(playerId)
      if (guestPeerId) {
        const message = {
          type: 'GUEST_AUTO_DRAW',
          playerId,
          timestamp: Date.now()
        }
        hm.connectionManager.sendToGuest(guestPeerId, message)
        logger.info(`[HostPhaseIntegration] Sent auto-draw signal to guest ${playerId} (peer: ${guestPeerId})`)
      } else {
        logger.warn(`[HostPhaseIntegration] No peerId found for player ${playerId} to send auto-draw signal`)
      }
    },

    onStateUpdateRequired: (phaseManagerState: GameState) => {
      // CRITICAL: PhaseManager is the source of truth for phase transitions and auto-draw
      // PhaseManager directly modifies player hands/decks when auto-drawing
      // We need to broadcast this updated state to all guests

      // Get players who auto-drew in this Preparation phase
      const autoDrawPlayers = hm._phaseManager?.getRecentAutoDrawPlayers?.() || new Set()

      if (autoDrawPlayers.size > 0) {
        logger.info(`[HostPhaseIntegration] Players who auto-drew: [${Array.from(autoDrawPlayers).join(', ')}]`)
      }

      // Log player hand sizes before broadcasting
      logger.info('[HostPhaseIntegration] Broadcasting state with player hands:', phaseManagerState.players.map(p => `P${p.id}:h${p.hand?.length ?? 0}/d${p.deck?.length ?? 0}`).join(', '))

      // PhaseManager state already has all the changes (including auto-draw)
      // Use it directly for broadcasting
      const mergedState: GameState = {
        ...phaseManagerState,
      }

      // Update host's local state
      if (hm.config?.onStateUpdate) {
        hm.config.onStateUpdate(mergedState)
      }

      // CRITICAL: Directly update stateManager's currentState and broadcast
      // Do NOT use setInitialState because it has merge logic that drops player hands!
      hm.stateManager.currentState = mergedState
      hm.stateManager.broadcastFullState()  // This handles personalization for each guest

      // Clear recent auto-draw tracking after broadcasting
      hm._phaseManager?.clearRecentAutoDrawPlayers?.()
    },
  }

  // Get local player ID (host's player ID)
  // Host is always player 1, but also check stateManager in case it's already set
  const initialState = stateManager.getState()
  let localPlayerId = stateManager.getLocalPlayerId()

  // If localPlayerId is not set yet, default to 1 (host is always player 1)
  if (!localPlayerId) {
    localPlayerId = 1
    // Also set it in stateManager for future reference
    stateManager.setLocalPlayerId(1)
    logger.info('[HostPhaseIntegration] Defaulted localPlayerId to 1 (host)')
  }

  // Create PhaseManager with localPlayerId so it knows not to auto-draw for guests
  const phaseManager = new PhaseManager({ localPlayerId }, phaseCallbacks)

  // Store references on HostManager instance
  hm._phaseManager = phaseManager
  hm._phaseSyncManager = phaseSyncManager

  // Set initial state
  if (initialState) {
    phaseManager.setState(initialState)
  }

  logger.info('[HostPhaseIntegration] Phase system initialized with localPlayerId=' + localPlayerId)

  // IMPORTANT: Override HostStateManager's startGame to use PhaseManager
  // NEW APPROACH:
  // 1. Host broadcasts GAME_STARTING with starting player info
  // 2. PhaseManager runs Preparation phase for starting player (no card draw yet)
  // 3. PhaseManager transitions to Setup phase
  // 4. After phase transition, host broadcasts final state
  // 5. Each guest receives state and draws their 6 cards locally (or 7 if starting player)
  // 6. Guests send STATE_UPDATE_COMPACT to host with their drawn cards
  // 7. Host merges and broadcasts final synchronized state
  hm.stateManager.startGame = () => {
    logger.info('[HostPhaseIntegration] startGame called - using phase-first approach')

    // Get the current state to determine starting player
    const currentState = hm.stateManager.getState()
    if (!currentState) {
      logger.error('[HostPhaseIntegration] No state available for startGame')
      return
    }

    // Select random starting player
    const allPlayers = currentState.players.filter((p: Player) => !p.isDisconnected)
    const randomIndex = Math.floor(Math.random() * allPlayers.length)
    const startingPlayerId = allPlayers[randomIndex].id

    logger.info(`[HostPhaseIntegration] Starting game with player ${startingPlayerId}`)

    // Update local state to mark game as started
    // DON'T draw any cards yet - PhaseManager will handle phases, guests will draw after receiving state
    let newState: GameState = {
      ...currentState,
      isReadyCheckActive: false,
      isGameStarted: true,
      startingPlayerId: startingPlayerId,
      activePlayerId: startingPlayerId,
      currentPhase: GamePhase.PREPARATION  // Start in Preparation phase
    }

    // Set state on host BEFORE running PhaseManager
    hm.stateManager.currentState = newState

    // Broadcast GAME_STARTING message to all guests
    // Guests will prepare for game start but NOT draw yet
    // They will draw after receiving the phase state broadcast
    hm.connectionManager.broadcast({
      type: 'GAME_STARTING',
      senderId: hm.connectionManager.getPeerId(),
      data: {
        startingPlayerId: startingPlayerId,
        activePlayerId: startingPlayerId,
        currentPhase: GamePhase.PREPARATION
      },
      timestamp: Date.now()
    })

    logger.info(`[HostPhaseIntegration] Broadcast GAME_STARTING to all guests, startingPlayerId=${startingPlayerId}`)

    // Now call PhaseManager's startGame which will:
    // 1. Draw starting hands for ALL players (6 cards each, +1 for starting player)
    // 2. Set phase to Preparation, then transition to Setup
    // 3. Broadcast phase state to all guests
    // 4. Guests receive state with their drawn cards already in hand
    const result = startGameWithPhaseSystem(hm, startingPlayerId)

    if (result) {
      logger.info(`[HostPhaseIntegration] PhaseManager started game: phase=${result.newPhase}, activePlayer=${result.newActivePlayer}`)
      logger.info('[HostPhaseIntegration] All players have drawn their starting hands, state broadcast complete')
    } else {
      logger.error('[HostPhaseIntegration] PhaseManager failed to start game')
    }
  }
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
