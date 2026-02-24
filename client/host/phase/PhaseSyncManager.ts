/**
 * Phase Sync Manager
 *
 * Handles synchronization of phase and turn state between host and all guests.
 * Broadcasts ultra-compact binary messages when phase state changes.
 *
 * This manager ensures all clients see the same phase and active player at all times.
 */

import type { HostConnectionManager } from '../HostConnectionManager'
import type { GameState } from '../../types'
import type {
  PhaseState,
  PhaseTransitionResult,
  RoundEndInfo,
  ScoringLine,
  ScoringSelectionMode
} from './PhaseTypes'
import { GamePhase } from './PhaseTypes'
import {
  encodePhaseState,
  encodePhaseTransition,
  encodeTurnChange,
  encodeRoundEnd,
  encodeScoringModeStart,
  encodeScoringModeComplete,
  createPhaseMessage,
  getPhaseActionName,
  PhaseActionType
} from './PhaseMessageCodec'
import { logger } from '../../utils/logger'

/**
 * Phase Sync Manager configuration
 */
export interface PhaseSyncManagerConfig {
  enableBroadcast: boolean
  broadcastInterval: number  // Debounce interval for rapid phase changes
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PhaseSyncManagerConfig = {
  enableBroadcast: true,
  broadcastInterval: 50, // 50ms debounce
}

/**
 * Phase Sync Manager
 * Broadcasts phase state changes to all guests
 */
export class PhaseSyncManager {
  private connectionManager: HostConnectionManager
  private config: PhaseSyncManagerConfig
  private lastBroadcastState: PhaseState | null = null
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBroadcast: boolean = false

  constructor(
    connectionManager: HostConnectionManager,
    config: Partial<PhaseSyncManagerConfig> = {}
  ) {
    this.connectionManager = connectionManager
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Broadcast phase state to all guests
   * Uses ultra-compact binary encoding (10 bytes)
   */
  broadcastPhaseState(state: PhaseState, excludePeerId?: string): void {
    if (!this.config.enableBroadcast) {
      return
    }

    // Check if state actually changed
    if (this.lastBroadcastState && this.isStateEqual(this.lastBroadcastState, state)) {
      return
    }

    this.lastBroadcastState = { ...state }

    // Debounce rapid changes
    if (this.broadcastTimer) {
      this.pendingBroadcast = true
      return
    }

    this.doBroadcastPhaseState(state, excludePeerId)
  }

  /**
   * Perform the actual broadcast
   */
  private doBroadcastPhaseState(state: PhaseState, excludePeerId?: string): void {
    const binaryData = encodePhaseState(state)
    const message = createPhaseMessage(binaryData, 'PHASE_STATE_UPDATE')

    // Broadcast via HostConnectionManager
    this.connectionManager.broadcast(message, excludePeerId)

    logger.debug(`[PhaseSyncManager] Broadcast phase state: phase=${state.currentPhase}, activePlayer=${state.activePlayerId}`)

    // Set up timer for debouncing
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null

      if (this.pendingBroadcast) {
        this.pendingBroadcast = false
        if (this.lastBroadcastState) {
          this.doBroadcastPhaseState(this.lastBroadcastState, excludePeerId)
        }
      }
    }, this.config.broadcastInterval)
  }

  /**
   * Broadcast phase transition to all guests
   * Ultra-compact: 5 bytes
   */
  broadcastPhaseTransition(result: PhaseTransitionResult, excludePeerId?: string): void {
    const binaryData = encodePhaseTransition(
      result.oldPhase,
      result.newPhase,
      result.oldActivePlayer,
      result.newActivePlayer
    )
    const message = createPhaseMessage(binaryData, 'PHASE_TRANSITION')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast phase transition: ${result.oldPhase} -> ${result.newPhase}, player ${result.oldActivePlayer} -> ${result.newActivePlayer}`)
  }

  /**
   * Broadcast turn change to all guests
   * Ultra-compact: 3 bytes
   */
  broadcastTurnChange(oldPlayerId: number, newPlayerId: number, excludePeerId?: string): void {
    const binaryData = encodeTurnChange(oldPlayerId, newPlayerId)
    const message = createPhaseMessage(binaryData, 'TURN_CHANGE')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast turn change: player ${oldPlayerId} -> ${newPlayerId}`)
  }

  /**
   * Broadcast round end to all guests
   */
  broadcastRoundEnd(info: RoundEndInfo, excludePeerId?: string): void {
    const binaryData = encodeRoundEnd(
      info.roundNumber,
      info.winners,
      info.isMatchOver,
      info.matchWinner
    )
    const message = createPhaseMessage(binaryData, 'ROUND_END')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast round end: round=${info.roundNumber}, winners=[${info.winners.join(', ')}], matchOver=${info.isMatchOver}`)
  }

  /**
   * Broadcast match end to all guests
   */
  broadcastMatchEnd(winnerId: number | null, excludePeerId?: string): void {
    const binaryData = encodeRoundEnd(
      0, // Round number doesn't matter for match end
      [], // No specific round winners
      true, // Is match over
      winnerId
    )
    const message = createPhaseMessage(binaryData, 'MATCH_END')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast match end: winner=${winnerId}`)
  }

  /**
   * Broadcast scoring mode start to all guests
   */
  broadcastScoringModeStart(mode: ScoringSelectionMode, excludePeerId?: string): void {
    const binaryData = encodeScoringModeStart(
      mode.activePlayerId,
      mode.validLines.length
    )
    const message = createPhaseMessage(binaryData, 'SCORING_MODE_START')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast scoring mode start: player=${mode.activePlayerId}, lines=${mode.validLines.length}`)
  }

  /**
   * Broadcast scoring mode complete to all guests
   */
  broadcastScoringModeComplete(
    playerId: number,
    line: ScoringLine,
    points: number,
    excludePeerId?: string
  ): void {
    const lineTypeMap: Record<string, number> = {
      'row': 0,
      'col': 1,
      'diagonal': 2,
      'anti-diagonal': 3
    }

    const binaryData = encodeScoringModeComplete(
      playerId,
      lineTypeMap[line.type] || 0,
      line.index,
      points
    )
    const message = createPhaseMessage(binaryData, 'SCORING_MODE_COMPLETE')

    this.connectionManager.broadcast(message, excludePeerId)

    logger.info(`[PhaseSyncManager] Broadcast scoring complete: player=${playerId}, line=${line.type}${line.index}, points=${points}`)
  }

  /**
   * Handle phase action request from guest
   * Decodes the binary request and forwards to PhaseManager
   */
  handlePhaseActionRequest(message: { data: string }): {
    action: string
    playerId: number
    data?: any
  } | null {
    try {
      const binaryData = this.parseBinaryData(message.data)
      const decoded = this.decodePhaseActionRequest(binaryData)

      return {
        action: getPhaseActionName(decoded.action),
        playerId: decoded.playerId,
        data: decoded.data
      }
    } catch (e) {
      logger.error('[PhaseSyncManager] Failed to decode phase action request:', e)
      return null
    }
  }

  /**
   * Parse base64 binary data
   */
  private parseBinaryData(base64: string): Uint8Array {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return bytes
  }

  /**
   * Decode phase action request from binary
   */
  private decodePhaseActionRequest(data: Uint8Array): {
    action: PhaseActionType
    playerId: number
    data?: any
  } {
    if (data.length < 3) {
      throw new Error(`Invalid phase action data: ${data.length} bytes, expected at least 3`)
    }

    // Skip message type byte (position 0)
    const action = data[1] as PhaseActionType
    const playerId = data[2]
    let extraData: any = undefined

    if (data.length >= 5 && action === PhaseActionType.SELECT_LINE) {
      extraData = {
        line: {
          type: data[3],
          index: data[4]
        }
      }
    }

    return {
      action,
      playerId,
      data: extraData
    }
  }

  /**
   * Create action result message for guest
   */
  createActionResultMessage(
    success: boolean,
    newPhase: GamePhase,
    newActivePlayer: number | null
  ): { type: string; data: string; timestamp: number } {
    const bytes = new Uint8Array(4)
    bytes[0] = success ? 1 : 0
    bytes[1] = newPhase
    bytes[2] = newActivePlayer ?? 0
    bytes[3] = 0 // Reserved

    return createPhaseMessage(bytes, 'PHASE_ACTION_RESULT')
  }

  /**
   * Compare two phase states for equality
   */
  private isStateEqual(a: PhaseState, b: PhaseState): boolean {
    return (
      a.currentPhase === b.currentPhase &&
      a.activePlayerId === b.activePlayerId &&
      a.startingPlayerId === b.startingPlayerId &&
      a.currentRound === b.currentRound &&
      a.turnNumber === b.turnNumber &&
      a.isScoringStep === b.isScoringStep &&
      a.isRoundEndModalOpen === b.isRoundEndModalOpen &&
      a.gameWinner === b.gameWinner &&
      a.autoDrawEnabled === b.autoDrawEnabled
    )
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PhaseSyncManagerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Clear cached state (e.g., after reset)
   */
  clearCache(): void {
    this.lastBroadcastState = null
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer)
      this.broadcastTimer = null
    }
    this.pendingBroadcast = false
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.clearCache()
  }
}

/**
 * Helper: Convert GameState to PhaseState
 */
export function gameStateToPhaseState(gameState: GameState): PhaseState {
  return {
    currentPhase: gameState.currentPhase as GamePhase,
    activePlayerId: gameState.activePlayerId,
    startingPlayerId: gameState.startingPlayerId,
    currentRound: gameState.currentRound,
    turnNumber: gameState.turnNumber,
    isScoringStep: gameState.isScoringStep || false,
    isRoundEndModalOpen: gameState.isRoundEndModalOpen || false,
    roundWinners: gameState.roundWinners || {},
    gameWinner: gameState.gameWinner || null,
    autoDrawEnabled: gameState.autoDrawEnabled ?? true,
  }
}

/**
 * Helper: Apply PhaseState to GameState
 */
export function applyPhaseStateToGameState(gameState: GameState, phaseState: PhaseState): void {
  gameState.currentPhase = phaseState.currentPhase
  gameState.activePlayerId = phaseState.activePlayerId
  gameState.startingPlayerId = phaseState.startingPlayerId
  gameState.currentRound = phaseState.currentRound
  gameState.turnNumber = phaseState.turnNumber
  gameState.isScoringStep = phaseState.isScoringStep
  gameState.isRoundEndModalOpen = phaseState.isRoundEndModalOpen
  gameState.roundWinners = phaseState.roundWinners
  gameState.gameWinner = phaseState.gameWinner
  gameState.autoDrawEnabled = phaseState.autoDrawEnabled
}

export default PhaseSyncManager
