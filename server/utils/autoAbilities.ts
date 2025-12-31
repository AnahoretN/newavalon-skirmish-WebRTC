import type { Card, GameState, AbilityAction } from '../types/types.js'

/* eslint-disable @typescript-eslint/no-unused-vars */
// Parameters with _ prefix are used in nested functions/reducers, disable warning
//
// READY STATUS SYSTEM
// ============================================================================
//
// Each card has hidden statuses that control ability availability:
// - readyDeploy: Card can use Deploy ability (once per game, after entering battlefield)
// - readySetup: Card can use Setup ability (reset each turn)
// - readyCommit: Card can use Commit ability (reset each turn)
//
// Status behavior:
// 1. When card enters battlefield -> gains ready statuses ONLY for abilities it has
// 2. At start of owner's turn -> card regains readySetup, readyCommit (if it has those abilities)
// 3. When ability is used, cancelled, or shows "no target" -> card loses that ready status
//
// This system allows abilities to be tried once per phase, and if they fail (no targets),
// the card can move on to the next ability in sequence.

const READY_STATUS_DEPLOY = 'readyDeploy'
const READY_STATUS_SETUP = 'readySetup'
const READY_STATUS_COMMIT = 'readyCommit'

// Ability activation type - when can this ability be used?
export type AbilityActivationType = 'deploy' | 'setup' | 'commit'

// Helper functions
const checkAdj = (r1: number, c1: number, r2: number, c2: number): boolean => {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1
}

const hasStatus = (card: Card, type: string, playerId?: number): boolean => {
  if (!card.statuses) {
    return false
  }
  return card.statuses.some(s => s.type === type && (playerId === undefined || s.addedByPlayerId === playerId))
}

const hasReadyStatus = (card: Card, statusType: string): boolean => {
  if (!card.statuses) {
    return false
  }
  return card.statuses.some(s => s.type === statusType)
}

export const addReadyStatus = (card: Card, statusType: string, ownerId: number): void => {
  if (!card.statuses) {
    card.statuses = []
  }
  if (!card.statuses.some(s => s.type === statusType)) {
    card.statuses.push({ type: statusType, addedByPlayerId: ownerId })
  }
}

export const removeReadyStatus = (card: Card, statusType: string): void => {
  if (!card.statuses) {
    return
  }
  card.statuses = card.statuses.filter(s => s.type !== statusType)
}

// ============================================================================
// CARD ABILITY DEFINITIONS
// ============================================================================
//
// Each ability has:
// - baseId: the card's base ID
// - activationType: when this ability can be used ('deploy', 'setup', 'commit')
// - getAction: function that returns the AbilityAction for this ability
// - supportRequired: if true, requires Support status to use
//
// This is the SINGLE SOURCE OF TRUTH for all card abilities.

interface CardAbilityDefinition {
  baseId: string
  baseIdAlt?: string[]  // Alternative names for the same card
  activationType: AbilityActivationType
  supportRequired?: boolean
  getAction: (card: Card, gameState: GameState, ownerId: number, coords: { row: number, col: number }) => AbilityAction | null
}

const CARD_ABILITIES: CardAbilityDefinition[] = [
  // ============================================================================
  // SYNCHROTECH
  // ============================================================================

  {
    baseId: 'ipDeptAgent',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Stun',
      count: 2,
      requiredTargetStatus: 'Exploit',
      requireStatusFromSourceOwner: true,
      placeAllAtOnce: true,
    })
  },
  {
    baseId: 'ipDeptAgent',
    activationType: 'commit',
    supportRequired: true,
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card) => hasStatus(target, 'Revealed', _ownerId),
        allowHandTargets: true, // Allow targeting cards in hand
      },
    })
  },

  {
    baseId: 'tacticalAgent',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      requiredTargetStatus: 'Threat',
      requireStatusFromSourceOwner: true,
    })
  },
  {
    baseId: 'tacticalAgent',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { actionType: 'DESTROY', filter: (target: Card) => hasStatus(target, 'Aim', ownerId) },
    })
  },

  {
    baseId: 'patrolAgent',
    activationType: 'setup',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'PATROL_MOVE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'patrolAgent',
    activationType: 'commit',
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Stun',
      count: 1,
      requiredTargetStatus: 'Threat',
      onlyOpponents: true,
      mustBeAdjacentToSource: true,
      sourceCoords: coords,
      sourceCard: card,
    })
  },

  {
    baseId: 'riotAgent',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'RIOT_PUSH',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'riotAgent',
    activationType: 'commit',
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Stun',
      count: 1,
      requiredTargetStatus: 'Threat',
      onlyOpponents: true,
      mustBeAdjacentToSource: true,
      sourceCoords: coords,
      sourceCard: card,
    })
  },

  {
    baseId: 'threatAnalyst',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },
  {
    baseId: 'threatAnalyst',
    activationType: 'commit',
    supportRequired: true,
    getAction: (_card, gameState, ownerId, _coords) => {
      let totalExploits = 0
      gameState.board.forEach(row => {
        row.forEach(cell => {
          if (cell.card?.statuses) {
            totalExploits += cell.card.statuses.filter(s => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
          }
        })
      })
      if (totalExploits === 0) return null
      return { type: 'CREATE_STACK', tokenType: 'Revealed', count: totalExploits, onlyFaceDown: true }
    }
  },

  {
    baseId: 'mrPearlDoF',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'OPEN_MODAL',
      mode: 'SEARCH_DECK',
      sourceCard: _card,
      payload: { filterType: 'Unit', actionType: 'RETRIEVE_FROM_DECK' },
    })
  },

  {
    baseId: 'vigilantSpotter',
    activationType: 'commit',
    getAction: (_card, _gameState, ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Revealed',
      count: 1,
      onlyFaceDown: true,
      excludeOwnerId: ownerId
    })
  },

  {
    baseId: 'codeKeeper',
    activationType: 'deploy',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'GLOBAL_AUTO_APPLY',
      payload: {
        tokenType: 'Exploit',
        filter: (target: Card) => target.ownerId !== ownerId && hasStatus(target, 'Threat', ownerId),
      },
      sourceCard: _card,
      sourceCoords: coords,
    })
  },
  {
    baseId: 'codeKeeper',
    activationType: 'commit',
    supportRequired: true,
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_UNIT_FOR_MOVE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        filter: (target: Card) => target.ownerId !== ownerId && hasStatus(target, 'Exploit', ownerId),
      },
    })
  },

  {
    baseId: 'centurion',
    activationType: 'commit',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'SACRIFICE_AND_BUFF_LINES',
        filter: (target: Card, r?: number, c?: number) => target.ownerId === ownerId && target.types?.includes('Unit') && r !== undefined && c !== undefined,
      },
    })
  },

  // ============================================================================
  // HOODS
  // ============================================================================

  {
    baseId: 'recklessProvocateur',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SWAP_POSITIONS',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { filter: (_target: Card, r: number, c: number) => checkAdj(r, c, coords.row, coords.col) },
    })
  },
  {
    baseId: 'recklessProvocateur',
    activationType: 'commit',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'TRANSFER_ALL_STATUSES',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        filter: (target: Card) => {
          if (target.id === _card.id) return false
          return target.ownerId === _ownerId
        },
      },
    })
  },

  {
    baseId: 'dataLiberator',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },

  {
    baseId: 'cautiousAvenger',
    activationType: 'deploy',
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      sourceCoords: coords,
      mustBeInLineWithSource: true,
      sourceCard: card,
    })
  },
  {
    baseId: 'cautiousAvenger',
    activationType: 'setup',
    supportRequired: true,
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { actionType: 'DESTROY', filter: (target: Card) => hasStatus(target, 'Aim', ownerId) },
    })
  },

  {
    baseId: 'inventiveMaker',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SPAWN_TOKEN',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { tokenName: 'Recon Drone' }
    })
  },
  {
    baseId: 'inventiveMaker',
    activationType: 'setup',
    supportRequired: true,
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'OPEN_MODAL',
      mode: 'RETRIEVE_DEVICE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },

  // ============================================================================
  // OPTIMATES
  // ============================================================================

  {
    baseId: 'faber',
    activationType: 'deploy',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN',
        tokenName: 'Walking Turret',
        filter: (c: Card) => c.ownerId === ownerId,
      },
    })
  },

  {
    baseId: 'censor',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },
  {
    baseId: 'censor',
    activationType: 'commit',
    supportRequired: true,
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Stun',
      count: 1,
      requiredTargetStatus: 'Exploit',
      requireStatusFromSourceOwner: true,
      sourceCoords: coords,
      sourceCard: card,
    })
  },

  {
    baseId: 'princeps',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'PRINCEPS_SHIELD_THEN_AIM',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'princeps',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card) => hasStatus(target, 'Aim', ownerId),
      },
    })
  },

  {
    baseId: 'immunis',
    activationType: 'deploy',
    supportRequired: true,
    getAction: (card, _gameState, _ownerId, coords) => {
      if (!hasStatus(card, 'Support', _ownerId)) {
        return null
      }
      return {
        type: 'OPEN_MODAL',
        mode: 'IMMUNIS_RETRIEVE',
        sourceCard: card,
        sourceCoords: coords,
        payload: { filter: (r: number, c: number) => checkAdj(r, c, coords.row, coords.col) },
      }
    }
  },

  {
    baseId: 'devoutSynthetic',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'RIOT_PUSH',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'devoutSynthetic',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card, r: number, c: number) =>
          checkAdj(r, c, coords.row, coords.col) &&
                      target.ownerId !== ownerId &&
                      (hasStatus(target, 'Threat', ownerId) || hasStatus(target, 'Stun', ownerId)),
      },
    })
  },

  {
    baseId: 'unwaveringIntegrator',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },
  {
    baseId: 'unwaveringIntegrator',
    activationType: 'setup',
    supportRequired: true,
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'INTEGRATOR_LINE_SELECT',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },

  {
    baseId: 'signalProphet',
    activationType: 'deploy',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'GLOBAL_AUTO_APPLY',
      payload: {
        tokenType: 'Exploit',
        filter: (target: Card) => target.ownerId === ownerId && hasStatus(target, 'Support', ownerId),
      },
      sourceCard: _card,
      sourceCoords: coords,
    })
  },
  {
    baseId: 'signalProphet',
    activationType: 'commit',
    supportRequired: true,
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_UNIT_FOR_MOVE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        filter: (target: Card) => target.ownerId === ownerId && hasStatus(target, 'Exploit', ownerId),
      },
    })
  },

  {
    baseId: 'zealousMissionary',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },
  {
    baseId: 'zealousMissionary',
    activationType: 'commit',
    supportRequired: true,
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'ZEALOUS_WEAKEN',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { filter: (target: Card) => hasStatus(target, 'Exploit', ownerId) }
    })
  },

  // ============================================================================
  // TOKENS
  // ============================================================================

  {
    baseId: 'walkingTurret',
    activationType: 'deploy',
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      mustBeInLineWithSource: true,
      sourceCoords: coords,
      sourceCard: card,
    })
  },
  {
    baseId: 'walkingTurret',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'MODIFY_POWER',
        amount: -1,
        filter: (target: Card) => hasStatus(target, 'Aim', ownerId),
      },
    })
  },

  {
    baseId: 'reconDrone',
    activationType: 'setup',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_CELL',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { allowSelf: false, range: 'global' }
    })
  },
  {
    baseId: 'reconDrone',
    activationType: 'commit',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'REVEAL_ENEMY',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { filter: (target: Card, r: number, c: number) => checkAdj(r, c, coords.row, coords.col) && target.ownerId !== ownerId },
    })
  },

  // ============================================================================
  // NEUTRAL / HEROES
  // ============================================================================

  {
    baseId: 'abrGawain',
    baseIdAlt: ['autonomousBattleRobot'],
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'PRINCEPS_SHIELD_THEN_AIM', // Same as Princeps
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'abrGawain',
    baseIdAlt: ['autonomousBattleRobot'],
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card) => hasStatus(target, 'Aim', ownerId), // Same as Princeps - any card with Aim
      },
    })
  },

  {
    baseId: 'reclaimedGawain',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SHIELD_SELF_THEN_RIOT_PUSH',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },
  {
    baseId: 'reclaimedGawain',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card, r: number, c: number) =>
          checkAdj(r, c, coords.row, coords.col) &&
                      target.ownerId !== ownerId &&
                      (hasStatus(target, 'Threat', ownerId) || hasStatus(target, 'Stun', ownerId)),
      },
    })
  },

  {
    baseId: 'FalkPD',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'OPEN_MODAL',
      mode: 'SEARCH_DECK',
      sourceCard: _card,
      payload: { filterType: 'Any' },
    })
  },
  {
    baseId: 'FalkPD',
    activationType: 'commit',
    getAction: (_card, _gameState, ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Revealed',
      count: 1,
      onlyFaceDown: true,
      excludeOwnerId: ownerId
    })
  },

  {
    baseId: 'edithByron',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SHIELD_SELF_THEN_SPAWN',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { tokenName: 'Recon Drone' },
    })
  },
  {
    baseId: 'edithByron',
    activationType: 'setup',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'PATROL_MOVE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
    })
  },

  {
    baseId: 'pinkunonekoSV',
    activationType: 'deploy',
    getAction: (card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Stun',
      count: 1,
      onlyOpponents: true,
      mustBeAdjacentToSource: true,
      sourceCoords: coords,
      sourceCard: card,
    })
  },
  {
    baseId: 'pinkunonekoSV',
    activationType: 'setup',
    getAction: (card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: card,
      sourceCoords: coords,
      payload: {
        actionType: 'DESTROY',
        filter: (target: Card, r: number, c: number) =>
          checkAdj(r, c, coords.row, coords.col) &&
                      (hasStatus(target, 'Threat', ownerId) || hasStatus(target, 'Stun', ownerId)),
        chainedAction: {
          type: 'ENTER_MODE',
          mode: 'SELECT_CELL',
          payload: { range: 1, allowSelf: true },
        },
      },
    })
  },

  {
    baseId: 'EleftheriaMD',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1
    })
  },
  {
    baseId: 'EleftheriaMD',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: { actionType: 'DESTROY', filter: (target: Card) => hasStatus(target, 'Aim', ownerId) },
    })
  },

  {
    baseId: 'ziusIJ',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, _coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1
    })
  },
  {
    baseId: 'ziusIJ',
    activationType: 'setup',
    supportRequired: true,
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1,
      sourceCard: _card,
      sourceCoords: coords,
      recordContext: true, // Store the target card coords where Exploit is placed
      chainedAction: {
        type: 'ENTER_MODE',
        mode: 'ZIUS_LINE_SELECT',
        sourceCard: _card,
        sourceCoords: coords,
        payload: {
          actionType: 'ZIUS_SCORING',
        },
      },
    })
  },

  {
    baseId: 'secretInformant',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_DECK',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {},
    })
  },

  {
    baseId: 'reverendOfTheChoir',
    activationType: 'setup',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'CREATE_STACK',
      tokenType: 'Exploit',
      count: 1,
      sourceCard: _card,
      sourceCoords: coords
    })
  },

  {
    baseId: 'luciusTheImmortal',
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_TARGET',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        actionType: 'LUCIUS_SETUP',
        filter: (target: Card) => target.ownerId === ownerId,
      },
    })
  },

  // ============================================================================
  // HOODS
  // ============================================================================

  {
    baseId: 'finnMW',
    baseIdAlt: ['finnSD'],
    activationType: 'setup',
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'SELECT_UNIT_FOR_MOVE',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {
        filter: (target: Card) => target.ownerId === ownerId,
        range: 2, // Can move 1 or 2 cells
      },
    })
  },
  {
    baseId: 'finnMW',
    baseIdAlt: ['finnSD'],
    activationType: 'commit',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'GLOBAL_AUTO_APPLY',
      payload: { customAction: 'FINN_SCORING' },
      sourceCard: _card,
      sourceCoords: coords
    })
  },
]

// ============================================================================
// PUBLIC API - Functions that use the CARD_ABILITIES definitions
// ============================================================================

/**
 * Get all ability definitions for a card (by baseId or alt names)
 */
const getAbilitiesForCard = (card: Card): CardAbilityDefinition[] => {
  const baseId = card.baseId || ''
  return CARD_ABILITIES.filter(ability =>
    ability.baseId === baseId || ability.baseIdAlt?.includes(baseId)
  )
}

/**
 * Get ability types for a card (used for ready status initialization)
 */
export const getCardAbilityTypes = (card: Card): AbilityActivationType[] => {
  const abilities = getAbilitiesForCard(card)
  const types = abilities.map(a => a.activationType)
  // Remove duplicates
  return [...new Set(types)]
}

/**
 * Get all cards that have a specific ability type
 */
const getCardsWithAbilityType = (activationType: AbilityActivationType): string[] => {
  const cardIds = CARD_ABILITIES
    .filter(a => a.activationType === activationType)
    .map(a => a.baseId)
  // Remove duplicates
  return [...new Set(cardIds)]
}

/**
 * Resets ready statuses for all cards owned by a player at start of their turn.
 */
export const resetReadyStatusesForTurn = (gameState: GameState, playerId: number): void => {
  const setupCards = getCardsWithAbilityType('setup')
  const commitCards = getCardsWithAbilityType('commit')

  gameState.board.forEach(row => {
    row.forEach(cell => {
      const card = cell.card
      if (card && card.ownerId === playerId) {
        const baseId = card.baseId || ''

        // Re-ready Setup ability
        if (setupCards.includes(baseId)) {
          addReadyStatus(card, READY_STATUS_SETUP, playerId)
        }
        // Re-ready Commit ability
        if (commitCards.includes(baseId)) {
          addReadyStatus(card, READY_STATUS_COMMIT, playerId)
        }
      }
    })
  })
}

/**
 * Initializes ready statuses when a card enters the battlefield.
 */
export const initializeReadyStatuses = (card: Card, ownerId: number): void => {
  if (!card.statuses) {
    card.statuses = []
  }

  const abilities = getAbilitiesForCard(card)

  for (const ability of abilities) {
    let readyStatusType = ''
    if (ability.activationType === 'deploy') {
      readyStatusType = READY_STATUS_DEPLOY
    } else if (ability.activationType === 'setup') {
      readyStatusType = READY_STATUS_SETUP
    } else if (ability.activationType === 'commit') {
      readyStatusType = READY_STATUS_COMMIT
    }

    if (readyStatusType && !card.statuses.some(s => s.type === readyStatusType)) {
      card.statuses.push({ type: readyStatusType, addedByPlayerId: ownerId })
    }
  }
}

/**
 * Removes all ready statuses from a card (when leaving battlefield).
 */
export const removeAllReadyStatuses = (card: Card): void => {
  if (!card.statuses) {
    return
  }
  card.statuses = card.statuses.filter(s =>
    s.type !== READY_STATUS_DEPLOY &&
    s.type !== READY_STATUS_SETUP &&
    s.type !== READY_STATUS_COMMIT
  )
}

/**
 * Determines if a specific card can be activated in the current state.
 * If gameState is provided, allows any player to control dummy player's cards
 * (when the dummy is the active player).
 */
export const canActivateAbility = (
  card: Card,
  phaseIndex: number,
  activePlayerId: number | undefined,
  gameState?: GameState
): boolean => {
  // Ownership check: active player must own the card
  // Exception: if card belongs to dummy player and that dummy is active, allow activation
  if (activePlayerId !== card.ownerId) {
    return false
  }

  // If the card belongs to a dummy player, verify the dummy is the active player
  if (gameState && card.ownerId !== undefined) {
    const cardOwner = gameState.players.find(p => p.id === card.ownerId)
    if (cardOwner?.isDummy && gameState.activePlayerId !== card.ownerId) {
      // Dummy player's card can only be activated when it's the dummy's turn
      return false
    }
  }
  if (card.statuses?.some(s => s.type === 'Stun')) {
    return false
  }

  const abilities = getAbilitiesForCard(card)

  // === 1. CHECK DEPLOY ABILITY (works in any phase) ===
  const deployAbility = abilities.find(a => a.activationType === 'deploy')
  if (deployAbility && hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    if (deployAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
      return false
    }
    return true
  }

  // === 2. CHECK PHASE ABILITY ===
  let readyStatusType = ''
  let phaseAbilityType: AbilityActivationType | null = null

  // Setup abilities only work in Setup phase (phase 0)
  // Commit abilities only work in Commit phase (phase 2)
  // Main phase (phase 1) is for manual actions, no phase abilities
  if (phaseIndex === 0) {
    readyStatusType = READY_STATUS_SETUP
    phaseAbilityType = 'setup'
  } else if (phaseIndex === 2) {
    readyStatusType = READY_STATUS_COMMIT
    phaseAbilityType = 'commit'
  }

  if (readyStatusType && phaseAbilityType && hasReadyStatus(card, readyStatusType)) {
    const phaseAbility = abilities.find(a => a.activationType === phaseAbilityType)
    if (phaseAbility) {
      if (phaseAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
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
 * 3. Priority: Deploy > Phase Ability
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

  // Priority 1: Deploy (if ready)
  if (hasReadyStatus(card, READY_STATUS_DEPLOY)) {
    const deployAbility = abilities.find(a => a.activationType === 'deploy')
    if (deployAbility) {
      if (deployAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = deployAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, isDeployAbility: true, readyStatusToRemove: READY_STATUS_DEPLOY }
      }
    }
  }

  // Priority 2: Phase Ability
  const phaseIndex = gameState.currentPhase
  let readyStatusType = ''
  let phaseAbilityType: AbilityActivationType | null = null

  // Setup abilities only work in Setup phase (phase 0)
  // Commit abilities only work in Commit phase (phase 2)
  // Main phase (phase 1) is for manual actions, no phase abilities
  if (phaseIndex === 0) {
    readyStatusType = READY_STATUS_SETUP
    phaseAbilityType = 'setup'
  } else if (phaseIndex === 2) {
    readyStatusType = READY_STATUS_COMMIT
    phaseAbilityType = 'commit'
  }

  if (readyStatusType && phaseAbilityType && hasReadyStatus(card, readyStatusType)) {
    const phaseAbility = abilities.find(a => a.activationType === phaseAbilityType)
    if (phaseAbility) {
      if (phaseAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = phaseAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: readyStatusType }
      }
    }
  }

  return null
}
