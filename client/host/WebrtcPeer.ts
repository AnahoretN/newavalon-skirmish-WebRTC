/**
 * WebrtcPeer - Low-level PeerJS wrapper
 *
 * Handles PeerJS connection management for both Host and Guest
 * Extracted from WebrtcManager for better separation of concerns
 */

import { Peer, DataConnection } from 'peerjs'
import { logger } from '../utils/logger'

export type WebrtcPeerEventHandler = (event: WebrtcPeerEvent) => void

export type WebrtcPeerEventType =
  | 'peer_open'         // Peer is ready, peerId available
  | 'peer_closed'       // Peer connection closed
  | 'connection_open'   // New connection established
  | 'connection_closed' // Connection closed
  | 'connection_data'   // Data received on connection
  | 'error'             // Error occurred

export interface WebrtcPeerEvent {
  type: WebrtcPeerEventType
  data?: any
}

/**
 * WebrtcPeer wraps PeerJS functionality
 * - Creates and manages Peer instance
 * - Handles incoming connections (host)
 * - Connects to remote peers (guest)
 * - Emits events for connection lifecycle
 */
export class WebrtcPeer {
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private eventHandlers: Set<WebrtcPeerEventHandler> = new Set()

  constructor() {
    // Check localStorage for WebRTC preference
    const webrtcEnabled = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcEnabled) {
      logger.info('WebRTC mode is disabled')
    }
  }

  /**
   * Subscribe to peer events
   */
  on(handler: WebrtcPeerEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  /**
   * Emit event to all subscribers
   */
  private emitEvent(event: WebrtcPeerEvent): void {
    this.eventHandlers.forEach(handler => handler(event))
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.peer?.id ?? null
  }

  /**
   * Get connection by peer ID
   */
  getConnection(peerId: string): DataConnection | undefined {
    return this.connections.get(peerId)
  }

  /**
   * Get all connections
   */
  getAllConnections(): Map<string, DataConnection> {
    return this.connections
  }

  /**
   * Check if peer is initialized
   */
  isInitialized(): boolean {
    return this.peer !== null
  }

  /**
   * Initialize as Host - creates Peer and waits for connections
   * @param existingPeerId - If provided, try to reuse this peerId (for F5 restore)
   */
  async initializeAsHost(existingPeerId?: string): Promise<string> {
    if (this.peer) {
      this.cleanup()
    }

    logger.info('Initializing WebrtcPeer as Host...' + (existingPeerId ? ` with existing peerId: ${existingPeerId}` : ''))

    return new Promise((resolve, reject) => {
      // Create Peer with default PeerJS cloud server
      // If existingPeerId is provided, try to reuse it (for F5 restore)
      this.peer = existingPeerId ? new Peer(existingPeerId) : new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`WebrtcPeer Host initialized with peerId: ${peerId}`)
        this.emitEvent({ type: 'peer_open', data: { peerId } })
        resolve(peerId)
      })

      this.peer.on('connection', (conn) => {
        logger.info(`Incoming connection from: ${conn.peer}`)
        this.handleConnection(conn)
      })

      this.peer.on('error', (err) => {
        logger.error(`WebrtcPeer error:`, err)
        this.emitEvent({ type: 'error', data: err })
        reject(err)
      })

      this.peer.on('close', () => {
        logger.warn('WebrtcPeer closed')
        this.emitEvent({ type: 'peer_closed' })
      })
    })
  }

  /**
   * Initialize as Guest - creates Peer and connects to host
   */
  async initializeAsGuest(): Promise<string> {
    if (this.peer) {
      this.cleanup()
    }

    logger.info('Initializing WebrtcPeer as Guest')

    return new Promise((resolve, reject) => {
      // Create Peer for guest
      this.peer = new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`WebrtcPeer Guest initialized with peerId: ${peerId}`)
        resolve(peerId)
      })

      this.peer.on('error', (err) => {
        logger.error(`WebrtcPeer error:`, err)
        this.emitEvent({ type: 'error', data: err })
        reject(err)
      })

      this.peer.on('close', () => {
        logger.warn('WebrtcPeer closed')
        this.emitEvent({ type: 'peer_closed' })
      })
    })
  }

  /**
   * Connect to a remote peer (guest only)
   */
  connectTo(hostPeerId: string): DataConnection | null {
    if (!this.peer) {
      logger.error('Cannot connect: peer not initialized')
      return null
    }

    logger.info(`Connecting to host: ${hostPeerId}`)

    const conn = this.peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'json'
    })

    this.handleConnection(conn)
    return conn
  }

  /**
   * Handle connection (both host and guest)
   */
  private handleConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn)

    conn.on('open', () => {
      logger.info(`Connection opened: ${conn.peer}`)
      this.emitEvent({
        type: 'connection_open',
        data: { peerId: conn.peer }
      })
    })

    conn.on('data', (data: unknown) => {
      this.emitEvent({
        type: 'connection_data',
        data: { peerId: conn.peer, data }
      })
    })

    conn.on('close', () => {
      logger.info(`Connection closed: ${conn.peer}`)
      this.connections.delete(conn.peer)
      this.emitEvent({
        type: 'connection_closed',
        data: { peerId: conn.peer }
      })
    })

    conn.on('error', (err) => {
      logger.error(`Connection error (${conn.peer}):`, err)
      this.emitEvent({
        type: 'error',
        data: { peerId: conn.peer, error: err }
      })
    })
  }

  /**
   * Send data to a specific peer
   */
  sendTo(peerId: string, data: any): boolean {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[sendTo] No connection found for peer ${peerId}`)
      return false
    }
    if (!conn.open) {
      logger.error(`[sendTo] Connection for peer ${peerId} is not open`)
      return false
    }

    try {
      conn.send(data)
      return true
    } catch (err) {
      logger.error(`[sendTo] Failed to send to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Broadcast data to all connections
   */
  broadcast(data: any, excludePeerId?: string): number {
    let successCount = 0
    this.connections.forEach((conn, peerId) => {
      if (conn.open && peerId !== excludePeerId) {
        try {
          conn.send(data)
          successCount++
        } catch (err) {
          logger.error(`[broadcast] Failed to send to ${peerId}:`, err)
        }
      }
    })
    return successCount
  }

  /**
   * Close connection to a specific peer
   */
  closeConnection(peerId: string): void {
    const conn = this.connections.get(peerId)
    if (conn) {
      conn.close()
      this.connections.delete(peerId)
    }
  }

  /**
   * Cleanup and close all connections
   */
  cleanup(): void {
    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {
        // Ignore cleanup errors
      }
    })
    this.connections.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {
        // Ignore cleanup errors
      }
      this.peer = null
    }

    logger.info('WebrtcPeer cleaned up')
  }
}
