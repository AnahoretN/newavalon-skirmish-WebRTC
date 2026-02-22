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
  encodeCardState,
  decodeCardState,
  mergeDecodedState
} from './gameCodec'

// ============================================================================
// SERIALIZATION FUNCTIONS
// ============================================================================

/**
 * Serialize game state to binary format
 * No registry needed - sends baseId directly, guest uses local contentDatabase
 */
export function serializeGameState(
  gameState: GameState,
  _localPlayerId: number | null
): Uint8Array {
  return encodeCardState(gameState)
}

/**
 * Deserialize game state from binary format
 * Uses local contentDatabase to look up cards by baseId
 */
export function deserializeGameState(
  data: Uint8Array,
  _localPlayerId: number | null
): Partial<GameState> {
  return decodeCardState(data)
}

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
 * Create minimal targeting mode data for serialization
 * Only includes data needed for visual display, not the full action (which contains functions)
 */
function createMinimalTargetingMode(targetingMode: any): any {
  if (!targetingMode) return null

  return {
    playerId: targetingMode.playerId,
    mode: targetingMode.action?.mode || targetingMode.mode,
    sourceCoords: targetingMode.sourceCoords,
    timestamp: targetingMode.timestamp,
    boardTargets: targetingMode.boardTargets,
    handTargets: targetingMode.handTargets,
    isDeckSelectable: targetingMode.isDeckSelectable,
    originalOwnerId: targetingMode.originalOwnerId,
    // Include sourceCard info for display
    sourceCardName: targetingMode.action?.sourceCard?.name,
    sourceCardId: targetingMode.action?.sourceCard?.id,
    // Don't include the full action - it contains functions that can't be serialized
  }
}

/**
 * Serialize personalized game state using MessagePack
 * This preserves ALL functionality from createPersonalizedGameState while being more compact
 *
 * @param personalizedState - Already personalized game state from createPersonalizedGameState
 * @returns Base64-encoded MessagePack data
 */
export function serializePersonalizedState(personalizedState: GameState): string {
  try {
    // Create a copy with minimal targetingMode for serialization
    const stateToSerialize = { ...personalizedState }
    if (stateToSerialize.targetingMode) {
      stateToSerialize.targetingMode = createMinimalTargetingMode(stateToSerialize.targetingMode)
    }

    // Use MessagePack to encode the state
    const encoded = encode(stateToSerialize)
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
    const decodedState = decoded as any
    logger.info('[deserializePersonalizedizedState] Decoded state, has players:', !!decodedState.players, 'keys:', Object.keys(decodedState))
    return decodedState as GameState
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
