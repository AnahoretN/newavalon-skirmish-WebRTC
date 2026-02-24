/**
 * Effects Manager - ID-based Visual Effects System for P2P
 *
 * Each effect has a unique 5-character ID for synchronization.
 * Host tracks all effects and broadcasts add/remove to guests.
 *
 * Effect Types:
 * - highlight: row/col/cell highlighting
 * - floatingText: damage, score changes, ability text
 * - noTarget: red X overlay
 * - clickWave: colored ripple on click
 * - targetingMode: ability targeting mode
 */

import type { PlayerColor } from '../types'

// ============================================================================
// EFFECT ID GENERATION
// ============================================================================

/**
 * Generate a unique 5-character effect ID
 * Format: XXXXX where X is 0-9 or A-Z (excluding I, O, Q to avoid confusion)
 * Gives 33^5 ≈ 39 million possible IDs
 */
export function generateEffectId(): string {
  const chars = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ' // 33 chars, no I/O/Q
  let id = ''
  for (let i = 0; i < 5; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/**
 * Check if an effect ID is valid (5 chars, valid characters)
 */
export function isValidEffectId(id: string): boolean {
  return /^[0-9ABCDEFGHJKLMNPRSTUVWXYZ]{5}$/.test(id)
}

// ============================================================================
// EFFECT TYPES
// ============================================================================

export type EffectType =
  | 'highlight'      // Row/column/cell highlight
  | 'floatingText'   // Floating text (damage, score, etc.)
  | 'noTarget'       // Red X overlay for invalid target
  | 'clickWave'      // Colored ripple on click
  | 'targetingMode'  // Ability targeting mode

/**
 * Base effect data common to all effects
 */
export interface BaseEffect {
  id: string              // 5-character unique ID
  type: EffectType        // Effect type
  playerId: number        // Player who created the effect (determines color)
  createdAt: number       // Timestamp when created
  expiresAt?: number      // Auto-remove timestamp (optional)
}

/**
 * Highlight effect (row/col/cell)
 */
export interface HighlightEffect extends BaseEffect {
  type: 'highlight'
  highlightType: 'row' | 'col' | 'cell'
  row?: number            // Row index (for row/cell highlights)
  col?: number            // Column index (for col/cell highlights)
}

/**
 * Floating text effect (damage, score changes, etc.)
 */
export interface FloatingTextEffect extends BaseEffect {
  type: 'floatingText'
  row: number             // Board row position
  col: number             // Board column position
  text: string            // Text to display (e.g., "+3", "-2")
  color?: string          // Custom color (overrides player color)
}

/**
 * No-target overlay effect
 */
export interface NoTargetEffect extends BaseEffect {
  type: 'noTarget'
  row: number             // Board row position
  col: number             // Board column position
}

/**
 * Click wave effect (colored ripple)
 */
export interface ClickWaveEffect extends BaseEffect {
  type: 'clickWave'
  location: 'board' | 'hand' | 'emptyCell'
  row?: number            // Board row (if applicable)
  col?: number            // Board column (if applicable)
  handPlayerId?: number   // Player whose hand was clicked
  handCardIndex?: number  // Card index in hand
}

/**
 * Targeting mode effect
 */
export interface TargetingModeEffect extends BaseEffect {
  type: 'targetingMode'
  mode: string            // Ability mode (e.g., 'SELECT_TARGET', 'RIOT_PUSH')
  sourceRow?: number      // Source card row
  sourceCol?: number      // Source card column
  boardTargets: string[]  // Array of "row,col" strings for valid targets
  handTargets: string[]   // Array of "playerId,cardIndex" strings
  isDeckSelectable: boolean
}

/**
 * Union type of all effects
 */
export type Effect =
  | HighlightEffect
  | FloatingTextEffect
  | NoTargetEffect
  | ClickWaveEffect
  | TargetingModeEffect

/**
 * Get effect type from effect object
 */
export function getEffectType(effect: Effect): EffectType {
  return effect.type
}

// ============================================================================
// COMPACT MESSAGE FORMATS
// ============================================================================

/**
 * Compact effect add message (host -> guests)
 * Minimized size for WebRTC transmission
 */
export interface EffectAddMessage {
  i: string       // id (5 chars)
  t: number       // type (0=highlight, 1=floatingText, 2=noTarget, 3=clickWave, 4=targetingMode)
  p: number       // playerId
  c?: number      // createdAt (timestamp, optional if included in message wrapper)
  e?: number      // expiresAt (timestamp, optional)
  // Type-specific data (minimal)
  // Highlight:
  ht?: number     // highlightType (0=row, 1=col, 2=cell)
  r?: number      // row
  c2?: number     // col (c2 because 'c' is createdAt)
  // FloatingText:
  tr?: number     // row
  tc?: number     // col
  tx?: string     // text
  tc2?: string    // custom color (tc2 because 'tc' is text row)
  // NoTarget:
  nr?: number     // row
  nc?: number     // col
  // ClickWave:
  l?: number      // location (0=board, 1=hand, 2=emptyCell)
  hr?: number     // hand row
  hc?: number     // hand col
  hp?: number     // hand player id
  hi?: number     // hand card index
  // TargetingMode:
  m?: string      // mode
  sr?: number     // source row
  sc?: number     // source col
  bt?: string[]   // board targets (["row,col", ...])
  bht?: string[]  // hand targets (["playerId,cardIndex", ...])
  ds?: boolean    // deck selectable
}

/**
 * Compact effect remove message (host -> guests)
 */
export interface EffectRemoveMessage {
  i: string       // id of effect to remove
}

/**
 * Effect message wrapper (for WebRTC transmission)
 */
export interface EffectMessageWrapper {
  type: 'EFFECT_ADD' | 'EFFECT_REMOVE'
  senderId: string
  timestamp: number
  data: EffectAddMessage | EffectRemoveMessage
}

// ============================================================================
// ENCODING/DECODING
// ============================================================================

/**
 * Encode effect to compact message format
 */
export function encodeEffect(effect: Effect): EffectAddMessage {
  const base: EffectAddMessage = {
    i: effect.id,
    t: getEffectTypeCode(effect.type),
    p: effect.playerId,
    c: effect.createdAt,
  }

  if (effect.expiresAt !== undefined) {
    base.e = effect.expiresAt
  }

  switch (effect.type) {
    case 'highlight':
      return {
        ...base,
        ht: effect.highlightType === 'row' ? 0 : effect.highlightType === 'col' ? 1 : 2,
        r: effect.row,
        c2: effect.col,
      }

    case 'floatingText':
      return {
        ...base,
        tr: effect.row,
        tc: effect.col,
        tx: effect.text,
        tc2: effect.color,
      }

    case 'noTarget':
      return {
        ...base,
        nr: effect.row,
        nc: effect.col,
      }

    case 'clickWave':
      return {
        ...base,
        l: effect.location === 'board' ? 0 : effect.location === 'hand' ? 1 : 2,
        r: effect.row,
        c2: effect.col,
        hp: effect.handPlayerId,
        hi: effect.handCardIndex,
      }

    case 'targetingMode':
      return {
        ...base,
        m: effect.mode,
        sr: effect.sourceRow,
        sc: effect.sourceCol,
        bt: effect.boardTargets,
        bht: effect.handTargets,
        ds: effect.isDeckSelectable,
      }
  }
}

/**
 * Decode compact message to effect
 */
export function decodeEffect(msg: EffectAddMessage): Effect | null {
  const type = getEffectTypeFromCode(msg.t)
  if (!type) return null

  const base = {
    id: msg.i,
    type,
    playerId: msg.p,
    createdAt: msg.c ?? Date.now(),
    expiresAt: msg.e,
  }

  switch (type) {
    case 'highlight': {
      const highlightType: 'row' | 'col' | 'cell' =
        msg.ht === 0 ? 'row' : msg.ht === 1 ? 'col' : 'cell'
      return {
        ...base,
        type: 'highlight',
        highlightType,
        row: msg.r,
        col: msg.c2,
      } as HighlightEffect
    }

    case 'floatingText':
      return {
        ...base,
        type: 'floatingText',
        row: msg.tr ?? 0,
        col: msg.tc ?? 0,
        text: msg.tx ?? '',
        color: msg.tc2,
      } as FloatingTextEffect

    case 'noTarget':
      return {
        ...base,
        type: 'noTarget',
        row: msg.nr ?? 0,
        col: msg.nc ?? 0,
      } as NoTargetEffect

    case 'clickWave': {
      const location: 'board' | 'hand' | 'emptyCell' =
        msg.l === 0 ? 'board' : msg.l === 1 ? 'hand' : 'emptyCell'
      return {
        ...base,
        type: 'clickWave',
        location,
        row: msg.r,
        col: msg.c2,
        handPlayerId: msg.hp,
        handCardIndex: msg.hi,
      } as ClickWaveEffect
    }

    case 'targetingMode':
      return {
        ...base,
        type: 'targetingMode',
        mode: msg.m ?? '',
        sourceRow: msg.sr,
        sourceCol: msg.sc,
        boardTargets: msg.bt ?? [],
        handTargets: msg.bht ?? [],
        isDeckSelectable: msg.ds ?? false,
      } as TargetingModeEffect
  }
}

/**
 * Get numeric code for effect type
 */
function getEffectTypeCode(type: EffectType): number {
  switch (type) {
    case 'highlight': return 0
    case 'floatingText': return 1
    case 'noTarget': return 2
    case 'clickWave': return 3
    case 'targetingMode': return 4
  }
}

/**
 * Get effect type from numeric code
 */
function getEffectTypeFromCode(code: number): EffectType | null {
  switch (code) {
    case 0: return 'highlight'
    case 1: return 'floatingText'
    case 2: return 'noTarget'
    case 3: return 'clickWave'
    case 4: return 'targetingMode'
    default: return null
  }
}

// ============================================================================
// EFFECTS MANAGER CLASS
// ============================================================================

export interface EffectsManagerConfig {
  onEffectAdd?: (effect: Effect) => void
  onEffectRemove?: (effectId: string) => void
}

/**
 * Manages visual effects with ID-based synchronization
 */
export class EffectsManager {
  private effects: Map<string, Effect> = new Map()
  private config: EffectsManagerConfig
  private cleanupInterval: number | null = null

  // Default TTL for auto-expiring effects (ms)
  private static readonly DEFAULT_TTL = {
    highlight: 2000,      // 2 seconds
    floatingText: 3000,   // 3 seconds
    noTarget: 1000,       // 1 second
    clickWave: 600,       // 600ms
    targetingMode: 30000, // 30 seconds (long timeout for abilities)
  }

  constructor(config: EffectsManagerConfig = {}) {
    this.config = config
    this.startCleanup()
  }

  /**
   * Add a new effect (from local action or received from network)
   * Returns true if effect was added, false if ID already exists
   */
  addEffect(effect: Effect): boolean {
    // Don't add duplicate effect IDs
    if (this.effects.has(effect.id)) {
      return false
    }

    this.effects.set(effect.id, effect)
    this.config.onEffectAdd?.(effect)
    return true
  }

  /**
   * Remove an effect by ID
   * Returns true if effect was removed, false if not found
   */
  removeEffect(effectId: string): boolean {
    const removed = this.effects.delete(effectId)
    if (removed) {
      this.config.onEffectRemove?.(effectId)
    }
    return removed
  }

  /**
   * Remove all effects for a specific player
   */
  removePlayerEffects(playerId: number): string[] {
    const removedIds: string[] = []
    for (const [id, effect] of this.effects) {
      if (effect.playerId === playerId) {
        this.effects.delete(id)
        removedIds.push(id)
        this.config.onEffectRemove?.(id)
      }
    }
    return removedIds
  }

  /**
   * Remove all effects of a specific type
   */
  removeEffectsByType(type: EffectType): string[] {
    const removedIds: string[] = []
    for (const [id, effect] of this.effects) {
      if (effect.type === type) {
        this.effects.delete(id)
        removedIds.push(id)
        this.config.onEffectRemove?.(id)
      }
    }
    return removedIds
  }

  /**
   * Clear all effects
   */
  clearAll(): void {
    const ids = Array.from(this.effects.keys())
    this.effects.clear()
    ids.forEach(id => this.config.onEffectRemove?.(id))
  }

  /**
   * Get effect by ID
   */
  getEffect(effectId: string): Effect | undefined {
    return this.effects.get(effectId)
  }

  /**
   * Get all effects
   */
  getAllEffects(): Effect[] {
    return Array.from(this.effects.values())
  }

  /**
   * Get effects by type
   */
  getEffectsByType(type: EffectType): Effect[] {
    return Array.from(this.effects.values()).filter(e => e.type === type)
  }

  /**
   * Get effects by player
   */
  getPlayerEffects(playerId: number): Effect[] {
    return Array.from(this.effects.values()).filter(e => e.playerId === playerId)
  }

  /**
   * Check if effect exists
   */
  hasEffect(effectId: string): boolean {
    return this.effects.has(effectId)
  }

  /**
   * Get effect count
   */
  getEffectCount(): number {
    return this.effects.size
  }

  /**
   * Start periodic cleanup of expired effects
   */
  private startCleanup(): void {
    this.cleanupInterval = window.setInterval(() => {
      this.cleanupExpired()
    }, 500) // Check every 500ms
  }

  /**
   * Remove expired effects
   */
  private cleanupExpired(): void {
    const now = Date.now()
    const expiredIds: string[] = []

    for (const [id, effect] of this.effects) {
      // Check explicit expiration
      if (effect.expiresAt && now > effect.expiresAt) {
        expiredIds.push(id)
        continue
      }

      // Check default TTL for each effect type
      const age = now - effect.createdAt
      const ttl = EffectsManager.DEFAULT_TTL[effect.type]
      if (age > ttl) {
        expiredIds.push(id)
      }
    }

    expiredIds.forEach(id => {
      this.effects.delete(id)
      this.config.onEffectRemove?.(id)
    })
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.clearAll()
  }
}

// ============================================================================
// CONVENIENCE FACTORIES
// ============================================================================

/**
 * Create a highlight effect
 */
export function createHighlightEffect(
  playerId: number,
  highlightType: 'row' | 'col' | 'cell',
  row?: number,
  col?: number,
  id?: string
): HighlightEffect {
  return {
    id: id ?? generateEffectId(),
    type: 'highlight',
    playerId,
    createdAt: Date.now(),
    highlightType,
    row,
    col,
  }
}

/**
 * Create a floating text effect
 */
export function createFloatingTextEffect(
  playerId: number,
  row: number,
  col: number,
  text: string,
  color?: string,
  id?: string
): FloatingTextEffect {
  return {
    id: id ?? generateEffectId(),
    type: 'floatingText',
    playerId,
    createdAt: Date.now(),
    row,
    col,
    text,
    color,
  }
}

/**
 * Create a no-target effect
 */
export function createNoTargetEffect(
  playerId: number,
  row: number,
  col: number,
  id?: string
): NoTargetEffect {
  return {
    id: id ?? generateEffectId(),
    type: 'noTarget',
    playerId,
    createdAt: Date.now(),
    row,
    col,
  }
}

/**
 * Create a click wave effect
 */
export function createClickWaveEffect(
  playerId: number,
  location: 'board' | 'hand' | 'emptyCell',
  row?: number,
  col?: number,
  handPlayerId?: number,
  handCardIndex?: number,
  id?: string
): ClickWaveEffect {
  return {
    id: id ?? generateEffectId(),
    type: 'clickWave',
    playerId,
    createdAt: Date.now(),
    location,
    row,
    col,
    handPlayerId,
    handCardIndex,
  }
}

/**
 * Create a targeting mode effect
 */
export function createTargetingModeEffect(
  playerId: number,
  mode: string,
  boardTargets: { row: number; col: number }[] = [],
  handTargets: { playerId: number; cardIndex: number }[] = [],
  isDeckSelectable = false,
  sourceRow?: number,
  sourceCol?: number,
  id?: string
): TargetingModeEffect {
  return {
    id: id ?? generateEffectId(),
    type: 'targetingMode',
    playerId,
    createdAt: Date.now(),
    mode,
    sourceRow,
    sourceCol,
    boardTargets: boardTargets.map(t => `${t.row},${t.col}`),
    handTargets: handTargets.map(t => `${t.playerId},${t.cardIndex}`),
    isDeckSelectable,
  }
}
