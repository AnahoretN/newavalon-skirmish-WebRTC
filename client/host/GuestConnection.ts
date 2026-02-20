/**
 * Guest Connection Manager
 *
 * Manages WebRTC connection for guests using WebrtcPeer
 * - Connects to host
 * - Sends/receives messages
 * - Handles reconnection
 */

import type { WebrtcMessage, WebrtcEventHandler, WebrtcEvent } from './types'
import type { WebrtcPeer, WebrtcPeerEvent } from './WebrtcPeer'
import { WebrtcPeer as WebrtcPeerClass } from './WebrtcPeer'
import { logger } from '../utils/logger'

export interface GuestConnectionManagerConfig {
  onMessage?: (message: WebrtcMessage) => void
  onHostConnected?: () => void
  onHostDisconnected?: () => void
  onError?: (error: any) => void
}

/**
 * GuestConnectionManager manages the guest's connection to the host
 * NOTE: Named differently from GuestConnection (type) to avoid naming conflicts
 */
export class GuestConnectionManager {
  private webrtcPeer: WebrtcPeer
  private hostPeerId: string | null = null
  private eventHandlers: Set<WebrtcEventHandler> = new Set()
  private config: GuestConnectionManagerConfig

  constructor(config: GuestConnectionManagerConfig = {}) {
    this.config = config

    // Create WebrtcPeer instance
    this.webrtcPeer = new WebrtcPeerClass()

    // Subscribe to peer events
    this.webrtcPeer.on((event: WebrtcPeerEvent) => this.handlePeerEvent(event))

    const webrtcEnabled = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcEnabled) {
      logger.info('WebRTC mode is disabled')
    }
  }

  /**
   * Subscribe to connection events
   */
  on(handler: WebrtcEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  /**
   * Emit event to all subscribers
   */
  private emitEvent(event: WebrtcEvent): void {
    this.eventHandlers.forEach(handler => handler(event))
  }

  /**
   * Handle events from WebrtcPeer
   */
  private handlePeerEvent(event: WebrtcPeerEvent): void {
    switch (event.type) {
      case 'peer_open':
        // Guest peer is ready, now connect to host
        if (this.hostPeerId) {
          this.webrtcPeer.connectTo(this.hostPeerId)
        }
        break
      case 'connection_open':
        logger.info(`Connected to host: ${event.data.peerId}`)
        this.emitEvent({
          type: 'connected_to_host',
          data: { hostPeerId: event.data.peerId }
        })
        this.config.onHostConnected?.()
        break
      case 'connection_closed':
        logger.warn('Host connection closed')
        this.emitEvent({ type: 'host_disconnected' })
        this.config.onHostDisconnected?.()
        break
      case 'connection_data':
        this.handleMessage(event.data.data as WebrtcMessage)
        break
      case 'error':
        logger.error('WebRTC error:', event.data)
        this.emitEvent({ type: 'error', data: event.data })
        this.config.onError?.(event.data)
        break
    }
  }

  /**
   * Handle incoming message from host
   */
  private handleMessage(message: WebrtcMessage): void {
    // Log targeting mode messages for debugging
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
      logger.info(`[GuestConnection] Received ${message.type} from host`, {
        hasData: !!message.data,
        hasTargetingMode: !!message.data?.targetingMode,
        targetingModePlayerId: message.data?.targetingMode?.playerId,
        timestamp: message.timestamp
      })
    }

    this.emitEvent({
      type: 'message_received',
      data: message
    })

    this.config.onMessage?.(message)
  }

  /**
   * Connect to host
   */
  async connect(hostPeerId: string): Promise<void> {
    this.hostPeerId = hostPeerId
    logger.info(`Connecting to host: ${hostPeerId}`)

    // Initialize guest peer (will trigger connection to host after peer is open)
    await this.webrtcPeer.initializeAsGuest()

    // If peer was already initialized, connect now
    if (this.webrtcPeer.isInitialized()) {
      const conn = this.webrtcPeer.connectTo(hostPeerId)
      if (!conn) {
        throw new Error('Failed to create connection to host')
      }
    }
  }

  /**
   * Connect as reconnecting player (after page reload)
   */
  async connectAsReconnecting(hostPeerId: string, playerId: number): Promise<void> {
    this.hostPeerId = hostPeerId
    logger.info(`Reconnecting to host: ${hostPeerId}, playerId: ${playerId}`)

    // Initialize guest peer
    await this.webrtcPeer.initializeAsGuest()

    const conn = this.webrtcPeer.connectTo(hostPeerId)
    if (!conn) {
      throw new Error('Failed to create connection to host')
    }

    // Wait for connection to open, then send reconnect message
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Reconnection timeout'))
      }, 10000)

      const onOpen = () => {
        clearTimeout(timeout)
        this.sendMessage({
          type: 'PLAYER_RECONNECT',
          playerId: playerId,
          timestamp: Date.now()
        })
        resolve()
      }

      const onError = (err: any) => {
        clearTimeout(timeout)
        reject(err)
      }

      // @ts-ignore - DataConnection events
      conn.once('open', onOpen)
      // @ts-ignore - DataConnection events
      conn.once('error', onError)
    })
  }

  /**
   * Send message to host
   */
  sendMessage(message: WebrtcMessage): boolean {
    if (!this.hostPeerId) {
      logger.warn('[GuestConnection] Not connected to host')
      return false
    }

    const success = this.webrtcPeer.sendTo(this.hostPeerId, message)

    // Log targeting mode messages for debugging
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
      if (success) {
        logger.info(`[GuestConnection] Sent ${message.type} to host`, {
          hasData: !!message.data,
          hasTargetingMode: !!message.data?.targetingMode,
          targetingModePlayerId: message.data?.targetingMode?.playerId,
          timestamp: message.timestamp
        })
      } else {
        logger.warn(`[GuestConnection] Could not send ${message.type} to host`)
      }
    }

    return success
  }

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.webrtcPeer.getPeerId()
  }

  /**
   * Check if connected to host
   */
  isConnected(): boolean {
    if (!this.hostPeerId) {return false}
    const conn = this.webrtcPeer.getConnection(this.hostPeerId)
    return conn?.open ?? false
  }

  /**
   * Cleanup connection
   */
  cleanup(): void {
    this.webrtcPeer.cleanup()
    logger.info('GuestConnection cleaned up')
  }
}
