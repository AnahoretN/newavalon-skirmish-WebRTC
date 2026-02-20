/**
 * @file Game lifecycle service
 * Manages game termination, player disconnection, inactivity timers, and logging
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getGameState, deleteGameState, getPublicGames } from './gameState.js';
import { closeGameLog, logGameAction as logAction, GameActions } from '../utils/gameLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, '../../logs');
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const DISCONNECT_WARNING_MS = 10 * 1000; // 10 seconds - mark as disconnected
const DISCONNECT_REMOVE_MS = 5 * 60 * 1000; // 5 minutes - remove from game

// Timer storage
export const gameTerminationTimers = new Map(); // gameId -> NodeJS.Timeout
export const gameInactivityTimers = new Map(); // gameId -> NodeJS.Timeout
export const playerDisconnectTimers = new Map(); // Key: `${gameId}-${playerId}` -> NodeJS.Timeout

/**
 * Ensure logs directory exists
 */
async function ensureLogsDir() {
  try {
    await fs.access(LOGS_DIR);
  } catch {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  }
}

/**
 * Adds a timestamped message to a game's log
 */
export function logToGame(gameId: string, message: string, gameLogs: Map<string, string[]>) {
  if (!gameId) {return;}
  if (!gameLogs.has(gameId)) {
    gameLogs.set(gameId, []);
  }
  const logMessages = gameLogs.get(gameId);
  if (logMessages) {
    logMessages.push(`[${new Date().toISOString()}] ${message}`);
  }
}

/**
 * Transfers host status to the next real (non-dummy) player in turn order
 */
export function transferHost(gameId: string, currentHostId: number, gameLogs: Map<string, string[]>) {
  const gameState = getGameState(gameId);
  if (!gameState) {return null;}

  const players = gameState.players || [];
  const hostPlayer = players.find((p: any) => p.id === currentHostId);
  const hostPosition = hostPlayer?.position ?? 0;

  // Find next real player in turn order (starting from after host, wrapping around)
  let nextHost: any = null;
  for (let i = 1; i <= players.length; i++) {
    const checkPosition = (hostPosition + i) % players.length;
    const player = players.find((p: any) => p.position === checkPosition);
    if (player && !player.isDummy && !player.isDisconnected) {
      nextHost = player;
      break;
    }
  }

  if (nextHost) {
    const oldHostId = gameState.hostId;
    gameState.hostId = nextHost.id;
    logToGame(gameId, `Host transferred from Player ${oldHostId} to Player ${nextHost.id} (${nextHost.name})`, gameLogs);
    return nextHost.id;
  } else {
    logToGame(gameId, `No real players available to take over hosting`, gameLogs);
    return null;
  }
}

/**
 * Removes a player from the game and transfers host if needed
 */
export function removePlayerFromGame(
  gameId: string,
  playerId: number,
  gameLogs: Map<string, string[]>,
  broadcastState: (gameId: string, gameState: any) => void,
  broadcastGamesListFn: () => void
) {
  const gameState = getGameState(gameId);
  if (!gameState) {return;}

  const player = gameState.players.find((p: any) => p.id === playerId);
  if (!player) {return;}

  logToGame(gameId, `Player ${playerId} (${player.name}) removed from game after 5min disconnect timeout.`, gameLogs);

  // Check if this player is the host
  const wasHost = gameState.hostId === playerId;

  // Remove player from game
  gameState.players = gameState.players.filter((p: any) => p.id !== playerId);

  // Transfer host if needed
  if (wasHost && gameState.players.length > 0) {
    transferHost(gameId, playerId, gameLogs);
  }

  // Clean up both timers
  const disconnectTimerKey = `${gameId}-${playerId}-disconnect`;
  const removeTimerKey = `${gameId}-${playerId}-remove`;
  playerDisconnectTimers.delete(disconnectTimerKey);
  playerDisconnectTimers.delete(removeTimerKey);

  broadcastState(gameId, gameState);
  broadcastGamesListFn();
}

/**
 * Marks a player as disconnected after 10 seconds of disconnect
 */
export function markPlayerDisconnected(
  gameId: string,
  playerId: number,
  gameLogs: Map<string, string[]>,
  broadcastState: (gameId: string, gameState: any) => void
) {
  const gameState = getGameState(gameId);
  if (!gameState) {return;}

  const player = gameState.players.find((p: any) => p.id === playerId);
  if (player && !player.isDisconnected) {
    logToGame(gameId, `Player ${playerId} (${player.name}) marked as disconnected (10s timeout)`, gameLogs);

    player.isDisconnected = true;
    player.isReady = false;
    player.disconnectTimestamp = Date.now();

    broadcastState(gameId, gameState);
  }
}

/**
 * Ends a game, saves its log, and cleans up all associated data
 */
export async function endGame(
  gameId: string,
  reason: string,
  gameLogs: Map<string, string[]>,
  wss: any
) {
  const gameState = getGameState(gameId);

  // Log game end to file
  logAction(gameId, GameActions.GAME_ENDED, {
    reason,
    playerCount: gameState?.players.filter((p: any) => !p.isDummy).length || 0,
    finalScores: gameState?.players.map((p: any) => ({
      id: p.id,
      name: p.name,
      score: p.score
    })) || []
  }).catch();

  // Close the game log file
  closeGameLog(gameId).catch();

  logToGame(gameId, `Game ending due to: ${reason}.`, gameLogs);
  logger.info(`Ending game ${gameId} due to: ${reason}.`);

  // 1. Save the log file
  await ensureLogsDir();
  const logData = gameLogs.get(gameId);
  if (logData && logData.length > 0) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = path.join(LOGS_DIR, `game-${gameId}-${timestamp}.log`);
    try {
      await fs.writeFile(filename, logData.join('\n'));
    } catch (error) {
      logger.error(`Failed to write log for game ${gameId}:`, error);
    }
  }

  // 2. Clean up all in-memory data
  deleteGameState(gameId);
  gameLogs.delete(gameId);

  const timerId = gameTerminationTimers.get(gameId);
  if (timerId) {
    clearTimeout(timerId);
    gameTerminationTimers.delete(gameId);
  }

  const inactivityTimerId = gameInactivityTimers.get(gameId);
  if (inactivityTimerId) {
    clearTimeout(inactivityTimerId);
    gameInactivityTimers.delete(gameId);
  }

  // Clean up any pending player conversion timers for this game
  for (const [key, timer] of playerDisconnectTimers.entries()) {
    if (key.startsWith(`${gameId}-`)) {
      clearTimeout(timer);
      playerDisconnectTimers.delete(key);
    }
  }

  // 3. Disconnect any remaining clients (spectators) in that game
  if (wss && wss.clients) {
    const clients = wss.clients;
    clients.forEach((client: any) => {
      if (client.gameId === gameId) {
        client.terminate(); // Forcefully close the connection
      }
    });
  }

  // 4. Update the public games list for all clients
  broadcastGamesList(gameLogs, wss);
}

/**
 * Resets the inactivity timer for a game
 * If the timer expires, the game is terminated
 */
export function resetInactivityTimer(
  gameId: string,
  gameLogs: Map<string, string[]>,
  wss: any
) {
  if (!gameId) {return;}

  // Clear existing timer
  if (gameInactivityTimers.has(gameId)) {
    clearTimeout(gameInactivityTimers.get(gameId));
  }

  // Set new timer
  const timerId = setTimeout(() => {
    const gameState = getGameState(gameId);
    if (gameState) {
      logToGame(gameId, 'Game terminated due to inactivity (20 minutes without action).', gameLogs);
      endGame(gameId, '20 minutes inactivity', gameLogs, wss);
    }
  }, INACTIVITY_TIMEOUT_MS);

  gameInactivityTimers.set(gameId, timerId);
}

/**
 * Converts a disconnected player into a dummy player
 */
export function convertPlayerToDummy(
  gameId: string,
  playerId: number,
  gameLogs: Map<string, string[]>,
  broadcastState: (gameId: string, gameState: any) => void
) {
  const gameState = getGameState(gameId);
  if (!gameState) {return;}

  const player = gameState.players.find((p: any) => p.id === playerId);
  if (player && player.isDisconnected) {
    logToGame(gameId, `Player ${playerId} (${player.name}) failed to reconnect and is now a Dummy.`, gameLogs);

    player.isDummy = true;
    player.isDisconnected = false; // Dummies are "connected" but not human
    player.name = `Dummy ${player.id}`;
    player.playerToken = null; // Prevent reconnection as this player

    // Remove the timer tracking this conversion
    playerDisconnectTimers.delete(`${gameId}-${playerId}`);

    broadcastState(gameId, gameState);
  }
}

/**
 * Schedules a game to be terminated after a delay if no real players are active
 */
export function scheduleGameTermination(
  gameId: string,
  gameLogs: Map<string, string[]>,
  wss: any
) {
  if (gameTerminationTimers.has(gameId)) {return;} // Timer already scheduled

  logToGame(gameId, 'Last real player disconnected. Starting 1-minute shutdown timer.', gameLogs);

  const timerId = setTimeout(() => {
    const gameState = getGameState(gameId);
    // An active player is one who is not a dummy and not disconnected
    const activePlayers = gameState ? gameState.players.filter((p: any) => !p.isDummy && !p.isDisconnected) : [];
    if (activePlayers.length === 0) {
      endGame(gameId, 'inactivity timeout (empty game)', gameLogs, wss);
    } else {
      gameTerminationTimers.delete(gameId); // A player reconnected
    }
  }, 60 * 1000); // 1 minute

  gameTerminationTimers.set(gameId, timerId);
}

/**
 * Cancels a scheduled game termination, usually because a player has reconnected
 */
export function cancelGameTermination(gameId: string, gameLogs: Map<string, string[]>) {
  if (gameTerminationTimers.has(gameId)) {
    clearTimeout(gameTerminationTimers.get(gameId));
    gameTerminationTimers.delete(gameId);
    logToGame(gameId, 'Shutdown timer cancelled due to player activity.', gameLogs);
  }
}

/**
 * Cancels pending disconnect/removal timers for a player (called on reconnection)
 */
export function cancelPlayerDisconnectTimer(gameId: string, playerId: number) {
  const disconnectTimerKey = `${gameId}-${playerId}-disconnect`;
  const removeTimerKey = `${gameId}-${playerId}-remove`;

  if (playerDisconnectTimers.has(disconnectTimerKey)) {
    clearTimeout(playerDisconnectTimers.get(disconnectTimerKey));
    playerDisconnectTimers.delete(disconnectTimerKey);
  }

  if (playerDisconnectTimers.has(removeTimerKey)) {
    clearTimeout(playerDisconnectTimers.get(removeTimerKey));
    playerDisconnectTimers.delete(removeTimerKey);
  }
}

/**
 * Handles the logic for a player disconnecting from a game
 * - If manual exit: remove player immediately and transfer host if needed
 * - If disconnect: mark as disconnected after 10s, remove after 5min
 */
export function handlePlayerLeave(
  gameId: string,
  playerId: number,
  isManualExit: boolean,
  gameLogs: Map<string, string[]>,
  wss: any,
  broadcastState: (gameId: string, gameState: any) => void,
  broadcastGamesListFn: () => void
) {
  if (!gameId || playerId === null || playerId === undefined) {return;}

  const gameState = getGameState(gameId);
  if (!gameState) {return;}

  const player = gameState.players.find((p: any) => p.id === playerId);
  if (!player) {return;}

  // Clear existing timers for this player
  cancelPlayerDisconnectTimer(gameId, playerId);

  if (isManualExit) {
    // Manual exit: remove player immediately and transfer host if needed
    logToGame(gameId, `Player ${playerId} (${player.name}) manually exited the game.`, gameLogs);
    logger.info(`Player ${playerId} manually exited game ${gameId}.`);

    const wasHost = gameState.hostId === playerId;

    // Remove player from game
    gameState.players = gameState.players.filter((p: any) => p.id !== playerId);

    // Transfer host if needed
    if (wasHost && gameState.players.length > 0) {
      transferHost(gameId, playerId, gameLogs);
    }
  } else {
    // Disconnect: set timestamp and schedule timers
    player.disconnectTimestamp = Date.now();

    // After 10 seconds: mark as disconnected
    const disconnectTimerId = setTimeout(() => {
      markPlayerDisconnected(gameId, playerId, gameLogs, broadcastState);
    }, DISCONNECT_WARNING_MS);

    // After 5 minutes: remove from game
    const removeTimerId = setTimeout(() => {
      removePlayerFromGame(gameId, playerId, gameLogs, broadcastState, broadcastGamesListFn);
    }, DISCONNECT_REMOVE_MS);

    // Store both timers for potential cancellation on reconnection
    // Use a special key format to distinguish between disconnect and remove timers
    playerDisconnectTimers.set(`${gameId}-${playerId}-disconnect`, disconnectTimerId);
    playerDisconnectTimers.set(`${gameId}-${playerId}-remove`, removeTimerId);
  }

  // An active player is a human who is currently connected
  const activePlayers = gameState.players.filter((p: any) => !p.isDummy && !p.isDisconnected);

  if (activePlayers.length === 0) {
    scheduleGameTermination(gameId, gameLogs, wss);
  }

  broadcastState(gameId, gameState);
  broadcastGamesListFn();
}

/**
 * Sends the list of all active games to every connected client
 */
export function broadcastGamesList(gameLogs: Map<string, string[]>, wss: any) {
  const gamesList = getPublicGames();

  const message = JSON.stringify({ type: 'GAMES_LIST', games: gamesList });

  if (wss && wss.clients) {
    const clients = wss.clients;
    clients.forEach((client: any) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message);
        } catch (err) {
          logger.error(`BROADCAST_GAMES_LIST_ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }
}
