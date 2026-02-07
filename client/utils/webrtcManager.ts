/**
 * WebRTC Manager - Handles peer-to-peer connections using PeerJS
 *
 * Architecture:
 * - Host: Creates Peer, accepts connections, broadcasts game state to all guests
 * - Guest: Connects to host, sends actions, receives game state updates
 *
 * Data flow:
 * Guest --> Host --> Broadcast to all guests
 */

import { Peer, DataConnection } from 'peerjs'
import type { GameState } from '../types'
import { logger } from './logger'

// Message types for WebRTC communication
export type WebrtcMessageType =
  | 'JOIN_REQUEST'      // Guest requests to join
  | 'JOIN_ACCEPT'       // Host accepts guest, sends current state
  | 'STATE_UPDATE'      // Host broadcasts full state update
  | 'ACTION'            // Guest sends action to host
  | 'PLAYER_LEAVE'      // Player is leaving
  | 'CHAT'              // Chat message (optional future feature)

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
   * Host accepts guest and sends current game state
   */
  acceptGuest(peerId: string, gameState: GameState, playerId: number): void {
    const conn = this.connections.get(peerId)
    if (conn && conn.open) {
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
