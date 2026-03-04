/**
 * @file Phase management handlers (Server Mode)
 *
 * ALL LOGIC REMOVED - Only interface stubs remain.
 * Phase management and turn passing is now handled client-side only.
 */

import { logger } from '../utils/logger.js';
import { getGameState, updateGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

// Export empty/placeholder functions for API compatibility
export function checkRoundEnd(_gameState: any, _isDeselectCheck = false): boolean {
  return false;
}

export function endRound(_gameState: any): void {
  // No-op - logic removed
}

/**
 * Handle TOGGLE_AUTO_ABILITIES message
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

    gameState.autoAbilitiesEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`[ToggleAutoAbilities] Game ${gameId}: autoAbilitiesEnabled = ${enabled}`);
  } catch (err) {
    logger.error('[ToggleAutoAbilities] Error:', err);
  }
}

/**
 * Handle NEXT_PHASE message
 */
export function handleNextPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handleNextPhase] No-op - phase management removed');
}

/**
 * Handle PREV_PHASE message
 */
export function handlePrevPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handlePrevPhase] No-op - phase management removed');
}

/**
 * Handle SET_PHASE message
 */
export function handleSetPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handleSetPhase] No-op - phase management removed');
}

/**
 * Handle TOGGLE_ACTIVE_PLAYER message
 */
export function handleToggleActivePlayer(ws, data) {
  // No-op - turn passing logic removed
  logger.info('[handleToggleActivePlayer] No-op - turn passing removed');
}

/**
 * Handle TOGGLE_AUTO_DRAW message
 */
export function handleToggleAutoDraw(ws, data) {
  // No-op - auto draw logic removed
  logger.info('[handleToggleAutoDraw] No-op - auto draw removed');
}

/**
 * Handle START_NEXT_ROUND message
 * - Increments round number
 * - Resets all players' scores to 0
 * - Closes round end modal
 * - Clears game winner
 * - Starts Preparation phase for active player (auto-draw if enabled)
 * - Transitions to Setup phase
 */
export function handleStartNextRound(ws, data) {
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

    const newRound = (gameState.currentRound || 1) + 1;

    // Reset all players' scores
    const newPlayers = gameState.players.map(p => ({
      ...p,
      score: 0
    }));

    // Update game state with new round, reset scores, and Preparation phase
    const updatedState = {
      ...gameState,
      currentRound: newRound,
      players: newPlayers,
      isRoundEndModalOpen: false,
      gameWinner: null,
      currentPhase: 0  // Preparation phase
    };

    // Execute Preparation phase for active player (auto-draw if enabled)
    const activePlayerId = updatedState.activePlayerId;
    if (activePlayerId) {
      const player = updatedState.players.find((p: any) => p.id === activePlayerId);
      if (player && updatedState.autoDrawEnabled && player.deck && player.deck.length > 0) {
        const drawnCard = player.deck.shift();
        if (drawnCard) {
          player.hand.push(drawnCard);
          player.handSize = player.hand.length;
          player.deckSize = player.deck.length;
          logger.info(`[handleStartNextRound] Player ${activePlayerId} drew card, hand: ${player.hand.length}`);
        }
      }

      // Transition to Setup phase
      updatedState.currentPhase = 1;
      logger.info(`[handleStartNextRound] Transition to Setup phase for player ${activePlayerId}`);
    }

    // Update the game state
    updateGameState(gameId, updatedState);
    // Broadcast to all players
    broadcastToGame(gameId, updatedState);

    logger.info(`[handleStartNextRound] Game ${gameId}: Round ${newRound} started, scores reset`);
  } catch (err) {
    logger.error('[handleStartNextRound] Error:', err);
  }
}

/**
 * Handle START_NEW_MATCH message
 */
export function handleStartNewMatch(ws, data) {
  // No-op - match management logic removed
  logger.info('[handleStartNewMatch] No-op - match management removed');
}

/**
 * Handle RESET_GAME message
 */
export function handleResetGame(ws, data) {
  // No-op - game reset logic removed
  logger.info('[handleResetGame] No-op - game reset removed');
}

// Export performPreparationPhase for compatibility (no-op)
export function performPreparationPhase(gameState: any, _playerId?: number): any {
  // No-op - just return the state unchanged
  return gameState;
}
