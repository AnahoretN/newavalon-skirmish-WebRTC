/**
 * Phase Message Codec
 *
 * Ultra-compact binary encoding for phase and turn management messages.
 * Uses minimal bytes to transmit phase changes between host and guests.
 *
 * Message format (all binary):
 * [MSG_TYPE: 1 byte] [TIMESTAMP: 4 bytes] [DATA_LENGTH: 2 bytes] [DATA...]
 *
 * Data format for PHASE_STATE_UPDATE:
 * [FLAGS: 1 byte] [PHASE: 1 byte] [ACTIVE_PLAYER: 1 byte] [STARTING_PLAYER: 1 byte]
 * [ROUND: 1 byte] [TURN: 1 byte] [IS_ROUND_END: 1 byte] [GAME_WINNER: 1 byte]
 *
 * FLAGS byte contains which fields are present/valid
 */

import type { PhaseState, GamePhase } from './PhaseTypes'
import { logger } from '../../utils/logger'

/**
 * Phase message types
 */
export enum PhaseMessageType {
  PHASE_STATE_UPDATE = 0x01,     // Full phase state update
  PHASE_TRANSITION = 0x02,        // Phase transition notification
  TURN_CHANGE = 0x03,             // Turn changed notification
  ROUND_END = 0x04,               // Round ended
  MATCH_END = 0x05,               // Match ended
  SCORING_MODE_START = 0x06,      // Scoring selection mode started
  SCORING_MODE_COMPLETE = 0x07,   // Scoring selection completed
  REQUEST_ACTION = 0x08,          // Guest requests phase action
  ACTION_RESULT = 0x09,           // Host sends action result
}

/**
 * Flags for PHASE_STATE_UPDATE data
 * Indicates which optional fields are present
 */
export enum PhaseStateFlags {
  NONE = 0x00,
  HAS_SCORING_STEP = 0x01,
  HAS_ROUND_END_MODAL = 0x02,
  HAS_ROUND_WINNERS = 0x04,
  HAS_GAME_WINNER = 0x08,
  IS_AUTO_DRAW_ENABLED = 0x10,
}

/**
 * Phase action types (from guest to host)
 */
export enum PhaseActionType {
  NEXT_PHASE = 0x01,
  PREVIOUS_PHASE = 0x02,
  PASS_TURN = 0x03,
  START_SCORING = 0x04,
  SELECT_LINE = 0x05,
  ROUND_COMPLETE = 0x06,
  START_NEXT_ROUND = 0x07,
  START_NEW_MATCH = 0x08,
  SET_PHASE = 0x09,     // Direct phase setting (e.g., jump to phase 3)
}

/**
 * Scoring line encoding
 */
export interface EncodedScoringLine {
  type: number    // 0=row, 1=col, 2=diag, 3=anti-diag
  index: number   // Row/col index
  points: number  // Potential points
}

/**
 * Encoded phase state update
 */
export interface EncodedPhaseState {
  flags: number
  phase: number
  activePlayerId: number
  startingPlayerId: number
  currentRound: number
  turnNumber: number
  isScoringStep: boolean
  isRoundEndModalOpen: boolean
  gameWinner: number | null
  autoDrawEnabled: boolean
}

/**
 * Encode phase state to binary format
 * Ultra-compact: only 10 bytes for full phase state
 */
export function encodePhaseState(state: PhaseState): Uint8Array {
  const buffer = new ArrayBuffer(10) // Fixed size for compact encoding
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Byte 0: Build flags
  let flags = PhaseStateFlags.NONE
  if (state.isScoringStep) flags |= PhaseStateFlags.HAS_SCORING_STEP
  if (state.isRoundEndModalOpen) flags |= PhaseStateFlags.HAS_ROUND_END_MODAL
  if (state.roundWinners && Object.keys(state.roundWinners).length > 0) {
    flags |= PhaseStateFlags.HAS_ROUND_WINNERS
  }
  if (state.gameWinner !== null) flags |= PhaseStateFlags.HAS_GAME_WINNER
  if (state.autoDrawEnabled) flags |= PhaseStateFlags.IS_AUTO_DRAW_ENABLED

  bytes[0] = flags

  // Byte 1: Phase
  bytes[1] = state.currentPhase

  // Byte 2: Active player ID (0 = null)
  bytes[2] = state.activePlayerId ?? 0

  // Byte 3: Starting player ID (0 = null)
  bytes[3] = state.startingPlayerId ?? 0

  // Byte 4: Current round
  bytes[4] = state.currentRound

  // Byte 5: Turn number
  bytes[5] = Math.min(state.turnNumber, 255)

  // Byte 6: Game winner (0 = none, 255 = null)
  bytes[6] = state.gameWinner === null ? 255 : Math.min(state.gameWinner, 254)

  // Bytes 7-8: Round winners bitmask (up to 16 players)
  // For simplicity, just send if there are any winners
  let winnersMask = 0
  if (state.roundWinners) {
    for (const winners of Object.values(state.roundWinners)) {
      for (const winnerId of winners) {
        if (winnerId < 16) {
          winnersMask |= (1 << winnerId)
        }
      }
    }
  }
  view.setUint16(7, winnersMask, false) // Big-endian

  // Byte 9: Reserved for future use
  bytes[9] = 0

  logger.debug(`[PhaseCodec] Encoded phase state: ${bytes.length} bytes`)

  return bytes
}

/**
 * Decode phase state from binary format
 */
export function decodePhaseState(data: Uint8Array): PhaseState {
  if (data.length < 10) {
    throw new Error(`Invalid phase state data: ${data.length} bytes, expected 10`)
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const flags = data[0]

  const phase = data[1] as GamePhase
  const activePlayerId = data[2] || null
  const startingPlayerId = data[3] || null
  const currentRound = data[4]
  const turnNumber = data[5]

  let gameWinner: number | null = data[6]
  if (gameWinner === 255) {
    gameWinner = null
  }

  const winnersMask = view.getUint16(7, false) // Big-endian
  const roundWinners: Record<number, number[]> = {}

  if (flags & PhaseStateFlags.HAS_ROUND_WINNERS) {
    // Decode winners from bitmask
    for (let i = 0; i < 16; i++) {
      if (winnersMask & (1 << i)) {
        // This is a simplified approach - in real use we'd need round numbers
        // For now, assume current round
        roundWinners[1] = roundWinners[1] || []
        roundWinners[1].push(i)
      }
    }
  }

  return {
    currentPhase: phase,
    activePlayerId,
    startingPlayerId,
    currentRound,
    turnNumber,
    isScoringStep: !!(flags & PhaseStateFlags.HAS_SCORING_STEP),
    isRoundEndModalOpen: !!(flags & PhaseStateFlags.HAS_ROUND_END_MODAL),
    roundWinners,
    gameWinner,
    autoDrawEnabled: !!(flags & PhaseStateFlags.IS_AUTO_DRAW_ENABLED),
  }
}

/**
 * Encode phase transition message
 * Ultra-compact: 5 bytes
 */
export function encodePhaseTransition(
  oldPhase: GamePhase,
  newPhase: GamePhase,
  oldActivePlayer: number | null,
  newActivePlayer: number | null
): Uint8Array {
  const bytes = new Uint8Array(5)

  bytes[0] = PhaseMessageType.PHASE_TRANSITION
  bytes[1] = oldPhase
  bytes[2] = newPhase
  bytes[3] = oldActivePlayer ?? 0
  bytes[4] = newActivePlayer ?? 0

  return bytes
}

/**
 * Decode phase transition message
 */
export function decodePhaseTransition(data: Uint8Array): {
  oldPhase: GamePhase
  newPhase: GamePhase
  oldActivePlayer: number | null
  newActivePlayer: number | null
} {
  if (data.length < 5) {
    throw new Error(`Invalid phase transition data: ${data.length} bytes, expected 5`)
  }

  return {
    oldPhase: data[1] as GamePhase,
    newPhase: data[2] as GamePhase,
    oldActivePlayer: data[3] || null,
    newActivePlayer: data[4] || null,
  }
}

/**
 * Encode turn change message
 * Ultra-compact: 3 bytes
 */
export function encodeTurnChange(oldPlayerId: number, newPlayerId: number): Uint8Array {
  const bytes = new Uint8Array(3)

  bytes[0] = PhaseMessageType.TURN_CHANGE
  bytes[1] = oldPlayerId
  bytes[2] = newPlayerId

  return bytes
}

/**
 * Decode turn change message
 */
export function decodeTurnChange(data: Uint8Array): {
  oldPlayerId: number
  newPlayerId: number
} {
  if (data.length < 3) {
    throw new Error(`Invalid turn change data: ${data.length} bytes, expected 3`)
  }

  return {
    oldPlayerId: data[1],
    newPlayerId: data[2],
  }
}

/**
 * Encode round end message
 */
export function encodeRoundEnd(
  roundNumber: number,
  winners: number[],
  isMatchOver: boolean,
  matchWinner: number | null
): Uint8Array {
  const bytes = new Uint8Array(6)

  bytes[0] = PhaseMessageType.ROUND_END
  bytes[1] = roundNumber

  // Winners bitmask (up to 8 players for compact encoding)
  let winnersMask = 0
  for (const winnerId of winners) {
    if (winnerId < 8) {
      winnersMask |= (1 << winnerId)
    }
  }
  bytes[2] = winnersMask

  bytes[3] = isMatchOver ? 1 : 0
  bytes[4] = matchWinner === null ? 255 : Math.min(matchWinner, 254)
  bytes[5] = 0 // Reserved

  return bytes
}

/**
 * Decode round end message
 */
export function decodeRoundEnd(data: Uint8Array): {
  roundNumber: number
  winners: number[]
  isMatchOver: boolean
  matchWinner: number | null
} {
  if (data.length < 6) {
    throw new Error(`Invalid round end data: ${data.length} bytes, expected 6`)
  }

  const winnersMask = data[2]
  const winners: number[] = []
  for (let i = 0; i < 8; i++) {
    if (winnersMask & (1 << i)) {
      winners.push(i)
    }
  }

  let matchWinner: number | null = data[4]
  if (matchWinner === 255) {
    matchWinner = null
  }

  return {
    roundNumber: data[1],
    winners,
    isMatchOver: data[3] === 1,
    matchWinner,
  }
}

/**
 * Encode scoring mode start message
 */
export function encodeScoringModeStart(
  activePlayerId: number,
  validLinesCount: number
): Uint8Array {
  const bytes = new Uint8Array(3)

  bytes[0] = PhaseMessageType.SCORING_MODE_START
  bytes[1] = activePlayerId
  bytes[2] = Math.min(validLinesCount, 255)

  return bytes
}

/**
 * Decode scoring mode start message
 */
export function decodeScoringModeStart(data: Uint8Array): {
  activePlayerId: number
  validLinesCount: number
} {
  if (data.length < 3) {
    throw new Error(`Invalid scoring mode start data: ${data.length} bytes, expected 3`)
  }

  return {
    activePlayerId: data[1],
    validLinesCount: data[2],
  }
}

/**
 * Encode scoring mode complete message
 */
export function encodeScoringModeComplete(
  playerId: number,
  lineType: number,
  lineIndex: number,
  points: number
): Uint8Array {
  const bytes = new Uint8Array(5)

  bytes[0] = PhaseMessageType.SCORING_MODE_COMPLETE
  bytes[1] = playerId
  bytes[2] = lineType
  bytes[3] = lineIndex
  bytes[4] = Math.min(points, 255)

  return bytes
}

/**
 * Decode scoring mode complete message
 */
export function decodeScoringModeComplete(data: Uint8Array): {
  playerId: number
  lineType: number
  lineIndex: number
  points: number
} {
  if (data.length < 5) {
    throw new Error(`Invalid scoring mode complete data: ${data.length} bytes, expected 5`)
  }

  return {
    playerId: data[1],
    lineType: data[2],
    lineIndex: data[3],
    points: data[4],
  }
}

/**
 * Encode phase action request (from guest to host)
 */
export function encodePhaseAction(
  action: PhaseActionType,
  playerId: number,
  data?: any
): Uint8Array {
  // Base message: 3 bytes
  // For SET_PHASE or SELECT_LINE, we need 2 extra bytes
  const bytes = new Uint8Array(data ? 5 : 3)

  bytes[0] = PhaseMessageType.REQUEST_ACTION
  bytes[1] = action
  bytes[2] = playerId

  if (data) {
    // For SELECT_LINE, encode line type and index
    if (action === PhaseActionType.SELECT_LINE && data.line) {
      bytes[3] = data.line.type ?? 0
      bytes[4] = data.line.index ?? 0
    }
    // For SET_PHASE, encode the phase number
    else if (action === PhaseActionType.SET_PHASE && data.phase !== undefined) {
      bytes[3] = data.phase
      bytes[4] = 0 // Reserved
    }
  }

  return bytes
}

/**
 * Decode phase action request
 */
export function decodePhaseAction(data: Uint8Array): {
  action: PhaseActionType
  playerId: number
  data?: any
} {
  if (data.length < 3) {
    throw new Error(`Invalid phase action data: ${data.length} bytes, expected at least 3`)
  }

  const action = data[1] as PhaseActionType
  const playerId = data[2]
  let extraData: any = undefined

  // Debug logging
  console.log('[PhaseMessageCodec] decodePhaseAction:', {
    dataLength: data.length,
    action,
    playerId,
    byte3: data.length >= 4 ? data[3] : 'N/A',
    byte4: data.length >= 5 ? data[4] : 'N/A'
  })

  if (data.length >= 5) {
    if (action === PhaseActionType.SELECT_LINE) {
      extraData = {
        line: {
          type: data[3],
          index: data[4]
        }
      }
    } else if (action === PhaseActionType.SET_PHASE) {
      extraData = {
        phase: data[3]
      }
      console.log('[PhaseMessageCodec] Decoded SET_PHASE:', extraData)
    }
  }

  return {
    action,
    playerId,
    data: extraData
  }
}

/**
 * Create a WebRTC-compatible message wrapper
 * This wraps the binary phase data in a WebrtcMessage
 */
export function createPhaseMessage<T extends WebrtcMessageType>(
  binaryData: Uint8Array,
  messageType: T
): {
  type: T
  data: string  // base64 encoded binary
  timestamp: number
} {
  // Convert to base64 for WebRTC transmission
  const base64 = btoa(String.fromCharCode(...binaryData))

  return {
    type: messageType,
    data: base64,
    timestamp: Date.now()
  }
}

// Import WebrtcMessageType for type safety
type WebrtcMessageType =
  | 'PHASE_STATE_UPDATE'
  | 'PHASE_TRANSITION'
  | 'TURN_CHANGE'
  | 'ROUND_END'
  | 'MATCH_END'
  | 'SCORING_MODE_START'
  | 'SCORING_MODE_COMPLETE'
  | 'PHASE_ACTION_REQUEST'
  | 'PHASE_ACTION_RESULT'

/**
 * Parse a WebRTC phase message
 */
export function parsePhaseMessage(message: { data: string }): Uint8Array {
  const base64 = message.data
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return bytes
}

/**
 * Helper: Get string representation of phase action
 */
export function getPhaseActionName(action: PhaseActionType): string {
  const names = [
    'UNKNOWN',
    'NEXT_PHASE',
    'PREVIOUS_PHASE',
    'PASS_TURN',
    'START_SCORING',
    'SELECT_LINE',
    'ROUND_COMPLETE',
    'START_NEXT_ROUND',
    'START_NEW_MATCH',
    'SET_PHASE',
  ]
  return names[action] || 'UNKNOWN'
}
