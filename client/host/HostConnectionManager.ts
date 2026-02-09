/**
 * Host Connection Manager (Full Implementation)
 * Handles WebRTC peer-to-peer connections for the host with proper connection storage
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

export class HostConnectionManager {
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private guests: Map<string, GuestConnection> = new Map()
  private eventHandlers: Set<WebrtcEventHandler> = new Set()
  private config: HostConfig
  // Track players who are in reconnection window (by playerId)
  private reconnectingPlayers: Map<number, {
    disconnectedAt: number
    oldPeerId: string | null
  }> = new Map()
  private reconnectionTimeout: number = 30000 // 30 seconds

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
    if (this.config.maxGuests && this.connections.size >= this.config.maxGuests) {
      logger.warn(`Max guests limit reached: ${this.connections.size}/${this.config.maxGuests}`)
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

    this.connections.set(peerId, conn)
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
      this.connections.delete(peerId)
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
   * Send message to specific guest
   */
  sendToGuest(peerId: string, message: WebrtcMessage): boolean {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[sendToGuest] No connection found for ${peerId}`)
      return false
    }
    if (!conn.open) {
      logger.error(`[sendToGuest] Connection for ${peerId} is not open`)
      return false
    }

    try {
      conn.send(message)
      return true
    } catch (err) {
      logger.error(`[sendToGuest] Failed to send message to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Accept guest and send minimal game info
   */
  acceptGuestMinimal(peerId: string, minimalInfo: any, playerId: number): boolean {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[acceptGuestMinimal] No connection found for ${peerId}`)
      return false
    }
    if (!conn.open) {
      logger.error(`[acceptGuestMinimal] Connection for ${peerId} is not open`)
      return false
    }

    const guest = this.guests.get(peerId)
    if (guest) {
      guest.playerId = playerId
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
      return true
    } catch (err) {
      logger.error(`[acceptGuestMinimal] Failed to send JOIN_ACCEPT_MINIMAL to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Accept guest and send full game state
   */
  acceptGuest(peerId: string, gameState: GameState, playerId: number): boolean {
    const conn = this.connections.get(peerId)
    if (!conn) {
      logger.error(`[acceptGuest] No connection found for ${peerId}`)
      return false
    }
    if (!conn.open) {
      logger.error(`[acceptGuest] Connection for ${peerId} is not open`)
      return false
    }

    const guest = this.guests.get(peerId)
    if (guest) {
      guest.playerId = playerId
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
      return true
    } catch (err) {
      logger.error(`[acceptGuest] Failed to send JOIN_ACCEPT to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Broadcast message to all connected guests
   */
  broadcast(message: WebrtcMessage, excludePeerId?: string): number {
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
    logger.info(`[broadcastStateDelta] Sent STATE_DELTA from player ${delta.sourcePlayerId} to ${this.connections.size} guests`)
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

    this.connections.forEach((conn, peerId) => {
      const guest = this.guests.get(peerId)
      info.push({
        peerId,
        playerId: guest?.playerId || null,
        playerName: guest?.playerName || null,
        connected: conn.open
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
    return this.connections.size
  }

  /**
   * Check if connected to any guests
   */
  hasGuests(): boolean {
    return Array.from(this.connections.values()).some(conn => conn.open)
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
    logger.info('Cleaning up HostConnectionManager...')

    this.connections.forEach(conn => conn.close())
    this.connections.clear()
    this.guests.clear()
    this.reconnectingPlayers.clear()

    // Destroy peer
    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }

  // ==================== Reconnection Management ====================

  /**
   * Mark player as in reconnection window
   */
  markPlayerReconnecting(playerId: number, peerId: string | null): void {
    this.reconnectingPlayers.set(playerId, {
      disconnectedAt: Date.now(),
      oldPeerId: peerId
    })

    // Auto-remove after timeout
    setTimeout(() => {
      const data = this.reconnectingPlayers.get(playerId)
      if (data && Date.now() - data.disconnectedAt >= this.reconnectionTimeout) {
        this.reconnectingPlayers.delete(playerId)
        logger.info(`[Reconnection] Player ${playerId} reconnection window expired`)
      }
    }, this.reconnectionTimeout)

    logger.info(`[Reconnection] Player ${playerId} marked as reconnecting, window: ${this.reconnectionTimeout}ms`)
  }

  /**
   * Check if player is in reconnection window
   */
  isPlayerReconnecting(playerId: number): boolean {
    const data = this.reconnectingPlayers.get(playerId)
    if (!data) return false

    // Check if still within window
    const elapsed = Date.now() - data.disconnectedAt
    if (elapsed >= this.reconnectionTimeout) {
      this.reconnectingPlayers.delete(playerId)
      return false
    }

    return true
  }

  /**
   * Get remaining reconnection time for player
   */
  getPlayerReconnectTimeRemaining(playerId: number): number {
    const data = this.reconnectingPlayers.get(playerId)
    if (!data) return 0

    const elapsed = Date.now() - data.disconnectedAt
    return Math.max(0, this.reconnectionTimeout - elapsed)
  }

  /**
   * Handle player reconnection (accept reconnection request)
   */
  acceptPlayerReconnect(newPeerId: string, playerId: number, gameState: GameState): boolean {
    // Check if player is in reconnection window
    if (!this.isPlayerReconnecting(playerId)) {
      logger.warn(`[Reconnection] Player ${playerId} not in reconnection window or expired`)
      return false
    }

    // Get the connection
    const conn = this.connections.get(newPeerId)
    if (!conn || !conn.open) {
      logger.error(`[Reconnection] No valid connection for ${newPeerId}`)
      return false
    }

    // Remove from reconnecting list
    this.reconnectingPlayers.delete(playerId)

    // Send reconnection acceptance with current state
    const message: WebrtcMessage = {
      type: 'RECONNECT_ACCEPT',
      senderId: this.peer?.id,
      playerId: playerId,
      data: { gameState },
      timestamp: Date.now()
    }

    try {
      conn.send(message)
      logger.info(`[Reconnection] Player ${playerId} reconnected from ${newPeerId}`)

      // Update guest mapping
      const guest = this.guests.get(newPeerId)
      if (guest) {
        guest.playerId = playerId
      }

      return true
    } catch (err) {
      logger.error(`[Reconnection] Failed to send RECONNECT_ACCEPT:`, err)
      return false
    }
  }

  /**
   * Reject player reconnection (timeout or game over)
   */
  rejectPlayerReconnect(peerId: string, reason: 'timeout' | 'game_over'): void {
    const conn = this.connections.get(peerId)
    if (!conn || !conn.open) {
      return
    }

    const message: WebrtcMessage = {
      type: 'RECONNECT_REJECT',
      senderId: this.peer?.id,
      data: { reason },
      timestamp: Date.now()
    }

    try {
      conn.send(message)
      conn.close()
      logger.info(`[Reconnection] Rejected reconnection from ${peerId}, reason: ${reason}`)
    } catch (err) {
      logger.error(`[Reconnection] Failed to send RECONNECT_REJECT:`, err)
    }
  }

  /**
   * Get all players currently in reconnection window
   */
  getReconnectingPlayers(): number[] {
    const now = Date.now()
    const validPlayers: number[] = []

    this.reconnectingPlayers.forEach((data, playerId) => {
      if (now - data.disconnectedAt < this.reconnectionTimeout) {
        validPlayers.push(playerId)
      } else {
        this.reconnectingPlayers.delete(playerId)
      }
    })

    return validPlayers
  }

  /**
   * Cancel reconnection window for player (e.g., if they left voluntarily)
   */
  cancelPlayerReconnection(playerId: number): void {
    this.reconnectingPlayers.delete(playerId)
    logger.info(`[Reconnection] Cancelled reconnection window for player ${playerId}`)
  }
}

// Singleton instance
let hostConnectionInstance: HostConnectionManager | null = null

export const getHostConnectionManager = (config?: HostConfig): HostConnectionManager => {
  if (!hostConnectionInstance) {
    hostConnectionInstance = new HostConnectionManager(config)
  }
  return hostConnectionInstance
}

export const cleanupHostConnectionManager = (): void => {
  if (hostConnectionInstance) {
    hostConnectionInstance.cleanup()
    hostConnectionInstance = null
  }
}
