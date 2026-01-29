/**
 * @file Visual effects handlers
 * Handles triggering visual effects on clients
 */

import { logger } from '../utils/logger.js';
import { getGameState, getClientGameMap } from '../services/gameState.js';
import { getWssInstance } from '../services/websocket.js';
import {
  sanitizeString,
  validateMessageSize
} from '../utils/security.js';
import { CONFIG } from '../utils/config.js';
import type { WebSocket } from 'ws';

interface ExtendedWebSocket extends WebSocket {
  server?: any;
  playerId?: number;
  gameId?: string;
  clientGameMap?: Map<any, string>;
}

/**
 * Helper function to broadcast visual effects to all clients in a game
 * @param ws - WebSocket connection (used only for type reference)
 * @param gameId - Game ID (should be sanitized before calling)
 * @param messageType - Type of message to broadcast
 * @param payload - Message payload
 */
function broadcastVisualEffect(
  ws: ExtendedWebSocket,
  gameId: string,
  messageType: string,
  payload: Record<string, unknown>
): void {
  const message = JSON.stringify({
    type: messageType,
    ...payload
  });

  // Get wssInstance from websocket service
  const wssInstance = getWssInstance();

  // Get the client game map to find all clients associated with this game
  const clientGameMap = getClientGameMap();

  // Send to all connected clients associated with this game (including sender)
  if (wssInstance && wssInstance.clients) {
    wssInstance.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === 1 && clientGameMap.get(client) === gameId) {
        try {
          client.send(message);
        } catch (err: any) {
          logger.error(`Error sending ${messageType} to client:`, err);
        }
      }
    });
  }
}

/**
 * Handle TRIGGER_HIGHLIGHT message
 * Broadcasts a highlight effect to all clients in the game
 */
export function handleTriggerHighlight(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, highlightData } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!highlightData || typeof highlightData !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing highlightData'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the highlight event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'HIGHLIGHT_TRIGGERED', { highlightData });
  } catch (err: any) {
    logger.error('Failed to trigger highlight:', err);
  }
}

/**
 * Handle TRIGGER_NO_TARGET message
 * Broadcasts a "no target" overlay to all clients in the game
 */
export function handleTriggerNoTarget(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, coords, timestamp } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!coords || typeof coords !== 'object' || typeof coords.row !== 'number' || typeof coords.col !== 'number') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing coords'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the no-target event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'NO_TARGET_TRIGGERED', { coords, timestamp });
  } catch (err: any) {
    logger.error('Failed to trigger no target overlay:', err);
  }
}

/**
 * Handle TRIGGER_FLOATING_TEXT message
 * Broadcasts a floating text effect to all clients in the game
 */
export function handleTriggerFloatingText(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, floatingTextData } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!floatingTextData || typeof floatingTextData !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing floatingTextData'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the floating text event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'FLOATING_TEXT_TRIGGERED', { floatingTextData });
  } catch (err: any) {
    logger.error('Failed to trigger floating text:', err);
  }
}

/**
 * Handle TRIGGER_FLOATING_TEXT_BATCH message
 * Broadcasts a batch of floating text effects to all clients in the game
 */
export function handleTriggerFloatingTextBatch(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, batch } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!Array.isArray(batch)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing batch array'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the floating text batch event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'FLOATING_TEXT_BATCH_TRIGGERED', { batch });
  } catch (err: any) {
    logger.error('Failed to trigger floating text batch:', err);
  }
}

/**
 * Handle TRIGGER_DECK_SELECTION message
 * Broadcasts a deck selection effect to all clients in the game
 */
export function handleTriggerDeckSelection(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, deckSelectionData } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!deckSelectionData || typeof deckSelectionData !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing deckSelectionData'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the deck selection event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'DECK_SELECTION_TRIGGERED', { deckSelectionData });
  } catch (err: any) {
    logger.error('Failed to trigger deck selection:', err);
  }
}

/**
 * Handle TRIGGER_HAND_CARD_SELECTION message
 * Broadcasts a hand card selection effect to all clients in the game
 */
export function handleTriggerHandCardSelection(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, handCardSelectionData } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!handCardSelectionData || typeof handCardSelectionData !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing handCardSelectionData'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the hand card selection event to ALL clients in the game (including sender)
    broadcastVisualEffect(ws, sanitizedGameId, 'HAND_CARD_SELECTION_TRIGGERED', { handCardSelectionData });
  } catch (err: any) {
    logger.error('Failed to trigger hand card selection:', err);
  }
}

/**
 * Handle SET_TARGETING_MODE message
 * Sets the targeting mode for all clients in the game
 * Used universally for abilities, commands, and multi-step actions that require targeting
 */
export function handleSetTargetingMode(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, targetingMode } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    if (!targetingMode || typeof targetingMode !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing targetingMode'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Update the targeting mode in the game state
    gameState.targetingMode = targetingMode;

    // Broadcast the updated state to all clients
    broadcastVisualEffect(ws, sanitizedGameId, 'TARGETING_MODE_SET', { targetingMode });
  } catch (err: any) {
    logger.error('Failed to set targeting mode:', err);
  }
}

/**
 * Handle CLEAR_TARGETING_MODE message
 * Clears the targeting mode for all clients in the game
 */
export function handleClearTargetingMode(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    // Security: Sanitize gameId
    const sanitizedGameId = sanitizeString(gameId);

    const gameState = getGameState(sanitizedGameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Clear the targeting mode in the game state
    gameState.targetingMode = null;

    // Broadcast the cleared state to all clients
    broadcastVisualEffect(ws, sanitizedGameId, 'TARGETING_MODE_CLEARED', {});
  } catch (err: any) {
    logger.error('Failed to clear targeting mode:', err);
  }
}

/**
 * Handle SYNC_VALID_TARGETS message
 * Broadcasts valid targets from one player to other players in the game
 */
export function handleSyncValidTargets(ws: ExtendedWebSocket, data: any) {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Input validation
    if (!data || typeof data !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid data format'
      }));
      return;
    }

    const { gameId, playerId, validTargets, isDeckSelectable } = data;

    if (!gameId || typeof gameId !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid or missing gameId'
      }));
      return;
    }

    const sanitizedGameId = sanitizeString(gameId, CONFIG.MAX_STRING_LENGTH);

    // Validate that the game exists
    const gameState = getGameState(sanitizedGameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Broadcast the valid targets to all clients except the sender
    broadcastVisualEffect(ws, sanitizedGameId, 'SYNC_VALID_TARGETS', { playerId, validTargets, isDeckSelectable });
  } catch (err: any) {
    logger.error('Failed to sync valid targets:', err);
  }
}
