/**
 * Targeting Action Utilities
 *
 * Helper functions for creating targeting actions from various sources
 * (cursorStack, abilityMode, playMode, commandModalCard)
 */

import type { Card, GameState, AbilityAction, CursorStackState } from '@/types'
import { countersDatabase } from '@/content'
import { getTokenTargetingRules } from '@/utils/tokenTargeting'

/**
 * Create a targeting action from cursorStack
 * Uses universal token targeting rules from countersDatabase
 */
export function createTargetingActionFromCursorStack(
  cursorStack: CursorStackState,
  gameState: GameState,
  actorId: number
): AbilityAction {
  const targetType = cursorStack.targetType
  const tokenRules = getTokenTargetingRules(cursorStack.type)

  return {
    type: 'ENTER_MODE',
    mode: 'SELECT_TARGET',
    sourceCoords: cursorStack.sourceCoords,
    payload: {
      filter: (card: Card) => {
        // Check if token allows hand targeting (universal rule)
        if (!tokenRules.allowHand) {
          return false
        }

        // Check targetType if specified
        if (targetType && !card.types?.includes(targetType)) {
          return false
        }
        // Check excludeOwnerId (e.g., Revealed token - exclude owner, target opponents)
        if (cursorStack.excludeOwnerId !== undefined && card.ownerId === cursorStack.excludeOwnerId) {
          return false
        }
        // Check onlyOpponents
        if (cursorStack.onlyOpponents) {
          const ownerPlayer = gameState.players.find(p => p.id === actorId)
          if (ownerPlayer && card.ownerId === ownerPlayer.id) {
            return false
          }
        }
        // Check onlyFaceDown (for hand targeting - only face-down cards)
        // For hand cards, face-down means they don't have Revealed status
        if (cursorStack.onlyFaceDown) {
          const isRevealed = card.statuses?.some(s => s.type === 'Revealed')
          if (isRevealed) {
            return false
          }
        }
        // Check targetOwnerId if specified
        if (cursorStack.targetOwnerId !== undefined) {
          if (cursorStack.targetOwnerId === -1) {
            // -1 means opponents only
            const ownerPlayer = gameState.players.find(p => p.id === actorId)
            if (ownerPlayer && card.ownerId === ownerPlayer.id) {
              return false
            }
          } else if (card.ownerId !== cursorStack.targetOwnerId) {
            return false
          }
        }
        return true
      },
      ...(cursorStack.maxDistanceFromSource !== undefined && { range: cursorStack.maxDistanceFromSource }),
    },
    originalOwnerId: cursorStack.originalOwnerId,
  }
}

/**
 * Create a targeting action from abilityMode (preserves payload with filter)
 */
export function createTargetingActionFromAbilityMode(abilityMode: AbilityAction): AbilityAction {
  return {
    type: 'ENTER_MODE',
    mode: 'SELECT_TARGET',
    ...(abilityMode.payload && { payload: abilityMode.payload }),
  }
}

/**
 * Determine targeting player ID based on priority:
 * 1. commandModalCard.ownerId
 * 2. abilityMode.sourceCoords -> card.ownerId
 * 3. cursorStack.originalOwnerId (for token stacking - token owner, not card owner)
 * 4. cursorStack.sourceCard.ownerId (fallback for legacy cursorStack)
 * 5. gameState.activePlayerId
 * 6. localPlayerId
 * 7. actorId
 */
export function determineTargetingPlayerId(
  commandModalCard: Card | null,
  abilityMode: AbilityAction | null,
  cursorStack: CursorStackState | null,
  gameState: GameState,
  localPlayerId: number | null,
  actorId: number,
  boardSize: number
): number {
  let targetingPlayerId: number | null = null

  // Priority 1: commandModalCard.ownerId (for command cards)
  if (commandModalCard?.ownerId !== undefined && typeof commandModalCard.ownerId === 'number') {
    targetingPlayerId = commandModalCard.ownerId
  }

  // Priority 2: abilityMode.sourceCoords -> card.ownerId (for abilities on cards)
  if (targetingPlayerId === null && abilityMode?.sourceCoords) {
    const { row, col } = abilityMode.sourceCoords
    if (row >= 0 && row < boardSize && col >= 0 && col < gameState.board[row].length) {
      const sourceCard = gameState.board[row][col]?.card
      if (sourceCard?.ownerId !== undefined && typeof sourceCard.ownerId === 'number') {
        targetingPlayerId = sourceCard.ownerId
      }
    }
  }

  // Priority 3: cursorStack.originalOwnerId (for token stacking from counters)
  // This ensures tokens like Revealed show the correct player's color (token owner)
  if (targetingPlayerId === null && cursorStack?.originalOwnerId !== undefined && typeof cursorStack.originalOwnerId === 'number') {
    targetingPlayerId = cursorStack.originalOwnerId
  }

  // Priority 4: cursorStack.sourceCard.ownerId (legacy fallback for abilities on cards)
  if (targetingPlayerId === null && cursorStack?.sourceCard?.ownerId !== undefined && typeof cursorStack.sourceCard.ownerId === 'number') {
    targetingPlayerId = cursorStack.sourceCard.ownerId
  }

  // Fallbacks - prioritize activePlayerId (for dummy control) over localPlayerId
  // All values must be validated as numbers
  const activePlayerId = typeof gameState.activePlayerId === 'number' ? gameState.activePlayerId : null
  const validatedLocalPlayerId = typeof localPlayerId === 'number' ? localPlayerId : null
  const validatedActorId = typeof actorId === 'number' ? actorId : 0

  targetingPlayerId = targetingPlayerId ?? activePlayerId ?? validatedLocalPlayerId ?? validatedActorId

  return targetingPlayerId
}
