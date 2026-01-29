/**
 * @file Phase management handlers
 * Handles turn phase navigation and auto-abilities toggle
 *
 * Phase Structure:
 * 0: Preparation (hidden) - draws card, resets statuses, checks round end, auto-transitions to Setup
 * 1: Setup - setup abilities only
 * 2: Main - card play
 * 3: Commit - commit abilities only
 * 4: Scoring - full phase with auto-pass after point selection
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';
import { resetReadyStatusesForTurn } from '../utils/autoAbilities.js';

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

  // Don't check if round end modal is already open (prevents duplicate checks)
  if (gameState.isRoundEndModalOpen) {
    return false;
  }

  // Only check during Setup phase (1) when the starting player becomes active
  // This ensures the round is checked exactly once per round cycle
  if (gameState.currentPhase !== 1) {
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
 * Triggers the Preparation phase (0) which automatically transitions to Setup (1)
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
      gameState.activePlayerId = null;

      // Log turn end
      logAction(gameId, GameActions.TURN_ENDED, {
        playerId: playerId,
        playerName: gameState.players.find((p: any) => p.id === playerId)?.name
      }).catch();

      // Check for round end when deselecting the starting player during Setup phase
      // This handles the case where the starting player is already active and players
      // are deselecting to end their turn (completing a round cycle)
      if (playerId === gameState.startingPlayerId && gameState.currentPhase === 1) {
        if (checkRoundEnd(gameState, true)) {
          endRound(gameState);
        }
      }
    } else {
      gameState.activePlayerId = playerId;

      // Increment turn number when cycling back to starting player (completes a full orbit)
      if (playerId === gameState.startingPlayerId && previousActivePlayerId !== null) {
        gameState.turnNumber = (gameState.turnNumber || 1) + 1;
      }

      // Enter Preparation phase (0) when selecting a new active player
      // The preparation phase will auto-draw a card and transition to Setup (1)
      gameState.currentPhase = 0;

      // Log turn start (before draw so we capture the player becoming active)
      logAction(gameId, GameActions.TURN_STARTED, {
        playerId: playerId,
        playerName: gameState.players.find((p: any) => p.id === playerId)?.name,
        previousPlayerId: previousActivePlayerId
      }).catch();

      performPreparationPhase(gameState);
      gameState.lastDrawnPlayerId = playerId;  // Track for merge logic
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to toggle active player:', error);
  }
}

/**
 * Perform the Preparation phase (hidden from players)
 * Sub-steps:
 *   0.1: Check round completion
 *   0.2: Reset card statuses (readySetup, readyCommit)
 *   0.3: Draw card if auto-draw enabled
 *   0.4: (reserved for future actions)
 *   0.5: Auto-transition to Setup phase (1)
 * Simple rule: draw 1 card from deck to hand when player becomes active
 */
export function performPreparationPhase(gameState: any): void {
  // Sub-step 0.1: Check round completion (done at end after Setup transition)
  // Sub-step 0.2: Reset phase-specific ready statuses
  // Sub-step 0.3: Draw card
  // Sub-step 0.4: Reserved
  // Sub-step 0.5: Auto-transition to Setup

  if (gameState.activePlayerId === null) {
    gameState.currentPhase = 1;
    return;
  }

  const activePlayer = gameState.players.find((p: any) => p.id === gameState.activePlayerId);
  if (!activePlayer) {
    gameState.currentPhase = 1;
    return;
  }

  // Sub-step 0.3: Draw card if auto-draw enabled
  // Check if player has cards to draw
  if (!activePlayer.deck || activePlayer.deck.length === 0) {
    // No cards to draw, skip to status reset and transition
    resetReadyStatusesForTurn(gameState, gameState.activePlayerId);
    gameState.currentPhase = 1;
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

    // Log card draw (to detailed game logs)
    logAction(gameState.gameId, GameActions.CARD_DRAWN, {
      playerId: activePlayer.id,
      playerName: activePlayer.name,
      cardId: cardToDraw?.id,
      cardName: cardToDraw?.name,
      cardsInDeck: activePlayer.deck.length,
      cardsInHand: activePlayer.hand.length
    }).catch();
  }

  // Sub-step 0.2: Reset phase-specific ready statuses (readySetup, readyCommit) for the active player
  // This happens during Preparation phase, before entering Setup phase
  resetReadyStatusesForTurn(gameState, gameState.activePlayerId);

  // Sub-step 0.5: Transition to Setup phase
  gameState.currentPhase = 1;

  // Sub-step 0.1 (deferred): Check for round end when entering Setup phase
  // This check happens after every preparation phase, so when first player's turn comes around
  // and they enter Setup phase with phase=1, we check if round should end
  if (checkRoundEnd(gameState)) {
    endRound(gameState);
  }
}

/**
 * Handle NEXT_PHASE message
 * Advances to the next turn phase
 * When at Scoring (4), passes turn to next player and starts their Preparation phase
 * Preparation phase ALWAYS auto-transitions to Setup phase (1)
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

    const currentPhase = gameState.currentPhase || 1;

    // When at Scoring phase (4), next phase triggers turn passing
    if (currentPhase === 4) {
      // Store finishing player ID BEFORE changing activePlayerId
      const finishingPlayerId = gameState.activePlayerId;

      // Pass turn to next player
      let nextPlayerId = gameState.activePlayerId;
      if (nextPlayerId !== undefined && nextPlayerId !== null) {
        const sortedPlayers = [...gameState.players].sort((a, b) => a.id - b.id);
        const currentIndex = sortedPlayers.findIndex(p => p.id === nextPlayerId);
        if (currentIndex !== -1) {
          const nextIndex = (currentIndex + 1) % sortedPlayers.length;
          nextPlayerId = sortedPlayers[nextIndex].id;
        }
      }

      // Set new active player
      gameState.activePlayerId = nextPlayerId ?? null;

      // Increment turn number when cycling back to starting player (completes a full orbit)
      if (nextPlayerId === gameState.startingPlayerId && nextPlayerId !== finishingPlayerId) {
        gameState.turnNumber = (gameState.turnNumber || 1) + 1;
      }

      gameState.currentPhase = 0;  // Preparation phase - will auto-transition to Setup

      // Remove Stun from finishing player's cards
      if (finishingPlayerId !== null && finishingPlayerId !== undefined) {
        gameState.board.forEach((row: any[]) => {
          row.forEach((cell: any) => {
            if (cell.card?.ownerId === finishingPlayerId && cell.card.statuses) {
              const stunIndices = cell.card.statuses
                .map((s, i) => s.type === 'Stun' ? i : -1)
                .filter(i => i !== -1)
                .sort((a, b) => b - a); // Remove in reverse order to avoid index shifting
              stunIndices.forEach(idx => {
                cell.card.statuses.splice(idx, 1);
              });
            }
          });
        });
      }

      // Clear enteredThisTurn flags
      gameState.board.forEach((row: any[]) => {
        row.forEach((cell: any) => {
          if (cell.card) {
            delete cell.card.enteredThisTurn;
          }
        });
      });

      // Log turn start
      logAction(gameId, GameActions.TURN_STARTED, {
        playerId: nextPlayerId,
        playerName: gameState.players.find((p: any) => p.id === nextPlayerId)?.name,
        previousPlayerId: finishingPlayerId
      }).catch();

      // Perform Preparation phase - draws card, resets statuses, auto-transitions to Setup
      performPreparationPhase(gameState);

      // Log phase change
      logAction(gameId, GameActions.PHASE_CHANGED, {
        playerId: ws.playerId,
        fromPhase: currentPhase,
        toPhase: gameState.currentPhase,
        activePlayerId: gameState.activePlayerId
      }).catch();

      broadcastToGame(gameId, gameState);
      return;
    }

    // Normal phase transitions within the same player's turn
    const nextPhase = currentPhase + 1;
    gameState.currentPhase = nextPhase;

    // Log phase change
    logAction(gameId, GameActions.PHASE_CHANGED, {
      playerId: ws.playerId,
      fromPhase: currentPhase,
      toPhase: gameState.currentPhase,
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
 * NOTE: This is for navigation/correction, not for turn passing
 * Does not go below phase 1 (Setup) - Preparation is only entered via turn passing
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

    const currentPhase = gameState.currentPhase || 1;

    // Go to previous phase, but don't go below Setup (1)
    // Preparation (0) is only accessed via turn passing, not manual navigation
    const prevPhase = Math.max(1, currentPhase - 1);
    gameState.currentPhase = prevPhase;

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to retreat phase:', error);
  }
}

/**
 * Handle SET_PHASE message
 * Sets the turn phase to a specific index
 * Preparation phase (0) is hidden but can be set for turn passing
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

    // Allow phases 0 (Preparation) to 4 (Scoring)
    if (numericPhaseIndex < 0 || numericPhaseIndex > 4) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index. Must be between 0 and 4'
      }));
      return;
    }

    // Set the phase directly
    gameState.currentPhase = numericPhaseIndex;

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set phase:', error);
  }
}

/**
 * Handle START_NEXT_ROUND message
 * Starts the next round by resetting scores and closing the modal
 */
export function handleStartNextRound(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      logger.error(`[handleStartNextRound] Game not found: ${gameId}`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Increment round number
    const newRound = (gameState.currentRound || 1) + 1;
    gameState.currentRound = newRound;

    // Reset all player scores to 0
    gameState.players.forEach((p: any) => {
      p.score = 0;
    });

    // Close the modal
    gameState.isRoundEndModalOpen = false;

    // Reset round end triggered flag
    gameState.roundEndTriggered = false;

    // Update last activity timestamp
    gameState.lastActivity = Date.now();

    // Log next round start
    logAction(gameId, GameActions.ROUND_STARTED, {
      round: newRound,
      startingPlayerId: gameState.startingPlayerId
    }).catch();

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
