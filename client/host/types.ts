/**
 * Host Module Types
 * Type definitions for WebRTC host functionality
 */

// Types are imported from other modules where needed

// Message types for WebRTC communication
// Unified type from both WebrtcManager and host/types.ts
export type WebrtcMessageType =
  | 'JOIN_REQUEST'         // Guest requests to join
  | 'JOIN_ACCEPT'          // Host accepts guest, sends current state
  | 'JOIN_ACCEPT_MINIMAL'  // Host accepts guest with minimal info (to avoid size limit)
  | 'JOIN_ACCEPT_BINARY'   // Host accepts guest with binary optimized state
  | 'STATE_UPDATE'         // Host broadcasts full state update
  | 'STATE_UPDATE_COMPACT' // Compact state with card IDs only (reduces size) - LEGACY
  | 'STATE_UPDATE_COMPACT_JSON' // Compact state with registry indices - NEW
  | 'STATE_DELTA'          // Compact state change broadcast (JSON)
  | 'STATE_DELTA_BINARY'   // Compact state change broadcast (MessagePack - OPTIMIZED)
  | 'ACTION'               // Guest sends action to host
  | 'PLAYER_LEAVE'         // Player is leaving
  | 'PLAYER_RECONNECT'     // Guest reconnecting after page reload
  | 'CHAT'                 // Chat message (optional future feature)
  | 'START_READY_CHECK'    // Host starts ready check
  | 'CANCEL_READY_CHECK'   // Host cancels ready check
  | 'PLAYER_READY'         // Guest signals ready
  | 'HOST_READY'           // Host signals ready
  | 'GAME_START'           // Host starts the game
  | 'GAME_RESET'           // Reset game to lobby state
  | 'ASSIGN_TEAMS'         // Host assigns teams
  | 'SET_GAME_MODE'        // Host sets game mode
  | 'SET_GAME_PRIVACY'     // Host sets game privacy
  | 'NEXT_PHASE'           // Phase transition
  | 'PREV_PHASE'           // Phase transition
  | 'SET_PHASE'            // Phase transition
  | 'UPDATE_PLAYER_NAME'   // Player settings update
  | 'CHANGE_PLAYER_COLOR'  // Player settings update
  | 'UPDATE_PLAYER_SCORE'  // Player settings update
  | 'CHANGE_PLAYER_DECK'   // Player settings update
  | 'CUSTOM_DECK_DATA'     // Guest sends custom deck cards to host
  | 'SYNC_DECK_SELECTIONS'  // Sync deck selections between all players
  | 'TOGGLE_ACTIVE_PLAYER' // Toggle active player
  | 'TOGGLE_AUTO_DRAW'     // Toggle auto draw
  | 'START_NEXT_ROUND'     // Start next round
  | 'RESET_DEPLOY_STATUS'  // Reset deploy status
  // Visual effects messages (rebroadcast by host to all guests)
  | 'TRIGGER_HIGHLIGHT'    // Highlight a cell on the board
  | 'TRIGGER_FLOATING_TEXT'// Show floating text
  | 'TRIGGER_FLOATING_TEXT_BATCH' // Show multiple floating texts
  | 'TRIGGER_NO_TARGET'    // Show "no target" overlay
  | 'SET_TARGETING_MODE'   // Set targeting/selection mode for ability
  | 'CLEAR_TARGETING_MODE' // Clear targeting mode
  | 'SYNC_VALID_TARGETS'   // Sync valid targets for ability
  | 'TRIGGER_DECK_SELECTION' // Trigger deck selection
  | 'TRIGGER_HAND_CARD_SELECTION' // Trigger hand card selection
  | 'TRIGGER_CLICK_WAVE'     // Trigger click wave effect
  | 'CLICK_WAVE_TRIGGERED'   // Click wave was triggered
  // Ability activation messages
  | 'ABILITY_ACTIVATED'    // Player activated an ability (guest -> host)
  | 'ABILITY_MODE_SET'     // Host broadcasts ability mode to all
  | 'ABILITY_COMPLETED'    // Ability execution completed
  | 'ABILITY_TARGET_SELECTED' // Target selected for ability
  | 'ABILITY_CANCELLED'    // Ability was cancelled
  | 'ACTIVE_PLAYER_CHANGED' // Active player changed notification
  // Reconnection messages
  | 'RECONNECT_REQUEST'    // Guest requests reconnection after disconnect
  | 'RECONNECT_ACCEPT'     // Host accepts reconnection, sends current state
  | 'RECONNECT_REJECT'     // Host rejects reconnection (timeout/game over)
  | 'PLAYER_DISCONNECTED'  // Host broadcasts player disconnected
  | 'PLAYER_RECONNECTED'   // Host broadcasts player reconnected
  | 'PLAYER_CONVERTED_TO_DUMMY' // Host broadcasts player converted to dummy
  | 'RECONNECT_SNAPSHOT'   // Snapshot for reconnection
  | 'HIGHLIGHT_TRIGGERED'  // Highlight was triggered
  | 'FLOATING_TEXT_TRIGGERED' // Floating text was triggered
  | 'FLOATING_TEXT_BATCH_TRIGGERED' // Batch floating text was triggered
  | 'NO_TARGET_TRIGGERED'  // No target overlay was triggered
  | 'DECK_SELECTION_TRIGGERED' // Deck selection was triggered
  | 'HAND_CARD_SELECTION_TRIGGERED' // Hand card selection was triggered
  | 'TARGET_SELECTION_TRIGGERED' // Target selection was triggered
  | 'HIGHLIGHTS_SYNC'      // Sync highlights
  | 'CLEAR_ALL_EFFECTS'    // Clear all effects
  | 'VALID_TARGETS_SYNC'   // Sync valid targets
  // Deck view messages
  | 'REQUEST_DECK_VIEW'    // Request to view another player's deck
  | 'DECK_VIEW_DATA'       // Response with full deck data
  | 'DECK_DATA_UPDATE'     // Guest sends their full deck data to host (for deck view)
  | 'REQUEST_DECK_DATA'    // Host requests deck data from guests after F5 restore
  | 'HOST_DECK_DATA'       // Host shares their deck data with all guests (for deck view sync)
  | 'GAME_LOGS'            // Game logs for debugging
  // New codec system messages (binary format)
  | 'CARD_REGISTRY'        // Card definitions registry (sent once per connection) - BINARY
  | 'CARD_REGISTRY_JSON'   // Card definitions registry (sent once per connection) - JSON COMPACT
  | 'CARD_STATE'           // Game state update (cards, board, players)
  | 'ABILITY_EFFECT'       // Visual/ability effects
  | 'SESSION_EVENT'        // Session events (connect, disconnect, phase change, etc.)
  // Card status synchronization (optimized - only changed statuses)
  | 'CARD_STATUS_SYNC'     // Sync card status changes (readyDeploy, setupUsedThisTurn, etc.)
  // Board card synchronization (optimized - only card data on board)
  | 'BOARD_CARD_SYNC'      // Sync board cards (cardId, row, col, statuses, power, etc.)

export interface WebrtcMessage {
  type: WebrtcMessageType
  senderId?: string | null     // Peer ID of sender
  playerId?: number     // Game player ID
  data?: any            // Message-specific data
  timestamp: number
}

export interface WebrtcConnectionInfo {
  peerId: string
  playerId: number | null
  playerName: string | null
  connected: boolean
}

// Events that the host manager can emit
export type WebrtcEventType =
  | 'peer_open'         // Host: Peer is ready, peerId available
  | 'peer_closed'       // Peer connection closed
  | 'guest_connected'   // Host: New guest connected
  | 'guest_disconnected'// Host or Guest: Connection lost
  | 'connected_to_host' // Guest: Successfully connected to host
  | 'host_disconnected' // Guest: Host disconnected
  | 'message_received'  // Received any message
  | 'error'             // Error occurred

export interface WebrtcEvent {
  type: WebrtcEventType
  data?: any
}

export type WebrtcEventHandler = (event: WebrtcEvent) => void

/**
 * Card status change for CARD_STATUS_SYNC message
 * Only sends the minimal data needed to update a card's status
 */
export interface CardStatusChange {
  cardId: string          // Unique card ID
  statusType: string      // Status type (e.g., 'readyDeploy', 'setupUsedThisTurn')
  action: 'add' | 'remove' // Whether to add or remove the status
  ownerId?: number        // Owner ID for the status
}

/**
 * Board card data for BOARD_CARD_SYNC message
 * Only sends essential data about a card on the board
 * Optimized to minimize message size for WebRTC
 */
export interface BoardCardData {
  cardId: string          // Unique card ID
  baseId: string          // Base ID for looking up card definition
  row: number             // Board row (0-5)
  col: number             // Board column (0-5)
  power: number           // Current power (may be modified by statuses)
  ownerId: number         // Player who owns the card
  enteredThisTurn: boolean // Whether card entered the board this turn
  // Statuses - array of status objects with minimal data
  statuses: Array<{
    type: string          // Status type (Stun, Support, Threat, etc.)
    addedByPlayerId: number // Player who added the status
  }>
}

/**
 * Board card sync message
 * Contains multiple board card updates for efficient synchronization
 */
export interface BoardCardSyncMessage {
  cards: BoardCardData[]  // Array of card data
  action: 'update' | 'remove' | 'replace' // What to do with the data
  timestamp: number       // For ordering
}

/**
 * Host configuration
 */
export interface HostConfig {
  maxGuests?: number
  autoAcceptGuests?: boolean
  enableReconnection?: boolean
}

/**
 * Guest connection data
 */
export interface GuestConnection {
  peerId: string
  playerId: number | null
  playerName: string | null
  connected: boolean
  connectedAt?: number
}

/**
 * Message handler type for processing incoming messages
 */
export type MessageHandler = (message: WebrtcMessage, fromPeerId: string) => void

/**
 * State broadcast options
 */
export interface BroadcastOptions {
  excludePeerId?: string
  includeDelta?: boolean
}

// ============================================================================
// Ability Mode Types
// ============================================================================

/**
 * Ability activation data - sent when player clicks on a card to activate ability
 */
export interface AbilityActivatedData {
  playerId: number        // Player who activated
  cardId: string          // ID of the card
  cardName: string        // Name of the card (for logging)
  coords: { row: number, col: number }  // Board coordinates
  abilityType: 'deploy' | 'setup' | 'commit'  // Which ability was activated
  timestamp: number
}

/**
 * Ability mode data - broadcast by host to all clients
 * Contains targeting mode info for visual rendering
 */
export interface AbilityModeData {
  playerId: number        // Player whose turn it is to select
  sourceCardId: string    // Card using the ability
  sourceCardName: string  // For logging
  sourceCoords: { row: number, col: number }
  mode: string            // RIOT_PUSH, SELECT_TARGET, etc.
  actionType?: string     // DESTROY, MOVE, etc.
  filterType?: string     // Filter for valid targets
  timestamp: number
}

/**
 * Target selected data - sent when player selects a target
 */
export interface TargetSelectedData {
  playerId: number        // Player who selected
  sourceCoords: { row: number, col: number }
  targetCoords: { row: number, col: number } | null  // Null for empty cell
  targetCardId: string | null
  timestamp: number
}

/**
 * Ability completed data - sent when ability execution finishes
 */
export interface AbilityCompletedData {
  playerId: number
  sourceCoords: { row: number, col: number }
  success: boolean
  timestamp: number
}
