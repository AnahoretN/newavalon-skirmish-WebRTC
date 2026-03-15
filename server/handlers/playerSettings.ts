/**
 * @file Player settings handlers
 * Handles player name, color, deck, and score changes
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { sanitizePlayerName } from '../utils/security.js';
import { broadcastToGame } from '../services/websocket.js';
import { createNewPlayer, generatePlayerToken, shuffleDeck } from '../utils/deckUtils.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';
import { getCardDefinition } from '../services/content.js';

/**
 * Handle UPDATE_PLAYER_NAME message
 * Updates a player's display name
 */
export function handleUpdatePlayerName(ws, data) {
  try {
    const { gameId, playerId, playerName } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    const sanitizedName = sanitizePlayerName(playerName);
    player.name = sanitizedName;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to update player name:', error);
  }
}

/**
 * Handle CHANGE_PLAYER_COLOR message
 * Changes a player's assigned color
 */
export function handleChangePlayerColor(ws, data) {
  try {
    const { gameId, playerId, color } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Check if color is already used by another player
    const colorInUse = gameState.players.some(p => p.id !== playerId && p.color === color);
    if (colorInUse) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Color already in use'
      }));
      return;
    }

    player.color = color;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to change player color:', error);
  }
}

/**
 * Handle UPDATE_PLAYER_SCORE message
 * Updates a player's score by delta (server-authoritative)
 */
export function handleUpdatePlayerScore(ws, data) {
  try {
    const { gameId, playerId, delta } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Validate delta is a finite number
    const numericDelta = Number(delta);
    if (!Number.isFinite(numericDelta)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid delta value'
      }));
      return;
    }

    const previousScore = player.score;
    player.score = previousScore + numericDelta;

    // Ensure score doesn't go negative
    if (player.score < 0) {
      player.score = 0;
    }

    const actualDelta = player.score - previousScore;

    // Log score change (only if score actually changed)
    if (actualDelta !== 0) {
      logAction(gameId, GameActions.SCORE_CHANGED, {
        playerId: player.id,
        playerName: player.name,
        previousScore,
        newScore: player.score,
        delta: actualDelta
      }).catch();
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to update player score:', error);
  }
}

/**
 * Handle REMOVE_COUNTERS_WITH_REWARD message
 * Removes counters from a card and optionally draws cards as reward
 * Used by Inspiration command and other counter removal abilities
 */
export function handleRemoveCountersWithReward(ws, data) {
  try {
    // Get gameId from WebSocket connection
    const { getGameIdForClient } = require('../gameState.js');
    const gameId = getGameIdForClient(ws);

    const { playerId, coords, countsToRemove, callbackAction } = data;
    const { getGameState } = require('../gameState.js');
    const { broadcastToGame } = require('../websocket.js');
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!coords || !countsToRemove || !callbackAction) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Missing required data'
      }));
      return;
    }

    const { row, col } = coords;
    if (row === undefined || col === undefined) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid coords'
      }));
      return;
    }

    const cell = gameState.board[row]?.[col];
    if (!cell?.card) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Card not found at coords'
      }));
      return;
    }

    // CRITICAL: Use card owner for reward, not action sender
    // For Inspiration, the card owner should draw the cards
    const rewardOwnerId = cell.card.ownerId || playerId;

    // Remove counters from card
    const cardStatuses = cell.card.statuses ? [...cell.card.statuses] : [];
    Object.entries(countsToRemove).forEach(([type, count]) => {
      for (let i = 0; i < (count as number); i++) {
        const lastIndex = cardStatuses.map(s => s.type).lastIndexOf(type);
        if (lastIndex > -1) {
          cardStatuses.splice(lastIndex, 1);
        }
      }
    });

    // Update card statuses
    cell.card.statuses = cardStatuses;

    // Handle DRAW_REMOVED reward - draw cards from deck
    if (callbackAction === 'DRAW_REMOVED') {
      const totalRemoved = Object.values(countsToRemove).reduce((sum: number, count) => sum + (count as number), 0) as number;
      if (totalRemoved > 0) {
        // CRITICAL: Use rewardOwnerId (card owner), not playerId (action sender)
        const playerToUpdate = gameState.players.find(p => p.id === rewardOwnerId);
        if (playerToUpdate && playerToUpdate.deck) {
          const cardsToDraw = Math.min(totalRemoved, playerToUpdate.deck.length);
          for (let i = 0; i < cardsToDraw; i++) {
            const cardDrawn = playerToUpdate.deck.shift();
            if (cardDrawn && playerToUpdate.hand) {
              playerToUpdate.hand.push(cardDrawn);
            }
          }
          // Update hand size
          playerToUpdate.handSize = playerToUpdate.hand.length;
        }
      }
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    const { logger } = require('../utils/logger.js');
    logger.error('Failed to remove counters with reward:', error);
  }
}

/**
 * Handle CHANGE_PLAYER_DECK message
 * Changes a player's selected deck (before game starts)
 */
export function handleChangePlayerDeck(ws, data) {
  try {
    const { gameId, playerId, deckType } = data;
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
        message: 'Cannot change deck after game has started'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Validate deckType against available decks
    if (!deckType || typeof deckType !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid deck type'
      }));
      return;
    }

    player.selectedDeck = deckType;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to change player deck:', error);
  }
}

/**
 * Handle LOAD_CUSTOM_DECK message
 * Loads a custom deck for a player
 */
export function handleLoadCustomDeck(ws, data) {
  try {
    const { gameId, playerId, deckFile } = data;
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
        message: 'Cannot load custom deck after game has started'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Build the deck from the custom deck file
    const newDeck: any[] = [];
    for (const deckCard of deckFile.cards) {
      const cardDef = getCardDefinition(deckCard.cardId);
      if (!cardDef) {
        logger.warn(`Card ${deckCard.cardId} not found in database, skipping`);
        continue;
      }

      // Add the specified quantity of this card
      for (let i = 0; i < deckCard.quantity; i++) {
        newDeck.push({
          id: `${deckCard.cardId}_${player.id}_${Date.now()}_${i}`,
          baseId: deckCard.cardId,
          name: cardDef.name,
          types: cardDef.types || [],
          faction: cardDef.faction,
          power: cardDef.power || 0,
          abilities: cardDef.abilities || [],
          imageUrl: cardDef.imageUrl,
          fallbackImage: cardDef.fallbackImage,
          deck: 'Custom',
          ownerId: player.id,
          location: 'deck',
          isFaceDown: false,
          statuses: []
        });
      }
    }

    // Shuffle the custom deck before assigning it
    const shuffledDeck = shuffleDeck(newDeck);

    // Update player's deck with the shuffled custom deck
    player.deck = shuffledDeck;
    player.selectedDeck = 'Custom';
    player.customDeckName = deckFile.deckName;

    // Clear hand and discard to prevent issues
    player.hand = [];
    player.discard = [];

    logAction(gameId, GameActions.LOAD_CUSTOM_DECK, {
      playerId,
      deckName: deckFile.deckName,
      cardCount: newDeck.length
    }).catch();

    broadcastToGame(gameId, gameState);

    ws.send(JSON.stringify({
      type: 'CUSTOM_DECK_LOADED',
      playerId,
      deckName: deckFile.deckName,
      cardCount: newDeck.length,
      success: true
    }));
  } catch (error) {
    logger.error('Failed to load custom deck:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to load custom deck'
    }));
  }
}

/**
 * Handle SET_DUMMY_PLAYER_COUNT message
 * Sets the number of dummy players in the game
 */
export function handleSetDummyPlayerCount(ws, data) {
  try {
    const { gameId, count } = data;
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
        message: 'Cannot change dummy players after game has started'
      }));
      return;
    }

    // Validate and sanitize count
    const numericCount = Number(count);
    if (!Number.isFinite(numericCount) || numericCount < 0 || numericCount > 3) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid dummy player count (must be 0-3)'
      }));
      return;
    }

    // Get current real players (non-dummy)
    const realPlayers = gameState.players.filter((p: any) => !p.isDummy);
    const currentDummies = gameState.players.filter((p: any) => p.isDummy);

    // If count matches current number of dummies, no change needed
    if (currentDummies.length === numericCount) {
      gameState.dummyPlayerCount = numericCount;
      broadcastToGame(gameId, gameState);
      return;
    }

    // Remove all existing dummy players
    gameState.players = realPlayers;

    // Add new dummy players
    let nextPlayerId = Math.max(...realPlayers.map((p: any) => p.id), 0);
    for (let i = 0; i < numericCount; i++) {
      nextPlayerId++;
      const dummyPlayer = createNewPlayer(nextPlayerId, true);
      dummyPlayer.name = `Dummy ${i + 1}`;
      dummyPlayer.playerToken = generatePlayerToken(); // Generate token for dummy
      gameState.players.push(dummyPlayer);
    }

    gameState.dummyPlayerCount = numericCount;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set dummy player count:', error);
  }
}

/**
 * Handle LOG_GAME_ACTION message
 * Logs a game action to the game log
 */
export function handleLogGameAction(ws, data) {
  try {
    const { gameId, action } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      return;
    }

    // Game logs are stored in the gameState.gameLog array
    if (!gameState.gameLog) {
      gameState.gameLog = [];
    }
    gameState.gameLog.push({
      timestamp: Date.now(),
      action
    });

    // Keep only last 1000 log entries to prevent unbounded memory growth
    if (gameState.gameLog.length > 1000) {
      gameState.gameLog = gameState.gameLog.slice(-1000);
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to log game action:', error);
  }
}

/**
 * Handle GET_GAME_LOGS message
 * Returns the game log for the specified game
 */
export function handleGetGameLogs(ws, data) {
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

    ws.send(JSON.stringify({
      type: 'GAME_LOGS',
      gameId,
      logs: gameState.gameLog || []
    }));
  } catch (error) {
    logger.error('Failed to get game logs:', error);
  }
}
