/**
 * Optimized WebRTC Serialization
 *
 * Optimizations:
 * 1. MessagePack binary format (smaller than JSON)
 * 2. Short field names (minification)
 * 3. Card serialization by reference (id + stats, not full object)
 * 4. Differential compression for repeated data
 * 5. Board cell compression (only changed cells)
 *
 * @module webrtcSerialization
 */

import { encode, decode } from '@msgpack/msgpack'
import type { Card, GameState, StateDelta, Cell } from '../types'
import { logger } from './logger'

// ============================================================================
// TYPE DEFINITIONS - Optimized schemas with short keys
// ============================================================================

/**
 * Optimized card data - only essential fields
 * Tokens/counters are tracked separately
 */
export interface OptimizedCard {
  i: string      // id
  b: string      // baseId
  n?: string     // name (optional, for display)
  p: number      // power
  pm?: number    // powerModifier
  bp?: number    // bonusPower
  o: number      // ownerId
  on?: string    // ownerName
  s?: Status[]   // statuses (optimized)
  et?: boolean   // enteredThisTurn
  ifd?: boolean  // isFaceDown
  rt?: 'all' | number[]  // revealedTo
  t?: string[]   // types
  f?: string     // faction
  d?: string     // deck
}

/**
 * Optimized status - minimal representation
 */
export interface Status {
  t: string      // type
  a: number      // addedByPlayerId
}

/**
 * Optimized board cell
 */
export interface OptimizedBoardCell {
  c: OptimizedCard | null  // card
}

/**
 * Optimized player delta - short keys
 */
export interface OptimizedPlayerDelta {
  i: number              // id
  n?: string             // name
  c?: string             // color
  s?: number             // score
  hs?: number            // handSizeDelta
  ds?: number            // deckSizeDelta
  dis?: number           // discardSizeDelta
  ha?: Card[]            // handAdd (cards added to hand)
  hr?: number            // handRemove (cards removed from hand)
  dr?: number            // deckRemove
  da?: Card[]            // deckAdd
  disa?: Card[]          // discardAdd
  ac?: Card | null       // announcedCard
  bh?: string[]          // boardHistory
  rm?: boolean           // removed
  r?: boolean            // isReady
  d?: boolean            // isDisconnected
  sc?: string            // selectedDeck
  tid?: number           // teamId
}

/**
 * Optimized board cell delta
 */
export interface OptimizedBoardCellDelta {
  r: number              // row
  c: number              // col
  ca?: OptimizedCard     // card (if added/changed)
  rm?: boolean           // removed (if card was removed)
}

/**
 * Optimized state delta - short keys
 */
export interface OptimizedStateDelta {
  t: number              // timestamp
  s: number              // sourcePlayerId
  pd?: Record<number, OptimizedPlayerDelta>  // playerDeltas
  bc?: OptimizedBoardCellDelta[]  // boardCells
  ph?: { p: number; n?: number }  // phaseDelta { phase, nextPlayer? }
  rd?: { r: number; rw?: number[]; sw?: number }  // roundDelta { round, roundWinners?, sweepWinners? }
  sd?: {                 // settingsDelta
    gm?: string          // gameMode
    pr?: boolean         // isPrivate
    gs?: number          // activeGridSize
    dc?: number          // dummyPlayerCount
    aa?: boolean         // autoAbilitiesEnabled
  }
  hd?: {                 // highlightsDelta
    a?: Array<{ r: number; c: number; cid: string }>  // add
    cl?: boolean         // clear
  }
  ftd?: Array<{          // floatingTextsDelta
    r: number
    c: number
    txt: string
    pi: number
  }>
  tmd?: {                // targetingModeDelta
    clr?: boolean        // clear
    set?: any            // set
  }
  amd?: any              // abilityModeDelta
}

/**
 * Optimized full state for initial sync (minimal)
 */
export interface OptimizedGameState {
  gi: string             // gameId
  gm: string             // gameMode
  p: number              // currentPhase
  ap: number | null      // activePlayerId
  sp: number | null      // startingPlayerId
  rd: number             // currentRound
  tn: number             // turnNumber
  iss: boolean           // isScoringStep
  igs: boolean           // isGameStarted
  pl: OptimizedPlayer[]  // players (minimal)
  bd: OptimizedBoardCell[][]  // board
}

/**
 * Optimized player for full state
 */
export interface OptimizedPlayer {
  i: number              // id
  n: string              // name
  c: string              // color
  id: boolean            // isDummy
  sc: string             // selectedDeck
  r: boolean             // isReady
  s: number              // score
  hs: number             // handSize
  ds: number             // deckSize
  diss: number           // discardSize
  ac?: OptimizedCard     // announcedCard
  tid?: number           // teamId
}

// ============================================================================
// CARD SERIALIZATION - By reference with token tracking
// ============================================================================

/**
 * Token definition for tracking
 * Tokens are lightweight and can be sent directly
 */
export interface TokenDefinition {
  id: string
  name: string
  types: string[]
}

// Global token registry - shared between host and guests
// All players have access to the same token definitions
const TOKEN_REGISTRY = new Map<string, TokenDefinition>()

/**
 * Register a token definition
 */
export function registerTokenDef(token: TokenDefinition): void {
  TOKEN_REGISTRY.set(token.id, token)
}

/**
 * Check if a card is a token (lightweight, can be reconstructed)
 */
function isTokenCard(card: Card): boolean {
  return !!card && (
    card.deck === 'Tokens' ||
    card.deck === 'counter' ||
    card.types?.includes('Token') ||
    card.types?.includes('Token Unit')
  )
}

/**
 * Optimize card for transmission
 * - For tokens: send only id + stats (recreatable from registry)
 * - For regular cards: send id + baseId + essential stats
 * - Statuses are sent separately as array of {type, addedByPlayerId}
 */
export function optimizeCard(card: Card): OptimizedCard {
  const isToken = isTokenCard(card)

  const optimized: OptimizedCard = {
    i: card.id,
    b: card.baseId,
    p: card.power,
    o: card.ownerId,
  }

  // Optional fields (only if present)
  if (card.name) optimized.n = card.name
  if (card.powerModifier) optimized.pm = card.powerModifier
  if (card.bonusPower) optimized.bp = card.bonusPower
  if (card.ownerName) optimized.on = card.ownerName
  if (card.enteredThisTurn) optimized.et = true
  if (card.isFaceDown) optimized.ifd = true
  if (card.revealedTo) optimized.rt = card.revealedTo
  if (card.types?.length) optimized.t = card.types
  if (card.faction) optimized.f = card.faction
  if (card.deck) optimized.d = card.deck

  // Optimize statuses - extract only type and addedByPlayerId
  if (card.statuses?.length) {
    optimized.s = card.statuses.map(s => ({
      t: s.type,
      a: s.addedByPlayerId
    }))
  }

  return optimized
}

/**
 * Reconstruct card from optimized format
 * For tokens: will need to lookup in registry
 * For regular cards: reconstruct from baseId
 */
export function reconstructCard(optimized: OptimizedCard): Card {
  const card: Card = {
    id: optimized.i,
    baseId: optimized.b,
    power: optimized.p,
    ownerId: optimized.o,
  }

  // Restore optional fields
  if (optimized.n) card.name = optimized.n
  if (optimized.pm !== undefined) card.powerModifier = optimized.pm
  if (optimized.bp !== undefined) card.bonusPower = optimized.bp
  if (optimized.on) card.ownerName = optimized.on
  if (optimized.et) card.enteredThisTurn = true
  if (optimized.ifd) card.isFaceDown = true
  if (optimized.rt) card.revealedTo = optimized.rt
  if (optimized.t) card.types = optimized.t
  if (optimized.f) card.faction = optimized.f
  if (optimized.d) card.deck = optimized.d

  // Restore statuses
  if (optimized.s) {
    card.statuses = optimized.s.map(s => ({
      type: s.t,
      addedByPlayerId: s.a
    }))
  }

  return card
}

/**
 * Check if two cards are equal (for delta compression)
 */
export function cardsEqual(card1: Card | null, card2: Card | null): boolean {
  if (!card1 && !card2) return true
  if (!card1 || !card2) return false
  return card1.id === card2.id
}

// ============================================================================
// DELTA COMPRESSION - Short keys + MessagePack
// ============================================================================

/**
 * Compress state delta to optimized format with short keys
 */
export function compressDelta(delta: StateDelta): OptimizedStateDelta {
  const optimized: OptimizedStateDelta = {
    t: delta.timestamp,
    s: delta.sourcePlayerId || 0,
  }

  // Compress player deltas
  if (delta.playerDeltas) {
    optimized.pd = {}
    for (const [playerId, playerDelta] of Object.entries(delta.playerDeltas)) {
      const pid = parseInt(playerId)
      const opd: OptimizedPlayerDelta = { i: pid }

      // Copy fields with short keys
      if (playerDelta.name) opd.n = playerDelta.name
      if (playerDelta.color) opd.c = playerDelta.color
      if (playerDelta.score !== undefined) opd.s = playerDelta.score
      if (playerDelta.handSizeDelta) opd.hs = playerDelta.handSizeDelta
      if (playerDelta.deckSizeDelta) opd.ds = playerDelta.deckSizeDelta
      if (playerDelta.discardSizeDelta) opd.dis = playerDelta.discardSizeDelta
      if (playerDelta.handAdd) opd.ha = playerDelta.handAdd
      if (playerDelta.handRemove) opd.hr = playerDelta.handRemove
      if (playerDelta.deckRemove) opd.dr = playerDelta.deckRemove
      if (playerDelta.deckAdd) opd.da = playerDelta.deckAdd
      if (playerDelta.discardAdd) opd.disa = playerDelta.discardAdd
      if (playerDelta.announcedCard !== undefined) opd.ac = playerDelta.announcedCard
      if (playerDelta.boardHistory) opd.bh = playerDelta.boardHistory
      if (playerDelta.removed) opd.rm = true
      if (playerDelta.isReady !== undefined) opd.r = playerDelta.isReady
      if (playerDelta.isDisconnected !== undefined) opd.d = playerDelta.isDisconnected
      if (playerDelta.selectedDeck) opd.sc = playerDelta.selectedDeck
      if (playerDelta.teamId !== undefined) opd.tid = playerDelta.teamId

      optimized.pd[pid] = opd
    }
  }

  // Compress board cells
  if (delta.boardCells?.length) {
    optimized.bc = delta.boardCells.map(cell => ({
      r: cell.row,
      c: cell.col,
      ...(cardToRemove(cell.card) ? { rm: true } : {}),
      ...(cell.card ? { ca: optimizeCard(cell.card) } : {})
    }))
  }

  // Compress phase delta
  if (delta.phaseDelta) {
    optimized.ph = {
      p: delta.phaseDelta.phase,
      ...(delta.phaseDelta.nextPlayer !== undefined && { n: delta.phaseDelta.nextPlayer })
    }
  }

  // Compress round delta
  if (delta.roundDelta) {
    optimized.rd = {
      r: delta.roundDelta.round,
      ...(delta.roundDelta.roundWinners && { rw: delta.roundDelta.roundWinners }),
      ...(delta.roundDelta.sweepWinners && { sw: delta.roundDelta.sweepWinners })
    }
  }

  // Compress settings delta
  if (delta.settingsDelta) {
    optimized.sd = {}
    if (delta.settingsDelta.gameMode) optimized.sd.gm = delta.settingsDelta.gameMode
    if (delta.settingsDelta.isPrivate !== undefined) optimized.sd.pr = delta.settingsDelta.isPrivate
    if (delta.settingsDelta.activeGridSize) optimized.sd.gs = delta.settingsDelta.activeGridSize
    if (delta.settingsDelta.dummyPlayerCount) optimized.sd.dc = delta.settingsDelta.dummyPlayerCount
    if (delta.settingsDelta.autoAbilitiesEnabled !== undefined) optimized.sd.aa = delta.settingsDelta.autoAbilitiesEnabled
  }

  // Compress highlights delta
  if (delta.highlightsDelta) {
    optimized.hd = {}
    if (delta.highlightsDelta.add?.length) {
      optimized.hd.a = delta.highlightsDelta.add.map(h => ({
        r: h.row,
        c: h.col,
        cid: h.cardId
      }))
    }
    if (delta.highlightsDelta.clear) optimized.hd.cl = true
  }

  // Compress floating texts delta
  if (delta.floatingTextsDelta?.length) {
    optimized.ftd = delta.floatingTextsDelta.map(ft => ({
      r: ft.row,
      c: ft.col,
      txt: ft.text,
      pi: ft.playerId
    }))
  }

  // Compress targeting mode delta
  if (delta.targetingModeDelta) {
    optimized.tmd = delta.targetingModeDelta
  }

  // Compress ability mode delta
  if (delta.abilityModeDelta) {
    optimized.amd = delta.abilityModeDelta
  }

  return optimized
}

/**
 * Helper to check if card should be marked as removed
 */
function cardToRemove(card: Card | null): boolean {
  return card === null
}

/**
 * Expand optimized delta back to full format
 */
export function expandDelta(optimized: OptimizedStateDelta): StateDelta {
  const delta: StateDelta = {
    timestamp: optimized.t,
    sourcePlayerId: optimized.s,
  }

  // Expand player deltas
  if (optimized.pd) {
    delta.playerDeltas = {}
    for (const [playerId, opd] of Object.entries(optimized.pd)) {
      const playerDelta: any = { id: parseInt(playerId) }

      if (opd.n) playerDelta.name = opd.n
      if (opd.c) playerDelta.color = opd.c
      if (opd.s !== undefined) playerDelta.score = opd.s
      if (opd.hs) playerDelta.handSizeDelta = opd.hs
      if (opd.ds) playerDelta.deckSizeDelta = opd.ds
      if (opd.dis) playerDelta.discardSizeDelta = opd.dis
      if (opd.ha) playerDelta.handAdd = opd.ha
      if (opd.hr) playerDelta.handRemove = opd.hr
      if (opd.dr) playerDelta.deckRemove = opd.dr
      if (opd.da) playerDelta.deckAdd = opd.da
      if (opd.disa) playerDelta.discardAdd = opd.disa
      if (opd.ac !== undefined) playerDelta.announcedCard = opd.ac
      if (opd.bh) playerDelta.boardHistory = opd.bh
      if (opd.rm) playerDelta.removed = true
      if (opd.r !== undefined) playerDelta.isReady = opd.r
      if (opd.d !== undefined) playerDelta.isDisconnected = opd.d
      if (opd.sc) playerDelta.selectedDeck = opd.sc
      if (opd.tid !== undefined) playerDelta.teamId = opd.tid

      delta.playerDeltas[playerDelta.id] = playerDelta
    }
  }

  // Expand board cells
  if (optimized.bc?.length) {
    delta.boardCells = optimized.bc.map(cell => ({
      row: cell.r,
      col: cell.c,
      card: cell.rm ? null : (cell.ca ? reconstructCard(cell.ca) : null)
    }))
  }

  // Expand phase delta
  if (optimized.ph) {
    delta.phaseDelta = {
      phase: optimized.ph.p,
      ...(optimized.ph.n !== undefined && { nextPlayer: optimized.ph.n })
    }
  }

  // Expand round delta
  if (optimized.rd) {
    delta.roundDelta = {
      round: optimized.rd.r,
      ...(optimized.rd.rw && { roundWinners: optimized.rd.rw }),
      ...(optimized.rd.sw && { sweepWinners: optimized.rd.sw })
    }
  }

  // Expand settings delta
  if (optimized.sd) {
    delta.settingsDelta = {}
    if (optimized.sd.gm) delta.settingsDelta.gameMode = optimized.sd.gm
    if (optimized.sd.pr !== undefined) delta.settingsDelta.isPrivate = optimized.sd.pr
    if (optimized.sd.gs) delta.settingsDelta.activeGridSize = optimized.sd.gs
    if (optimized.sd.dc) delta.settingsDelta.dummyPlayerCount = optimized.sd.dc
    if (optimized.sd.aa !== undefined) delta.settingsDelta.autoAbilitiesEnabled = optimized.sd.aa
  }

  // Expand highlights delta
  if (optimized.hd) {
    delta.highlightsDelta = {}
    if (optimized.hd.a) {
      delta.highlightsDelta.add = optimized.hd.a.map(h => ({
        row: h.r,
        col: h.c,
        cardId: h.cid
      }))
    }
    if (optimized.hd.cl) delta.highlightsDelta.clear = true
  }

  // Expand floating texts delta
  if (optimized.ftd) {
    delta.floatingTextsDelta = optimized.ftd.map(ft => ({
      row: ft.r,
      col: ft.c,
      text: ft.txt,
      playerId: ft.pi
    }))
  }

  // Expand targeting mode delta
  if (optimized.tmd) {
    delta.targetingModeDelta = optimized.tmd
  }

  // Expand ability mode delta
  if (optimized.amd) {
    delta.abilityModeDelta = optimized.amd
  }

  return delta
}

// ============================================================================
// MESSAGEPACK SERIALIZATION
// ============================================================================

/**
 * Serialize data to MessagePack binary format
 */
export function serializeToBinary(data: any): Uint8Array {
  try {
    return encode(data)
  } catch (err) {
    logger.error('[serializeToBinary] Failed to encode:', err)
    // Fallback to JSON string
    return new TextEncoder().encode(JSON.stringify(data))
  }
}

/**
 * Deserialize data from MessagePack binary format
 */
export function deserializeFromBinary(buffer: Uint8Array): any {
  try {
    return decode(buffer)
  } catch (err) {
    logger.error('[deserializeFromBinary] Failed to decode:', err)
    // Fallback to JSON parsing
    return JSON.parse(new TextDecoder().decode(buffer))
  }
}

/**
 * Compress and serialize state delta for transmission
 * Returns binary MessagePack data
 */
export function serializeDelta(delta: StateDelta): Uint8Array {
  const optimized = compressDelta(delta)
  return serializeToBinary(optimized)
}

/**
 * Deserialize and expand state delta from transmission
 * Accepts binary MessagePack data
 */
export function deserializeDelta(buffer: Uint8Array): StateDelta {
  const optimized = deserializeFromBinary(buffer) as OptimizedStateDelta
  return expandDelta(optimized)
}

// ============================================================================
// FULL STATE SERIALIZATION (for initial sync)
// ============================================================================

/**
 * Create minimal game state for initial sync
 * Only sends essential data, players reconstruct their own hands/decks
 */
export function createMinimalGameState(gameState: GameState): OptimizedGameState {
  return {
    gi: gameState.gameId || '',
    gm: gameState.gameMode,
    p: gameState.currentPhase,
    ap: gameState.activePlayerId,
    sp: gameState.startingPlayerId,
    rd: gameState.currentRound,
    tn: gameState.turnNumber,
    iss: gameState.isScoringStep,
    igs: gameState.isGameStarted,
    pl: gameState.players.map(p => ({
      i: p.id,
      n: p.name,
      c: typeof p.color === 'string' ? p.color : 'blue',
      id: p.isDummy ?? false,
      sc: p.selectedDeck,
      r: p.isReady ?? false,
      s: p.score || 0,
      hs: p.hand.length,
      ds: p.deck.length,
      diss: p.discard.length,
      ac: p.announcedCard ? optimizeCard(p.announcedCard) : undefined,
      tid: p.teamId,
    })),
    bd: gameState.board.map(row =>
      row.map(cell => ({
        c: cell.card ? optimizeCard(cell.card) : null
      }))
    ),
  }
}

/**
 * Serialize full game state for initial sync
 */
export function serializeGameState(gameState: GameState): Uint8Array {
  const minimal = createMinimalGameState(gameState)
  return serializeToBinary(minimal)
}

// ============================================================================
// DIFFERENTIAL COMPRESSION - Track previous state
// ============================================================================

/**
 * Differential compression context
 * Tracks previous state to only send changes
 */
export class DifferentialCompressor {
  private previousBoard: Map<string, OptimizedCard | null> = new Map()
  private previousPlayerStates: Map<number, any> = new Map()

  /**
   * Get board cell key
   */
  private getCellKey(row: number, col: number): string {
    return `${row},${col}`
  }

  /**
   * Check if board cell changed
   */
  boardCellChanged(row: number, col: number, card: Card | null): boolean {
    const key = this.getCellKey(row, col)
    const previous = this.previousBoard.get(key)

    if (!previous && !card) return false
    if (!previous || !card) return true
    if (previous.i !== card.id) return true

    // Check if stats changed
    if (previous.pm !== (card.powerModifier || 0)) return true
    if (previous.bp !== (card.bonusPower || 0)) return true
    if (previous.s?.length !== (card.statuses?.length || 0)) return true

    return false
  }

  /**
   * Update tracked board cell
   */
  updateBoardCell(row: number, col: number, card: Card | null): void {
    const key = this.getCellKey(row, col)
    this.previousBoard.set(key, card ? optimizeCard(card) : null)
  }

  /**
   * Check if player state changed
   */
  playerStateChanged(playerId: number, currentState: any): boolean {
    const previous = this.previousPlayerStates.get(playerId)
    if (!previous) return true

    // Check key fields
    if (previous.s !== currentState.score) return true
    if (previous.hs !== currentState.handSize) return true
    if (previous.ds !== currentState.deckSize) return true
    if (previous.r !== currentState.isReady) return true

    return false
  }

  /**
   * Update tracked player state
   */
  updatePlayerState(playerId: number, state: any): void {
    this.previousPlayerStates.set(playerId, state)
  }

  /**
   * Clear all tracked state
   */
  clear(): void {
    this.previousBoard.clear()
    this.previousPlayerStates.clear()
  }
}

// ============================================================================
// SIZE COMPARISON UTILITIES
// ============================================================================

/**
 * Calculate size of data in different formats
 */
export function compareSerializationSizes(data: any): {
  jsonSize: number
  msgpackSize: number
  optimizedMsgpackSize: number
  reduction: number
} {
  const jsonStr = JSON.stringify(data)
  const jsonSize = new Blob([jsonStr]).size

  const msgpack = encode(data)
  const msgpackSize = msgpack.byteLength

  // For delta, compress first
  const optimized = compressDelta(data as StateDelta)
  const optimizedMsgpack = encode(optimized)
  const optimizedMsgpackSize = optimizedMsgpack.byteLength

  const reduction = ((jsonSize - optimizedMsgpackSize) / jsonSize * 100)

  return {
    jsonSize,
    msgpackSize,
    optimizedMsgpackSize,
    reduction: Math.round(reduction * 10) / 10
  }
}

/**
 * Log serialization stats
 */
export function logSerializationStats(delta: StateDelta): void {
  const stats = compareSerializationSizes(delta)
  logger.info('[Serialization] Size comparison:', {
    json: `${stats.jsonSize} bytes`,
    msgpack: `${stats.msgpackSize} bytes`,
    optimized: `${stats.optimizedMsgpackSize} bytes`,
    reduction: `${stats.reduction}% smaller than JSON`
  })
}

/**
 * Expand minimal game state back to full format
 * Reconstructs player hands/decks locally using deck definitions
 */
export function expandMinimalGameState(minimal: OptimizedGameState): GameState {
  const gameState: any = {
    gameId: minimal.gi,
    gameMode: minimal.gm,
    currentPhase: minimal.p,
    activePlayerId: minimal.ap,
    startingPlayerId: minimal.sp,
    currentRound: minimal.rd,
    turnNumber: minimal.tn,
    isScoringStep: minimal.iss,
    isGameStarted: minimal.igs,
    players: minimal.pl.map(p => {
      const player: any = {
        id: p.i,
        name: p.n,
        color: p.c,
        isDummy: p.id,
        selectedDeck: p.sc,
        isReady: p.r,
        score: p.s,
        teamId: p.tid,
      }

      // Reconstruct hand (empty array for real players, full for dummies)
      if (p.id) {
        // Dummy player - would need full hand reconstruction
        // For now, create empty arrays that will be filled by host sync
        player.hand = []
        player.deck = []
        player.discard = []
      } else {
        // Real player - create empty arrays with correct sizes
        player.hand = new Array(p.hs)
        player.deck = new Array(p.ds)
        player.discard = new Array(p.diss)
      }

      // Reconstruct announced card
      if (p.ac) {
        player.announcedCard = reconstructCard(p.ac)
      }

      return player
    }),
    board: minimal.bd.map(row =>
      row.map(cell => ({
        card: cell.c ? reconstructCard(cell.c) : null
      }))
    ),
  }

  return gameState as GameState
}
