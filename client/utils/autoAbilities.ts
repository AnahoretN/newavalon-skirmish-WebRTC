/**
 * Client-side Ability Utilities
 *
 * This file now serves as a thin wrapper around the shared ready system.
 * Core ready status logic has been moved to shared/abilities/readySystem.ts
 * to eliminate duplication between client and server.
 *
 * Client-specific helper functions for UI are still here.
 */

import type { Card, GameState } from '@/types'
import { logger } from './logger'
import type { CardAbilityInfo } from '@shared/abilities/index.js'

// Import unified ready system from shared - import for local use AND re-export
import {
  // Constants
  READY_STATUS,
  type ReadyStatusType,
  PHASE_SPECIFIC_STATUSES,
  TURN_LIMITED_ABILITIES,

  // Type guards
  isReadyStatus,

  // Ready status helpers
  hasReadyStatus,
  hasAnyReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  removeAllReadyStatuses,
  removePhaseSpecificStatuses,

  // Condition checks
  isStunned,
  hasSupport,

  // Core update functions - import for local use
  updateReadyStatuses,
  updateCardReadyStatuses,
  initializeCardReadyStatuses,
  markDeployAbilityUsed,
  skipDeployAbility,

  // Query functions
  getReadyStatusForPhase,
  shouldShowReadyHighlight,
  getAvailableReadyStatuses,

  // Turn-limited ability tracking
  hasUsedAbilityThisTurn,
  markAbilityUsedThisTurn,
  clearTurnLimitedAbilities,
  clearTurnLimitedAbilitiesForPlayer,
} from '@shared/abilities/index.js'

// Re-export everything for external use
export {
  // Constants
  READY_STATUS,
  ReadyStatusType,
  PHASE_SPECIFIC_STATUSES,
  TURN_LIMITED_ABILITIES,

  // Type guards
  isReadyStatus,

  // Ready status helpers
  hasReadyStatus,
  hasAnyReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  removeAllReadyStatuses,
  removePhaseSpecificStatuses,

  // Condition checks
  isStunned,
  hasSupport,

  // Core update functions
  updateReadyStatuses,
  updateCardReadyStatuses,
  initializeCardReadyStatuses,
  markDeployAbilityUsed,
  skipDeployAbility,

  // Query functions
  getReadyStatusForPhase,
  shouldShowReadyHighlight,
  getAvailableReadyStatuses,

  // Turn-limited ability tracking
  hasUsedAbilityThisTurn,
  markAbilityUsedThisTurn,
  clearTurnLimitedAbilities,
  clearTurnLimitedAbilitiesForPlayer,

  // Types
  CardAbilityInfo,
}

// Re-export constants for backward compatibility
export const READY_STATUS_DEPLOY = 'readyDeploy'
export const READY_STATUS_SETUP = 'readySetup'
export const READY_STATUS_COMMIT = 'readyCommit'

// Import getCardAbilityTypes from server (works via @server alias in Vite)
import { getCardAbilityTypes as serverGetCardAbilityTypes, getAbilitiesForCard } from '@server/utils/autoAbilities'

// Re-export for convenience
export { serverGetCardAbilityTypes, getAbilitiesForCard }

/**
 * Get ability info for a card - provides data needed by shared ready system
 */
export function getCardAbilityInfo(card: Card): CardAbilityInfo {
  const abilityTypes = serverGetCardAbilityTypes(card as any)
  const hasDeployAbility = abilityTypes.includes('deploy')
  const hasSetupAbility = abilityTypes.includes('setup')
  const hasCommitAbility = abilityTypes.includes('commit')

  // Check if abilities require Support
  const abilities = getAbilitiesForCard(card as any)
  const setupAbility = abilities.find(a => a.activationType === 'setup')
  const commitAbility = abilities.find(a => a.activationType === 'commit')

  return {
    hasDeployAbility,
    hasSetupAbility,
    hasCommitAbility,
    setupRequiresSupport: setupAbility?.supportRequired ?? false,
    commitRequiresSupport: commitAbility?.supportRequired ?? false,
  }
}

/**
 * Check if card has specific ability type
 */
export function cardHasAbility(
  card: Card,
  abilityType: 'deploy' | 'setup' | 'commit'
): boolean {
  const abilityTypes = serverGetCardAbilityTypes(card as any)
  return abilityTypes.includes(abilityType)
}

// ============================================================================
// Client-Specific Helper Functions (for UI)
// ============================================================================

/**
 * Checks if a card has a ready status for visual display in the current phase.
 *
 * This is a simplified version - the visual effect is directly tied to the
 * presence of the ready status. All rules (owner, Stun, phase, Support) are
 * applied when adding/removing the status, not when checking for display.
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

  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Checks if a card should show visual ready highlighting AND can be activated.
 *
 * Only returns true for the active player's cards - this prevents showing glow
 * on other players' cards during their turn.
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

  // Only show ready effect for active player's cards
  if (activePlayerId !== undefined && card.ownerId !== activePlayerId) {
    return false
  }

  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Recalculates ready statuses for ALL players' cards from local perspective.
 * This is called on the guest/client side when receiving state from the host.
 *
 * The key insight is that readySetup/readyCommit are LOCAL (calculated per-client),
 * while readyDeploy is SYNCHRONIZED (received from host).
 */
export function recalculateAllReadyStatuses(gameState: GameState): void {
  const activePlayerId = gameState.activePlayerId
  if (activePlayerId === undefined) {
    return
  }

  logger.info(`[recalculateAllReadyStatuses] Phase ${gameState.currentPhase}, activePlayerId=${activePlayerId}`)

  // Only recalculate if we're in a phase where phase-specific statuses matter
  // Phase-specific statuses only exist in phases 1 (Setup) and 3 (Commit)
  const currentPhase = gameState.currentPhase
  if (currentPhase !== 1 && currentPhase !== 3) {
    // In other phases, phase-specific statuses should be removed
    // But readyDeploy should be kept (it's synchronized from host)
    return
  }

  updateReadyStatuses({ gameState }, getCardAbilityInfo)
}

/**
 * Resets phase-specific ready statuses for ALL cards owned by a player.
 * This should be called at the start of each turn (Preparation phase).
 */
export function resetReadyStatusesForTurn(gameState: GameState, playerId: number): void {
  updateReadyStatuses({ gameState, playerId }, getCardAbilityInfo)
}

/**
 * Rechecks and updates ready statuses for a single card.
 * Called when conditions change: Stun added/removed, Support added/removed, etc.
 */
export function recheckReadyStatuses(card: Card, gameState: GameState): void {
  const activePlayerId = gameState.activePlayerId
  if (activePlayerId === undefined || activePlayerId === null) {
    return
  }

  const abilityInfo = getCardAbilityInfo(card)
  updateCardReadyStatuses(card, activePlayerId, gameState.currentPhase, abilityInfo)
}

/**
 * Rechecks ready statuses for all cards of a player.
 */
export function recheckAllReadyStatuses(gameState: GameState, playerId: number): void {
  updateReadyStatuses({ gameState, playerId }, getCardAbilityInfo)
}

/**
 * Initialize ready statuses when card enters battlefield.
 */
export function initializeReadyStatuses(card: Card, ownerId: number, currentPhase: number): void {
  const abilityInfo = getCardAbilityInfo(card)
  initializeCardReadyStatuses(card, ownerId, abilityInfo, currentPhase)
}

// ============================================================================
// Legacy Compatibility (deprecated functions, kept for migration)
// ============================================================================

/**
 * @deprecated Use initializeReadyStatuses instead
 */
export const initializeReadyStatuses_Deprecated = (card: Card, ownerId: number, currentPhase: number): void => {
  initializeReadyStatuses(card, ownerId, currentPhase)
}

/**
 * @deprecated Use updateReadyStatuses instead
 */
export const resetPhaseReadyStatuses = (card: Card, ownerId: number): void => {
  // This was used for single-card reset, now handled by updateReadyStatuses
  logger.warn('[resetPhaseReadyStatuses] Deprecated, use updateReadyStatuses instead')
}
