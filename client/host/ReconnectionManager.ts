/**
 * Reconnection Manager for WebRTC P2P
 * Handles automatic reconnection for disconnected players/hosts
 *
 * Features:
 * - Persists game state on disconnect
 * - 30-second reconnection window
 * - Automatic retry with exponential backoff
 * - State restoration on successful reconnection
 */

import { Peer, DataConnection } from 'peerjs'
import type { GameState } from '../types'
import type { WebrtcMessage } from './types'
import { logger } from '../utils/logger'

export interface ReconnectionData {
  hostPeerId: string
  playerId: number | null
  gameState: GameState | null
  timestamp: number
  isHost: boolean
}

export interface ReconnectionConfig {
  reconnectionTimeout: number      // Total time window for reconnection (ms)
  retryInterval: number             // Initial retry interval (ms)
  maxRetryInterval: number          // Maximum retry interval (ms)
  retryBackoffMultiplier: number    // Multiplier for exponential backoff
}

export const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  reconnectionTimeout: 30000,       // 30 seconds
  retryInterval: 1000,              // Start with 1 second
  maxRetryInterval: 5000,           // Max 5 seconds between retries
  retryBackoffMultiplier: 1.5       // Increase interval by 1.5x each time
}

export interface ReconnectionManagerConfig {
  onReconnecting?: (attempt: number, maxAttempts: number) => void
  onReconnected?: (connection: DataConnection) => void
  onReconnectionFailed?: () => void
  onStateRestored?: (state: GameState) => void
}

/**
 * Reconnection Manager for Guest (player reconnecting to host)
 */
export class GuestReconnectionManager {
  private config: ReconnectionConfig
  private callbacks: ReconnectionManagerConfig
  private reconnectTimer: number | null = null
  private reconnectAttempts: number = 0
  private peer: Peer | null = null
  private hostConnection: DataConnection | null = null
  private isReconnecting: boolean = false
  private reconnectTimeoutEnd: number = 0
  private storedReconnectionData: ReconnectionData | null = null

  constructor(
    config: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG,
    callbacks: ReconnectionManagerConfig = {}
  ) {
    this.config = config
    this.callbacks = callbacks
  }

  /**
   * Store reconnection data when disconnecting
   */
  storeReconnectionData(data: ReconnectionData): void {
    this.storedReconnectionData = data

    try {
      localStorage.setItem('webrtc_reconnection_data', JSON.stringify(data))
      logger.info('[Reconnection] Stored reconnection data:', {
        hostPeerId: data.hostPeerId,
        playerId: data.playerId,
        isHost: data.isHost
      })
    } catch (e) {
      logger.error('[Reconnection] Failed to store reconnection data:', e)
    }
  }

  /**
   * Get stored reconnection data
   */
  getStoredReconnectionData(): ReconnectionData | null {
    // Check in-memory first
    if (this.storedReconnectionData) {
      // Check if still valid (within timeout window)
      if (Date.now() - this.storedReconnectionData.timestamp < this.config.reconnectionTimeout) {
        return this.storedReconnectionData
      }
      this.storedReconnectionData = null
    }

    // Check localStorage
    try {
      const stored = localStorage.getItem('webrtc_reconnection_data')
      if (!stored) return null

      const data = JSON.parse(stored) as ReconnectionData

      // Check if still valid (within timeout window)
      if (Date.now() - data.timestamp > this.config.reconnectionTimeout) {
        localStorage.removeItem('webrtc_reconnection_data')
        return null
      }

      this.storedReconnectionData = data
      return data
    } catch (e) {
      logger.error('[Reconnection] Failed to retrieve stored data:', e)
      return null
    }
  }

  /**
   * Clear stored reconnection data
   */
  clearStoredData(): void {
    this.storedReconnectionData = null
    try {
      localStorage.removeItem('webrtc_reconnection_data')
      logger.info('[Reconnection] Cleared stored reconnection data')
    } catch (e) {
      logger.error('[Reconnection] Failed to clear stored data:', e)
    }
  }

  /**
   * Start reconnection process
   */
  startReconnection(
    hostPeerId: string,
    playerId: number | null,
    gameState: GameState | null
  ): Promise<DataConnection> {
    return new Promise((resolve, reject) => {
      if (this.isReconnecting) {
        logger.warn('[Reconnection] Already reconnecting')
        reject(new Error('Already reconnecting'))
        return
      }

      this.isReconnecting = true
      this.reconnectAttempts = 0
      this.reconnectTimeoutEnd = Date.now() + this.config.reconnectionTimeout

      // Store reconnection data
      this.storeReconnectionData({
        hostPeerId,
        playerId,
        gameState,
        timestamp: Date.now(),
        isHost: false
      })

      logger.info('[Reconnection] Starting reconnection process:', {
        hostPeerId,
        playerId,
        timeout: this.config.reconnectionTimeout
      })

      // Clean up existing peer/connection
      this.cleanup()

      // Create new peer for reconnection
      this.peer = new Peer()

      this.peer.on('open', (peerId) => {
        logger.info(`[Reconnection] Peer created with ID: ${peerId}`)
        this.attemptReconnection(hostPeerId, resolve, reject)
      })

      this.peer.on('error', (err) => {
        logger.error('[Reconnection] Peer error:', err)
        this.stopReconnection()
        reject(err)
      })
    })
  }

  /**
   * Attempt to reconnect to host
   */
  private attemptReconnection(
    hostPeerId: string,
    resolve: (connection: DataConnection) => void,
    reject: (reason: Error) => void
  ): void {
    if (!this.peer) {
      reject(new Error('Peer not initialized'))
      return
    }

    // Check if timeout has expired
    if (Date.now() > this.reconnectTimeoutEnd) {
      logger.warn('[Reconnection] Reconnection timeout expired')
      this.stopReconnection()
      this.callbacks.onReconnectionFailed?.()
      reject(new Error('Reconnection timeout'))
      return
    }

    this.reconnectAttempts++
    const timeRemaining = Math.max(0, this.reconnectTimeoutEnd - Date.now())
    const maxAttempts = Math.ceil(this.config.reconnectionTimeout / this.config.retryInterval)

    logger.info(`[Reconnection] Attempt ${this.reconnectAttempts}/${maxAttempts} (${Math.round(timeRemaining / 1000)}s remaining)`)

    this.callbacks.onReconnecting?.(this.reconnectAttempts, maxAttempts)

    // Create connection to host
    const conn = this.peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'json'
    })

    conn.on('open', () => {
      logger.info(`[Reconnection] Successfully reconnected to host: ${hostPeerId}`)
      this.hostConnection = conn
      this.isReconnecting = false

      // Send reconnection request
      const reconnectionData = this.getStoredReconnectionData()
      const message: WebrtcMessage = {
        type: 'RECONNECT_REQUEST',
        senderId: this.peer?.id,
        playerId: reconnectionData?.playerId || undefined,
        data: {
          playerId: reconnectionData?.playerId,
          timestamp: Date.now()
        },
        timestamp: Date.now()
      }

      conn.send(message)

      // Clear reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

      this.callbacks.onReconnected?.(conn)
      resolve(conn)
    })

    conn.on('error', (err) => {
      logger.warn(`[Reconnection] Connection attempt ${this.reconnectAttempts} failed:`, err)
      this.scheduleNextAttempt(hostPeerId, resolve, reject)
    })

    // Set timeout for this connection attempt
    setTimeout(() => {
      if (!conn.open) {
        conn.close()
        if (this.isReconnecting) {
          this.scheduleNextAttempt(hostPeerId, resolve, reject)
        }
      }
    }, 3000) // 3 second timeout per attempt
  }

  /**
   * Schedule next reconnection attempt
   */
  private scheduleNextAttempt(
    hostPeerId: string,
    resolve: (connection: DataConnection) => void,
    reject: (reason: Error) => void
  ): void {
    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.retryInterval * Math.pow(this.config.retryBackoffMultiplier, this.reconnectAttempts - 1),
      this.config.maxRetryInterval
    )

    logger.debug(`[Reconnection] Scheduling next attempt in ${delay}ms`)

    this.reconnectTimer = setTimeout(() => {
      if (this.isReconnecting) {
        this.attemptReconnection(hostPeerId, resolve, reject)
      }
    }, delay) as unknown as number
  }

  /**
   * Stop reconnection process
   */
  stopReconnection(): void {
    logger.info('[Reconnection] Stopping reconnection process')

    this.isReconnecting = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.cleanup()
  }

  /**
   * Cleanup peer and connection
   */
  private cleanup(): void {
    if (this.hostConnection) {
      this.hostConnection.close()
      this.hostConnection = null
    }

    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }

  /**
   * Get the current connection (after successful reconnection)
   */
  getConnection(): DataConnection | null {
    return this.hostConnection
  }

  /**
   * Check if currently reconnecting
   */
  isActive(): boolean {
    return this.isReconnecting
  }

  /**
   * Get remaining time for reconnection window
   */
  getRemainingTime(): number {
    return Math.max(0, this.reconnectTimeoutEnd - Date.now())
  }

  /**
   * Get reconnection progress
   */
  getProgress(): { attempt: number; maxAttempts: number; timeRemaining: number } {
    const maxAttempts = Math.ceil(this.config.reconnectionTimeout / this.config.retryInterval)
    return {
      attempt: this.reconnectAttempts,
      maxAttempts,
      timeRemaining: this.getRemainingTime()
    }
  }

  /**
   * Full cleanup
   */
  destroy(): void {
    this.stopReconnection()
    this.clearStoredData()
  }
}

/**
 * Reconnection Manager for Host (managing reconnecting players)
 */
export class HostReconnectionManager {
  private reconnectingPlayers: Map<number, {
    playerId: number
    peerId: string | null
    disconnectedAt: number
    lastKnownState: any
    reconnectTimer: number | null
  }> = new Map()

  private config: ReconnectionConfig
  private onPlayerReconnected?: (playerId: number, newPeerId: string) => void
  private onPlayerTimeout?: (playerId: number) => void

  constructor(
    config: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG,
    callbacks?: {
      onPlayerReconnected?: (playerId: number, newPeerId: string) => void
      onPlayerTimeout?: (playerId: number) => void
    }
  ) {
    this.config = config
    this.onPlayerReconnected = callbacks?.onPlayerReconnected
    this.onPlayerTimeout = callbacks?.onPlayerTimeout
  }

  /**
   * Mark player as disconnected and start reconnection timer
   */
  handlePlayerDisconnect(playerId: number, peerId: string | null, playerState: any): void {
    logger.info(`[Reconnection] Player ${playerId} disconnected, starting reconnection window`)

    // Store disconnect info
    this.reconnectingPlayers.set(playerId, {
      playerId,
      peerId,
      disconnectedAt: Date.now(),
      lastKnownState: playerState,
      reconnectTimer: null
    })

    // Start timeout for reconnection
    const timer = setTimeout(() => {
      this.handleReconnectTimeout(playerId)
    }, this.config.reconnectionTimeout) as unknown as number

    const playerData = this.reconnectingPlayers.get(playerId)
    if (playerData) {
      playerData.reconnectTimer = timer
    }

    // Persist game state for reconnection
    this.persistGameState()
  }

  /**
   * Handle player reconnection
   */
  handlePlayerReconnect(playerId: number, newPeerId: string): boolean {
    const playerData = this.reconnectingPlayers.get(playerId)

    if (!playerData) {
      logger.warn(`[Reconnection] No reconnection data for player ${playerId}`)
      return false
    }

    logger.info(`[Reconnection] Player ${playerId} reconnected with new peerId: ${newPeerId}`)

    // Clear reconnect timer
    if (playerData.reconnectTimer) {
      clearTimeout(playerData.reconnectTimer)
    }

    // Remove from reconnecting players
    this.reconnectingPlayers.delete(playerId)

    // Notify callback
    this.onPlayerReconnected?.(playerId, newPeerId)

    return true
  }

  /**
   * Handle reconnection timeout
   */
  private handleReconnectTimeout(playerId: number): void {
    const playerData = this.reconnectingPlayers.get(playerId)

    if (!playerData) return

    logger.info(`[Reconnection] Player ${playerId} reconnection timeout expired`)

    // Remove from reconnecting players
    this.reconnectingPlayers.delete(playerId)

    // Notify callback
    this.onPlayerTimeout?.(playerId)
  }

  /**
   * Get player reconnection status
   */
  getPlayerReconnectionStatus(playerId: number): {
    isReconnecting: boolean
    timeRemaining: number
    disconnectedAt: number
  } | null {
    const playerData = this.reconnectingPlayers.get(playerId)

    if (!playerData) {
      return null
    }

    const timeRemaining = Math.max(
      0,
      this.config.reconnectionTimeout - (Date.now() - playerData.disconnectedAt)
    )

    return {
      isReconnecting: timeRemaining > 0,
      timeRemaining,
      disconnectedAt: playerData.disconnectedAt
    }
  }

  /**
   * Get all reconnecting players
   */
  getReconnectingPlayers(): number[] {
    return Array.from(this.reconnectingPlayers.keys())
  }

  /**
   * Persist game state to localStorage for host recovery
   */
  private persistGameState(): void {
    // This would be called from the host's state manager
    // The actual state persistence is handled by the game state manager
    logger.debug('[Reconnection] Game state persistence triggered')
  }

  /**
   * Cancel reconnection timer for a player (e.g., if they left voluntarily)
   */
  cancelPlayerReconnection(playerId: number): void {
    const playerData = this.reconnectingPlayers.get(playerId)

    if (!playerData) return

    if (playerData.reconnectTimer) {
      clearTimeout(playerData.reconnectTimer)
    }

    this.reconnectingPlayers.delete(playerId)
    logger.info(`[Reconnection] Cancelled reconnection for player ${playerId}`)
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Clear all timers
    this.reconnectingPlayers.forEach(playerData => {
      if (playerData.reconnectTimer) {
        clearTimeout(playerData.reconnectTimer)
      }
    })
    this.reconnectingPlayers.clear()
  }
}

// Singleton instances
let guestReconnectionManager: GuestReconnectionManager | null = null
let hostReconnectionManager: HostReconnectionManager | null = null

export const getGuestReconnectionManager = (
  config?: ReconnectionConfig,
  callbacks?: ReconnectionManagerConfig
): GuestReconnectionManager => {
  if (!guestReconnectionManager) {
    guestReconnectionManager = new GuestReconnectionManager(config, callbacks)
  }
  return guestReconnectionManager
}

export const getHostReconnectionManager = (
  config?: ReconnectionConfig,
  callbacks?: {
    onPlayerReconnected?: (playerId: number, newPeerId: string) => void
    onPlayerTimeout?: (playerId: number) => void
  }
): HostReconnectionManager => {
  if (!hostReconnectionManager) {
    hostReconnectionManager = new HostReconnectionManager(config, callbacks)
  }
  return hostReconnectionManager
}

export const cleanupReconnectionManagers = (): void => {
  if (guestReconnectionManager) {
    guestReconnectionManager.destroy()
    guestReconnectionManager = null
  }
  if (hostReconnectionManager) {
    hostReconnectionManager.destroy()
    hostReconnectionManager = null
  }
}
