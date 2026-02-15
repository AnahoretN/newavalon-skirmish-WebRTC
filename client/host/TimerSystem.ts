/**
 * Timer System for Host P2P
 * Handles disconnect timers, inactivity timeouts, and game termination
 * Ported from server/services/gameLifecycle.ts
 */

import type { GameState } from '../types'
import type { HostConnectionManager } from './HostConnectionManager'
import { logger } from '../utils/logger'

/**
 * Timer configuration
 */
const TIMER_CONFIG = {
  INACTIVITY_TIMEOUT: 5 * 60 * 1000,  // 5 minutes
  PLAYER_DISCONNECT_DELAY: 2 * 60 * 1000,  // 2 minutes before converting to dummy
  GAME_CLEANUP_DELAY: 10 * 60 * 1000,  // 10 minutes before game termination
  TURN_TIMEOUT: 5 * 60 * 1000  // 5 minutes per turn (optional)
}

/**
 * Timer types
 */
type TimerType = 'inactivity' | 'disconnect' | 'cleanup' | 'turn'

/**
 * Timer entry
 */
interface TimerEntry {
  type: TimerType
  playerId?: number
  timeoutId: NodeJS.Timeout
  startTime: number
  duration: number
}

/**
 * Timer Events for callbacks
 */
export interface TimerEvents {
  onPlayerDisconnectTimeout?: (playerId: number) => void
  onGameInactivityTimeout?: () => void
  onGameCleanupTimeout?: () => void
  onTurnTimeout?: (playerId: number) => void
}

/**
 * Timer System Manager
 */
export class TimerSystem {
  private timers: Map<string, TimerEntry> = new Map()
  private events: TimerEvents
  private lastActivityTime: number = Date.now()
  private gameState: GameState | null = null

  constructor(_connectionManager: HostConnectionManager, events: TimerEvents = {}) {
    this.events = events
  }

  /**
   * Set the current game state
   */
  setGameState(state: GameState): void {
    this.gameState = state
  }

  /**
   * Reset inactivity timer (called on any player action)
   */
  resetInactivityTimer(): void {
    this.clearTimer('inactivity')
    this.lastActivityTime = Date.now()

    // Only set inactivity timer if game is started and has players
    if (this.gameState?.isGameStarted && this.gameState.players.some(p => !p.isDummy && !p.isDisconnected)) {
      this.setTimer({
        type: 'inactivity',
        timeoutId: setTimeout(() => {
          logger.warn('[TimerSystem] Inactivity timeout reached')
          if (this.events.onGameInactivityTimeout) {
            this.events.onGameInactivityTimeout()
          }
        }, TIMER_CONFIG.INACTIVITY_TIMEOUT),
        startTime: Date.now(),
        duration: TIMER_CONFIG.INACTIVITY_TIMEOUT
      })
      logger.info('[TimerSystem] Inactivity timer reset')
    }
  }

  /**
   * Start player disconnect timer
   */
  startPlayerDisconnectTimer(playerId: number): void {
    const timerKey = `disconnect_${playerId}`

    // Clear existing timer for this player
    this.clearTimer(timerKey)

    this.setTimer({
      type: 'disconnect',
      playerId,
      timeoutId: setTimeout(() => {
        logger.warn(`[TimerSystem] Player ${playerId} disconnect timeout reached`)
        if (this.events.onPlayerDisconnectTimeout) {
          this.events.onPlayerDisconnectTimeout(playerId)
        }
      }, TIMER_CONFIG.PLAYER_DISCONNECT_DELAY),
      startTime: Date.now(),
      duration: TIMER_CONFIG.PLAYER_DISCONNECT_DELAY
    })
    logger.info(`[TimerSystem] Disconnect timer started for player ${playerId}`)
  }

  /**
   * Cancel player disconnect timer
   */
  cancelPlayerDisconnectTimer(playerId: number): void {
    const timerKey = `disconnect_${playerId}`
    this.clearTimer(timerKey)
    logger.info(`[TimerSystem] Disconnect timer cancelled for player ${playerId}`)
  }

  /**
   * Start turn timer for active player
   */
  startTurnTimer(playerId: number): void {
    const timerKey = `turn_${playerId}`

    // Clear existing turn timer
    this.clearTimer(timerKey)

    this.setTimer({
      type: 'turn',
      playerId,
      timeoutId: setTimeout(() => {
        logger.warn(`[TimerSystem] Turn timeout for player ${playerId}`)
        if (this.events.onTurnTimeout) {
          this.events.onTurnTimeout(playerId)
        }
      }, TIMER_CONFIG.TURN_TIMEOUT),
      startTime: Date.now(),
      duration: TIMER_CONFIG.TURN_TIMEOUT
    })
    logger.info(`[TimerSystem] Turn timer started for player ${playerId}`)
  }

  /**
   * Cancel turn timer for player
   */
  cancelTurnTimer(playerId: number): void {
    const timerKey = `turn_${playerId}`
    this.clearTimer(timerKey)
    logger.info(`[TimerSystem] Turn timer cancelled for player ${playerId}`)
  }

  /**
   * Schedule game termination (cleanup)
   */
  scheduleGameTermination(): void {
    this.clearTimer('cleanup')

    this.setTimer({
      type: 'cleanup',
      timeoutId: setTimeout(() => {
        logger.warn('[TimerSystem] Game cleanup timeout reached')
        if (this.events.onGameCleanupTimeout) {
          this.events.onGameCleanupTimeout()
        }
      }, TIMER_CONFIG.GAME_CLEANUP_DELAY),
      startTime: Date.now(),
      duration: TIMER_CONFIG.GAME_CLEANUP_DELAY
    })
    logger.info('[TimerSystem] Game termination scheduled')
  }

  /**
   * Cancel game termination
   */
  cancelGameTermination(): void {
    this.clearTimer('cleanup')
    logger.info('[TimerSystem] Game termination cancelled')
  }

  /**
   * Get remaining time for a timer
   */
  getRemainingTime(timerKey: string): number {
    const timer = this.timers.get(timerKey)
    if (!timer) {return 0}

    const elapsed = Date.now() - timer.startTime
    return Math.max(0, timer.duration - elapsed)
  }

  /**
   * Get inactivity time elapsed
   */
  getInactivityTime(): number {
    return Date.now() - this.lastActivityTime
  }

  /**
   * Check if any disconnect timers are active
   */
  hasActiveDisconnectTimers(): boolean {
    for (const [, timer] of this.timers) {
      if (timer.type === 'disconnect') {return true}
    }
    return false
  }

  /**
   * Get all active timers for a player
   */
  getPlayerTimers(playerId: number): TimerType[] {
    const playerTimers: TimerType[] = []
    for (const [, timer] of this.timers) {
      if (timer.playerId === playerId) {
        playerTimers.push(timer.type)
      }
    }
    return playerTimers
  }

  /**
   * Set a timer
   */
  private setTimer(entry: TimerEntry): void {
    const key = entry.playerId !== undefined
      ? `${entry.type}_${entry.playerId}`
      : entry.type

    // Clear existing timer with same key
    this.clearTimer(key)

    this.timers.set(key, entry)
  }

  /**
   * Clear a timer
   */
  private clearTimer(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer.timeoutId)
      this.timers.delete(key)
    }
  }

  /**
   * Clear all timers
   */
  clearAllTimers(): void {
    for (const [, timer] of this.timers) {
      clearTimeout(timer.timeoutId)
    }
    this.timers.clear()
    logger.info('[TimerSystem] All timers cleared')
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.clearAllTimers()
    this.gameState = null
  }
}

/**
 * Export timer config for external use
 */
export { TIMER_CONFIG }
