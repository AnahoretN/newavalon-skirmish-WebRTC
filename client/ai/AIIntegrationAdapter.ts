/**
 * AI Integration Adapter
 *
 * Adapts the new AI system to work with the existing game code.
 * Provides a bridge between AI callbacks and game functions.
 */

import type { GameState, Card } from '../types'
import type { AIActionCallbacks, PhaseExecutionResult } from './types'
import { AIPhaseController } from './AIPhaseController'
import type { AIExecutionContext } from './types'
import { analyzeBoardSituation } from './AIDecisionEngine'
import { DEFAULT_AI_CONFIG } from './types'

/**
 * Integration options
 */
export interface AIIntegrationOptions {
  thinkingDelay?: number
  onPhaseChange?: (newPhase: number) => void
  onActionComplete?: () => void
}

/**
 * AI Integration Adapter
 *
 * Manages AI execution for dummy players using the new phase-based system.
 */
export class AIIntegrationAdapter {
  private gameState: GameState
  private playerId: number
  private phaseController: AIPhaseController
  private callbacks: AIActionCallbacks
  private options: AIIntegrationOptions
  private isProcessing: boolean = false

  constructor(
    gameState: GameState,
    playerId: number,
    callbacks: AIActionCallbacks,
    options: AIIntegrationOptions = {}
  ) {
    this.gameState = gameState
    this.playerId = playerId
    this.callbacks = callbacks
    this.options = {
      thinkingDelay: 800,
      ...options
    }
    this.phaseController = new AIPhaseController(gameState, playerId)
  }

  /**
   * Update game state
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState
    this.phaseController.updateGameState(gameState)
  }

  /**
   * Execute AI turn for current phase
   */
  async executeTurn(): Promise<{
    success: boolean
    action: string
    description: string
    nextPhase?: number
    shouldPassTurn?: boolean
    shouldContinue?: boolean
  }> {
    if (this.isProcessing) {
      return {
        success: false,
        action: 'busy',
        description: 'AI is already processing'
      }
    }

    this.isProcessing = true

    try {
      // Add thinking delay
      if (this.options.thinkingDelay && this.options.thinkingDelay > 0) {
        await this.sleep(this.options.thinkingDelay)
      }

      // Create execution context
      const situation = analyzeBoardSituation(this.gameState, this.playerId)
      const context: AIExecutionContext = {
        gameState: this.gameState,
        playerId: this.playerId,
        phase: this.gameState.currentPhase as any,
        situation,
        config: DEFAULT_AI_CONFIG
      }

      // Execute based on current phase
      const phase = this.gameState.currentPhase

      let result

      switch (phase) {
        case -1: // Preparation (Draw)
          result = await this.executeDrawPhase()
          break
        case 1: // Setup
          result = await this.phaseController.executeSetupPhase(context, this.callbacks)
          break
        case 2: // Main
          result = await this.phaseController.executeMainPhase(context, this.callbacks)
          break
        case 3: // Commit
          result = await this.phaseController.executeCommitPhase(context, this.callbacks)
          break
        case 4: // Scoring
          result = await this.phaseController.executeScoringPhase(context, this.callbacks)
          break
        default:
          result = {
            success: false,
            action: 'unknown_phase',
            description: `Unknown phase: ${phase}`
          }
      }

      // Notify callbacks
      if (this.options.onActionComplete) {
        this.options.onActionComplete()
      }

      if (result.nextPhase !== undefined && this.options.onPhaseChange) {
        this.options.onPhaseChange(result.nextPhase)
      }

      return result

    } catch (error) {
      console.error('[AI] Error executing turn:', error)
      return {
        success: false,
        action: 'error',
        description: error instanceof Error ? error.message : 'Unknown error'
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Check if AI should act now
   */
  shouldAct(): boolean {
    const player = this.gameState.players.find(p => p.id === this.playerId)
    return (
      this.gameState.activePlayerId === this.playerId &&
      !!player?.isDummy &&
      this.gameState.isGameStarted
    )
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing
  }

  /**
   * Reset turn state
   */
  resetTurn(): void {
    this.phaseController.resetTurn()
  }

  /**
   * Execute draw phase
   */
  private async executeDrawPhase(): Promise<{
    success: boolean
    action: string
    description: string
    nextPhase?: number
  }> {
    const player = this.gameState.players.find(p => p.id === this.playerId)
    if (!player) {
      return { success: false, action: 'draw', description: 'Player not found' }
    }

    // Draw card if available
    if (player.deck.length > 0 && player.hand.length < 7) {
      await this.callbacks.drawCard(this.playerId)
    }

    // Move to Setup
    return {
      success: true,
      action: 'draw_complete',
      description: 'Drew card',
      nextPhase: 1
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Create AI integration adapter with game function bindings
 */
export function createAIAdapter(
  gameState: GameState,
  playerId: number,
  gameFunctions: {
    drawCard: (playerId: number) => void | Promise<void>
    playCard: (card: Card, row: number, col: number, playerId: number, faceUp: boolean) => void | Promise<void>
    activateAbility: (card: Card, ability: any, sourceCoords: { row: number; col: number }, targetCoords: { row: number; col: number } | null) => void | Promise<void>
    scoreLine: (r1: number, c1: number, r2: number, c2: number, playerId: number) => void | Promise<void>
  },
  options?: AIIntegrationOptions
): AIIntegrationAdapter {
  const callbacks: AIActionCallbacks = {
    drawCard: gameFunctions.drawCard,
    playCard: gameFunctions.playCard,
    activateAbility: async (card, ability, sourceCoords, targetCoords) => {
      // This will need to be implemented based on how abilities work in the game
      await gameFunctions.activateAbility(card, ability, sourceCoords, targetCoords)
    },
    scoreLine: gameFunctions.scoreLine,
    createStack: async () => {
      // Placeholder - will be implemented based on game mechanics
      console.warn('[AI] createStack not implemented')
    },
    placeStackOnBoard: async () => {
      // Placeholder - will be implemented based on game mechanics
      console.warn('[AI] placeStackOnBoard not implemented')
    },
    passTurn: async () => {
      // Placeholder - will be implemented based on game mechanics
      console.warn('[AI] passTurn not implemented')
    }
  }

  return new AIIntegrationAdapter(gameState, playerId, callbacks, options)
}
