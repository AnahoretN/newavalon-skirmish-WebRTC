/**
 * Unified WebRTC Manager
 *
 * This is the NEW unified WebRTC system that replaces the old WebrtcManager.
 * It automatically switches between HostConnectionManager and GuestConnectionManager
 * based on the mode (host/guest).
 *
 * API Compatibility:
 * - This class provides the same methods as the old WebrtcManager
 * - Used by hooks in client/hooks/core/useWebRTC.ts
 */

import type { WebrtcMessage, WebrtcEventHandler, WebrtcEvent, WebrtcConnectionInfo } from './types'
import type { GameState, StateDelta } from '../types'
import { HostConnectionManager } from './HostConnectionManager'
import { GuestConnectionManager } from './GuestConnection'
import { logger } from '../utils/logger'

type ConnectionMode = 'host' | 'guest' | null

export class WebrtcManagerNew {
  private mode: ConnectionMode = null
  private hostManager: HostConnectionManager | null = null
  private guestManager: GuestConnectionManager | null = null
  private eventHandlers: Set<WebrtcEventHandler> = new Set()

  // For backward compatibility with old WebrtcManager
  public isReconnecting: boolean = false

  /**
   * Initialize as Host - creates Peer and waits for connections
   */
  async initializeAsHost(existingPeerId?: string): Promise<string> {
    if (this.mode === 'guest') {
      this.cleanup()
    }

    this.mode = 'host'
    this.hostManager = new HostConnectionManager({
      enableReconnection: true
    })

    // Subscribe to host events and forward to our handlers
    this.hostManager.on((event) => this.emitEvent(event))

    logger.info('[WebrtcManager] Initializing as Host...' + (existingPeerId ? ` with existing peerId: ${existingPeerId}` : ''))
    return this.hostManager.initialize()
  }

  /**
   * Initialize as Guest - connects to host
   */
  async initializeAsGuest(hostPeerId: string): Promise<void> {
    if (this.mode === 'host') {
      this.cleanup()
    }

    this.mode = 'guest'
    this.guestManager = new GuestConnectionManager({
      onMessage: (message) => this.emitEvent({ type: 'message_received', data: message }),
      onHostConnected: () => this.emitEvent({ type: 'connected_to_host' }),
      onHostDisconnected: () => this.emitEvent({ type: 'host_disconnected' }),
      onError: (error) => this.emitEvent({ type: 'error', data: error })
    })

    logger.info(`[WebrtcManager] Initializing as Guest, connecting to host: ${hostPeerId}`)
    await this.guestManager.connect(hostPeerId)
  }

  /**
   * Initialize as Guest after page reload - connects to host with reconnection message
   */
  async initializeAsReconnectingGuest(hostPeerId: string, playerId: number): Promise<void> {
    if (this.mode === 'host') {
      this.cleanup()
    }

    this.mode = 'guest'
    this.isReconnecting = true

    this.guestManager = new GuestConnectionManager({
      onMessage: (message) => this.emitEvent({ type: 'message_received', data: message }),
      onHostConnected: () => {
        this.isReconnecting = false
        this.emitEvent({ type: 'connected_to_host' })
      },
      onHostDisconnected: () => this.emitEvent({ type: 'host_disconnected' }),
      onError: (error) => {
        this.isReconnecting = false
        this.emitEvent({ type: 'error', data: error })
      }
    })

    logger.info(`[WebrtcManager] Initializing as Reconnecting Guest, connecting to host: ${hostPeerId}, playerId: ${playerId}`)
    await this.guestManager.connectAsReconnecting(hostPeerId, playerId)
    this.isReconnecting = false
  }

  // ==================== Host Methods ====================

  /**
   * Accept guest and send current game state (host only)
   */
  acceptGuest(peerId: string, gameState: GameState, playerId: number): void {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return
    }
    this.hostManager.acceptGuest(peerId, gameState, playerId)
  }

  /**
   * Accept guest with minimal game info (host only)
   */
  acceptGuestMinimal(peerId: string, minimalInfo: any, playerId: number): void {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return
    }
    this.hostManager.acceptGuestMinimal(peerId, minimalInfo, playerId)
  }

  /**
   * Broadcast game state to all guests (host only)
   */
  broadcastGameState(gameState: GameState, excludePeerId?: string): void {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return
    }
    this.hostManager.broadcastGameState(gameState, excludePeerId)
  }

  /**
   * Broadcast state delta to all guests (host only)
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return
    }
    this.hostManager.broadcastStateDelta(delta, excludePeerId)
  }

  /**
   * Broadcast card status changes to all guests (host only)
   * OPTIMIZED: Only sends {cardId, statusType, action} instead of full gameState
   */
  broadcastCardStatusSync(changes: any[], excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcastCardStatusSync(changes, excludePeerId)
  }

  /**
   * Broadcast board card data to all guests (host only)
   * OPTIMIZED: Only sends essential card data (cardId, row, col, statuses) instead of full gameState
   */
  broadcastBoardCardSync(cards: any[], action: 'update' | 'remove' | 'replace', excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcastBoardCardSync(cards, action, excludePeerId)
  }

  /**
   * Broadcast to all guests (host only)
   */
  broadcastToGuests(message: WebrtcMessage, excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcast(message, excludePeerId)
  }

  /**
   * Send to specific guest (host only)
   */
  sendToGuest(peerId: string, message: WebrtcMessage): boolean {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return false
    }
    return this.hostManager.sendToGuest(peerId, message)
  }

  // ==================== Guest Methods ====================

  /**
   * Send action to host (guest only)
   */
  sendAction(actionType: string, actionData: any): boolean {
    if (!this.guestManager) {
      logger.warn('[WebrtcManager] Not in guest mode')
      return false
    }
    return this.guestManager.sendAction(actionType, actionData)
  }

  /**
   * Send state delta to host (guest only)
   */
  sendStateDelta(delta: StateDelta): boolean {
    if (!this.guestManager) {
      logger.warn('[WebrtcManager] Not in guest mode')
      return false
    }
    return this.guestManager.sendStateDelta(delta)
  }

  /**
   * Send state to host (guest only)
   */
  sendStateToHost(gameState: GameState, localPlayerId: number | null): boolean {
    if (!this.guestManager) {
      logger.warn('[WebrtcManager] Not in guest mode')
      return false
    }
    return this.guestManager.sendStateToHost(gameState, localPlayerId)
  }

  /**
   * Send full deck to host (guest only)
   */
  sendFullDeckToHost(localPlayerId: number, deck: any[], deckSize: number): boolean {
    if (!this.guestManager) {
      logger.warn('[WebrtcManager] Not in guest mode')
      return false
    }
    return this.guestManager.sendFullDeckToHost(localPlayerId, deck, deckSize)
  }

  /**
   * Send custom deck data to host (guest only)
   */
  sendCustomDeckData(playerId: number, deckCards: any[], isCustomDeck: boolean): boolean {
    if (!this.guestManager) {
      logger.warn('[WebrtcManager] Not in guest mode')
      return false
    }
    return this.guestManager.sendCustomDeckData(playerId, deckCards, isCustomDeck)
  }

  /**
   * Send message to host (guest only)
   * Generic method for sending any WebrtcMessage to host
   */
  sendMessageToHost(message: WebrtcMessage): boolean {
    if (this.mode !== 'guest' || !this.guestManager) {
      // Silently fail if not in guest mode (can happen during initialization)
      return false
    }
    return this.guestManager.sendMessage(message)
  }

  // ==================== Codec Methods (Host only) ====================

  broadcastCardState(gameState: GameState, localPlayerId: number | null, excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcastCardState(gameState, localPlayerId, excludePeerId)
  }

  broadcastAbilityEffect(effectType: any, data: any, excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcastAbilityEffect(effectType, data, excludePeerId)
  }

  broadcastSessionEvent(eventType: number, data: any, excludePeerId?: string): number {
    if (!this.hostManager) {
      logger.warn('[WebrtcManager] Not in host mode')
      return 0
    }
    return this.hostManager.broadcastSessionEvent(eventType, data, excludePeerId)
  }

  // ==================== Getters ====================

  /**
   * Get current Peer ID
   */
  getPeerId(): string | null {
    if (this.mode === 'host' && this.hostManager) {
      return this.hostManager.getPeerId()
    }
    if (this.mode === 'guest' && this.guestManager) {
      return this.guestManager.getPeerId()
    }
    return null
  }

  /**
   * Get host Peer ID (for guests)
   */
  getHostPeerId(): string | null {
    if (this.mode === 'guest' && this.guestManager) {
      return this.guestManager.getHostPeerId()
    }
    // For host, return own peer ID
    if (this.mode === 'host' && this.hostManager) {
      return this.hostManager.getPeerId()
    }
    return null
  }

  /**
   * Get connection info for all connected peers
   */
  getConnectionInfo(): WebrtcConnectionInfo[] {
    if (this.mode === 'host' && this.hostManager) {
      return this.hostManager.getConnectionInfo()
    }
    if (this.mode === 'guest' && this.guestManager) {
      return this.guestManager.getConnectionInfo() as WebrtcConnectionInfo[]
    }
    return []
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (this.mode === 'host' && this.hostManager) {
      return this.hostManager.hasGuests()
    }
    if (this.mode === 'guest' && this.guestManager) {
      return this.guestManager.isConnected()
    }
    return false
  }

  /**
   * Check if host mode
   */
  isHostMode(): boolean {
    return this.mode === 'host'
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    if (this.mode === 'host' && this.hostManager) {
      return this.hostManager.getGuestCount()
    }
    if (this.mode === 'guest' && this.guestManager) {
      return this.guestManager.getConnectionCount()
    }
    return 0
  }

  /**
   * Get guest info (host only)
   */
  getGuest(peerId: string) {
    if (!this.hostManager) {
      return undefined
    }
    return this.hostManager.getGuest(peerId)
  }

  /**
   * Get guest by player ID (host only)
   */
  getGuestByPlayerId(playerId: number) {
    if (!this.hostManager) {
      return undefined
    }
    return this.hostManager.getGuestByPlayerId(playerId)
  }

  /**
   * Set guest player ID (host only)
   */
  setGuestPlayerId(peerId: string, playerId: number): void {
    if (!this.hostManager) {
      return
    }
    this.hostManager.setGuestPlayerId(peerId, playerId)
  }

  /**
   * Check if player is reconnecting (host only)
   */
  isPlayerReconnecting(playerId: number): boolean {
    if (!this.hostManager) {
      return false
    }
    return this.hostManager.isPlayerReconnecting(playerId)
  }

  // ==================== Event Handling ====================

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
    logger.info('[WebrtcManager] Cleaning up...')

    if (this.hostManager) {
      this.hostManager.cleanup()
      this.hostManager = null
    }

    if (this.guestManager) {
      this.guestManager.cleanup()
      this.guestManager = null
    }

    this.mode = null
    this.isReconnecting = false

    logger.info('[WebrtcManager] Cleaned up')
  }

  /**
   * Expose peer property for backward compatibility
   */
  get peer() {
    if (this.mode === 'host' && this.hostManager) {
      // HostConnectionManager doesn't expose peer directly
      // Return null for now - this is a rare edge case
      return null
    }
    if (this.mode === 'guest' && this.guestManager) {
      // GuestConnectionManager doesn't expose peer directly
      return null
    }
    return null
  }
}

// Singleton instance
let webrtcManagerInstance: WebrtcManagerNew | null = null

export const getWebrtcManagerNew = (): WebrtcManagerNew => {
  if (!webrtcManagerInstance) {
    webrtcManagerInstance = new WebrtcManagerNew()
  }
  return webrtcManagerInstance
}

export const cleanupWebrtcManagerNew = (): void => {
  if (webrtcManagerInstance) {
    webrtcManagerInstance.cleanup()
    webrtcManagerInstance = null
  }
}
