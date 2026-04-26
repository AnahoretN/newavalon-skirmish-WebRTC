/**
 * AI System Types
 * Defines all types for the AI decision-making system
 */

import type { Card, Player, Board, GameState, AbilityAction } from '../types'

/**
 * Priority levels for AI actions
 */
export enum ActionPriority {
  CRITICAL = 0,    // Must do immediately (e.g., lethal move)
  HIGH = 1,        // Very beneficial
  MEDIUM = 2,      // Normal priority
  LOW = 3,         // Only if nothing better
  PASSIVE = 4      // Passive effects, no action needed
}

/**
 * Game phases for AI decision-making
 */
export enum AIGamePhase {
  PREPARATION = -1, // Draw phase (hidden)
  SETUP = 1,         // Place cards face-up or face-down
  MAIN = 2,          // Activate abilities
  COMMIT = 3,        // Add counters/statuses
  SCORING = 4        // Score lines
}

/**
 * AI action types
 */
export enum AIActionType {
  PLAY_CARD = 'play_card',
  ACTIVATE_ABILITY = 'activate_ability',
  ADD_COUNTER = 'add_counter',
  SCORE_LINE = 'score_line',
  PASS_TURN = 'pass_turn',
  DRAW_CARD = 'draw_card'
}

/**
 * Card role classification for AI strategy
 */
export enum CardRole {
  WIN_CONDITION = 'win_condition',      // Primary scoring card
  SUPPORT = 'support',                  // Buffs other cards
  CONTROL = 'control',                  // Disrupts opponent
  THREAT = 'threat',                    // Applies pressure
  UTILITY = 'utility',                  // Flexible use
  TOKEN_GENERATOR = 'token_generator',  // Creates resources
  DEFENSIVE = 'defensive'               // Protects own cards
}

/**
 * Board situation assessment
 */
export interface BoardSituation {
  // Player's board state
  ownCardCount: number
  ownTotalPower: number
  ownCompletedLines: number
  ownPotentialLines: number

  // Opponents' board state
  opponentCardCount: number
  opponentTotalPower: number
  opponentCompletedLines: number
  opponentPotentialLines: number
  opponentThreats: number

  // Board control
  boardControlRatio: number // 0-1, higher means more control
  isEmptyBoard: boolean
  isLateGame: boolean
}

/**
 * AI action decision with priority
 */
export interface AIActionDecision {
  type: AIActionType
  priority: ActionPriority
  description: string
  execute: () => void | Promise<void>
  estimatedValue: number // How good this action is (can be negative)
  requirements?: string[] // What's needed to execute
}

/**
 * Card evaluation result
 */
export interface CardEvaluation {
  card: Card
  role: CardRole
  playabilityScore: number // 0-100, how good it is to play now
  powerScore: number // Raw power value
  utilityScore: number // Utility value
  timingScore: number // Timing appropriateness
  targetScore: number // Target availability
}

/**
 * Target evaluation for abilities
 */
export interface TargetEvaluation {
  coords: { row: number; col: number }
  score: number // Higher is better
  reason: string
}

/**
 * AI memory/knowledge entry
 * Represents a learned pattern or rule
 */
export interface AIKnowledgeEntry {
  id: string
  name: string
  description: string
  trigger: (situation: BoardSituation, gameState: GameState, playerId: number) => boolean
  action: AIActionType
  priority: ActionPriority
  value: number // Base value of this action
}

/**
 * AI configuration
 */
export interface AIConfig {
  enabled: boolean
  thinkingDelay: number // ms between actions (0 for instant)
  aggression: number // 0-1, how aggressive to play
  riskTolerance: number // 0-1, how much risk to take
  prioritizationWeights: {
    scoring: number
    control: number
    development: number
    defense: number
  }
}

/**
 * Default AI configuration
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  thinkingDelay: 500,
  aggression: 0.6,
  riskTolerance: 0.5,
  prioritizationWeights: {
    scoring: 1.0,
    control: 0.8,
    development: 0.7,
    defense: 0.6
  }
}

/**
 * AI execution context
 */
export interface AIExecutionContext {
  gameState: GameState
  playerId: number
  phase: AIGamePhase
  situation: BoardSituation
  config: AIConfig
}

/**
 * Result of executing an AI action
 */
export interface AIExecutionResult {
  success: boolean
  action: string
  description: string
  nextPhase?: number
  shouldPassTurn?: boolean
  shouldContinue?: boolean
}

/**
 * Result of executing a phase
 */
export interface PhaseExecutionResult {
  success: boolean
  action: string
  description: string
  nextPhase?: number
  shouldContinue?: boolean
}

/**
 * AI Action Callbacks
 * Functions that the AI needs to interact with the game
 */
export interface AIActionCallbacks {
  drawCard: (playerId: number) => void | Promise<void>
  playCard: (card: Card, row: number, col: number, playerId: number, faceUp: boolean) => void | Promise<void>
  activateAbility: (card: Card, ability: any, sourceCoords: { row: number; col: number }, targetCoords: { row: number; col: number } | null) => void | Promise<void>
  scoreLine: (r1: number, c1: number, r2: number, c2: number, playerId: number) => void | Promise<void>
  createStack: (tokenType: string, count: number) => void | Promise<void>
  placeStackOnBoard: (row: number, col: number) => void | Promise<void>
  passTurn: () => void | Promise<void>
}
