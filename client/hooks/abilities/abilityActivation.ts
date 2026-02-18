/**
 * Ability Activation Handlers
 *
 * Handles activation of abilities from cards
 */

import type { Card, GameState, AbilityAction } from '@/types'
import { getCardAbilityAction } from '@server/utils/autoAbilities'
import { canActivateAbility } from '@server/utils/autoAbilities'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'

export interface AbilityActivationProps {
  gameState: GameState
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  cursorStack: any
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
}

/**
 * Activate a card's ability
 * Returns the action that should be executed, or null if activation failed
 */
export function activateAbility(
  card: Card,
  boardCoords: { row: number; col: number },
  props: AbilityActivationProps
): AbilityAction | null {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    cursorStack,
    handleActionExecution,
    markAbilityUsed,
  } = props

  if (abilityMode || cursorStack) {
    return null
  }
  if (!gameState.isGameStarted || localPlayerId === null) {
    return null
  }

  const owner = gameState.players.find(p => p.id === card.ownerId)
  // Only the host (player 1) can control dummy players' cards
  const canControl = localPlayerId === card.ownerId || (owner?.isDummy && localPlayerId === 1)

  if (gameState.activePlayerId !== card.ownerId) {
    return null
  }
  if (!canControl) {
    return null
  }

  // Only activate if card has visual ready effect
  // This ensures abilities only activate when the player can see the visual indicator
  if (!hasReadyAbilityInCurrentPhase(card, gameState)) {
    return null
  }

  if (!canActivateAbility(card as any, gameState.currentPhase, gameState.activePlayerId, gameState as any)) {
    return null
  }

  const action = getCardAbilityAction(card as any, gameState as any, card.ownerId!, boardCoords)
  if (action) {
    // NEW FLOW: Remove ready status FIRST, then execute
    // This ensures the visual highlight disappears immediately on click
    if (action.readyStatusToRemove) {
      markAbilityUsed(boardCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // Add ABILITY_COMPLETE at the end of the action chain to trigger readiness recheck
    const actionWithComplete: AbilityAction = {
      ...action,
      chainedAction: action.chainedAction
        ? { ...action.chainedAction, chainedAction: { type: 'ABILITY_COMPLETE' } }
        : { type: 'ABILITY_COMPLETE' }
    }

    // Execute the action (which will check targets and show no-target if needed)
    handleActionExecution(actionWithComplete, boardCoords)
    return actionWithComplete
  }

  return null
}
