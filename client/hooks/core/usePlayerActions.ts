/**
 * usePlayerActions - Хук для управления действиями игрока
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - updatePlayerName - изменение имени игрока
 * - changePlayerColor - изменение цвета игрока с P2P синхронизацией
 */

import { useCallback } from 'react'
import { PlayerColor, GameState } from '../../types'
import { logger } from '../../utils/logger'

interface UsePlayerActionsProps {
  updateState: (updater: (prevState: GameState) => GameState) => void
  sendWebrtcAction?: ((actionType: string, actionData: any) => void) | null
  webrtcIsHostRef?: React.MutableRefObject<boolean>
  webrtcManagerRef?: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
}

export function usePlayerActions(props: UsePlayerActionsProps) {
  const { updateState, sendWebrtcAction, webrtcIsHostRef, webrtcManagerRef } = props

  /**
   * Update player name
   */
  const updatePlayerName = useCallback((playerId: number, name: string) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p => p.id === playerId ? { ...p, name } : p),
      }
    })
  }, [updateState])

  /**
   * Change player color with P2P synchronization
   */
  const changePlayerColor = useCallback((playerId: number, color: PlayerColor) => {
    // First update local state
    updateState(currentState => {
      return {
        ...currentState,
        players: currentState.players.map(p => p.id === playerId ? { ...p, color } : p),
      }
    })

    // Then broadcast to other players via P2P
    const isWebRTCMode = sendWebrtcAction !== null
    if (!isWebRTCMode) {
      return
    }

    if (webrtcIsHostRef?.current && webrtcManagerRef?.current) {
      // Host: broadcast directly to all guests
      webrtcManagerRef.current.broadcastToGuests({
        type: 'CHANGE_PLAYER_COLOR',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { playerId, color },
        timestamp: Date.now()
      })
      logger.info(`[changePlayerColor] Host broadcast color change for player ${playerId}`)
    } else if (!webrtcIsHostRef?.current && sendWebrtcAction) {
      // Guest: send to host
      sendWebrtcAction('CHANGE_PLAYER_COLOR', { playerId, color })
      logger.info(`[changePlayerColor] Guest sent color change for player ${playerId}`)
    }
  }, [updateState, sendWebrtcAction, webrtcIsHostRef, webrtcManagerRef])

  return {
    updatePlayerName,
    changePlayerColor,
  }
}
