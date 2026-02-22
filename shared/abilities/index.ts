/**
 * Shared Abilities System
 *
 * Centralized ability definitions and utilities
 */

// ============================================================================
// New Unified Ready System
// ============================================================================

export {
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
  hasSupport,  // General status check with playerId filter
  hasStatus,  // General status check with playerId filter
  canCardActivate,  // Note: renamed to avoid conflict with server's canActivateAbility

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
  type CardAbilityInfo,
} from './readySystem.js'

// ============================================================================
// Legacy Ready Status (kept for migration period)
// ============================================================================

export {
  hasReadyStatusForPhase as hasReadyStatusForPhase_Legacy,
  hasReadyAbilityInCurrentPhase as hasReadyAbilityInCurrentPhase_Legacy,
  resetReadyStatusesForTurn as resetReadyStatusesForTurn_Legacy,
  getNextAbilityType,
  canActivateAbility as canActivateAbility_Legacy,  // Old version with different signature
  type Card,
} from './readyStatus.js'

// Re-export the old functions for backward compatibility
export { canActivateAbility } from './readyStatus.js'
export { hasReadyStatusForPhase } from './readyStatus.js'
export { hasReadyAbilityInCurrentPhase } from './readyStatus.js'

// Re-export constants for backward compatibility
export const READY_STATUS_DEPLOY = 'readyDeploy'
export const READY_STATUS_SETUP = 'readySetup'
export const READY_STATUS_COMMIT = 'readyCommit'

// ============================================================================
// Ability Utils
// ============================================================================

export {
  checkAdj,
  type AbilityActivationType,
  type CardAbilityDefinition,
  type HandTargetFilter,
  createHandTargetFilter,
} from './abilityUtils.js'
