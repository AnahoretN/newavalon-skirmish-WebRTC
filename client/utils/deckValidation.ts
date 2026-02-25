/**
 * @file Deck validation utilities
 */

import { getCardDefinition } from '@/content'
import type { CustomDeckFile } from '@/types'

export const MAX_DECK_SIZE = 60

export type DeckValidationResult =
  | { isValid: true; deckFile: CustomDeckFile }
  | { isValid: false; error: string }

/**
 * Validates a custom deck file structure
 * @param data - The data to validate
 * @returns Validation result with either a valid deck file or an error message
 */
export const validateDeckData = (data: any): DeckValidationResult => {
  if (typeof data.deckName !== 'string' || !Array.isArray(data.cards)) {
    return {
      isValid: false,
      error: 'Invalid file structure. Must have \'deckName\' (string) and \'cards\' (array).'
    }
  }

  let totalCards = 0
  for (const card of data.cards) {
    if (typeof card.cardId !== 'string' || typeof card.quantity !== 'number' || card.quantity < 1 || !Number.isInteger(card.quantity)) {
      return { isValid: false, error: `Invalid card entry: ${JSON.stringify(card)}` }
    }
    if (!getCardDefinition(card.cardId)) {
      return { isValid: false, error: `Card with ID '${card.cardId}' does not exist.` }
    }
    totalCards += card.quantity
  }

  if (totalCards > MAX_DECK_SIZE) {
    return { isValid: false, error: `Deck exceeds the ${MAX_DECK_SIZE} card limit (found ${totalCards} cards).` }
  }

  // Sanitize cards array to only include required properties
  const sanitizedCards = data.cards.map((card: any) => ({
    cardId: card.cardId,
    quantity: card.quantity
  }))

  return {
    isValid: true,
    deckFile: {
      deckName: data.deckName,
      cards: sanitizedCards
    }
  }
}
