/**
 * Game Logger for Host P2P
 * Logs game actions for debugging and replay
 * Ported from server/services/gameState.ts logging functionality
 */

import type { GameState } from '../types'
import type { HostConnectionManager } from './HostConnectionManager'
import { logger } from '../utils/logger'

/**
 * Log entry structure
 */
export interface GameLogEntry {
  timestamp: number
  round?: number
  phase?: number
  playerId?: number
  playerName?: string
  action: string
  details?: any
}

/**
 * Game Logger configuration
 */
interface GameLoggerConfig {
  maxLogEntries?: number  // Maximum entries to keep in memory
  enableConsoleLogging?: boolean  // Whether to log to console
}

/**
 * Game Logger Manager
 */
export class GameLogger {
  private connectionManager: HostConnectionManager
  private logs: GameLogEntry[] = []
  private config: Required<GameLoggerConfig>
  private gameState: GameState | null = null

  constructor(connectionManager: HostConnectionManager, config: GameLoggerConfig = {}) {
    this.connectionManager = connectionManager
    this.config = {
      maxLogEntries: config.maxLogEntries ?? 1000,
      enableConsoleLogging: config.enableConsoleLogging ?? true
    }
  }

  /**
   * Set the current game state
   */
  setGameState(state: GameState): void {
    this.gameState = state
  }

  /**
   * Log a game action
   */
  logAction(action: string, details?: any, playerId?: number): void {
    const entry: GameLogEntry = {
      timestamp: Date.now(),
      round: this.gameState?.currentRound,
      phase: this.gameState?.currentPhase,
      playerId,
      playerName: this.getPlayerName(playerId),
      action,
      details
    }

    this.logs.push(entry)

    // Trim logs if exceeds max size
    if (this.logs.length > this.config.maxLogEntries) {
      this.logs.shift()
    }

    if (this.config.enableConsoleLogging) {
      const playerInfo = playerId ? `[Player ${playerId}]` : '[System]'
      logger.info(`[GameLog] ${playerInfo} ${action}`, details ? JSON.stringify(details) : '')
    }
  }

  /**
   * Log phase transition
   */
  logPhaseTransition(fromPhase: number, toPhase: number): void {
    this.logAction('PHASE_TRANSITION', {
      from: this.getPhaseName(fromPhase),
      to: this.getPhaseName(toPhase)
    })
  }

  /**
   * Log turn change
   */
  logTurnChange(fromPlayerId: number, toPlayerId: number): void {
    this.logAction('TURN_CHANGE', {
      from: this.getPlayerName(fromPlayerId),
      to: this.getPlayerName(toPlayerId)
    })
  }

  /**
   * Log card play
   */
  logCardPlay(playerId: number, cardId: string, target?: { row: number; col: number }): void {
    this.logAction('CARD_PLAYED', {
      cardId,
      target
    }, playerId)
  }

  /**
   * Log score change
   */
  logScoreChange(playerId: number, oldScore: number, newScore: number, reason: string): void {
    this.logAction('SCORE_CHANGE', {
      oldScore,
      newScore,
      delta: newScore - oldScore,
      reason
    }, playerId)
  }

  /**
   * Log round start
   */
  logRoundStart(roundNumber: number): void {
    this.logAction('ROUND_START', { roundNumber })
  }

  /**
   * Log round end
   */
  logRoundEnd(roundNumber: number, winners: number[]): void {
    this.logAction('ROUND_END', {
      roundNumber,
      winners: winners.map(id => this.getPlayerName(id))
    })
  }

  /**
   * Log game start
   */
  logGameStart(playerIds: number[]): void {
    this.logAction('GAME_START', {
      players: playerIds.map(id => this.getPlayerName(id))
    })
  }

  /**
   * Log game end
   */
  logGameEnd(winnerId: number | null, reason: string): void {
    this.logAction('GAME_END', {
      winner: winnerId ? this.getPlayerName(winnerId) : 'Draw',
      reason
    })
  }

  /**
   * Log player disconnect
   */
  logPlayerDisconnect(playerId: number, reason: string): void {
    this.logAction('PLAYER_DISCONNECT', {
      reason
    }, playerId)
  }

  /**
   * Log player reconnect
   */
  logPlayerReconnect(playerId: number): void {
    this.logAction('PLAYER_RECONNECT', {}, playerId)
  }

  /**
   * Log player converted to dummy
   */
  logPlayerToDummy(playerId: number): void {
    this.logAction('PLAYER_CONVERTED_TO_DUMMY', {}, playerId)
  }

  /**
   * Log command execution
   */
  logCommandExecution(playerId: number, commandCardId: string, success: boolean): void {
    this.logAction('COMMAND_EXECUTION', {
      commandCardId,
      success
    }, playerId)
  }

  /**
   * Get all logs
   */
  getLogs(): GameLogEntry[] {
    return [...this.logs]
  }

  /**
   * Get logs for a specific player
   */
  getPlayerLogs(playerId: number): GameLogEntry[] {
    return this.logs.filter(log => log.playerId === playerId)
  }

  /**
   * Get logs for a specific round
   */
  getRoundLogs(roundNumber: number): GameLogEntry[] {
    return this.logs.filter(log => log.round === roundNumber)
  }

  /**
   * Get logs since a timestamp
   */
  getLogsSince(timestamp: number): GameLogEntry[] {
    return this.logs.filter(log => log.timestamp >= timestamp)
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number): GameLogEntry[] {
    return this.logs.slice(-count)
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = []
    logger.info('[GameLogger] Logs cleared')
  }

  /**
   * Export logs as JSON string
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  /**
   * Import logs from JSON string
   */
  importLogs(jsonString: string): void {
    try {
      const imported = JSON.parse(jsonString) as GameLogEntry[]
      if (Array.isArray(imported)) {
        this.logs = imported
        logger.info(`[GameLogger] Imported ${imported.length} log entries`)
      }
    } catch (err) {
      logger.error('[GameLogger] Failed to import logs:', err)
    }
  }

  /**
   * Get statistics from logs
   */
  getStatistics(): {
    totalActions: number
    actionsByPlayer: Map<number, number>
    actionsByType: Map<string, number>
    roundsPlayed: number
    gameDuration: number
  } {
    const actionsByPlayer = new Map<number, number>()
    const actionsByType = new Map<string, number>()
    let roundsPlayed = 0

    for (const log of this.logs) {
      // Count by player
      if (log.playerId !== undefined) {
        actionsByPlayer.set(
          log.playerId,
          (actionsByPlayer.get(log.playerId) || 0) + 1
        )
      }

      // Count by action type
      actionsByType.set(
        log.action,
        (actionsByType.get(log.action) || 0) + 1
      )

      // Track rounds
      if (log.round && log.round > roundsPlayed) {
        roundsPlayed = log.round
      }
    }

    // Calculate game duration
    const gameDuration = this.logs.length > 0
      ? this.logs[this.logs.length - 1].timestamp - this.logs[0].timestamp
      : 0

    return {
      totalActions: this.logs.length,
      actionsByPlayer,
      actionsByType,
      roundsPlayed,
      gameDuration
    }
  }

  /**
   * Broadcast logs to all guests (for debugging/replay)
   */
  broadcastLogs(): void {
    this.connectionManager.broadcast({
      type: 'GAME_LOGS',
      senderId: this.connectionManager.getPeerId(),
      data: { logs: this.logs },
      timestamp: Date.now()
    })
    logger.info(`[GameLogger] Broadcasted ${this.logs.length} log entries`)
  }

  /**
   * Get player name from ID
   */
  private getPlayerName(playerId?: number): string {
    if (playerId === undefined) {return 'System'}
    if (!this.gameState) {return `Player ${playerId}`}

    const player = this.gameState.players.find(p => p.id === playerId)
    return player?.name || `Player ${playerId}`
  }

  /**
   * Get phase name from index
   */
  private getPhaseName(phase: number): string {
    const names = ['Preparation', 'Setup', 'Main', 'Commit', 'Scoring']
    return names[phase] || `Phase ${phase}`
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.logs = []
    this.gameState = null
  }
}
