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

import { useCallback } from 'react'
import { logger } from '../../utils/logger'
import type { GameState } from '../../types'
import { getWebRTCEnabled } from '../useWebRTCEnabled'

interface UseReadyCheckProps {
  ws: React.MutableRefObject<WebSocket | null>
  webrtcManager: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
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
      setGameState((prev: GameState) => {
        const updatedPlayers = prev.players.map((p: any) =>
          p.id === localPlayerIdRef.current ? { ...p, isReady: true } : p
        )
        const newState = { ...prev, players: updatedPlayers }

        const realPlayers = newState.players.filter((p: any) => !p.isDummy && !p.isDisconnected)
        const allReady = realPlayers.length > 0 && realPlayers.every((p: any) => p.isReady)

        if (allReady && !newState.isGameStarted) {
          logger.info('[playerReady] All players ready! Starting game...')
          const allPlayers = newState.players.filter((p: any) => !p.isDisconnected)
          const randomIndex = Math.floor(Math.random() * allPlayers.length)
          const startingPlayerId = allPlayers[randomIndex].id

          const finalState = { ...newState }
          finalState.isReadyCheckActive = false
          finalState.isGameStarted = true
          finalState.startingPlayerId = startingPlayerId
          finalState.activePlayerId = startingPlayerId
          finalState.currentPhase = 0

          // Draw initial hands
          finalState.players = finalState.players.map((player: any) => {
            if (player.hand.length === 0 && player.deck.length > 0) {
              const cardsToDraw = 6
              const newHand = [...player.hand]
              const newDeck = [...player.deck]

              for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
                const drawnCard = newDeck[0]
                newDeck.splice(0, 1)
                newHand.push(drawnCard)
              }

              logger.info(`[playerReady] Drew initial ${newHand.length} cards for player ${player.id}`)
              return { ...player, hand: newHand, deck: newDeck }
            }
            return player
          })

          // Preparation phase for starting player
          const startingPlayer = finalState.players.find((p: any) => p.id === startingPlayerId)
          if (startingPlayer && startingPlayer.deck.length > 0) {
            const drawnCard = startingPlayer.deck[0]
            const newDeck = [...startingPlayer.deck.slice(1)]
            const newHand = [...startingPlayer.hand, drawnCard]

            finalState.players = finalState.players.map((p: any) =>
              p.id === startingPlayerId
                ? { ...p, deck: newDeck, hand: newHand, readySetup: false, readyCommit: false }
                : p
            )
            finalState.currentPhase = 1
          }

          // Broadcast the final complete state (not delta)
          logger.info('[playerReady] Broadcasting final state after game start')
          webrtcManager.current!.broadcastGameState(finalState)

          webrtcManager.current!.broadcastToGuests({
            type: 'GAME_START',
            senderId: webrtcManager.current!.getPeerId(),
            data: {
              startingPlayerId,
              activePlayerId: startingPlayerId,
              isGameStarted: true,
              isReadyCheckActive: false
            },
            timestamp: Date.now()
          })

          return finalState
        }

        webrtcManager.current!.broadcastToGuests({
          type: 'HOST_READY',
          senderId: webrtcManager.current!.getPeerId(),
          playerId: localPlayerIdRef.current ?? undefined,
          timestamp: Date.now()
        })

        return newState
      })
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
  }, [ws, webrtcManager, gameStateRef, localPlayerIdRef, webrtcIsHostRef, setGameState])

  return {
    startReadyCheck,
    cancelReadyCheck,
    playerReady,
  }
}
