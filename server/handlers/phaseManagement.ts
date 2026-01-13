/**
 * @file Phase management handlers
 * Handles turn phase navigation and auto-abilities toggle
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

/**
 * Handle TOGGLE_AUTO_ABILITIES message
 * Toggles whether auto-abilities are enabled for the game
 */
export function handleToggleAutoAbilities(ws, data) {
  try {
    const { gameId, enabled } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Validate that enabled is a boolean
    if (typeof enabled !== 'boolean') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid enabled value: must be a boolean'
      }));
      return;
    }

    gameState.autoAbilitiesEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`Auto-abilities ${enabled ? 'enabled' : 'disabled'} for game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle auto abilities:', error);
  }
}

/**
 * Handle TOGGLE_AUTO_DRAW message
 * Toggles whether auto-draw is enabled for a specific player
 */
export function handleToggleAutoDraw(ws, data) {
  try {
    const { gameId, playerId, enabled } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Validate that enabled is a boolean
    if (typeof enabled !== 'boolean') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid enabled value: must be a boolean'
      }));
      return;
    }

    // Find the player and update their auto-draw setting
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    player.autoDrawEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`Auto-draw ${enabled ? 'enabled' : 'disabled'} for player ${playerId} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle auto draw:', error);
  }
}

/**
 * Handle TOGGLE_ACTIVE_PLAYER message
 * Sets the active player
 * Note: Auto-draw is handled client-side in the onmessage handler when entering Setup phase
 */
export function handleToggleActivePlayer(ws, data) {
  try {
    const { gameId, playerId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const previousActivePlayerId = gameState.activePlayerId;

    // Toggle: if same player clicked, deselect; otherwise select new player
    if (previousActivePlayerId === playerId) {
      gameState.activePlayerId = undefined;
    } else {
      gameState.activePlayerId = playerId;
    }

    broadcastToGame(gameId, gameState);
    logger.info(`Active player changed to ${gameState.activePlayerId || 'none'} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle active player:', error);
  }
}

/**
 * Handle NEXT_PHASE message
 * Advances to the next turn phase
 */
export function handleNextPhase(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Get current phase index or default to 0
    const currentPhaseIndex = gameState.currentPhaseIndex || 0;
    const maxPhases = gameState.turnPhases?.length || 4;

    // Advance to next phase, wrapping around
    gameState.currentPhaseIndex = (currentPhaseIndex + 1) % maxPhases;

    broadcastToGame(gameId, gameState);
    logger.info(`Phase advanced to ${gameState.currentPhaseIndex} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to advance phase:', error);
  }
}

/**
 * Handle PREV_PHASE message
 * Goes back to the previous turn phase
 */
export function handlePrevPhase(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Get current phase index or default to 0
    const currentPhaseIndex = gameState.currentPhaseIndex || 0;
    const maxPhases = gameState.turnPhases?.length || 4;

    // Go to previous phase, wrapping around
    gameState.currentPhaseIndex = (currentPhaseIndex - 1 + maxPhases) % maxPhases;

    broadcastToGame(gameId, gameState);
    logger.info(`Phase retreated to ${gameState.currentPhaseIndex} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to retreat phase:', error);
  }
}

/**
 * Handle SET_PHASE message
 * Sets the turn phase to a specific index
 */
export function handleSetPhase(ws, data) {
  try {
    const { gameId, phaseIndex } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Validate phaseIndex is numeric
    const numericPhaseIndex = Number(phaseIndex);
    if (!Number.isInteger(numericPhaseIndex) || Number.isNaN(numericPhaseIndex)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index; must be an integer'
      }));
      return;
    }

    const maxPhases = gameState.turnPhases?.length || 4;

    if (numericPhaseIndex < 0 || numericPhaseIndex >= maxPhases) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Invalid phase index. Must be between 0 and ${maxPhases - 1}`
      }));
      return;
    }

    gameState.currentPhaseIndex = numericPhaseIndex;
    broadcastToGame(gameId, gameState);
    logger.info(`Phase set to ${numericPhaseIndex} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to set phase:', error);
  }
}
