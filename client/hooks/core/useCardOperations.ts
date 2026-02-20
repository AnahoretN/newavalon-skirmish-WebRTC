/**
 * useCardOperations - Хук для операций с картами
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - drawCard - вытянуть карту из колоды
 * - drawCardsBatch - вытянуть несколько карт
 * - shufflePlayerDeck - перемешать колоду
 * - flipBoardCard - перевернуть карту рубашкой вверх
 * - flipBoardCardFaceDown - перевернуть карту рубашкой вниз
 */

import { useCallback } from 'react'
import { shuffleDeck } from '@shared/utils/array'
import { deepCloneState } from '../../utils/common'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import type { GameState, Player } from '../../types'
import type { WebRTCManager } from './types'

interface UseCardOperationsProps {
  ws: React.MutableRefObject<WebSocket | null>
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  gameStateRef: React.MutableRefObject<GameState>
  localPlayerIdRef: React.MutableRefObject<number | null>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function useCardOperations(props: UseCardOperationsProps) {
  const {
    updateState,
  } = props

  /**
   * Draw a card from deck to hand
   */
  const drawCard = useCallback((playerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player || player.deck.length === 0) {
        return currentState
      }
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      const cardDrawn = playerToUpdate.deck.shift()
      if (cardDrawn) {
        playerToUpdate.hand.push(cardDrawn)
      }
      return newState
    })
  }, [updateState])

  /**
   * Draw multiple cards at once
   */
  const drawCardsBatch = useCallback((playerId: number, count: number) => {
    if (count <= 0) { return }
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player || player.deck.length === 0) {
        return currentState
      }
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      const cardsToDraw = Math.min(count, playerToUpdate.deck.length)
      for (let i = 0; i < cardsToDraw; i++) {
        const cardDrawn = playerToUpdate.deck.shift()
        if (cardDrawn) {
          playerToUpdate.hand.push(cardDrawn)
        }
      }
      return newState
    })
  }, [updateState])

  /**
   * Shuffle player's deck
   */
  const shufflePlayerDeck = useCallback((playerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player) {
        return currentState
      }
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      playerToUpdate.deck = shuffleDeck([...playerToUpdate.deck])
      return newState
    })
  }, [updateState])

  /**
   * Flip board card face up
   */
  const flipBoardCard = useCallback((boardCoords: { row: number; col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState = { ...currentState }
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        card.isFaceDown = false
      }
      return { ...newState, board: recalculateBoardStatuses(newState) }
    })
  }, [updateState])

  /**
   * Flip board card face down
   */
  const flipBoardCardFaceDown = useCallback((boardCoords: { row: number; col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState = { ...currentState }
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        card.isFaceDown = true
      }
      return { ...newState, board: recalculateBoardStatuses(newState) }
    })
  }, [updateState])

  return {
    drawCard,
    drawCardsBatch,
    shufflePlayerDeck,
    flipBoardCard,
    flipBoardCardFaceDown,
  }
}
