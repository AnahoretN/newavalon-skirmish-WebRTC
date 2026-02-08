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
 * @note For new host-specific functionality, consider using the HostManager module
 *       located in '../host' which provides better separation of concerns.
 */

import { Peer, DataConnection } from 'peerjs'
import type { GameState, StateDelta } from '../types'
import { logger } from './logger'

// Message types for WebRTC communication
export type WebrtcMessageType =
  | 'JOIN_REQUEST'         // Guest requests to join
  | 'JOIN_ACCEPT'          // Host accepts guest, sends current state
  | 'JOIN_ACCEPT_MINIMAL'  // Host accepts guest with minimal info (to avoid size limit)
  | 'STATE_UPDATE'         // Host broadcasts full state update
  | 'STATE_DELTA'          // Compact state change broadcast (NEW)
  | 'ACTION'               // Guest sends action to host
  | 'PLAYER_LEAVE'         // Player is leaving
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
  | 'SYNC_DECK_SELECTIONS'  // Sync deck selections between all players
  | 'TOGGLE_ACTIVE_PLAYER' // Toggle active player
  | 'TOGGLE_AUTO_DRAW'     // Toggle auto draw
  | 'START_NEXT_ROUND'     // Start next round
  | 'RESET_DEPLOY_STATUS'  // Reset deploy status

export interface WebrtcMessage {
  type: WebrtcMessageType
  senderId?: string     // Peer ID of sender
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
   */
  async initializeAsHost(): Promise<string> {
    if (this.peer) {
      this.cleanup()
    }

    this.isHost = true
    logger.info('Initializing WebRTC as Host...')

    return new Promise((resolve, reject) => {
      // Create Peer with default PeerJS cloud server
      this.peer = new Peer()

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

          // Send join request
          this.sendMessageToHost({
            type: 'JOIN_REQUEST',
            senderId: peerId,
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
        return true
      } catch (err) {
        logger.error('Failed to send message to host:', err)
        return false
      }
    }
    return false
  }

  /**
   * Broadcast message to all connected guests (host only)
   */
  broadcastToGuests(message: WebrtcMessage, excludePeerId?: string): void {
    if (!this.isHost) {
      logger.warn('Only host can broadcast to guests')
      return
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
    const message: WebrtcMessage = {
      type: 'JOIN_ACCEPT',
      senderId: this.peer?.id,
      playerId: playerId,
      data: { gameState },
      timestamp: Date.now()
    }
    try {
      conn.send(message)
      logger.info(`Accepted guest ${peerId} as player ${playerId}`)
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
   */
  broadcastGameState(gameState: GameState, excludePeerId?: string): void {
    const message: WebrtcMessage = {
      type: 'STATE_UPDATE',
      senderId: this.peer?.id,
      data: { gameState },
      timestamp: Date.now()
    }
    this.broadcastToGuests(message, excludePeerId)
  }

  /**
   * Broadcast state delta to all guests (host only)
   * Sends only the changes that happened, not full state
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
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
   */
  sendStateDelta(delta: StateDelta): boolean {
    const message: WebrtcMessage = {
      type: 'STATE_DELTA',
      senderId: this.peer?.id,
      data: { delta },
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
