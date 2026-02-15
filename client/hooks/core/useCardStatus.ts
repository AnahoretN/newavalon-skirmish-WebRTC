/**
 * useCardStatus - Хук для управления статусами карт
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - addBoardCardStatus - добавить статус карте на столе
 * - removeBoardCardStatus - удалить статус с карты на столе
 * - removeBoardCardStatusByOwner - удалить статус с карты на столе по владельцу
 * - modifyBoardCardPower - изменить силу карты на столе
 * - addAnnouncedCardStatus - добавить статус объявленной карте
 * - removeAnnouncedCardStatus - удалить статус с объявленной карты
 * - modifyAnnouncedCardPower - изменить силу объявленной карты
 * - addHandCardStatus - добавить статус карте в руке
 * - removeHandCardStatus - удалить статус с карты в руке
 * - revealHandCard - раскрыть карту в руке
 * - revealBoardCard - раскрыть карту на столе
 * - requestCardReveal - запросить раскрытие карты
 * - respondToRevealRequest - ответить на запрос раскрытия
 * - removeRevealedStatus - снять статус Revealed
 */

import { useCallback } from 'react'
import { deepCloneState } from '../../utils/common'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import type { GameState, Card, CardIdentifier, RevealRequest } from '../../types'

interface UseCardStatusProps {
  localPlayerIdRef: React.MutableRefObject<number | null>
  updateState: (updater: (prevState: GameState) => GameState) => void
}

export function useCardStatus(props: UseCardStatusProps) {
  const { localPlayerIdRef, updateState } = props

  /**
   * Add status to a board card
   */
  const addBoardCardStatus = useCallback((boardCoords: { row: number; col: number }, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        // Lucius, The Immortal Immunity: Cannot be stunned
        // Uses strict baseId check OR Name+Hero check as a fallback
        if (status === 'Stun') {
          if (card.baseId === 'luciusTheImmortal') {
            return currentState
          }
          // Robust Fallback: Name + Hero Type
          if (card.name.includes('Lucius') && card.types?.includes('Hero')) {
            return currentState
          }
        }

        if (['Support', 'Threat', 'Revealed', 'Shield'].includes(status)) {
          const alreadyHasStatusFromPlayer = card.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  /**
   * Remove status from a board card
   */
  const removeBoardCardStatus = useCallback((boardCoords: { row: number; col: number }, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        const lastIndex = card.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          card.statuses.splice(lastIndex, 1)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  /**
   * Remove status from board card by owner
   */
  const removeBoardCardStatusByOwner = useCallback((boardCoords: { row: number; col: number }, status: string, ownerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        const index = card.statuses.findIndex(s => s.type === status && s.addedByPlayerId === ownerId)
        if (index > -1) {
          card.statuses.splice(index, 1)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  /**
   * Modify board card power
   */
  const modifyBoardCardPower = useCallback((boardCoords: { row: number; col: number }, delta: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        if (card.powerModifier === undefined) {
          card.powerModifier = 0
        }
        card.powerModifier += delta
      }
      return newState
    })
  }, [updateState])

  /**
   * Add status to announced card
   */
  const addAnnouncedCardStatus = useCallback((playerId: number, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard) {
        if (['Support', 'Threat', 'Revealed'].includes(status)) {
          const alreadyHasStatusFromPlayer = player.announcedCard.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!player.announcedCard.statuses) {
          player.announcedCard.statuses = []
        }
        player.announcedCard.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  /**
   * Remove status from announced card
   */
  const removeAnnouncedCardStatus = useCallback((playerId: number, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard?.statuses) {
        const lastIndex = player.announcedCard.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          player.announcedCard.statuses.splice(lastIndex, 1)
        }
      }
      return newState
    })
  }, [updateState])

  /**
   * Modify announced card power
   */
  const modifyAnnouncedCardPower = useCallback((playerId: number, delta: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard) {
        if (player.announcedCard.powerModifier === undefined) {
          player.announcedCard.powerModifier = 0
        }
        player.announcedCard.powerModifier += delta
      }
      return newState
    })
  }, [updateState])

  /**
   * Add status to hand card
   */
  const addHandCardStatus = useCallback((playerId: number, cardIndex: number, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player?.hand[cardIndex]) {
        const card = player.hand[cardIndex]
        // Check for duplicate statuses that should only exist once per player
        if (['Support', 'Threat', 'Revealed', 'Shield', 'Resurrected'].includes(status)) {
          const alreadyHasStatusFromPlayer = card.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  /**
   * Remove status from hand card
   */
  const removeHandCardStatus = useCallback((playerId: number, cardIndex: number, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      const card = player?.hand[cardIndex]
      if (card?.statuses) {
        const lastIndex = card.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          card.statuses.splice(lastIndex, 1)
        }
        if (status === 'Revealed') {
          const hasRevealed = card.statuses.some(s => s.type === 'Revealed')
          if (!hasRevealed) {
            delete card.revealedTo
          }
        }
      }
      return newState
    })
  }, [updateState])

  /**
   * Reveal a hand card to specific players or everyone
   */
  const revealHandCard = useCallback((playerId: number, cardIndex: number, revealTarget: 'all' | number[]) => {
    updateState(currentState => {
      const player = currentState.players.find(p => p.id === playerId)
      if (!player?.hand[cardIndex]) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const cardToReveal = newState.players.find(p => p.id === playerId)!.hand[cardIndex]
      if (revealTarget === 'all') {
        cardToReveal.revealedTo = 'all'
        if (!cardToReveal.statuses) {
          cardToReveal.statuses = []
        }
        if (!cardToReveal.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === playerId)) {
          cardToReveal.statuses.push({ type: 'Revealed', addedByPlayerId: playerId })
        }
      } else {
        if (!cardToReveal.revealedTo || cardToReveal.revealedTo === 'all' || !Array.isArray(cardToReveal.revealedTo)) {
          cardToReveal.revealedTo = []
        }
        const newRevealedIds = revealTarget.filter(id => !(cardToReveal.revealedTo as number[]).includes(id))
        ;(cardToReveal.revealedTo as number[]).push(...newRevealedIds)
      }
      return newState
    })
  }, [updateState])

  /**
   * Reveal a board card to specific players or everyone
   */
  const revealBoardCard = useCallback((boardCoords: { row: number, col: number }, revealTarget: 'all' | number[]) => {
    updateState(currentState => {
      const cardToReveal = currentState.board[boardCoords.row][boardCoords.col].card
      if (!cardToReveal) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const cardInNewState = newState.board[boardCoords.row][boardCoords.col].card!
      const ownerId = cardInNewState.ownerId
      if (revealTarget === 'all') {
        cardInNewState.revealedTo = 'all'
        if (ownerId !== undefined) {
          if (!cardInNewState.statuses) {
            cardInNewState.statuses = []
          }
          if (!cardInNewState.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === ownerId)) {
            cardInNewState.statuses.push({ type: 'Revealed', addedByPlayerId: ownerId })
          }
        }
      } else {
        if (!cardInNewState.revealedTo || cardInNewState.revealedTo === 'all' || !Array.isArray(cardInNewState.revealedTo)) {
          cardInNewState.revealedTo = []
        }
        const newRevealedIds = revealTarget.filter(id => !(cardInNewState.revealedTo as number[]).includes(id))
        ;(cardInNewState.revealedTo as number[]).push(...newRevealedIds)
      }
      return newState
    })
  }, [updateState])

  /**
   * Request to reveal a card owned by another player
   */
  const requestCardReveal = useCallback((cardIdentifier: CardIdentifier, requestingPlayerId: number) => {
    updateState(currentState => {
      const ownerId = cardIdentifier.boardCoords
        ? currentState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card?.ownerId
        : cardIdentifier.ownerId
      if (!ownerId) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const existingRequest = newState.revealRequests.find(
        (req: RevealRequest) => req.fromPlayerId === requestingPlayerId && req.toPlayerId === ownerId,
      )
      if (existingRequest) {
        const cardAlreadyRequested = existingRequest.cardIdentifiers.some(ci =>
          JSON.stringify(ci) === JSON.stringify(cardIdentifier),
        )
        if (!cardAlreadyRequested) {
          existingRequest.cardIdentifiers.push(cardIdentifier)
        }
      } else {
        newState.revealRequests.push({
          fromPlayerId: requestingPlayerId,
          toPlayerId: ownerId,
          cardIdentifiers: [cardIdentifier],
        })
      }
      return newState
    })
  }, [updateState])

  /**
   * Respond to a reveal request
   */
  const respondToRevealRequest = useCallback((fromPlayerId: number, accepted: boolean) => {
    updateState(currentState => {
      const requestIndex = currentState.revealRequests.findIndex(
        (req: RevealRequest) => req.toPlayerId === localPlayerIdRef.current && req.fromPlayerId === fromPlayerId,
      )
      if (requestIndex === -1) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const request = newState.revealRequests[requestIndex]
      if (accepted) {
        const { cardIdentifiers } = request
        for (const cardIdentifier of cardIdentifiers) {
          let cardToUpdate: Card | null = null
          if (cardIdentifier.source === 'board' && cardIdentifier.boardCoords) {
            cardToUpdate = newState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card
          } else if (cardIdentifier.source === 'hand' && cardIdentifier.ownerId && cardIdentifier.cardIndex !== undefined) {
            const owner = newState.players.find(p => p.id === cardIdentifier.ownerId)
            if (owner) {
              cardToUpdate = owner.hand[cardIdentifier.cardIndex]
            }
          }
          if (cardToUpdate) {
            if (!cardToUpdate.statuses) {
              cardToUpdate.statuses = []
            }
            if (!cardToUpdate.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === fromPlayerId)) {
              cardToUpdate.statuses.push({ type: 'Revealed', addedByPlayerId: fromPlayerId })
            }
          }
        }
      }
      newState.revealRequests.splice(requestIndex, 1)
      return newState
    })
  }, [updateState, localPlayerIdRef])

  /**
   * Remove revealed status from a card
   */
  const removeRevealedStatus = useCallback((cardIdentifier: { source: 'hand' | 'board'; playerId?: number; cardIndex?: number; boardCoords?: { row: number, col: number } }) => {
    updateState(currentState => {
      const newState: GameState = deepCloneState(currentState)
      let cardToUpdate: Card | null = null
      if (cardIdentifier.source === 'board' && cardIdentifier.boardCoords) {
        cardToUpdate = newState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card
      } else if (cardIdentifier.source === 'hand' && cardIdentifier.playerId && cardIdentifier.cardIndex !== undefined) {
        const owner = newState.players.find(p => p.id === cardIdentifier.playerId)
        if (owner) {
          cardToUpdate = owner.hand[cardIdentifier.cardIndex]
        }
      }
      if (cardToUpdate) {
        if (cardToUpdate.statuses) {
          cardToUpdate.statuses = cardToUpdate.statuses.filter(s => s.type !== 'Revealed')
        }
        delete cardToUpdate.revealedTo
      }
      return newState
    })
  }, [updateState])

  return {
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    modifyBoardCardPower,
    addAnnouncedCardStatus,
    removeAnnouncedCardStatus,
    modifyAnnouncedCardPower,
    addHandCardStatus,
    removeHandCardStatus,
    revealHandCard,
    revealBoardCard,
    requestCardReveal,
    respondToRevealRequest,
    removeRevealedStatus,
  }
}
