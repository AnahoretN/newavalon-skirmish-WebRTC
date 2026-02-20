/**
 * @file Game settings handlers
 * Handles game mode, privacy, and team assignments
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

/**
 * Handle SET_GAME_MODE message
 * Sets the game mode (e.g., Skirmish, Commander)
 */
export function handleSetGameMode(ws, data) {
  try {
    const { gameId, mode } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change mode after game has started'
      }));
      return;
    }

    gameState.gameMode = mode;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set game mode:', error);
  }
}

/**
 * Handle SET_GAME_PRIVACY message
 * Sets whether the game is private or public
 */
export function handleSetGamePrivacy(ws, data) {
  try {
    const { gameId, isPrivate } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change privacy after game has started'
      }));
      return;
    }

    gameState.isPrivate = isPrivate;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set game privacy:', error);
  }
}

/**
 * Handle ASSIGN_TEAMS message
 * Assigns players to teams and syncs colors
 */
export function handleAssignTeams(ws, data) {
  try {
    const { gameId, assignments } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change teams after game has started'
      }));
      return;
    }

    // Create a map of players by ID for easy lookup
    const playerMap = new Map(gameState.players.map(p => [p.id, p]));

    // Clear existing team assignments
    gameState.players.forEach(p => delete p.teamId);

    // Assign new teams
    for (const teamId in assignments) {
      const playerIds = assignments[teamId];
      const teamCaptain = playerMap.get(playerIds[0]) as any;
      if (!teamCaptain) {continue;}

      playerIds.forEach((playerId: number) => {
        const player = playerMap.get(playerId) as any;
        if (player) {
          player.teamId = Number(teamId);
          player.color = teamCaptain.color; // Sync color to captain
        }
      });
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to assign teams:', error);
  }
}

/**
 * Handle SET_GRID_SIZE message
 * Sets the active grid size for the game board
 */
export function handleSetGridSize(ws, data) {
  try {
    const { gameId, gridSize } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change grid size after game has started'
      }));
      return;
    }

    gameState.activeGridSize = gridSize;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set grid size:', error);
  }
}
