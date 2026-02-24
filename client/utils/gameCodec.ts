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
import type { UltraCompactCardData, UltraCompactCardRef, CompactStatus } from '../host/StatePersonalization'
import { logger } from './logger'
import { PLAYER_COLOR_NAMES } from '../constants'
import { getCardDefinition, rawJsonData } from '../content'

// ============================================================================
// ULTRA-COMPACT CARD RECONSTRUCTION
// ============================================================================

/**
 * Reconstruct a full card from ultra-compact data using contentDatabase
 * The card ID is used to look up the card in the deck, then baseId is used
 * to get name, imageUrl, power, ability from contentDatabase
 */
function reconstructCardFromUltraCompact(
  ultraCompact: UltraCompactCardData,
  deckCards: Card[]
): Card {
  // First, find the card in the deck to get its baseId and deck
  const deckCard = deckCards.find(c => c.id === ultraCompact.id)
  const baseId = deckCard?.baseId || ultraCompact.baseId || ultraCompact.id
  const deck = deckCard?.deck || 'SynchroTech' as any

  // Get card definition from contentDatabase
  const cardDef = getCardDefinition(baseId)

  if (!cardDef) {
    return {
      id: ultraCompact.id,
      baseId: baseId,
      deck: deck,
      name: 'Unknown',
      imageUrl: '',
      power: 0,
      ability: '',
      types: [],
      isFaceDown: ultraCompact.isFaceDown,
      statuses: ultraCompact.statuses.map((s: CompactStatus) => ({
        type: s.type,
        addedByPlayerId: 0
      }))
    }
  }

  return {
    ...cardDef,
    id: ultraCompact.id,
    baseId: baseId,
    deck: deck,  // Use deck from the card found in deck, not from cardDef
    ownerId: deckCard?.ownerId,
    ownerName: deckCard?.ownerName,
    isFaceDown: ultraCompact.isFaceDown,
    statuses: ultraCompact.statuses.map((s: CompactStatus) => ({
      type: s.type,
      addedByPlayerId: 0
    }))
  }
}

/**
 * Reconstruct deck from ultra-compact card references (index + baseId)
 * Uses baseId instead of id because id is unique per client but baseId is shared
 * The client reconstructs cards using contentDatabase via baseId
 */
function reconstructDeckFromRefs(
  deckCardRefs: UltraCompactCardRef[],
  existingDeck: Card[]
): Card[] {
  if (!deckCardRefs || deckCardRefs.length === 0) {
    return existingDeck
  }

  // Create a map of baseId to card from existing deck
  const cardMap = new Map<string, Card>()
  for (const card of existingDeck) {
    const baseId = card.baseId || card.id
    cardMap.set(baseId, card)
  }

  // Reconstruct deck in the order specified by refs
  const reconstructed: Card[] = []
  for (const ref of deckCardRefs) {
    // Use baseId directly from ref (changed from ref.id to ref.baseId)
    const card = cardMap.get(ref.baseId)
    if (card) {
      reconstructed.push(card)
    } else {
      // Card not found in existing deck - try to create from contentDatabase
      const cardDef = getCardDefinition(ref.baseId)
      if (cardDef) {
        // Get deck type from existing deck (first card) or default to Random
        const deckType = existingDeck.length > 0 ? existingDeck[0].deck : DeckType.Random
        reconstructed.push({
          ...cardDef,
          id: `${ref.baseId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          baseId: ref.baseId,
          deck: deckType,
          isFaceDown: true,
          statuses: []
        })
      } else {
        logger.warn(`[reconstructDeckFromRefs] Card ${ref.baseId} not found in existing deck and not in contentDatabase`)
      }
    }
  }

  return reconstructed
}

/**
 * Check if a player object has ultra-compact card data
 */
function hasUltraCompactData(player: any): boolean {
  return (player.handCards?.length > 0) ||
         (player.deckCardRefs?.length > 0) ||
         (player.discardCards?.length > 0)
}

// ============================================================================
// CARD STATE ENCODING
// ============================================================================

/**
 * Extract baseId from a card
 * Handles various card.id formats:
 * - "baseId" (simple)
 * - "baseId_timestamp_random" (with suffix)
 * - "baseId_otherPlayerHand_0_timestamp_random" (reconstructed)
 */
function extractBaseId(card: Card): string {
  // Prefer card.baseId if set
  if (card.baseId) {
    return card.baseId
  }

  // Try to extract from card.id
  if (card.id) {
    // Remove common suffixes like _timestamp_random
    // Pattern: baseId followed by _digits_ and more
    const match = card.id.match(/^([a-zA-Z0-9_-]+?)(?:_\d+_[\d.]+)?$/)
    if (match && match[1]) {
      return match[1]
    }

    // Another pattern: baseId followed by underscore and more stuff
    // e.g., "knight_hand_0_123_0.123" -> extract "knight"
    const simpleMatch = card.id.match(/^([a-zA-Z0-9_-]+?)(?:_(?:hand|deck|discard|otherPlayer|recipient|dummy).*)?$/)
    if (simpleMatch && simpleMatch[1]) {
      return simpleMatch[1]
    }

    // Last resort: return card.id as-is
    return card.id
  }

  return ''
}

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
 * Encode a card collection (hand/deck/discard) as baseId arrays
 * Format: For each card: [baseIdLength: 1 byte] [baseId: string]
 */
function encodeCardCollection(collection: Card[] | undefined, dataParts: Uint8Array[]): void {
  for (const card of collection || []) {
    const baseId = extractBaseId(card)
    const baseIdBytes = new TextEncoder().encode(baseId)
    dataParts.push(new Uint8Array([baseIdBytes.length]))
    dataParts.push(baseIdBytes)
  }
}

/**
 * Encode a card reference to bytes
 * Format: [baseIdLength: 1 byte] [baseId: string] [ownerId: 1 byte] [power: 1 byte] [flags: 1 byte] [statusMask: 4 bytes]
 * Guest will use baseId to look up full card data from local contentDatabase
 */
function encodeCardRef(card: Card): Uint8Array {
  const baseId = extractBaseId(card)
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
    'readyDeploy', 'readySetup', 'readyCommit',
    'Revealed'  // Important: Revealed status must be encoded!
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
    'readyDeploy', 'readySetup', 'readyCommit',
    'Revealed'  // Important: Revealed status must be decoded!
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
 *
 * @param gameState - The game state to encode
 * @param recipientPlayerId - The ID of the player who will receive this state.
 *                            If provided, their hand/deck/discard will be included.
 *                            If null, only board and dummy player data is included.
 */
export function encodeCardState(
  gameState: GameState,
  recipientPlayerId?: number | null
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

  // For each player - send full metadata including hand/deck/discard sizes
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

    // [playerFlags: 1 byte] - bit 0: isDummy, bit 1: isDisconnected, bit 2: autoDrawEnabled
    let playerFlags = 0
    if (player.isDummy) {
      playerFlags |= 1 << 0
    }
    if (player.isDisconnected) {
      playerFlags |= 1 << 1
    }
    if (player.autoDrawEnabled) {
      playerFlags |= 1 << 2
    }
    dataParts.push(new Uint8Array([playerFlags]))

    // [teamId: 1 byte] - 255 means undefined/no team
    dataParts.push(new Uint8Array([(player.teamId ?? 255) & 0xFF]))

    // [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte] - for all players
    // This allows guests to see how many cards each player has without revealing card data
    // CRITICAL: Use deckSize/handSize/discardSize properties if available, fallback to array.length
    // This is necessary because guests send deck: [] with deckSize: N for optimization
    const handSize = player.handSize ?? player.hand?.length ?? 0
    const deckSize = player.deckSize ?? player.deck?.length ?? 0
    const discardSize = player.discardSize ?? player.discard?.length ?? 0
    dataParts.push(new Uint8Array([handSize, (deckSize >> 8) & 0xFF, deckSize & 0xFF, discardSize]))

    // Log encoding for each player
    logger.info(`[GameCodec] Encoding player ${player.id}: hand=${handSize}, deck=${deckSize}, discard=${discardSize}, isDummy=${player.isDummy}`)

    // [nameLength: 1 byte] [name: string]
    const nameBytes = new TextEncoder().encode(player.name || '')
    const nameLength = Math.min(nameBytes.length, 63) // Limit to 63 chars
    dataParts.push(new Uint8Array([nameLength]))
    dataParts.push(nameBytes.subarray(0, nameLength))
  }

  // Board state
  // [boardSize: 1 byte] [activeGridSize: 1 byte] [rows: 1 byte] [cols: 1 byte]
  const boardSize = gameState.board.length
  dataParts.push(new Uint8Array([boardSize, gameState.activeGridSize, boardSize, boardSize]))

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

  // Phase info: [currentPhase: 1 byte] [activePlayerId: 1 byte] [currentRound: 1 byte] [isScoringStep: 1 byte]
  // Use 255 to indicate undefined/null values
  dataParts.push(new Uint8Array([
    gameState.currentPhase === undefined ? 255 : Math.clamp(gameState.currentPhase, 0, 254),
    (gameState.activePlayerId ?? 255) & 0xFF,
    gameState.currentRound === undefined ? 255 : Math.clamp(gameState.currentRound, 0, 254),
    gameState.isScoringStep ? 1 : 0
  ]))

  // Game flags: [isGameStarted: 1 byte] (0 = false, 1 = true)
  dataParts.push(new Uint8Array([gameState.isGameStarted ? 1 : 0]))

  // Recipient player data: [hasRecipientPlayer: 1 byte] (0 = none, 1 = included)
  // If included: [playerId: 1 byte] [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte]
  // Then hand cards, deck cards, discard cards as baseId arrays
  const recipientPlayer = recipientPlayerId !== undefined && recipientPlayerId !== null
    ? gameState.players.find(p => p.id === recipientPlayerId)
    : null

  if (recipientPlayer && !recipientPlayer.isDummy) {
    // Include recipient player's hand/deck/discard
    dataParts.push(new Uint8Array([1])) // hasRecipientPlayer = true
    dataParts.push(new Uint8Array([recipientPlayer.id & 0xFF]))

    const handSize = recipientPlayer.hand?.length ?? 0
    const deckSize = recipientPlayer.deck?.length ?? 0
    const discardSize = recipientPlayer.discard?.length ?? 0

    // [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte]
    dataParts.push(new Uint8Array([handSize, (deckSize >> 8) & 0xFF, deckSize & 0xFF, discardSize]))

    // Encode hand, deck, and discard cards as baseId arrays
    encodeCardCollection(recipientPlayer.hand, dataParts)
    encodeCardCollection(recipientPlayer.deck, dataParts)
    encodeCardCollection(recipientPlayer.discard, dataParts)

    logger.debug(`[GameCodec] Encoded recipient player ${recipientPlayer.id}: ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
  } else {
    dataParts.push(new Uint8Array([0])) // hasRecipientPlayer = false
  }

  // Dummy player data: [dummyCount: 1 byte] then for each dummy:
  // [playerId: 1 byte] [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte]
  // Then hand cards, deck cards, discard cards as baseId arrays
  const dummyPlayers = gameState.players.filter(p => p.isDummy === true)
  dataParts.push(new Uint8Array([dummyPlayers.length]))

  for (const dummy of dummyPlayers) {
    // [playerId: 1 byte]
    dataParts.push(new Uint8Array([dummy.id & 0xFF]))

    const handSize = dummy.hand?.length ?? 0
    const deckSize = dummy.deck?.length ?? 0
    const discardSize = dummy.discard?.length ?? 0

    // [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte]
    dataParts.push(new Uint8Array([handSize, (deckSize >> 8) & 0xFF, deckSize & 0xFF, discardSize]))

    // Encode hand, deck, and discard cards as baseId arrays
    encodeCardCollection(dummy.hand, dataParts)
    encodeCardCollection(dummy.deck, dataParts)
    encodeCardCollection(dummy.discard, dataParts)

    logger.debug(`[GameCodec] Encoded dummy player ${dummy.id}: ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
  }

  // Non-recipient real player hands and decks: [playerDeckCount: 1 byte] then for each non-recipient real player:
  // [playerId: 1 byte] [handSize: 1 byte] [deckSize: 2 bytes]
  // Then hand cards, deck cards as baseId arrays
  // This allows host to see other players' card data when needed (e.g., when revealing with rule counters)
  const otherRealPlayers = gameState.players.filter(p => !p.isDummy && p.id !== recipientPlayerId)
  dataParts.push(new Uint8Array([otherRealPlayers.length]))

  for (const player of otherRealPlayers) {
    // [playerId: 1 byte]
    dataParts.push(new Uint8Array([player.id & 0xFF]))

    const handSize = player.hand?.length ?? 0
    const deckSize = player.deck?.length ?? 0

    // [handSize: 1 byte] [deckSize: 2 bytes]
    dataParts.push(new Uint8Array([handSize, (deckSize >> 8) & 0xFF, deckSize & 0xFF]))

    // Encode hand and deck cards as baseId arrays
    encodeCardCollection(player.hand, dataParts)
    encodeCardCollection(player.deck, dataParts)

    logger.debug(`[GameCodec] Encoded other player ${player.id}: ${handSize} hand, ${deckSize} deck`)
  }

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

  logger.info(`[GameCodec] Encoded card state: ${result.length} bytes (${boardCardCount} board cards, ${gameState.players.length} players, ${dummyPlayers.length} dummies, recipientPlayer=${recipientPlayerId ?? 'none'}, activeGridSize=${gameState.activeGridSize})`)

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
  const decoder = new TextDecoder()

  for (let i = 0; i < playerCount; i++) {
    const playerId = data[offset++]

    // Player color [1 byte] - index into PLAYER_COLOR_NAMES
    const colorIndex = data[offset++]
    const playerColor = PLAYER_COLOR_NAMES[colorIndex] || 'blue'

    // [score: 1 byte]
    const score = data[offset++]

    // [isReady: 1 byte]
    const isReady = data[offset++] === 1

    // [playerFlags: 1 byte] - bit 0: isDummy, bit 1: isDisconnected, bit 2: autoDrawEnabled
    const playerFlags = data[offset++]
    const isDummy = (playerFlags & (1 << 0)) !== 0
    const isDisconnected = (playerFlags & (1 << 1)) !== 0
    const autoDrawEnabled = (playerFlags & (1 << 2)) !== 0

    // [teamId: 1 byte] - 255 means undefined
    const teamIdByte = data[offset++]
    const teamId = teamIdByte === 255 ? undefined : teamIdByte

    // [handSize: 1 byte] [deckSize: 2 bytes] [discardSize: 1 byte] - size info for all players
    const playerHandSize = data[offset++]
    const playerDeckSize = (data[offset++] << 8) | data[offset++]
    const playerDiscardSize = data[offset++]

    // [nameLength: 1 byte] [name: string]
    const nameLength = data[offset++]
    const name = nameLength > 0 ? decoder.decode(data.subarray(offset, offset + nameLength)) : `Player ${playerId}`
    offset += nameLength

    players.push({
      id: playerId,
      name: name,
      color: playerColor,
      score: score,
      isReady: isReady,
      hand: [],  // Will be filled by recipient/dummy section, or empty for privacy
      deck: [],
      discard: [],
      announcedCard: null,
      selectedDeck: DeckType.Random,
      boardHistory: [],
      isDummy: isDummy,
      isDisconnected: isDisconnected,
      teamId: teamId,
      autoDrawEnabled: autoDrawEnabled,
      // Store sizes for display (shows how many cards each player has)
      handSize: playerHandSize,
      deckSize: playerDeckSize,
      discardSize: playerDiscardSize
    })

    // Log decoding for each player
    logger.info(`[GameCodec] Decoded player ${playerId}: handSize=${playerHandSize}, deckSize=${playerDeckSize}, discardSize=${playerDiscardSize}, isDummy=${isDummy}`)
  }

  // Read board
  const boardSize = data[offset++]
  const activeGridSize = data[offset++]
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
  const scoringStepByte = data[offset++]

  const currentPhase = phaseByte === 255 ? undefined : phaseByte
  const activePlayerId = activePlayerByte === 255 ? null : activePlayerByte
  const currentRound = roundByte === 255 ? undefined : roundByte
  const isScoringStep = scoringStepByte === 1

  // Read game flags
  const gameFlags = data[offset++]
  const isGameStarted = (gameFlags & 0x01) !== 0

  // Read recipient player data
  const hasRecipientPlayer = data[offset++]
  // decoder is already declared above

  if (hasRecipientPlayer === 1) {
    const recipientPlayerId = data[offset++]
    const handSize = data[offset++]
    const deckSize = (data[offset++] << 8) | data[offset++]
    const discardSize = data[offset++]

    // Find the player in players array and update it
    const playerIndex = players.findIndex(p => p.id === recipientPlayerId)
    if (playerIndex >= 0) {
      const player = players[playerIndex]
      // Get the deck type for this player (use selectedDeck if available, otherwise Random)
      const playerDeckType = player.selectedDeck || DeckType.Random

      // Decode hand cards
      const hand: Card[] = []
      for (let h = 0; h < handSize; h++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        hand.push({
          id: `${baseId}_recipientHand_${h}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: playerDeckType,
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          ownerName: player.name,
          isFaceDown: false,
          statuses: []
        })
      }
      player.hand = hand

      // Decode deck cards
      const deck: Card[] = []
      for (let dk = 0; dk < deckSize; dk++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        deck.push({
          id: `${baseId}_recipientDeck_${dk}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: playerDeckType,
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          ownerName: player.name,
          isFaceDown: true,
          statuses: []
        })
      }
      player.deck = deck

      // Decode discard cards
      const discard: Card[] = []
      for (let dc = 0; dc < discardSize; dc++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        discard.push({
          id: `${baseId}_recipientDiscard_${dc}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: playerDeckType,
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          ownerName: player.name,
          isFaceDown: false,
          statuses: []
        })
      }
      player.discard = discard

      logger.debug(`[GameCodec] Decoded recipient player ${recipientPlayerId}: ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
    }
  }

  // Read dummy player data
  const dummyCount = data[offset++]

  for (let d = 0; d < dummyCount; d++) {
    const dummyPlayerId = data[offset++]
    const handSize = data[offset++]
    const deckSize = (data[offset++] << 8) | data[offset++]
    const discardSize = data[offset++]

    // Find the player in players array and update it
    const playerIndex = players.findIndex(p => p.id === dummyPlayerId)
    if (playerIndex >= 0) {
      const player = players[playerIndex]
      player.isDummy = true

      // Decode hand cards
      const hand: Card[] = []
      for (let h = 0; h < handSize; h++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        hand.push({
          id: `${baseId}_dummyHand_${h}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: 'Random' as any, // Required by Card type
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          isFaceDown: false,
          statuses: []
        })
      }
      player.hand = hand

      // Decode deck cards
      const deck: Card[] = []
      for (let dk = 0; dk < deckSize; dk++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        deck.push({
          id: `${baseId}_dummyDeck_${dk}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: 'Random' as any, // Required by Card type
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          isFaceDown: true,
          statuses: []
        })
      }
      player.deck = deck

      // Decode discard cards
      const discard: Card[] = []
      for (let dc = 0; dc < discardSize; dc++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        discard.push({
          id: `${baseId}_dummyDiscard_${dc}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: 'Random' as any, // Required by Card type
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          isFaceDown: false,
          statuses: []
        })
      }
      player.discard = discard

      logger.debug(`[GameCodec] Decoded dummy player ${dummyPlayerId}: ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
    }
  }

  // Decode other real player decks (non-recipient, non-dummy)
  // [playerDeckCount: 1 byte]
  const otherPlayerDeckCount = data[offset++]
  for (let op = 0; op < otherPlayerDeckCount; op++) {
    const playerId = data[offset++]
    const handSize = data[offset++]
    const deckSize = (data[offset++] << 8) | data[offset++]

    // Find the player in players array
    const playerIndex = players.findIndex(p => p.id === playerId)
    if (playerIndex >= 0) {
      const player = players[playerIndex]

      // Decode hand cards - restore full card data from baseId
      const hand: Card[] = []
      for (let h = 0; h < handSize; h++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        hand.push({
          id: `${baseId}_otherPlayerHand_${playerId}_${h}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: player.selectedDeck || 'Random' as any,
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          powerModifier: 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          color: player.color,
          ownerId: player.id,
          ownerName: player.name,
          isFaceDown: false,
          statuses: []
        })
      }
      player.hand = hand

      // Decode deck cards
      const deck: Card[] = []
      for (let dk = 0; dk < deckSize; dk++) {
        const baseIdLength = data[offset++]
        const baseId = decoder.decode(data.subarray(offset, offset + baseIdLength))
        offset += baseIdLength
        const cardDef = getCardDefinitionFromLocal(baseId)
        deck.push({
          id: `${baseId}_otherPlayerDeck_${playerId}_${dk}_${Date.now()}_${Math.random()}`,
          baseId,
          deck: 'Random' as any,
          name: cardDef?.name || baseId,
          imageUrl: cardDef?.imageUrl || '',
          power: cardDef?.power || 0,
          ability: cardDef?.ability || '',
          types: cardDef?.types || [],
          faction: cardDef?.faction || '',
          ownerId: player.id,
          isFaceDown: true,
          statuses: []
        })
      }
      player.deck = deck

      logger.debug(`[GameCodec] Decoded other player ${playerId}: ${handSize} hand, ${deckSize} deck`)
    } else {
      // Player not found, skip their data
      for (let h = 0; h < handSize; h++) {
        const baseIdLength = data[offset++]
        offset += baseIdLength
      }
      for (let dk = 0; dk < deckSize; dk++) {
        const baseIdLength = data[offset++]
        offset += baseIdLength
      }
    }
  }

  logger.info(`[GameCodec] Decoded: ${boardCardCount} board cards, ${playerCount} players, ${dummyCount} dummies, ${otherPlayerDeckCount} other player hands/decks, hasRecipientPlayer=${hasRecipientPlayer === 1}, phase=${currentPhase}, isGameStarted=${isGameStarted}, activeGridSize=${activeGridSize}, isScoringStep=${isScoringStep}`)

  return {
    players,
    board,
    currentPhase,
    activePlayerId,
    currentRound,
    isGameStarted,
    isScoringStep,
    activeGridSize: activeGridSize as any // number to GridSize conversion
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

  // Decode statuses with ownerId as the default addedByPlayerId
  // This ensures status icons show the correct owner color
  // Note: This assumes statuses belong to card owner, which is correct for most cases
  // (Support/Threat from different players would require more complex encoding)
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
      statuses: decodeStatusesFromMask(statusMask, ownerId)
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

    logger.warn(`[GameCodec] Card ${baseId} not found in local database`)
    return null
  } catch (e) {
    logger.error(`[GameCodec] Error getting card definition for ${baseId}:`, e)
    return null
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Merge decoded state into existing game state
 *
 * CARD_STATE contains:
 * - Board cards (with all their data)
 * - Full player list with metadata (id, name, color, score, isReady, isDummy, isDisconnected, teamId, autoDrawEnabled)
 * - Phase info (currentPhase, activePlayerId, currentRound)
 * - Recipient player's hand/deck/discard (the player who received the message)
 * - Dummy players' hand/deck/discard (all players can control them)
 *
 * CARD_STATE does NOT contain:
 * - Other real players' hands, decks, discard piles (preserved from existing state)
 * - Announced cards (synced via other messages)
 */
export function mergeDecodedState(
  existingState: GameState,
  decodedState: Partial<GameState>,
  localPlayerId: number | null = null
): GameState {
  const result = { ...existingState }

  if (decodedState.players) {
    // Build new player list - include all players from decoded state
    // (decoded state has authoritative player list from host)
    result.players = decodedState.players.map(player => {
      const existing = existingState.players.find(p => p.id === player.id)
      if (existing) {
        // Check if player has ultra-compact card data (new format)
        const hasUltraCompact = hasUltraCompactData(player)

        if (hasUltraCompact) {
          // NEW ULTRA-COMPACT FORMAT: Reconstruct cards from minimal data
          logger.debug(`[mergeDecodedState] Player ${player.id} has ultra-compact data`)

          // Reconstruct hand from ultra-compact handCards
          let reconstructedHand = existing.hand
          if ((player as any).handCards?.length > 0) {
            const handCards = (player as any).handCards as UltraCompactCardData[]
            reconstructedHand = handCards.map(hc => reconstructCardFromUltraCompact(hc, existing.deck))
          }

          // Reconstruct deck from deckCardRefs
          let reconstructedDeck = existing.deck
          if ((player as any).deckCardRefs?.length > 0) {
            const deckCardRefs = (player as any).deckCardRefs as UltraCompactCardRef[]
            reconstructedDeck = reconstructDeckFromRefs(deckCardRefs, existing.deck)
          }

          // Reconstruct discard from ultra-compact discardCards
          let reconstructedDiscard = existing.discard
          if ((player as any).discardCards?.length > 0) {
            const discardCards = (player as any).discardCards as UltraCompactCardData[]
            reconstructedDiscard = discardCards.map(dc => reconstructCardFromUltraCompact(dc, existing.discard))
          }

          const isLocalPlayer = player.id === localPlayerId
          const preserveSelectedDeck = isLocalPlayer && existing.selectedDeck

          return {
            ...player,
            hand: reconstructedHand,
            deck: reconstructedDeck,
            discard: reconstructedDiscard,
            // Remove temporary properties
            handCards: undefined,
            deckCardRefs: undefined,
            discardCards: undefined,
            // Preserve other properties from existing if not in decoded
            announcedCard: player.announcedCard || existing.announcedCard,
            boardHistory: player.boardHistory || existing.boardHistory,
            // For local player, preserve existing selectedDeck; for others, use decoded
            selectedDeck: preserveSelectedDeck ? existing.selectedDeck : (player.selectedDeck || existing.selectedDeck),
            // Update size metadata
            handSize: reconstructedHand.length,
            deckSize: reconstructedDeck.length,
            discardSize: reconstructedDiscard.length
          }
        }

        // Player exists - merge hand/deck/discard intelligently
        // For dummy players, use all decoded data (hand, deck, discard are included)
        // For real players, check if hand/deck/discard were decoded (non-empty)
        // If they are empty arrays, preserve existing data (privacy/other players)
        // If they have data, use decoded data (recipient player or initial state)

        const useDecodedHandDeck = player.isDummy ||
          (player.hand && player.hand.length > 0) ||
          (player.deck && player.deck.length > 0) ||
          (player.discard && player.discard.length > 0)

        if (useDecodedHandDeck) {
          // Use decoded hand/deck/discard (dummy player or recipient player)
          // CRITICAL: For local player, always preserve existing.selectedDeck if it exists
          // This prevents host from overwriting guest's deck choice with "Random"
          const isLocalPlayer = player.id === localPlayerId
          const preserveSelectedDeck = isLocalPlayer && existing.selectedDeck

          return {
            ...player,
            hand: player.hand || existing.hand,
            deck: player.deck || existing.deck,
            discard: player.discard || existing.discard,
            // Preserve other properties from existing if not in decoded
            announcedCard: player.announcedCard || existing.announcedCard,
            boardHistory: player.boardHistory || existing.boardHistory,
            // For local player, preserve existing selectedDeck; for others, use decoded
            selectedDeck: preserveSelectedDeck ? existing.selectedDeck : (player.selectedDeck || existing.selectedDeck),
            // Preserve/update size metadata
            handSize: player.handSize ?? player.hand?.length ?? existing.handSize ?? existing.hand?.length,
            deckSize: player.deckSize ?? player.deck?.length ?? existing.deckSize ?? existing.deck?.length,
            discardSize: player.discardSize ?? player.discard?.length ?? existing.discardSize ?? existing.discard?.length
          }
        }

        // Preserve existing hand/deck/discard (other real players)
        // BUT update size metadata from decoded state
        return {
          ...player,
          hand: existing.hand,
          deck: existing.deck,
          discard: existing.discard,
          // Preserve other properties from existing if not in decoded
          announcedCard: existing.announcedCard,
          boardHistory: existing.boardHistory,
          selectedDeck: existing.selectedDeck,  // Always preserve existing for non-recipient players
          // Update size metadata from decoded state (this is the key fix!)
          handSize: player.handSize ?? existing.handSize ?? existing.hand?.length,
          deckSize: player.deckSize ?? existing.deckSize ?? existing.deck?.length,
          discardSize: player.discardSize ?? existing.discardSize ?? existing.discard?.length
        }
      }
      // New player (not in existing state) - use decoded data as-is
      return {
        ...player,
        hand: player.hand || [],
        deck: player.deck || [],
        discard: player.discard || [],
        announcedCard: null,
        boardHistory: [],
        selectedDeck: player.selectedDeck || 'Random' as any,
        // Ensure size metadata is set
        handSize: player.handSize ?? player.hand?.length ?? 0,
        deckSize: player.deckSize ?? player.deck?.length ?? 0,
        discardSize: player.discardSize ?? player.discard?.length ?? 0
      }
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

  if (decodedState.isGameStarted !== undefined) {
    result.isGameStarted = decodedState.isGameStarted
  }

  if (decodedState.isScoringStep !== undefined) {
    result.isScoringStep = decodedState.isScoringStep
  }

  if (decodedState.activeGridSize !== undefined) {
    result.activeGridSize = decodedState.activeGridSize
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
