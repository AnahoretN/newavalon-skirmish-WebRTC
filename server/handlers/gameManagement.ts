/**
 * @file Game management handlers
 * Handles game creation, joining, and leaving
 */

import { logger } from '../utils/logger.js';
import {
  getGameState,
  createGameState,
  associateClientWithGame,
  removeClientAssociation,
  getGameIdForClient,
  getAllGameLogs,
  updateGameState,
  logGameAction
} from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { createNewPlayer, generatePlayerToken, createDeck } from '../utils/deckUtils.js';
import {
  handlePlayerLeave,
  cancelPlayerDisconnectTimer,
  cancelGameTermination,
  endGame,
  resetInactivityTimer,
  broadcastGamesList
} from '../services/gameLifecycle.js';
import { performDrawPhase } from './phaseManagement.js';

const MAX_PLAYERS = 4;

/**
 * Handle SUBSCRIBE message
 * Associates a client with a game and sends current state
 */
export function handleSubscribe(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Associate this client with the game
    associateClientWithGame(ws, data.gameId);
    ws.gameId = data.gameId;

    // Send the current game state to the client
    broadcastToGame(data.gameId, gameState);

    logger.info(`Client subscribed to game ${data.gameId}`);
  } catch (error) {
    logger.error('Failed to subscribe client to game:', error);
  }
}

/**
 * Handle UPDATE_STATE message
 * Updates or creates game state from client
 */
export function handleUpdateState(ws, data) {
  try {
    // Extract gameState from the message - client sends { type: 'UPDATE_STATE', gameState: {...} }
    const { gameState: updatedGameState, playerToken } = data;

    // Validate game state object
    if (!updatedGameState || typeof updatedGameState !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid game state data'
      }));
      logger.warn('Invalid game state update received');
      return;
    }

    const gameIdToUpdate = updatedGameState.gameId;

    if (!gameIdToUpdate) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Missing gameId in game state'
      }));
      return;
    }

    const existingGameState = getGameState(gameIdToUpdate);
    if (existingGameState) {
      // Game exists - check if this is a player reconnecting
      let assignedPlayerId = null;

      // Store previous active player ID before update
      const previousActivePlayerId = existingGameState.activePlayerId;
      const previousPhase = existingGameState.currentPhase;

      if (playerToken) {
        // Try to find the player's slot by token (don't require isDisconnected - F5 reconnect is fast)
        const playerToRestore = existingGameState.players.find(
          p => p.playerToken === playerToken
        );
        if (playerToRestore) {
          // Clear any disconnect flags if present
          playerToRestore.isDisconnected = false;
          playerToRestore.isDummy = false;
          playerToRestore.disconnectTimestamp = undefined;
          assignedPlayerId = playerToRestore.id;
          logger.info(`Player ${assignedPlayerId} reconnected via UPDATE_STATE to game ${gameIdToUpdate}`);
        }
      }

      // If no player restored by token, try to assign as player 1 if disconnected
      if (assignedPlayerId === null) {
        const player1 = existingGameState.players.find(p => p.id === 1);
        if (player1 && player1.isDisconnected) {
          player1.isDisconnected = false;
          player1.isDummy = false;
          player1.disconnectTimestamp = undefined;
          assignedPlayerId = 1;
          logger.info(`Player 1 restored via UPDATE_STATE (disconnected) to game ${gameIdToUpdate}`);
        }
      }

      // Store client's phase and active player before Object.assign
      const clientPhase = updatedGameState.currentPhase;
      const clientActivePlayerId = updatedGameState.activePlayerId;

      // Update game state with client's state
      const clientPlayers = updatedGameState.players;

      // Check if client is requesting Draw Phase (phase -1) with an active player
      // Universal rule: phase=-1 + activePlayerId = draw 1 card for that player
      // This works for ALL players - first time, same player, different player, doesn't matter
      // IMPORTANT: Only draw if server phase is NOT already 0 (prevents duplicate draws from rapid client updates)
      // OR if server IS in phase 0 but client sent -1 (stale state from another client's draw) - just restore phase, don't draw again
      const clientRequestsDraw = clientPhase === -1 && clientActivePlayerId !== null && clientActivePlayerId !== undefined && previousPhase !== 0;

      // Detect if client is sending stale phase -1 after server has already processed draw
      // This happens when client sends UPDATE_STATE with old phase=-1 after server already moved to phase 0
      const isStalePhaseAfterDraw = clientPhase === -1 && previousPhase === 0;

      // Debug logging
      if (clientActivePlayerId !== undefined && clientActivePlayerId !== previousActivePlayerId) {
        logger.info(`[UpdateState] Player change: previous=${previousActivePlayerId}, client=${clientActivePlayerId}, phase=${clientPhase}, serverPhase=${previousPhase}`);
      } else if (clientActivePlayerId === undefined) {
        logger.info(`[UpdateState] No clientActivePlayerId in update`);
      } else if (clientPhase === -1) {
        if (previousPhase !== 0) {
          logger.info(`[UpdateState] Draw phase requested for player ${clientActivePlayerId} (server phase=${previousPhase})`);
        } else {
          logger.info(`[UpdateState] Stale phase -1 from client for player ${clientActivePlayerId} - server already in phase 0, will restore phase 0 without drawing`);
        }
      }

      // Perform draw FIRST on existing state (before any client data is applied)
      // Universal: phase=-1 with activePlayerId AND server not in phase 0 = draw for that player
      let drawnPlayerId: number | null = null;
      if (clientRequestsDraw) {
        const playerBeforeDraw = existingGameState.players.find(p => p.id === clientActivePlayerId);
        logger.info(`[UpdateState] 🎯 Triggering draw for player ${clientActivePlayerId}, BEFORE: hand=${playerBeforeDraw?.hand?.length || 0}, deck=${playerBeforeDraw?.deck?.length || 0}`);
        existingGameState.activePlayerId = clientActivePlayerId;
        performDrawPhase(existingGameState);
        drawnPlayerId = clientActivePlayerId;
        const playerAfterDraw = existingGameState.players.find(p => p.id === clientActivePlayerId);
        logger.info(`[UpdateState] 🎯 AFTER performDrawPhase: hand=${playerAfterDraw?.hand?.length || 0}, deck=${playerAfterDraw?.deck?.length || 0}`);
      } else if (clientActivePlayerId !== null && clientActivePlayerId !== undefined) {
        // No draw requested, just set the active player
        existingGameState.activePlayerId = clientActivePlayerId;
      }

      // Save server players AFTER draw (so we have the updated hand/deck)
      const serverPlayersAfterDraw = existingGameState.players;

      // IMPORTANT: Collect announced card IDs and discard card IDs from SERVER state BEFORE Object.assign
      // This is needed to clean up duplicates when command cards move from announced to discard
      //
      // IMPORTANT: Include ownerId in the key to prevent cross-player card removal
      const serverAnnouncedCardIds = new Set<string>();
      const serverDiscardCardIds = new Set<string>();
      existingGameState.players.forEach((player: any) => {
        if (player.announcedCard?.id && player.announcedCard.ownerId !== undefined) {
          serverAnnouncedCardIds.add(`${player.announcedCard.id}_${player.announcedCard.ownerId}`);
        }
        // Also collect IDs of cards already in discard before merge
        // If a card is already in discard, we shouldn't remove it again
        if (player.discard) {
          player.discard.forEach((card: any) => {
            if (card?.id) {
              serverDiscardCardIds.add(card.id);
            }
          });
        }
      });

      // Now update the game state with client's data (except for hand/deck of drawn player)
      // IMPORTANT: Preserve round end modal state - if modal is open on server, keep it open
      const preserveRoundEndState = existingGameState.isRoundEndModalOpen ||
                                   existingGameState.roundEndTriggered ||
                                   existingGameState.gameWinner !== null;

      // Store round end state before merge
      const roundEndStateToPreserve = {
        isRoundEndModalOpen: existingGameState.isRoundEndModalOpen,
        roundEndTriggered: existingGameState.roundEndTriggered,
        gameWinner: existingGameState.gameWinner,
        roundWinners: existingGameState.roundWinners
      };

      Object.assign(existingGameState, updatedGameState);

      // Restore round end state if it was active (prevent client from closing the modal)
      if (preserveRoundEndState) {
        existingGameState.isRoundEndModalOpen = roundEndStateToPreserve.isRoundEndModalOpen;
        existingGameState.roundEndTriggered = roundEndStateToPreserve.roundEndTriggered;
        existingGameState.gameWinner = roundEndStateToPreserve.gameWinner;
        existingGameState.roundWinners = roundEndStateToPreserve.roundWinners;
        logger.info(`[UpdateState] Preserving round end state - modalOpen: ${roundEndStateToPreserve.isRoundEndModalOpen}, winner: ${roundEndStateToPreserve.gameWinner}`);
      }

      // IMPORTANT: Restore phase to 0 if we just performed a draw OR if server phase was 0 but client sent -1
      // This prevents stale client state (phase=-1 from another client's draw) from triggering duplicate draws
      // Object.assign above may have overwritten the server's phase with client's stale phase (-1)
      if (drawnPlayerId !== null || (previousPhase === 0 && existingGameState.currentPhase === -1)) {
        existingGameState.currentPhase = 0;
        if (drawnPlayerId !== null) {
          logger.info(`[UpdateState] Restored phase to 0 after draw for player ${drawnPlayerId}`);
        } else {
          logger.info(`[UpdateState] Restored phase to 0 - server was in phase 0 but client sent stale phase -1`);
        }
      }

      // Merge players: smart merge of card state based on who sent the update
      // Rule: Client sending update is the authority for their own card state (hand/deck/discard)
      // Server state is preserved for other players to prevent stale data from overwriting
      // Additionally, if this is the active player, we trust their card state
      if (clientPlayers) {
        const mergedPlayers: any[] = [];
        const sendingPlayerId = ws.playerId;

        clientPlayers.forEach((clientPlayer: any) => {
          const serverPlayerAfterDraw = serverPlayersAfterDraw.find((p: any) => p.id === clientPlayer.id);
          if (serverPlayerAfterDraw) {
            // Determine if we should trust client's card state for this player
            // We trust client if: they ARE the sending player, OR they are the active player, OR they are a dummy player
            // Dummy players are controlled by the host, so host is authoritative for their card state
            const isSendingPlayer = clientPlayer.id === sendingPlayerId;
            const isActivePlayer = clientPlayer.id === clientActivePlayerId;
            const isDummyPlayer = serverPlayerAfterDraw.isDummy;
            const trustClientCards = isSendingPlayer || isActivePlayer || isDummyPlayer;

            // Also preserve server's boardHistory if it's longer (has more recent plays)
            // This prevents stale client state from overwriting correct LastPlayed order
            const serverHasMoreHistory = serverPlayerAfterDraw.boardHistory &&
              serverPlayerAfterDraw.boardHistory.length > (clientPlayer.boardHistory?.length || 0);

            // Special case: if we just drew for this player, ALWAYS use server's card state
              // Client's hand/deck are stale (they haven't received the draw yet)
              const justDrewForThisPlayer = drawnPlayerId === clientPlayer.id;

            // Also detect stale phase -1 after draw: client is sending old state but server already processed draw
            // In this case, preserve server's card state for the active player to prevent regression
              const isStaleStateForActivePlayer = isStalePhaseAfterDraw && clientPlayer.id === clientActivePlayerId;

            // CRITICAL: When client sends phase=-1 with a different activePlayerId (turn transition),
            // the previous active player's card state in the client's message is STALE.
            // The client doesn't know about cards that were drawn during previous turns.
            // We must preserve server's card state for ALL players except possibly the NEW active player.
            const isTurnTransition = clientPhase === -1 && clientActivePlayerId !== null && previousActivePlayerId !== clientActivePlayerId;
            const isNewActivePlayer = clientPlayer.id === clientActivePlayerId && isTurnTransition;

            // Log merge decision for debugging
            if (trustClientCards && !justDrewForThisPlayer && !isStaleStateForActivePlayer) {
              // Check if we're about to potentially overwrite server state with stale client data
              const serverHandCount = serverPlayerAfterDraw.hand?.length || 0;
              const clientHandCount = clientPlayer.hand?.length || 0;
              const serverDeckCount = serverPlayerAfterDraw.deck?.length || 0;
              const clientDeckCount = clientPlayer.deck?.length || 0;
              if (serverHandCount !== clientHandCount || serverDeckCount !== clientDeckCount) {
                logger.info(`[Merge] Player ${clientPlayer.id}: server hand=${serverHandCount} deck=${serverDeckCount}, client hand=${clientHandCount} deck=${clientDeckCount}, trust=true, isTurnTransition=${isTurnTransition}, isNewActivePlayer=${isNewActivePlayer}, isDummy=${isDummyPlayer}`);
              }
            }

            // Only trust client's card state if:
            // 1. Client is authoritative (sending player, active player, or dummy player)
            // 2. We didn't just draw for this player (client state is stale)
            // 3. This isn't stale phase -1 after draw
            // 4. For turn transitions (phase=-1), only trust NEW active player's state, preserve server state for all others
            if (trustClientCards && !justDrewForThisPlayer && !isStaleStateForActivePlayer && (isNewActivePlayer || !isTurnTransition)) {
              // Client is authoritative for their own card state (they just played/moved cards)

              // For boardHistory, use client's version during normal play (they just played a card)
              // But use server's version during turn transitions (client state might be stale)
              const useClientHistory = !isTurnTransition && (!serverHasMoreHistory || isNewActivePlayer);

              mergedPlayers.push({
                ...serverPlayerAfterDraw,
                ...clientPlayer,
                // Preserve server-side fields that shouldn't change
                playerToken: serverPlayerAfterDraw.playerToken,
                isDummy: serverPlayerAfterDraw.isDummy,
                isSpectator: serverPlayerAfterDraw.isSpectator,
                // Use client's boardHistory during normal play, server's during turn transitions
                boardHistory: useClientHistory ? clientPlayer.boardHistory :
                  (serverPlayerAfterDraw.boardHistory || clientPlayer.boardHistory || []),
              });
            } else {
              // For other players, preserve server's card state (prevent stale client data)
              // Also used when we just drew for this player (client state is stale)
              // Also used when client sends stale phase -1 after server already processed draw
              // Also used during turn transitions for all players except the new active player

              // Special case for boardHistory:
              // - During turn transitions, client's boardHistory might be stale (doesn't know about server-side changes)
              // - But when NOT in turn transition, client may have just played a card for this player (e.g., dummy)
              //   In that case, trust client's boardHistory if it's longer
              const clientHistoryIsLonger = !isTurnTransition && clientPlayer.boardHistory &&
                clientPlayer.boardHistory.length > (serverPlayerAfterDraw.boardHistory?.length || 0);

              mergedPlayers.push({
                ...serverPlayerAfterDraw,
                // Only allow client to update specific non-game-state fields
                name: clientPlayer.name ?? serverPlayerAfterDraw.name,
                color: clientPlayer.color ?? serverPlayerAfterDraw.color,
                isDisconnected: clientPlayer.isDisconnected ?? serverPlayerAfterDraw.isDisconnected,
                disconnectTimestamp: clientPlayer.disconnectTimestamp ?? serverPlayerAfterDraw.disconnectTimestamp,
                autoDrawEnabled: clientPlayer.autoDrawEnabled ?? serverPlayerAfterDraw.autoDrawEnabled,
                // IMPORTANT: Allow client to update score (this is how dummy players get points from scoring)
                score: clientPlayer.score ?? serverPlayerAfterDraw.score,
                // CRITICAL: Never let client overwrite other players' card state
                hand: serverPlayerAfterDraw.hand,
                deck: serverPlayerAfterDraw.deck,
                discard: serverPlayerAfterDraw.discard || [],
                // Preserve server's boardHistory during turn transitions (client state is stale)
                // Otherwise use whichever is longer (client may have just played a card)
                boardHistory: isTurnTransition ? (serverPlayerAfterDraw.boardHistory || []) :
                  (clientHistoryIsLonger ? clientPlayer.boardHistory : serverPlayerAfterDraw.boardHistory || []),
                // Preserve server-specific fields
                playerToken: serverPlayerAfterDraw.playerToken,
                isDummy: serverPlayerAfterDraw.isDummy,
                isSpectator: serverPlayerAfterDraw.isSpectator,
              });
            }
          } else {
            // New player (e.g., dummy added) - use client's data
            mergedPlayers.push(clientPlayer);
          }
        });

        existingGameState.players = mergedPlayers;
      } else {
        existingGameState.players = serverPlayersAfterDraw;
      }

      // CRITICAL FIX: Remove cards from hand/deck/discard that exist on the board or in announced slot
      // This prevents duplicate cards when:
      // 1. A non-active player moves a card (board was updated by Object.assign, but player hand/deck was restored)
      // 2. A command card is played (card moved to announced, but hand/discard may not have been updated by merge)
      //
      // IMPORTANT: Store card IDs with their ownerId to prevent removing cards from other players
      // who have the same card type (same ID but different ownerId)
      const boardCardIds = new Set<string>();
      existingGameState.board?.forEach((row: any[]) => {
        row.forEach((cell: any) => {
          if (cell.card?.id && cell.card.ownerId !== undefined) {
            // Store as "cardId_ownerId" to prevent cross-player card removal
            boardCardIds.add(`${cell.card.id}_${cell.card.ownerId}`);
          }
        });
      });

      // Combine server announced card IDs (collected before Object.assign) with current ones
      // This ensures we catch cards that were just moved from announced to discard
      const currentAnnouncedCardIds = new Set<string>();
      existingGameState.players.forEach((player: any) => {
        if (player.announcedCard?.id && player.announcedCard.ownerId !== undefined) {
          currentAnnouncedCardIds.add(`${player.announcedCard.id}_${player.announcedCard.ownerId}`);
        }
      });
      // Merge server and current announced card IDs
      serverAnnouncedCardIds.forEach(id => currentAnnouncedCardIds.add(id));

      // For each player, remove any cards that are on the board or in announced slot
      existingGameState.players.forEach((player: any) => {

        // First, deduplicate discard pile by card ID (can happen during merge when client and server both have the card)
        if (player.discard && player.discard.length > 0) {
          const seenIds = new Set<string>();
          const uniqueDiscard: any[] = [];
          for (const card of player.discard) {
            if (card && card.id && !seenIds.has(card.id)) {
              seenIds.add(card.id);
              uniqueDiscard.push(card);
            } else if (card && card.id && seenIds.has(card.id)) {
              logger.info(`[BoardHandSync] Removing duplicate card ${card.id} from player ${player.id}'s discard`);
            }
          }
          player.discard = uniqueDiscard;
        }

        const removeCardsFromList = (list: any[], isDiscardPile = false) => {
          if (!list) return;
          const initialLength = list.length;
          // Filter out cards that are on the board or in announced slot
          for (let i = list.length - 1; i >= 0; i--) {
            const card = list[i];
            const cardId = card.id;
            const cardOwnerId = card.ownerId;

            // Check if this specific card (by ID and ownerId) is on the board
            const cardKey = cardOwnerId !== undefined ? `${cardId}_${cardOwnerId}` : cardId;
            const isOnBoard = boardCardIds.has(cardKey);

            // For discard pile: only remove if card is on board (not if just in announced)
            // This is because cards moving from announced to discard is a valid operation
            // We'll handle announced card cleanup separately below
            if (isDiscardPile) {
              if (isOnBoard) {
                list.splice(i, 1);
              }
              // Skip cards that are in announced - they might be moving there legitimately
              // The announcedCard cleanup below will handle clearing duplicates
              continue;
            }

            // For hand and deck: remove if on board or in any player's announced slot
            if (isOnBoard || currentAnnouncedCardIds.has(cardKey)) {
              list.splice(i, 1);
            }
          }
          if (list.length !== initialLength) {
            logger.info(`[BoardHandSync] Removed ${initialLength - list.length} card(s) from player ${player.id}'s list that were on board or announced`);
          }
        };

        removeCardsFromList(player.hand);
        removeCardsFromList(player.deck);
        removeCardsFromList(player.discard, true); // isDiscardPile = true

        // Also clear announcedCard if it's on the board OR in the player's own discard/hand/deck
        // This prevents duplicate cards when command cards are moved from announced to discard
        if (player.announcedCard) {
          const announcedId = player.announcedCard.id;
          const announcedOwnerId = player.announcedCard.ownerId;
          const announcedKey = announcedOwnerId !== undefined ? `${announcedId}_${announcedOwnerId}` : announcedId;
          const isOnBoard = boardCardIds.has(announcedKey);
          // Check if the announced card is in this player's storage (hand, deck, discard)
          const isInStorage = player.hand?.some((c: any) => c?.id === announcedId) ||
                            player.deck?.some((c: any) => c?.id === announcedId) ||
                            player.discard?.some((c: any) => c?.id === announcedId);

          if (isOnBoard) {
            logger.info(`[BoardHandSync] Clearing announcedCard for player ${player.id} - card is on board`);
            player.announcedCard = null;
          } else if (isInStorage) {
            logger.info(`[BoardHandSync] Clearing announcedCard for player ${player.id} - card is in storage (hand/deck/discard), preventing duplicate`);
            player.announcedCard = null;
          }
        }
      });

      // Restore connection flags if reconnection
      if (assignedPlayerId !== null) {
        clientPlayers?.forEach((clientPlayer: any) => {
          const existingPlayer = existingGameState.players.find((p: any) => p.id === clientPlayer.id);
          if (existingPlayer) {
            existingPlayer.isDisconnected = clientPlayer.isDisconnected;
            existingPlayer.disconnectTimestamp = clientPlayer.disconnectTimestamp;
          }
        });
      }

      associateClientWithGame(ws, gameIdToUpdate);
      ws.gameId = gameIdToUpdate;
      ws.playerId = assignedPlayerId ?? 1; // Default to host if not assigned

      // Log board and hand state changes for the active player
      const activePlayer = existingGameState.players.find((p: any) => p.id === existingGameState.activePlayerId);
      if (activePlayer) {
        // Count cards on board owned by this player
        let cardsOnBoard = 0;
        const boardCards: string[] = [];
        existingGameState.board?.forEach((row: any[]) => {
          row.forEach((cell: any) => {
            if (cell.card?.ownerId === activePlayer.id) {
              cardsOnBoard++;
              boardCards.push(`${cell.card.name || cell.card.id}[${cell.card.power}${cell.card.bonusPower ? '+'+cell.card.bonusPower : ''}]`);
            }
          });
        });
        logger.info(`[BoardState] Player ${activePlayer.id} (${activePlayer.name}): ${cardsOnBoard} cards on board, ${activePlayer.hand?.length || 0} in hand, ${activePlayer.deck?.length || 0} in deck`);
        if (boardCards.length > 0) {
          logger.info(`[BoardState] Board cards: [${boardCards.join(', ')}]`);
        }
      }

      broadcastToGame(gameIdToUpdate, existingGameState);
      logger.info(`State updated for game ${gameIdToUpdate}, playerId=${ws.playerId}`);
    } else {
      // Game doesn't exist, create it
      // Add playerToken to all players that don't have one (coming from client)
      if (updatedGameState.players) {
        updatedGameState.players.forEach((p: any) => {
          if (!p.playerToken) {
            p.playerToken = generatePlayerToken();
            logger.info(`Generated playerToken for Player ${p.id} in new game ${gameIdToUpdate}`);
          }
        });
      }
      const newGameState = createGameState(gameIdToUpdate, updatedGameState);
      // Store player1's token for the host
      const player1 = newGameState.players.find((p: any) => p.id === 1);
      const player1Token = player1?.playerToken;
      associateClientWithGame(ws, gameIdToUpdate);
      ws.gameId = gameIdToUpdate;
      ws.playerId = 1; // Host is always player 1 for new games
      // Send JOIN_SUCCESS immediately with player1's token
      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        playerId: 1,
        playerToken: player1Token
      }));
      broadcastToGame(gameIdToUpdate, newGameState);
      logger.info(`New game created: ${gameIdToUpdate}, host assigned playerId=1`);
    }
  } catch (error) {
    logger.error('Failed to update game state:', error);
  }
}

/**
 * Handle JOIN_GAME message
 * Handles player joining a game (new, reconnection, or takeover)
 */
export function handleJoinGame(ws, data) {
  try {
    const { gameId, playerToken } = data;
    logger.info(`JOIN_GAME request: gameId=${gameId}, hasToken=${!!playerToken}, token=${playerToken?.substring(0, 12)}...`);

    const gameState = getGameState(gameId);

    if (!gameState) {
      logger.warn(`Game ${gameId} not found, sending ERROR to client`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Game with code ${gameId} not found.`
      }));
      return;
    }

    // Store the game ID on the WebSocket connection
    ws.gameId = gameId;
    associateClientWithGame(ws, gameId);

    // --- 1. Reconnection Logic (must be checked BEFORE isGameStarted) ---
    // Players with a valid playerToken can always reconnect, even if game started
    // This handles F5 refresh, temporary network issues, and tab reopening
    if (playerToken) {
      // Log all player tokens for debugging
      const playerInfo = gameState.players.map((p: any) => `Player${p.id}(token=${p.playerToken?.substring(0, 8)}..., dummy=${p.isDummy}, disconnected=${p.isDisconnected})`).join(', ');
      logger.info(`Current players in game: ${playerInfo}`);

      const playerToReconnect = gameState.players.find(
        p => p.playerToken === playerToken
      );
      if (playerToReconnect) {
        logger.info(`Reconnection: Player ${playerToReconnect.id} found with matching token, restoring...`);
        // Always allow reconnection with valid token
        playerToReconnect.isDisconnected = false;
        playerToReconnect.isDummy = false; // Restore as real player
        playerToReconnect.disconnectTimestamp = undefined; // Clear disconnect timestamp
        ws.playerId = playerToReconnect.id;

        // Cancel any game termination timer
        cancelGameTermination(gameId, getAllGameLogs());

        // Cancel pending disconnect/removal timers
        cancelPlayerDisconnectTimer(gameId, playerToReconnect.id);

        ws.send(JSON.stringify({
          type: 'JOIN_SUCCESS',
          playerId: playerToReconnect.id,
          playerToken: playerToReconnect.playerToken
        }));
        logger.info(`Player ${playerToReconnect.id} (${playerToReconnect.name}) reconnected to game ${gameId}`);
        broadcastToGame(gameId, gameState);
        return;
      } else {
        logger.info(`Reconnection: No player found with token ${playerToken.substring(0, 8)}... in game ${gameId}`);
      }
    }

    // Check if game has already started (only for NEW joins without valid token)
    if (gameState.isGameStarted) {
      logger.warn(`Game ${gameId} has already started, sending ERROR to client`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'This game has already started.'
      }));
      return;
    }

    // --- 2. Takeover "Ghost" Player Slot ---
    const playerToTakeOver = gameState.players.find(p => p.isDisconnected);
    if (playerToTakeOver) {
      playerToTakeOver.isDisconnected = false;
      playerToTakeOver.name = `Player ${playerToTakeOver.id}`;
      playerToTakeOver.playerToken = generatePlayerToken();
      playerToTakeOver.disconnectTimestamp = undefined; // Clear disconnect timestamp

      // Cancel any game termination timer
      cancelGameTermination(gameId, getAllGameLogs());

      // Cancel pending disconnect/removal timers
      cancelPlayerDisconnectTimer(gameId, playerToTakeOver.id);

      ws.playerId = playerToTakeOver.id;
      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        playerId: playerToTakeOver.id,
        playerToken: playerToTakeOver.playerToken
      }));
      logger.info(`New player took over slot ${playerToTakeOver.id} in game ${gameId}`);
      broadcastToGame(gameId, gameState);
      return;
    }

    // --- 3. Join as New Player if Space Available ---
    const activePlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const dummyPlayers = gameState.players.filter(p => p.isDummy);

    if (activePlayers.length + dummyPlayers.length >= MAX_PLAYERS) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game is full'
      }));
      return;
    }

    // Find the next available player ID
    const existingIds = new Set(gameState.players.map(p => p.id));
    let newPlayerId = 1;
    while (existingIds.has(newPlayerId)) {
      newPlayerId++;
    }

    // Create new player with full deck using createNewPlayer from deckUtils
    const newPlayer = createNewPlayer(newPlayerId);
    gameState.players.push(newPlayer);
    gameState.players.sort((a, b) => a.id - b.id);

    ws.playerId = newPlayerId;
    ws.send(JSON.stringify({
      type: 'JOIN_SUCCESS',
      playerId: newPlayerId,
      playerToken: newPlayer.playerToken
    }));
    logger.info(`Player ${newPlayerId} (${newPlayer.name}) joined game ${gameId}`);
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to join game:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to join game'
    }));
  }
}

/**
 * Handle EXIT_GAME message
 * Removes a player from the game
 */
export async function handleExitGame(ws, data) {
  try {
    const gameId = getGameIdForClient(ws);
    if (!gameId) {
      return;
    }

    const gameState = getGameState(gameId);
    if (!gameState) {
      return;
    }

    const playerId = data.playerId || ws.playerId;
    if (!playerId) {
      return;
    }

    // Check if this is the last active player
    const activePlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const isLeavingPlayerActive = activePlayers.some(p => p.id === playerId);

    if (isLeavingPlayerActive && activePlayers.length === 1) {
      // This was the last active human player - end the game immediately
      const gameLogs = getAllGameLogs();
      await endGame(gameId, 'last player left', gameLogs, ws.server?.clients?.wss);
      logger.info(`Player ${playerId} exited - was last active player, ending game ${gameId}`);
    } else {
      // Other active players remain, mark as disconnected
      // Pass TRUE for manual exit to prevent dummy conversion timer
      handlePlayerLeave(
        gameId,
        playerId,
        true, // isManualExit - prevents dummy conversion timer
        getAllGameLogs(),
        ws.server?.clients?.wss,
        broadcastToGame,
        () => broadcastGamesList(getAllGameLogs(), ws.server?.clients?.wss)
      );
      logger.info(`Player ${playerId} manually exited game ${gameId}`);
    }

    removeClientAssociation(ws);
  } catch (error) {
    logger.error('Failed to exit game:', error);
  }
}

/**
 * Handle FORCE_SYNC message
 * Host-only command to force sync game state to all clients
 */
export function handleForceSync(ws, data) {
  try {
    const { gameState: hostGameState } = data;
    const gameIdToSync = hostGameState ? hostGameState.gameId : null;

    if (!gameIdToSync || !getGameState(gameIdToSync)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Only the host can force a sync
    const gameState = getGameState(gameIdToSync);
    if (!gameState || ws.playerId !== gameState.hostId) {
      logger.warn(`Non-host player ${ws.playerId} attempted to force sync game ${gameIdToSync}`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Unauthorized: Only host can force sync'
      }));
      return;
    }

    // Reset inactivity timer
    resetInactivityTimer(gameIdToSync, getAllGameLogs(), ws.server?.clients?.wss);

    // Update game state
    updateGameState(gameIdToSync, hostGameState);
    logGameAction(gameIdToSync, `Host (Player ${ws.playerId}) forced a game state synchronization.`);

    logger.info(`Host forcing sync for game ${gameIdToSync}`);

    // Broadcast to ALL clients, including the host to confirm
    broadcastToGame(gameIdToSync, hostGameState);
  } catch (error) {
    logger.error('Failed to force sync:', error);
  }
}

/**
 * Handle JOIN_AS_INVITE message
 * Handles player joining via invite link - ALWAYS creates a new player slot or joins as spectator
 * This is different from JOIN_GAME which allows taking over disconnected slots
 */
export function handleJoinAsInvite(ws: any, data: any) {
  try {
    const { gameId, playerName = 'Player' } = data;
    logger.info(`JOIN_AS_INVITE request: gameId=${gameId}, playerName=${playerName}`);

    const gameState = getGameState(gameId);

    if (!gameState) {
      logger.warn(`Game ${gameId} not found, sending ERROR to client`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Game with code ${gameId} not found.`
      }));
      return;
    }

    // Store the game ID on the WebSocket connection
    ws.gameId = gameId;
    associateClientWithGame(ws, gameId);

    // Count all players (including disconnected ones) to get total slots used
    // Don't allow disconnected slots to be reused - invite link ALWAYS creates new players
    const allPlayers = gameState.players.filter(p => !p.isDummy && !p.isSpectator);
    const playerCount = allPlayers.length;

    logger.info(`Game ${gameId} has ${playerCount} total players (max: ${MAX_PLAYERS})`);

    // If game has less than 4 total players, create a new player slot
    if (playerCount < MAX_PLAYERS) {
      // Find the next available player ID (skip all existing IDs, including disconnected players)
      const existingIds = new Set(gameState.players.filter(p => !p.isSpectator).map(p => p.id));
      let newPlayerId = 1;
      while (existingIds.has(newPlayerId)) {
        newPlayerId++;
      }

      logger.info(`Invite: Creating new player with ID ${newPlayerId} (existing IDs: [${Array.from(existingIds).join(', ')}])`);

      // Create new player with full deck
      const newPlayer = createNewPlayer(newPlayerId);
      newPlayer.name = playerName;

      // Add new player using updateGameState for proper persistence
      const updatedPlayers = [...gameState.players, newPlayer];
      updatedPlayers.sort((a, b) => a.id - b.id);

      const updatedState = updateGameState(gameId, {
        players: updatedPlayers
      });

      ws.playerId = newPlayerId;
      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        playerId: newPlayerId,
        playerToken: newPlayer.playerToken,
        isSpectator: false
      }));
      logger.info(`Invite: New player ${newPlayerId} (${newPlayer.name}) joined game ${gameId}`);
      broadcastToGame(gameId, updatedState);
    } else {
      // Game is full (4 players), join as spectator
      const spectatorId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const spectator = {
        id: spectatorId,
        name: playerName,
        connectedAt: Date.now()
      };

      // Initialize spectators array if needed and add new spectator
      const currentSpectators = gameState.spectators || [];
      const updatedState = updateGameState(gameId, {
        spectators: [...currentSpectators, spectator]
      });

      ws.playerId = null; // Spectators have no player ID
      ws.spectatorId = spectatorId;

      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        spectatorId: spectatorId,
        isSpectator: true,
        message: `Game is full. You joined as a spectator.`
      }));
      logger.info(`Invite: ${playerName} joined game ${gameId} as spectator (${updatedState.spectators?.length || 0} spectators)`);
      broadcastToGame(gameId, updatedState);
    }
  } catch (error) {
    logger.error('Failed to join as invite:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to join game'
    }));
  }
}

/**
 * Handle SPECTATOR_LEAVE message
 * Removes a spectator from the game
 */
export function handleSpectatorLeave(ws: any, data: any) {
  try {
    const gameId = getGameIdForClient(ws);
    if (!gameId) {
      return;
    }

    const gameState = getGameState(gameId);
    if (!gameState) {
      return;
    }

    const { spectatorId } = data;
    if (!spectatorId) {
      return;
    }

    // Remove spectator from the list
    if (gameState.spectators) {
      gameState.spectators = gameState.spectators.filter((s: any) => s.id !== spectatorId);
      logger.info(`Spectator ${spectatorId} left game ${gameId} (${gameState.spectators.length} spectators remaining)`);
      broadcastToGame(gameId, gameState);
    }

    removeClientAssociation(ws);
  } catch (error) {
    logger.error('Failed to handle spectator leave:', error);
  }
}

/**
 * Handle RESET_GAME message
 * Resets game to lobby state while preserving players and their deck selections
 */
export function handleResetGame(ws: any, data: any) {
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

    logger.info(`[ResetGame] Resetting game ${gameId} to lobby state`);

    // Store current player data with their deck selections
    const playersToKeep = gameState.players.map((p: any) => {
      const deckType = p.selectedDeck || 'SynchroTech';
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        selectedDeck: deckType,
        playerToken: p.playerToken,
        isDummy: p.isDummy,
        isDisconnected: false,
        boardHistory: [],
        autoDrawEnabled: p.autoDrawEnabled !== false,
        hand: [],
        deck: createDeck(deckType, p.id, p.name),
        discard: [],
        score: 0,
        isReady: false,
        announcedCard: null,
      };
    });

    // Preserve game settings
    const preservedSettings = {
      gameMode: gameState.gameMode,
      isPrivate: gameState.isPrivate,
      activeGridSize: gameState.activeGridSize,
      dummyPlayerCount: gameState.dummyPlayerCount,
      autoAbilitiesEnabled: gameState.autoAbilitiesEnabled,
    };

    // Reset game state
    gameState.isGameStarted = false;
    gameState.currentPhase = 0;
    gameState.currentRound = 1;
    gameState.turnNumber = 1;
    gameState.activePlayerId = null;
    gameState.startingPlayerId = null;
    gameState.roundWinners = {};
    gameState.gameWinner = null;
    gameState.roundEndTriggered = false;
    gameState.isRoundEndModalOpen = false;
    gameState.isReadyCheckActive = false;

    // Clear the board with preserved grid size (activeGridSize is a number: 4, 5, 6, 7)
    const gridSize: number = (preservedSettings.activeGridSize as unknown as number) || 8;
    gameState.board = [];
    for (let i = 0; i < gridSize; i++) {
      const row: any[] = [];
      for (let j = 0; j < gridSize; j++) {
        row.push({ card: null });
      }
      gameState.board.push(row);
    }

    // Restore players with fresh decks
    gameState.players = playersToKeep;

    // Restore preserved settings
    gameState.gameMode = preservedSettings.gameMode;
    gameState.isPrivate = preservedSettings.isPrivate;
    gameState.activeGridSize = preservedSettings.activeGridSize;
    gameState.dummyPlayerCount = preservedSettings.dummyPlayerCount;
    gameState.autoAbilitiesEnabled = preservedSettings.autoAbilitiesEnabled;

    logger.info(`[ResetGame] Game ${gameId} reset to lobby. Players preserved: ${playersToKeep.length}`);

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to reset game:', error);
  }
}
