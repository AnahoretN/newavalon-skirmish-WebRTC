/**
 * Types for the optimized game state codec system
 * This system uses binary encoding with minimal data transfer
 */

/**
 * Message types for the new codec system
 */
export enum CodecMessageType {
  CARD_REGISTRY = 0x01,      // Send card definitions once at connection
  CARD_STATE = 0x02,          // Full game state (cards on board, hands, etc.)
  ABILITY_EFFECT = 0x03,      // Ability activation and visual effects
  SESSION_EVENT = 0x04,       // Game session events (connect, phase change, etc.)
}

/**
 * Session event subtypes
 */
export enum SessionEventType {
  PLAYER_CONNECTED = 0x01,
  PLAYER_DISCONNECTED = 0x02,
  GAME_START = 0x03,
  ROUND_START = 0x04,
  ROUND_END = 0x05,
  PHASE_CHANGE = 0x06,
  TURN_CHANGE = 0x07,
  GAME_END = 0x08,
}

/**
 * Ability effect subtypes
 */
export enum AbilityEffectType {
  HIGHLIGHT_CELL = 0x01,
  FLOATING_TEXT = 0x02,
  NO_TARGET = 0x03,
  STATUS_ADDED = 0x04,
  STATUS_REMOVED = 0x05,
  POWER_CHANGED = 0x06,
  CARD_DESTROYED = 0x07,
  TARGETING_MODE = 0x08,
  CLEAR_TARGETING = 0x09,
}

/**
 * Card flags (bit field)
 */
export const enum CardFlags {
  NONE = 0,
  IS_FACE_DOWN = 1 << 0,
  ENTERED_THIS_TURN = 1 << 1,
  REVEALED_TO_ALL = 1 << 2,
}

/**
 * Card registry - maps baseId strings to indices
 * Sent once at connection, then referenced by index
 */
export interface CardRegistry {
  baseIdToIndex: Map<string, number>
  indexToBaseId: Map<number, string>
  cardDefinitions: CardDefinitionData[]
  statusTypes: string[]  // Global status type list
}

/**
 * Minimal card definition data (sent in registry)
 */
export interface CardDefinitionData {
  baseId: string
  name: string
  imageUrl: string
  power: number
  ability: string
  types: string[]
  faction: string
}

/**
 * Encoded card reference (sent in messages)
 */
export interface EncodedCardRef {
  cardId: string        // Unique instance ID (4 bytes)
  baseIdIndex: number   // Index in registry (2 bytes)
  ownerId: number       // Player who owns it (1 byte)
  power: number         // Current power (1 byte, signed)
  flags: number         // CardFlags (1 byte)
  statusMask: number    // Status bitmask (4 bytes)
}

/**
 * Encoded board cell
 */
export interface EncodedBoardCell {
  row: number           // 0-6 (fits in 3 bits)
  col: number           // 0-6 (fits in 3 bits)
  card: EncodedCardRef | null
}

/**
 * Encoded hand card (for other players - shows card back)
 */
export interface EncodedHandCard {
  cardId: string        // Unique instance ID
  flags: number         // CardFlags (includes isFaceDown)
  statusMask: number    // Status bitmask (for reveal counters)
}

/**
 * Full encoded game state
 */
export interface EncodedGameState {
  timestamp: number
  players: EncodedPlayerState[]
  board: EncodedBoardCell[]
  currentPhase: number
  activePlayerId: number
  currentRound: number
}

/**
 * Encoded player state
 */
export interface EncodedPlayerState {
  playerId: number
  deckSize: number
  handSize: number
  discardSize: number
  scoreDelta: number    // Delta from previous value
  handCards: EncodedHandCard[]  // Only IDs + flags for other players
}
