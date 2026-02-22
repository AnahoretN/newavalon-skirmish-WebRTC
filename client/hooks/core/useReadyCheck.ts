/**
 * useReadyCheck - Хук для управления готовностью игроков
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - playerReady - отметить игрока как готового (автостарт когда все готовы)
 *
 * @deprecated startReadyCheck и cancelReadyCheck оставлены для совместимости с HostManager
 * but are no longer used in the simplified ready system (button-based)
 */

import { useCallback, useRef } from 'react'
import { logger } from '../../utils/logger'
import type { GameState } from '../../types'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import type { WebRTCManager } from './types'

interface UseReadyCheckProps {
  ws: React.MutableRefObject<WebSocket | null>
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  gameStateRef: React.MutableRefObject<any>
  localPlayerIdRef: React.MutableRefObject<number | null>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  setGameState: React.Dispatch<React.SetStateAction<any>>
}

export function useReadyCheck(props: UseReadyCheckProps) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setGameState,
  } = props

  // Track polling interval to prevent duplicates and enable cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Start ready check
   */
  const startReadyCheck = useCallback(() => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current) {
      logger.info('[startReadyCheck] Starting ready check via WebRTC')
      setGameState((prev: GameState) => ({ ...prev, isReadyCheckActive: true, isPrivate: true }))
      webrtcManager.current.broadcastToGuests({
        type: 'START_READY_CHECK',
        senderId: webrtcManager.current.getPeerId(),
        data: { isReadyCheckActive: true, isPrivate: true },
        timestamp: Date.now()
      })
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'START_READY_CHECK', gameId: gameStateRef.current.gameId }))
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Cancel ready check
   */
  const cancelReadyCheck = useCallback(() => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current) {
      logger.info('[cancelReadyCheck] Cancelling ready check via WebRTC')
      setGameState((prev: GameState) => ({ ...prev, isReadyCheckActive: false }))
      webrtcManager.current.broadcastToGuests({
        type: 'CANCEL_READY_CHECK',
        senderId: webrtcManager.current.getPeerId(),
        data: { isReadyCheckActive: false },
        timestamp: Date.now()
      })
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'CANCEL_READY_CHECK', gameId: gameStateRef.current.gameId }))
    } else {
      setGameState((prev: GameState) => ({ ...prev, isReadyCheckActive: false }))
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Mark current player as ready
   * This is a complex function that handles both host and guest scenarios
   */
  const playerReady = useCallback(() => {
    const isWebRTCMode = getWebRTCEnabled()

    // WebRTC P2P mode - host
    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current && localPlayerIdRef.current !== null) {
      logger.info('[playerReady] Host marking self as ready via WebRTC')
      const playerId = localPlayerIdRef.current

      // Call stateManager directly - this handles game start when all ready
      const stateManager = webrtcManager.current.getStateManager?.()
      logger.info(`[playerReady] State manager found: ${!!stateManager}`)
      if (stateManager) {
        const currentState = stateManager.getState()
        logger.info(`[playerReady] State manager state: ${!!currentState}, players: ${currentState?.players?.length || 0}`)
        stateManager.setPlayerReady(playerId, true)
        logger.info('[playerReady] Called setPlayerReady')

        // IMPORTANT: After setPlayerReady, get the updated state and sync React state
        // NOTE: setPlayerReady returns synchronously, but game may start later when other guests ready
        // So we need to poll for game start to update UI immediately when game starts
        const initialUpdatedState = stateManager.getState()
        logger.info(`[playerReady] Got initial state: ${!!initialUpdatedState}, type=${typeof initialUpdatedState}`)

        // Sync initial state
        if (initialUpdatedState) {
          logger.info(`[playerReady] Syncing initial React state: phase=${initialUpdatedState.currentPhase}, isGameStarted=${initialUpdatedState.isGameStarted}`)
          setGameState(initialUpdatedState)
        }

        // Poll for game start (in case other guests become ready and game starts)
        // This prevents the double-click bug where host doesn't see game start
        if (!initialUpdatedState?.isGameStarted) {
          logger.info('[playerReady] Game not started yet, polling for game start...')

          // Clear any existing polling interval to prevent duplicates
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }

          let pollCount = 0
          const maxPolls = 50 // 5 seconds (50 * 100ms)

          pollingIntervalRef.current = setInterval(() => {
            pollCount++
            const newState = stateManager.getState()

            if (newState?.isGameStarted) {
              clearInterval(pollingIntervalRef.current!)
              pollingIntervalRef.current = null
              logger.info(`[playerReady] Game started detected! Syncing state: phase=${newState.currentPhase}, activePlayer=${newState.activePlayerId}`)
              logger.info(`[playerReady] Player 1 hand: ${newState.players?.[0]?.hand?.length || 0}, deck: ${newState.players?.[0]?.deck?.length || 0}`)
              setGameState(newState)
            } else if (pollCount >= maxPolls) {
              clearInterval(pollingIntervalRef.current!)
              pollingIntervalRef.current = null
              logger.warn('[playerReady] Polling timeout - game may not have started')
            }
          }, 100)
        }

        // Broadcast to guests so they see the ready status
        webrtcManager.current.broadcastToGuests({
          type: 'HOST_READY',
          senderId: webrtcManager.current.getPeerId(),
          playerId,
          timestamp: Date.now()
        })
      } else {
        logger.error('[playerReady] State manager not found!')
      }
      return
    }

    // WebRTC P2P mode - guest
    if (isWebRTCMode && webrtcManager.current && !webrtcIsHostRef.current && localPlayerIdRef.current !== null) {
      logger.info('[playerReady] Guest sending PLAYER_READY via WebRTC')
      webrtcManager.current.sendMessageToHost({
        type: 'PLAYER_READY',
        senderId: webrtcManager.current.getPeerId(),
        playerId: localPlayerIdRef.current,
        timestamp: Date.now()
      })
      setGameState((prev: any) => ({
        ...prev,
        players: prev.players.map((p: any) =>
          p.id === localPlayerIdRef.current ? { ...p, isReady: true } : p
        )
      }))
      return
    }

    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId && localPlayerIdRef.current !== null) {
      ws.current.send(JSON.stringify({ type: 'PLAYER_READY', gameId: gameStateRef.current.gameId, playerId: localPlayerIdRef.current }))
    }
  }, [ws, webrtcManager, gameStateRef, localPlayerIdRef, webrtcIsHostRef, setGameState, pollingIntervalRef])

  return {
    startReadyCheck,
    cancelReadyCheck,
    playerReady,
  }
}
