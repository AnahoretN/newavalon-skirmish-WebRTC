/**
 * Connection Base Class
 *
 * Base class for WebRTC connections with common functionality
 * Used by both HostManager and GuestManager
 */

import type { WebrtcMessage, WebrtcConnectionEvent, WebrtcConnectionEventData } from '../types'
import type { WebrtcManager as WebrtcManagerType } from '../../utils/webrtcManager'
import { logger } from '../../utils/logger'

export interface ConnectionConfig {
  connectionTimeout: number
  heartbeatInterval: number
  maxMissedHeartbeats: number
}

export class ConnectionBase {
  protected manager: WebrtcManagerType
  protected connections: Map<string, any> = new Map()
  protected eventHandlers: Map<WebrtcConnectionEvent, Set<Function>> = new Map()
  protected config: ConnectionConfig

  constructor(manager: WebrtcManagerType, config: ConnectionConfig = {}) {
    this.manager = manager
    this.connections = new Map()
    this.eventHandlers = new Map()

    // Default config
    this.config = {
      connectionTimeout: 30000,        // 30 seconds
      heartbeatInterval: 15000,          // 15 seconds
      maxMissedHeartbeats: 3,
      ...config
    }
  }

  /**
   * Register event handler
   */
  on(event: WebrtcConnectionEvent, handler: (data: any) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler)
    }
  }

  /**
   * Emit event to all registered handlers
   */
  protected emit(event: WebrtcConnectionEvent, data?: any): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler({ type: event, data })
        } catch (err) {
          logger.error(`Error in ${event} handler:`, err)
        }
      })
    }
  }

  /**
   * Send message through connection
   */
  protected sendMessage(peerId: string, message: WebrtcMessage): boolean {
    const connection = this.connections.get(peerId)
    if (!connection) {
      logger.warn(`[ConnectionBase] No connection found for peer ${peerId}`)
      return false
    }

    try {
      connection.send(message)
      logger.debug(`[ConnectionBase] Sent ${message.type} to ${peerId}`)
      return true
    } catch (err) {
      logger.error(`[ConnectionBase] Failed to send ${message.type} to ${peerId}:`, err)
      return false
    }
  }

  /**
   * Broadcast message to all connections
   */
  protected broadcast(message: WebrtcMessage, excludePeerId?: string): void {
    this.connections.forEach((connection, peerId) => {
      if (peerId !== excludePeerId && connection.open) {
        try {
          connection.send(message)
        } catch (err) {
          logger.error(`[ConnectionBase] Failed to send ${message.type} to ${peerId}:`, err)
        }
      }
    })
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.connections.clear()
    this.eventHandlers.clear()
  }
}
