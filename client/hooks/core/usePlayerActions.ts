/**
 * usePlayerActions - Хук для управления действиями игрока
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - updatePlayerName - изменение имени игрока
 * - changePlayerColor - изменение цвета игрока
 * - drawCard - вытянуть карту
 * - drawCardsBatch - вытянуть несколько карт
 * - shufflePlayerDeck - перемешать колоду
 */

import { useCallback } from 'react'
import { PlayerColor, GameState } from '../../types'

interface UsePlayerActionsProps {
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function usePlayerActions(props: UsePlayerActionsProps) {
  const { updateState } = props

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
   * Change player color
   */
  const changePlayerColor = useCallback((playerId: number, color: PlayerColor) => {
    updateState(currentState => {
      return {
        ...currentState,
        players: currentState.players.map(p => p.id === playerId ? { ...p, color } : p),
      }
    })
  }, [updateState])

  return {
    updatePlayerName,
    changePlayerColor,
  }
}
