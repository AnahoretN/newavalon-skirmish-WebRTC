/**
 * useWebRTC - Hook for WebRTC P2P connection management
 *
 * Extracted from useGameState.ts for separation of concerns
 *
 * Functions:
 * - initializeWebrtcHost - Initialize as host, get peer ID, broadcast to guests
 * - connectAsGuest - Connect to a host peer ID
 * - sendWebrtcAction - Send action to host via WebRTC (guest only)
 */

import { useCallback } from 'react'
import type { GameState } from '../../types'
import { logger } from '../../utils/logger'
import { broadcastHostPeerId, saveHostData } from '../../host/WebrtcStatePersistence'

export interface UseWebRTCProps {
  // WebRTC manager ref
  webrtcManagerRef: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
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
    if (!webrtcManagerRef.current) {
      logger.error('WebRTC manager not initialized')
      return null
    }

    try {
      setWebrtcIsHost(true)
      setConnectionStatus('Connecting')
      const peerId = await webrtcManagerRef.current.initializeAsHost()
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
  }, [webrtcManagerRef, setWebrtcIsHost, setConnectionStatus, setWebrtcHostId, gameStateRef, localPlayerIdRef])

  /**
   * Connect as guest to host via WebRTC
   */
  const connectAsGuest = useCallback(async (hostId: string): Promise<boolean> => {
    if (!webrtcManagerRef.current) {
      logger.error('WebRTC manager not initialized')
      return false
    }

    try {
      setWebrtcIsHost(false)
      setWebrtcHostId(hostId)  // Store host ID immediately for reconnection tracking
      setConnectionStatus('Connecting')
      await webrtcManagerRef.current.initializeAsGuest(hostId)
      return true
    } catch (err) {
      logger.error('Failed to connect as guest:', err)
      setConnectionStatus('Disconnected')
      return false
    }
  }, [webrtcManagerRef, setWebrtcIsHost, setConnectionStatus, setWebrtcHostId])

  /**
   * Send action to host via WebRTC (guest only)
   */
  const sendWebrtcAction = useCallback((actionType: string, actionData: any) => {
    if (!webrtcManagerRef.current || webrtcIsHostRef.current) {return false}
    return webrtcManagerRef.current.sendAction(actionType, actionData)
  }, [webrtcManagerRef, webrtcIsHostRef])

  return {
    initializeWebrtcHost,
    connectAsGuest,
    sendWebrtcAction,
  }
}
