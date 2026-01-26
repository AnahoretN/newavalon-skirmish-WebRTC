/**
 * @file Phase management handlers
 * Handles turn phase navigation and auto-abilities toggle
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';

/**
 * Calculate the victory point threshold for a given round
 * Formula: 10 + (roundNumber * 10)
 * Round 1: 20, Round 2: 30, Round 3: 40, etc.
 */
export function getRoundVictoryThreshold(round: number): number {
  return 10 + (round * 10);
}

/**
 * Check if the round should end based on player scores
 * Called ONLY when the first player (startingPlayerId) enters Setup phase
 * or when the starting player is deselected (ending their turn)
 * @param gameState - The current game state
 * @param isDeselectCheck - Whether this check is triggered by deselecting the starting player
 * @returns true if round should end, false otherwise
 */
export function checkRoundEnd(gameState: any, isDeselectCheck = false): boolean {
  // Calculate the victory threshold for current round
  const threshold = getRoundVictoryThreshold(gameState.currentRound);
  const maxScore = Math.max(...gameState.players.map((p: any) => p.score || 0));

  // Only check if game has started
  if (!gameState.isGameStarted) {
    return false;
  }

  // Don't check if round end modal is already open
  if (gameState.isRoundEndModalOpen) {
    return false;
  }

  // Only check during Setup phase (0) when the starting player becomes active
  // This ensures the round is checked exactly once per round cycle
  if (gameState.currentPhase !== 0) {
    return false;
  }

  // Only check if the starting player is the active player, unless this is a deselect check
  // This prevents checking when other players are in their turns
  if (!isDeselectCheck && gameState.activePlayerId !== gameState.startingPlayerId) {
    return false;
  }

  // Check if any player has reached the threshold
  return maxScore >= threshold;
}

/**
 * End the current round and determine winner(s)
 */
export function endRound(gameState: any): void {
  // Find all players with the highest score (who reached or exceeded threshold)
  const maxScore = Math.max(...gameState.players.map((p: any) => p.score || 0));
  const roundWinners = gameState.players
    .filter((p: any) => p.score === maxScore)
    .map((p: any) => p.id);

  // Store winners for this round
  if (!gameState.roundWinners) {
    gameState.roundWinners = {};
  }
  gameState.roundWinners[gameState.currentRound] = roundWinners;

  // Check for game winner (first to 2 round wins)
  const totalWins: Record<number, number> = {};
  Object.values(gameState.roundWinners).forEach((winners: any) => {
    (winners as number[]).forEach((winnerId: number) => {
      totalWins[winnerId] = (totalWins[winnerId] || 0) + 1;
    });
  });

  // Check if anyone has won 2 rounds
  for (const [playerId, winCount] of Object.entries(totalWins)) {
    if (winCount >= 2) {
      gameState.gameWinner = parseInt(playerId, 10);
      break;
    }
  }

  // Mark round as triggered and open modal
  gameState.roundEndTriggered = true;
  gameState.isRoundEndModalOpen = true;

  // Log round end
  const winnerNames = roundWinners.map((id: number) => {
    const player = gameState.players.find((p: any) => p.id === id);
    return player?.name || `Player ${id}`;
  });

  logAction(gameState.gameId, GameActions.ROUND_ENDED, {
    round: gameState.currentRound,
    winners: roundWinners,
    winnerNames,
    maxScore,
    allScores: gameState.players.map((p: any) => ({ id: p.id, name: p.name, score: p.score })),
    gameWinner: gameState.gameWinner
  }).catch();
}

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
  } catch (error) {
    logger.error('Failed to toggle auto draw:', error);
  }
}

/**
 * Handle TOGGLE_ACTIVE_PLAYER message
 * Sets the active player
 * Triggers the hidden Draw phase (-1) which automatically transitions to Setup (0)
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

      // Log turn end
      logAction(gameId, GameActions.TURN_ENDED, {
        playerId: playerId,
        playerName: gameState.players.find((p: any) => p.id === playerId)?.name
      }).catch();

      // Check for round end when deselecting the starting player during Setup phase
      // This handles the case where the starting player is already active and players
      // are deselecting to end their turn (completing a round cycle)
      if (playerId === gameState.startingPlayerId && gameState.currentPhase === 0) {
        if (checkRoundEnd(gameState, true)) {
          endRound(gameState);
        }
      }
    } else {
      gameState.activePlayerId = playerId;

      // Enter Draw phase (-1) when selecting a new active player
      // The draw phase will auto-draw a card and transition to Setup (0)
      gameState.currentPhase = -1;

      // Log turn start (before draw so we capture the player becoming active)
      logAction(gameId, GameActions.TURN_STARTED, {
        playerId: playerId,
        playerName: gameState.players.find((p: any) => p.id === playerId)?.name,
        previousPlayerId: previousActivePlayerId
      }).catch();

      performDrawPhase(gameState);
      gameState.lastDrawnPlayerId = playerId;  // Track for merge logic
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to toggle active player:', error);
  }
}

/**
 * Perform the hidden Draw phase
 * Draws exactly 1 card for the active player and transitions to Setup
 * Simple rule: draw 1 card from deck to hand when player becomes active
 */
export function performDrawPhase(gameState: any): void {
  if (gameState.activePlayerId === null) {
    gameState.currentPhase = 0;
    return;
  }

  const activePlayer = gameState.players.find((p: any) => p.id === gameState.activePlayerId);
  if (!activePlayer) {
    gameState.currentPhase = 0;
    return;
  }

  // Check if player has cards to draw
  if (!activePlayer.deck || activePlayer.deck.length === 0) {
    gameState.currentPhase = 0;
    return;
  }

  // Determine if auto-draw should happen
  let shouldDraw = false;
  if (activePlayer.isDummy) {
    const hostPlayer = gameState.players.find((p: any) => p.id === 1);
    shouldDraw = hostPlayer?.autoDrawEnabled === true;
  } else {
    shouldDraw = activePlayer.autoDrawEnabled !== false;
  }

  if (shouldDraw) {
    // Draw exactly 1 card from top of deck
    const cardToDraw = activePlayer.deck[0];
    const deckBefore = activePlayer.deck.length;
    activePlayer.deck.splice(0, 1);
    activePlayer.hand.push(cardToDraw);
    logger.info(`[DrawPhase] Player ${activePlayer.id} (${activePlayer.name}) drew ${cardToDraw?.name}, deck: ${deckBefore} -> ${activePlayer.deck.length}, hand: ${activePlayer.hand.length}`);

    // Log card draw
    logAction(gameState.gameId, GameActions.CARD_DRAWN, {
      playerId: activePlayer.id,
      playerName: activePlayer.name,
      cardId: cardToDraw?.id,
      cardName: cardToDraw?.name,
      cardsInDeck: activePlayer.deck.length,
      cardsInHand: activePlayer.hand.length
    }).catch();
  }

  // Transition to Setup phase
  gameState.currentPhase = 0;

  // Check for round end when entering Setup phase
  // This check happens after every draw phase, so when first player's turn comes around
  // and they enter Setup phase with phase=0, we check if round should end
  if (checkRoundEnd(gameState)) {
    endRound(gameState);
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

    // Get current phase or default to 0
    const currentPhase = gameState.currentPhase || 0;

    // Advance to next phase, wrapping around
    const nextPhase = (currentPhase + 1) % 4;
    gameState.currentPhase = nextPhase;

    // Log phase change
    logAction(gameId, GameActions.PHASE_CHANGED, {
      playerId: ws.playerId,
      fromPhase: currentPhase,
      toPhase: nextPhase,
      activePlayerId: gameState.activePlayerId
    }).catch();

    broadcastToGame(gameId, gameState);
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

    // Get current phase or default to 0
    const currentPhase = gameState.currentPhase || 0;

    // Go to previous phase, wrapping around
    const prevPhase = (currentPhase - 1 + 4) % 4;
    gameState.currentPhase = prevPhase;

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to retreat phase:', error);
  }
}

/**
 * Handle SET_PHASE message
 * Sets the turn phase to a specific index
 * Draw phase (-1) is now an explicit phase that triggers auto-draw
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

    // Allow phases -1 (Draw) to 3 (Scoring)
    if (numericPhaseIndex < -1 || numericPhaseIndex >= 4) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index. Must be between -1 and 3'
      }));
      return;
    }

    // Set the phase directly - auto-draw is handled by UPDATE_STATE when phase=-1 is sent
    // This keeps a single path: client sends UPDATE_STATE with phase=-1 + activePlayerId → draw
    gameState.currentPhase = numericPhaseIndex;

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set phase:', error);
  }
}

/**
 * Handle START_NEXT_ROUND message
 * Starts the next round after round end modal is closed
 * Resets scores to 0, increments round number, closes modal
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

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // If game has a winner, this is a "Continue Game" action - reset for new match
    if (gameState.gameWinner !== null) {
      // Reset for new match
      gameState.currentRound = 1;
      gameState.turnNumber = 1;
      gameState.roundWinners = {};
      gameState.gameWinner = null;
      gameState.roundEndTriggered = false;

      // Log new match start
      logAction(gameId, GameActions.MATCH_STARTED, {
        round: gameState.currentRound,
        startingPlayerId: gameState.startingPlayerId
      }).catch();
    } else {
      // Starting next round of current match
      gameState.currentRound++;

      // Log round start
      logAction(gameId, GameActions.ROUND_STARTED, {
        round: gameState.currentRound,
        startingPlayerId: gameState.startingPlayerId
      }).catch();
    }

    // Reset all player scores to 0
    gameState.players.forEach((p: any) => {
      p.score = 0;
    });

    // Close the modal
    gameState.isRoundEndModalOpen = false;

    // Keep the same starting player - they continue with their setup phase
    // Phase stays at 0 (Setup) for the starting player to begin

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to start next round:', error);
  }
}

/**
 * Handle START_NEW_MATCH message
 * Resets the entire game state for a new match
 */
export function handleStartNewMatch(ws, data) {
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

    // Reset all match state
    gameState.currentRound = 1;
    gameState.turnNumber = 1;
    gameState.roundWinners = {};
    gameState.gameWinner = null;
    gameState.roundEndTriggered = false;
    gameState.isRoundEndModalOpen = false;

    // Reset all player scores to 0
    gameState.players.forEach((p: any) => {
      p.score = 0;
    });

    // Log new match start
    logAction(gameId, GameActions.MATCH_STARTED, {
      round: gameState.currentRound,
      startingPlayerId: gameState.startingPlayerId,
      isNewMatch: true
    }).catch();

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to start new match:', error);
  }
}

/**
 * Handle START_NEW_MATCH message
 * Resets the entire game state for a new match
 */