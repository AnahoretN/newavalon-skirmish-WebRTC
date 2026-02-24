/**
 * Guest Phase Handler
 *
 * Handles phase-related messages received by guests from the host.
 * Guests receive ultra-compact binary messages and update their local state.
 *
 * Guests NEVER control phase transitions - they only display what the host sends.
 */

import type { GameState } from '../../types'
import type { PhaseState, GamePhase } from './PhaseTypes'
import {
  decodePhaseState,
  decodePhaseTransition,
  decodeTurnChange,
  decodeRoundEnd,
  decodeScoringModeStart,
  decodeScoringModeComplete,
  parsePhaseMessage,
  PhaseActionType,
  encodePhaseAction,
  createPhaseMessage
} from './PhaseMessageCodec'
import { logger } from '../../utils/logger'

/**
 * Callbacks for phase events on guest
 */
export interface GuestPhaseCallbacks {
  onPhaseStateChanged?: (state: PhaseState) => void
  onPhaseTransition?: (
    oldPhase: GamePhase,
    newPhase: GamePhase,
    oldActivePlayer: number | null,
    newActivePlayer: number | null
  ) => void
  onTurnChanged?: (oldPlayerId: number, newPlayerId: number) => void
  onRoundEnded?: (info: {
    roundNumber: number
    winners: number[]
    isMatchOver: boolean
    matchWinner: number | null
  }) => void
  onMatchEnded?: (winnerId: number | null) => void
  onScoringModeStarted?: (activePlayerId: number, validLinesCount: number) => void
  onScoringModeCompleted?: (info: {
    playerId: number
    lineType: number
    lineIndex: number
    points: number
  }) => void
  onActionRejected?: (reason: string) => void
}

/**
 * Guest Phase Handler
 * Processes incoming phase messages from host
 */
export class GuestPhaseHandler {
  private callbacks: GuestPhaseCallbacks
  private currentState: PhaseState | null = null

  constructor(callbacks: GuestPhaseCallbacks = {}) {
    this.callbacks = callbacks
  }

  /**
   * Handle phase state update from host
   */
  handlePhaseStateUpdate(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const newState = decodePhaseState(binaryData)

      this.currentState = newState
      this.callbacks.onPhaseStateChanged?.(newState)

      logger.debug(`[GuestPhaseHandler] Phase state updated: phase=${newState.currentPhase}, activePlayer=${newState.activePlayerId}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle phase state update:', e)
    }
  }

  /**
   * Handle phase transition from host
   */
  handlePhaseTransition(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const { oldPhase, newPhase, oldActivePlayer, newActivePlayer } = decodePhaseTransition(binaryData)

      this.currentState = this.currentState || {} as PhaseState
      this.currentState.currentPhase = newPhase
      this.currentState.activePlayerId = newActivePlayer

      this.callbacks.onPhaseTransition?.(oldPhase, newPhase, oldActivePlayer, newActivePlayer)

      logger.info(`[GuestPhaseHandler] Phase transition: ${oldPhase} -> ${newPhase}, player ${oldActivePlayer} -> ${newActivePlayer}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle phase transition:', e)
    }
  }

  /**
   * Handle turn change from host
   */
  handleTurnChange(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const { oldPlayerId, newPlayerId } = decodeTurnChange(binaryData)

      this.currentState = this.currentState || {} as PhaseState
      this.currentState.activePlayerId = newPlayerId

      this.callbacks.onTurnChanged?.(oldPlayerId, newPlayerId)

      logger.info(`[GuestPhaseHandler] Turn changed: player ${oldPlayerId} -> ${newPlayerId}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle turn change:', e)
    }
  }

  /**
   * Handle round end from host
   */
  handleRoundEnd(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const info = decodeRoundEnd(binaryData)

      if (this.currentState) {
        this.currentState.roundWinners[info.roundNumber] = info.winners
        if (info.isMatchOver) {
          this.currentState.gameWinner = info.matchWinner
        }
      }

      this.callbacks.onRoundEnded?.(info)

      if (info.isMatchOver) {
        this.callbacks.onMatchEnded?.(info.matchWinner)
      }

      logger.info(`[GuestPhaseHandler] Round ended: round=${info.roundNumber}, winners=[${info.winners.join(', ')}]`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle round end:', e)
    }
  }

  /**
   * Handle match end from host
   */
  handleMatchEnd(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const info = decodeRoundEnd(binaryData)

      if (this.currentState) {
        this.currentState.gameWinner = info.matchWinner
      }

      this.callbacks.onMatchEnded?.(info.matchWinner)

      logger.info(`[GuestPhaseHandler] Match ended: winner=${info.matchWinner}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle match end:', e)
    }
  }

  /**
   * Handle scoring mode start from host
   */
  handleScoringModeStart(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const { activePlayerId, validLinesCount } = decodeScoringModeStart(binaryData)

      if (this.currentState) {
        this.currentState.isScoringStep = true
      }

      this.callbacks.onScoringModeStarted?.(activePlayerId, validLinesCount)

      logger.info(`[GuestPhaseHandler] Scoring mode started: player=${activePlayerId}, lines=${validLinesCount}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle scoring mode start:', e)
    }
  }

  /**
   * Handle scoring mode complete from host
   */
  handleScoringModeComplete(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)
      const info = decodeScoringModeComplete(binaryData)

      if (this.currentState) {
        this.currentState.isScoringStep = false
      }

      this.callbacks.onScoringModeCompleted?.(info)

      logger.info(`[GuestPhaseHandler] Scoring complete: player=${info.playerId}, points=${info.points}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle scoring mode complete:', e)
    }
  }

  /**
   * Handle action result from host (response to guest's action request)
   */
  handleActionResult(message: { data: string }): void {
    try {
      const binaryData = parsePhaseMessage(message)

      if (binaryData.length < 4) {
        throw new Error(`Invalid action result data: ${binaryData.length} bytes, expected 4`)
      }

      const success = binaryData[0] === 1
      const newPhase = binaryData[1] as GamePhase
      const newActivePlayer = binaryData[2] || null

      if (!success) {
        this.callbacks.onActionRejected?.('Action rejected by host')
        return
      }

      if (this.currentState) {
        this.currentState.currentPhase = newPhase
        this.currentState.activePlayerId = newActivePlayer
      }

      logger.debug(`[GuestPhaseHandler] Action result: success=${success}, newPhase=${newPhase}`)
    } catch (e) {
      logger.error('[GuestPhaseHandler] Failed to handle action result:', e)
    }
  }

  /**
   * Request a phase action from the host
   * Guests send requests but host makes final decision
   */
  requestPhaseAction(
    action: string,
    playerId: number,
    data?: any
  ): { type: string; data: string; timestamp: number } | null {
    // Map action string to enum
    const actionMap: Record<string, PhaseActionType> = {
      'NEXT_PHASE': PhaseActionType.NEXT_PHASE,
      'PREVIOUS_PHASE': PhaseActionType.PREVIOUS_PHASE,
      'PASS_TURN': PhaseActionType.PASS_TURN,
      'START_SCORING': PhaseActionType.START_SCORING,
      'SELECT_LINE': PhaseActionType.SELECT_LINE,
      'ROUND_COMPLETE': PhaseActionType.ROUND_COMPLETE,
      'START_NEXT_ROUND': PhaseActionType.START_NEXT_ROUND,
      'START_NEW_MATCH': PhaseActionType.START_NEW_MATCH,
    }

    const actionType = actionMap[action]
    if (actionType === undefined) {
      logger.warn(`[GuestPhaseHandler] Unknown action: ${action}`)
      return null
    }

    const binaryData = encodePhaseAction(actionType, playerId, data)
    const message = createPhaseMessage(binaryData, 'PHASE_ACTION_REQUEST')

    logger.info(`[GuestPhaseHandler] Requesting phase action: ${action} for player ${playerId}`)

    return message
  }

  /**
   * Get current phase state
   */
  getCurrentPhaseState(): PhaseState | null {
    return this.currentState
  }

  /**
   * Update callbacks
   */
  updateCallbacks(callbacks: Partial<GuestPhaseCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * Reset handler state
   */
  reset(): void {
    this.currentState = null
  }
}

/**
 * Helper: Apply phase state to game state
 * Updates the game state with phase information received from host
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

/**
 * Helper: Initialize phase state from game state
 */
export function initializePhaseStateFromGameState(gameState: GameState): PhaseState {
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

export default GuestPhaseHandler
