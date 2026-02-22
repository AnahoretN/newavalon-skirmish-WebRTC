/**
 * Unified Ready Status System
 *
 * Consolidates all ready status logic into a single, consistent system.
 * Replaces the scattered logic across client/server/autoAbilities files.
 *
 * Core principles:
 * 1. Single source of truth for ready status rules
 * 2. Minimal duplication between client/server
 * 3. Clear separation: what statuses exist vs how they're displayed
 */

import type { Card, GameState } from '../../client/types.js'

// ============================================================================
// Constants
// ============================================================================

export const READY_STATUS = {
  DEPLOY: 'readyDeploy',
  SETUP: 'readySetup',
  COMMIT: 'readyCommit'
} as const

export type ReadyStatusType = typeof READY_STATUS[keyof typeof READY_STATUS]

// Ready statuses that are phase-specific (calculated locally, not broadcast)
export const PHASE_SPECIFIC_STATUSES = [READY_STATUS.SETUP, READY_STATUS.COMMIT] as const

// Turn-limited ability usage tracking (removed when turn passes)
export const TURN_LIMITED_ABILITIES = {
  SETUP_USED: 'setupUsedThisTurn',
  COMMIT_USED: 'commitUsedThisTurn'
} as const

// ============================================================================
// Type Guards
// ============================================================================

export function isReadyStatus(statusType: string): statusType is ReadyStatusType {
  return Object.values(READY_STATUS).includes(statusType as ReadyStatusType)
}

// ============================================================================
// Ready Status Helpers
// ============================================================================

/** Check if card has a specific ready status */
export function hasReadyStatus(card: Card, statusType: ReadyStatusType): boolean {
  if (!card.statuses) return false
  return card.statuses.some(s => s.type === statusType)
}

/** Check if card has any ready status */
export function hasAnyReadyStatus(card: Card): boolean {
  if (!card.statuses) return false
  return card.statuses.some(s => isReadyStatus(s.type))
}

/** Add ready status to card if not present */
export function addReadyStatus(card: Card, statusType: ReadyStatusType, ownerId: number): void {
  if (!card.statuses) card.statuses = []
  if (!card.statuses.some(s => s.type === statusType)) {
    card.statuses.push({ type: statusType, addedByPlayerId: ownerId })
  }
}

/** Remove ready status from card */
export function removeReadyStatus(card: Card, statusType: ReadyStatusType): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter(s => s.type !== statusType)
}

/** Remove all ready statuses from card */
export function removeAllReadyStatuses(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter(s => !isReadyStatus(s.type))
}

/** Remove phase-specific ready statuses (keeps readyDeploy) */
export function removePhaseSpecificStatuses(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter(s => {
    if (s.type === READY_STATUS.DEPLOY) return false
    if (s.type === READY_STATUS.SETUP) return false
    if (s.type === READY_STATUS.COMMIT) return false
    return true
  })
}

/** Check if card has used a turn-limited ability this turn */
export function hasUsedAbilityThisTurn(card: Card, abilityType: 'setup' | 'commit'): boolean {
  const usedStatus = abilityType === 'setup'
    ? TURN_LIMITED_ABILITIES.SETUP_USED
    : TURN_LIMITED_ABILITIES.COMMIT_USED
  return card.statuses?.some(s => s.type === usedStatus) ?? false
}

/** Mark that a card has used its turn-limited ability this turn */
export function markAbilityUsedThisTurn(card: Card, abilityType: 'setup' | 'commit'): void {
  const usedStatus = abilityType === 'setup'
    ? TURN_LIMITED_ABILITIES.SETUP_USED
    : TURN_LIMITED_ABILITIES.COMMIT_USED

  if (!card.statuses) card.statuses = []
  if (!card.statuses.some(s => s.type === usedStatus)) {
    card.statuses.push({ type: usedStatus, addedByPlayerId: card.ownerId || 0 })

    // When ability is used, also remove the corresponding ready status
    const readyStatus = abilityType === 'setup' ? READY_STATUS.SETUP : READY_STATUS.COMMIT
    removeReadyStatus(card, readyStatus)
  }
}

/** Clear turn-limited ability usage flags from a card */
export function clearTurnLimitedAbilities(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter(s => {
    if (s.type === TURN_LIMITED_ABILITIES.SETUP_USED) return false
    if (s.type === TURN_LIMITED_ABILITIES.COMMIT_USED) return false
    return true
  })
}

/** Clear turn-limited ability usage from all cards on board for a player */
export function clearTurnLimitedAbilitiesForPlayer(gameState: GameState, playerId: number): void {
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card?.ownerId === playerId) {
        clearTurnLimitedAbilities(cell.card)
      }
    }
  }
}

// ============================================================================
// Conditions for Ready Statuses
// ============================================================================

/** Check if card is stunned */
export function isStunned(card: Card): boolean {
  return card.statuses?.some(s => s.type === 'Stun') ?? false
}

/** Check if card has Support from its owner */
export function hasSupport(card: Card, playerId?: number): boolean {
  if (!card.statuses) return false
  return card.statuses.some(s =>
    s.type === 'Support' &&
    (playerId === undefined || s.addedByPlayerId === playerId)
  )
}

/** Check if a card has a specific status (including playerId filter) */
export function hasStatus(card: Card, type: string, playerId?: number): boolean {
  if (!card.statuses) return false
  return card.statuses.some(s =>
    s.type === type &&
    (playerId === undefined || s.addedByPlayerId === playerId)
  )
}

/** Check if card can activate abilities (not stunned, has support if needed) */
export function canCardActivate(
  card: Card,
  supportRequired: boolean,
  activePlayerId: number
): boolean {
  if (!card.ownerId || card.ownerId !== activePlayerId) return false
  if (isStunned(card)) return false
  if (supportRequired && !hasSupport(card, activePlayerId)) return false
  return true
}

// ============================================================================
// Core Ready Status Update Logic
// ============================================================================

/** Context for updating ready statuses */
export interface ReadyUpdateContext {
  gameState: GameState
  playerId?: number           // undefined = use activePlayerId
  cards?: Card[]             // specific cards to update (undefined = all on board)
}

/**
 * Ability type info for a card - provided by caller to avoid dependency on server module
 */
export interface CardAbilityInfo {
  hasDeployAbility: boolean
  hasSetupAbility: boolean
  hasCommitAbility: boolean
  setupRequiresSupport: boolean
  commitRequiresSupport: boolean
}

/**
 * Update ready statuses for cards based on current game state.
 * This is the unified function that replaces resetReadyStatusesForTurn,
 * recalculateAllReadyStatuses, recheckReadyStatuses, etc.
 */
export function updateReadyStatuses(
  context: ReadyUpdateContext,
  getAbilityInfo: (card: Card) => CardAbilityInfo
): void {
  const { gameState, cards: specificCards } = context
  const activePlayerId = context.playerId ?? gameState.activePlayerId

  if (activePlayerId === undefined) {
    return // No active player, nothing to update
  }

  const currentPhase = gameState.currentPhase
  const cards = specificCards ?? getAllCardsOnBoard(gameState)

  for (const card of cards) {
    if (activePlayerId !== null) {
      updateCardReadyStatuses(card, activePlayerId, currentPhase, getAbilityInfo(card))
    }
  }
}

/**
 * Update ready statuses for a single card.
 * This determines what statuses SHOULD exist and syncs the card's statuses.
 */
export function updateCardReadyStatuses(
  card: Card,
  activePlayerId: number,
  currentPhase: number,
  abilityInfo: CardAbilityInfo
): void {
  if (!card.ownerId || !card.statuses) {
    card.statuses = card.statuses || []
    return
  }

  const isActivePlayer = card.ownerId === activePlayerId

  // Determine what statuses this card SHOULD have
  const shouldHave: Set<ReadyStatusType> = new Set()

  if (isActivePlayer && !isStunned(card)) {
    // Check if activation conditions are met (Support, etc.)
    const canSetup = abilityInfo.hasSetupAbility && canCardActivate(
      card,
      abilityInfo.setupRequiresSupport,
      activePlayerId
    )
    const canCommit = abilityInfo.hasCommitAbility && canCardActivate(
      card,
      abilityInfo.commitRequiresSupport,
      activePlayerId
    )

    // Deploy: only if hasn't been used yet
    if (abilityInfo.hasDeployAbility && hasReadyStatus(card, READY_STATUS.DEPLOY)) {
      shouldHave.add(READY_STATUS.DEPLOY)
    }

    // Setup: phase 1, only if no Deploy AND hasn't been used this turn
    if (canSetup && currentPhase === 1 && !shouldHave.has(READY_STATUS.DEPLOY) && !hasUsedAbilityThisTurn(card, 'setup')) {
      shouldHave.add(READY_STATUS.SETUP)
    }

    // Commit: phase 3, only if no Deploy AND hasn't been used this turn
    if (canCommit && currentPhase === 3 && !shouldHave.has(READY_STATUS.DEPLOY) && !hasUsedAbilityThisTurn(card, 'commit')) {
      shouldHave.add(READY_STATUS.COMMIT)
    }
  }

  // Sync statuses to match what should exist
  syncCardStatuses(card, shouldHave)
}

/** Sync card's statuses to match the target set */
function syncCardStatuses(card: Card, shouldHave: Set<ReadyStatusType>): void {
  if (!card.statuses) {
    card.statuses = []
  }

  const ownerId = card.ownerId ?? 0

  // Remove ready statuses that shouldn't exist
  card.statuses = card.statuses.filter(s => {
    if (!isReadyStatus(s.type)) return true // Keep non-ready statuses
    return shouldHave.has(s.type as ReadyStatusType)
  })

  // Add missing ready statuses
  if (shouldHave.has(READY_STATUS.DEPLOY) && !hasReadyStatus(card, READY_STATUS.DEPLOY)) {
    card.statuses.push({ type: READY_STATUS.DEPLOY, addedByPlayerId: ownerId })
  }
  if (shouldHave.has(READY_STATUS.SETUP) && !hasReadyStatus(card, READY_STATUS.SETUP)) {
    card.statuses.push({ type: READY_STATUS.SETUP, addedByPlayerId: ownerId })
  }
  if (shouldHave.has(READY_STATUS.COMMIT) && !hasReadyStatus(card, READY_STATUS.COMMIT)) {
    card.statuses.push({ type: READY_STATUS.COMMIT, addedByPlayerId: ownerId })
  }
}

/** Get all cards on the board */
function getAllCardsOnBoard(gameState: GameState): Card[] {
  const cards: Card[] = []
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card) {
        cards.push(cell.card)
      }
    }
  }
  return cards
}

// ============================================================================
// Special Operations
// ============================================================================

/**
 * Initialize ready statuses when card enters battlefield.
 *
 * Logic:
 * - If card has Deploy ability → add readyDeploy (can be used in any phase)
 * - If NO Deploy ability BUT has Setup ability AND in Setup phase → add readySetup
 * - If NO Deploy ability BUT has Commit ability AND in Commit phase → add readyCommit
 */
export function initializeCardReadyStatuses(
  card: Card,
  ownerId: number,
  abilityInfo: CardAbilityInfo,
  currentPhase: number
): void {
  if (!card.statuses) card.statuses = []

  // Priority 1: Deploy ability (works in any phase)
  if (abilityInfo.hasDeployAbility) {
    addReadyStatus(card, READY_STATUS.DEPLOY, ownerId)
    return
  }

  // Priority 2: Phase-specific abilities (only if NO Deploy)
  if (currentPhase === 1 && abilityInfo.hasSetupAbility) {
    addReadyStatus(card, READY_STATUS.SETUP, ownerId)
  } else if (currentPhase === 3 && abilityInfo.hasCommitAbility) {
    addReadyStatus(card, READY_STATUS.COMMIT, ownerId)
  }
}

/**
 * Mark Deploy ability as used - removes readyDeploy and adds phase-specific status.
 * Call this when Deploy ability is successfully executed.
 */
export function markDeployAbilityUsed(
  card: Card,
  currentPhase: number,
  hasSetupAbility: boolean,
  hasCommitAbility: boolean
): void {
  removeReadyStatus(card, READY_STATUS.DEPLOY)

  const ownerId = card.ownerId ?? 0

  // Add phase-specific status if appropriate
  if (currentPhase === 1 && hasSetupAbility) {
    addReadyStatus(card, READY_STATUS.SETUP, ownerId)
  } else if (currentPhase === 3 && hasCommitAbility) {
    addReadyStatus(card, READY_STATUS.COMMIT, ownerId)
  }
}

/**
 * Skip Deploy ability - removes readyDeploy WITHOUT adding phase-specific status.
 * Call this when player explicitly skips Deploy (right-click cancel).
 */
export function skipDeployAbility(card: Card): void {
  removeReadyStatus(card, READY_STATUS.DEPLOY)
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get the ready status that should be used for a card in the current phase.
 * Priority: Setup (phase 1) > Commit (phase 3) > Deploy (any phase)
 */
export function getReadyStatusForPhase(card: Card, phaseIndex: number): ReadyStatusType | null {
  // Priority 1: Setup in Setup phase
  if (phaseIndex === 1 && hasReadyStatus(card, READY_STATUS.SETUP)) {
    return READY_STATUS.SETUP
  }

  // Priority 2: Commit in Commit phase
  if (phaseIndex === 3 && hasReadyStatus(card, READY_STATUS.COMMIT)) {
    return READY_STATUS.COMMIT
  }

  // Priority 3: Deploy in any phase
  if (hasReadyStatus(card, READY_STATUS.DEPLOY)) {
    return READY_STATUS.DEPLOY
  }

  return null
}

/**
 * Check if a card should show visual ready highlighting for the active player.
 */
export function shouldShowReadyHighlight(card: Card, activePlayerId: number | null): boolean {
  if (!activePlayerId || card.ownerId !== activePlayerId) {
    return false
  }
  return hasAnyReadyStatus(card)
}

/**
 * Get all available ready statuses for a card (for UI display).
 */
export function getAvailableReadyStatuses(card: Card): ReadyStatusType[] {
  const available: ReadyStatusType[] = []
  if (hasReadyStatus(card, READY_STATUS.DEPLOY)) available.push(READY_STATUS.DEPLOY)
  if (hasReadyStatus(card, READY_STATUS.SETUP)) available.push(READY_STATUS.SETUP)
  if (hasReadyStatus(card, READY_STATUS.COMMIT)) available.push(READY_STATUS.COMMIT)
  return available
}
