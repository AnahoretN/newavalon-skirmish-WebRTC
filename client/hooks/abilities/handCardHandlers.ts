/**
 * Hand Card Click Handlers
 *
 * Handles clicks on cards in players' hands
 */

import type { Card, Player, AbilityAction, CursorStackState } from '@/types'
import { TIMING } from '@/utils/common'
import { validateTarget } from '@shared/utils/targeting'
import { canActivateAbility } from '@shared/abilities'

 

export interface HandCardClickProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  setCommandContext: React.Dispatch<React.SetStateAction<any>>
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: any, target: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  triggerHandCardSelection: (playerId: number, cardIndex: number, actorId: number) => void
  activateAbility: (card: Card, coords: { row: number; col: number }) => void
  clearTargetingMode: () => void
  clearValidTargets?: () => void
}

/**
 * Handle click on a card in hand
 */
export function handleHandCardClick(
  player: Player,
  card: Card,
  cardIndex: number,
  props: HandCardClickProps
): void {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    cursorStack,
    interactionLock,
    setCommandContext,
    setAbilityMode,
    moveItem,
    markAbilityUsed,
    handleActionExecution,
    triggerHandCardSelection,
    setCursorStack,
    clearTargetingMode,
    clearValidTargets,
  } = props

  if (interactionLock.current) {
    return
  }

  // Handle cursorStack for hand cards (e.g., Revealed tokens from Threat Analyst)
  if (cursorStack) {
    // RULE: Targeting tokens (Aim, Exploit, Stun, Shield) cannot be placed on cards in hand
    // Only Rule tokens (and Revealed status) can be placed on hand cards
    const targetingTokens = ['Aim', 'Exploit', 'Stun', 'Shield']
    if (targetingTokens.includes(cursorStack.type)) {
      // Silently ignore - do not allow targeting tokens on hand cards
      return
    }

    // Check if this card is a valid target for the cursorStack
    const constraints = {
      targetOwnerId: cursorStack.targetOwnerId,
      excludeOwnerId: cursorStack.excludeOwnerId,
      onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
      onlyFaceDown: cursorStack.onlyFaceDown,
      targetType: cursorStack.targetType,
      requiredTargetStatus: cursorStack.requiredTargetStatus,
      tokenType: cursorStack.type,
    }

    const isValid = validateTarget(
      { card, ownerId: player.id, location: 'hand' },
      constraints,
      gameState.activePlayerId,
      gameState.players,
    )

    if (isValid) {
      // Apply the token/status to the card
      if (cursorStack.type === 'Revealed') {
        // For Revealed, we need to request reveal or add status
        const effectiveActorId = cursorStack.sourceCard?.ownerId ?? gameState.activePlayerId ?? localPlayerId ?? 1
        if (!card.statuses) {
          card.statuses = []
        }
        // Check if already has Revealed from this player
        const hasRevealed = card.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)
        if (!hasRevealed) {
          card.statuses.push({ type: 'Revealed', addedByPlayerId: effectiveActorId })
          // Update state via moveItem to properly sync
          moveItem({
            card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
            source: 'counter_panel',
            statusType: 'Revealed',
            count: 1,
          }, { target: 'hand', playerId: player.id, cardIndex })

          if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
            markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility, false, cursorStack.readyStatusToRemove)
          }
          if (cursorStack.count > 1) {
            setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
          } else {
            // Clear targeting mode and valid targets when last token is placed
            clearTargetingMode()
            clearValidTargets?.()
            if (cursorStack.chainedAction) {
              handleActionExecution(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
            }
            setCursorStack(null)
          }
        }
      }
    }
    return
  }

  // Add visual selection effect when card is clicked during selection mode
  if (abilityMode?.type === 'ENTER_MODE' && abilityMode.mode === 'SELECT_TARGET') {
    const { payload, sourceCoords, isDeployAbility, sourceCard, readyStatusToRemove } = abilityMode

    // Trigger hand card selection effect visible to all players via WebSocket (before any filtering)
    triggerHandCardSelection(player.id, cardIndex, gameState.activePlayerId ?? localPlayerId ?? 1)

    // SELECT_HAND_FOR_DEPLOY (Quick Response Team)
    if (payload.actionType === 'SELECT_HAND_FOR_DEPLOY') {
      if (payload.filter && !payload.filter(card)) {
        return
      }

      setCommandContext((prev: any) => ({ ...prev, selectedHandCard: { playerId: player.id, cardIndex } }))

      setAbilityMode({
        type: 'ENTER_MODE',
        mode: 'SELECT_CELL',
        sourceCard: card,
        payload: { range: 'global', moveFromHand: true },
      })
      return
    }

    // SELECT_HAND_FOR_DISCARD_THEN_SPAWN (Faber)
    if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN') {
      // Apply filter to validate the card
      if (payload.filter && !payload.filter(card)) {
        return
      }
      if (player.id !== sourceCard?.ownerId) {
        return
      } // Only discard own cards

      // 1. Discard the selected card
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

      // 2. Clear old targeting mode (SELECT_TARGET) and valid targets (hand cards)
      clearTargetingMode()
      clearValidTargets?.()

      // 3. Chain to SPAWN_TOKEN mode
      const spawnTokenAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'SPAWN_TOKEN',
        sourceCard: sourceCard,
        sourceCoords: sourceCoords,
        isDeployAbility: isDeployAbility,
        payload: { tokenName: payload.tokenName },
      }

      setAbilityMode(spawnTokenAction)

      // 4. Set new targeting mode for SPAWN_TOKEN to show valid empty cells
      // This uses the same mechanism as other ENTER_MODE actions
      if (sourceCoords && sourceCoords.row >= 0) {
        // Call handleActionExecution to properly set targetingMode for SPAWN_TOKEN
        setTimeout(() => {
          handleActionExecution(spawnTokenAction, sourceCoords)
        }, 0)
      }
      return
    }

    // LUCIUS SETUP: Discard 1 -> Search Command
    if (payload.actionType === 'LUCIUS_SETUP') {
      if (player.id !== sourceCard?.ownerId) {
        return
      } // Only discard own cards

      // 1. Discard the selected card
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

      // 2. Open Search Modal via Execution
      const openModalAction: AbilityAction = {
        type: 'OPEN_MODAL',
        mode: 'SEARCH_DECK',
        sourceCard: sourceCard,
        sourceCoords: sourceCoords, // This ensures ability gets marked used when modal closes
        isDeployAbility: isDeployAbility,
        payload: { filterType: 'Command' },
      }

      handleActionExecution(openModalAction, sourceCoords || { row: -1, col: -1 })
      setAbilityMode(null)
      return
    }

    // DESTROY Hand Card
    if (payload.actionType === 'DESTROY') {
      if (payload.filter && !payload.filter(card)) {
        return
      }
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    }
  }
}

/**
 * Handle double click on an announced card (visible to all players)
 */
export function handleAnnouncedCardDoubleClick(
  player: Player,
  card: Card,
  props: HandCardClickProps
): void {
  const {
    abilityMode,
    cursorStack,
    interactionLock,
    gameState,
    activateAbility,
  } = props

  if (abilityMode || cursorStack) {
    return
  }
  if (interactionLock.current) {
    return
  }

  if (!gameState.isGameStarted) {
    return
  }
  if (gameState.activePlayerId !== player.id) {
    return
  }
  if (!canActivateAbility(card as any, 'setup', gameState.currentPhase)) {
    return
  }
  activateAbility(card, { row: -1, col: -1 })
}
