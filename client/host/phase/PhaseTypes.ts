/**
 * Phase Management Types
 *
 * Defines all types for the phase and turn management system in WebRTC P2P mode.
 * The host controls all phase transitions and broadcasts them to guests.
 */

import type { Card, GameState } from '../../types'

/**
 * Game phases as defined in the game rules
 * Phase 0 (Preparation) is invisible and runs automatic actions
 * Phases 1-4 are visible gameplay phases
 */
export enum GamePhase {
  PREPARATION = 0,    // Invisible - automatic draw, round victory check
  SETUP = 1,          // Place units face-up or face-down
  MAIN = 2,           // Activate abilities, play cards
  COMMIT = 3,         // Add counters/statuses
  SCORING = 4,        // Score points from completed lines
}

/**
 * Get display name for a phase
 */
export function getPhaseName(phase: GamePhase): string {
  const names = [
    'Preparation',   // Phase 0 - not shown to players
    'Setup',         // Phase 1
    'Main',          // Phase 2
    'Commit',        // Phase 3
    'Scoring'        // Phase 4
  ]
  return names[phase] || 'Unknown'
}

/**
 * Check if phase is the hidden preparation phase
 */
export function isPreparationPhase(phase: number): boolean {
  return phase === GamePhase.PREPARATION
}

/**
 * Check if phase is visible to players
 */
export function isVisiblePhase(phase: number): boolean {
  return phase >= GamePhase.SETUP && phase <= GamePhase.SCORING
}

/**
 * Phase transition reason - why the phase changed
 */
export enum PhaseTransitionReason {
  GAME_STARTED = 'game_started',           // Initial phase at game start
  TURN_STARTED = 'turn_started',           // New player's turn begins
  CARD_PLAYED = 'card_played',             // Card played during Setup -> transition to Main
  NEXT_PHASE = 'next_phase',               // Manual next phase button
  PREVIOUS_PHASE = 'previous_phase',       // Manual previous phase button
  SCORING_COMPLETE = 'scoring_complete',   // Scoring finished, ready to pass turn
  AUTO_TRANSITION = 'auto_transition',     // Automatic transition (e.g., Setup -> Main)
}

/**
 * Round end information
 */
export interface RoundEndInfo {
  roundNumber: number
  winners: number[]       // Player IDs who won this round
  roundWinners: Record<number, number[]>  // Updated round winners map
  isMatchOver: boolean    // True if someone won 2 rounds
  matchWinner: number | null  // Player who won the match, if any
}

/**
 * Scoring selection mode data
 * Used when active player must select a line to score
 */
export interface ScoringSelectionMode {
  isActive: boolean
  activePlayerId: number
  validLines: ScoringLine[]  // Lines that can be scored
  selectedLine: ScoringLine | null
}

/**
 * A scoring line (row, column, or diagonal)
 */
export interface ScoringLine {
  type: 'row' | 'col' | 'diagonal' | 'anti-diagonal'
  index: number           // For row/col: the index; for diagonals: 0
  cells: Array<{ row: number; col: number }>  // All cells in this line
  scoringPlayerId: number  // The player whose cards will be scored
  potentialPoints: number  // Total power of player's cards in this line
}

/**
 * Phase state - complete information about current phase
 * This is what gets synced between host and guests
 */
export interface PhaseState {
  currentPhase: GamePhase
  activePlayerId: number | null
  startingPlayerId: number | null  // The player who started the game (Turn 1)
  currentRound: number
  turnNumber: number
  isScoringStep: boolean           // True when waiting for line selection in Scoring phase
  isRoundEndModalOpen: boolean
  roundWinners: Record<number, number[]>  // Round number -> Winner player IDs
  gameWinner: number | null
  autoDrawEnabled: boolean
}

/**
 * Compact phase update message
 * Sent via SESSION_EVENT for minimal bandwidth
 */
export interface PhaseUpdateMessage {
  currentPhase: GamePhase
  activePlayerId: number | null
  isScoringStep?: boolean
  isRoundEndModalOpen?: boolean
  roundWinners?: Record<number, number[]>
  gameWinner?: number | null
  currentRound?: number
  turnNumber?: number
}

/**
 * Phase action that a player can request
 */
export enum PhaseAction {
  NEXT_PHASE = 'next_phase',
  PREVIOUS_PHASE = 'previous_phase',
  PASS_TURN = 'pass_turn',
  START_SCORING = 'start_scoring',
  SELECT_LINE = 'select_line',
  ROUND_COMPLETE = 'round_complete',
  START_NEXT_ROUND = 'start_next_round',
  START_NEW_MATCH = 'start_new_match',
}

/**
 * Result of a phase transition
 */
export interface PhaseTransitionResult {
  success: boolean
  oldPhase: GamePhase
  newPhase: GamePhase
  oldActivePlayer: number | null
  newActivePlayer: number | null
  reason: PhaseTransitionReason
  roundEndInfo?: RoundEndInfo  // Populated if round ended
  scoringStarted?: boolean     // True if entering scoring selection mode
}

/**
 * Callbacks for phase system events
 */
export interface PhaseSystemCallbacks {
  onPhaseChanged?: (result: PhaseTransitionResult) => void
  onRoundEnded?: (info: RoundEndInfo) => void
  onMatchEnded?: (winnerId: number | null) => void
  onScoringModeStarted?: (mode: ScoringSelectionMode) => void
  onScoringModeCompleted?: (playerId: number, line: ScoringLine, points: number) => void
  onCardDrawn?: (playerId: number, card: Card) => void
  onStateUpdateRequired?: (newState: GameState) => void
  onGuestShouldAutoDraw?: (playerId: number) => void  // Signal guest to auto-draw locally
}

/**
 * Configuration for phase system
 */
export interface PhaseSystemConfig {
  victoryThresholdBase: number    // Base victory threshold (10)
  victoryThresholdPerRound: number // Additional points per round (10)
  maxRounds: number               // Maximum rounds before match ends (3)
  autoDrawEnabled: boolean        // Whether auto-draw is enabled
  localPlayerId?: number | null   // ID of the host player (only perform auto-draw for this player and dummies)
}

/**
 * Default phase system configuration
 */
export const DEFAULT_PHASE_CONFIG: PhaseSystemConfig = {
  victoryThresholdBase: 10,
  victoryThresholdPerRound: 10,
  maxRounds: 3,
  autoDrawEnabled: true,
  localPlayerId: null,
}

/**
 * Calculate victory threshold for a given round
 * Round 1: 20 points (10 + 10*1)
 * Round 2: 30 points (10 + 10*2)
 * Round 3+: 40+ points (10 + 10*3)
 */
export function getVictoryThreshold(roundNumber: number): number {
  return 10 + (roundNumber * 10)
}

/**
 * Check if a player's score meets the victory threshold for the current round
 */
export function checkVictoryThreshold(score: number, roundNumber: number): boolean {
  return score >= getVictoryThreshold(roundNumber)
}

/**
 * Get next player in turn order
 */
export function getNextPlayer(
  currentPlayerId: number,
  allPlayerIds: number[]
): number {
  const currentIndex = allPlayerIds.indexOf(currentPlayerId)
  if (currentIndex === -1) {
    return allPlayerIds[0]
  }
  const nextIndex = (currentIndex + 1) % allPlayerIds.length
  return allPlayerIds[nextIndex]
}

/**
 * Get all non-dummy, non-disconnected player IDs in turn order
 */
export function getActivePlayerIds(players: Array<{ id: number; isDummy?: boolean; isDisconnected?: boolean }>): number[] {
  return players
    .filter(p => !p.isDummy && !p.isDisconnected)
    .map(p => p.id)
    .sort((a, b) => a - b)
}

/**
 * Check if round should end based on scores
 */
export function shouldRoundEnd(players: Array<{ id: number; score: number }>, roundNumber: number): boolean {
  const threshold = getVictoryThreshold(roundNumber)
  return players.some(p => p.score >= threshold)
}

/**
 * Determine round winners
 * Returns all players with the highest score
 */
export function determineRoundWinners(players: Array<{ id: number; score: number }>): number[] {
  const maxScore = Math.max(...players.map(p => p.score))
  return players.filter(p => p.score === maxScore).map(p => p.id)
}

/**
 * Check if match is over (someone won 2 rounds)
 */
export function checkMatchOver(roundWinners: Record<number, number[]>): {
  isOver: boolean
  winner: number | null
} {
  // Count round wins per player
  const winCounts = new Map<number, number>()

  for (const winners of Object.values(roundWinners)) {
    for (const winnerId of winners) {
      winCounts.set(winnerId, (winCounts.get(winnerId) || 0) + 1)
    }
  }

  // Check if anyone has 2+ wins
  for (const [playerId, winCount] of winCounts.entries()) {
    if (winCount >= 2) {
      return { isOver: true, winner: playerId }
    }
  }

  return { isOver: false, winner: null }
}
