/**
 * useCardMovement - Хук для перемещения карт между зонами
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - moveItem - переместить карту из источника в цель (drag & drop)
 */

import { useCallback } from 'react'
import { DeckType } from '../../types'
import type { DragItem, DropTarget, GameState, Card } from '../../types'
import { countersDatabase } from '../../content'
import { recalculateBoardStatuses } from '../../../shared/utils/boardUtils'
import { deepCloneState } from '../../utils/common'
import { initializeReadyStatuses, removeAllReadyStatuses } from '../../utils/autoAbilities'
import { syncLastPlayed } from './gameStateStorage'

export interface UseCardMovementProps {
  updateState: (newStateOrFn: GameState | ((prevState: GameState) => GameState)) => void
  localPlayerIdRef: React.MutableRefObject<number | null>
  updatePlayerScore: (playerId: number, delta: number) => void
}

export function useCardMovement(props: UseCardMovementProps) {
  const { updateState, localPlayerIdRef, updatePlayerScore } = props

  const moveItem = useCallback((item: DragItem, target: DropTarget) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }

      if (target.target === 'board' && target.boardCoords) {
        const targetCell = currentState.board[target.boardCoords.row][target.boardCoords.col]
        if (targetCell.card !== null && item.source !== 'counter_panel') {
          return currentState
        }
      }

      // Auto-phase transition: Setup -> Main when playing a unit or command card from hand
      // Only if auto-abilities is enabled (check localStorage for client-side setting)
      let autoAbilitiesEnabled = false
      try {
        const saved = localStorage.getItem('auto_abilities_enabled')
        autoAbilitiesEnabled = saved === null ? true : saved === 'true'
      } catch {
        autoAbilitiesEnabled = true
      }

      const shouldAutoTransitionToMain = autoAbilitiesEnabled &&
        currentState.currentPhase === 1 && // Setup phase
        item.source === 'hand' &&
        target.target === 'board' &&
        (item.card.types?.includes('Unit') || item.card.types?.includes('Command'))

      const newState: GameState = deepCloneState(currentState)

      if (item.source === 'board' && ['hand', 'deck', 'discard'].includes(target.target) && !item.bypassOwnershipCheck) {
        const cardOwnerId = item.card.ownerId
        const cardOwner = newState.players.find(p => p.id === cardOwnerId)
        const isOwner = cardOwnerId === localPlayerIdRef.current
        const isDummyCard = !!cardOwner?.isDummy

        if (!isOwner && !isDummyCard) {
          return currentState
        }
      }

      // Store the actual current card state for board-to-board moves
      // This ensures we preserve all statuses (including ready statuses) when moving
      let actualCardState: Card | null = null
      if (item.source === 'board' && target.target === 'board' && item.boardCoords) {
        // Get the actual card state from newState (after cloning)
        // This must be done AFTER newState is created
        const cell = newState.board[item.boardCoords.row][item.boardCoords.col]
        if (cell.card) {
          actualCardState = cell.card
        }

        // Also check stun status from currentState for the early return
        const currentCell = currentState.board[item.boardCoords.row][item.boardCoords.col]
        const currentCardState = currentCell.card || actualCardState
        if (currentCardState) {
          const isStunned = currentCardState.statuses?.some(s => s.type === 'Stun')

          if (isStunned) {
            const moverId = localPlayerIdRef.current
            const ownerId = currentCardState.ownerId
            const moverPlayer = currentState.players.find(p => p.id === moverId)
            const ownerPlayer = currentState.players.find(p => p.id === ownerId)
            const isOwner = moverId === ownerId
            const isTeammate = moverPlayer?.teamId !== undefined && ownerPlayer?.teamId !== undefined && moverPlayer.teamId === ownerPlayer.teamId

            if ((isOwner || isTeammate) && !item.isManual) {
              return currentState
            }
          }
        }
      }

      if (item.source === 'counter_panel' && item.statusType) {
        const counterDef = countersDatabase[item.statusType]
        // Use nullish coalescing (??) instead of logical OR (||) to respect empty arrays
        // Empty array means "no valid targets" (e.g., Resurrected token)
        const allowedTargets = counterDef?.allowedTargets ?? ['board', 'hand']

        if (!allowedTargets.includes(target.target) && !allowedTargets.includes('board-facedown')) {
          return currentState
        }
        let targetCard: Card | null = null
        if (target.target === 'board' && target.boardCoords) {
          targetCard = newState.board[target.boardCoords.row][target.boardCoords.col].card
          // Check board-facedown restriction
          if (allowedTargets.includes('board-facedown')) {
            if (targetCard && !targetCard.isFaceDown) {
              // Card is face-up, not allowed for board-facedown tokens
              return currentState
            }
          }
        } else if (target.playerId !== undefined) {
          const targetPlayer = newState.players.find(p => p.id === target.playerId)
          if (targetPlayer) {
            if (target.target === 'hand' && target.cardIndex !== undefined) {
              targetCard = targetPlayer.hand[target.cardIndex]
            }
            if (target.target === 'announced') {
              targetCard = targetPlayer.announcedCard || null
            }
            if (target.target === 'deck' && targetPlayer.deck.length > 0) {
              if (target.deckPosition === 'top' || !target.deckPosition) {
                targetCard = targetPlayer.deck[0]
              } else {
                targetCard = targetPlayer.deck[targetPlayer.deck.length - 1]
              }
            } else if (target.target === 'discard' && targetPlayer.discard.length > 0) {
              targetCard = targetPlayer.discard[targetPlayer.discard.length - 1]
            }
          }
        }
        if (targetCard) {
          // RULE: Revealed tokens cannot be placed on own cards
          if (item.statusType === 'Revealed') {
            const localPlayerId = localPlayerIdRef.current
            if (target.target === 'board' && targetCard.ownerId === localPlayerId) {
              return currentState
            }
            if (target.target === 'hand' && target.playerId === localPlayerId) {
              return currentState
            }
          }

          // Lucius Immunity Logic
          if (item.statusType === 'Stun') {
            if (targetCard.baseId === 'luciusTheImmortal') {
              return newState
            }
            if (targetCard.name.includes('Lucius') && targetCard.types?.includes('Hero')) {
              return newState
            }
          }

          const count = item.count || 1

          // Determine effectiveActorId: use item.ownerId if provided (for counter_panel from abilities),
          // otherwise fall back to card owner, active player (if dummy), or local player
          let effectiveActorId: number
          if (item.ownerId !== undefined) {
            // For counter_panel items, ownerId comes from the source card that created the stack
            effectiveActorId = item.ownerId
          } else if (item.card.ownerId !== undefined) {
            // For regular card moves, use the card's owner
            effectiveActorId = item.card.ownerId
          } else {
            const activePlayer = newState.players.find(p => p.id === newState.activePlayerId)
            effectiveActorId = (activePlayer?.isDummy) ? activePlayer.id : (localPlayerIdRef.current !== null ? localPlayerIdRef.current : 0)
          }
          if (item.statusType === 'Power+') {
            if (targetCard.powerModifier === undefined) {
              targetCard.powerModifier = 0
            }
            targetCard.powerModifier += (1 * count)
          } else if (item.statusType === 'Power-') {
            if (targetCard.powerModifier === undefined) {
              targetCard.powerModifier = 0
            }
            targetCard.powerModifier -= (1 * count)
          } else {
            if (!targetCard.statuses) {
              targetCard.statuses = []
            }

            // Handle status replacement (e.g., Censor: Exploit -> Stun)
            if (item.replaceStatusType && item.statusType) {
              for (let i = 0; i < count; i++) {
                // Find the status to replace (owned by effectiveActorId)
                const replaceIndex = targetCard.statuses.findIndex(
                  s => s.type === item.replaceStatusType && s.addedByPlayerId === effectiveActorId
                )
                if (replaceIndex !== -1) {
                  // Replace with new status
                  targetCard.statuses[replaceIndex] = { type: item.statusType, addedByPlayerId: effectiveActorId }
                } else {
                  // If no status to replace found, just add the new status
                  targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
                }
              }
            } else {
              // Normal status addition
              for (let i = 0; i < count; i++) {
                if (['Support', 'Threat', 'Revealed'].includes(item.statusType)) {
                  const exists = targetCard.statuses.some(s => s.type === item.statusType && s.addedByPlayerId === effectiveActorId)
                  if (!exists) {
                    targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
                  }
                } else {
                  targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
                }
              }
            }
          }
          if (target.target === 'board') {
            newState.board = recalculateBoardStatuses(newState)
          }
          return newState
        }
        return currentState
      }

      const cardToMove: Card = actualCardState ? { ...actualCardState } : { ...item.card }

      if (item.source === 'hand' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          // IMPORTANT: Verify the card at the index matches the expected ID AND ownerId
          // This prevents duplicate removals when multiple players target the same card type
          const cardAtIndex = player.hand[item.cardIndex]
          if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
            player.hand.splice(item.cardIndex, 1)
          } else {
            // Card at index doesn't match expected ID/ownerId - it was likely already removed by another player
            // Try to find and remove the card by ID AND ownerId instead
            const actualIndex = player.hand.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.hand.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'board' && item.boardCoords) {
        // IMPORTANT: Verify the card at the coords matches the expected ID AND ownerId
        // This prevents duplicate removals when multiple players target the same card type
        const cell = newState.board[item.boardCoords.row][item.boardCoords.col]
        if (cell.card && cell.card.id === item.card.id && cell.card.ownerId === item.card.ownerId) {
          newState.board[item.boardCoords.row][item.boardCoords.col].card = null
        } else {
          // Card at coords doesn't match expected ID - it was likely already removed/moved by another player
          // Skip this move entirely to avoid ghost duplications
          return currentState
        }
      } else if (item.source === 'discard' && item.playerId !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          let removed = false
          // If cardIndex is provided, try to remove at that index first
          if (item.cardIndex !== undefined) {
            const cardAtIndex = player.discard[item.cardIndex]
            if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
              player.discard.splice(item.cardIndex, 1)
              removed = true
            }
          }
          // If not removed by index, or cardIndex not provided, find by ID and ownerId
          if (!removed) {
            const actualIndex = player.discard.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.discard.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'deck' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          // IMPORTANT: Verify the card at the index matches the expected ID AND ownerId
          // This prevents duplicate removals when multiple players target the same card type
          const cardAtIndex = player.deck[item.cardIndex]
          if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
            player.deck.splice(item.cardIndex, 1)
          } else {
            // Card at index doesn't match expected ID/ownerId - it was likely already removed by another player
            // Try to find and remove the card by ID AND ownerId instead
            const actualIndex = player.deck.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.deck.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'announced' && item.playerId !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          // IMPORTANT: Verify the card ID matches before removing
          // This prevents accidental removal if card was already moved by another action
          if (player.announcedCard && player.announcedCard.id === item.card.id) {
            player.announcedCard = null
          } else {
            // Card doesn't match - it was likely already removed/moved
            // Skip this move entirely to avoid card loss
            return currentState
          }
        }
      }

      const isReturningToStorage = ['hand', 'deck', 'discard'].includes(target.target)

      if (isReturningToStorage) {
        if (cardToMove.statuses) {
          // Keep Revealed status, remove all others (including ready statuses)
          cardToMove.statuses = cardToMove.statuses.filter(status => status.type === 'Revealed')
        }
        cardToMove.isFaceDown = false
        delete cardToMove.powerModifier
        delete cardToMove.bonusPower // Clear passive buffs
        delete cardToMove.enteredThisTurn
      } else if (target.target === 'board') {
        if (!cardToMove.statuses) {
          cardToMove.statuses = []
        }
        if (item.source !== 'board' && cardToMove.isFaceDown === undefined) {
          cardToMove.isFaceDown = false
        }
        if (item.source !== 'board') {
          cardToMove.enteredThisTurn = true
          // Note: Ready statuses are initialized below, no need to delete legacy flags

          // Initialize ready statuses for the new card (only for abilities it actually has)
          // Ready statuses belong to the card owner (even if it's a dummy player)
          // Token ownership rules:
          // - Tokens from token_panel: owned by active player (even if it's a dummy)
          // - Tokens from abilities (spawnToken): already have ownerId set correctly
          // - Cards from hand/deck/discard: owned by the player whose hand/deck/discard they came from
          let ownerId = cardToMove.ownerId
          if (ownerId === undefined) {
            if (item.source === 'token_panel') {
              // Token from token panel gets active player as owner
              ownerId = newState.activePlayerId ?? localPlayerIdRef.current ?? 0
            } else if (item.playerId !== undefined) {
              // Card from a player's hand/deck/discard gets that player as owner
              ownerId = item.playerId
            } else {
              // Fallback to local player
              ownerId = localPlayerIdRef.current ?? 0
            }
            cardToMove.ownerId = ownerId
          }
          initializeReadyStatuses(cardToMove, ownerId)

          // Lucius, The Immortal: Bonus if entered from discard
          if (item.source === 'discard' && (cardToMove.baseId === 'luciusTheImmortal' || cardToMove.name.includes('Lucius'))) {
            if (cardToMove.powerModifier === undefined) {
              cardToMove.powerModifier = 0
            }
            cardToMove.powerModifier += 2
          }
        }
      }

      if (target.target === 'hand' && target.playerId !== undefined) {

        // Check if this is a token card
        const isToken = (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') &&
                        (cardToMove.types?.includes('Token') || cardToMove.types?.includes('Token Unit'))

        if (isToken) {
          // Token cards are DESTROYED when moved to hand/discard/deck
          // Remove from board and do NOT add to hand
          newState.board[item.sourceBoardCoords!.row][item.sourceBoardCoords!.col].card = null
          return newState
        }

        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        const player = newState.players.find(p => p.id === target.playerId)

        if (!player) {
          return currentState
        }

        // Determine insert index: use target.cardIndex if provided, otherwise append to end
        let insertIndex = target.cardIndex !== undefined ? target.cardIndex : player.hand.length

        // Special case: reordering within the same hand
        // The source card was already removed from hand earlier (line 1854-1858)
        // We need to adjust insertIndex if we removed from before the insert position
        if (item.source === 'hand' && item.playerId === target.playerId && item.cardIndex !== undefined) {
          // If removing from before insert position, the indices shifted
          if (item.cardIndex < insertIndex) {
            insertIndex -= 1
          }
          // If dragging to same position, no change needed
          if (item.cardIndex === insertIndex) {
            return currentState
          }
        }

        // Insert card at the calculated position
        player.hand.splice(insertIndex, 0, cardToMove)

        // NOTE: Removed automatic shuffle when moving from deck to hand
        // Shuffle should only happen for specific search abilities (Mr. Pearl, Lucius Setup, Quick Response Team, Michael Falk)
        // Those abilities handle their own shuffle in their ability action chains
      } else if (target.target === 'board' && target.boardCoords) {
        if (newState.board[target.boardCoords.row][target.boardCoords.col].card === null) {
          // CRITICAL: Only set ownerId if it's still undefined
          // This preserves the correct owner set earlier (e.g., for dummy players)
          if (cardToMove.ownerId === undefined && localPlayerIdRef.current !== null) {
            const currentPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
            if (currentPlayer) {
              cardToMove.ownerId = currentPlayer.id
              cardToMove.ownerName = currentPlayer.name
            }
          }

          // --- HISTORY TRACKING: Entering Board ---
          // Cards placed on board get tracked in history for 'LastPlayed' status.
          // This includes: manual plays, deploy abilities, and tokens from counter_panel.
          // Only cards moved within the board (source === 'board') are NOT tracked as new plays.
          if (item.source !== 'board' && cardToMove.ownerId !== undefined) {
            const player = newState.players.find(p => p.id === cardToMove.ownerId)
            if (player) {
              // FIX: Added initialization check for boardHistory to prevent crash if undefined.
              if (!player.boardHistory) {
                player.boardHistory = []
              }
              player.boardHistory.push(cardToMove.id)
            }
          }

          newState.board[target.boardCoords.row][target.boardCoords.col].card = cardToMove
        }
      } else if (target.target === 'discard' && target.playerId !== undefined) {
        // Check if this is a token card
        const isToken = (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') &&
                        (cardToMove.types?.includes('Token') || cardToMove.types?.includes('Token Unit'))

        if (isToken) {
          // Token cards are DESTROYED when moved to hand/discard/deck
          // Remove from board and do NOT add to discard
          newState.board[item.sourceBoardCoords!.row][item.sourceBoardCoords!.col].card = null
          return newState
        }

        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        // Remove Revealed status when card goes to discard
        if (cardToMove.statuses) {
          cardToMove.statuses = cardToMove.statuses.filter(s => s.type !== 'Revealed')
        }
        const player = newState.players.find(p => p.id === target.playerId)
        if (player) {
          if (cardToMove.ownerId === undefined) {
            cardToMove.ownerId = target.playerId
            cardToMove.ownerName = player.name
          }
          // Check if card already exists in discard to prevent duplicates
          const alreadyInDiscard = player.discard.some(c => c.id === cardToMove.id)
          if (!alreadyInDiscard) {
            player.discard.push(cardToMove)
          }
        }
      } else if (target.target === 'deck' && target.playerId !== undefined) {

        // Check if this is a token card
        const isToken = (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') &&
                        (cardToMove.types?.includes('Token') || cardToMove.types?.includes('Token Unit'))

        if (isToken) {
          // Token cards are DESTROYED when moved to hand/discard/deck
          // Remove from board and do NOT add to deck
          newState.board[item.sourceBoardCoords!.row][item.sourceBoardCoords!.col].card = null
          return newState
        }

        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        // Remove Revealed status when card goes to deck
        if (cardToMove.statuses) {
          cardToMove.statuses = cardToMove.statuses.filter(s => s.type !== 'Revealed')
        }
        const player = newState.players.find(p => p.id === target.playerId)

        if (!player) {
          return currentState
        }

        if (cardToMove.ownerId === undefined) {
          cardToMove.ownerId = target.playerId
          cardToMove.ownerName = player.name
        }
        if (target.deckPosition === 'top' || !target.deckPosition) {
          player.deck.unshift(cardToMove)
        } else {
          player.deck.push(cardToMove)
        }
      } else if (target.target === 'announced' && target.playerId !== undefined) {
        const player = newState.players.find(p => p.id === target.playerId)
        if (player) {
          if (player.announcedCard) {
            if (player.announcedCard.statuses) {
              player.announcedCard.statuses = player.announcedCard.statuses.filter(s => s.type === 'Revealed')
            }
            delete player.announcedCard.enteredThisTurn
            delete player.announcedCard.powerModifier
            delete player.announcedCard.bonusPower
            player.hand.push(player.announcedCard)
          }
          player.announcedCard = cardToMove
        }
      }

      // --- HISTORY TRACKING: Leaving Board ---
      if (item.source === 'board' && target.target !== 'board' && cardToMove.ownerId !== undefined) {
        const player = newState.players.find(p => p.id === cardToMove.ownerId)
        if (player) {
          // FIX: Added initialization check for boardHistory to prevent crash if undefined.
          if (!player.boardHistory) {
            player.boardHistory = []
          }
          player.boardHistory = player.boardHistory.filter(id => id !== cardToMove.id)
        }
      }

      // --- Post-Move: Sync LastPlayed Status ---
      if ((item.source === 'board' || target.target === 'board') && cardToMove.ownerId !== undefined) {
        const player = newState.players.find(p => p.id === cardToMove.ownerId)
        if (player) {
          syncLastPlayed(newState.board, player)
        }
      }

      if (item.source === 'hand' && target.target === 'board') {
        const movingCard = cardToMove
        const isRevealed = movingCard.revealedTo === 'all' || movingCard.statuses?.some(s => s.type === 'Revealed')
        if (isRevealed) {
          const gridSize = newState.board.length
          for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
              const spotter = newState.board[r][c].card
              if (spotter && spotter.name.toLowerCase().includes('vigilant spotter')) {
                if (spotter.ownerId !== movingCard.ownerId) {
                  newState.board = recalculateBoardStatuses(newState)
                  const updatedSpotter = newState.board[r][c].card!
                  if (updatedSpotter.statuses?.some(s => s.type === 'Support')) {
                    const spotterOwner = newState.players.find(p => p.id === spotter.ownerId)
                    if (spotterOwner) {
                      // CRITICAL: Use updatePlayerScore to properly sync with server
                      // Score will be updated when server broadcasts back
                      setTimeout(() => {
                        updatePlayerScore(spotterOwner.id, 2)
                      }, 0)
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (item.source === 'board' || target.target === 'board') {
        newState.board = recalculateBoardStatuses(newState)
      }

      // Apply auto-phase transition: Setup -> Main when playing a unit or command card from hand
      if (shouldAutoTransitionToMain) {
        newState.currentPhase = 2 // Main phase
      }

      return newState
    })
  }, [updateState, localPlayerIdRef, updatePlayerScore])

  return {
    moveItem,
  }
}
