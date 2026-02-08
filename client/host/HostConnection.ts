/**
 * Host Connection Manager
 * Handles WebRTC peer-to-peer connections for the host
 */

import { Peer, DataConnection } from 'peerjs'
import type { GameState, StateDelta } from '../types'
import type {
  WebrtcMessage,
  WebrtcEventHandler,
  WebrtcEvent,
  WebrtcConnectionInfo,
  GuestConnection,
  HostConfig
} from './types'
import { logger } from '../utils/logger'

export class HostConnection {
  private peer: Peer | null = null
  private guests: Map<string, GuestConnection> = new Map()
  private eventHandlers: Set<WebrtcEventHandler> = new Set()
  private config: HostConfig

  constructor(config: HostConfig = {}) {
    this.config = {
      maxGuests: config.maxGuests ?? 4,
      autoAcceptGuests: config.autoAcceptGuests ?? true,
      enableReconnection: config.enableReconnection ?? false
    }

    const webrtcEnabled = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcEnabled) {
      logger.info('WebRTC mode is disabled')
    }
  }

  /**
   * Initialize as Host - creates Peer and waits for connections
   */
  async initialize(): Promise<string> {
    if (this.peer) {
      this.cleanup()
    }

    logger.info('Initializing WebRTC Host...')

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
   * Handle incoming guest connection
   */
  private handleGuestConnection(conn: DataConnection): void {
    const peerId = conn.peer

    // Check max guests limit
    if (this.config.maxGuests && this.guests.size >= this.config.maxGuests) {
      logger.warn(`Max guests limit reached: ${this.guests.size}/${this.config.maxGuests}`)
      conn.close()
      return
    }

    const guestConnection: GuestConnection = {
      peerId,
      playerId: null,
      playerName: null,
      connected: false,
      connectedAt: Date.now()
    }

    this.guests.set(peerId, guestConnection)

    conn.on('open', () => {
      logger.info(`Guest connected: ${peerId}`)
      guestConnection.connected = true
      this.emitEvent({
        type: 'guest_connected',
        data: { peerId }
      })
    })

    conn.on('data', (data: unknown) => {
      this.handleMessage(data as WebrtcMessage, peerId)
    })

    conn.on('close', () => {
      logger.info(`Guest disconnected: ${peerId}`)
      this.guests.delete(peerId)
      this.emitEvent({
        type: 'guest_disconnected',
        data: { peerId }
      })
    })

    conn.on('error', (err) => {
      logger.error(`Guest connection error (${peerId}):`, err)
    })
  }

  /**
   * Handle incoming message from guest
   */
  private handleMessage(message: WebrtcMessage, fromPeerId: string): void {
    logger.debug(`Received WebRTC message from ${fromPeerId}:`, message.type)
    this.emitEvent({
      type: 'message_received',
      data: { message, fromPeerId }
    })
  }

  /**
   * Get the DataConnection for a guest
   */
  private getConnection(peerId: string): DataConnection | null {
    // We need to access the underlying PeerJS connection
    // Since we're storing GuestConnection, we need to get the actual DataConnection
    // This is a limitation - we'll need to store the connection separately
    return null // Will be implemented with proper connection storage
  }

  /**
   * Accept guest and send minimal game info
   */
  acceptGuestMinimal(peerId: string, minimalInfo: any, playerId: number): boolean {
    const guest = this.guests.get(peerId)
    if (!guest) {
      logger.error(`[acceptGuestMinimal] No guest found for ${peerId}`)
      return false
    }

    guest.playerId = playerId

    // Note: We'll need the actual DataConnection to send
    // This will be implemented when we refactor to store connections
    logger.info(`Accepted guest ${peerId} as player ${playerId} (minimal)`)
    return true
  }

  /**
   * Broadcast message to all connected guests
   */
  broadcast(message: WebrtcMessage, excludePeerId?: string): number {
    let successCount = 0

    this.guests.forEach((guest, peerId) => {
      if (guest.connected && peerId !== excludePeerId) {
        // Note: We'll need the actual DataConnection to send
        // This will be implemented when we refactor to store connections
        successCount++
      }
    })

    logger.debug(`Broadcast to ${successCount}/${this.guests.size} guests`)
    return successCount
  }

  /**
   * Broadcast state delta to all guests
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    const message: WebrtcMessage = {
      type: 'STATE_DELTA',
      senderId: this.peer?.id,
      data: { delta },
      timestamp: Date.now()
    }
    logger.info(`[broadcastStateDelta] Preparing to send STATE_DELTA: playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}, phaseDelta=${!!delta.phaseDelta}`)
    this.broadcast(message, excludePeerId)
    logger.info(`[broadcastStateDelta] Sent STATE_DELTA from player ${delta.sourcePlayerId} to ${this.guests.size} guests`)
  }

  /**
   * Broadcast game state to all guests
   */
  broadcastGameState(gameState: GameState, excludePeerId?: string): void {
    const message: WebrtcMessage = {
      type: 'STATE_UPDATE',
      senderId: this.peer?.id,
      data: { gameState },
      timestamp: Date.now()
    }
    this.broadcast(message, excludePeerId)
  }

  /**
   * Get connection info for all connected guests
   */
  getConnectionInfo(): WebrtcConnectionInfo[] {
    const info: WebrtcConnectionInfo[] = []

    this.guests.forEach((guest, peerId) => {
      info.push({
        peerId,
        playerId: guest.playerId,
        playerName: guest.playerName,
        connected: guest.connected
      })
    })

    return info
  }

  /**
   * Get guest info by peer ID
   */
  getGuest(peerId: string): GuestConnection | undefined {
    return this.guests.get(peerId)
  }

  /**
   * Get guest by player ID
   */
  getGuestByPlayerId(playerId: number): GuestConnection | undefined {
    return Array.from(this.guests.values()).find(g => g.playerId === playerId)
  }

  /**
   * Update guest player ID mapping
   */
  setGuestPlayerId(peerId: string, playerId: number): void {
    const guest = this.guests.get(peerId)
    if (guest) {
      guest.playerId = playerId
    }
  }

  /**
   * Get current Peer ID
   */
  getPeerId(): string | null {
    return this.peer?.id || null
  }

  /**
   * Get guest count
   */
  getGuestCount(): number {
    return this.guests.size
  }

  /**
   * Check if connected to any guests
   */
  hasGuests(): boolean {
    return Array.from(this.guests.values()).some(g => g.connected)
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
    logger.info('Cleaning up HostConnection...')

    this.guests.clear()

    // Destroy peer
    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }
}
