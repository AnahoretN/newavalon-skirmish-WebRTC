/**
 * Game State Codec - Optimized binary encoding for WebRTC P2P sync
 *
 * This module provides:
 * 1. Binary encoding/decoding of game state
 * 2. Bit packing for minimal message size
 */

import type { GameState, Card, Player, Board, CardStatus } from '../types'
import { DeckType } from '../types'
import { CodecMessageType } from '../types/codec'
import { logger } from './logger'
import { PLAYER_COLOR_NAMES } from '../constants'
import { getCardDefinition, rawJsonData, cardDatabase, tokenDatabase } from '../content'

// ============================================================================
// CARD STATE ENCODING
// ============================================================================

/**
 * Get card flags as number
 */
function getCardFlags(card: Card): number {
  let flags = 0
  if (card.isFaceDown) { flags |= 1 << 0 }
  if (card.enteredThisTurn) { flags |= 1 << 1 }
  if (card.revealedTo === 'all') { flags |= 1 << 2 }
  return flags
}

/**
 * Encode a card reference to bytes
 * Format: [baseIdLength: 1 byte] [baseId: string] [ownerId: 1 byte] [power: 1 byte] [flags: 1 byte] [statusMask: 4 bytes]
 * Guest will use baseId to look up full card data from local contentDatabase
 */
function encodeCardRef(card: Card): Uint8Array {
  const baseId = card.baseId || ''
  const encoder = new TextEncoder()
  const baseIdBytes = encoder.encode(baseId)

  const buffer = new Uint8Array(1 + baseIdBytes.length + 1 + 1 + 1 + 4)
  let offset = 0

  // baseIdLength
  buffer[offset++] = baseIdBytes.length

  // baseId
  buffer.set(baseIdBytes, offset)
  offset += baseIdBytes.length

  // ownerId
  buffer[offset++] = (card.ownerId ?? 0) & 0xFF

  // power (signed byte, clamped to -128 to 127)
  const power = Math.round(card.power || 0)
  buffer[offset++] = Math.clamp(power, -128, 127) & 0xFF

  // flags
  buffer[offset++] = getCardFlags(card)

  // statusMask (encode all statuses as bitmask)
  const statusMask = encodeStatusesToMask(card.statuses || [])
  buffer[offset++] = (statusMask >> 24) & 0xFF
  buffer[offset++] = (statusMask >> 16) & 0xFF
  buffer[offset++] = (statusMask >> 8) & 0xFF
  buffer[offset++] = statusMask & 0xFF

  return buffer
}

/**
 * Encode statuses to bitmask using known status types
 */
function encodeStatusesToMask(statuses: CardStatus[]): number {
  const statusTypes = [
    'Stun', 'Aim', 'Exploit', 'Poison', 'Shield', 'Riot', 'Flying',
    'Deploy', 'Setup', 'Commit', 'LastPlayed',
    'readyDeploy', 'readySetup', 'readyCommit'
  ]
  let mask = 0
  for (const status of statuses) {
    const index = statusTypes.indexOf(status.type)
    if (index >= 0 && index < 32) {
      mask |= (1 << index)
    }
  }
  return mask >>> 0
}

/**
 * Decode statuses from bitmask
 */
function decodeStatusesFromMask(mask: number, addedByPlayerId: number): CardStatus[] {
  const statusTypes = [
    'Stun', 'Aim', 'Exploit', 'Poison', 'Shield', 'Riot', 'Flying',
    'Deploy', 'Setup', 'Commit', 'LastPlayed',
    'readyDeploy', 'readySetup', 'readyCommit'
  ]
  const statuses: CardStatus[] = []
  for (let i = 0; i < 32; i++) {
    if (mask & (1 << i)) {
      const type = statusTypes[i]
      if (type) {
        statuses.push({ type, addedByPlayerId })
      }
    }
  }
  return statuses
}

/**
 * Encode full game state to binary
 * No registry needed - sends baseId directly, guest uses local contentDatabase
 */
export function encodeCardState(
  gameState: GameState
): Uint8Array {
  const buffers: Uint8Array[] = []

  // Header: [MSG_TYPE: 1 byte] [TIMESTAMP: 4 bytes] [DATA_LENGTH: 2 bytes]
  const timestamp = Date.now()
  const header = new Uint8Array(7)
  header[0] = CodecMessageType.CARD_STATE
  header[1] = (timestamp >> 24) & 0xFF
  header[2] = (timestamp >> 16) & 0xFF
  header[3] = (timestamp >> 8) & 0xFF
  header[4] = timestamp & 0xFF
  // Data length will be filled later
  buffers.push(header)

  // Collect data parts
  const dataParts: Uint8Array[] = []

  // [playerCount: 1 byte]
  const playerCount = Math.min(gameState.players.length, 255)
  dataParts.push(new Uint8Array([playerCount]))

  // For each player - only send metadata (not hand/deck/discard)
  // Hand/deck/discard are synced separately via STATE_UPDATE_COMPACT
  for (const player of gameState.players) {
    // [playerId: 1 byte]
    dataParts.push(new Uint8Array([player.id & 0xFF]))

    // [playerColor: 1 byte] - encoded as index (0-7) into PLAYER_COLOR_NAMES
    const colorIndex = PLAYER_COLOR_NAMES.indexOf(player.color as any)
    dataParts.push(new Uint8Array([colorIndex >= 0 ? colorIndex : 0]))

    // [score: 1 byte] - could be delta, but for now use direct value (clamped)
    dataParts.push(new Uint8Array([Math.min(player.score, 255)]))

    // [isReady: 1 byte]
    dataParts.push(new Uint8Array([player.isReady ? 1 : 0]))
  }

  // Board state
  // [boardSize: 1 byte] [rows: 1 byte] [cols: 1 byte]
  const boardSize = gameState.board.length
  dataParts.push(new Uint8Array([boardSize, boardSize, boardSize]))

  // Count board cards first
  const boardCards: Array<{row: number, col: number, card: Card}> = []
  for (let row = 0; row < gameState.board.length; row++) {
    for (let col = 0; col < gameState.board[row]?.length; col++) {
      const cell = gameState.board[row][col]
      if (cell?.card) {
        boardCards.push({ row, col, card: cell.card })
      }
    }
  }

  // [boardCardCount: 2 bytes]
  const boardCardCount = boardCards.length
  const boardCountBytes = new Uint8Array(2)
  boardCountBytes[0] = (boardCardCount >> 8) & 0xFF
  boardCountBytes[1] = boardCardCount & 0xFF
  dataParts.push(boardCountBytes)

  // For each board card: [row: 1 byte] [col: 1 byte] [cardData: variable]
  for (const { row, col, card } of boardCards) {
    dataParts.push(new Uint8Array([row, col]))
    dataParts.push(encodeCardRef(card))
  }

  // Phase info: [currentPhase: 1 byte] [activePlayerId: 1 byte] [currentRound: 1 byte]
  // Use 255 to indicate undefined/null values
  dataParts.push(new Uint8Array([
    gameState.currentPhase === undefined ? 255 : Math.clamp(gameState.currentPhase, 0, 254),
    (gameState.activePlayerId ?? 255) & 0xFF,
    gameState.currentRound === undefined ? 255 : Math.clamp(gameState.currentRound, 0, 254)
  ]))

  // Calculate total data length
  let dataLength = 0
  for (const part of dataParts) {
    dataLength += part.length
  }

  // Fill in data length in header
  header[5] = (dataLength >> 8) & 0xFF
  header[6] = dataLength & 0xFF

  // Combine all buffers
  buffers.push(...dataParts)
  const result = new Uint8Array(buffers.reduce((sum, buf) => sum + buf.length, 0))
  let offset = 0
  for (const buf of buffers) {
    result.set(buf, offset)
    offset += buf.length
  }

  logger.info(`[GameCodec] Encoded card state: ${result.length} bytes (${boardCardCount} board cards, ${gameState.players.length} players)`)

  return result
}

/**
 * Decode card state from binary
 * Uses local contentDatabase to look up card data by baseId
 */
export function decodeCardState(
  data: Uint8Array
): Partial<GameState> {
  let offset = 0

  // Verify message type
  if (data[offset++] !== CodecMessageType.CARD_STATE) {
    throw new Error('Invalid message type, expected CARD_STATE')
  }

  // Read timestamp
  const timestamp = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]

  // Read data length
  const dataLength = (data[offset++] << 8) | data[offset++]

  logger.info(`[GameCodec] Decoding card state: ${dataLength} bytes, timestamp=${timestamp}`)

  // Read player count
  const playerCount = data[offset++]

  const players: Player[] = []

  for (let i = 0; i < playerCount; i++) {
    const playerId = data[offset++]

    // Player color [1 byte] - index into PLAYER_COLOR_NAMES
    const colorIndex = data[offset++]
    const playerColor = PLAYER_COLOR_NAMES[colorIndex] || 'blue'

    // [score: 1 byte]
    const score = data[offset++]

    // [isReady: 1 byte]
    const isReady = data[offset++] === 1

    players.push({
      id: playerId,
      name: '',  // Will be filled from existing state
      color: playerColor,
      score: score,
      isReady: isReady,
      hand: [],  // Not sent in CARD_STATE anymore - synced via STATE_UPDATE_COMPACT
      deck: [], // Not sent in CARD_STATE anymore - synced via STATE_UPDATE_COMPACT
      discard: [], // Not sent in CARD_STATE anymore - synced via STATE_UPDATE_COMPACT
      announcedCard: null, // Not sent in CARD_STATE anymore - synced via STATE_UPDATE_COMPACT
      selectedDeck: DeckType.Random,  // Will be filled from existing state
      boardHistory: [],
      isDummy: false,
      isDisconnected: false,
      teamId: undefined
    })
  }

  // Read board
  const boardSize = data[offset++]
  offset++ // Skip duplicate rows
  offset++ // Skip duplicate cols

  const boardCardCount = (data[offset++] << 8) | data[offset++]

  // Create empty board
  const board: Board = []
  for (let row = 0; row < boardSize; row++) {
    const rowCells: any[] = []
    for (let col = 0; col < boardSize; col++) {
      rowCells.push({ card: null })
    }
    board.push(rowCells)
  }

  // Place cards on board
  for (let j = 0; j < boardCardCount; j++) {
    const row = data[offset++]
    const col = data[offset++]

    const { card, bytesConsumed } = decodeCardRef(data, offset)
    offset += bytesConsumed

    if (row < board.length && col < board[row].length) {
      board[row][col] = { card }
    }
  }

  // Read phase info (255 = undefined)
  const phaseByte = data[offset++]
  const activePlayerByte = data[offset++]
  const roundByte = data[offset++]

  const currentPhase = phaseByte === 255 ? undefined : phaseByte
  const activePlayerId = activePlayerByte === 255 ? null : activePlayerByte
  const currentRound = roundByte === 255 ? undefined : roundByte

  logger.info(`[GameCodec] Decoded: ${boardCardCount} board cards, ${playerCount} players, phase=${currentPhase}`)

  return {
    players,
    board,
    currentPhase,
    activePlayerId,
    currentRound
  }
}

/**
 * Decode card reference from bytes
 * Returns: { card: Card, bytesConsumed: number }
 * Uses local contentDatabase to look up card data by baseId
 */
function decodeCardRef(data: Uint8Array, offset: number): { card: Card, bytesConsumed: number } {
  const decoder = new TextDecoder()
  let pos = offset

  // baseIdLength
  const baseIdLength = data[pos++]

  // baseId
  const baseId = decoder.decode(data.subarray(pos, pos + baseIdLength))
  pos += baseIdLength

  // ownerId
  const ownerId = data[pos++]

  // power
  let power = data[pos++]
  if (power > 127) { power = power - 256 } // Convert to signed

  // flags
  const flags = data[pos++]

  // statusMask
  const statusMask = (data[pos++] << 24) | (data[pos++] << 16) | (data[pos++] << 8) | data[pos++]

  // Look up card definition from local contentDatabase
  const cardDef = getCardDefinitionFromLocal(baseId)

  return {
    card: {
      id: `${baseId}_${ownerId}_${Date.now()}_${Math.random()}`,
      baseId,
      deck: 'Random' as any,
      name: cardDef?.name || baseId,
      imageUrl: cardDef?.imageUrl || '',
      power,
      ability: cardDef?.ability || '',
      types: cardDef?.types || [],
      faction: cardDef?.faction || '',
      ownerId,
      isFaceDown: (flags & 1) !== 0,
      enteredThisTurn: (flags & 2) !== 0,
      revealedTo: (flags & 4) ? 'all' : undefined,
      statuses: decodeStatusesFromMask(statusMask, 0)
    },
    bytesConsumed: pos - offset
  }
}

/**
 * Get card definition from local contentDatabase
 * Uses the content module which imports embeddedDatabase
 */
function getCardDefinitionFromLocal(baseId: string): { name: string, imageUrl: string, power: number, ability: string, types: string[], faction: string } | null {
  try {
    // Try rawJsonData first (populated after fetchContentDatabase)
    if (rawJsonData) {
      if (rawJsonData.cardDatabase && rawJsonData.cardDatabase[baseId]) {
        const card = rawJsonData.cardDatabase[baseId]
        logger.debug(`[GameCodec] Found card ${baseId} in cardDatabase`)
        return {
          name: card.name || baseId,
          imageUrl: card.imageUrl || card.fallbackImage || '',
          power: card.power || 0,
          ability: card.ability || '',
          types: card.types || [],
          faction: card.faction || ''
        }
      }

      if (rawJsonData.tokenDatabase && rawJsonData.tokenDatabase[baseId]) {
        const token = rawJsonData.tokenDatabase[baseId]
        logger.debug(`[GameCodec] Found token ${baseId} in tokenDatabase`)
        return {
          name: token.name || baseId,
          imageUrl: token.imageUrl || token.fallbackImage || '',
          power: token.power || 0,
          ability: token.ability || '',
          types: token.types || [],
          faction: token.faction || ''
        }
      }
    }

    // Fallback: try getCardDefinition function (uses internal Map)
    const cardDef = getCardDefinition?.(baseId)
    if (cardDef) {
      logger.debug(`[GameCodec] Found card ${baseId} via getCardDefinition`)
      return {
        name: cardDef.name || baseId,
        imageUrl: cardDef.imageUrl || '',
        power: cardDef.power || 0,
        ability: cardDef.ability || '',
        types: cardDef.types || [],
        faction: cardDef.faction || ''
      }
    }
  } catch (e) {
    logger.warn(`[GameCodec] Failed to look up card ${baseId}:`, e)
  }

  logger.warn(`[GameCodec] Card ${baseId} not found in local database`)
  return null
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Merge decoded state into existing game state
 *
 * CARD_STATE only contains:
 * - Board cards (with all their data)
 * - Player metadata (id, color, score, isReady)
 * - Phase info (currentPhase, activePlayerId, currentRound)
 *
 * CARD_STATE does NOT contain:
 * - Player hands, decks, discard piles (synced via STATE_UPDATE_COMPACT)
 * - Announced cards (synced via other messages)
 */
export function mergeDecodedState(
  existingState: GameState,
  decodedState: Partial<GameState>
): GameState {
  const result = { ...existingState }

  if (decodedState.players) {
    result.players = decodedState.players.map(player => {
      const existing = existingState.players.find(p => p.id === player.id)
      if (existing) {
        // Preserve existing player data that is NOT sent in CARD_STATE:
        // - name, hand, deck, discard, announcedCard, selectedDeck, boardHistory
        return {
          ...existing,
          // Update only metadata that comes from CARD_STATE
          id: player.id,
          score: player.score,
          isReady: player.isReady,
          // Update color from CARD_STATE (it's authoritative for color changes)
          color: player.color
        }
      }
      return player
    })
  }

  if (decodedState.board) {
    result.board = decodedState.board
  }

  if (decodedState.currentPhase !== undefined) {
    result.currentPhase = decodedState.currentPhase
  }

  if (decodedState.activePlayerId !== undefined) {
    result.activePlayerId = decodedState.activePlayerId
  }

  if (decodedState.currentRound !== undefined) {
    result.currentRound = decodedState.currentRound
  }

  return result
}

// TypeScript augmentation for Math.clamp
declare global {
  interface Math {
    clamp(value: number, min: number, max: number): number
  }
}

// Polyfill for Math.clamp if not available
if (!Math.clamp) {
  Math.clamp = function(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }
}

// Internal type for card definition data
interface CardDefinitionData {
  baseId: string
  name: string
  imageUrl: string
  power: number
  ability: string
  types: string[]
  faction: string
}
