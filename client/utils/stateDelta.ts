/**
 * State Delta - STUB FILE FOR TRANSITION
 * This file provides stub implementations to maintain compatibility during migration
 * @deprecated Use gameCodec.ts instead
 */

import type { GameState, StateDelta } from '../types'
import { logger } from './logger'

/**
 * Stub: Apply state delta
 * @deprecated Use decodeCardState from gameCodec instead
 */
export function applyStateDelta(currentState: GameState, _delta: StateDelta, _localPlayerId?: number | null): GameState {
  logger.warn('[stateDelta] applyStateDelta is deprecated, returning current state')
  // For now, return current state unchanged
  // Full migration will replace this with gameCodec.decodeCardState
  return currentState
}

/**
 * Stub: Create delta from states
 * @deprecated Use encodeCardState from gameCodec instead
 */
export function createDeltaFromStates(_oldState: GameState, _newState: GameState, sourcePlayerId: number): StateDelta {
  logger.warn('[stateDelta] createDeltaFromStates is deprecated, returning empty delta')
  return {
    timestamp: Date.now(),
    sourcePlayerId
  }
}

/**
 * Stub: Check if delta is empty
 */
export function isDeltaEmpty(delta: StateDelta): boolean {
  return !delta.boardCells?.length &&
         !delta.playerDeltas &&
         !delta.phaseDelta &&
         !delta.roundDelta &&
         !delta.targetingModeDelta &&
         !delta.abilityModeDelta
}

/**
 * Stub: Create reconnect snapshot
 * Uses MessagePack serialization for smaller size
 */
export function createReconnectSnapshot(gameState: GameState, localPlayerId?: number | null): {
  type: 'RECONNECT_SNAPSHOT'
  data: any
  _format?: string
} {
  // Import serializePersonalizedState dynamically to avoid circular dependency
  const { serializePersonalizedState } = require('./webrtcSerialization')

  // Create personalized state for the reconnecting player
  const { createPersonalizedGameState } = require('../host/StatePersonalization')
  const personalizedState = createPersonalizedGameState(gameState, localPlayerId ?? null)

  // Serialize using MessagePack
  const serializedState = serializePersonalizedState(personalizedState)

  return {
    type: 'RECONNECT_SNAPSHOT',
    data: serializedState,
    _format: 'msgpack'
  }
}

/**
 * Stub: Create card move delta
 */
export function createCardMoveDelta(
  playerId: number,
  _from: 'hand' | 'deck' | 'discard' | 'board',
  _to: 'hand' | 'deck' | 'discard' | 'board',
  _cardCount?: number,
  sourcePlayerId?: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId: sourcePlayerId || playerId
  }
}

/**
 * Stub: Create board cell delta
 */
export function createBoardCellDelta(
  _row: number,
  _col: number,
  card: any,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    boardCells: [{ row: 0, col: 0, card }]
  }
}

/**
 * Stub: Create phase delta
 */
export function createPhaseDelta(
  changes: any,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    phaseDelta: changes
  }
}

/**
 * Stub: Create round delta
 */
export function createRoundDelta(
  changes: any,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    roundDelta: changes
  }
}

/**
 * Stub: Create score delta
 */
export function createScoreDelta(
  playerId: number,
  scoreDelta: number,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    playerDeltas: {
      [playerId]: { id: playerId, scoreDelta }
    }
  }
}

/**
 * Stub: Create player property delta
 */
export function createPlayerPropertyDelta(
  playerId: number,
  properties: any,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    playerDeltas: {
      [playerId]: { id: playerId, ...properties }
    }
  }
}
