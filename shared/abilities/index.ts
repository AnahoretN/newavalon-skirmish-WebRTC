/**
 * Shared Abilities System
 *
 * Centralized ability definitions and utilities
 */

// Export ready status functions and constants
export {
  hasStatus,
  hasReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  canActivateAbility,
  hasReadyStatusForPhase,
  hasReadyAbilityInCurrentPhase,
  removeAllReadyStatuses,
  resetReadyStatusesForTurn,
  READY_STATUS_DEPLOY,
  READY_STATUS_SETUP,
  READY_STATUS_COMMIT,
  type Card,
} from './readyStatus.js'

// Export ability utils
export {
  checkAdj,
  type AbilityActivationType,
  type CardAbilityDefinition,
  type HandTargetFilter,
  createHandTargetFilter,
} from './abilityUtils.js'
