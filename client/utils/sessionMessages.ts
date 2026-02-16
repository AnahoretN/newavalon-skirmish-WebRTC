/**
 * Session Management Messages
 * Encodes game session events (connect, disconnect, phase change, etc.)
 */

import { CodecMessageType, SessionEventType } from '../types/codec'
import { logger } from './logger'

// Re-export for convenience
export { SessionEventType }

/**
 * Encode session event message
 * Format: [MSG_TYPE: 1] [TIMESTAMP: 4] [DATA_LENGTH: 2] [EVENT_TYPE: 1] [DATA...]
 */
export function encodeSessionEvent(
  eventType: SessionEventType,
  data: {
    playerId?: number
    playerName?: string
    startingPlayerId?: number
    roundNumber?: number
    winners?: number[]
    newPhase?: number
    newActivePlayerId?: number
    gameWinner?: number | null
  } = {}
): Uint8Array {
  const encoder = new TextEncoder()
  const buffers: Uint8Array[] = []

  // Header: [MSG_TYPE: 1] [TIMESTAMP: 4] [DATA_LENGTH: 2]
  const timestamp = Date.now()
  const header = new Uint8Array(7)
  header[0] = CodecMessageType.SESSION_EVENT
  header[1] = (timestamp >> 24) & 0xFF
  header[2] = (timestamp >> 16) & 0xFF
  header[3] = (timestamp >> 8) & 0xFF
  header[4] = timestamp & 0xFF
  buffers.push(header)

  const dataParts: Uint8Array[] = []

  // [EVENT_TYPE: 1 byte]
  dataParts.push(new Uint8Array([eventType]))

  // [PLAYER_ID: 1 byte] (if applicable)
  dataParts.push(new Uint8Array([(data.playerId ?? 0) & 0xFF]))

  // [PLAYER_NAME_LENGTH: 1 byte] [PLAYER_NAME...] (if applicable)
  if (data.playerName) {
    const nameBytes = encoder.encode(data.playerName)
    const nameLen = Math.min(nameBytes.length, 255)
    dataParts.push(new Uint8Array([nameLen]))
    dataParts.push(nameBytes.slice(0, nameLen))
  } else {
    dataParts.push(new Uint8Array([0]))
  }

  // [STARTING_PLAYER_ID: 1 byte]
  dataParts.push(new Uint8Array([(data.startingPlayerId ?? 0) & 0xFF]))

  // [ROUND_NUMBER: 1 byte]
  dataParts.push(new Uint8Array([Math.min(data.roundNumber ?? 0, 255)]))

  // [NEW_PHASE: 1 byte]
  dataParts.push(new Uint8Array([Math.min(data.newPhase ?? 0, 255)]))

  // [NEW_ACTIVE_PLAYER_ID: 1 byte]
  dataParts.push(new Uint8Array([(data.newActivePlayerId ?? 0) & 0xFF]))

  // [GAME_WINNER: 1 byte] (0 = no winner yet, 255 = none)
  dataParts.push(new Uint8Array([(data.gameWinner ?? 255) & 0xFF]))

  // [WINNERS_BITMASK: 4 bytes] (up to 32 players as bitmask)
  let winnersMask = 0
  if (data.winners) {
    for (const winnerId of data.winners) {
      if (winnerId < 32) {
        winnersMask |= (1 << winnerId)
      }
    }
  }
  dataParts.push(new Uint8Array([
    (winnersMask >> 24) & 0xFF,
    (winnersMask >> 16) & 0xFF,
    (winnersMask >> 8) & 0xFF,
    winnersMask & 0xFF
  ]))

  // Calculate total data length and fill header
  let dataLength = 0
  for (const part of dataParts) {
    dataLength += part.length
  }

  header[5] = (dataLength >> 8) & 0xFF
  header[6] = dataLength & 0xFF

  buffers.push(...dataParts)

  const result = new Uint8Array(buffers.reduce((sum, buf) => sum + buf.length, 0))
  let offset = 0
  for (const buf of buffers) {
    result.set(buf, offset)
    offset += buf.length
  }

  logger.debug(`[SessionMessages] Encoded event type ${eventType}: ${result.length} bytes`)

  return result
}

/**
 * Decode session event message
 */
export function decodeSessionEvent(data: Uint8Array): {
  eventType: SessionEventType
  timestamp: number
  data: {
    playerId?: number
    playerName?: string
    startingPlayerId?: number
    roundNumber?: number
    winners?: number[]
    newPhase?: number
    newActivePlayerId?: number
    gameWinner?: number | null
  }
} {
  let offset = 0

  // Verify message type
  if (data[offset++] !== CodecMessageType.SESSION_EVENT) {
    throw new Error('Invalid message type, expected SESSION_EVENT')
  }

  // Read timestamp
  const timestamp = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]

  // Read data length (skip it)
  offset += 2

  const result: any = {
    eventType: data[offset++] as SessionEventType,
    timestamp,
    data: {}
  }

  // Read player ID
  result.data.playerId = data[offset++]

  // Read player name
  const nameLen = data[offset++]
  if (nameLen > 0) {
    const decoder = new TextDecoder()
    result.data.playerName = decoder.decode(data.subarray(offset, offset + nameLen))
    offset += nameLen
  }

  // Read starting player ID
  result.data.startingPlayerId = data[offset++]

  // Read round number
  result.data.roundNumber = data[offset++]

  // Read new phase
  result.data.newPhase = data[offset++]

  // Read new active player ID
  result.data.newActivePlayerId = data[offset++]

  // Read game winner
  const gameWinner = data[offset++]
  result.data.gameWinner = gameWinner === 255 ? null : gameWinner

  // Read winners bitmask
  const winnersMask = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]
  if (winnersMask !== 0) {
    result.data.winners = []
    for (let i = 0; i < 32; i++) {
      if (winnersMask & (1 << i)) {
        result.data.winners.push(i)
      }
    }
  }

  logger.debug(`[SessionMessages] Decoded event type ${result.eventType}`)

  return result
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create player connected event
 */
export function createPlayerConnectedEvent(
  playerId: number,
  playerName: string
): Uint8Array {
  return encodeSessionEvent(SessionEventType.PLAYER_CONNECTED, {
    playerId,
    playerName
  })
}

/**
 * Create player disconnected event
 */
export function createPlayerDisconnectedEvent(
  playerId: number
): Uint8Array {
  return encodeSessionEvent(SessionEventType.PLAYER_DISCONNECTED, {
    playerId
  })
}

/**
 * Create game start event
 */
export function createGameStartEvent(
  startingPlayerId: number
): Uint8Array {
  return encodeSessionEvent(SessionEventType.GAME_START, {
    startingPlayerId
  })
}

/**
 * Create round start event
 */
export function createRoundStartEvent(
  roundNumber: number
): Uint8Array {
  return encodeSessionEvent(SessionEventType.ROUND_START, {
    roundNumber
  })
}

/**
 * Create round end event
 */
export function createRoundEndEvent(
  roundNumber: number,
  winners: number[]
): Uint8Array {
  return encodeSessionEvent(SessionEventType.ROUND_END, {
    roundNumber,
    winners
  })
}

/**
 * Create phase change event
 */
export function createPhaseChangeEvent(
  newPhase: number,
  newActivePlayerId?: number
): Uint8Array {
  return encodeSessionEvent(SessionEventType.PHASE_CHANGE, {
    newPhase,
    newActivePlayerId
  })
}

/**
 * Create turn change event
 */
export function createTurnChangeEvent(
  newActivePlayerId: number
): Uint8Array {
  return encodeSessionEvent(SessionEventType.TURN_CHANGE, {
    newActivePlayerId
  })
}

/**
 * Create game end event
 */
export function createGameEndEvent(
  winner: number | null
): Uint8Array {
  return encodeSessionEvent(SessionEventType.GAME_END, {
    gameWinner: winner
  })
}
