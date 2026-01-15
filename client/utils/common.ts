/**
 * Common utility functions shared across the application
 */

/**
 * Deep clone a GameState using structuredClone with fallback
 * Prefer structuredClone for better performance and type preservation
 */
export function deepCloneState<T>(state: T): T {
  if (typeof structuredClone !== 'undefined') {
    return structuredClone(state)
  }
  return JSON.parse(JSON.stringify(state)) as T
}

/**
 * Timing constants used throughout the application
 */
export const TIMING = {
  /** Delay before clearing ability mode after execution (ms) */
  MODE_CLEAR_DELAY: 100,
  /** Delay before tooltip appears (ms) */
  TOOLTIP_DELAY: 250,
  /** Delay before reconnect attempt (ms) */
  RECONNECT_DELAY: 3000,
  /** Delay before resending deck data to server (ms) */
  DECK_SYNC_DELAY: 500,
  /** Duration for floating text to remain visible (ms) */
  FLOATING_TEXT_DURATION: 10000,
  /** Delay before cleaning up inactive games (ms) */
  INACTIVITY_TIMEOUT: 300000,
  /** Delay before terminating empty game (ms) */
  GAME_CLEANUP_DELAY: 30000,
  /** Delay before converting disconnected player to dummy (ms) */
  PLAYER_DUMMY_DELAY: 120000,
} as const

/**
 * Game constants
 */
export const GAME = {
  /** Maximum number of players in a game */
  MAX_PLAYERS: 4,
  /** Grid sizes available */
  GRID_SIZES: [4, 5, 6, 7] as const,
  /** Phase indices */
  PHASE: {
    SETUP: 0,
    MAIN: 1,
    COMMIT: 2,
    SCORING: 3,
  } as const,
  /** Default grid size */
  DEFAULT_GRID_SIZE: 6,
} as const

export type GridSize = typeof GAME.GRID_SIZES[number]
