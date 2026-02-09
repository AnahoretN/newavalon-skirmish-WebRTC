/**
 * Host Module Types
 * Type definitions for WebRTC host functionality
 */

import type { GameState, Player, StateDelta } from '../types'

// Message types for WebRTC communication
export type WebrtcMessageType =
  | 'JOIN_REQUEST'         // Guest requests to join
  | 'JOIN_ACCEPT'          // Host accepts guest, sends current state
  | 'JOIN_ACCEPT_MINIMAL'  // Host accepts guest with minimal info (to avoid size limit)
  | 'STATE_UPDATE'         // Host broadcasts full state update
  | 'STATE_DELTA'          // Compact state change broadcast
  | 'ACTION'               // Guest sends action to host
  | 'PLAYER_LEAVE'         // Player is leaving
  | 'PLAYER_RECONNECT'     // Guest reconnecting after page reload
  | 'CHAT'                 // Chat message (optional future feature)
  | 'START_READY_CHECK'    // Host starts ready check
  | 'CANCEL_READY_CHECK'   // Host cancels ready check
  | 'PLAYER_READY'         // Guest signals ready
  | 'HOST_READY'           // Host signals ready
  | 'GAME_START'           // Host starts the game
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
  // Ability activation messages
  | 'ABILITY_ACTIVATED'    // Player activated an ability (guest -> host)
  | 'ABILITY_MODE_SET'     // Host broadcasts ability mode to all
  | 'ABILITY_COMPLETED'    // Ability execution completed
  | 'ABILITY_TARGET_SELECTED' // Target selected for ability
  | 'ABILITY_CANCELLED'    // Ability was cancelled
  // Reconnection messages
  | 'RECONNECT_REQUEST'    // Guest requests reconnection after disconnect
  | 'RECONNECT_ACCEPT'     // Host accepts reconnection, sends current state
  | 'RECONNECT_REJECT'     // Host rejects reconnection (timeout/game over)
  | 'PLAYER_DISCONNECTED'  // Host broadcasts player disconnected
  | 'PLAYER_RECONNECTED'   // Host broadcasts player reconnected
  | 'PLAYER_CONVERTED_TO_DUMMY' // Host broadcasts player converted to dummy

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
