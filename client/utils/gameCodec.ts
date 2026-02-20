/**
 * Game State Codec - Optimized binary encoding for WebRTC P2P sync
 *
 * This module provides:
 * 1. Card registry - static card definitions sent once
 * 2. Binary encoding/decoding of game state
 * 3. Bit packing for minimal message size
 */

import type { GameState, Card, Player, Board, CardStatus } from '../types'
import type { CardRegistry } from '../types/codec'
import { CodecMessageType } from '../types/codec'
import { logger } from './logger'
import { cardDatabase } from '../content'
import { PLAYER_COLOR_NAMES } from '../constants'

// ============================================================================
// CARD REGISTRY
// ============================================================================

/**
 * Build a card registry from the content database
 * Maps card baseId strings to numeric indices for compact encoding
 */
export function buildCardRegistry(): CardRegistry {
  const registry: CardRegistry = {
    baseIdToIndex: new Map(),
    indexToBaseId: new Map(),
    cardDefinitions: [],
    statusTypes: []
  }

  // Collect all unique card baseIds from content database
  // cardDatabase is a Map<string, CardDefinition>
  const seenBaseIds = new Set<string>()

  // Convert Map values to array and iterate
  const allCards = Array.from(cardDatabase.values())

  for (const card of allCards) {
    if (card.baseId && !seenBaseIds.has(card.baseId)) {
      seenBaseIds.add(card.baseId)
      const index = registry.cardDefinitions.length

      registry.baseIdToIndex.set(card.baseId, index)
      registry.indexToBaseId.set(index, card.baseId)

      registry.cardDefinitions.push({
        baseId: card.baseId,
        name: card.name,
        imageUrl: card.imageUrl,
        power: card.power,
        ability: card.ability || '',
        types: card.types || [],
        faction: card.faction || ''
      })
    }
  }

  // Collect common status types
  registry.statusTypes = [
    'Stun',
    'Aim',
    'Exploit',
    'Poison',
    'Shield',
    'Riot',
    'Flying',
    'Deploy',
    'Setup',
    'Commit',
    'LastPlayed',
    'readyDeploy',
    'readySetup',
    'readyCommit'
  ]

  logger.info(`[CardRegistry] Built registry with ${registry.cardDefinitions.length} cards, ${registry.statusTypes.length} status types`)

  return registry
}

/**
 * Serialize card registry to binary for transmission
 */
export function serializeCardRegistry(registry: CardRegistry): Uint8Array {
  const encoder = new TextEncoder()

  // Format: [cardCount: 2 bytes] [statusCount: 1 byte]
  // For each card: [baseIdLength: 1 byte] [baseId] [nameLength: 1 byte] [name] [imageUrlLength: 2 bytes] [imageUrl] [power: 1 byte] [abilityLength: 2 bytes] [ability] [typesCount: 1 byte] [types...] [factionLength: 1 byte] [faction]
  // For each status: [statusLength: 1 byte] [status]

  // Calculate total size needed
  let totalSize = 3 // cardCount (2) + statusCount (1)

  for (const card of registry.cardDefinitions) {
    totalSize += 1 + card.baseId.length // baseId
    totalSize += 1 + (card.name?.length || 0) // name
    totalSize += 2 + (card.imageUrl?.length || 0) // imageUrl
    totalSize += 1 // power
    totalSize += 2 + (card.ability?.length || 0) // ability
    totalSize += 1 + (card.types?.length || 0) // types array
    for (const type of card.types || []) {
      totalSize += 1 + type.length
    }
    totalSize += 1 + (card.faction?.length || 0) // faction
  }

  for (const status of registry.statusTypes) {
    totalSize += 1 + status.length
  }

  const buffer = new Uint8Array(totalSize)
  let offset = 0

  // Write card count
  buffer[offset++] = (registry.cardDefinitions.length >> 8) & 0xFF
  buffer[offset++] = registry.cardDefinitions.length & 0xFF

  // Write status count
  buffer[offset++] = registry.statusTypes.length & 0xFF

  // Write cards
  for (const card of registry.cardDefinitions) {
    // baseId
    buffer[offset++] = card.baseId.length
    encoder.encodeInto(card.baseId, buffer.subarray(offset, offset + card.baseId.length))
    offset += card.baseId.length

    // name
    const name = card.name || ''
    buffer[offset++] = name.length
    encoder.encodeInto(name, buffer.subarray(offset, offset + name.length))
    offset += name.length

    // imageUrl
    const imageUrl = card.imageUrl || ''
    buffer[offset++] = (imageUrl.length >> 8) & 0xFF
    buffer[offset++] = imageUrl.length & 0xFF
    encoder.encodeInto(imageUrl, buffer.subarray(offset, offset + imageUrl.length))
    offset += imageUrl.length

    // power
    buffer[offset++] = Math.clamp(card.power, -128, 127)

    // ability
    const ability = card.ability || ''
    buffer[offset++] = (ability.length >> 8) & 0xFF
    buffer[offset++] = ability.length & 0xFF
    encoder.encodeInto(ability, buffer.subarray(offset, offset + ability.length))
    offset += ability.length

    // types
    const types = card.types || []
    buffer[offset++] = types.length
    for (const type of types) {
      buffer[offset++] = type.length
      encoder.encodeInto(type, buffer.subarray(offset, offset + type.length))
      offset += type.length
    }

    // faction
    const faction = card.faction || ''
    buffer[offset++] = faction.length
    encoder.encodeInto(faction, buffer.subarray(offset, offset + faction.length))
    offset += faction.length
  }

  // Write status types
  for (const status of registry.statusTypes) {
    buffer[offset++] = status.length
    encoder.encodeInto(status, buffer.subarray(offset, offset + status.length))
    offset += status.length
  }

  logger.info(`[CardRegistry] Serialized registry: ${buffer.length} bytes`)

  return buffer
}

/**
 * Deserialize card registry from binary
 */
export function deserializeCardRegistry(data: Uint8Array): CardRegistry {
  const decoder = new TextDecoder()
  const registry: CardRegistry = {
    baseIdToIndex: new Map(),
    indexToBaseId: new Map(),
    cardDefinitions: [],
    statusTypes: []
  }

  let offset = 0

  // Read card count
  const cardCount = (data[offset++] << 8) | data[offset++]

  // Read status count
  const statusCount = data[offset++]

  // Read cards
  for (let i = 0; i < cardCount; i++) {
    // baseId
    const baseIdLength = data[offset++]
    const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
    offset += baseIdLength

    // name
    const nameLength = data[offset++]
    const name = decoder.decode(data.subarray(offset, offset + nameLength))
    offset += nameLength

    // imageUrl
    const imageUrlLength = (data[offset++] << 8) | data[offset++]
    const imageUrl = decoder.decode(data.subarray(offset, offset + imageUrlLength))
    offset += imageUrlLength

    // power
    const power = data[offset++] // signed byte

    // ability
    const abilityLength = (data[offset++] << 8) | data[offset++]
    const ability = decoder.decode(data.subarray(offset, offset + abilityLength))
    offset += abilityLength

    // types
    const typesCount = data[offset++]
    const types: string[] = []
    for (let j = 0; j < typesCount; j++) {
      const typeLength = data[offset++]
      const type = decoder.decode(data.subarray(offset, offset + typeLength))
      offset += typeLength
      types.push(type)
    }

    // faction
    const factionLength = data[offset++]
    const faction = decoder.decode(data.subarray(offset, offset + factionLength))
    offset += factionLength

    const cardDef: CardDefinitionData = {
      baseId,
      name,
      imageUrl,
      power,
      ability,
      types,
      faction
    }

    registry.baseIdToIndex.set(baseId, i)
    registry.indexToBaseId.set(i, baseId)
    registry.cardDefinitions.push(cardDef)
  }

  // Read status types
  for (let i = 0; i < statusCount; i++) {
    const statusLength = data[offset++]
    const status = decoder.decode(data.subarray(offset, offset + statusLength))
    offset += statusLength
    registry.statusTypes.push(status)
  }

  logger.info(`[CardRegistry] Deserialized registry: ${registry.cardDefinitions.length} cards, ${registry.statusTypes.length} status types`)

  return registry
}

// ============================================================================
// STATUS BITMASK ENCODING
// ============================================================================

/**
 * Convert status array to bitmask
 */
export function statusesToBitmask(statuses: CardStatus[], registry: CardRegistry): number {
  let mask = 0
  for (const status of statuses || []) {
    const index = registry.statusTypes.indexOf(status.type)
    if (index >= 0 && index < 32) {
      mask |= (1 << index)
    }
  }
  return mask >>> 0 // Ensure unsigned
}

/**
 * Convert bitmask to status array
 */
export function bitmaskToStatuses(mask: number, addedByPlayerId: number, registry: CardRegistry): CardStatus[] {
  const statuses: CardStatus[] = []
  for (let i = 0; i < 32; i++) {
    if (mask & (1 << i)) {
      const type = registry.statusTypes[i]
      if (type) {
        statuses.push({ type, addedByPlayerId })
      }
    }
  }
  return statuses
}

/**
 * Get card flags as number
 */
export function getCardFlags(card: Card): number {
  let flags = 0
  if (card.isFaceDown) { flags |= 1 << 0 }
  if (card.enteredThisTurn) { flags |= 1 << 1 }
  if (card.revealedTo === 'all') { flags |= 1 << 2 }
  return flags
}

// ============================================================================
// CARD STATE ENCODING
// ============================================================================

/**
 * Encode a card reference to bytes
 * Returns: [cardId: 4 bytes hash] [baseIdIndex: 2 bytes] [ownerId: 1 byte] [power: 1 byte] [flags: 1 byte] [statusMask: 4 bytes] = 13 bytes
 */
function encodeCardRef(card: Card, registry: CardRegistry): Uint8Array {
  const buffer = new Uint8Array(13)
  let offset = 0

  // cardId - use first 4 bytes of hash
  const idHash = simpleHash(card.id)
  buffer[offset++] = (idHash >> 24) & 0xFF
  buffer[offset++] = (idHash >> 16) & 0xFF
  buffer[offset++] = (idHash >> 8) & 0xFF
  buffer[offset++] = idHash & 0xFF

  // baseIdIndex
  const baseIdIndex = card.baseId ? (registry.baseIdToIndex.get(card.baseId) ?? 0) : 0
  buffer[offset++] = (baseIdIndex >> 8) & 0xFF
  buffer[offset++] = baseIdIndex & 0xFF

  // ownerId
  buffer[offset++] = (card.ownerId ?? 0) & 0xFF

  // power (signed byte, clamped to -128 to 127)
  const power = Math.round(card.power || 0)
  buffer[offset++] = Math.clamp(power, -128, 127) & 0xFF

  // flags
  buffer[offset++] = getCardFlags(card)

  // statusMask
  const statusMask = statusesToBitmask(card.statuses || [], registry)
  buffer[offset++] = (statusMask >> 24) & 0xFF
  buffer[offset++] = (statusMask >> 16) & 0xFF
  buffer[offset++] = (statusMask >> 8) & 0xFF
  buffer[offset++] = statusMask & 0xFF

  return buffer
}

/**
 * Encode a hand card (for other players - minimal info)
 * Returns: [cardId: 4 bytes] [ownerId: 1 byte] [flags: 1 byte] [statusMask: 4 bytes] = 10 bytes
 */
function encodeHandCard(card: Card, registry: CardRegistry, playerId: number): Uint8Array {
  const buffer = new Uint8Array(10)
  let offset = 0

  // cardId - use first 4 bytes of hash
  const idHash = simpleHash(card.id)
  buffer[offset++] = (idHash >> 24) & 0xFF
  buffer[offset++] = (idHash >> 16) & 0xFF
  buffer[offset++] = (idHash >> 8) & 0xFF
  buffer[offset++] = idHash & 0xFF

  // ownerId - needed for correct card back color
  buffer[offset++] = (card.ownerId ?? playerId) & 0xFF

  // flags (face down, reveal status)
  buffer[offset++] = getCardFlags(card)

  // statusMask (for reveal counters)
  const statusMask = statusesToBitmask(card.statuses || [], registry)
  buffer[offset++] = (statusMask >> 24) & 0xFF
  buffer[offset++] = (statusMask >> 16) & 0xFF
  buffer[offset++] = (statusMask >> 8) & 0xFF
  buffer[offset++] = statusMask & 0xFF

  return buffer
}

/**
 * Simple string hash for card IDs
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash >>> 0
}

/**
 * Encode full game state to binary
 */
export function encodeCardState(
  gameState: GameState,
  registry: CardRegistry,
  localPlayerId: number | null
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

  // For each player
  for (const player of gameState.players) {
    // [playerId: 1 byte]
    dataParts.push(new Uint8Array([player.id & 0xFF]))

    // [playerColor: 1 byte] - encoded as index (0-7) into PLAYER_COLOR_NAMES
    // 0-7: blue, purple, red, green, yellow, orange, pink, brown
    const colorIndex = PLAYER_COLOR_NAMES.indexOf(player.color as any)
    dataParts.push(new Uint8Array([colorIndex >= 0 ? colorIndex : 0]))

    // Sizes: [deckSize: 1 byte] [handSize: 1 byte] [discardSize: 1 byte] [showcase: 1 byte]
    const deckSize = Math.min(player.deck.length, 255)
    const handSize = Math.min(player.hand.length, 255)
    const discardSize = Math.min(player.discard.length, 255)
    dataParts.push(new Uint8Array([
      deckSize,
      handSize,
      discardSize,
      player.announcedCard ? 1 : 0
    ]))

    // [score: 1 byte] - could be delta, but for now use direct value (clamped)
    dataParts.push(new Uint8Array([Math.min(player.score, 255)]))

    // Hand cards
    // [handCardCount: 1 byte]
    const handCardCount = Math.min(player.hand.length, 255)
    dataParts.push(new Uint8Array([handCardCount]))

    const isLocalPlayer = player.id === localPlayerId
    for (const card of player.hand) {
      if (isLocalPlayer) {
        // Full card data for local player
        dataParts.push(encodeCardRef(card, registry))
      } else {
        // Minimal data for other players (card back only)
        dataParts.push(encodeHandCard(card, registry, player.id))
      }
    }

    // Discard cards (only IDs)
    // [discardCardCount: 1 byte]
    const discardCardCount = Math.min(player.discard.length, 255)
    dataParts.push(new Uint8Array([discardCardCount]))
    for (const card of player.discard) {
      const idHash = simpleHash(card.id)
      const idBytes = new Uint8Array(4)
      idBytes[0] = (idHash >> 24) & 0xFF
      idBytes[1] = (idHash >> 16) & 0xFF
      idBytes[2] = (idHash >> 8) & 0xFF
      idBytes[3] = idHash & 0xFF
      dataParts.push(idBytes)
    }

    // Announced card (showcase)
    if (player.announcedCard) {
      dataParts.push(encodeCardRef(player.announcedCard, registry))
    }
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

  // For each board card: [row: 1 byte] [col: 1 byte] [cardData: 13 bytes]
  for (const { row, col, card } of boardCards) {
    dataParts.push(new Uint8Array([row, col]))
    dataParts.push(encodeCardRef(card, registry))
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
 */
export function decodeCardState(
  data: Uint8Array,
  registry: CardRegistry,
  localPlayerId: number | null
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

    // Sizes
    const deckSize = data[offset++]
    data[offset++] // Skip handSize // eslint-disable-line @typescript-eslint/no-unused-expressions
    data[offset++] // Skip discardSize // eslint-disable-line @typescript-eslint/no-unused-expressions
    const hasShowcase = data[offset++] === 1

    const score = data[offset++]

    // Read hand cards
    const handCardCount = data[offset++]
    const handCards: Card[] = []
    const isLocalPlayer = playerId === localPlayerId

    for (let j = 0; j < handCardCount; j++) {
      if (isLocalPlayer) {
        // Full card data
        handCards.push(decodeCardRef(data, offset, registry))
        offset += 13
      } else {
        // Card back only - create placeholder
        const idHash = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]
        const ownerId = data[offset++]
        const flags = data[offset++]
        const statusMask = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]

        handCards.push({
          id: `card_${idHash}`,
          name: '?',
          imageUrl: '',
          deck: 'Random' as any,
          power: 0,
          ability: '',
          ownerId, // Include ownerId for correct card back color
          isFaceDown: (flags & 1) !== 0,
          revealedTo: (flags & 4) ? 'all' : undefined,
          statuses: bitmaskToStatuses(statusMask, playerId, registry),
          isPlaceholder: true
        } as Card)
      }
    }

    // Read discard cards (IDs only)
    const discardCardCount = data[offset++]
    const discardCards: Card[] = []
    for (let j = 0; j < discardCardCount; j++) {
      const idHash = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]
      discardCards.push({
        id: `discard_${idHash}`,
        name: '?',
        imageUrl: '',
        deck: 'Random' as any,
        power: 0,
        ability: '',
        ownerId: playerId, // Include ownerId for correct card back color
        isPlaceholder: true
      } as Card)
    }

    // Read showcase card
    let announcedCard: Card | null = null
    if (hasShowcase) {
      announcedCard = decodeCardRef(data, offset, registry)
      offset += 13
    }

    // Create placeholder deck
    const deck: Card[] = []
    for (let j = 0; j < deckSize; j++) {
      deck.push({
        id: `deck_${playerId}_${j}`,
        name: '?',
        imageUrl: '',
        deck: 'Random' as any,
        power: 0,
        ability: '',
        ownerId: playerId, // Include ownerId for correct card back color
        isPlaceholder: true
      } as Card)
    }

    players.push({
      id: playerId,
      name: `Player ${playerId}`,
      score,
      hand: handCards,
      deck,
      discard: discardCards,
      announcedCard,
      selectedDeck: 'Random' as any,
      color: playerColor,
      boardHistory: []
    } as Player)
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

    const card = decodeCardRef(data, offset, registry)
    offset += 13

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
 */
function decodeCardRef(data: Uint8Array, offset: number, registry: CardRegistry): Card {
  // cardId hash - we'll reconstruct a unique ID
  const idHash = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]
  const cardId = `card_${idHash}_${Date.now()}`

  // baseIdIndex
  const baseIdIndex = (data[offset++] << 8) | data[offset++]

  // ownerId
  const ownerId = data[offset++]

  // power
  let power = data[offset++]
  if (power > 127) { power = power - 256 } // Convert to signed

  // flags
  const flags = data[offset++]

  // statusMask
  const statusMask = (data[offset++] << 24) | (data[offset++] << 16) | (data[offset++] << 8) | data[offset++]

  // Get card definition from registry
  const cardDef = registry.cardDefinitions[baseIdIndex]
  const baseId = cardDef?.baseId || ''

  return {
    id: cardId,
    baseId,
    deck: 'Random' as any,
    name: cardDef?.name || '?',
    imageUrl: cardDef?.imageUrl || '',
    power,
    ability: cardDef?.ability || '',
    types: cardDef?.types || [],
    faction: cardDef?.faction || '',
    ownerId,
    isFaceDown: (flags & 1) !== 0,
    enteredThisTurn: (flags & 2) !== 0,
    revealedTo: (flags & 4) ? 'all' : undefined,
    statuses: bitmaskToStatuses(statusMask, 0, registry)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Merge decoded state into existing game state
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
        // For local player, preserve their actual hand from existing state
        const isLocalPlayer = player.id === decodedState.activePlayerId
        return {
          ...existing,
          ...player,
          hand: isLocalPlayer ? existing.hand : player.hand,
          // CRITICAL: Preserve player color from existing state to avoid stale data
          color: existing.color
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
