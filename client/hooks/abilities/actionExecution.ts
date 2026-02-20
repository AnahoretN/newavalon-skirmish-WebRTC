/**
 * Action Execution Handlers
 *
 * Handles execution of various ability actions
 * (GLOBAL_AUTO_APPLY, REVEREND_SETUP_SCORE, etc.)
 */

import type { AbilityAction, GameState } from '@/types'
import { logger } from '@/utils/logger'

export interface ActionCompletionProps {
  gameState: GameState
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  removeStatusByType: (coords: { row: number; col: number }, type: string) => void
  addBoardCardStatus: (coords: { row: number; col: number }, status: string, pid: number) => void
  drawCardsBatch: (playerId: number, count: number) => void
  commandContext: any
}

/**
 * Handle ABILITY_COMPLETE action
 */
export function handleAbilityComplete(action: AbilityAction, onAbilityComplete?: () => void): boolean {
  if (action.type === 'ABILITY_COMPLETE') {
    onAbilityComplete?.()
    return true
  }
  return false
}

/**
 * Handle REVEREND_SETUP_SCORE action
 */
export function handleReverendSetupScore(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionCompletionProps
): boolean {
  if (action.type !== 'REVEREND_SETUP_SCORE') {
    return false
  }

  const { gameState, updatePlayerScore, triggerFloatingText, markAbilityUsed } = props
  const ownerId = action.sourceCard?.ownerId ?? 0
  let exploitCount = 0

  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const card = gameState.board[r][c]?.card
      if (card?.statuses) {
        const exploitCounters = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
        exploitCount += exploitCounters.length
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)
    triggerFloatingText([{
      row: sourceCoords.row,
      col: sourceCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    }])
  } else {
    triggerFloatingText([{
      row: sourceCoords.row,
      col: sourceCoords.col,
      text: `+0`,
      playerId: ownerId,
    }])
  }

  markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
  return true
}

/**
 * Handle FINN_SCORING custom action
 */
export function handleFinnScoring(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionCompletionProps
): boolean {
  if (action.payload?.customAction !== 'FINN_SCORING') {
    return false
  }

  const { gameState, updatePlayerScore, triggerFloatingText, markAbilityUsed } = props
  let revealedCount = 0
  const finnOwnerId = action.sourceCard?.ownerId

  if (finnOwnerId === undefined) {
    logger.warn('[FINN_SCORING] Source card missing ownerId, skipping scoring')
    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return true
  }

  // Count Revealed cards in opponents' hands
  gameState.players.forEach(p => {
    if (p.id !== finnOwnerId) {
      p.hand.forEach(c => {
        if (c.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId)) {
          revealedCount++
        }
      })
    }
  })

  // Count Revealed cards on the battlefield owned by opponents
  gameState.board.forEach(row => {
    row.forEach(cell => {
      const card = cell.card
      if (card && card.ownerId !== finnOwnerId) {
        const revealedByFinn = card.statuses?.filter(s => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId).length || 0
        revealedCount += revealedByFinn
      }
    })
  })

  if (revealedCount > 0) {
    const coords = action.sourceCoords || sourceCoords
    triggerFloatingText({
      row: coords.row,
      col: coords.col,
      text: `+${revealedCount}`,
      playerId: finnOwnerId,
    })
    updatePlayerScore(finnOwnerId, revealedCount)
  }

  markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
  return true
}

/**
 * Handle REMOVE_ALL_AIM_FROM_CONTEXT custom action
 */
export function handleRemoveAllAimFromContext(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionCompletionProps
): boolean {
  if (action.payload?.customAction !== 'REMOVE_ALL_AIM_FROM_CONTEXT') {
    return false
  }

  const { removeStatusByType, commandContext } = props

  if (action.sourceCoords && action.sourceCoords.row >= 0) {
    removeStatusByType(action.sourceCoords, 'Aim')
  } else if (commandContext.lastMovedCardCoords) {
    removeStatusByType(commandContext.lastMovedCardCoords, 'Aim')
  } else if (sourceCoords && sourceCoords.row >= 0) {
    removeStatusByType(sourceCoords, 'Aim')
  }

  return true
}
