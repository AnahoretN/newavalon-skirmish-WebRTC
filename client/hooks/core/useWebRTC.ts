/**
 * useWebRTC - Hook for WebRTC P2P connection management
 *
 * Uses HostManager for host and GuestConnectionManager for guests directly
 * (no intermediate wrapper layer for clarity)
 *
 * Functions:
 * - initializeWebrtcHost - Initialize as host, get peer ID, broadcast to guests
 * - connectAsGuest - Connect to a host peer ID
 * - sendWebrtcAction - Send action to host via WebRTC (guest only)
 */

import { useCallback } from 'react'
import { logger } from '../../utils/logger'
import { broadcastHostPeerId, saveHostData } from '../../host/WebrtcStatePersistence'
import { getHostManager, type HostManager } from '../../host/HostManager'
import { GuestConnectionManager } from '../../host/GuestConnection'

export type WebRTCManager = HostManager | GuestConnectionManager

export interface UseWebRTCProps {
  // WebRTC manager ref - can be HostManager or GuestConnectionManager
  webrtcManagerRef: React.MutableRefObject<WebRTCManager | null>
  // WebRTC refs
  webrtcIsHostRef: React.MutableRefObject<boolean>
  // WebRTC state setters
  setWebrtcIsHost: React.Dispatch<React.SetStateAction<boolean>>
  setConnectionStatus: React.Dispatch<React.SetStateAction<'Connecting' | 'Connected' | 'Disconnected'>>
  setWebrtcHostId: React.Dispatch<React.SetStateAction<string | null>>
  // Game state refs
  gameStateRef: React.MutableRefObject<{ gameId: string | null; players?: Array<{ id: number; name: string }> }>
  localPlayerIdRef: React.MutableRefObject<number | null>
}

export function useWebRTC(props: UseWebRTCProps) {
  const {
    webrtcManagerRef,
    webrtcIsHostRef,
    setWebrtcIsHost,
    setConnectionStatus,
    setWebrtcHostId,
    gameStateRef,
    localPlayerIdRef,
  } = props

  /**
   * Initialize WebRTC as host
   */
  const initializeWebrtcHost = useCallback(async (): Promise<string | null> => {
    try {
      setWebrtcIsHost(true)
      setConnectionStatus('Connecting')

      // Use HostManager directly
      const hostManager = getHostManager()
      webrtcManagerRef.current = hostManager

      const peerId = await hostManager.initialize()
      setWebrtcHostId(peerId)  // Store host peer ID for invite links
      setConnectionStatus('Connected')

      // Broadcast peerId immediately so guests can discover/reconnect
      const currentGameId = gameStateRef.current.gameId
      if (currentGameId) {
        broadcastHostPeerId(peerId, currentGameId)
      }

      // Save host data for auto-restore after F5
      const localPlayer = gameStateRef.current.players?.find(p => p.id === localPlayerIdRef.current)
      saveHostData({
        peerId,
        isHost: true,
        playerName: localPlayer?.name || null
      })
      logger.info('[initializeWebrtcHost] Saved host data for auto-restore')

      return peerId
    } catch (err) {
      logger.error('Failed to initialize WebRTC host:', err)
      setConnectionStatus('Disconnected')
      return null
    }
  }, [setWebrtcIsHost, setConnectionStatus, setWebrtcHostId, gameStateRef, localPlayerIdRef, webrtcManagerRef])

  /**
   * Connect as guest to host via WebRTC
   */
  const connectAsGuest = useCallback(async (hostId: string): Promise<boolean> => {
    try {
      setWebrtcIsHost(false)
      setWebrtcHostId(hostId)  // Store host ID immediately for reconnection tracking
      setConnectionStatus('Connecting')

      // Use GuestConnectionManager directly
      const guestManager = new GuestConnectionManager({
        onMessage: (message) => {
          // Message handling is done via event subscription in useGameState
          logger.debug('[Guest] Received message:', message.type)
        },
        onHostConnected: () => {
          setConnectionStatus('Connected')
        },
        onHostDisconnected: () => {
          setConnectionStatus('Disconnected')
        },
        onError: (error) => {
          logger.error('[Guest] Error:', error)
        }
      })
      webrtcManagerRef.current = guestManager

      await guestManager.connect(hostId)
      setConnectionStatus('Connected')
      return true
    } catch (err) {
      logger.error('Failed to connect as guest:', err)
      setConnectionStatus('Disconnected')
      return false
    }
  }, [setWebrtcIsHost, setConnectionStatus, setWebrtcHostId, webrtcManagerRef])

  /**
   * Send action to host via WebRTC (guest only)
   */
  const sendWebrtcAction = useCallback((actionType: string, actionData: any) => {
    if (!webrtcManagerRef.current) {
      logger.warn(`[sendWebrtcAction] No webrtcManagerRef.current`)
      return false
    }
    if (webrtcIsHostRef.current) {
      logger.warn(`[sendWebrtcAction] Host mode, cannot send action to self`)
      return false
    }
    return webrtcManagerRef.current.sendAction(actionType, actionData)
  }, [webrtcManagerRef, webrtcIsHostRef])

  /**
   * Request to view another player's deck (guest only)
   * Sends REQUEST_DECK_VIEW message to host, host responds with DECK_VIEW_DATA
   */
  const requestDeckView = useCallback((targetPlayerId: number) => {
    if (!webrtcManagerRef.current || webrtcIsHostRef.current) {
      logger.warn('[requestDeckView] Only guests can request deck view from host')
      return false
    }

    // Use guest manager's sendAction
    return webrtcManagerRef.current.sendAction('REQUEST_DECK_VIEW', { targetPlayerId })
  }, [webrtcManagerRef, webrtcIsHostRef])

  /**
   * Send full deck data to host (guest only)
   * Used when player opens deck view - sends full deck so host can provide it to others
   */
  const sendFullDeckToHost = useCallback((playerId: number, deck: any[], deckSize: number) => {
    if (!webrtcManagerRef.current || webrtcIsHostRef.current) {
      logger.warn('[sendFullDeckToHost] Only guests can send deck data to host')
      return false
    }

    return webrtcManagerRef.current.sendFullDeckToHost(playerId, deck, deckSize)
  }, [webrtcManagerRef, webrtcIsHostRef])

  /**
   * Host shares deck data with all guests
   * Used when host opens deck view - sends full deck so guests can see it in same order
   */
  const shareHostDeckWithGuests = useCallback((deck: any[], deckSize: number) => {
    if (!webrtcManagerRef.current || !webrtcIsHostRef.current) {
      logger.warn('[shareHostDeckWithGuests] Only host can share deck data')
      return false
    }

    // For host, use HostManager's broadcast method
    const hostManager = webrtcManagerRef.current as HostManager
    logger.info(`[shareHostDeckWithGuests] Host sharing deck with ${deckSize} cards to all guests`)
    return hostManager.broadcast({
      type: 'HOST_DECK_DATA',
      senderId: hostManager.getPeerId() ?? '',
      data: { deck, deckSize },
      timestamp: Date.now()
    })
  }, [webrtcManagerRef, webrtcIsHostRef])

  return {
    initializeWebrtcHost,
    connectAsGuest,
    sendWebrtcAction,
    requestDeckView,
    sendFullDeckToHost,
    shareHostDeckWithGuests,
  }
}
