/**
 * useGameSettings - Хук для управления настройками игры
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - assignTeams - назначение команд
 * - setGameMode - установка режима игры
 * - setGamePrivacy - установка приватности
 * - setActiveGridSize - установка размера сетки
 * - setDummyPlayerCount - количество dummy игроков
 */

import { useCallback } from 'react'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import { GameMode as GameModeEnum } from '../../types'
import type { GridSize, GameState } from '../../types'
import { MAX_PLAYERS } from '../../constants'
import { logger } from '../../utils/logger'
import { createNewPlayer } from './gameCreators'
import type { WebRTCManager } from './types'

interface UseGameSettingsProps {
  ws: React.MutableRefObject<WebSocket | null>
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  gameStateRef: React.MutableRefObject<GameState>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function useGameSettings(props: UseGameSettingsProps) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    webrtcIsHostRef,
    setGameState,
    updateState,
  } = props

  /**
   * Assign teams to players
   */
  const assignTeams = useCallback((teamAssignments: Record<number, number[]>) => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current) {
      logger.info('[assignTeams] Assigning teams via WebRTC')
      setGameState(prev => {
        const updatedPlayers = prev.players.map(p => {
          let teamId = 1
          for (const [team, playerIds] of Object.entries(teamAssignments)) {
            if (playerIds.includes(p.id)) {
              teamId = parseInt(team)
              break
            }
          }
          return { ...p, teamId }
        })
        return { ...prev, players: updatedPlayers }
      })
      webrtcManager.current.broadcastToGuests({
        type: 'ASSIGN_TEAMS',
        senderId: webrtcManager.current.getPeerId(),
        data: { assignments: teamAssignments },
        timestamp: Date.now()
      })
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'ASSIGN_TEAMS', gameId: gameStateRef.current.gameId, assignments: teamAssignments }))
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Set game mode (FreeForAll, Teams, etc.)
   */
  const setGameMode = useCallback((mode: GameModeEnum) => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current) {
      logger.info('[setGameMode] Setting game mode via WebRTC')
      setGameState(prev => ({ ...prev, gameMode: mode }))
      webrtcManager.current.broadcastToGuests({
        type: 'SET_GAME_MODE',
        senderId: webrtcManager.current.getPeerId(),
        data: { mode },
        timestamp: Date.now()
      })
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_MODE', gameId: gameStateRef.current.gameId, mode }))
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Set game privacy (public/private)
   */
  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManager.current && webrtcIsHostRef.current) {
      logger.info('[setGamePrivacy] Setting game privacy via WebRTC')
      setGameState(prev => ({ ...prev, isPrivate }))
      webrtcManager.current.broadcastToGuests({
        type: 'SET_GAME_PRIVACY',
        senderId: webrtcManager.current.getPeerId(),
        data: { isPrivate },
        timestamp: Date.now()
      })
      return
    }
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_PRIVACY', gameId: gameStateRef.current.gameId, isPrivate }))
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Set active grid size (creates new board if size changed)
   */
  const setActiveGridSize = useCallback((size: GridSize) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const newState = { ...currentState, activeGridSize: size }

      const currentSize = currentState.board.length
      if (currentSize !== size) {
        newState.board = []
        for (let i = 0; i < size; i++) {
          const row: any[] = []
          for (let j = 0; j < size; j++) {
            row.push({ card: null })
          }
          newState.board.push(row)
        }
      } else {
        // Need to import recalculateBoardStatuses - but it's in shared/utils/boardUtils
        // For now, leave board as is
      }
      return newState
    })
  }, [updateState])

  /**
   * Set number of dummy players
   */
  const setDummyPlayerCount = useCallback((count: number) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const realPlayers = currentState.players.filter(p => !p.isDummy)
      if (realPlayers.length + count > MAX_PLAYERS) {
        return currentState
      }
      const newPlayers = [...realPlayers]
      const maxId = Math.max(...realPlayers.map(p => p.id), 0)
      for (let i = 0; i < count; i++) {
        const dummyId = maxId + i + 1
        const dummyPlayer = createNewPlayer(dummyId, true)
        dummyPlayer.name = `Dummy ${i + 1}`
        newPlayers.push(dummyPlayer)
      }
      return { ...currentState, players: newPlayers, dummyPlayerCount: count }
    })
  }, [updateState])

  return {
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    setDummyPlayerCount,
  }
}
