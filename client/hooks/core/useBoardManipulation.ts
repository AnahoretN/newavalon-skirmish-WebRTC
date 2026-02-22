import { useCallback } from 'react'
import { DeckType } from '../../types'
import type { GameState, Card } from '../../types'
import { recalculateBoardStatuses } from '../../../shared/utils/boardUtils'
import { initializeReadyStatuses, READY_STATUS_DEPLOY, READY_STATUS_SETUP, READY_STATUS_COMMIT, markAbilityUsedThisTurn } from '../../utils/autoAbilities'
import { deepCloneState } from '../../utils/common'
import { logger } from '../../utils/logger'
import { getCardAbilityTypes } from '@server/utils/autoAbilities'
import type { CardStatusChange, BoardCardData } from '../../host/types'

export interface UseBoardManipulationProps {
  updateState: (newStateOrFn: GameState | ((prevState: GameState) => GameState)) => void
  rawJsonData: {
    tokenDatabase: Record<string, Omit<Card, 'id' | 'deck'>>
  } | null
  broadcastCardStatusSync?: (changes: CardStatusChange[]) => void  // Optional callback for WebRTC mode
  broadcastBoardCardSync?: (cards: BoardCardData[], action: 'update' | 'remove' | 'replace') => void  // Optional callback for WebRTC mode
}

export const useBoardManipulation = (props: UseBoardManipulationProps) => {
  const { updateState, rawJsonData, broadcastCardStatusSync, broadcastBoardCardSync } = props

  const markAbilityUsed = useCallback((boardCoords: { row: number, col: number }, _isDeployAbility?: boolean, _setDeployAttempted?: boolean, readyStatusToRemove?: string) => {
    // Collect status changes to broadcast via optimized CARD_STATUS_SYNC
    const statusChanges: CardStatusChange[] = []

    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      // Skip if coords are invalid (row = -1 means not on board)
      if (boardCoords.row < 0 || boardCoords.col < 0) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row]?.[boardCoords.col]?.card
      if (card) {
        const oldStatusesTypes = card.statuses ? card.statuses.map(s => s.type) : []
        // Remove the ready status if specified (new ready status system)
        if (readyStatusToRemove && card.statuses) {
          card.statuses = card.statuses.filter(s => s.type !== readyStatusToRemove)
          const newStatusesTypes = card.statuses.map(s => s.type)
          logger.debug(`[markAbilityUsed] Removed status '${readyStatusToRemove}' from ${card.name} at [${boardCoords.row},${boardCoords.col}]: [${oldStatusesTypes.join(', ')}] -> [${newStatusesTypes.join(', ')}]`)

          // Mark Setup/Commit abilities as used this turn (once-per-turn limit)
          if (readyStatusToRemove === READY_STATUS_SETUP) {
            markAbilityUsedThisTurn(card, 'setup')
            logger.debug(`[markAbilityUsed] Marked Setup ability as used this turn for ${card.name}`)

            // Collect change to broadcast
            statusChanges.push({
              cardId: card.id,
              statusType: 'setupUsedThisTurn',
              action: 'add',
              ownerId: card.ownerId
            })
          } else if (readyStatusToRemove === READY_STATUS_COMMIT) {
            markAbilityUsedThisTurn(card, 'commit')
            logger.debug(`[markAbilityUsed] Marked Commit ability as used this turn for ${card.name}`)

            // Collect change to broadcast
            statusChanges.push({
              cardId: card.id,
              statusType: 'commitUsedThisTurn',
              action: 'add',
              ownerId: card.ownerId
            })
          }

          // SPECIAL CASE: After removing readyDeploy, add phase-specific ready status
          // This ensures cards that enter during Setup/Commit phases get their phase-specific status after using Deploy
          if (readyStatusToRemove === READY_STATUS_DEPLOY) {
            const playerId = card.ownerId
            if (playerId && playerId > 0) {
              // Check common conditions: must be active player, not stunned
              // Note: We DON'T check canActivate here because the card just lost readyDeploy
              // and hasn't gained the phase-specific status yet, so canActivate would return false
              const isActivePlayer = newState.activePlayerId === playerId
              const isStunned = card.statuses?.some(s => s.type === 'Stun')

              if (isActivePlayer && !isStunned) {
                // Determine which phase-specific status to add
                const abilityTypes = getCardAbilityTypes(card as any)
                let phaseStatusToAdd: string | null = null

                if (newState.currentPhase === 1 && abilityTypes.includes('setup')) {
                  phaseStatusToAdd = READY_STATUS_SETUP
                } else if (newState.currentPhase === 3 && abilityTypes.includes('commit')) {
                  phaseStatusToAdd = READY_STATUS_COMMIT
                }

                if (phaseStatusToAdd && !card.statuses.some(s => s.type === phaseStatusToAdd)) {
                  card.statuses.push({ type: phaseStatusToAdd, addedByPlayerId: playerId })
                  logger.debug(`[markAbilityUsed] Added phase-specific status '${phaseStatusToAdd}' to ${card.name} after Deploy`)

                  // Collect change to broadcast (phase-specific statuses are local, so we skip them in WebRTC mode)
                  // But setupUsedThisTurn/commitUsedThisTurn need to be synced
                }
              }
            }
          }
        } else {
          logger.debug(`[markAbilityUsed] Called for ${card.name} at [${boardCoords.row},${boardCoords.col}] but no readyStatusToRemove specified. Current statuses: [${oldStatusesTypes.join(', ')}]`)
        }
      }
      return newState
    })

    // Broadcast status changes via optimized CARD_STATUS_SYNC message
    if (statusChanges.length > 0 && broadcastCardStatusSync) {
      setTimeout(() => {
        broadcastCardStatusSync(statusChanges)
      }, 0)
    }
  }, [updateState, broadcastCardStatusSync])

  const resetDeployStatus = useCallback((boardCoords: { row: number, col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      // Skip if coords are invalid (row = -1 means not on board)
      if (boardCoords.row < 0 || boardCoords.col < 0) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row]?.[boardCoords.col]?.card
      if (card) {
        // New system: Add readyDeploy status back (for Command cards that restore deploy ability)
        if (!card.statuses) {
          card.statuses = []
        }
        const abilityText = card.ability || ''
        // Only add if the card actually has a deploy: ability (case-insensitive)
        if (abilityText.toLowerCase().includes('deploy:')) {
          if (!card.statuses.some(s => s.type === 'readyDeploy')) {
            // Require valid ownerId (player IDs start at 1, so 0 is invalid)
            const ownerId = card.ownerId
            if (ownerId === undefined || ownerId === null || ownerId === 0) {
                  return currentState
            }
            card.statuses.push({ type: 'readyDeploy', addedByPlayerId: ownerId })
          }
        }
      }
      return newState
    })
  }, [updateState])

  const removeStatusByType = useCallback((boardCoords: { row: number, col: number }, type: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        card.statuses = card.statuses.filter(s => s.type !== type)
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const applyGlobalEffect = useCallback((
    _sourceCoords: { row: number, col: number },
    targetCoords: { row: number, col: number }[],
    tokenType: string,
    addedByPlayerId: number,
    _isDeployAbility: boolean,
  ) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      targetCoords.forEach(({ row, col }) => {
        const card = newState.board[row][col].card
        if (card) {
          // Lucius Immunity
          if (tokenType === 'Stun') {
            if (card.baseId === 'luciusTheImmortal') {
              return
            }
            if (card.name.includes('Lucius') && card.types?.includes('Hero')) {
              return
            }
          }

          if (!card.statuses) {
            card.statuses = []
          }
          if (['Support', 'Threat', 'Revealed'].includes(tokenType)) {
            const exists = card.statuses.some(s => s.type === tokenType && s.addedByPlayerId === addedByPlayerId)
            if (!exists) {
              card.statuses.push({ type: tokenType, addedByPlayerId })
            }
          } else {
            card.statuses.push({ type: tokenType, addedByPlayerId })
          }
        }
      })
      // Note: Ready status is removed by markAbilityUsed before calling applyGlobalEffect
      return newState
    })
  }, [updateState])

  const swapCards = useCallback((coords1: {row: number, col: number}, coords2: {row: number, col: number}) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card1 = newState.board[coords1.row][coords1.col].card
      const card2 = newState.board[coords2.row][coords2.col].card

      // Perform swap
      newState.board[coords1.row][coords1.col].card = card2
      newState.board[coords2.row][coords2.col].card = card1

      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const transferStatus = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      if (fromCard && toCard && fromCard.statuses) {
        const statusIndex = fromCard.statuses.findIndex(s => s.type === statusType)
        if (statusIndex > -1) {
          const [status] = fromCard.statuses.splice(statusIndex, 1)
          if (!toCard.statuses) {
            toCard.statuses = []
          }
          toCard.statuses.push(status)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const transferAllCounters = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      const excludedTypes = ['Support', 'Threat', 'LastPlayed']
      if (fromCard && toCard && fromCard.statuses) {
        const statusesToMove = fromCard.statuses.filter(s => !excludedTypes.includes(s.type))
        const statusesToKeep = fromCard.statuses.filter(s => excludedTypes.includes(s.type))
        if (statusesToMove.length > 0) {
          if (!toCard.statuses) {
            toCard.statuses = []
          }
          toCard.statuses.push(...statusesToMove)
          fromCard.statuses = statusesToKeep
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const transferAllStatusesWithoutException = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      if (fromCard && toCard && fromCard.statuses && fromCard.statuses.length > 0) {
        // Move ALL statuses (no exceptions)
        if (!toCard.statuses) {
          toCard.statuses = []
        }
        toCard.statuses.push(...fromCard.statuses)
        fromCard.statuses = []
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const spawnToken = useCallback((coords: {row: number, col: number}, tokenName: string, ownerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      if (!rawJsonData) {
        return currentState
      }
      const tokenDatabase = rawJsonData.tokenDatabase
      const tokenDefKey = Object.keys(tokenDatabase).find(key => tokenDatabase[key as keyof typeof tokenDatabase].name === tokenName)
      if (!tokenDefKey) {
        return currentState
      }
      const tokenDef = tokenDatabase[tokenDefKey as keyof typeof tokenDatabase]
      const owner = newState.players.find(p => p.id === ownerId)
      if (tokenDef && newState.board[coords.row][coords.col].card === null) {
        const tokenCard: Card = {
          id: `TKN_${tokenName.toUpperCase().replace(/\s/g, '_')}_${Date.now()}`,
          deck: DeckType.Tokens,
          name: tokenName,
          baseId: tokenDef.baseId || tokenDefKey,
          imageUrl: tokenDef.imageUrl,
          fallbackImage: tokenDef.fallbackImage,
          power: tokenDef.power,
          ability: tokenDef.ability,
          flavorText: tokenDef.flavorText,
          color: tokenDef.color,
          types: tokenDef.types || ['Unit'],
          faction: 'Tokens',
          ownerId: ownerId,
          ownerName: owner?.name,
          enteredThisTurn: true,
          statuses: [],
        }
        // Initialize ready statuses based on token's actual abilities
        // Ready statuses belong to the token owner (even if it's a dummy player)
        // Control is handled by canActivateAbility checking dummy ownership
        initializeReadyStatuses(tokenCard, ownerId, newState.currentPhase)
        newState.board[coords.row][coords.col].card = tokenCard
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState, rawJsonData])

  return {
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    transferAllStatusesWithoutException,
    spawnToken,
    resetDeployStatus,
    removeStatusByType,
  }
}
