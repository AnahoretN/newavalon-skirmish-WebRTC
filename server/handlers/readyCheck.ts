/**
 * @file Ready check handlers
 * Manages the ready check phase before game starts
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';
import { initializeMulliganAttempts } from './mulligan.js';

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

    // Check if all non-dummy, connected players are ready
    const realPlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady);

    if (allReady && realPlayers.length >= 1) {
      // All players ready - start the game!
      gameState.isReadyCheckActive = false;
      gameState.isGameStarted = true;
      gameState.autoDrawnPlayers = []; // Clear auto-draw tracking for new game

      // Randomly select starting player from ALL players (including dummies)
      const allPlayers = gameState.players.filter(p => !p.isDisconnected);
      const randomIndex = Math.floor(Math.random() * allPlayers.length);
      gameState.startingPlayerId = allPlayers[randomIndex].id;
      gameState.activePlayerId = allPlayers[randomIndex].id;

      // Log game start
      const startingPlayer = allPlayers[randomIndex];
      logAction(data.gameId, GameActions.GAME_STARTED, {
        startingPlayerId: startingPlayer.id,
        startingPlayerName: startingPlayer.name,
        playerCount: realPlayers.length,
        players: gameState.players.filter(p => !p.isDisconnected).map(p => ({
          id: p.id,
          name: p.name,
          isDummy: p.isDummy,
          deckType: p.selectedDeck
        }))
      }).catch();

      // Draw starting hands for players with auto-draw enabled
      // First player (active) draws 6 cards, others draw 6
      // Note: The extra card (7th) for first turn comes from Draw phase
      // For dummy players: check if host (Player 1) has auto-draw enabled
      // For real players: check their own auto-draw setting
      const hostPlayer = gameState.players.find(p => p.id === 1)
      const hostAutoDrawEnabled = hostPlayer?.autoDrawEnabled === true

      for (const player of gameState.players) {
        if (player.hand.length > 0) {
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

        if (!shouldDraw) {
          continue
        }

        // All players draw 6 cards (first player's extra 7th card comes from Draw phase)
        const cardsToDraw = 6

        // Draw cards from deck to hand
        for (let i = 0; i < cardsToDraw && i < player.deck.length; i++) {
          const drawnCard = player.deck[0]
          player.deck.splice(0, 1)
          player.hand.push(drawnCard)
        }

        // Log starting hand draw
        logAction(data.gameId, GameActions.CARD_DRAWN, {
          playerId: player.id,
          playerName: player.name,
          cardsDrawn: cardsToDraw,
          isStartingHand: true,
          cardsInDeck: player.deck.length,
          cardsInHand: player.hand.length
        }).catch();
      }

      // Activate mulligan phase instead of going directly to Setup
      gameState.isMulliganActive = true;
      gameState.mulliganCompletePlayers = [];
      // Phase will be set to Setup after all players confirm mulligan
      gameState.currentPhase = 0; // Stay at phase 0 during mulligan

      // Initialize mulligan attempts for all players
      initializeMulliganAttempts(gameState);
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
