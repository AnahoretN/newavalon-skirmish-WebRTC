/**
 * @file Deck data handler
 * Handles deck content updates from the host
 */

import { logger } from '../utils/logger.js';
import { sanitizeString, validateMessageSize } from '../utils/security.js';
import { setCardDatabase, setTokenDatabase, setDeckFiles } from '../services/content.js';
import { isRateLimited } from '../services/rateLimit.js';
import { getGameState, getGameIdForClient } from '../services/gameState.js';
import type { WebSocket } from 'ws';

interface UpdateDeckDataPayload {
  deckData?: {
    cardDatabase?: Record<string, unknown>;
    tokenDatabase?: Record<string, unknown>;
    deckFiles?: unknown[];
  };
}

/**
 * Shared sanitization helper for cards and tokens
 * @param entityObj - The entity object to sanitize
 * @returns Sanitized entity object or null if invalid
 */
function sanitizeEntity(entityObj: any): Record<string, any> | null {
  if (typeof entityObj !== 'object' || !entityObj || !entityObj.name) {
    return null;
  }

  return {
    name: sanitizeString(String(entityObj.name)),
    ...(entityObj.imageUrl && { imageUrl: sanitizeString(String(entityObj.imageUrl), 500) }),
    ...(entityObj.fallbackImage && { fallbackImage: sanitizeString(String(entityObj.fallbackImage), 500) }),
    ...(entityObj.power !== undefined && { power: Number(entityObj.power) || 0 }),
    // ability and flavorText are from trusted source (contentDatabase.json), not user input
    // Only limit length, don't sanitize - preserve newlines for formatting
    ...(entityObj.ability && { ability: String(entityObj.ability).substring(0, 2000) }),
    ...(entityObj.flavorText && { flavorText: String(entityObj.flavorText).substring(0, 500) }),
    ...(entityObj.color && { color: sanitizeString(String(entityObj.color), 50) }),
    ...(entityObj.types && Array.isArray(entityObj.types) && {
      types: entityObj.types.slice(0, 20).map((t: any) => sanitizeString(String(t), 50))
    }),
    ...(entityObj.allowedPanels && Array.isArray(entityObj.allowedPanels) && {
      allowedPanels: entityObj.allowedPanels.slice(0, 10).map((p: any) => sanitizeString(String(p), 50))
    }),
  };
}

/**
 * Handle UPDATE_DECK_DATA message
 * Updates the card/token database from the host
 */
export function handleUpdateDeckData(ws: WebSocket & { playerId?: number }, data: UpdateDeckDataPayload): void {
  try {
    // Security: Validate message size
    if (!validateMessageSize(JSON.stringify(data))) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message size exceeds limit'
      }));
      return;
    }

    // Rate limit check
    if (isRateLimited(ws)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Rate limited'
      }));
      return;
    }

    // SECURITY: Only allow host to update deck data
    const gameId = getGameIdForClient(ws);
    if (!gameId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Not associated with a game'
      }));
      return;
    }

    const gameState = getGameState(gameId);
    if (!gameState || ws.playerId !== gameState.hostId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Unauthorized: Only host can update deck data'
      }));
      return;
    }

    const { deckData } = data;

    // Validate deck data structure
    if (!deckData || typeof deckData !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid deck data format'
      }));
      return;
    }

    // Validate deck data size (5MB limit)
    const deckDataSize = JSON.stringify(deckData).length;
    if (deckDataSize > 5 * 1024 * 1024) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Deck data too large'
      }));
      return;
    }

    // Sanitize and validate card database
    const sanitizedCardDatabase: Record<string, any> = {};
    if (deckData.cardDatabase && typeof deckData.cardDatabase === 'object') {
      for (const [cardId, card] of Object.entries(deckData.cardDatabase)) {
        const sanitized = sanitizeEntity(card);
        if (sanitized) {
          // Add card-specific fields
          const cardObj = card as any;
          sanitizedCardDatabase[cardId] = {
            ...sanitized,
            ...(cardObj.faction && { faction: sanitizeString(String(cardObj.faction), 50) }),
          };
        }
      }
    }

    // Validate and sanitize deck files array
    const sanitizedDeckFiles = Array.isArray(deckData.deckFiles)
      ? deckData.deckFiles.filter(deck => {
          const deckObj = deck as any;
          if (!deck || typeof deck !== 'object') {return false;}
          return deckObj.id && deckObj.name && typeof deckObj.id === 'string' && typeof deckObj.name === 'string';
        }).map(deck => {
          const deckObj = deck as any;
          const sanitizedDeck: any = {
            id: sanitizeString(String(deckObj.id), 50),
            name: sanitizeString(String(deckObj.name), 100),
            ...(deckObj.isSelectable !== undefined && { isSelectable: Boolean(deckObj.isSelectable) })
          };

          // Validate and sanitize cards array if present
          // Support both cardId/quantity (from JSON) and id/count (legacy) formats
          if (deckObj.cards && Array.isArray(deckObj.cards)) {
            const sanitizedCards = deckObj.cards
              .filter((card: any) => card && typeof card === 'object')
              .map((card: any) => {
                const cardId = String(card.cardId || card.id || '');
                const quantity = Math.max(0, Math.min(99, Number(card.quantity || card.count || 1)));
                return { cardId, quantity };
              })
              .filter((card: any) => card.cardId !== '');

            if (sanitizedCards.length > 0) {
              sanitizedDeck.cards = sanitizedCards;
            }
          }

          return sanitizedDeck;
        })
      : [];

    // Sanitize token database
    const sanitizedTokenDatabase: Record<string, any> = {};
    if (deckData.tokenDatabase && typeof deckData.tokenDatabase === 'object') {
      for (const [tokenId, token] of Object.entries(deckData.tokenDatabase)) {
        const sanitized = sanitizeEntity(token);
        if (sanitized) {
          sanitizedTokenDatabase[tokenId] = sanitized;
        }
      }
    }

    // Update the content services
    setCardDatabase(sanitizedCardDatabase);
    setTokenDatabase(sanitizedTokenDatabase);
    setDeckFiles(sanitizedDeckFiles);

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'DECK_DATA_UPDATED',
      success: true
    }));

  } catch (error) {
    logger.error('Failed to update deck data:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to update deck data'
    }));
  }
}
