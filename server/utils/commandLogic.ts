/**
 * @file Command card ability logic
 * Shared between client and server
 *
 * Command card IDs:
 * - overwatch: Aim 1 on any card. Then reveal/draw for each Aim.
 * - tacticalManeuver: Move unit. Draw or score equal to power.
 * - inspiration: Remove counters. Draw or score for each removed.
 * - dataInterception: Exploit 1. Then reveal or move unit with exploit.
 * - falseOrders: Exploit 1 on opponent unit. Then reveal or stun x2.
 * - experimentalStimulants: Reactivate deploy or move unit in line.
 * - logisticsChain: Score diagonal with bonus per support or draw per support.
 * - quickResponseTeam: Deploy unit from hand or search deck for unit.
 * - temporaryShelter: Shield 1. Then remove aim or move 1-2.
 * - enhancedInterrogation: Aim 1. Then reveal or move card with aim.
 * - mobilization1 / lineBreach: Gain points in a line.
 *
 * NOTE: Filter functions in AbilityAction payloads are runtime-only and not
 * serializable. They are regenerated fresh on both client and server based on
 * the same inputs (cardId, optionIndex, card, gameState, localPlayerId).
 * This design works because only card IDs and option indices are sent over
 * the network, not the full AbilityAction objects with their filter closures.
 */

import type { AbilityAction, Card, GameState } from '../types/types.js'

/**
 * Maps specific Command Card IDs and Option Indices to a SEQUENCE of Game Actions.
 *
 * @returns AbilityAction[] - An array of actions to be executed in order.
 */
export const getCommandAction = (
  cardId: string,
  optionIndex: number,
  card: Card,
  _gameState: GameState,
  localPlayerId: number,
): AbilityAction[] => {
  const baseId = (card.baseId || cardId.split('_')[1] || cardId).toLowerCase()
  const isMain = optionIndex === -1
  const actions: AbilityAction[] = []

  // =========================================================================
  // OVERWATCH - Aim tokens, then reveal or draw
  // =========================================================================
  if (baseId === 'overwatch') {
    // 1. Common Step: Place 1 Aim on any card.
    if (isMain) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Aim',
        count: 1,
        sourceCard: card,
      })
    }
    // Option 0: Reveal X from opponent hand (X = Total Aim).
    else if (optionIndex === 0) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Revealed',
        dynamicCount: { factor: 'Aim', ownerId: localPlayerId },
        targetOwnerId: -1, // -1 means Opponents Only
        onlyOpponents: true,
        sourceCard: card,
      })
    }
    // Option 1: Draw X cards (X = Total Aim).
    else if (optionIndex === 1) {
      actions.push({
        type: 'GLOBAL_AUTO_APPLY',
        payload: { dynamicResource: { type: 'draw', factor: 'Aim', ownerId: localPlayerId } },
        sourceCard: card,
      })
    }
  }

  // =========================================================================
  // TACTICAL MANEUVER - Move unit, then draw or score
  // =========================================================================
  else if (baseId === 'tacticalmaneuver') {
    // Option 0: Move Own Unit -> Draw = Power.
    if (optionIndex === 0) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        recordContext: true,
        sourceCard: card,
        payload: {
          range: 'line',
          filter: (target: Card) => target.ownerId === localPlayerId,
          chainedAction: { type: 'GLOBAL_AUTO_APPLY', payload: { contextReward: 'DRAW_MOVED_POWER' }, sourceCard: card },
        },
      })
    }
    // Option 1: Move Own Unit -> Score = Power.
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        recordContext: true,
        sourceCard: card,
        payload: {
          range: 'line',
          filter: (target: Card) => target.ownerId === localPlayerId,
          chainedAction: { type: 'GLOBAL_AUTO_APPLY', payload: { contextReward: 'SCORE_MOVED_POWER' }, sourceCard: card },
        },
      })
    }
  }

  // =========================================================================
  // INSPIRATION - Remove counters, then draw or score
  // =========================================================================
  else if (baseId === 'inspiration') {
    // 3. Common Step: Select Own Unit -> Open Modal.
    if (isMain) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        payload: {
          actionType: 'OPEN_COUNTER_MODAL',
          filter: (target: Card) => target.ownerId === localPlayerId,
        },
      })
    }
    // Rewards are handled by the payload injection in handleCommandConfirm
  }

  // =========================================================================
  // DATA INTERCEPTION - Exploit tokens, then reveal or move
  // =========================================================================
  else if (baseId === 'datainterception') {
    // 1. Common Step: Place 1 Exploit on any card.
    if (isMain) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Exploit',
        count: 1,
        sourceCard: card,
      })
    }

    // Option 0: Count Total Exploits (X) -> Place X Reveal tokens.
    else if (optionIndex === 0) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Revealed',
        dynamicCount: { factor: 'Exploit', ownerId: localPlayerId },
        onlyFaceDown: true, // Also covers unrevealed hand cards due to validation logic
        onlyOpponents: true,
        targetOwnerId: -1,
        sourceCard: card,
      })
    }
    // Option 1: Select Unit with Own Exploit -> Move Range 2.
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        sourceCard: card,
        payload: {
          range: 2,
          filter: (target: Card) => target.statuses?.some((s: { type: string; addedByPlayerId?: number }) => s.type === 'Exploit' && s.addedByPlayerId === localPlayerId) || false,
        },
      })
    }
  }

  // =========================================================================
  // FALSE ORDERS - Exploit on opponent, then reveal or stun
  // =========================================================================
  else if (baseId === 'falseorders') {
    // 1. Common Step: CREATE STACK Exploit (1) on Opponent Unit -> Record Context
    if (isMain) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Exploit',
        count: 1,
        sourceCard: card,
        onlyOpponents: true,
        targetType: 'Unit', // Enforce Unit targeting
        recordContext: true, // Record target to CommandContext
      })
    }

    // Option 0: Move Selected (Range 2) -> Reveal x2 (Owner's hand/FaceDown).
    else if (optionIndex === 0) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_CELL',
        sourceCard: card, // Will be overridden by context in App.tsx
        recordContext: true,
        payload: {
          range: 2,
          useContextCard: true, // Use the card from commandContext.lastMovedCardCoords
          chainedAction: {
            type: 'CREATE_STACK',
            tokenType: 'Revealed',
            count: 2,
            targetOwnerId: -2, // Owner of moved card
            onlyFaceDown: true,
            excludeOwnerId: localPlayerId,
          },
        },
      })
    }
    // Option 1: Move Selected (Range 2) -> Stun x2 (Owner = Command Player).
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_CELL',
        sourceCard: card,
        recordContext: true,
        payload: {
          range: 2,
          useContextCard: true, // Use the card from commandContext.lastMovedCardCoords
          chainedAction: {
            type: 'GLOBAL_AUTO_APPLY',
            payload: {
              tokenType: 'Stun',
              count: 2,
              ownerId: localPlayerId, // Stun belongs to Command Player
            },
          },
        },
      })
    }
  }

  // =========================================================================
  // EXPERIMENTAL STIMULANTS - Reactivate deploy or move unit in line
  // =========================================================================
  else if (baseId === 'experimentalstimulants') {
    // Option 0: Reactivate Deploy (Reset flag)
    if (optionIndex === 0) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        payload: {
          actionType: 'RESET_DEPLOY',
          filter: (target: Card) => target.ownerId === localPlayerId && target.types?.includes('Unit'),
        },
      })
    }
    // Option 1: Move Own Unit (Line)
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        sourceCard: card,
        payload: {
          range: 'line',
          filter: (target: Card) => target.ownerId === localPlayerId,
        },
      })
    }
  }

  // =========================================================================
  // LOGISTICS CHAIN - Score diagonal with bonus per support or draw per support
  // =========================================================================
  else if (baseId === 'logisticschain') {
    // Option 0: Score Diagonal + 1 per Support
    if (optionIndex === 0) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_DIAGONAL',
        sourceCard: card,
        payload: { actionType: 'SCORE_DIAGONAL', bonusType: 'point_per_support' },
      })
    }
    // Option 1: Score Diagonal + Draw 1 per Support
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_DIAGONAL',
        sourceCard: card,
        payload: { actionType: 'SCORE_DIAGONAL', bonusType: 'draw_per_support' },
      })
    }
  }

  // =========================================================================
  // QUICK RESPONSE TEAM - Deploy unit from hand or search deck
  // =========================================================================
  else if (baseId === 'quickresponseteam') {
    // Option 0: Deploy Unit from Hand
    if (optionIndex === 0) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        payload: {
          actionType: 'SELECT_HAND_FOR_DEPLOY',
          filter: (target: Card) => target.ownerId === localPlayerId && target.types?.includes('Unit'),
        },
      })
    }
    // Option 1: Search Deck for Unit -> Hand
    else if (optionIndex === 1) {
      actions.push({
        type: 'OPEN_MODAL',
        mode: 'SEARCH_DECK',
        sourceCard: card,
        payload: { filterType: 'Unit' },
      })
    }
  }

  // =========================================================================
  // TEMPORARY SHELTER - Shield and remove aim or move
  // =========================================================================
  else if (baseId === 'temporaryshelter') {
    // Option 0: Shield (Stack) -> Remove All Aim (Context)
    if (optionIndex === 0) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Shield',
        count: 1,
        targetOwnerId: localPlayerId, // Only own cards
        recordContext: true, // Mark this card
        sourceCard: card,
        chainedAction: {
          type: 'GLOBAL_AUTO_APPLY',
          payload: { customAction: 'REMOVE_ALL_AIM_FROM_CONTEXT' },
        },
      })
    }
    // Option 1: Shield (Stack) -> Move (Range 2)
    else if (optionIndex === 1) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Shield',
        count: 1,
        targetOwnerId: localPlayerId, // Only own cards
        recordContext: true, // Mark this card
        sourceCard: card,
        chainedAction: {
          type: 'ENTER_MODE',
          mode: 'SELECT_CELL',
          payload: { range: 2, useContextCard: true }, // App.tsx will inject sourceCard from commandContext
        },
      })
    }
  }

  // =========================================================================
  // ENHANCED INTERROGATION - Aim tokens, then reveal or move
  // =========================================================================
  else if (baseId === 'enhancedinterrogation') {
    // Common Logic: Place 1 Aim token first
    if (isMain) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Aim',
        count: 1,
        sourceCard: card,
      })
    }

    // Option 0: Count Total Aim (X) -> Place X Reveal tokens.
    else if (optionIndex === 0) {
      actions.push({
        type: 'CREATE_STACK',
        tokenType: 'Revealed',
        dynamicCount: { factor: 'Aim', ownerId: localPlayerId },
        onlyFaceDown: true,
        onlyOpponents: true,
        targetOwnerId: -1,
        sourceCard: card,
      })
    }
    // Option 1: Select Unit with Own Aim -> Move Range 2.
    else if (optionIndex === 1) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        sourceCard: card,
        payload: {
          range: 2,
          filter: (target: Card) => target.statuses?.some((s: { type: string; addedByPlayerId?: number }) => s.type === 'Aim' && s.addedByPlayerId === localPlayerId) || false,
        },
      })
    }
  }

  // =========================================================================
  // LINE BREACH (Mobilization 1) - Gain points in a line
  // =========================================================================
  else if (baseId === 'mobilization1' || baseId === 'linebreach') {
    if (isMain) {
      actions.push({
        type: 'ENTER_MODE',
        mode: 'SELECT_LINE_START',
        sourceCard: card,
        payload: { actionType: 'SCORE_LINE' },
      })
    }
  }

  // Set originalOwnerId for all actions to preserve command card ownership
  // This ensures highlights and effects use the correct owner color even in multi-step commands
  actions.forEach(action => {
    action.originalOwnerId = card.ownerId
  })

  return actions
}
