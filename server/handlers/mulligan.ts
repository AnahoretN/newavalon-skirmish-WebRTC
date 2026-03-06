/**
 * @file Mulligan handlers
 * Manages the mulligan phase after starting hands are drawn
 */

import { logger } from '../utils/logger.js';
import { getGameState, updateGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';

const MAX_MULLIGAN_ATTEMPTS = 3;

/**
 * Handle EXCHANGE_MULLIGAN_CARD message
 * Player exchanges a card from their mulligan hand for a new card from deck
 */
export function handleExchangeMulliganCard(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isMulliganActive) {
      return; // Not in mulligan phase
    }

    if (!data.playerId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player ID is required'
      }));
      return;
    }

    if (typeof data.cardIndex !== 'number') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Card index is required'
      }));
      return;
    }

    // Find the player
    const player = gameState.players.find(p => p.id === data.playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Player with ID ${data.playerId} not found in game`
      }));
      return;
    }

    // Check if player already confirmed
    if (player.hasMulliganed) {
      return; // Cannot exchange after confirming
    }

    // Check if player has attempts left
    const attemptsLeft = player.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS;
    if (attemptsLeft <= 0) {
      return; // No attempts left
    }

    // Validate card index
    if (data.cardIndex < 0 || data.cardIndex >= player.hand.length) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid card index'
      }));
      return;
    }

    // Check if deck has cards
    if (!player.deck || player.deck.length === 0) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot exchange - deck is empty'
      }));
      return;
    }

    // Remove the card from hand
    const [exchangedCard] = player.hand.splice(data.cardIndex, 1);

    // Put exchanged card at bottom of deck
    player.deck.push(exchangedCard);

    // Draw new card from top of deck
    const newCard = player.deck.shift();
    if (newCard) {
      player.hand.push(newCard);
    }

    // Update sizes
    player.handSize = player.hand.length;
    player.deckSize = player.deck.length;

    // Decrement mulligan attempts
    player.mulliganAttempts = attemptsLeft - 1;

    logger.info(`[MULLIGAN] Player ${player.id} exchanged card at index ${data.cardIndex}, attempts remaining: ${player.mulliganAttempts}`);

    // Log card exchange
    logAction(data.gameId, GameActions.CARD_MOVED, {
      playerId: player.id,
      playerName: player.name,
      action: 'mulligan_exchange',
      exchangedCard: exchangedCard.name,
      newCard: newCard?.name,
      cardIndex: data.cardIndex,
      cardsInHand: player.hand.length,
      attemptsRemaining: player.mulliganAttempts
    }).catch();

    broadcastToGame(data.gameId, gameState);
  } catch (error) {
    logger.error('Failed to exchange mulligan card:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to exchange card'
    }));
  }
}

/**
 * Handle CONFIRM_MULLIGAN message
 * Player confirms their mulligan hand arrangement
 */
export function handleConfirmMulligan(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isMulliganActive) {
      return; // Not in mulligan phase
    }

    if (!data.playerId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player ID is required'
      }));
      return;
    }

    // Find the player
    const player = gameState.players.find(p => p.id === data.playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Player with ID ${data.playerId} not found in game`
      }));
      return;
    }

    // Update player's hand with the new arrangement (if provided)
    if (data.newHand && Array.isArray(data.newHand)) {
      player.hand = data.newHand;
      player.handSize = data.newHand.length;
    }

    // Mark player as having confirmed mulligan
    player.hasMulliganed = true;

    // Log mulligan confirmation
    logAction(data.gameId, GameActions.CARD_MOVED, {
      playerId: player.id,
      playerName: player.name,
      action: 'mulligan_confirmed',
      cardsInHand: player.hand.length
    }).catch();

    // Check if all non-dummy players have confirmed
    const realPlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected && !p.isSpectator);
    const allConfirmed = realPlayers.length > 0 && realPlayers.every(p => p.hasMulliganed);

    if (allConfirmed) {
      // All players confirmed - end mulligan phase
      gameState.isMulliganActive = false;
      gameState.mulliganCompletePlayers = [];

      // Draw 7th card for starting player (first turn advantage)
      const startingPlayer = gameState.players.find(p => p.id === gameState.startingPlayerId);
      if (startingPlayer && startingPlayer.deck && startingPlayer.deck.length > 0) {
        const seventhCard = startingPlayer.deck.shift();
        if (seventhCard) {
          startingPlayer.hand.push(seventhCard);
          startingPlayer.handSize = startingPlayer.hand.length;
          startingPlayer.deckSize = startingPlayer.deck.length;

          logger.info(`[MULLIGAN] Starting player ${startingPlayer.id} drew 7th card`);

          logAction(data.gameId, GameActions.CARD_DRAWN, {
            playerId: startingPlayer.id,
            playerName: startingPlayer.name,
            cardsDrawn: 1,
            isStartingHand: false,
            cardsInDeck: startingPlayer.deck.length,
            cardsInHand: startingPlayer.hand.length
          }).catch();
        }
      }

      // Set phase to Setup
      gameState.currentPhase = 1;

      logger.info(`[MULLIGAN] All players confirmed mulligan for game ${data.gameId}. Starting Setup phase.`);

      // Log phase transition
      logAction(data.gameId, GameActions.PHASE_CHANGED, {
        phase: 1,
        phaseName: 'Setup',
        trigger: 'mulligan_complete'
      }).catch();
    }

    broadcastToGame(data.gameId, gameState);
  } catch (error) {
    logger.error('Failed to confirm mulligan:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to confirm mulligan'
    }));
  }
}

/**
 * Initialize mulligan attempts for all real players
 * Called when mulligan phase is activated
 */
export function initializeMulliganAttempts(gameState) {
  gameState.players.forEach(player => {
    if (!player.isDummy && !player.isSpectator) {
      player.mulliganAttempts = MAX_MULLIGAN_ATTEMPTS;
    }
  });
  return gameState;
}
