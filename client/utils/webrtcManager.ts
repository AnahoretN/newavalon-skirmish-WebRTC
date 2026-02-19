/**
 * WebRTC Manager - Handles peer-to-peer connections using PeerJS
 *
 * Architecture:
 * - Host: Creates Peer, accepts connections, broadcasts game state to all guests
 * - Guest: Connects to host, sends actions, receives game state updates
 *
 * Data flow:
 * Guest --> Host --> Broadcast to all guests
 *
 * OPTIMIZATIONS:
 * - MessagePack binary serialization (smaller than JSON)
 * - Compressed delta format with short keys
 * - Card serialization by reference (id + stats only)
 *
 * @note For new host-specific functionality, consider using the HostManager module
 *       located in '../host' which provides better separation of concerns.
 */

import { Peer, DataConnection } from 'peerjs'
import type { GameState, StateDelta } from '../types'
import { logger } from './logger'
import {
  serializeDelta,
  serializeDeltaBase64,
  serializeGameState,
  logSerializationStats
} from './webrtcSerialization'
import { encodeAbilityEffect, type AbilityEffectType } from './abilityMessages'
import { encodeSessionEvent } from './sessionMessages'

// Enable/disable optimized serialization (can be toggled for debugging)
const USE_OPTIMIZED_SERIALIZATION = true

// Message types for WebRTC communication
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
  | 'CUSTOM_DECK_DATA'     // Guest sends custom deck cards to host (before game start)
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
  // New codec system messages (binary format)
  | 'CARD_REGISTRY'        // Card definitions registry (sent once per connection) - BINARY
  | 'CARD_REGISTRY_JSON'   // Card definitions registry (sent once per connection) - JSON COMPACT
  | 'CARD_STATE'           // Game state update (cards, board, players)
  | 'ABILITY_EFFECT'       // Visual/ability effects
  | 'SESSION_EVENT'        // Session events (connect, disconnect, phase change, etc.)
  // Deck view messages
  | 'REQUEST_DECK_VIEW'    // Request to view another player's deck
  | 'DECK_VIEW_DATA'       // Response with full deck data
  | 'DECK_DATA_UPDATE'     // Guest sends their full deck data to host (for deck view)
  | 'REQUEST_DECK_DATA'    // Host requests deck data from guests after F5 restore
  | 'GAME_LOGS'            // Game logs for debugging

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

// Events that the manager can emit
export type WebrtcEventType =
  | 'peer_open'         // Host: Peer is ready, peerId available
  | 'peer_closed'       // Peer connection closed
  | 'guest_connected'   // Host: New guest connected
  | 'guest_disconnected' // Host or Guest: Connection lost
  | 'connected_to_host' // Guest: Successfully connected to host
  | 'host_disconnected' // Guest: Host disconnected
  | 'message_received'  // Received any message
  | 'error'             // Error occurred

export interface WebrtcEvent {
  type: WebrtcEventType
  data?: any
}

export type WebrtcEventHandler = (event: WebrtcEvent) => void

export class WebrtcManager {
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private isHost: boolean = false
  private hostConnection: DataConnection | null = null
  private eventHandlers: Set<WebrtcEventHandler> = new Set()
  public isReconnecting: boolean = false
  // Track which player ID each guest connection belongs to (for personalized state)
  private guestPlayerIds: Map<string, number> = new Map()
  // Reserved for future reconnection logic
  // private reconnectAttempts: number = 0
  // private maxReconnectAttempts: number = 5

  constructor() {
    // Check localStorage for WebRTC preference
    const webrtcEnabled = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcEnabled) {
      logger.info('WebRTC mode is disabled')
    }
  }

  /**
   * Initialize as Host - creates Peer and waits for connections
   * @param existingPeerId - If provided, try to reuse this peerId (for F5 restore)
   */
  async initializeAsHost(existingPeerId?: string): Promise<string> {
    if (this.peer) {
      this.cleanup()
    }

    this.isHost = true
    logger.info('Initializing WebRTC as Host...' + (existingPeerId ? ` with existing peerId: ${existingPeerId}` : ''))

    return new Promise((resolve, reject) => {
      // Create Peer with default PeerJS cloud server
      // If existingPeerId is provided, try to reuse it (for F5 restore)
      this.peer = existingPeerId ? new Peer(existingPeerId) : new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`WebRTC Host initialized with peerId: ${peerId}`)
        this.emitEvent({ type: 'peer_open', data: { peerId } })
        resolve(peerId)
      })

      this.peer.on('connection', (conn) => {
        logger.info(`Guest connection request from: ${conn.peer}`)
        this.handleGuestConnection(conn)
      })

      this.peer.on('error', (err) => {
        logger.error(`WebRTC Peer error:`, err)
        this.emitEvent({ type: 'error', data: err })
        reject(err)
      })

      this.peer.on('close', () => {
        logger.warn('WebRTC Peer closed')
        this.emitEvent({ type: 'peer_closed' })
      })
    })
  }

  /**
   * Initialize as Guest - connects to host
   */
  async initializeAsGuest(hostPeerId: string): Promise<void> {
    if (this.peer) {
      this.cleanup()
    }

    this.isHost = false
    logger.info(`Initializing WebRTC as Guest, connecting to host: ${hostPeerId}`)

    return new Promise((resolve, reject) => {
      // Create Peer for guest
      this.peer = new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`WebRTC Guest initialized with peerId: ${peerId}`)

        // Connect to host
        const conn = this.peer!.connect(hostPeerId, {
          reliable: true,
          serialization: 'json'
        })

        this.setupHostConnection(conn)

        conn.on('open', () => {
          logger.info(`Connected to host: ${hostPeerId}`)
          this.hostConnection = conn
          this.emitEvent({ type: 'connected_to_host', data: { hostPeerId } })

          // Send join request with deck preference
          // Try to get deck preference from localStorage (stored when player selects deck)
          let preferredDeck: string | null = null
          try {
            const deckPreference = localStorage.getItem('webrtc_preferred_deck')
            if (deckPreference) {
              preferredDeck = deckPreference
              logger.info(`[initializeAsGuest] Found deck preference in localStorage: ${preferredDeck}`)
              // Clear after use so it doesn't persist incorrectly
              localStorage.removeItem('webrtc_preferred_deck')
            }
          } catch (e) {
            logger.warn('[initializeAsGuest] Failed to read deck preference:', e)
          }

          this.sendMessageToHost({
            type: 'JOIN_REQUEST',
            senderId: peerId,
            data: {
              preferredDeck: preferredDeck || undefined
            },
            timestamp: Date.now()
          })

          resolve()
        })

        conn.on('error', (err) => {
          logger.error('Host connection error:', err)
          this.emitEvent({ type: 'error', data: err })
          reject(err)
        })
      })

      this.peer.on('error', (err) => {
        logger.error(`WebRTC Peer error:`, err)
        this.emitEvent({ type: 'error', data: err })
        reject(err)
      })
    })
  }

  /**
   * Initialize as Guest after page reload - connects to host with reconnection message
   */
  async initializeAsReconnectingGuest(hostPeerId: string, playerId: number): Promise<void> {
    if (this.peer) {
      this.cleanup()
    }

    this.isHost = false
    this.isReconnecting = true
    logger.info(`Initializing WebRTC as Reconnecting Guest, connecting to host: ${hostPeerId}, playerId: ${playerId}`)

    return new Promise((resolve, reject) => {
      // Create Peer for guest
      this.peer = new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`WebRTC Reconnecting Guest initialized with peerId: ${peerId}`)

        // Connect to host
        const conn = this.peer!.connect(hostPeerId, {
          reliable: true,
          serialization: 'json'
        })

        this.setupHostConnection(conn)

        conn.on('open', () => {
          logger.info(`Connected to host for reconnection: ${hostPeerId}`)
          this.hostConnection = conn
          this.emitEvent({ type: 'connected_to_host', data: { hostPeerId } })

          // Send PLAYER_RECONNECT instead of JOIN_REQUEST
          this.sendMessageToHost({
            type: 'PLAYER_RECONNECT',
            senderId: peerId,
            playerId: playerId,
            timestamp: Date.now()
          })

          this.isReconnecting = false
          resolve()
        })

        conn.on('error', (err) => {
          logger.error('Host connection error:', err)
          this.emitEvent({ type: 'error', data: err })
          this.isReconnecting = false
          reject(err)
        })
      })

      this.peer.on('error', (err) => {
        logger.error(`WebRTC Peer error:`, err)
        this.emitEvent({ type: 'error', data: err })
        this.isReconnecting = false
        reject(err)
      })
    })
  }

  /**
   * Handle incoming guest connection (host only)
   */
  private handleGuestConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn)

    conn.on('open', () => {
      logger.info(`Guest connected: ${conn.peer}`)
      this.emitEvent({
        type: 'guest_connected',
        data: { peerId: conn.peer }
      })
    })

    conn.on('data', (data: unknown) => {
      this.handleMessage(data as WebrtcMessage, conn)
    })

    conn.on('close', () => {
      logger.info(`Guest disconnected: ${conn.peer}`)
      this.connections.delete(conn.peer)
      this.emitEvent({
        type: 'guest_disconnected',
        data: { peerId: conn.peer }
      })
    })

    conn.on('error', (err) => {
      logger.error(`Guest connection error (${conn.peer}):`, err)
    })
  }

  /**
   * Setup host connection handlers (guest only)
   */
  private setupHostConnection(conn: DataConnection): void {
    this.hostConnection = conn

    conn.on('data', (data: unknown) => {
      this.handleMessage(data as WebrtcMessage, conn)
    })

    conn.on('close', () => {
      logger.warn('Host disconnected')
      this.hostConnection = null
      this.emitEvent({ type: 'host_disconnected' })
    })

    conn.on('error', (err) => {
      logger.error('Host connection error:', err)
    })
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: WebrtcMessage, _conn: DataConnection): void {
    logger.debug('Received WebRTC message:', message.type)
    this.emitEvent({
      type: 'message_received',
      data: message
    })
  }

  /**
   * Send message to host (guest only)
   */
  sendMessageToHost(message: WebrtcMessage): boolean {
    if (!this.isHost && this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send(message)
        // Log successful send for targeting mode messages (debugging)
        if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
          logger.info(`[WebrtcManager] Sent ${message.type} to host`, {
            hasData: !!message.data,
            hasTargetingMode: !!message.data?.targetingMode,
            targetingModePlayerId: message.data?.targetingMode?.playerId
          })
        }
        return true
      } catch (err) {
        logger.error('Failed to send message to host:', err)
        return false
      }
    }
    // Log if message couldn't be sent
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
      logger.warn(`[WebrtcManager] Could not send ${message.type} to host`, {
        isHost: this.isHost,
        hasHostConnection: !!this.hostConnection,
        isConnectionOpen: this.hostConnection?.open ?? false
      })
    }
    return false
  }

  /**
   * Broadcast message to all connected guests (host only)
   */
  broadcastToGuests(message: WebrtcMessage, excludePeerId?: string): number {
    if (!this.isHost) {
      logger.warn('Only host can broadcast to guests')
      return 0
    }

    let successCount = 0
    this.connections.forEach((conn, peerId) => {
      if (conn.open && peerId !== excludePeerId) {
        try {
          conn.send(message)
          successCount++
        } catch (err) {
          logger.error(`Failed to send to guest ${peerId}:`, err)
        }
      }
    })

    logger.debug(`Broadcast to ${successCount}/${this.connections.size} guests`)
    return successCount
  }

  /**
   * Send message to specific guest (host only)
   */
  sendToGuest(peerId: string, message: WebrtcMessage): boolean {
    if (!this.isHost) {
      logger.warn('Only host can send to specific guest')
      return false
    }

    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[sendToGuest] No connection found for guest ${peerId}. Available connections: ${Array.from(this.connections.keys()).join(', ')}`)
      return false
    }
    if (!conn.open) {
      logger.error(`[sendToGuest] Connection for guest ${peerId} is not open`)
      return false
    }

    try {
      conn.send(message)
      logger.debug(`Sent message to guest ${peerId}`)
      return true
    } catch (err) {
      logger.error(`[sendToGuest] Failed to send message to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Host accepts guest and sends current game state
   * OPTIMIZED: Uses binary serialization for smaller message size
   */
  acceptGuest(peerId: string, gameState: GameState, playerId: number): void {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[acceptGuest] No connection found for guest ${peerId}. Available connections: ${Array.from(this.connections.keys()).join(', ')}`)
      return
    }
    if (!conn.open) {
      logger.error(`[acceptGuest] Connection for guest ${peerId} is not open`)
      return
    }

    try {
      if (USE_OPTIMIZED_SERIALIZATION) {
        // Use optimized binary serialization
        const binaryData = serializeGameState(gameState, null)
        const message: WebrtcMessage = {
          type: 'JOIN_ACCEPT_BINARY',
          senderId: this.peer?.id,
          playerId: playerId,
          data: binaryData,
          timestamp: Date.now()
        }
        conn.send(message)
        logger.info(`Accepted guest ${peerId} as player ${playerId} (BINARY, ${binaryData.byteLength} bytes)`)
      } else {
        // Fallback to JSON
        const message: WebrtcMessage = {
          type: 'JOIN_ACCEPT',
          senderId: this.peer?.id,
          playerId: playerId,
          data: { gameState },
          timestamp: Date.now()
        }
        conn.send(message)
        logger.info(`Accepted guest ${peerId} as player ${playerId}`)
      }
    } catch (err) {
      logger.error(`[acceptGuest] Failed to send JOIN_ACCEPT to ${peerId}:`, err)
    }
  }

  /**
   * Accept guest with minimal game info (to avoid message size limit)
   */
  acceptGuestMinimal(peerId: string, minimalInfo: any, playerId: number): void {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[acceptGuestMinimal] No connection found for guest ${peerId}. Available connections: ${Array.from(this.connections.keys()).join(', ')}`)
      return
    }
    if (!conn.open) {
      logger.error(`[acceptGuestMinimal] Connection for guest ${peerId} is not open`)
      return
    }
    // Track player ID for this guest (for personalized state broadcasting)
    this.guestPlayerIds.set(peerId, playerId)

    const message: WebrtcMessage = {
      type: 'JOIN_ACCEPT_MINIMAL',
      senderId: this.peer?.id,
      playerId: playerId,
      data: minimalInfo,
      timestamp: Date.now()
    }
    try {
      conn.send(message)
      logger.info(`Accepted guest ${peerId} as player ${playerId} (minimal)`)
    } catch (err) {
      logger.error(`[acceptGuestMinimal] Failed to send JOIN_ACCEPT_MINIMAL to ${peerId}:`, err)
    }
  }

  /**
   * Broadcast game state to all guests (host only)
   * Uses legacy format with baseId strings (all players have same card database)
   */
  broadcastGameState(gameState: GameState, excludePeerId?: string): void {
    this.broadcastGameStateLegacy(gameState, excludePeerId)
  }

  /**
   * Broadcast game state using legacy format with baseId strings
   */
  private broadcastGameStateLegacy(gameState: GameState, excludePeerId?: string): void {
    let successCount = 0

    this.connections.forEach((conn, peerId) => {
      if (!conn.open || peerId === excludePeerId) {
        return
      }

      // Get the player ID for this guest
      const recipientPlayerId = this.guestPlayerIds.get(peerId) ?? null

      // Create personalized optimized state for this player
      const personalizedState = WebrtcManager.createPersonalizedGameState(gameState, recipientPlayerId)

      const message: WebrtcMessage = {
        type: 'STATE_UPDATE_COMPACT', // Legacy message type
        senderId: this.peer?.id,
        data: {
          gameState: personalizedState,
          recipientPlayerId,
        },
        timestamp: Date.now()
      }

      try {
        conn.send(message)
        successCount++
      } catch (err) {
        logger.error(`[broadcastGameStateLegacy] Failed to send to guest ${peerId} (player ${recipientPlayerId}):`, err)
      }
    })

    logger.debug(`[broadcastGameStateLegacy] Sent to ${successCount}/${this.connections.size} guests`)
  }

  /**
   * Create personalized game state for a specific player
   * - Player sees their own full hand (as card IDs only for size)
   * - Other players' hands are sent as card backs only
   * - Board cards are visible to all (with proper face up/down status)
   * - Decks/discard are sent as card IDs for own player (size optimization)
   */
  private static createPersonalizedGameState(gameState: GameState, recipientPlayerId: number | null): GameState {
    return {
      ...gameState,
      players: gameState.players.map(p => {
        const isOwnHand = recipientPlayerId !== null && p.id === recipientPlayerId

        if (isOwnHand) {
          // Send COMPACT CARD DATA (id + baseId) for own player's hand, deck, discard
          // This allows the guest to reconstruct full cards from their local contentDatabase
          const deckSize = p.deck.length ?? 0
          const discardSize = p.discard.length ?? 0
          const handSize = p.hand.length ?? 0

          logger.debug(`[createPersonalizedGameState] Player ${p.id} (own): ${handSize} hand, ${deckSize} deck, ${discardSize} discard`)
          return {
            ...p,
            // Send compact card data with baseId - client can reconstruct using getCardDefinition(baseId)
            handCards: p.hand.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            deckCards: p.deck.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            discardCards: p.discard.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            // Don't send full arrays to avoid size limit
            hand: [],
            deck: [],
            discard: [],
            // Include minimal announced card info
            announcedCard: p.announcedCard ? WebrtcManager.optimizeCard(p.announcedCard) : null,
            // Always use actual array lengths for own player
            deckSize: deckSize,
            discardSize: discardSize,
            handSize: handSize
          }
        } else {
          // Send card data for other players
          // - Revealed cards (isFaceDown=false) are sent as compact data for viewing
          // - Face-down cards are sent as card backs
          const deckSize = p.deckSize ?? p.deck.length ?? 0
          // Count revealed cards for debug logging
          const revealedCount = p.hand.filter((c: any) => !c.isFaceDown).length
          if (revealedCount > 0) {
            logger.debug(`[createPersonalizedGameState] Player ${p.id} (other): ${revealedCount} revealed, ${p.hand.length - revealedCount} face-down`)
          }
          return {
            ...p,
            hand: p.hand.map((card: any) => {
              // If card is revealed, send compact data (id + baseId + stats) so others can see it
              if (!card.isFaceDown) {
                return {
                  id: card.id,
                  baseId: card.baseId,
                  power: card.power,
                  powerModifier: card.powerModifier || 0,
                  isFaceDown: card.isFaceDown,
                  statuses: card.statuses || [],
                  // Include minimal owner info for display
                  ownerId: card.ownerId,
                  ownerName: card.ownerName,
                  deck: card.deck
                }
              }
              // Face-down card - send card back
              return WebrtcManager.createCardBack(card)
            }),
            deck: [],
            discard: [],
            announcedCard: p.announcedCard ? WebrtcManager.createCardBack(p.announcedCard) : null,
            // Keep size information for UI display (use stored size if available, fallback to array length)
            deckSize: deckSize,
            handSize: p.handSize ?? p.hand.length ?? 0,
            discardSize: p.discardSize ?? p.discard.length ?? 0
          }
        }
      }),
      // Optimize board cards - remove heavy fields but keep all gameplay data
      board: gameState.board.map(row =>
        row.map(cell => ({
          ...cell,
          card: cell.card ? WebrtcManager.optimizeCard(cell.card) : null
        }))
      ) as any
    }
  }

  /**
   * Create compact state for guest to send to host
   * - Send minimal card data (id + baseId + essential stats) for local player
   * - Host will reconstruct full cards using baseId from contentDatabase
   * - Send minimal data for other players (host already has their data)
   */
  private static createCompactStateForHost(gameState: GameState, localPlayerId: number): GameState {
    return {
      ...gameState,
      players: gameState.players.map(p => {
        if (p.id === localPlayerId) {
          // Local player - send compact card data (id + baseId for reconstruction)
          logger.debug(`[createCompactStateForHost] Player ${p.id} (local): sending ${p.hand.length} hand cards, ${p.deck.length} deck cards`)
          return {
            ...p,
            // Send compact card data - host can reconstruct from baseId
            handCards: p.hand.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            deckCards: p.deck.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            discardCards: p.discard.map((c: any) => ({
              id: c.id,
              baseId: c.baseId,
              power: c.power,
              powerModifier: c.powerModifier,
              isFaceDown: c.isFaceDown,
              statuses: c.statuses || []
            })),
            // Don't send full arrays
            hand: [],
            deck: [],
            discard: [],
            // Include sizes for quick access
            handSize: p.hand.length,
            deckSize: p.deck.length,
            discardSize: p.discard.length
          }
        } else {
          // Other players - send hand cards that have statuses (modified by guest)
          // This is needed when guest places Revealed tokens on other players' cards
          const handCardsWithStatuses = p.hand.filter((c: any) => c.statuses && c.statuses.length > 0)
          const shouldSendHandCards = handCardsWithStatuses.length > 0

          const compactPlayer = {
            ...p,
            // Send only hand cards that have been modified (have statuses)
            ...(shouldSendHandCards && {
              handCards: p.hand.map((c: any) => ({
                id: c.id,
                baseId: c.baseId,
                power: c.power,
                powerModifier: c.powerModifier || 0,
                isFaceDown: c.isFaceDown,
                statuses: c.statuses || []
              }))
            }),
            hand: [],
            deck: [],
            discard: [],
            announcedCard: null,
            deckSize: p.deckSize ?? p.deck.length ?? 0,
            handSize: p.handSize ?? p.hand.length ?? 0,
            discardSize: p.discardSize ?? p.discard.length ?? 0
          }
          // Log score for debugging - CRITICAL for verifying score sync
          if (p.id === localPlayerId) {
            logger.info(`[createCompactStateForHost] Local player ${p.id} score: ${p.score}`)
          } else {
            logger.info(`[createCompactStateForHost] Other player ${p.id} score: ${compactPlayer.score} (from original)`)
          }
          return compactPlayer
        }
      }),
      // Include minimal board state
      board: gameState.board.map(row =>
        row.map(cell => ({
          ...cell,
          card: cell.card ? WebrtcManager.optimizeCard(cell.card) : null
        }))
      ) as any
    }
  }

  /**
   * Optimize a single card by removing heavy fields
   * Keeps all gameplay-relevant data
   */
  private static optimizeCard(card: any): any {
    return {
      id: card.id,
      baseId: card.baseId,
      name: card.name,
      power: card.power,
      powerModifier: card.powerModifier,
      ability: card.ability,
      ownerId: card.ownerId,
      color: card.color,
      deck: card.deck,
      isFaceDown: card.isFaceDown,
      types: card.types,
      faction: card.faction,
      statuses: card.statuses || [],
      hasRevealToken: card.hasRevealToken || false,
      // Include imageUrl for board cards so they display with images
      imageUrl: card.imageUrl
    }
  }

  /**
   * Create a card-back representation for other players' hands
   * Only includes visibility-related info, not card content
   */
  private static createCardBack(card: any): any {
    return {
      id: card.id,
      baseId: card.baseId,
      name: card.name, // Name needed for display
      isFaceDown: card.isFaceDown,
      hasRevealToken: card.hasRevealToken || false,
      statuses: card.statuses || [],
      ownerId: card.ownerId, // Needed for card back color display
      deck: card.deck // Needed for card back theme
    }
  }

  /**
   * Broadcast state delta to all guests (host only)
   * Sends only the changes that happened, not full state
   * OPTIMIZED: Uses MessagePack binary serialization encoded as base64
   * Base64 encoding is required because PeerJS with JSON serialization converts Uint8Array to plain arrays
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    if (USE_OPTIMIZED_SERIALIZATION) {
      // Log size comparison for debugging (can be removed in production)
      if (process.env.NODE_ENV === 'development') {
        logSerializationStats(delta)
      }

      // Serialize to base64 string (bypasses PeerJS JSON serialization issue)
      const base64Data = serializeDeltaBase64(delta)

      const message: WebrtcMessage = {
        type: 'STATE_DELTA_BINARY',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }
      logger.info(`[broadcastStateDelta] Sending BINARY STATE_DELTA (base64): ${base64Data.length} chars, playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}`)
      this.broadcastToGuests(message, excludePeerId)
      logger.info(`[broadcastStateDelta] Sent STATE_DELTA from player ${delta.sourcePlayerId} to ${this.connections.size} guests`)
    } else {
      // Fallback to JSON format
      const message: WebrtcMessage = {
        type: 'STATE_DELTA',
        senderId: this.peer?.id,
        data: { delta },
        timestamp: Date.now()
      }
      logger.info(`[broadcastStateDelta] Preparing to send STATE_DELTA: playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}, phaseDelta=${!!delta.phaseDelta}`)
      this.broadcastToGuests(message, excludePeerId)
      logger.info(`[broadcastStateDelta] Sent STATE_DELTA from player ${delta.sourcePlayerId} to ${this.connections.size} guests`)
    }
  }

  // ==================== New Codec System ====================

  /**
   * Broadcast card state to all guests (new codec)
   */
  broadcastCardState(gameState: GameState, localPlayerId: number | null, excludePeerId?: string): number {
    try {
      const stateData = serializeGameState(gameState, localPlayerId)

      // Convert to base64 for PeerJS JSON serialization
      const base64Data = btoa(String.fromCharCode(...stateData))

      const message: WebrtcMessage = {
        type: 'CARD_STATE',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcastToGuests(message, excludePeerId)
      logger.info(`[broadcastCardState] Sent ${stateData.length} bytes to ${successCount} guests`)
      return successCount
    } catch (err) {
      logger.error('[broadcastCardState] Failed to encode/broadcast state:', err)
      return 0
    }
  }

  /**
   * Broadcast ability effect to all guests
   */
  broadcastAbilityEffect(
    effectType: AbilityEffectType,
    data: {
      sourcePos?: { row: number; col: number }
      targetPositions?: Array<{ row: number; col: number }>
      text?: string
      value?: number
      playerId?: number
    },
    excludePeerId?: string
  ): number {
    try {
      const effectData = encodeAbilityEffect(effectType, data)

      // Convert to base64 for PeerJS JSON serialization
      const base64Data = btoa(String.fromCharCode(...effectData))

      const message: WebrtcMessage = {
        type: 'ABILITY_EFFECT',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcastToGuests(message, excludePeerId)
      logger.debug(`[broadcastAbilityEffect] Sent effect ${effectType} to ${successCount} guests`)
      return successCount
    } catch (err) {
      logger.error('[broadcastAbilityEffect] Failed to encode/broadcast effect:', err)
      return 0
    }
  }

  /**
   * Broadcast session event to all guests
   */
  broadcastSessionEvent(
    eventType: number,
    data: {
      playerId?: number
      playerName?: string
      startingPlayerId?: number
      roundNumber?: number
      winners?: number[]
      newPhase?: number
      newActivePlayerId?: number
      gameWinner?: number | null
    },
    excludePeerId?: string
  ): number {
    try {
      const eventData = encodeSessionEvent(eventType, data)

      // Convert to base64 for PeerJS JSON serialization
      const base64Data = btoa(String.fromCharCode(...eventData))

      const message: WebrtcMessage = {
        type: 'SESSION_EVENT',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcastToGuests(message, excludePeerId)
      logger.debug(`[broadcastSessionEvent] Sent event ${eventType} to ${successCount} guests`)
      return successCount
    } catch (err) {
      logger.error('[broadcastSessionEvent] Failed to encode/broadcast event:', err)
      return 0
    }
  }

  /**
   * Guest sends action to host
   */
  sendAction(actionType: string, actionData: any): boolean {
    const message: WebrtcMessage = {
      type: 'ACTION',
      senderId: this.peer?.id,
      data: { actionType, actionData },
      timestamp: Date.now()
    }
    return this.sendMessageToHost(message)
  }

  /**
   * Send state delta to host (for efficient syncing)
   * Guest uses this to send their state changes to host
   * OPTIMIZED: Uses MessagePack binary serialization
   */
  sendStateDelta(delta: StateDelta): boolean {
    if (USE_OPTIMIZED_SERIALIZATION) {
      const binaryData = serializeDelta(delta)
      const message: WebrtcMessage = {
        type: 'STATE_DELTA_BINARY',
        senderId: this.peer?.id,
        data: binaryData,
        timestamp: Date.now()
      }
      return this.sendMessageToHost(message)
    } else {
      const message: WebrtcMessage = {
        type: 'STATE_DELTA',
        senderId: this.peer?.id,
        data: { delta },
        timestamp: Date.now()
      }
      return this.sendMessageToHost(message)
    }
  }

  /**
   * Send compact state to host (guest only)
   * Guest uses this to send their state changes to host for syncing
   * OPTIMIZED: Sends only card IDs (not full cards) to stay under size limit
   * Host will reconstruct full cards from stored guest deck data
   */
  sendStateToHost(gameState: GameState, localPlayerId: number | null): boolean {
    if (localPlayerId === null) {
      logger.warn('[sendStateToHost] No local player ID, cannot send state to host')
      return false
    }

    // Create compact state - send ONLY card IDs for local player
    const compactState = WebrtcManager.createCompactStateForHost(gameState, localPlayerId)

    // Log the sizes being sent
    const localPlayer = gameState.players.find((p: any) => p.id === localPlayerId)
    if (localPlayer) {
      logger.info(`[sendStateToHost] Player ${localPlayerId} sending compact state: hand=${localPlayer.hand?.length ?? 0}, deck=${localPlayer.deck?.length ?? 0}, score=${localPlayer.score}`)
    }

    const message: WebrtcMessage = {
      type: 'STATE_UPDATE_COMPACT', // Use compact type with card IDs
      senderId: this.peer?.id,
      playerId: localPlayerId,
      data: { gameState: compactState },
      timestamp: Date.now()
    }
    return this.sendMessageToHost(message)
  }

  /**
   * Send full deck to host (for deck view feature)
   * Called when guest opens deck view modal for another player
   */
  sendFullDeckToHost(localPlayerId: number, deck: any[], deckSize: number): boolean {
    const message: WebrtcMessage = {
      type: 'DECK_DATA_UPDATE',
      senderId: this.peer?.id,
      playerId: localPlayerId,
      data: { playerId: localPlayerId, deck: deck.map(c => WebrtcManager.optimizeCard(c)), deckSize },
      timestamp: Date.now()
    }
    return this.sendMessageToHost(message)
  }

  /**
   * Send custom deck cards to host (before game start)
   * Called when guest is ready - sends their custom deck cards so host can sync properly
   * @param playerId - Local player ID
   * @param deckCards - Full deck cards (custom deck)
   * @param isCustomDeck - True if this is a custom deck (not from contentDatabase)
   */
  sendCustomDeckData(playerId: number, deckCards: any[], isCustomDeck: boolean): boolean {
    if (!isCustomDeck) {
      // Not a custom deck, no need to send cards (host has them in contentDatabase)
      logger.info(`[sendCustomDeckData] Player ${playerId} has standard deck, skipping card sync`)
      return true
    }

    logger.info(`[sendCustomDeckData] Player ${playerId} sending ${deckCards.length} custom deck cards to host`)

    // Send only essential card data (compact format)
    const compactCards = deckCards.map(card => ({
      id: card.id,
      baseId: card.baseId,
      name: card.name,
      power: card.power,
      powerModifier: card.powerModifier,
      ability: card.ability,
      types: card.types,
      faction: card.faction,
      imageUrl: card.imageUrl,
      color: card.color,
      deck: card.deck
    }))

    const message: WebrtcMessage = {
      type: 'CUSTOM_DECK_DATA',
      senderId: this.peer?.id,
      playerId: playerId,
      data: { playerId, deckCards: compactCards },
      timestamp: Date.now()
    }
    return this.sendMessageToHost(message)
  }

  /**
   * Get connection info for all connected peers
   */
  getConnectionInfo(): WebrtcConnectionInfo[] {
    const info: WebrtcConnectionInfo[] = []

    if (this.isHost) {
      this.connections.forEach((conn, peerId) => {
        info.push({
          peerId,
          playerId: null, // Will be set by game logic
          playerName: null,
          connected: conn.open
        })
      })
    } else if (this.hostConnection) {
      info.push({
        peerId: this.hostConnection.peer,
        playerId: null,
        playerName: null,
        connected: this.hostConnection.open
      })
    }

    return info
  }

  /**
   * Get current Peer ID
   */
  getPeerId(): string | null {
    return this.peer?.id || null
  }

  /**
   * Get host Peer ID (for guests)
   */
  getHostPeerId(): string | null {
    if (this.isHost) {
      return this.peer?.id || null
    }
    return this.hostConnection?.peer || null
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (this.isHost) {
      return this.peer !== null && this.connections.size > 0
    }
    return this.hostConnection !== null && this.hostConnection.open
  }

  /**
   * Check if host
   */
  isHostMode(): boolean {
    return this.isHost
  }

  /**
   * Get connection count (including guests for host, or 1 for guest)
   */
  getConnectionCount(): number {
    if (this.isHost) {
      return this.connections.size
    }
    return this.hostConnection?.open ? 1 : 0
  }

  /**
   * Subscribe to events
   */
  on(eventHandler: WebrtcEventHandler): () => void {
    this.eventHandlers.add(eventHandler)
    return () => this.eventHandlers.delete(eventHandler)
  }

  /**
   * Emit event to all handlers
   */
  private emitEvent(event: WebrtcEvent): void {
    this.eventHandlers.forEach(handler => {
      try {
        handler(event)
      } catch (err) {
        logger.error('Error in WebRTC event handler:', err)
      }
    })
  }

  /**
   * Cleanup and disconnect all connections
   */
  cleanup(): void {
    logger.info('Cleaning up WebRTC manager...')

    // Close all guest connections
    this.connections.forEach(conn => conn.close())
    this.connections.clear()

    // Close host connection
    if (this.hostConnection) {
      this.hostConnection.close()
      this.hostConnection = null
    }

    // Destroy peer
    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }

    this.isHost = false
  }
}

// Singleton instance
let webrtcManagerInstance: WebrtcManager | null = null

export const getWebrtcManager = (): WebrtcManager => {
  if (!webrtcManagerInstance) {
    webrtcManagerInstance = new WebrtcManager()
  }
  return webrtcManagerInstance
}

export const cleanupWebrtcManager = (): void => {
  if (webrtcManagerInstance) {
    webrtcManagerInstance.cleanup()
    webrtcManagerInstance = null
  }
}
