/**
 * Client-side Ability Utilities
 *
 * This file provides client-specific helper functions for abilities.
 * Core ready status logic is imported from shared/abilities.
 */

import type { Card, GameState } from '@/types'
import { canActivateAbility as serverCanActivateAbility, getCardAbilityTypes, CARD_ABILITIES } from '@server/utils/autoAbilities'
import {
  hasReadyStatus,
  hasReadyAbilityInCurrentPhase as sharedHasReadyAbilityInCurrentPhase,
  READY_STATUS_DEPLOY,
  READY_STATUS_SETUP,
  READY_STATUS_COMMIT
} from '@shared/abilities/index.js'
import { logger } from './logger'
import type { AbilityActivationType } from '@server/utils/autoAbilities'

// Re-export for backward compatibility
export { READY_STATUS_DEPLOY, READY_STATUS_SETUP, READY_STATUS_COMMIT }

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
 * Checks if a card has a ready status for the current phase (for VISUAL display only).
 * This checks that the card's owner is the active player (unlike hasReadyAbilityInCurrentPhase
 * which also checks this). Used for showing ready abilities on cards during the owner's turn.
 *
 * Only checks:
 * 1. Card's owner is the active player
 * 2. Card has a ready status that matches the current phase
 * 3. Card doesn't have Stun status
 * 4. If ability requires Support, card has Support status
 *
 * @param card - The card to check
 * @param phaseOrGameState - Either current phase index (0-4) or full GameState
 * @returns true if card has a ready status for visual display
 */
export const hasReadyStatusForPhase = (
  card: Card,
  phaseOrGameState: GameState | number
): boolean => {
  let phaseIndex: number
  let gameState: GameState | undefined
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
    gameState = phaseOrGameState
  } else {
    phaseIndex = phaseOrGameState
  }

  // IMPORTANT: Only show ready status for cards owned by the active player
  const activePlayerId = gameState?.activePlayerId
  if (activePlayerId === undefined || card.ownerId !== activePlayerId) {
    return false
  }

  // Check if stunned
  if (card.statuses?.some(s => s.type === 'Stun')) {
    return false
  }

  // Get ready status for current phase
  const readyStatus = getReadyStatusForPhase(card, phaseIndex)
  if (!readyStatus) {
    return false
  }

  // Check Support requirement using server-side logic
  return serverCanActivateAbility(card as any, phaseIndex, card.ownerId, gameState as any)
}

/**
 * Checks if a card should show visual ready highlighting AND can be activated
 * (only when card's owner is the active player).
 *
 * Uses server-side canActivateAbility for consistent logic.
 *
 * @param card - The card to check
 * @param phaseOrGameState - Either current phase index (0-4) or full GameState
 * @param activePlayerId - ID of active player (only used if first param is phase number)
 * @returns true if card should highlight with ready effect AND can be activated
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
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
    activePlayerId = phaseOrGameState.activePlayerId ?? undefined
  } else {
    phaseIndex = phaseOrGameState
  }

  // IMPORTANT: Only show ready status for cards owned by the active player
  if (activePlayerId === undefined || card.ownerId !== activePlayerId) {
    return false
  }

  // Check if stunned
  if (card.statuses?.some(s => s.type === 'Stun')) {
    return false
  }

  // Check card's ready statuses directly
  // If a card has a ready status, it means the card has that ability
  const hasDeploy = hasReadyStatus(card, READY_STATUS_DEPLOY)
  const hasSetup = hasReadyStatus(card, READY_STATUS_SETUP)
  const hasCommit = hasReadyStatus(card, READY_STATUS_COMMIT)

  // Use shared logic for phase-appropriate ready status check
  return sharedHasReadyAbilityInCurrentPhase(
    card,
    phaseIndex,
    hasDeploy,
    hasSetup,
    hasCommit
  )
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

  // Use server-side ability definitions to determine which ready statuses to add
  const abilityTypes = getCardAbilityTypes(card as any)

  for (const abilityType of abilityTypes) {
    let readyStatusType = ''
    if (abilityType === 'deploy') {
      readyStatusType = READY_STATUS_DEPLOY
    } else if (abilityType === 'setup') {
      readyStatusType = READY_STATUS_SETUP
    } else if (abilityType === 'commit') {
      readyStatusType = READY_STATUS_COMMIT
    }

    if (readyStatusType) {
      const alreadyHas = card.statuses.some(s => s.type === readyStatusType)
      if (!alreadyHas) {
        card.statuses.push({ type: readyStatusType, addedByPlayerId: ownerId })
      }
    }
  }
}

/**
 * Removes all ready statuses from a card (when leaving battlefield)
 * Now imported from shared
 */
export { removeAllReadyStatuses } from '@shared/abilities/index.js'

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

/**
 * Resets phase-specific ready statuses for ALL cards owned by a player on the battlefield.
 * This should be called at the start of each turn (Preparation phase) for the active player.
 *
 * @param gameState - The current game state (will be modified in place for efficiency)
 * @param playerId - The player whose cards should have their ready statuses reset
 */
export const resetReadyStatusesForTurn = (gameState: GameState, playerId: number): void => {
  // Get list of cards with setup/commit abilities from server-side definitions
  const setupCards = getCardsWithAbilityType('setup')
  const commitCards = getCardsWithAbilityType('commit')

  logger.debug(`[resetReadyStatusesForTurn] Player ${playerId}, setupCards: [${setupCards.join(', ')}], commitCards: [${commitCards.join(', ')}]`)

  let cardsProcessed = 0
  let setupAdded = 0
  let commitAdded = 0

  // Process each cell on the board
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const cell = gameState.board[r][c]
      const card = cell.card

      if (!card || card.ownerId !== playerId) {
        continue
      }

      cardsProcessed++

      // Get baseId without set prefix
      const baseId = card.baseId || card.id
      if (!baseId) {
        continue
      }

      logger.debug(`[resetReadyStatusesForTurn] Processing card: ${card.name} (baseId: ${baseId}, ownerId: ${card.ownerId})`)

      // Ensure card has statuses array
      if (!card.statuses) {
        card.statuses = []
      }

      // === SETUP ABILITY ===
      if (setupCards.includes(baseId)) {
        const hadSetup = card.statuses.some(s => s.type === READY_STATUS_SETUP)
        // Remove old setup status first, then add fresh one
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP)
        card.statuses.push({ type: READY_STATUS_SETUP, addedByPlayerId: playerId })
        setupAdded++
        if (!hadSetup) {
          logger.debug(`[resetReadyStatusesForTurn] Added NEW READY_STATUS_SETUP to ${card.name}`)
        }
      } else {
        // Remove setup status if card no longer has setup ability (e.g. was transformed)
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP)
      }

      // === COMMIT ABILITY ===
      if (commitCards.includes(baseId)) {
        const hadCommit = card.statuses.some(s => s.type === READY_STATUS_COMMIT)
        // Remove old commit status first, then add fresh one
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_COMMIT)
        card.statuses.push({ type: READY_STATUS_COMMIT, addedByPlayerId: playerId })
        commitAdded++
        if (!hadCommit) {
          logger.debug(`[resetReadyStatusesForTurn] Added NEW READY_STATUS_COMMIT to ${card.name}`)
        }
      } else {
        // Remove commit status if card no longer has commit ability
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_COMMIT)
      }
    }
  }

  logger.debug(`[resetReadyStatusesForTurn] Processed ${cardsProcessed} cards, reset setup: ${setupAdded}, commit: ${commitAdded}`)
}

/**
 * Get list of card baseIds that have a specific ability type
 * Uses server-side CARD_ABILITIES to ensure consistency
 */
function getCardsWithAbilityType(abilityType: AbilityActivationType): string[] {
  const cardIds: string[] = []
  CARD_ABILITIES.forEach(ability => {
    if (ability.activationType === abilityType) {
      cardIds.push(ability.baseId)
      if (ability.baseIdAlt) {
        cardIds.push(...ability.baseIdAlt)
      }
    }
  })
  // Remove duplicates
  return [...new Set(cardIds)]
}
