import type { Card, GameState } from '@/types'
import { canActivateAbility as serverCanActivateAbility, getCardAbilityTypes } from '@server/utils/autoAbilities'
import { READY_STATUS_DEPLOY, READY_STATUS_SETUP, READY_STATUS_COMMIT } from '@shared/constants/readyStatuses'

// Re-export for backward compatibility
export { READY_STATUS_DEPLOY, READY_STATUS_SETUP, READY_STATUS_COMMIT }

/**
 * Checks if a card has a specific ready status
 */
export const hasReadyStatus = (card: Card, statusType: string): boolean => {
  if (!card.statuses || card.statuses.length === 0) {
    return false
  }
  return card.statuses.some(s => s.type === statusType)
}

/**
 * Checks if a card has any ready status
 */
export const hasAnyReadyStatus = (card: Card): boolean => {
  return hasReadyStatus(card, READY_STATUS_DEPLOY) ||
         hasReadyStatus(card, READY_STATUS_SETUP) ||
         hasReadyStatus(card, READY_STATUS_COMMIT)
}

/**
 * Gets the ready status that should be used for the current phase
 * Returns null if no ready status is available for this phase
 *
 * Priority order (matches server logic):
 * 1. Setup abilities - ONLY in Setup phase (phase 1)
 * 2. Commit abilities - ONLY in Commit phase (phase 3)
 * 3. Deploy abilities - in any other phase (including Main/phase 2, Preparation/phase 0)
 */
export const getReadyStatusForPhase = (card: Card, phaseIndex: number): string | null => {
  // Priority 1: Setup (ONLY in Setup phase / phase 1)
  if (phaseIndex === 1) {
    if (hasReadyStatus(card, READY_STATUS_SETUP)) {
      return READY_STATUS_SETUP
    }
  }

  // Priority 2: Commit (ONLY in Commit phase / phase 3)
  if (phaseIndex === 3) {
    if (hasReadyStatus(card, READY_STATUS_COMMIT)) {
      return READY_STATUS_COMMIT
    }
  }

  // Priority 3: Deploy (works in any phase if no phase-specific ability is active)
  if (hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    return READY_STATUS_DEPLOY
  }

  return null
}

/**
 * Checks if a card should show visual ready highlighting based on:
 * 1. Card's owner is the active player
 * 2. Card has a ready status that matches the current phase
 * 3. Card doesn't have Stun status
 * 4. If ability requires Support, card has Support status
 *
 * Uses server-side canActivateAbility for consistent logic.
 *
 * @param card - The card to check
 * @param phaseOrGameState - Either current phase index (0-4) or full GameState
 * @param activePlayerId - ID of active player (only used if first param is phase number)
 * @returns true if card should highlight with ready effect
 */
export const hasReadyAbilityInCurrentPhase = (
  card: Card,
  phaseOrGameState: GameState | number,
  activePlayerId?: number | null
): boolean => {
  // Handle both call styles:
  // - hasReadyAbilityInCurrentPhase(card, gameState)
  // - hasReadyAbilityInCurrentPhase(card, phaseIndex, activePlayerId)
  let phaseIndex: number
  let gameState: GameState | undefined
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
    activePlayerId = phaseOrGameState.activePlayerId ?? undefined
    gameState = phaseOrGameState
  } else {
    phaseIndex = phaseOrGameState
  }

  // Use server-side logic which includes:
  // - Active player ownership check
  // - Stun status check
  // - Support requirement check
  // - Phase-appropriate ready status check
  return serverCanActivateAbility(card as any, phaseIndex, activePlayerId ?? undefined, gameState as any)
}

/**
 * Checks if a card can activate any ability in the current phase
 * This is the client-side version that checks ready statuses
 * @deprecated Use hasReadyAbilityInCurrentPhase instead for UI highlighting
 */
export const canActivateAbility = (card: Card, phaseIndex: number, _activePlayerId: number | undefined): boolean => {
  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Gets all available ready statuses for a card
 */
export const getAvailableReadyStatuses = (card: Card): string[] => {
  const available: string[] = []

  if (hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    available.push(READY_STATUS_DEPLOY)
  }
  if (hasReadyStatus(card, READY_STATUS_SETUP)) {
    available.push(READY_STATUS_SETUP)
  }
  if (hasReadyStatus(card, READY_STATUS_COMMIT)) {
    available.push(READY_STATUS_COMMIT)
  }

  return available
}

/**
 * Initializes ready statuses for a card entering the battlefield.
 * Uses server-side CARD_ABILITIES list to determine which abilities a card has.
 */
export const initializeReadyStatuses = (card: Card, ownerId: number): void => {
  if (!card.statuses) {
    card.statuses = []
  }

  const oldStatusesLength = card.statuses.length
  const oldStatusesTypes = card.statuses.map(s => s.type)

  // Use server-side ability definitions to determine which ready statuses to add
  const abilityTypes = getCardAbilityTypes(card as any)

  console.log(`[initializeReadyStatuses] Card: ${card.name} (${card.id}), ownerId: ${ownerId}, abilities: [${abilityTypes.join(', ')}]`)

  for (const abilityType of abilityTypes) {
    let readyStatusType = ''
    if (abilityType === 'deploy') {
      readyStatusType = READY_STATUS_DEPLOY
    } else if (abilityType === 'setup') {
      readyStatusType = READY_STATUS_SETUP
    } else if (abilityType === 'commit') {
      readyStatusType = READY_STATUS_COMMIT
    }

    if (readyStatusType && !card.statuses.some(s => s.type === readyStatusType)) {
      card.statuses.push({ type: readyStatusType, addedByPlayerId: ownerId })
      console.log(`[initializeReadyStatuses] Added status: ${readyStatusType} to ${card.name}`)
    }
  }

  if (card.statuses.length !== oldStatusesLength) {
    console.log(`[initializeReadyStatuses] Card ${card.name}: statuses changed from [${oldStatusesTypes.join(', ')}] to [${card.statuses.map(s => s.type).join(', ')}]`)
  }
}

/**
 * Removes all ready statuses from a card (when leaving battlefield)
 */
export const removeAllReadyStatuses = (card: Card): void => {
  if (!card.statuses) {return}
  card.statuses = card.statuses.filter(s =>
    s.type !== READY_STATUS_DEPLOY &&
    s.type !== READY_STATUS_SETUP &&
    s.type !== READY_STATUS_COMMIT
  )
}

/**
 * Resets phase-specific ready statuses (readySetup, readyCommit) for a player's cards at turn start.
 * Does NOT reset readyDeploy (only once per game when entering battlefield).
 * Uses server-side CARD_ABILITIES list to determine which abilities a card has.
 */
export const resetPhaseReadyStatuses = (card: Card, ownerId: number): void => {
  if (!card.statuses) {
    card.statuses = []
  }

  // Use server-side ability definitions to determine which ready statuses to add
  const abilityTypes = getCardAbilityTypes(card as any)

  for (const abilityType of abilityTypes) {
    // Skip deploy - it's only added once when entering battlefield
    if (abilityType === 'deploy') {
      continue
    }

    let readyStatusType = ''
    if (abilityType === 'setup') {
      readyStatusType = READY_STATUS_SETUP
    } else if (abilityType === 'commit') {
      readyStatusType = READY_STATUS_COMMIT
    }

    if (readyStatusType && !card.statuses.some(s => s.type === readyStatusType)) {
      card.statuses.push({ type: readyStatusType, addedByPlayerId: ownerId })
    }
  }
}
