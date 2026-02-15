/**
 * useGameLifecycle - Хук для управления жизненным циклом игры
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - createGame - создание новой игры
 * - requestGamesList - запрос списка игр
 * - exitGame - выход из игры
 * - forceReconnect - принудительное переподключение
 * - joinGame - присоединение к игре
 */

import { useCallback } from 'react'
import { logger } from '../../utils/logger'
import { TIMING } from '../../utils/common'
import { rawJsonData } from '../../content'
import { clearWebrtcData, clearHostPeerIdBroadcast } from '../../host/WebrtcStatePersistence'
import { clearGameState, RECONNECTION_DATA_KEY } from './gameStateStorage'
import { generateGameId, createInitialState, createNewPlayer } from './gameCreators'

interface UseGameLifecycleProps {
  ws: React.MutableRefObject<WebSocket | null>
  gameStateRef: React.MutableRefObject<any>
  localPlayerIdRef: React.MutableRefObject<number | null>
  isRestoringSessionRef: React.MutableRefObject<boolean>
  isManualExitRef: React.MutableRefObject<boolean>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  receivedServerStateRef: React.MutableRefObject<boolean>
  joiningGameIdRef: React.MutableRefObject<string | null>
  setGameState: React.Dispatch<React.SetStateAction<any>>
  setLocalPlayerId: React.Dispatch<React.SetStateAction<number | null>>
  connectWebSocket: () => void
  updateState: (state: any) => void
}

export function useGameLifecycle(props: UseGameLifecycleProps) {
  const {
    ws,
    gameStateRef,
    localPlayerIdRef,
    isRestoringSessionRef,
    isManualExitRef,
    webrtcIsHostRef,
    receivedServerStateRef,
    joiningGameIdRef,
    setGameState,
    setLocalPlayerId,
    connectWebSocket,
    updateState,
  } = props

  /**
   * Force reconnection to WebSocket server
   * Closes existing connection if open, or triggers new connection
   */
  const forceReconnect = useCallback(() => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      ws.current.close()
    } else {
      // If the socket was not open (e.g. initially missing URL), we must trigger connection manually.
      connectWebSocket()
    }
  }, [ws, connectWebSocket])

  /**
   * Join an existing game by ID
   * Handles reconnection with playerToken if available
   */
  const joinGame = useCallback((gameId: string): void => {
    isManualExitRef.current = false
    if (ws.current?.readyState === WebSocket.OPEN) {
      joiningGameIdRef.current = gameId
      let reconnectionData = null
      try {
        const storedData = localStorage.getItem(RECONNECTION_DATA_KEY)
        if (storedData) {
          reconnectionData = JSON.parse(storedData)
        }
      } catch (e) {
        clearGameState()
      }
      const payload: { type: string; gameId: string; playerToken?: string } = { type: 'JOIN_GAME', gameId }
      if (reconnectionData?.gameId === gameId && reconnectionData.playerToken) {
        payload.playerToken = reconnectionData.playerToken
        logger.info(`JoinGame: Sending reconnection with token ${reconnectionData.playerToken.substring(0, 8)}... for player ${reconnectionData.playerId}`)
      } else {
        logger.info(`JoinGame: No reconnection data or gameId mismatch. storedGameId=${reconnectionData?.gameId}, requestedGameId=${gameId}`)
      }
      ws.current.send(JSON.stringify(payload))
    } else {
      connectWebSocket()
      joiningGameIdRef.current = gameId
    }
  }, [ws, isManualExitRef, joiningGameIdRef, connectWebSocket])

  /**
   * Create a new game
   * Generates unique game ID, creates initial state, and subscribes to server
   */
  const createGame = useCallback(() => {
    isManualExitRef.current = false
    clearGameState()
    const newGameId = generateGameId()
    const initialState = {
      ...createInitialState(),
      gameId: newGameId,
      players: [createNewPlayer(1)],
    }
    // Mark that we're creating a new game - client is the authority here
    receivedServerStateRef.current = true
    updateState(initialState)
    // Wait for server to process UPDATE_STATE and assign playerId before sending other messages
    setTimeout(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: newGameId }))
        ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
      }
    }, TIMING.DECK_SYNC_DELAY)
  }, [updateState, isManualExitRef, receivedServerStateRef, ws])

  /**
   * Request the list of available games from the server
   */
  const requestGamesList = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'GET_GAMES_LIST' }))
    }
  }, [ws])

  /**
   * Exit the current game
   * Clears state, notifies server, closes connection, and reconnects
   */
  const exitGame = useCallback(() => {
    // Don't exit if we're in the middle of restoring a session
    if (isRestoringSessionRef.current) {
      logger.info('[exitGame] Skipping exit during session restoration')
      return
    }

    isManualExitRef.current = true
    const gameIdToLeave = gameStateRef.current.gameId
    const playerIdToLeave = localPlayerIdRef.current

    // Clear host peerId broadcast if we're the host
    if (gameIdToLeave && webrtcIsHostRef.current) {
      clearHostPeerIdBroadcast(gameIdToLeave)
    }

    // Clear WebRTC persistence data on manual exit
    try {
      clearWebrtcData()
      // Clear the auto-restore flag so page reload can start fresh
      sessionStorage.removeItem('webrtc_auto_restore_attempted')
      logger.info('[exitGame] Cleared WebRTC persistence data')
    } catch (e) {
      logger.warn('[exitGame] Failed to clear WebRTC data:', e)
    }

    setGameState(createInitialState())
    setLocalPlayerId(null)
    clearGameState()

    if (ws.current) {
      ws.current.onclose = null
    }

    if (ws.current?.readyState === WebSocket.OPEN && gameIdToLeave && playerIdToLeave !== null) {
      ws.current.send(JSON.stringify({ type: 'EXIT_GAME', gameId: gameIdToLeave, playerId: playerIdToLeave }))
    }

    if (ws.current) {
      ws.current.close()
    }

    setTimeout(() => {
      isManualExitRef.current = false
      connectWebSocket()
    }, TIMING.RECONNECT_DELAY)

  }, [
    isRestoringSessionRef,
    isManualExitRef,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setGameState,
    setLocalPlayerId,
    ws,
    connectWebSocket,
  ])

  return {
    createGame,
    requestGamesList,
    exitGame,
    forceReconnect,
    joinGame,
  }
}
