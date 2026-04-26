/**
 * AI Controller
 *
 * Main controller for the AI system. Orchestrates the decision-making
 * process and executes AI actions for dummy players.
 *
 * This is the entry point for AI functionality - call this when a
 * dummy player's turn starts.
 */

import type { GameState, Card } from '../types'
import type {
  AIConfig,
  AIExecutionContext,
  AIGamePhase,
  AIExecutionResult
} from './types'
import { DEFAULT_AI_CONFIG } from './types'
import { AIActionExecutor, AIActionCallbacks } from './AIActionExecutor'
import { analyzeBoardSituation } from './AIDecisionEngine'

/**
 * AI Controller Class
 *
 * Manages the AI decision-making process for a single dummy player.
 */
export class AIController {
  private config: AIConfig
  private executor: AIActionExecutor | null = null
  private isProcessing: boolean = false
  private currentPhase: AIGamePhase = -1
  private actionQueue: Array<() => Promise<void>> = []
  private gameState: GameState
  private playerId: number

  constructor(gameState: GameState, playerId: number, config?: Partial<AIConfig>) {
    this.gameState = gameState
    this.playerId = playerId
    this.config = { ...DEFAULT_AI_CONFIG, ...config }
  }

  /**
   * Update AI configuration
   */
  updateConfig(config: Partial<AIConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Enable or disable the AI
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  /**
   * Check if AI is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Check if AI is currently processing a turn
   */
  isProcessingTurn(): boolean {
    return this.isProcessing
  }

  /**
   * Update the game state (call when state changes)
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState
    if (this.executor) {
      this.executor.updateGameState(gameState)
    }
  }

  /**
   * Start the AI turn for the current phase
   * This is the main entry point for AI decision-making
   */
  async startTurn(callbacks: AIActionCallbacks): Promise<AIExecutionResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        action: 'disabled',
        description: 'AI is disabled'
      }
    }

    if (this.isProcessing) {
      return {
        success: false,
        action: 'busy',
        description: 'AI is already processing'
      }
    }

    this.isProcessing = true

    // Create executor if not exists
    if (!this.executor) {
      this.executor = new AIActionExecutor(this.gameState, this.playerId, callbacks)
    }

    try {
      // Determine current phase
      this.currentPhase = this.gameState.currentPhase as AIGamePhase

      // Create execution context
      const situation = analyzeBoardSituation(this.gameState, this.playerId)
      const context: AIExecutionContext = {
        gameState: this.gameState,
        playerId: this.playerId,
        phase: this.currentPhase,
        situation,
        config: this.config
      }

      // Add thinking delay for more natural feel
      if (this.config.thinkingDelay > 0) {
        await this.sleep(this.config.thinkingDelay)
      }

      // Execute the best action
      const result = await this.executor!.executeBestAction(context)

      return result
    } catch (error) {
      console.error('[AI] Error during turn execution:', error)
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
   * Continue AI turn (call after an action completes)
   */
  async continueTurn(callbacks: AIActionCallbacks): Promise<AIExecutionResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        action: 'disabled',
        description: 'AI is disabled'
      }
    }

    return await this.startTurn(callbacks)
  }

  /**
   * Check if AI should take an action now
   */
  shouldActNow(): boolean {
    // Check if it's this player's turn
    if (this.gameState.activePlayerId !== this.playerId) {
      return false
    }

    // Check if AI is enabled
    if (!this.config.enabled) {
      return false
    }

    // Check if player is a dummy
    const player = this.gameState.players.find(p => p.id === this.playerId)
    if (!player || !player.isDummy) {
      return false
    }

    // Check if game is started
    if (!this.gameState.isGameStarted) {
      return false
    }

    return true
  }

  /**
   * Get the current AI configuration
   */
  getConfig(): AIConfig {
    return { ...this.config }
  }

  /**
   * Get AI status information
   */
  getStatus(): {
    enabled: boolean
    processing: boolean
    phase: AIGamePhase
    playerId: number
  } {
    return {
      enabled: this.config.enabled,
      processing: this.isProcessing,
      phase: this.currentPhase,
      playerId: this.playerId
    }
  }

  /**
   * Reset AI state (call between turns)
   */
  reset(): void {
    this.isProcessing = false
    this.actionQueue = []
    this.currentPhase = -1
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Global AI Manager
 *
 * Manages AI controllers for all dummy players in the game.
 */
export class AIManager {
  private controllers: Map<number, AIController> = new Map()
  private globalEnabled: boolean = false
  private gameState: GameState | null = null

  /**
   * Initialize AI Manager with game state
   */
  initialize(gameState: GameState): void {
    this.gameState = gameState

    // Create controllers for all dummy players
    gameState.players.forEach(player => {
      if (player.isDummy) {
        const controller = new AIController(gameState, player.id)
        controller.setEnabled(this.globalEnabled)
        this.controllers.set(player.id, controller)
      }
    })
  }

  /**
   * Update game state and refresh controllers
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState

    // Update existing controllers
    this.controllers.forEach((controller, playerId) => {
      controller.updateGameState(gameState)
    })

    // Add new dummy players
    gameState.players.forEach(player => {
      if (player.isDummy && !this.controllers.has(player.id)) {
        const controller = new AIController(gameState, player.id)
        controller.setEnabled(this.globalEnabled)
        this.controllers.set(player.id, controller)
      }
    })

    // Remove players that are no longer dummy
    this.controllers.forEach((controller, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      if (!player || !player.isDummy) {
        this.controllers.delete(playerId)
      }
    })
  }

  /**
   * Enable or disable AI globally
   */
  setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled
    this.controllers.forEach(controller => {
      controller.setEnabled(enabled)
    })
  }

  /**
   * Check if AI is globally enabled
   */
  isGloballyEnabled(): boolean {
    return this.globalEnabled
  }

  /**
   * Get AI controller for a specific player
   */
  getController(playerId: number): AIController | undefined {
    return this.controllers.get(playerId)
  }

  /**
   * Get all AI controllers
   */
  getAllControllers(): AIController[] {
    return Array.from(this.controllers.values())
  }

  /**
   * Start AI turn for the active player if they're a dummy
   */
  async startTurnForActivePlayer(callbacks: AIActionCallbacks): Promise<AIExecutionResult | null> {
    if (!this.gameState || this.gameState.activePlayerId === null) {
      return null
    }

    const controller = this.controllers.get(this.gameState.activePlayerId)
    if (!controller || !controller.shouldActNow()) {
      return null
    }

    return await controller.startTurn(callbacks)
  }

  /**
   * Check if the active player is a dummy with AI enabled
   */
  shouldActivePlayerUseAI(): boolean {
    if (!this.gameState || !this.globalEnabled) {
      return false
    }

    if (this.gameState.activePlayerId === null) {
      return false
    }

    const controller = this.controllers.get(this.gameState.activePlayerId)
    return controller?.shouldActNow() || false
  }

  /**
   * Reset all controllers
   */
  resetAll(): void {
    this.controllers.forEach(controller => controller.reset())
  }

  /**
   * Clear all controllers
   */
  clear(): void {
    this.controllers.clear()
    this.gameState = null
  }
}

/**
 * Global AI Manager instance
 */
export const globalAIManager = new AIManager()

/**
 * Convenience function to initialize AI from game state
 */
export function initializeAI(gameState: GameState, enabled?: boolean): void {
  globalAIManager.initialize(gameState)
  if (enabled !== undefined) {
    globalAIManager.setGlobalEnabled(enabled)
  }
}

/**
 * Convenience function to set AI enabled state
 */
export function setAIEnabled(enabled: boolean): void {
  globalAIManager.setGlobalEnabled(enabled)
}

/**
 * Convenience function to check if AI is enabled
 */
export function isAIEnabled(): boolean {
  return globalAIManager.isGloballyEnabled()
}

/**
 * Convenience function to get AI status
 */
export function getAIStatus(): {
  enabled: boolean
  dummyPlayerCount: number
  activePlayerIsAI: boolean
} {
  return {
    enabled: globalAIManager.isGloballyEnabled(),
    dummyPlayerCount: globalAIManager.getAllControllers().length,
    activePlayerIsAI: globalAIManager.shouldActivePlayerUseAI()
  }
}
