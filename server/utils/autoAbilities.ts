import type { Card, GameState, AbilityAction } from '../types/types.js'
import {
  checkAdj,
  // Import from unified ready system
  updateReadyStatuses,
  initializeCardReadyStatuses,
  removeAllReadyStatuses as removeAllReadyStatusesShared,
  // getReadyStatusForPhase,  // eslint-disable-line - unused
  hasStatus,
  hasReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  hasReadyStatusForPhase,
  hasReadyAbilityInCurrentPhase,
  READY_STATUS,
  // type ReadyStatusType,  // eslint-disable-line - unused
  type AbilityActivationType,
  type CardAbilityInfo,
  // Import content abilities building logic
  buildActionFromContentAbility,
  type ContentAbility,
} from '../../shared/abilities/index.js'

// Import content access functions - server-only
// This is imported conditionally to avoid bundling Node.js modules in client build
let serverGetCardAbilities: ((baseId: string) => ContentAbility[]) | null = null

// Try to import from server content service (only works in Node.js environment)
try {
  const contentModule = require('../services/content.js')
  serverGetCardAbilities = contentModule.getCardAbilities
} catch (e) {
  // Not in Node.js environment, will use client-side provider
}

// Client-side provider for getCardAbilities (set by client code)
let clientGetCardAbilitiesProvider: ((baseId: string) => ContentAbility[]) | null = null

/**
 * Set the client-side provider for getCardAbilities
 * Called by client code to provide browser-safe implementation
 */
export function setClientGetCardAbilitiesProvider(provider: (baseId: string) => ContentAbility[]): void {
  clientGetCardAbilitiesProvider = provider
}

/**
 * Get card abilities from content database
 * Uses server implementation in Node.js, client implementation in browser
 */
function getCardAbilities(baseId: string): ContentAbility[] {
  if (serverGetCardAbilities) {
    return serverGetCardAbilities(baseId)
  }
  if (clientGetCardAbilitiesProvider) {
    return clientGetCardAbilitiesProvider(baseId)
  }
  return []
}

// Re-export for backwards compatibility
export type { AbilityActivationType }
export {
  checkAdj,
  hasStatus,
  hasReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  hasReadyStatusForPhase,
  hasReadyAbilityInCurrentPhase,
}

// Backward compatibility exports
export const READY_STATUS_DEPLOY = READY_STATUS.DEPLOY
export const READY_STATUS_SETUP = READY_STATUS.SETUP
export const READY_STATUS_COMMIT = READY_STATUS.COMMIT

 
// Parameters with _ prefix are used in nested functions/reducers, disable warning

// ============================================================================
// DYNAMIC ABILITY SYSTEM
// ============================================================================
//
// Card abilities are now loaded from contentDatabase.json as the SINGLE SOURCE OF TRUTH.
// Each ability in contentDatabase.json contains:
// - type: when this ability can be used ('deploy', 'setup', 'commit', 'pass')
// - supportRequired: if true, requires Support status to use
// - action: the action type (CREATE_STACK, ENTER_MODE, etc.)
// - mode: the targeting mode (SELECT_TARGET, PATROL_MOVE, etc.)
// - details: additional parameters for the action
// - steps: array of steps for multi-step abilities
//
// This system reads abilities dynamically and generates getAction functions on demand.
// The actual building functions are imported from shared/abilities/contentAbilities.ts

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CardAbilityDefinition {
  baseId: string
  baseIdAlt?: string[]  // Alternative names for the same card
  activationType: AbilityActivationType
  supportRequired?: boolean
  getAction: (card: Card, gameState: GameState, ownerId: number, coords: { row: number, col: number }) => AbilityAction | null
}

// ============================================================================
// PUBLIC API - Dynamic ability system using contentDatabase.json
// ============================================================================

/**
 * Get all ability definitions for a card.
 * NOW READS FROM CONTENT DATABASE - the single source of truth.
 *
 * @param card - The card to get abilities for
 * @returns Array of CardAbilityDefinition objects with dynamic getAction functions
 */
export const getAbilitiesForCard = (card: Card): CardAbilityDefinition[] => {
  const baseId = card.baseId || ''
  const contentAbilities = getCardAbilities(baseId)

  // Convert ContentAbility to CardAbilityDefinition with dynamic getAction
  return contentAbilities.map((contentAbility): CardAbilityDefinition => ({
    baseId,
    activationType: contentAbility.type,
    supportRequired: contentAbility.supportRequired,
    getAction: (_card: Card, gameState: GameState, ownerId: number, coords: { row: number; col: number }) =>
      buildActionFromContentAbility(contentAbility, card, gameState, ownerId, coords)
  }))
}

/**
 * Get ability types for a card (used for ready status initialization).
 * NOW READS FROM CONTENT DATABASE.
 *
 * @param card - The card to get ability types for
 * @returns Array of ability type strings ('deploy', 'setup', 'commit')
 */
export const getCardAbilityTypes = (card: Card): AbilityActivationType[] => {
  const baseId = card.baseId || ''
  const abilities = getCardAbilities(baseId)

  const types: AbilityActivationType[] = []
  for (const ability of abilities) {
    if (ability.type === 'deploy' || ability.type === 'setup' || ability.type === 'commit') {
      types.push(ability.type)
    }
  }

  // Remove duplicates
  return [...new Set(types)]
}

/**
 * Get ability info for a card - provides data needed by shared ready system.
 * NOW READS FROM CONTENT DATABASE.
 *
 * @param card - The card to get ability info for
 * @returns CardAbilityInfo object
 */
function getCardAbilityInfo(card: Card): CardAbilityInfo {
  const baseId = card.baseId || ''
  const abilities = getCardAbilities(baseId)

  const hasDeployAbility = abilities.some(a => a.type === 'deploy')
  const hasSetupAbility = abilities.some(a => a.type === 'setup')
  const hasCommitAbility = abilities.some(a => a.type === 'commit')

  const deployAbility = abilities.find(a => a.type === 'deploy')
  const setupAbility = abilities.find(a => a.type === 'setup')
  const commitAbility = abilities.find(a => a.type === 'commit')

  return {
    hasDeployAbility,
    hasSetupAbility,
    hasCommitAbility,
    deployRequiresSupport: deployAbility?.supportRequired ?? false,
    setupRequiresSupport: setupAbility?.supportRequired ?? false,
    commitRequiresSupport: commitAbility?.supportRequired ?? false,
  }
}

/**
 * Resets ready statuses for all cards owned by a player at start of their turn.
 * Now delegates to the unified ready system.
 */
export const resetReadyStatusesForTurn = (gameState: GameState, playerId: number): void => {
  updateReadyStatuses({ gameState: gameState as any, playerId }, getCardAbilityInfo)
}

/**
 * Initializes ready statuses when a card enters the battlefield.
 * Now delegates to the unified ready system.
 */
export const initializeReadyStatuses = (card: Card, ownerId: number, currentPhase: number): void => {
  const info = getCardAbilityInfo(card)
  initializeCardReadyStatuses(card, ownerId, info, currentPhase)
}

/**
 * Removes all ready statuses from a card (when leaving battlefield).
 * Now delegates to the unified ready system.
 */
export const removeAllReadyStatuses = (card: Card): void => {
  removeAllReadyStatusesShared(card)
}
