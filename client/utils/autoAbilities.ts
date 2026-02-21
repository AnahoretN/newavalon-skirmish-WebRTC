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
 *
 * SIMPLIFIED VERSION: Visual effect is now DIRECTLY tied to the presence of ready status.
 * If status exists → effect shows. If status removed → effect disappears.
 *
 * All the rules (owner, Stun, phase, Support) are applied when ADDING/REMOVING the status,
 * not when checking for visual display.
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
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
  } else {
    phaseIndex = phaseOrGameState
  }

  // Simply check if card has the appropriate ready status for current phase
  // The status itself should only exist when all conditions are met
  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Checks if a card should show visual ready highlighting AND can be activated
 * (only when card's owner is the active player).
 *
 * SIMPLIFIED VERSION: Now directly checks for ready status presence.
 * All rules (owner, Stun, Support) are applied when status is added/removed.
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

  // CRITICAL: Only show ready effect for active player's cards
  // This prevents showing glow on other players' cards during their turn
  if (activePlayerId !== undefined && card.ownerId !== activePlayerId) {
    return false
  }

  // Simply check if card has the appropriate ready status for current phase
  // The status itself should only exist when all conditions are met
  return getReadyStatusForPhase(card, phaseIndex) !== null
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
 * IMPORTANT: Now applies ALL rules when adding/removing statuses:
 * - Owner must be active player
 * - Card must not have Stun
 * - Card must meet Support requirement if ability needs it
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

  // Current phase for checking
  const currentPhase = gameState.currentPhase

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

      // === PRE-CHECK: Common conditions for ALL ready statuses ===
      // 1. Check if stunned
      const isStunned = card.statuses.some(s => s.type === 'Stun')
      if (isStunned) {
        // Remove all ready statuses if stunned
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP && s.type !== READY_STATUS_COMMIT)
        logger.debug(`[resetReadyStatusesForTurn] Card ${card.name} is stunned, removing ready statuses`)
        continue
      }

      // 2. Check if can activate ability (includes Support requirement)
      const canActivate = serverCanActivateAbility(card as any, currentPhase, playerId, gameState as any)
      if (!canActivate) {
        // Remove all ready statuses if cannot activate (e.g. missing Support)
        card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP && s.type !== READY_STATUS_COMMIT)
        logger.debug(`[resetReadyStatusesForTurn] Card ${card.name} cannot activate (missing Support?), removing ready statuses`)
        continue
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
 * Recalculates ready statuses for ALL players' cards from local perspective.
 * - Active player's cards: may have readySetup/readyCommit (if conditions met)
 * - Other players' cards: NO ready statuses (they are not active)
 *
 * This ensures that when receiving state from other players, we only see
 * ready effects for the active player.
 *
 * @param gameState - The current game state (will be modified in place)
 */
export const recalculateAllReadyStatuses = (gameState: GameState): void => {
  const activePlayerId = gameState.activePlayerId
  if (activePlayerId === undefined) {
    return
  }

  // First, remove ALL ready statuses from ALL cards on the board
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const card = gameState.board[r][c].card
      if (card && card.statuses) {
        card.statuses = card.statuses.filter(s =>
          s.type !== READY_STATUS_DEPLOY &&
          s.type !== READY_STATUS_SETUP &&
          s.type !== READY_STATUS_COMMIT
        )
      }
    }
  }

  // Then, add ready statuses ONLY for the active player's cards
  resetReadyStatusesForTurn(gameState, activePlayerId)
}

/**
 * Rechecks and updates ready statuses for a single card based on current conditions.
 * Should be called when conditions change: Stun added/removed, Support added/removed, etc.
 *
 * Rules applied (same as resetReadyStatusesForTurn):
 * - Owner must be active player
 * - Card must not have Stun
 * - Card must meet Support requirement if ability needs it
 *
 * @param card - The card to recheck
 * @param gameState - The current game state
 */
export const recheckReadyStatuses = (card: Card, gameState: GameState): void => {
  if (!card.ownerId) {
    return
  }

  const playerId = card.ownerId
  const isActivePlayer = gameState.activePlayerId === playerId

  // Ensure card has statuses array
  if (!card.statuses) {
    card.statuses = []
  }

  // Get baseId without set prefix
  const baseId = card.baseId || card.id
  if (!baseId) {
    return
  }

  // Get list of cards with abilities
  const setupCards = getCardsWithAbilityType('setup')
  const commitCards = getCardsWithAbilityType('commit')
  const deployCards = getCardsWithAbilityType('deploy')

  // === CHECK CONDITIONS ===
  let shouldHaveSetup = false
  let shouldHaveCommit = false
  let shouldHaveDeploy = false

  // 1. Owner must be active player
  if (!isActivePlayer) {
    // Remove all ready statuses if not active player
    card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP && s.type !== READY_STATUS_COMMIT && s.type !== READY_STATUS_DEPLOY)
    logger.debug(`[recheckReadyStatuses] Card ${card.name} owner not active, removed all ready statuses`)
    return
  }

  // 2. Check if stunned
  const isStunned = card.statuses.some(s => s.type === 'Stun')
  if (isStunned) {
    // Remove all ready statuses if stunned
    card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP && s.type !== READY_STATUS_COMMIT && s.type !== READY_STATUS_DEPLOY)
    logger.debug(`[recheckReadyStatuses] Card ${card.name} is stunned, removed all ready statuses`)
    return
  }

  // 3. Check if can activate ability (includes Support requirement)
  const canActivate = serverCanActivateAbility(card as any, gameState.currentPhase, playerId, gameState as any)
  if (!canActivate) {
    // Remove all ready statuses if cannot activate (e.g. missing Support)
    card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP && s.type !== READY_STATUS_COMMIT && s.type !== READY_STATUS_DEPLOY)
    logger.debug(`[recheckReadyStatuses] Card ${card.name} cannot activate (missing Support?), removed all ready statuses`)
    return
  }

  // === DETERMINE WHICH STATUSES SHOULD EXIST ===
  if (setupCards.includes(baseId)) {
    shouldHaveSetup = true
  }
  if (commitCards.includes(baseId)) {
    shouldHaveCommit = true
  }
  if (deployCards.includes(baseId)) {
    // Deploy is special - only exists once when entering battlefield
    // Don't re-add it here if it was removed
    const hasDeploy = card.statuses.some(s => s.type === READY_STATUS_DEPLOY)
    shouldHaveDeploy = hasDeploy
  }

  // === UPDATE STATUSES ===
  // Setup
  const hasSetup = card.statuses.some(s => s.type === READY_STATUS_SETUP)
  if (shouldHaveSetup && !hasSetup) {
    card.statuses.push({ type: READY_STATUS_SETUP, addedByPlayerId: playerId })
    logger.debug(`[recheckReadyStatuses] Added READY_STATUS_SETUP to ${card.name}`)
  } else if (!shouldHaveSetup && hasSetup) {
    card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_SETUP)
    logger.debug(`[recheckReadyStatuses] Removed READY_STATUS_SETUP from ${card.name}`)
  }

  // Commit
  const hasCommit = card.statuses.some(s => s.type === READY_STATUS_COMMIT)
  if (shouldHaveCommit && !hasCommit) {
    card.statuses.push({ type: READY_STATUS_COMMIT, addedByPlayerId: playerId })
    logger.debug(`[recheckReadyStatuses] Added READY_STATUS_COMMIT to ${card.name}`)
  } else if (!shouldHaveCommit && hasCommit) {
    card.statuses = card.statuses.filter(s => s.type !== READY_STATUS_COMMIT)
    logger.debug(`[recheckReadyStatuses] Removed READY_STATUS_COMMIT from ${card.name}`)
  }

  // Deploy is managed elsewhere (only removed on phase change, not re-added here)
}

/**
 * Rechecks ready statuses for all cards of a player.
 * Useful when conditions change globally (e.g. Support token added).
 *
 * @param gameState - The current game state (will be modified in place)
 * @param playerId - The player whose cards should be rechecked
 */
export const recheckAllReadyStatuses = (gameState: GameState, playerId: number): void => {
  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const cell = gameState.board[r][c]
      const card = cell.card
      if (card && card.ownerId === playerId) {
        recheckReadyStatuses(card, gameState)
      }
    }
  }
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
