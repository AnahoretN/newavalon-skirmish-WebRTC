/**
 * useWebRTC Hook
 *
 * Manages WebRTC P2P connections using HostManager or GuestManager
 * Provides a unified interface for both host and guest modes
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { GameState } from '../types'
import { HostManager } from '../webrtc/host/HostManager'
import { GuestManager } from '../webrtc/guest/GuestManager'
import { getWebrtcManager } from '../utils/webrtcManager'
import { logger } from '../utils/logger'
import type { WebrtcMessage, WebrtcConnectionEvent } from '../webrtc/types'

export interface UseWebRTCOptions {
  onGameStateChange?: (state: GameState) => void
  onGuestJoined?: (data: { peerId: string }) => void
  onGuestDisconnected?: (data: { peerId: string }) => void
  onHostDisconnected?: () => void
  onError?: (error: any) => void
}

export interface UseWebRTCReturn {
  isHost: boolean
  isConnected: boolean
  hostId: string | null
  manager: HostManager | GuestManager | null
  initializeAsHost: (existingPeerId?: string) => Promise<string | null>
  connectAsGuest: (hostPeerId: string, playerId?: number) => Promise<boolean>
  disconnect: () => void
  sendAction: (actionType: string, actionData: any) => boolean
  broadcastState: (state: GameState, excludePeerId?: string) => void
  broadcastDelta: (delta: any, excludePeerId?: string) => void
  sendMessage: (peerId: string, message: WebrtcMessage) => boolean
}

/**
 * useWebRTC - Unified WebRTC management hook
 */
export const useWebRTC = (options: UseWebRTCOptions = {}): UseWebRTCReturn => {
  const [isHost, setIsHost] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [hostId, setHostId] = useState<string | null>(null)

  const managerRef = useRef<HostManager | GuestManager | null>(null)
  const webrtcManagerRef = useRef<ReturnType<typeof getWebrtcManager> | null>(null)

  // Initialize base WebRTC manager
  useEffect(() => {
    const webrtcSetting = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcSetting) {
      return
    }

    webrtcManagerRef.current = getWebrtcManager()
    logger.info('[useWebRTC] WebRTC manager initialized')

    return () => {
      managerRef.current?.cleanup()
    }
  }, [])

  /**
   * Initialize as host
   */
  const initializeAsHost = useCallback(async (existingPeerId?: string): Promise<string | null> => {
    if (!webrtcManagerRef.current) {
      logger.error('[useWebRTC] Cannot initialize host - manager not ready')
      return null
    }

    try {
      // Create HostManager
      if (!managerRef.current || !(managerRef.current instanceof HostManager)) {
        managerRef.current = new HostManager(webrtcManagerRef.current, {
          autoSaveState: true,
          autoBroadcastState: true,
          stateSaveInterval: 5000
        })

        // Setup event handlers
        const hostManager = managerRef.current as HostManager

        hostManager.on('guest_joined', (data) => {
          logger.info(`[useWebRTC] Guest joined: ${data.peerId}`)
          setIsConnected(true)
          options.onGuestJoined?.(data)
        })

        hostManager.on('guest_disconnected', (data) => {
          logger.info(`[useWebRTC] Guest disconnected: ${data.peerId}`)
          options.onGuestDisconnected?.(data)
        })

        hostManager.on('action', (data) => {
          logger.info(`[useWebRTC] Action from player ${data.playerId}: ${data.actionType}`)
          // Handle action - this will be processed by parent
        })

        hostManager.on('state_changed', (state) => {
          options.onGameStateChange?.(state)
        })

        hostManager.on('error', (data) => {
          options.onError?.(data.error)
        })
      }

      setIsHost(true)
      const peerId = await (managerRef.current as HostManager).initialize(existingPeerId)
      if (peerId) {
        setHostId(peerId)
        setIsConnected(true)
      }
      return peerId
    } catch (err) {
      logger.error('[useWebRTC] Failed to initialize host:', err)
      options.onError?.(err)
      return null
    }
  }, [options])

  /**
   * Connect as guest
   */
  const connectAsGuest = useCallback(async (hostPeerId: string, playerId?: number): Promise<boolean> => {
    if (!webrtcManagerRef.current) {
      logger.error('[useWebRTC] Cannot connect as guest - manager not ready')
      return false
    }

    try {
      // Create GuestManager
      if (!managerRef.current || !(managerRef.current instanceof GuestManager)) {
        managerRef.current = new GuestManager(webrtcManagerRef.current, {
          reconnectDelay: 2000,
          maxReconnectAttempts: 10,
          connectionTimeout: 30000
        })

        // Setup event handlers
        const guestManager = managerRef.current as GuestManager

        guestManager.on('connected_to_host', () => {
          logger.info('[useWebRTC] Connected to host')
          setIsConnected(true)
        })

        guestManager.on('host_disconnected', () => {
          logger.warn('[useWebRTC] Host disconnected')
          setIsConnected(false)
          options.onHostDisconnected?.()
        })

        guestManager.on('message_received', (data) => {
          logger.debug(`[useWebRTC] Message: ${data.message.type}`)
          // Handle message - parent will process
        })

        guestManager.on('state_changed', (state) => {
          options.onGameStateChange?.(state)
        })

        guestManager.on('failed', (data) => {
          options.onError?.(data.error)
        })
      }

      setIsHost(false)
      setHostId(hostPeerId)
      return await (managerRef.current as GuestManager).connectToHost(hostPeerId)
    } catch (err) {
      logger.error('[useWebRTC] Failed to connect as guest:', err)
      options.onError?.(err)
      return false
    }
  }, [options])

  /**
   * Disconnect
   */
  const disconnect = useCallback(() => {
    managerRef.current?.cleanup()
    managerRef.current = null
    setIsConnected(false)
    setHostId(null)
    setIsHost(false)
  }, [])

  /**
   * Send action (guest only)
   */
  const sendAction = useCallback((actionType: string, actionData: any): boolean => {
    if (managerRef.current instanceof GuestManager) {
      return managerRef.current.sendAction(actionType, actionData)
    }
    logger.warn('[useWebRTC] sendAction called but not a guest')
    return false
  }, [])

  /**
   * Broadcast state (host only)
   */
  const broadcastState = useCallback((state: GameState, excludePeerId?: string) => {
    if (managerRef.current instanceof HostManager) {
      managerRef.current.setGameState(state)
    }
  }, [])

  /**
   * Broadcast delta (host only)
   */
  const broadcastDelta = useCallback((delta: any, excludePeerId?: string) => {
    if (managerRef.current instanceof HostManager) {
      // Broadcast is handled by HostManager's state_changed event
    }
  }, [])

  /**
   * Send message to specific peer
   */
  const sendMessage = useCallback((peerId: string, message: WebrtcMessage): boolean => {
    if (managerRef.current) {
      return (managerRef.current as any).sendMessage?.(peerId, message) ?? false
    }
    return false
  }, [])

  return {
    isHost,
    isConnected,
    hostId,
    manager: managerRef.current,
    initializeAsHost,
    connectAsGuest,
    disconnect,
    sendAction,
    broadcastState,
    broadcastDelta,
    sendMessage
  }
}

export default useWebRTC
