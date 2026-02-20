/**
 * Host Connection Manager
 * Handles WebRTC peer-to-peer connections for the host
 *
 * This is the NEW unified WebRTC system that will replace WebrtcManager
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
import { serializeDeltaBase64, serializeGameState } from '../utils/webrtcSerialization'
import { encodeAbilityEffect } from '../utils/abilityMessages'
import { encodeSessionEvent } from '../utils/sessionMessages'
import { AbilityEffectType } from '../types/codec'
import { createPersonalizedGameState } from './StatePersonalization'

// Enable/disable optimized serialization
const USE_OPTIMIZED_SERIALIZATION = true

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
      const guest = this.guests.get(peerId)
      const playerId = guest?.playerId

      this.connections.delete(peerId)
      this.guests.delete(peerId)

      // Mark player as reconnecting if reconnection is enabled
      if (playerId !== null && playerId !== undefined && this.config.enableReconnection) {
        this.markPlayerReconnecting(playerId, peerId)
      }

      this.emitEvent({
        type: 'guest_disconnected',
        data: { peerId, playerId }
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
    const guest = this.guests.get(fromPeerId)
    const playerId = guest?.playerId ?? message.playerId ?? 'unknown'

    // Log important messages for debugging
    if (message.type === 'SET_TARGETING_MODE' || message.type === 'CLEAR_TARGETING_MODE') {
      logger.info(`[HostConnectionManager] Received ${message.type} from peer ${fromPeerId} (player ${playerId})`, {
        hasData: !!message.data,
        hasTargetingMode: !!message.data?.targetingMode,
        targetingModePlayerId: message.data?.targetingMode?.playerId,
        timestamp: message.timestamp
      })
    } else {
      logger.debug(`Received WebRTC message from ${fromPeerId}:`, message.type)
    }

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
      logger.info(`[sendToGuest] Sending ${message.type} to ${peerId}`)
      conn.send(message)
      logger.info(`[sendToGuest] Sent ${message.type} to ${peerId} successfully`)
      return true
    } catch (err) {
      logger.error(`[sendToGuest] Failed to send message to ${peerId}:`, err)
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
   * Accept guest and send current game state (binary optimized)
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

    try {
      const stateData = serializeGameState(gameState, playerId)
      const base64Data = btoa(String.fromCharCode(...stateData))

      const message: WebrtcMessage = {
        type: 'JOIN_ACCEPT_BINARY',
        senderId: this.peer?.id,
        playerId: playerId,
        data: base64Data,
        timestamp: Date.now()
      }

      conn.send(message)
      logger.info(`[acceptGuest] Sent JOIN_ACCEPT_BINARY to ${peerId}, state size: ${base64Data.length} chars`)
      return true
    } catch (err) {
      logger.error(`[acceptGuest] Failed to send JOIN_ACCEPT to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Broadcast game state to all guests (personalized)
   */
  broadcastGameState(gameState: GameState, excludePeerId?: string): void {
    if (this.connections.size === 0) {
      logger.debug('[broadcastGameState] No guests to broadcast to')
      return
    }

    // Log scores being broadcast for debugging
    const scores = gameState.players.map(p => `P${p.id}:${p.score}`).join(', ')
    logger.info(`[broadcastGameState] Broadcasting state with scores: ${scores}, currentPhase=${gameState.currentPhase}, activePlayerId=${gameState.activePlayerId}`)

    let successCount = 0

    this.connections.forEach((conn, peerId) => {
      // Skip excluded peer or closed connections
      if (!conn.open || (excludePeerId && peerId === excludePeerId)) {
        return
      }

      // Get player ID for this guest
      const guest = this.guests.get(peerId)
      if (!guest) {
        return
      }

      try {
        // Create personalized state for this guest
        const personalizedState = createPersonalizedGameState(gameState, guest.playerId)

        const message: WebrtcMessage = {
          type: 'STATE_UPDATE_COMPACT',
          senderId: this.peer?.id,
          data: { gameState: personalizedState },
          timestamp: Date.now()
        }

        conn.send(message)
        successCount++
      } catch (err) {
        logger.error(`[broadcastGameState] Failed to send to guest ${peerId} (player ${guest.playerId}):`, err)
      }
    })

    logger.debug(`[broadcastGameState] Sent to ${successCount}/${this.connections.size} guests`)
  }

  /**
   * Broadcast state delta to all guests (optimized binary format)
   */
  broadcastStateDelta(delta: StateDelta, excludePeerId?: string): void {
    if (USE_OPTIMIZED_SERIALIZATION) {
      const base64Data = serializeDeltaBase64(delta)

      const message: WebrtcMessage = {
        type: 'STATE_DELTA_BINARY',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      logger.info(`[broadcastStateDelta] Sending BINARY STATE_DELTA (base64): ${base64Data.length} chars, playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}`)
      this.broadcast(message, excludePeerId)
      logger.info(`[broadcastStateDelta] Sent STATE_DELTA from player ${delta.sourcePlayerId} to ${this.connections.size} guests`)
    } else {
      // Fallback to JSON format
      const message: WebrtcMessage = {
        type: 'STATE_DELTA',
        senderId: this.peer?.id,
        data: { delta },
        timestamp: Date.now()
      }
      this.broadcast(message, excludePeerId)
    }
  }

  // ==================== Codec Methods ====================

  /**
   * Broadcast card state to all guests (new codec)
   */
  broadcastCardState(gameState: GameState, localPlayerId: number | null, excludePeerId?: string): number {
    try {
      const stateData = serializeGameState(gameState, localPlayerId)
      const base64Data = btoa(String.fromCharCode(...stateData))

      const message: WebrtcMessage = {
        type: 'CARD_STATE',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcast(message, excludePeerId)
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
      const base64Data = btoa(String.fromCharCode(...effectData))

      const message: WebrtcMessage = {
        type: 'ABILITY_EFFECT',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcast(message, excludePeerId)
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
      const base64Data = btoa(String.fromCharCode(...eventData))

      const message: WebrtcMessage = {
        type: 'SESSION_EVENT',
        senderId: this.peer?.id,
        data: base64Data,
        timestamp: Date.now()
      }

      const successCount = this.broadcast(message, excludePeerId)
      logger.debug(`[broadcastSessionEvent] Sent event ${eventType} to ${successCount} guests`)
      return successCount
    } catch (err) {
      logger.error('[broadcastSessionEvent] Failed to encode/broadcast event:', err)
      return 0
    }
  }

  // ==================== Convenience Methods ====================

  /**
   * Highlight cell convenience method
   */
  broadcastHighlight(row: number, col: number, playerId: number, excludePeerId?: string): number {
    return this.broadcastAbilityEffect(
      AbilityEffectType.HIGHLIGHT_CELL,
      { sourcePos: { row, col }, playerId },
      excludePeerId
    )
  }

  /**
   * Floating text convenience method
   */
  broadcastFloatingText(row: number, col: number, text: string, excludePeerId?: string): number {
    return this.broadcastAbilityEffect(
      AbilityEffectType.FLOATING_TEXT,
      { sourcePos: { row, col }, text },
      excludePeerId
    )
  }

  /**
   * Targeting mode convenience method
   */
  broadcastTargetingMode(
    sourcePos: { row: number; col: number },
    targetPositions: Array<{ row: number; col: number }>,
    excludePeerId?: string
  ): number {
    return this.broadcastAbilityEffect(
      AbilityEffectType.TARGETING_MODE,
      { sourcePos, targetPositions },
      excludePeerId
    )
  }

  /**
   * Clear targeting convenience method
   */
  broadcastClearTargeting(excludePeerId?: string): number {
    return this.broadcastAbilityEffect(
      AbilityEffectType.CLEAR_TARGETING,
      {},
      excludePeerId
    )
  }

  /**
   * Player connected convenience method
   */
  broadcastPlayerConnected(playerId: number, playerName: string, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x01, // PLAYER_CONNECTED
      { playerId, playerName },
      excludePeerId
    )
  }

  /**
   * Player disconnected convenience method
   */
  broadcastPlayerDisconnected(playerId: number, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x02, // PLAYER_DISCONNECTED
      { playerId },
      excludePeerId
    )
  }

  /**
   * Game start convenience method
   */
  broadcastGameStart(startingPlayerId: number, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x03, // GAME_START
      { startingPlayerId },
      excludePeerId
    )
  }

  /**
   * Round start convenience method
   */
  broadcastRoundStart(roundNumber: number, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x04, // ROUND_START
      { roundNumber },
      excludePeerId
    )
  }

  /**
   * Round end convenience method
   */
  broadcastRoundEnd(roundNumber: number, winners: number[], excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x05, // ROUND_END
      { roundNumber, winners },
      excludePeerId
    )
  }

  /**
   * Phase change convenience method
   */
  broadcastPhaseChange(newPhase: number, newActivePlayerId?: number, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x06, // PHASE_CHANGE
      { newPhase, newActivePlayerId },
      excludePeerId
    )
  }

  /**
   * Turn change convenience method
   */
  broadcastTurnChange(newActivePlayerId: number, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x07, // TURN_CHANGE
      { newActivePlayerId },
      excludePeerId
    )
  }

  /**
   * Game end convenience method
   */
  broadcastGameEnd(winner: number | null, excludePeerId?: string): number {
    return this.broadcastSessionEvent(
      0x08, // GAME_END
      { gameWinner: winner },
      excludePeerId
    )
  }

  /**
   * Send action to all guests (relayed from host)
   */
  sendAction(actionType: string, actionData: any): boolean {
    const message: WebrtcMessage = {
      type: 'ACTION' as any,
      senderId: this.peer?.id,
      data: { actionType, actionData },
      timestamp: Date.now()
    }

    return this.broadcast(message) > 0
  }

  // ==================== Getters ====================

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
    if (!data) {
      return false
    }

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
    if (!data) {
      return 0
    }

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
    logger.info('Cleaning up HostConnectionManager...')

    this.connections.forEach(conn => conn.close())
    this.connections.clear()
    this.guests.clear()
    this.reconnectingPlayers.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) {
        // Ignore cleanup errors
      }
      this.peer = null
    }

    logger.info('HostConnectionManager cleaned up')
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
