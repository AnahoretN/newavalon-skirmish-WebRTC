/**
 * @file Game action logger
 * Logs all game actions to files for replay/reconstruction
 */

import { promises as fs } from 'fs';
import { join } from 'path';

// Store log streams for each game
const gameLogStreams = new Map<string, { stream: fs.FileHandle; path: string }>();

/**
 * Get log file path for a game
 */
function getLogFilePath(gameId: string): string {
  const logsDir = join(process.cwd(), 'logs');
  return join(logsDir, `game_${gameId}.log`);
}

/**
 * Ensure logs directory exists
 */
async function ensureLogsDir(): Promise<void> {
  const logsDir = join(process.cwd(), 'logs');
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

/**
 * Open log file for a game session
 */
export async function openGameLog(gameId: string, gameInfo?: Record<string, unknown>): Promise<void> {
  await ensureLogsDir();

  const logPath = getLogFilePath(gameId);
  const stream = await fs.open(logPath, 'a');

  gameLogStreams.set(gameId, { stream, path: logPath });

  // Write session header
  const timestamp = new Date().toISOString();
  await writeLogEntry(gameId, {
    type: 'SESSION_START',
    timestamp,
    gameId,
    ...gameInfo
  });
}

/**
 * Close log file for a game session
 */
export async function closeGameLog(gameId: string): Promise<void> {
  const logData = gameLogStreams.get(gameId);
  if (!logData) {return;}

  try {
    // Write session end
    await writeLogEntry(gameId, {
      type: 'SESSION_END',
      timestamp: new Date().toISOString(),
      gameId
    });
  } catch {
    // Ignore write errors during close
  }

  try {
    await logData.stream.close();
  } catch {
    // Stream may already be closed
  }

  gameLogStreams.delete(gameId);
}

/**
 * Write a log entry to the game's log file
 */
async function writeLogEntry(gameId: string, entry: Record<string, unknown>): Promise<void> {
  const logData = gameLogStreams.get(gameId);
  if (!logData) {return;}

  try {
    const logLine = JSON.stringify(entry) + '\n';
    // FileHandle.write() takes a buffer and returns { bytesWritten, buffer }
    await logData.stream.write(Buffer.from(logLine, 'utf-8'));
  } catch (error) {
    console.error('Failed to write game log entry:', error);
  }
}

/**
 * Log an action with structured data
 */
export async function logGameAction(
  gameId: string,
  actionType: string,
  data: Record<string, unknown>
): Promise<void> {
  const entry: Record<string, unknown> = {
    type: 'ACTION',
    actionType,
    timestamp: new Date().toISOString(),
    gameId,
    ...data
  };
  await writeLogEntry(gameId, entry);
}

/**
 * Action type helpers for consistent logging
 */
export const GameActions = {
  // Card lifecycle
  CARD_DRAWN: 'card_drawn',
  CARD_PLAYED: 'card_played',
  CARD_MOVED: 'card_moved',
  CARD_DESTROYED: 'card_destroyed',
  CARD_RETURNED_TO_HAND: 'card_returned_to_hand',
  CARD_DISCARDED: 'card_discarded',
  CARD_ANNOUNCED: 'card_announced',
  CARD_SHUFFLED: 'card_shuffled',
  CARD_SEARCHED: 'card_searched',

  // Token actions
  TOKEN_PLACED: 'token_placed',
  TOKEN_REMOVED: 'token_removed',

  // Counter actions
  COUNTER_PLACED: 'counter_placed',
  COUNTER_REMOVED: 'counter_removed',

  // Scoring
  SCORE_CHANGED: 'score_changed',

  // Phase/Round management
  PHASE_CHANGED: 'phase_changed',
  ROUND_STARTED: 'round_started',
  ROUND_ENDED: 'round_ended',
  MATCH_STARTED: 'match_started',
  MATCH_ENDED: 'match_ended',

  // Turn management
  TURN_STARTED: 'turn_started',
  TURN_ENDED: 'turn_ended',
  PLAYER_ACTIVATED: 'player_activated',

  // Abilities
  ABILITY_ACTIVATED: 'ability_activated',
  ABILITY_TRIGGERED: 'ability_triggered',

  // Commands
  COMMAND_ADDED: 'command_added',
  COMMAND_EXECUTED: 'command_executed',
  COMMAND_CANCELLED: 'command_cancelled',
  MODULE_SELECTED: 'module_selected',

  // Player management
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',

  // Game management
  GAME_CREATED: 'game_created',
  GAME_STARTED: 'game_started',
  GAME_RESET: 'game_reset',
  GAME_ENDED: 'game_ended',

  // Settings
  DECK_CHANGED: 'deck_changed',
  COLOR_CHANGED: 'color_changed',
  NAME_CHANGED: 'name_changed',
  TEAM_ASSIGNED: 'team_assigned',
  MODE_CHANGED: 'mode_changed',
  GRID_SIZE_CHANGED: 'grid_size_changed',
} as const;

/**
 * Close all open log streams (for shutdown)
 */
export async function closeAllLogs(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const gameId of gameLogStreams.keys()) {
    promises.push(closeGameLog(gameId));
  }
  await Promise.allSettled(promises);
}
