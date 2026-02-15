import type { Card, GameState, AbilityAction } from '../types/types.js'
import { READY_STATUS_DEPLOY, READY_STATUS_SETUP, READY_STATUS_COMMIT } from '../../shared/constants/readyStatuses.js'

// Use console.log instead of logger to avoid Node.js dependency issues
// when this file is imported by client code via @server alias
const debugLog = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[autoAbilities]', ...args)
  }
}

// Ability activation type - when can this ability be used?
export type AbilityActivationType = 'deploy' | 'setup' | 'commit'

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
      requiredTargetStatus: 'Threat',
      requireStatusFromSourceOwner: true,
      placeAllAtOnce: true,
    })
  },
  {
    baseId: 'ipDeptAgent',
    activationType: 'setup',
    supportRequired: true,
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'IP_AGENT_THREAT_SCORING',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {}
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
        filter: (target: Card) => target.ownerId !== ownerId && target.statuses?.some(s => s.type === 'Threat'),
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
      maxOrthogonalDistance: 2, // Within 2 orthogonal steps (walking distance, not diagonal)
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
      originalOwnerId: ownerId,
      payload: {
        actionType: 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN',
        tokenName: 'Walking Turret',
        // Filter uses ownerId from closure (getAction scope) - checks if card belongs to owner
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
      replaceStatus: true, // Replace Exploit with Stun instead of adding Stun on top
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
      mode: 'GAWAIN_DEPLOY_SHIELD_AIM', // Can Aim ANY card in line (not just threats)
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
    getAction: (_card, _gameState, ownerId, coords) => ({
      type: 'REVEREND_SETUP_SCORE',
      sourceCard: _card,
      sourceCoords: coords,
      ownerId: ownerId,
    })
  },

  {
    baseId: 'reverendOfTheChoir',
    activationType: 'deploy',
    getAction: (_card, _gameState, _ownerId, coords) => ({
      type: 'ENTER_MODE',
      mode: 'REVEREND_DOUBLE_EXPLOIT',
      sourceCard: _card,
      sourceCoords: coords,
      payload: {},
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
 * Get all cards that have a specific ability type (includes both baseId and baseIdAlt)
 */
const getCardsWithAbilityType = (activationType: AbilityActivationType): string[] => {
  const cardIds: string[] = []
  CARD_ABILITIES
    .filter(a => a.activationType === activationType)
    .forEach(a => {
      cardIds.push(a.baseId)
      if (a.baseIdAlt) {
        cardIds.push(...a.baseIdAlt)
      }
    })
  // Remove duplicates
  return [...new Set(cardIds)]
}

/**
 * Resets ready statuses for all cards owned by a player at start of their turn.
 * First removes old phase-specific statuses, then adds fresh ones to ensure clean state.
 * Also adds phase-specific statuses to newly played cards that don't have them yet.
 */
export const resetReadyStatusesForTurn = (gameState: GameState, playerId: number): void => {
  const setupCards = getCardsWithAbilityType('setup')
  const commitCards = getCardsWithAbilityType('commit')

  debugLog(`[resetReadyStatusesForTurn] Player ${playerId}, setupCards: [${setupCards.join(', ')}], commitCards: [${commitCards.join(', ')}]`)

  let cardsProcessed = 0
  let setupAdded = 0
  let commitAdded = 0
  let setupAddedToNew = 0
  let commitAddedToNew = 0

  gameState.board.forEach(row => {
    row.forEach(cell => {
      const card = cell.card
      if (card && card.ownerId === playerId) {
        const baseId = card.baseId || ''
        cardsProcessed++

        debugLog(`[resetReadyStatusesForTurn] Processing card: ${card.name} (baseId: ${baseId}, ownerId: ${card.ownerId})`)

        // === SETUP ABILITY ===
        if (setupCards.includes(baseId)) {
          const hadSetup = hasReadyStatus(card, READY_STATUS_SETUP)
          // Remove old setup status first, then add fresh one
          removeReadyStatus(card, READY_STATUS_SETUP)
          addReadyStatus(card, READY_STATUS_SETUP, playerId)
          setupAdded++
          if (!hadSetup) {
            setupAddedToNew++
            debugLog(`[resetReadyStatusesForTurn] Added NEW READY_STATUS_SETUP to ${card.name} (newly played card)`)
          } else {
            debugLog(`[resetReadyStatusesForTurn] Reset READY_STATUS_SETUP for ${card.name}`)
          }
        } else {
          // Remove setup status if card no longer has setup ability (e.g. was transformed)
          removeReadyStatus(card, READY_STATUS_SETUP)
        }

        // === COMMIT ABILITY ===
        if (commitCards.includes(baseId)) {
          const hadCommit = hasReadyStatus(card, READY_STATUS_COMMIT)
          // Remove old commit status first, then add fresh one
          removeReadyStatus(card, READY_STATUS_COMMIT)
          addReadyStatus(card, READY_STATUS_COMMIT, playerId)
          commitAdded++
          if (!hadCommit) {
            commitAddedToNew++
            debugLog(`[resetReadyStatusesForTurn] Added NEW READY_STATUS_COMMIT to ${card.name} (newly played card)`)
          } else {
            debugLog(`[resetReadyStatusesForTurn] Reset READY_STATUS_COMMIT for ${card.name}`)
          }
        } else {
          // Remove commit status if card no longer has commit ability
          removeReadyStatus(card, READY_STATUS_COMMIT)
        }
      }
    })
  })

  debugLog(`[resetReadyStatusesForTurn] Processed ${cardsProcessed} cards, reset setup: ${setupAdded} (${setupAddedToNew} new), commit: ${commitAdded} (${commitAddedToNew} new)`)
}

/**
 * Initializes ready statuses when a card enters the battlefield.
 * IMPORTANT: Only adds DEPLOY status. Phase-specific statuses (SETUP, COMMIT)
 * are managed by resetReadyStatusesForTurn() during Draw phase to ensure
 * they are available at the correct time each turn.
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
    }
    // Note: setup and commit statuses are NOT added here
    // They are added by resetReadyStatusesForTurn() during Draw phase
    // This ensures phase-specific abilities are available each turn regardless of when card was played

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

  // Check if card has a phase-specific ability for current phase
  const hasPhaseSpecificAbility =
    (phaseIndex === 1 && abilities.some(a => a.activationType === 'setup')) ||
    (phaseIndex === 3 && abilities.some(a => a.activationType === 'commit'))

  // === 1. CHECK SETUP ABILITY (ONLY in Setup phase) ===
  if (phaseIndex === 1) {
    const setupAbility = abilities.find(a => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS_SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  // === 2. CHECK COMMIT ABILITY (ONLY in Commit phase) ===
  if (phaseIndex === 3) {
    const commitAbility = abilities.find(a => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS_COMMIT)) {
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
    if (deployAbility && hasReadyStatus(card, READY_STATUS_DEPLOY)) {
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

  // Check if card has a phase-specific ability for current phase
  const hasPhaseSpecificAbility =
    (phaseIndex === 1 && abilities.some(a => a.activationType === 'setup')) ||
    (phaseIndex === 3 && abilities.some(a => a.activationType === 'commit'))

  // Priority 1: Setup ability (ONLY in Setup phase / phase 1)
  if (phaseIndex === 1) {
    const setupAbility = abilities.find(a => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS_SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = setupAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS_SETUP }
      }
    }
  }

  // Priority 2: Commit ability (ONLY in Commit phase / phase 3)
  if (phaseIndex === 3) {
    const commitAbility = abilities.find(a => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS_COMMIT)) {
      if (commitAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = commitAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS_COMMIT }
      }
    }
  }

  // Priority 3: Deploy ability (works in ANY phase if no phase-specific ability for this phase)
  // Deploy abilities can be used in any phase UNLESS the card has a phase-specific ability
  // for the current phase that should take priority
  if (!hasPhaseSpecificAbility) {
    const deployAbility = abilities.find(a => a.activationType === 'deploy')
    if (deployAbility && hasReadyStatus(card, READY_STATUS_DEPLOY)) {
      if (deployAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = deployAbility.getAction(card, gameState, actorId, coords)
      if (action) {
        return { ...action, isDeployAbility: true, readyStatusToRemove: READY_STATUS_DEPLOY }
      }
    }
  }

  return null
}
