/**
 * WebRTC Types
 *
 * Shared type definitions for WebRTC P2P functionality
 */

import type { GameState, Player, Card, Board, PlayerColor, DeckType } from '../../types'
import type { WebrtcManager as WebrtcManagerType } from '../../utils/webrtcManager'

/**
 * Message types sent over WebRTC
 */
export type WebrtcMessageType =
  | 'JOIN_REQUEST'           // Guest requests to join game
  | 'JOIN_ACCEPT'           // Host accepts guest with full state
  | 'JOIN_ACCEPT_MINIMAL'   // Host accepts guest with minimal state (size limit workaround)
  | 'PLAYER_RECONNECT'      // Guest reconnecting after page reload
  | 'PLAYER_LEAVE'          // Player is leaving
  | 'STATE_UPDATE'          // Full game state update
  | 'STATE_DELTA'           // Compact state change update
  | 'ACTION'               // Guest sends action to host
  | 'SYNC_DECK_SELECTIONS'   // Host broadcasts deck selections
  | 'CHANGE_PLAYER_DECK'    // Player changes deck selection
  | 'START_READY_CHECK'     // Host starts ready check
  | 'CANCEL_READY_CHECK'    // Host cancels ready check
  | 'PLAYER_READY'          // Player signals ready
  | 'TOGGLE_AUTO_ABILITIES' // Toggle auto-abilities
  | 'NEXT_PHASE'           // Phase transition (next)
  | 'PREV_PHASE'           // Phase transition (previous)
  | 'SET_PHASE'            // Set specific phase
  | 'TOGGLE_AUTO_DRAW'     // Toggle auto-draw
  | 'TOGGLE_ACTIVE_PLAYER'  // Toggle active player
  | 'START_NEXT_ROUND'     // Start next round
  | 'START_NEW_MATCH'       // Start new match (reset scores)
  | 'UPDATE_PLAYER_NAME'    // Player updates name
  | 'CHANGE_PLAYER_COLOR'   // Player changes color
  | 'UPDATE_PLAYER_SCORE'    // Player score update
  | 'LOAD_CUSTOM_DECK'     // Player loads custom deck
  | 'DRAW_CARD'            // Player draws card
  | 'SHUFFLE_PLAYER_DECK'  // Player shuffles deck
  | 'PLAY_CARD'            // Play card from hand
  | 'MOVE_CARD'            // Move card (drag/drop)
  | 'RETURN_CARD_TO_HAND'  // Return card to hand
  | 'ANNOUNCE_CARD'        // Announce card from hand
  | 'END_TURN'            // End current turn
  | 'PLAY_COUNTER'         // Play counter from hand
  | 'PLAY_TOKEN'           // Play token from tokens
  | 'DESTROY_CARD'         // Destroy card
  | 'ADD_COMMAND'          // Add pending command
  | 'CANCEL_COMMAND'       // Cancel pending command
  | 'EXECUTE_COMMAND'      // Execute pending command
  | 'RESET_DEPLOY_STATUS'   // Reset deploy status
  | 'TRIGGER_HIGHLIGHT'    // Visual effect: highlight cells
  | 'TRIGGER_NO_TARGET'     // Visual effect: no-target overlay
  | 'TRIGGER_FLOATING_TEXT' // Visual effect: floating text
  | 'SYNC_HIGHLIGHTS'      // Sync highlights to all
  | 'SYNC_VALID_TARGETS'   // Sync valid targets
  | 'SET_TARGETING_MODE'    // Set targeting mode
  | 'CLEAR_TARGETING_MODE'  // Clear targeting mode
  | 'TRIGGER_DECK_SELECTION'     // Host signals deck selection
  | 'TRIGGER_HAND_CARD_SELECTION' // Host signals hand card selection
  | 'REVEAL_REQUEST'       // Request to reveal cards
  | 'CHAT'                // Chat message (future)
  | 'HOST_READY'           // Host signals ready
  | 'GAME_RESET'           // Reset game to lobby
  | 'ERROR'                // Error message

export interface WebrtcMessage {
  type: WebrtcMessageType
  senderId?: string | null     // Peer ID of sender
  playerId?: number          // Game player ID of sender
  data?: any             // Message-specific data
  timestamp: number
}

/**
 * Connection event types for WebRTC
 */
export type WebrtcConnectionEvent =
  | 'peer_open'            // Peer is ready, peerId available
  | 'peer_closed'          // Peer connection closed
  | 'guest_connected'      // Host: New guest connected
  | 'guest_disconnected'   // Host or Guest: Connection lost
  | 'connected_to_host'     // Guest: Successfully connected to host
  | 'host_disconnected'    // Guest: Host disconnected
  | 'message_received'     // Received any message
  | 'error'               // Error occurred

export interface WebrtcConnectionEventData {
  type: WebrtcConnectionEvent
  data?: any
}

/**
 * Reconnection data stored in localStorage
 */
export interface ReconnectionData {
  hostPeerId: string
  playerId: number | null
  gameState: GameState | null
  timestamp: number
  isHost: boolean
}

/**
 * Host-specific types
 */
export interface HostConfig {
  autoReconnectTimeout: number  // ms before auto-reconnecting
  maxReconnectAttempts: number
  connectionTimeout: number     // ms before connection timeout
}

/**
 * Guest-specific types
 */
export interface GuestConfig {
  reconnectDelay: number         // ms before reconnect attempt
  maxReconnectAttempts: number
  connectionTimeout: number      // ms before connection timeout
}
