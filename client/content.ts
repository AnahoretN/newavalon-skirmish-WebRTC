/**
 * @file Content data loader - supports both embedded JSON and server API.
 * For GitHub Pages (static hosting), loads from embedded JSON.
 * For local development, can fetch from server API.
 */

import { DeckType } from './types'
import type { Card, CounterDefinition } from './types'

// Import embedded content database for static builds (GitHub Pages)
import embeddedDatabase from '../server/content/contentDatabase.json'

// --- Type assertion for the imported JSON data ---
interface RawDecksJson {
  cardDatabase: Record<string, Omit<Card, 'id' | 'deck'>>;
  tokenDatabase: Record<string, Omit<Card, 'id' | 'deck'>>;
  countersDatabase: Record<string, Omit<CounterDefinition, 'id'>>;
  deckFiles: {
    id: DeckType;
    name: string;
    isSelectable: boolean;
    cards: { cardId: string; quantity: number }[];
  }[];
}

// Base definition of a card, without instance-specific properties like id or deck.
export type CardDefinition = Omit<Card, 'id' | 'deck'>;

// --- Internal state management (prefixed with _) ---
let _rawJsonData: RawDecksJson | null = null
let _cardDatabase: Map<string, CardDefinition> = new Map()
let _tokenDatabase: Map<string, CardDefinition> = new Map()
let _countersDatabase: Record<string, Omit<CounterDefinition, 'id'>> = {}
let _deckFiles: RawDecksJson['deckFiles'] = []
let _decksData: Record<string, Card[]> = {}

// A Set of card IDs that are considered "Command" cards for special handling.
const _commandCardIds = new Set([
  'overwatch',
  'repositioning',
  'tacticalManeuver',
  'mobilization',
  'inspiration',
  'dataInterception',
  'falseOrders',
  'experimentalStimulants',
  'logisticsChain',
  'quickResponseTeam',
  'temporaryShelter',
  'enhancedInterrogation',
])

/**
 * Initialize content database from embedded JSON or server API
 * For GitHub Pages, uses embedded JSON directly.
 * For local dev with server, can fetch from API.
 */
export async function fetchContentDatabase(): Promise<void> {
  try {
    let data: RawDecksJson

    // Check if we're in local development (localhost or 127.0.0.1)
    // If not local, assume static hosting (GitHub Pages) and use embedded data
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

    // Try to fetch from server API first (for local development with server)
    // If that fails (e.g., on GitHub Pages), use embedded JSON
    if (isLocalDev) {
      try {
        const response = await fetch('/api/content/database')
        if (response.ok) {
          const apiData = await response.json()
          // Transform API response to match expected format
          const cards: [string, CardDefinition][] = apiData.cards.map(([id, card]: [string, CardDefinition]) => [id, card])
          const tokens: [string, CardDefinition][] = apiData.tokens.map(([id, token]: [string, CardDefinition]) => [id, token])

          data = {
            cardDatabase: Object.fromEntries(cards),
            tokenDatabase: Object.fromEntries(tokens),
            countersDatabase: Object.fromEntries(apiData.counters),
            deckFiles: apiData.deckFiles
          }
        } else {
          // Server responded but not OK, use embedded data
          data = embeddedDatabase as RawDecksJson
        }
      } catch {
        // Fetch failed (e.g., server not running), use embedded data
        data = embeddedDatabase as RawDecksJson
      }
    } else {
      // Static build - use embedded data directly
      data = embeddedDatabase as RawDecksJson
    }

    _rawJsonData = data

    // Initialize databases
    _cardDatabase = new Map(Object.entries(data.cardDatabase))
    _tokenDatabase = new Map(Object.entries(data.tokenDatabase))
    _countersDatabase = data.countersDatabase
    _deckFiles = data.deckFiles

    // Save counters database to localStorage for persistence across page reloads
    // This ensures counter icons (STATUS_ICONS) are available immediately on refresh
    try {
      localStorage.setItem('counters_database', JSON.stringify(_countersDatabase))
      localStorage.setItem('counters_timestamp', Date.now().toString())
    } catch (e) {
      console.warn('Could not save counters database to localStorage:', e)
    }

    // Update exported values (for backward compatibility)
    rawJsonData = _rawJsonData
    cardDatabase = _cardDatabase
    tokenDatabase = _tokenDatabase
    countersDatabase = _countersDatabase
    deckFiles = _deckFiles

    // Build decks data
    _decksData = buildDecksData()
    decksData = _decksData
  } catch (error) {
    console.error('Failed to load content database:', error)
    throw error
  }
}

/**
 * Processes the raw JSON data into a complete, playable deck data structure.
 * It combines card definitions with deck lists, expands card quantities,
 * and generates unique, dynamic IDs for each card instance.
 * @returns {Record<string, Card[]>} The fully constructed deck data object.
 */
function buildDecksData(): Record<string, Card[]> {
  const builtDecks: Record<string, Card[]> = {}

  for (const deckFile of _deckFiles) {
    const deckCardList: Card[] = []

    // Iterate through the card list in the deck definition file
    for (const deckEntry of deckFile.cards) {
      const cardDef = _cardDatabase.get(deckEntry.cardId)
      if (!cardDef) {
        console.warn(`Card definition not found for ID: ${deckEntry.cardId} in deck: ${deckFile.name}`)
        continue
      }

      const isCommandCard = _commandCardIds.has(deckEntry.cardId)

      // Add the specified quantity of each card to the deck
      for (let i = 0; i < deckEntry.quantity; i++) {
        // Use a collision-safe key encoding (base64url-like)
        const safeCardId = deckEntry.cardId.replace(/-/g, '--DASH--')
        const cardKey = safeCardId.toUpperCase()

        if (isCommandCard) {
          deckCardList.push({
            ...cardDef,
            deck: DeckType.Command,
            id: `CMD_${cardKey}_${i + 1}`,
            baseId: deckEntry.cardId, // Set baseId for localization
            faction: cardDef.faction || 'Command',
          })
        } else {
          deckCardList.push({
            ...cardDef,
            deck: deckFile.id,
            id: `${deckFile.id.substring(0, 3).toUpperCase()}_${cardKey}_${i + 1}`,
            baseId: deckEntry.cardId, // Set baseId for localization
            faction: cardDef.faction || deckFile.id,
          })
        }
      }
    }

    builtDecks[deckFile.id] = deckCardList
  }

  // Add the special "Tokens" deck, which is built from the token database.
  // Tokens use their defined types, with an empty array fallback (not hardcoded).
  builtDecks[DeckType.Tokens] = Array.from(_tokenDatabase.entries()).map(([tokenId, tokenDef]) => {
    const types = tokenDef.types ? [...tokenDef.types] : []

    return {
      id: `TKN_${tokenDef.name.toUpperCase().replace(/\s/g, '_')}`,
      baseId: tokenId, // Set baseId for localization
      deck: DeckType.Tokens,
      name: tokenDef.name,
      imageUrl: tokenDef.imageUrl,
      fallbackImage: tokenDef.fallbackImage,
      power: tokenDef.power,
      ability: tokenDef.ability,
      color: tokenDef.color,
      types: types,
      flavorText: tokenDef.flavorText,
      faction: 'Tokens',
    }
  })

  return builtDecks
}

// --- Backward compatibility exports ---
// These are mutable exports that will be updated after fetchContentDatabase

/**
 * Raw JSON data (for backward compatibility) - populated after fetchContentDatabase
 */
export let rawJsonData: RawDecksJson | null = null

/**
 * Card database (for backward compatibility) - populated after fetchContentDatabase
 */
export let cardDatabase: Map<string, CardDefinition> = new Map()

/**
 * Token database (for backward compatibility) - populated after fetchContentDatabase
 */
export let tokenDatabase: Map<string, CardDefinition> = new Map()

/**
 * Counters database (for backward compatibility) - populated after fetchContentDatabase
 */
export let countersDatabase: Record<string, Omit<CounterDefinition, 'id'>> = {}

// Load counters database from localStorage immediately for icon persistence
// This ensures STATUS_ICONS are available even before fetchContentDatabase completes
try {
  const cachedCounters = localStorage.getItem('counters_database')
  if (cachedCounters) {
    _countersDatabase = JSON.parse(cachedCounters)
    countersDatabase = _countersDatabase  // Update export immediately
  }
} catch (e) {
  // Silently fail if localStorage is not available
}

/**
 * Deck files (for backward compatibility) - populated after fetchContentDatabase
 */
export let deckFiles: RawDecksJson['deckFiles'] = []

/**
 * Decks data (for backward compatibility) - populated after fetchContentDatabase
 */
export let decksData: Record<string, Card[]> = {}

/**
 * Command card IDs set
 */
export const commandCardIds = _commandCardIds

/**
 * A utility function to get all selectable deck definitions for the UI.
 * @returns An array of deck file definitions that are marked as selectable.
 */
export const getSelectableDecks = () => {
  return _deckFiles.filter(df => df.isSelectable)
}

/**
 * Retrieves a card's base definition by its ID from the master card database.
 * @param {string} cardId The ID of the card (e.g., 'ipDeptAgent').
 * @returns {CardDefinition | undefined} The card definition or undefined if not found.
 */
export function getCardDefinition(cardId: string): CardDefinition | undefined {
  return _cardDatabase.get(cardId)
}

/**
 * Helper to find a card definition by its name (fuzzy match).
 * @param {string} name The name of the card.
 * @returns {CardDefinition | undefined}
 */
export function getCardDefinitionByName(name: string): CardDefinition | undefined {
  return Array.from(_cardDatabase.values()).find(c => c.name === name)
}

/**
 * Retrieves a list of all non-token cards for use in the deck builder library.
 * @returns An array of objects, each containing the card's ID and its definition.
 */
export function getAllCards(): { id: string, card: CardDefinition }[] {
  return Array.from(_cardDatabase.entries()).map(([id, card]) => ({ id, card }))
}

// Note: Exports are mutable and will be updated after fetchContentDatabase() is called

/**
 * Get the internal card database Map (for reactive updates in components)
 * This allows components to track when data changes
 */
export function getCardDatabaseMap(): Map<string, CardDefinition> {
  return _cardDatabase
}

/**
 * Get the internal token database Map
 */
export function getTokenDatabaseMap(): Map<string, CardDefinition> {
  return _tokenDatabase
}
