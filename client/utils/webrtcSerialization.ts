/**
 * Optimized WebRTC Serialization
 *
 * New simplified serialization using the game codec system.
 * - Card registry sent once at connection
 * - Binary encoding for card state
 * - Separate encoders for abilities and session events
 *
 * @module webrtcSerialization
 */

import { encode, decode } from '@msgpack/msgpack'
import type { GameState } from '../types'
import { logger } from './logger'
import {
  buildCardRegistry,
  serializeCardRegistry,
  deserializeCardRegistry,
  encodeCardState,
  decodeCardState,
  mergeDecodedState
} from './gameCodec'
import type { CardRegistry } from '../types/codec'

// ============================================================================
// CARD REGISTRY MANAGEMENT
// ============================================================================

/**
 * Global card registry instance
 */
let globalCardRegistry: CardRegistry | null = null

/**
 * Get or create the global card registry
 */
export function getCardRegistry(): CardRegistry {
  if (!globalCardRegistry) {
    globalCardRegistry = buildCardRegistry()
  }
  return globalCardRegistry
}

/**
 * Reset the global card registry (for testing)
 */
export function resetCardRegistry(): void {
  globalCardRegistry = null
}

// ============================================================================
// SERIALIZATION FUNCTIONS
// ============================================================================

/**
 * Serialize game state to binary format
 * This replaces the old delta system
 */
export function serializeGameState(
  gameState: GameState,
  localPlayerId: number | null
): Uint8Array {
  const registry = getCardRegistry()
  return encodeCardState(gameState, registry, localPlayerId)
}

/**
 * Deserialize game state from binary format
 */
export function deserializeGameState(
  data: Uint8Array,
  localPlayerId: number | null
): Partial<GameState> {
  const registry = getCardRegistry()
  return decodeCardState(data, registry, localPlayerId)
}

/**
 * Serialize card registry for transmission
 */
export { serializeCardRegistry }

/**
 * Deserialize card registry from transmission
 */
export { deserializeCardRegistry }

/**
 * Merge decoded state into existing state
 */
export { mergeDecodedState }

/**
 * Deserialize from binary (alias for compatibility)
 */
export function deserializeFromBinary(data: Uint8Array): any {
  return decode(data)
}

/**
 * Expand minimal game state (alias for compatibility)
 */
export function expandMinimalGameState(minimal: any): any {
  return minimal
}

// ============================================================================
// LEGACY FUNCTIONS (for backward compatibility during transition)
// ============================================================================

/**
 * Legacy: Serialize delta (deprecated - use serializeGameState)
 * @deprecated Use serializeGameState instead
 */
export function serializeDelta(delta: any): Uint8Array {
  logger.warn('[webrtcSerialization] serializeDelta is deprecated, using MessagePack fallback')
  try {
    return encode(delta)
  } catch (e) {
    logger.error('[webrtcSerialization] Failed to serialize delta:', e)
    return new Uint8Array(0)
  }
}

/**
 * Legacy: Deserialize delta (deprecated - use deserializeGameState)
 * @deprecated Use deserializeGameState instead
 */
export function deserializeDelta(data: Uint8Array): any {
  logger.warn('[webrtcSerialization] deserializeDelta is deprecated, using MessagePack fallback')
  try {
    return decode(data)
  } catch (e) {
    logger.error('[webrtcSerialization] Failed to deserialize delta:', e)
    return {}
  }
}

/**
 * Legacy: Base64 encoding (deprecated)
 * @deprecated Binary messages are sent directly now
 */
export function serializeDeltaBase64(delta: any): string {
  const binary = serializeDelta(delta)
  let binaryStr = ''
  const bytes = new Uint8Array(binary)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binaryStr += String.fromCharCode(bytes[i])
  }
  return btoa(binaryStr)
}

/**
 * Legacy: Base64 decoding (deprecated)
 * @deprecated Binary messages are sent directly now
 */
export function deserializeDeltaBase64(base64: string): any {
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return deserializeDelta(bytes)
}

// ============================================================================
// SERIALIZATION STATS (for debugging)
// ============================================================================

/**
 * Log serialization statistics for debugging
 */
export function logSerializationStats(delta: any): void {
  try {
    const jsonSize = JSON.stringify(delta).length
    const msgpackSize = serializeDelta(delta).length
    const reduction = ((1 - msgpackSize / jsonSize) * 100).toFixed(1)

    logger.info(`[Serialization] Size comparison:`, {
      json: `${jsonSize} bytes`,
      msgpack: `${msgpackSize} bytes`,
      reduction: `${reduction}% smaller than JSON`
    })
  } catch (e) {
    logger.warn('[Serialization] Could not calculate stats:', e)
  }
}

// ============================================================================
// MINIMAL GAME STATE SERIALIZATION (for initial connection)
// ============================================================================

/**
 * Create minimal game state for new connections
 */
export function createMinimalGameState(
  gameState: GameState
): any {
  return {
    gameId: gameState.gameId,
    gameMode: gameState.gameMode,
    isPrivate: gameState.isPrivate,
    isGameStarted: gameState.isGameStarted,
    isReadyCheckActive: gameState.isReadyCheckActive,
    activeGridSize: gameState.activeGridSize,
    currentPhase: gameState.currentPhase,
    activePlayerId: gameState.activePlayerId,
    currentRound: gameState.currentRound,
    players: gameState.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isDummy: p.isDummy,
      isReady: p.isReady,
      isDisconnected: p.isDisconnected,
      score: p.score,
      selectedDeck: p.selectedDeck,
      handSize: p.hand.length,
      deckSize: p.deck.length,
      discardSize: p.discard.length,
      teamId: p.teamId
    }))
  }
}

// ============================================================================
// OPTIMIZED STATE SERIALIZATION (MessagePack with Personalization)
// ============================================================================

/**
 * Serialize personalized game state using MessagePack
 * This preserves ALL functionality from createPersonalizedGameState while being more compact
 *
 * @param personalizedState - Already personalized game state from createPersonalizedGameState
 * @returns Base64-encoded MessagePack data
 */
export function serializePersonalizedState(personalizedState: GameState): string {
  try {
    // Use MessagePack to encode the state
    const encoded = encode(personalizedState)
    // Convert to base64 for transmission
    const binaryStr = String.fromCharCode(...encoded)
    return btoa(binaryStr)
  } catch (e) {
    logger.error('[serializePersonalizedState] Failed to encode:', e)
    throw e
  }
}

/**
 * Deserialize personalized game state from MessagePack
 *
 * @param base64Data - Base64-encoded MessagePack data
 * @returns Deserialized game state
 */
export function deserializePersonalizedState(base64Data: string): GameState {
  try {
    // Decode base64
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    // Decode MessagePack
    const decoded = decode(bytes)
    logger.info('[deserializePersonalizedizedState] Decoded state, has players:', !!(decoded as any).players, 'keys:', Object.keys(decoded))
    return decoded as GameState
  } catch (e) {
    logger.error('[deserializePersonalizedState] Failed to decode:', e)
    throw e
  }
}

/**
 * Serialize deck cards using MessagePack (optimized for DECK_VIEW_DATA / DECK_DATA_UPDATE)
 * Only sends baseId for each card - client reconstructs from contentDatabase
 *
 * @param deck - Array of cards to serialize
 * @returns Base64-encoded MessagePack data
 */
export function serializeDeckCards(deck: any[]): string {
  try {
    // Send only baseId array for minimal size
    const baseIds = deck.map(card => card.baseId || card.id)
    const encoded = encode(baseIds)
    const binaryStr = String.fromCharCode(...encoded)
    return btoa(binaryStr)
  } catch (e) {
    logger.error('[serializeDeckCards] Failed to encode:', e)
    throw e
  }
}

/**
 * Deserialize deck cards from baseId array
 * Reconstructs full cards from contentDatabase
 *
 * @param base64Data - Base64-encoded MessagePack data with baseId array
 * @param ownerId - Owner of the cards
 * @returns Array of reconstructed cards
 */
export function deserializeDeckCards(base64Data: string, ownerId: number): any[] {
  try {
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const baseIds = decode(bytes) as string[]

    // Reconstruct cards from contentDatabase
    const { getCardDefinition } = require('../content')
    return baseIds.map((baseId, index) => {
      const cardDef = getCardDefinition(baseId)
      if (cardDef) {
        return {
          id: `${ownerId}_deck_${index}_${Date.now()}`,
          baseId,
          name: cardDef.name,
          imageUrl: cardDef.imageUrl,
          power: cardDef.power || 0,
          ability: cardDef.ability || '',
          types: cardDef.types || [],
          faction: cardDef.faction || '',
          color: cardDef.color || 'Red',
          ownerId,
          isFaceDown: true,
          statuses: []
        }
      }
      // Fallback if card not found
      return {
        id: `${ownerId}_deck_${index}_${Date.now()}`,
        baseId,
        name: 'Unknown',
        imageUrl: '',
        power: 0,
        ownerId,
        isFaceDown: true,
        statuses: []
      }
    })
  } catch (e) {
    logger.error('[deserializeDeckCards] Failed to decode:', e)
    throw e
  }
}
