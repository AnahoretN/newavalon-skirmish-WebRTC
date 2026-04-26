/**
 * AI Action Executor
 *
 * Executes the AI's decisions by calling the appropriate game functions.
 * Uses the new phase-based system.
 */

import type { GameState, Card } from '../types'
import type {
  AIExecutionContext,
  BoardSituation,
  AIActionCallbacks,
  AIExecutionResult,
  PhaseExecutionResult
} from './types'
import { analyzeBoardSituation } from './AIDecisionEngine'
import { AIPhaseController } from './AIPhaseController'

/**
 * AI Action Executor Class
 */
export class AIActionExecutor {
  private gameState: GameState
  private playerId: number
  private phaseController: AIPhaseController
  private actionCallbacks: AIActionCallbacks

  constructor(
    gameState: GameState,
    playerId: number,
    callbacks: AIActionCallbacks
  ) {
    this.gameState = gameState
    this.playerId = playerId
    this.actionCallbacks = callbacks
    this.phaseController = new AIPhaseController(gameState, playerId)
  }

  /**
   * Update the game state (for re-evaluation)
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState
    this.phaseController.updateGameState(gameState)
  }

  /**
   * Reset turn state
   */
  resetTurn(): void {
    this.phaseController.resetTurn()
  }

  /**
   * Execute the best action for the current situation
   */
  async executeBestAction(context: AIExecutionContext): Promise<AIExecutionResult> {
    const { phase, situation } = context

    // Re-analyze to get fresh data
    const freshSituation = analyzeBoardSituation(this.gameState, this.playerId)
    context.situation = freshSituation

    // Decide what to do based on phase
    switch (phase) {
      case -1: // Preparation (Draw phase)
        return await this.executeDrawPhase(context)
      case 1: // Setup
        return await this.executeSetupPhase(context)
      case 2: // Main
        return await this.executeMainPhase(context)
      case 3: // Commit
        return await this.executeCommitPhase(context)
      case 4: // Scoring
        return await this.executeScoringPhase(context)
      default:
        return { success: false, action: 'unknown_phase', description: 'Unknown phase' }
    }
  }

  /**
   * Execute during Preparation phase (draw card)
   */
  private async executeDrawPhase(context: AIExecutionContext): Promise<AIExecutionResult> {
    const player = this.gameState.players.find(p => p.id === this.playerId)
    if (!player) {
      return { success: false, action: 'draw', description: 'Player not found' }
    }

    // Draw card if not at hand limit
    if (player.hand.length < 7) {
      await this.actionCallbacks.drawCard(this.playerId)
      return {
        success: true,
        action: 'draw_card',
        description: 'AI drew a card',
        nextPhase: 1 // Move to Setup
      }
    }

    // Skip to Setup
    return {
      success: true,
      action: 'skip_draw',
      description: 'AI skipped draw (hand full)',
      nextPhase: 1
    }
  }

  /**
   * Execute during Setup phase
   */
  private async executeSetupPhase(context: AIExecutionContext): Promise<AIExecutionResult> {
    return await this.phaseController.executeSetupPhase(context, this.actionCallbacks)
  }

  /**
   * Execute during Main phase
   */
  private async executeMainPhase(context: AIExecutionContext): Promise<AIExecutionResult> {
    return await this.phaseController.executeMainPhase(context, this.actionCallbacks)
  }

  /**
   * Execute during Commit phase
   */
  private async executeCommitPhase(context: AIExecutionContext): Promise<AIExecutionResult> {
    return await this.phaseController.executeCommitPhase(context, this.actionCallbacks)
  }

  /**
   * Execute during Scoring phase
   */
  private async executeScoringPhase(context: AIExecutionContext): Promise<AIExecutionResult> {
    return await this.phaseController.executeScoringPhase(context, this.actionCallbacks)
  }
}

