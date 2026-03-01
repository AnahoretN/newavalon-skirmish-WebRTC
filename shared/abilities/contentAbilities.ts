/**
 * Shared Ability Building Logic
 *
 * This module contains the logic for converting ContentAbility (from contentDatabase.json)
 * into CardAbilityDefinition format. It doesn't import from server or client,
 * making it safe to use in both environments.
 */

import { checkAdj } from './abilityUtils.js'
import { hasStatus } from './index.js'

// Use 'any' for Card type to avoid conflicts between client/server Card types
type Card = any
type GameState = any
type AbilityAction = any

/**
 * Raw ability structure from contentDatabase.json
 */
export interface ContentAbility {
  type: 'deploy' | 'setup' | 'commit' | 'pass'
  supportRequired?: boolean
  action?: string
  mode?: string | null
  actionType?: string
  details?: Record<string, any>
  steps?: Array<{
    action: string
    mode?: string | null
    details: Record<string, any>
  }>
}

/**
 * Build a filter function from a filter string in contentDatabase.json
 */
/* eslint-disable no-unused-vars */
export function buildFilterFromString(
  filter: string,
  ownerId: number,
  _coords: { row: number; col: number }
): ((_target: Card, _r?: number, _c?: number) => boolean) | undefined {
  /* eslint-enable no-unused-vars */
  // hasStatus_StatusName
  if (filter.startsWith('hasStatus_')) {
    const statusType = filter.replace('hasStatus_', '')
    return (_target: Card) => hasStatus(_target, statusType, ownerId)
  }

  // hasStatus_StatusName1_or_StatusName2
  if (filter.startsWith('hasStatus_') && filter.includes('_or_')) {
    const statuses = filter.replace('hasStatus_', '').split('_or_')
    return (_target: Card) => statuses.some(s => hasStatus(_target, s, ownerId))
  }

  // isAdjacent
  if (filter === 'isAdjacent') {
    return (_target: Card, r?: number, c?: number) =>
      r !== undefined && c !== undefined && checkAdj(r, c, _coords.row, _coords.col)
  }

  // isOpponent
  if (filter === 'isOpponent') {
    return (_target: Card) => _target.ownerId !== ownerId
  }

  // isOwner
  if (filter === 'isOwner') {
    return (_target: Card) => _target.ownerId === ownerId
  }

  return undefined
}

/**
 * Build details object from ContentAbility details
 */
export function buildDetailsFromContent(
  ability: ContentAbility,
  ownerId: number,
  coords: { row: number; col: number }
): Record<string, any> {
  const details: Record<string, any> = { ...ability.details }

  // Convert filter string to function if present
  if (details.filter && typeof details.filter === 'string') {
    const filterFn = buildFilterFromString(details.filter, ownerId, coords)
    if (filterFn) {
      details.filter = filterFn
    }
  }

  // Convert additionalFilter string to function if present
  if (details.additionalFilter && typeof details.additionalFilter === 'string') {
    const filterFn = buildFilterFromString(details.additionalFilter, ownerId, coords)
    if (filterFn) {
      details.additionalFilter = filterFn
    }
  }

  return details
}

/**
 * Build an AbilityAction from a ContentAbility
 */
export function buildActionFromContentAbility(
  ability: ContentAbility,
  card: Card,
  _gameState: GameState,
  ownerId: number,
  coords: { row: number; col: number }
): AbilityAction | null {
  // Handle multi-step abilities - map to appropriate custom mode
  if (ability.steps && ability.steps.length > 0) {
    const step1 = ability.steps[0]
    const step2 = ability.steps[1]

    // Detect pattern: CREATE_STACK_SELF (Shield) + CREATE_STACK (Aim, LINE_TARGET)
    // This is the GAWAIN_DEPLOY pattern (used by abrGawain)
    if (
      step1.action === 'CREATE_STACK_SELF' &&
      step1.details?.tokenType === 'Shield' &&
      step2.action === 'CREATE_STACK' &&
      step2.details?.tokenType === 'Aim' &&
      step2.mode === 'LINE_TARGET'
    ) {
      return {
        type: 'ENTER_MODE',
        mode: 'GAWAIN_DEPLOY_SHIELD_AIM',
        sourceCard: card,
        sourceCoords: coords,
        payload: {}
      } as AbilityAction
    }

    // Detect pattern: CREATE_STACK_SELF (Shield) + PUSH (ADJACENT_TARGET, isOpponent)
    // This is the RECLAIMED_GAWAIN pattern
    if (
      step1.action === 'CREATE_STACK_SELF' &&
      step1.details?.tokenType === 'Shield' &&
      step2.action === 'PUSH' &&
      step2.mode === 'ADJACENT_TARGET'
    ) {
      return {
        type: 'ENTER_MODE',
        mode: 'SHIELD_SELF_THEN_RIOT_PUSH',
        sourceCard: card,
        sourceCoords: coords,
        payload: {}
      } as AbilityAction
    }

    // Detect pattern: CREATE_STACK_SELF (Shield) + CREATE_TOKEN (reconDrone, ADJACENT_EMPTY)
    // This is the EDITH_BYRON pattern
    if (
      step1.action === 'CREATE_STACK_SELF' &&
      step1.details?.tokenType === 'Shield' &&
      step2.action === 'CREATE_TOKEN' &&
      step2.details?.tokenId === 'reconDrone' &&
      step2.mode === 'ADJACENT_EMPTY'
    ) {
      return {
        type: 'ENTER_MODE',
        mode: 'SHIELD_SELF_THEN_SPAWN',
        sourceCard: card,
        sourceCoords: coords,
        payload: { tokenName: 'Recon Drone' }
      } as AbilityAction
    }

    // Detect pattern: ENTER_MODE (SELECT_TARGET, isAdjacent, opponent) + CREATE_STACK (SELECT_HAND_TARGET)
    // This is the RECON_DRONE_COMMIT pattern
    // Check filter as either original string ('isAdjacent') or check the details structure
    const isReconDroneCommitPattern =
      step1.action === 'ENTER_MODE' &&
      step1.mode === 'SELECT_TARGET' &&
      step1.details?.selectFrom === 'opponent' &&
      (step1.details?.filter === 'isAdjacent' || step1.details?.hasOwnProperty('filter')) &&
      step2.action === 'CREATE_STACK' &&
      step2.mode === 'SELECT_HAND_TARGET' &&
      step2.details?.tokenType === 'Revealed'

    if (isReconDroneCommitPattern) {
      // Build the filter function for selecting adjacent opponents
      const filterFn = buildFilterFromString('isAdjacent', ownerId, coords)

      return {
        type: 'ENTER_MODE',
        mode: 'RECON_DRONE_COMMIT',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          filter: filterFn,
          tokenType: 'Revealed',
          count: step2.details?.count || 1,
          chainedAction: {
            type: 'CREATE_STACK',
            mode: 'SELECT_HAND_TARGET',
            sourceCard: card,
            sourceCoords: coords,
            payload: {
              tokenType: 'Revealed',
              count: step2.details?.count || 1,
              targetOwnerIdFromSource: true
            }
          }
        }
      } as AbilityAction
    }

    // Generic multi-step fallback - not yet implemented for custom modes
    console.warn(`Multi-step ability not yet implemented for card ${card.baseId}`)
    return null
  }

  // Handle single action abilities
  const actionType = ability.action
  const details = buildDetailsFromContent(ability, ownerId, coords)

  // Build action based on type
  switch (actionType) {
    case 'CREATE_STACK':
      return {
        type: 'CREATE_STACK',
        tokenType: details.tokenType,
        count: details.count,
        requiredTargetStatus: details.requiredTargetStatus,
        requireStatusFromSourceOwner: details.requireStatusFromSourceOwner,
        onlyOpponents: details.onlyOpponents,
        mustBeAdjacentToSource: details.mustBeAdjacentToSource,
        mustBeInLineWithSource: details.mustBeInLineWithSource,
        maxDistanceFromSource: details.maxDistanceFromSource,
        maxOrthogonalDistance: details.maxOrthogonalDistance,
        sourceCoords: coords,
        sourceCard: card,
        placeAllAtOnce: details.placeAllAtOnce,
        onlyFaceDown: details.onlyFaceDown,
        excludeOwnerId: details.excludeOwnerId,
      } as AbilityAction

    case 'CREATE_STACK_SELF':
      // CREATE_STACK_SELF is a special case - places tokens on self
      return {
        type: 'CREATE_STACK',
        tokenType: details.tokenType,
        count: details.count,
        onlySelf: true,
        sourceCoords: coords,
        sourceCard: card,
      } as AbilityAction

    case 'CREATE_TOKEN':
      // CREATE_TOKEN places a token unit on the board
      // Preserve the mode information (e.g., ADJACENT_EMPTY) in payload
      return {
        type: 'OPEN_MODAL',
        mode: 'PLACE_TOKEN',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          tokenId: details.tokenId,
          range: ability.mode === 'ADJACENT_EMPTY' ? 'adjacent' : 'global'
        }
      } as AbilityAction

    case 'ENTER_MODE': {
      // Build the payload based on actionType and mode
      const payload: Record<string, any> = { ...details }

      // Handle different action types
      if (ability.actionType === 'DESTROY' && !payload.filter) {
        // If no filter provided, use default
        payload.actionType = 'DESTROY'
      } else if (ability.actionType) {
        payload.actionType = ability.actionType
      }

      // Special case: TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
      // Automatically create filter if not provided
      if (ability.mode === 'TRANSFER_ALL_STATUSES' && !payload.filter) {
        const cardOwnerId = ownerId
        const sourceCardId = card.id
        const validTokens = ['Aim', 'Exploit', 'Rule', 'Shield', 'Stun', 'Revealed']
        payload.filter = (target: Card) => {
          // Cannot target itself
          if (target.id === sourceCardId) return false
          // Must be owned by the same player
          if (target.ownerId !== cardOwnerId) return false
          // Must have at least one of the specified tokens/statuses
          if (!target.statuses || target.statuses.length === 0) return false
          return target.statuses.some(s => validTokens.includes(s.type))
        }
      }

      // Handle chained actions
      if (details.chainedAction) {
        payload.chainedAction = details.chainedAction
      }

      // Special skip flag
      if (details.skipChainedActionOnNoTargets !== undefined) {
        payload.skipChainedActionOnNoTargets = details.skipChainedActionOnNoTargets
      }

      return {
        type: 'ENTER_MODE',
        mode: ability.mode,
        sourceCard: card,
        sourceCoords: coords,
        payload
      } as AbilityAction
    }

    case 'PUSH':
      // Push is handled by RIOT_PUSH mode
      return {
        type: 'ENTER_MODE',
        mode: 'RIOT_PUSH',
        sourceCard: card,
        sourceCoords: coords,
        payload: details
      } as AbilityAction

    case 'OPEN_MODAL':
      return {
        type: 'OPEN_MODAL',
        mode: ability.mode,
        sourceCard: card,
        sourceCoords: coords,
        payload: details
      } as AbilityAction

    case 'RETURN_FROM_DISCARD': {
      // Opens discard viewing modal with filter, then returns selected card to target
      const mode = ability.mode === 'ADJACENT_EMPTY' ? 'RETURN_FROM_DISCARD_TO_BOARD' : 'RETURN_FROM_DISCARD_TO_HAND'
      return {
        type: 'OPEN_MODAL',
        mode,
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          filter: details.filter || null,
          withToken: details.withToken || null,
        }
      } as AbilityAction
    }

    case 'LOOK_AT_TOP_DECK':
      // Secret Informant - Look at top cards, put any on bottom, then draw
      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_DECK',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          actionType: 'LOOK_AT_TOP_DECK'
        }
      } as AbilityAction

    case 'MOVE_CARD': {
      // Convert MOVE_CARD to SELECT_UNIT_FOR_MOVE mode (Finn Setup)
      // Uses range from details to determine movement distance
      const range = details.distance || 2
      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          filter: buildFilterFromString(details.filter || 'isOwner', ownerId, coords),
          filterString: details.filter || 'isOwner',  // Store string for serialization
          range,
          moveFromHand: false,
          selectedCard: null,
          allowSelf: false
        }
      } as AbilityAction
    }

    case 'SCORE_POINTS': {
      // Convert SCORE_POINTS to GLOBAL_AUTO_APPLY with customAction
      // Used by Finn Commit (points per revealed card) and other abilities
      const { amount = 1, per } = details

      if (per === 'revealedToOwner') {
        // Finn Commit: Gain 1 point for each card revealed to you
        return {
          type: 'GLOBAL_AUTO_APPLY',
          payload: {
            customAction: 'FINN_SCORING'
          },
          sourceCard: card,
          sourceCoords: coords
        } as AbilityAction
      }

      // For other SCORE_POINTS variations, can add more cases here
      console.warn(`[buildActionFromContentAbility] SCORE_POINTS with per=${per} not yet implemented`)
      return null
    }

    case 'MODIFY_SCORING':
    case 'BUFF_ALLY_POWER':
    case 'MODIFY_THREAT_TARGETING':
    case 'TRIGGER_ON_EVENT':
      // These are passive abilities - they don't create an action
      return null

    default:
      console.warn(`Unknown action type: ${actionType}`)
      return null
  }
}
