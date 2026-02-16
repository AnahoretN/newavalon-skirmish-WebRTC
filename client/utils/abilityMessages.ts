/**
 * Ability and Visual Effects Messages
 * Encodes ability activations and visual effects in minimal binary format
 */

import { CodecMessageType, AbilityEffectType } from '../types/codec'
import { logger } from './logger'

// Re-export for convenience
export type { AbilityEffectType }

/**
 * Encode ability effect message
 * Format: [MSG_TYPE: 1] [TIMESTAMP: 4] [EFFECT_TYPE: 1] [DATA...]
 */
export function encodeAbilityEffect(
  effectType: AbilityEffectType,
  data: {
    sourcePos?: { row: number; col: number }
    targetPositions?: Array<{ row: number; col: number }>
    text?: string
    value?: number
    playerId?: number
  }
): Uint8Array {
  const encoder = new TextEncoder()
  const buffers: Uint8Array[] = []

  // Header: [MSG_TYPE: 1] [TIMESTAMP: 4] [DATA_LENGTH: 2]
  const timestamp = Date.now()
  const header = new Uint8Array(7)
  header[0] = CodecMessageType.ABILITY_EFFECT
  header[1] = (timestamp >> 24) & 0xFF
  header[2] = (timestamp >> 16) & 0xFF
  header[3] = (timestamp >> 8) & 0xFF
  header[4] = timestamp & 0xFF
  buffers.push(header)

  const dataParts: Uint8Array[] = []

  // [EFFECT_TYPE: 1 byte]
  dataParts.push(new Uint8Array([effectType]))

  // [SOURCE_POS: 1 byte] (row in high nibble, col in low nibble)
  if (data.sourcePos) {
    const packed = ((data.sourcePos.row & 0x0F) << 4) | (data.sourcePos.col & 0x0F)
    dataParts.push(new Uint8Array([packed]))
  } else {
    dataParts.push(new Uint8Array([0xFF])) // 0xFF = no source
  }

  // [TARGET_COUNT: 1 byte]
  const targetCount = data.targetPositions?.length || 0
  dataParts.push(new Uint8Array([Math.min(targetCount, 255)]))

  // For each target: [POSITION: 1 byte]
  if (data.targetPositions) {
    for (const pos of data.targetPositions.slice(0, 255)) {
      const packed = ((pos.row & 0x0F) << 4) | (pos.col & 0x0F)
      dataParts.push(new Uint8Array([packed]))
    }
  }

  // [TEXT_LENGTH: 1 byte] [TEXT...] (for floating text)
  if (data.text) {
    const textBytes = encoder.encode(data.text)
    const textLen = Math.min(textBytes.length, 255)
    dataParts.push(new Uint8Array([textLen]))
    dataParts.push(textBytes.slice(0, textLen))
  } else {
    dataParts.push(new Uint8Array([0]))
  }

  // [VALUE: 1 byte] (for power changes, damage, etc.)
  dataParts.push(new Uint8Array([(data.value ?? 0) & 0xFF]))

  // [PLAYER_ID: 1 byte]
  dataParts.push(new Uint8Array([(data.playerId ?? 0) & 0xFF]))

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

  logger.debug(`[AbilityMessages] Encoded effect type ${effectType}: ${result.length} bytes`)

  return result
}

/**
 * Decode ability effect message
 */
export function decodeAbilityEffect(data: Uint8Array): {
  effectType: AbilityEffectType
  timestamp: number
  data: {
    sourcePos?: { row: number; col: number }
    targetPositions?: Array<{ row: number; col: number }>
    text?: string
    value?: number
    playerId?: number
  }
} {
  let offset = 0

  // Verify message type
  if (data[offset++] !== CodecMessageType.ABILITY_EFFECT) {
    throw new Error('Invalid message type, expected ABILITY_EFFECT')
  }

  // Read timestamp
  const timestamp = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]

  // Read data length (skip it)
  offset += 2

  const result: any = {
    effectType: data[offset++] as AbilityEffectType,
    timestamp,
    data: {}
  }

  // Read source position
  const sourcePacked = data[offset++]
  if (sourcePacked !== 0xFF) {
    result.data.sourcePos = {
      row: (sourcePacked >> 4) & 0x0F,
      col: sourcePacked & 0x0F
    }
  }

  // Read target count
  const targetCount = data[offset++]
  if (targetCount > 0) {
    result.data.targetPositions = []
    for (let i = 0; i < targetCount; i++) {
      const packed = data[offset++]
      result.data.targetPositions.push({
        row: (packed >> 4) & 0x0F,
        col: packed & 0x0F
      })
    }
  }

  // Read text
  const textLen = data[offset++]
  if (textLen > 0) {
    const decoder = new TextDecoder()
    result.data.text = decoder.decode(data.subarray(offset, offset + textLen))
    offset += textLen
  }

  // Read value
  result.data.value = data[offset++]

  // Read player ID
  result.data.playerId = data[offset++]

  logger.debug(`[AbilityMessages] Decoded effect type ${result.effectType}`)

  return result
}

/**
 * Helper: Create highlight effect
 */
export function createHighlightEffect(
  row: number,
  col: number,
  playerId: number
): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.HIGHLIGHT_CELL, {
    sourcePos: { row, col },
    playerId
  })
}

/**
 * Helper: Create floating text effect
 */
export function createFloatingTextEffect(
  row: number,
  col: number,
  text: string
): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.FLOATING_TEXT, {
    sourcePos: { row, col },
    text
  })
}

/**
 * Helper: Create targeting mode effect
 */
export function createTargetingModeEffect(
  sourcePos: { row: number; col: number },
  targetPositions: Array<{ row: number; col: number }>
): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.TARGETING_MODE, {
    sourcePos,
    targetPositions
  })
}

/**
 * Helper: Create clear targeting effect
 */
export function createClearTargetingEffect(): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.CLEAR_TARGETING, {})
}

/**
 * Helper: Create status added effect
 */
export function createStatusAddedEffect(
  row: number,
  col: number,
  statusType: string
): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.STATUS_ADDED, {
    sourcePos: { row, col },
    text: statusType
  })
}

/**
 * Helper: Create card destroyed effect
 */
export function createCardDestroyedEffect(
  row: number,
  col: number
): Uint8Array {
  return encodeAbilityEffect(AbilityEffectType.CARD_DESTROYED, {
    sourcePos: { row, col }
  })
}
