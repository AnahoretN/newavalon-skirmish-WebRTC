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
  console.log('[autoAbilities] Server getCardAbilities loaded from content service')
} catch (e) {
  // Not in Node.js environment, will use client-side provider
  console.log('[autoAbilities] Not in Node.js, using client provider:', e)
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
  console.log(`[autoAbilities] getCardAbilities called for: ${baseId}`)
  console.log(`[autoAbilities] serverGetCardAbilities: ${!!serverGetCardAbilities}, clientGetCardAbilitiesProvider: ${!!clientGetCardAbilitiesProvider}`)

  if (serverGetCardAbilities) {
    const result = serverGetCardAbilities(baseId)
    console.log(`[autoAbilities] Server returned ${result.length} abilities`)
    return result
  }
  if (clientGetCardAbilitiesProvider) {
    const result = clientGetCardAbilitiesProvider(baseId)
    console.log(`[autoAbilities] Client provider returned ${result.length} abilities`)
    return result
  }
  console.warn(`[autoAbilities] No getCardAbilities provider available for card: ${baseId}`)
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

/* eslint-disable @typescript-eslint/no-unused-vars */
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

  console.log(`[getAbilitiesForCard] Card ${baseId} has ${contentAbilities.length} abilities:`, contentAbilities.map(a => ({ type: a.type, action: a.action, mode: a.mode })))

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

/**
 * Determines if a specific card can be activated in the current state.
 * If gameState is provided, allows any player to control dummy player's cards
 * (when the dummy is the active player).
 *
 * Priority order for ability activation:
 * 1. Setup abilities - ONLY in Setup phase (phase 1)
 * 2. Commit abilities - ONLY in Commit phase (phase 3)
 * 3. Deploy abilities - in ANY phase (if no phase-specific ability is active)
 */
export const canActivateAbility = (
  card: Card,
  phaseIndex: number,
  activePlayerId: number | undefined,
  gameState?: GameState
): boolean => {
  // Ownership check: active player must own the card
  // Exception: dummy player cards can be activated by anyone
  if (gameState && card.ownerId !== undefined) {
    const cardOwner = gameState.players.find(p => p.id === card.ownerId)
    // If card belongs to dummy player, skip the ownership check (anyone can activate)
    if (!cardOwner?.isDummy && activePlayerId !== card.ownerId) {
      return false
    }
  } else if (activePlayerId !== card.ownerId) {
    return false
  }

  if (card.statuses?.some(s => s.type === 'Stun')) {
    return false
  }

  const abilities = getAbilitiesForCard(card)

  // Check if card has a phase-specific ability for current phase
  const hasPhaseSpecificAbility =
    (phaseIndex === 1 && abilities.some(a => a.activationType === 'setup')) ||
    (phaseIndex === 3 && abilities.some(a => a.activationType === 'commit'))

  // === 1. CHECK SETUP ABILITY (ONLY in Setup phase) ===
  if (phaseIndex === 1) {
    const setupAbility = abilities.find(a => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS.SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  // === 2. CHECK COMMIT ABILITY (ONLY in Commit phase) ===
  if (phaseIndex === 3) {
    const commitAbility = abilities.find(a => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS.COMMIT)) {
      if (commitAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  // === 3. CHECK DEPLOY ABILITY (works in ANY phase if no phase-specific ability for this phase) ===
  // Deploy abilities can be used in any phase UNLESS the card has a phase-specific ability
  // for the current phase that should take priority
  if (!hasPhaseSpecificAbility) {
    const deployAbility = abilities.find(a => a.activationType === 'deploy')
    if (deployAbility && hasReadyStatus(card, READY_STATUS.DEPLOY)) {
      if (deployAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  return false
}

/**
 * Gets the appropriate ability action for a card based on:
 * 1. Ready statuses (what abilities are available)
 * 2. Current phase
 * 3. Priority: Setup (phase 1) > Commit (phase 3) > Deploy (any phase)
 */
export const getCardAbilityAction = (
  card: Card,
  gameState: GameState,
  localPlayerId: number | null,
  coords: { row: number, col: number },
): AbilityAction | null => {
  if (localPlayerId !== card.ownerId) {
    // Check if the card belongs to a dummy player - if so, local player can control it
    if (card.ownerId !== undefined) {
      const cardOwner = gameState.players.find(p => p.id === card.ownerId)
      if (!cardOwner?.isDummy) {
        return null
      }
    } else {
      return null
    }
  }

  const abilities = getAbilitiesForCard(card)

  // Use card owner for ability actions (dummy's cards use dummy as actor)
  const actorId = card.ownerId ?? localPlayerId ?? 0

  const phaseIndex = gameState.currentPhase

  // Priority 1: Setup ability (ONLY in Setup phase / phase 1)
  if (phaseIndex === 1) {
    const setupAbility = abilities.find(a => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS.SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = setupAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS.SETUP }
      }
    }
  }

  // Priority 2: Commit ability (ONLY in Commit phase / phase 3)
  if (phaseIndex === 3) {
    const commitAbility = abilities.find(a => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS.COMMIT)) {
      if (commitAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = commitAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS.COMMIT }
      }
    }
  }

  // Priority 3: Deploy ability (works in ANY phase when card has readyDeploy)
  // Deploy takes priority UNLESS the card has the phase-specific status for current phase
  // This allows cards that enter during Setup/Commit to use Deploy first, then get phase-specific status
  const hasPhaseSpecificStatus =
    (phaseIndex === 1 && hasReadyStatus(card, READY_STATUS.SETUP)) ||
    (phaseIndex === 3 && hasReadyStatus(card, READY_STATUS.COMMIT))

  if (!hasPhaseSpecificStatus) {
    const deployAbility = abilities.find(a => a.activationType === 'deploy')
    if (deployAbility && hasReadyStatus(card, READY_STATUS.DEPLOY)) {
      if (deployAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = deployAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, isDeployAbility: true, readyStatusToRemove: READY_STATUS.DEPLOY }
      }
    }
  }

  return null
}
