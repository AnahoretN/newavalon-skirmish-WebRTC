/**
 * Guest Connection Manager
 *
 * Manages WebRTC connection for guests using WebrtcPeer
 * - Connects to host
 * - Sends/receives messages
 * - Handles reconnection
 * - Sends state updates to host
 */

import type { WebrtcMessage, WebrtcEventHandler, WebrtcEvent } from './types'
import type { WebrtcPeer, WebrtcPeerEvent } from './WebrtcPeer'
import { WebrtcPeer as WebrtcPeerClass } from './WebrtcPeer'
import { logger } from '../utils/logger'
import type { GameState, StateDelta } from '../types'
import { optimizeCard, createCompactStateForHost } from './StatePersonalization'
import { serializeDelta } from '../utils/webrtcSerialization'

export interface GuestConnectionManagerConfig {
  onMessage?: (message: WebrtcMessage) => void
  onHostConnected?: () => void
  onHostDisconnected?: () => void
  onError?: (error: any) => void
}

// Enable/disable optimized serialization
const USE_OPTIMIZED_SERIALIZATION = true

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
    // Log important messages for debugging
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE' || message.type === 'JOIN_ACCEPT_MINIMAL' || message.type === 'JOIN_ACCEPT') {
      logger.info(`[GuestConnection] Received ${message.type} from host`, {
        senderId: message.senderId,
        playerId: message.playerId,
        hasData: !!message.data,
        timestamp: message.timestamp
      })
    } else {
      logger.info(`[GuestConnection] Received ${message.type} from host`)
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

      // Wait for connection to open, then send join request with deck preference
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'))
        }, 10000)

        const onOpen = () => {
          clearTimeout(timeout)

          // Try to get deck preference from localStorage
          let preferredDeck: string | null = null
          try {
            const deckPreference = localStorage.getItem('webrtc_preferred_deck')
            if (deckPreference) {
              preferredDeck = deckPreference
              logger.info(`[connect] Found deck preference in localStorage: ${preferredDeck}`)
              localStorage.removeItem('webrtc_preferred_deck')
            }
          } catch (e) {
            logger.warn('[connect] Failed to read deck preference:', e)
          }

          // Send join request
          this.sendMessage({
            type: 'JOIN_REQUEST',
            senderId: this.getPeerId() ?? undefined,
            data: {
              preferredDeck: preferredDeck || undefined
            },
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
          senderId: this.getPeerId() ?? undefined,
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

  // ==================== State Sync Methods ====================

  /**
   * Send action to host
   */
  sendAction(actionType: string, actionData: any): boolean {
    const message: WebrtcMessage = {
      type: 'ACTION',
      senderId: this.getPeerId() ?? undefined,
      data: { actionType, actionData },
      timestamp: Date.now()
    }
    return this.sendMessage(message)
  }

  /**
   * Send state delta to host (for efficient syncing)
   * OPTIMIZED: Uses MessagePack binary serialization
   */
  sendStateDelta(delta: StateDelta): boolean {
    if (USE_OPTIMIZED_SERIALIZATION) {
      const binaryData = serializeDelta(delta)
      const message: WebrtcMessage = {
        type: 'STATE_DELTA_BINARY',
        senderId: this.getPeerId() ?? undefined,
        data: binaryData,
        timestamp: Date.now()
      }
      return this.sendMessage(message)
    } else {
      const message: WebrtcMessage = {
        type: 'STATE_DELTA',
        senderId: this.getPeerId() ?? undefined,
        data: { delta },
        timestamp: Date.now()
      }
      return this.sendMessage(message)
    }
  }

  /**
   * Send compact state to host
   * Guest uses this to send their state changes to host for syncing
   * OPTIMIZED: Sends only card IDs (not full cards) to stay under size limit
   */
  sendStateToHost(gameState: GameState, localPlayerId: number | null): boolean {
    if (localPlayerId === null) {
      logger.warn('[sendStateToHost] No local player ID, cannot send state to host')
      return false
    }

    const compactState = createCompactStateForHost(gameState, localPlayerId)

    // Log the sizes being sent
    const localPlayer = gameState.players.find((p: any) => p.id === localPlayerId)
    if (localPlayer) {
      logger.info(`[sendStateToHost] Player ${localPlayerId} sending compact state: hand=${localPlayer.hand?.length ?? 0}, deck=${localPlayer.deck?.length ?? 0}, score=${localPlayer.score}`)
    }

    const message: WebrtcMessage = {
      type: 'STATE_UPDATE_COMPACT',
      senderId: this.getPeerId() ?? undefined,
      playerId: localPlayerId,
      data: { gameState: compactState },
      timestamp: Date.now()
    }
    return this.sendMessage(message)
  }

  /**
   * Send full deck to host (for deck view feature)
   * Called when guest opens deck view modal for another player
   */
  sendFullDeckToHost(localPlayerId: number, deck: any[], deckSize: number): boolean {
    const message: WebrtcMessage = {
      type: 'DECK_DATA_UPDATE',
      senderId: this.getPeerId() ?? undefined,
      playerId: localPlayerId,
      data: { playerId: localPlayerId, deck: deck.map(c => optimizeCard(c)), deckSize },
      timestamp: Date.now()
    }
    return this.sendMessage(message)
  }

  /**
   * Send custom deck cards to host (before game start)
   * Called when guest is ready - sends their custom deck cards so host can sync properly
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
      senderId: this.getPeerId() ?? undefined,
      playerId: playerId,
      data: { playerId, deckCards: compactCards },
      timestamp: Date.now()
    }
    return this.sendMessage(message)
  }

  // ==================== Getters ====================

  /**
   * Get current peer ID
   */
  getPeerId(): string | null {
    return this.webrtcPeer.getPeerId()
  }

  /**
   * Get host peer ID
   */
  getHostPeerId(): string | null {
    return this.hostPeerId
  }

  /**
   * Check if connected to host
   */
  isConnected(): boolean {
    if (!this.hostPeerId) {
      return false
    }
    const conn = this.webrtcPeer.getConnection(this.hostPeerId)
    return conn?.open ?? false
  }

  /**
   * Get connection count (0 or 1 for guest)
   */
  getConnectionCount(): number {
    return this.isConnected() ? 1 : 0
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): { peerId: string; playerId: number | null; playerName: string | null; connected: boolean }[] {
    if (!this.hostPeerId) {
      return []
    }

    const conn = this.webrtcPeer.getConnection(this.hostPeerId)
    return [{
      peerId: this.hostPeerId,
      playerId: null,
      playerName: null,
      connected: conn?.open ?? false
    }]
  }

  /**
   * Cleanup connection
   */
  cleanup(): void {
    this.webrtcPeer.cleanup()
    this.hostPeerId = null
    logger.info('GuestConnection cleaned up')
  }
}

// Singleton instance
let guestConnectionInstance: GuestConnectionManager | null = null

export const getGuestConnectionManager = (config?: GuestConnectionManagerConfig): GuestConnectionManager => {
  if (!guestConnectionInstance) {
    guestConnectionInstance = new GuestConnectionManager(config)
  }
  return guestConnectionInstance
}

export const cleanupGuestConnectionManager = (): void => {
  if (guestConnectionInstance) {
    guestConnectionInstance.cleanup()
    guestConnectionInstance = null
  }
}
