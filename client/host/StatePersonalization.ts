/**
 * State Personalization Utilities
 *
 * Utilities for creating personalized game states for different players
 * - Each player sees their own full hand/deck/discard
 * - Other players' hands are hidden (face-down)
 * - Revealed cards are visible to all
 * - Dummy players' data is fully visible (all players control them)
 *
 * Extracted from WebrtcManager for better separation of concerns
 */

import type { GameState, Card } from '../types'
import { logger } from '../utils/logger'

/**
 * Optimize card for network transmission
 * Removes heavy fields (fallbackImage)
 * Keeps gameplay-critical data and display data
 */
export function optimizeCard(card: Card): any {
  return {
    id: card.id,
    baseId: card.baseId,
    name: card.name,
    power: card.power,
    powerModifier: card.powerModifier || 0,
    isFaceDown: card.isFaceDown,
    statuses: card.statuses || [],
    ownerId: card.ownerId,
    deck: card.deck,
    // Include ability for board cards (needed for interactions)
    ability: card.ability,
    // Include color for display
    color: card.color,
    // Include types for ability validation
    types: card.types,
    // Include faction for display
    faction: card.faction,
    // Include imageUrl for board cards so they display with images
    imageUrl: card.imageUrl
  }
}

/**
 * Create a card-back representation for other players' hands
 * Only includes visibility-related info, not card content
 */
export function createCardBack(card: Card): any {
  return {
    id: card.id,
    baseId: card.baseId,
    name: card.name, // Name needed for display
    isFaceDown: card.isFaceDown,
    statuses: card.statuses || [],
    ownerId: card.ownerId, // Needed for card back color display
    deck: card.deck // Needed for card back theme
  }
}

/**
 * Create compact card data for transmission
 * Used when sender wants to minimize data (id + baseId + stats only)
 */
export interface CompactCardData {
  id: string
  baseId: string
  power: number
  powerModifier: number
  isFaceDown: boolean
  statuses: any[]
}

export function toCompactCardData(card: Card): CompactCardData {
  return {
    id: card.id,
    baseId: card.baseId || card.id, // Fallback to card.id if baseId is undefined
    power: card.power,
    powerModifier: card.powerModifier || 0,
    isFaceDown: card.isFaceDown ?? false,
    statuses: card.statuses || []
  }
}

/**
 * Create personalized game state for a specific player
 *
 * Rules:
 * - Own player: sees full hand/deck/discard (as compact card data)
 * - Dummy players: full data visible (all players control them)
 * - Other players: only revealed cards visible, rest are card backs
 * - Board: visible to all with proper face up/down status
 *
 * @param gameState - Current game state
 * @param recipientPlayerId - Player who will receive this state (null = host/observer)
 */
export function createPersonalizedGameState(
  gameState: GameState,
  recipientPlayerId: number | null
): GameState {
  return {
    ...gameState,
    players: gameState.players.map(p => {
      const isOwnHand = recipientPlayerId !== null && p.id === recipientPlayerId
      const isDummyPlayer = p.isDummy === true

      if (isOwnHand) {
        // Send COMPACT CARD DATA for own player's hand, deck, discard
        // This allows the guest to reconstruct full cards from their local contentDatabase
        const deckSize = p.deck.length ?? 0
        const discardSize = p.discard.length ?? 0
        const handSize = p.hand.length ?? 0

        logger.debug(`[createPersonalizedGameState] Player ${p.id} (own): ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
        return {
          ...p,
          // Send compact card data with baseId - client can reconstruct using getCardDefinition(baseId)
          handCards: p.hand.map(c => toCompactCardData(c)),
          deckCards: p.deck.map(c => toCompactCardData(c)),
          discardCards: p.discard.map(c => toCompactCardData(c)),
          // Don't send full arrays to avoid size limit
          hand: [],
          deck: [],
          discard: [],
          // Include minimal announced card info
          announcedCard: p.announcedCard ? optimizeCard(p.announcedCard) : null,
          // Always use actual array lengths for own player
          deckSize: deckSize,
          discardSize: discardSize,
          handSize: handSize
        }
      } else if (isDummyPlayer) {
        // CRITICAL: Send full deck data for dummy players since all players can control them
        // Guests need accurate deck state because they can't know which cards were drawn
        const deckSize = p.deck.length ?? 0
        const discardSize = p.discard.length ?? 0
        const handSize = p.hand.length ?? 0
        logger.info(`[createPersonalizedGameState] Player ${p.id} (dummy): sending ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
        return {
          ...p,
          // Send compact card data with baseId for dummy player's hand, deck, discard
          handCards: p.hand.map(c => toCompactCardData(c)),
          deckCards: p.deck.map(c => toCompactCardData(c)),
          discardCards: p.discard.map(c => toCompactCardData(c)),
          hand: [],
          deck: [],
          discard: [],
          announcedCard: p.announcedCard ? optimizeCard(p.announcedCard) : null,
          deckSize: deckSize,
          discardSize: discardSize,
          handSize: handSize
        }
      } else {
        // Send card data for other players (non-dummy)
        // - Revealed cards (isFaceDown=false) are sent as compact data for viewing
        // - Face-down cards are sent as card backs
        const deckSize = p.deckSize ?? p.deck.length ?? 0
        // Count revealed cards for debug logging
        const revealedCount = p.hand.filter(c => !c.isFaceDown).length
        if (revealedCount > 0) {
          logger.debug(`[createPersonalizedGameState] Player ${p.id} (other): ${revealedCount} revealed, ${p.hand.length - revealedCount} face-down`)
        }
        return {
          ...p,
          hand: p.hand.map(card => {
            // If card is revealed, send compact data (id + baseId + stats) so others can see it
            if (!card.isFaceDown) {
              return {
                id: card.id,
                baseId: card.baseId,
                power: card.power,
                powerModifier: card.powerModifier || 0,
                isFaceDown: card.isFaceDown,
                statuses: card.statuses || [],
                // Include minimal owner info for display
                ownerId: card.ownerId,
                ownerName: card.ownerName,
                deck: card.deck
              }
            }
            // Face-down card - send card back
            return createCardBack(card)
          }),
          deck: [],
          discard: [],
          announcedCard: p.announcedCard ? createCardBack(p.announcedCard) : null,
          // Keep size information for UI display (use stored size if available, fallback to array length)
          deckSize: deckSize,
          handSize: p.handSize ?? p.hand.length ?? 0,
          discardSize: p.discardSize ?? p.discard.length ?? 0
        }
      }
    }),
    // Optimize board cards - remove heavy fields but keep all gameplay data
    board: gameState.board.map(row =>
      row.map(cell => ({
        ...cell,
        card: cell.card ? optimizeCard(cell.card) : null
      }))
    ) as any
  }
}

/**
 * Create compact state for guest to send to host
 * - Send minimal card data (id + baseId + essential stats) for local player
 * - Host will reconstruct full cards using baseId from contentDatabase
 * - Send minimal data for other players (host already has their data)
 * - For dummy players: send full deck/discard data since all players can control them
 * - For other players: send hand cards that have statuses (modified by guest)
 */
export function createCompactStateForHost(
  gameState: GameState,
  localPlayerId: number
): GameState {
  return {
    ...gameState,
    players: gameState.players.map(p => {
      if (p.id === localPlayerId) {
        // Local player - send compact card data (id + baseId for reconstruction)
        logger.debug(`[createCompactStateForHost] Player ${p.id} (local): sending ${p.hand.length} hand cards, ${p.deck.length} deck cards`)
        return {
          ...p,
          // Send compact card data - host can reconstruct from baseId
          handCards: p.hand.map(c => toCompactCardData(c)),
          deckCards: p.deck.map(c => toCompactCardData(c)),
          discardCards: p.discard.map(c => toCompactCardData(c)),
          // Don't send full arrays
          hand: [],
          deck: [],
          discard: [],
          announcedCard: p.announcedCard ? optimizeCard(p.announcedCard) : null,
          // Keep sizes
          deckSize: p.deck.length,
          discardSize: p.discard.length,
          handSize: p.hand.length
        }
      } else {
        // Other players - send hand cards that have statuses (modified by guest)
        // This is needed when guest places Revealed tokens on other players' cards
        const handCardsWithStatuses = p.hand.filter((c: any) => c.statuses && c.statuses.length > 0)
        const shouldSendHandCards = handCardsWithStatuses.length > 0

        // CRITICAL: Check if this is a dummy player - all players can control them
        // so we need to send full deck/discard data for proper synchronization
        const isDummyPlayer = p.isDummy === true

        const compactPlayer: any = {
          ...p,
          // Send only hand cards that have been modified (have statuses)
          ...(shouldSendHandCards && {
            handCards: p.hand.map((c: any) => toCompactCardData(c))
          }),
          hand: [],
          deck: [],
          discard: [],
          announcedCard: null,
          deckSize: p.deckSize ?? p.deck.length ?? 0,
          handSize: p.handSize ?? p.hand.length ?? 0,
          discardSize: p.discardSize ?? p.discard.length ?? 0
        }

        // For dummy players, always send full deck/discard data (not just sizes)
        // This allows guests to draw cards, play cards, etc. for dummy players
        if (isDummyPlayer) {
          logger.info(`[createCompactStateForHost] Dummy player ${p.id}: sending ${p.hand.length} hand, ${p.deck.length} deck, ${p.discard.length} discard`)
          compactPlayer.handCards = p.hand.map((c: any) => toCompactCardData(c))
          compactPlayer.deckCards = p.deck.map((c: any) => toCompactCardData(c))
          compactPlayer.discardCards = p.discard.map((c: any) => toCompactCardData(c))
        }

        // Log score for debugging - CRITICAL for verifying score sync
        if (p.id === localPlayerId) {
          logger.info(`[createCompactStateForHost] Local player ${p.id} score: ${p.score}`)
        } else {
          logger.info(`[createCompactStateForHost] Other player ${p.id} (${isDummyPlayer ? 'dummy' : 'real'}) score: ${compactPlayer.score} (from original)`)
        }
        return compactPlayer
      }
    }),
    // Include minimal board state
    board: gameState.board.map(row =>
      row.map(cell => ({
        ...cell,
        card: cell.card ? optimizeCard(cell.card) : null
      }))
    ) as any
  }
}
