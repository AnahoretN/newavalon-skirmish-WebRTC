/**
 * @file Ready check handlers
 * Manages the ready check phase before game starts
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

/**
 * Handle START_READY_CHECK message
 * Activates ready check phase and resets all player ready states
 */
export function handleStartReadyCheck(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
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
        message: 'Game already started'
      }));
      return;
    }

    // Reset all ready statuses
    gameState.players.forEach(p => p.isReady = false);
    gameState.isReadyCheckActive = true;

    broadcastToGame(data.gameId, gameState);
    logger.info(`Ready check started for game ${data.gameId}`);
  } catch (error) {
    logger.error('Failed to start ready check:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to start ready check'
    }));
  }
}

/**
 * Handle CANCEL_READY_CHECK message
 * Deactivates ready check phase
 */
export function handleCancelReadyCheck(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isReadyCheckActive) {
      return; // Already not in ready check
    }

    // Deactivate ready check and reset all ready states
    gameState.isReadyCheckActive = false;
    gameState.players.forEach(p => p.isReady = false);

    broadcastToGame(data.gameId, gameState);
    logger.info(`Ready check cancelled for game ${data.gameId}`);
  } catch (error) {
    logger.error('Failed to cancel ready check:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to cancel ready check'
    }));
  }
}

/**
 * Handle PLAYER_READY message
 * Marks a player as ready and checks if all players are ready
 */
export function handlePlayerReady(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isReadyCheckActive) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'No active ready check'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      return; // Game already started
    }

    if (!data.playerId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player ID is required'
      }));
      return;
    }

    // Mark player as ready
    const player = gameState.players.find(p => p.id === data.playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Player with ID ${data.playerId} not found in game`
      }));
      return;
    }

    player.isReady = true;
    logger.info(`Player ${data.playerId} marked as ready in game ${data.gameId}`);

    // Check if all non-dummy, connected players are ready
    const activePlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const allReady = activePlayers.length > 0 && activePlayers.every(p => p.isReady);

    if (allReady && activePlayers.length >= 1) {
      // All players ready - start the game!
      gameState.isReadyCheckActive = false;
      gameState.isGameStarted = true;
      gameState.startingPlayerId = activePlayers[0].id;
      gameState.activePlayerId = activePlayers[0].id;

      // Draw starting hands for players with auto-draw enabled
      // First player (active) draws 6 cards, others draw 6
      // Note: The extra card for first turn comes from client-side auto-draw when entering Setup phase
      // For dummy players: check if host (Player 1) has auto-draw enabled
      // For real players: check their own auto-draw setting
      const hostPlayer = gameState.players.find(p => p.id === 1)
      const hostAutoDrawEnabled = hostPlayer?.autoDrawEnabled === true

      logger.info(`Starting hand draw - host autoDrawEnabled: ${hostAutoDrawEnabled}, host exists: ${!!hostPlayer}`)

      for (const player of gameState.players) {
        logger.info(`Player ${player.id} (dummy: ${player.isDummy}): hand=${player.hand.length}, autoDrawEnabled=${player.autoDrawEnabled}`)

        if (player.hand.length > 0) {
          logger.info(`Player ${player.id} already has ${player.hand.length} cards in hand - skipping starting hand draw`)
          continue
        }

        let shouldDraw = false
        if (player.isDummy) {
          // Dummy players draw if host has auto-draw enabled
          shouldDraw = hostAutoDrawEnabled
        } else {
          // Real players draw if they have auto-draw enabled (or use their own setting)
          // If real player doesn't have autoDrawEnabled set yet, default to true
          shouldDraw = player.autoDrawEnabled !== false
        }

        logger.info(`Player ${player.id} shouldDraw: ${shouldDraw}`)

        if (!shouldDraw) {
          continue
        }

        // All players draw 6 cards (first player's extra card comes from client-side auto-draw)
        const cardsToDraw = 6

        // Draw cards from deck to hand
        for (let i = 0; i < cardsToDraw && i < player.deck.length; i++) {
          const drawnCard = player.deck[0]
          player.deck.splice(0, 1)
          player.hand.push(drawnCard)
        }

        logger.info(`Auto-drew ${cardsToDraw} cards for player ${player.id} (dummy: ${player.isDummy}), hand size is now ${player.hand.length}`);
      }

      logger.info(`All players ready! Starting game ${data.gameId}`);
    }

    broadcastToGame(data.gameId, gameState);
  } catch (error) {
    logger.error('Failed to mark player as ready:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to mark player as ready'
    }));
  }
}
