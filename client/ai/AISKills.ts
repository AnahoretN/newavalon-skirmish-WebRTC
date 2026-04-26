/**
 * AI Skills - Knowledge/Memory System
 *
 * This file contains the AI's "knowledge" about when to use which actions.
 * Each skill represents a learned pattern or rule that the AI follows.
 *
 * Skills are evaluated based on:
 * 1. The current board situation
 * 2. The current game phase
 * 3. The AI's hand and available cards
 * 4. The opponent's board state
 */

import type {
  AIKnowledgeEntry,
  BoardSituation,
  AIActionType,
  ActionPriority,
  AIExecutionContext
} from './types'
import type { GameState } from '../types'

/**
 * AI Skills Database
 * Each skill defines a trigger condition and an action to take
 */
export const AI_SKILLS: AIKnowledgeEntry[] = [
  // ========================================================================
  // WIN CONDITION SKILLS - High priority actions that win games
  // ========================================================================

  {
    id: 'score_completed_line',
    name: 'Score Completed Line',
    description: 'Always score a completed line if available during Scoring phase',
    trigger: (situation, gameState, playerId) => {
      const phase = gameState.currentPhase
      const player = gameState.players.find(p => p.id === playerId)
      return !!(phase === 4 && player && player.hand.length === 0)
    },
    action: 'score_line' as AIActionType,
    priority: 0 as ActionPriority, // CRITICAL
    value: 100
  },

  {
    id: 'complete_line_for_win',
    name: 'Complete Line for Win',
    description: 'If one card away from completing a line, prioritize playing it',
    trigger: (situation, gameState, playerId) => {
      return situation.ownPotentialLines > 0 && situation.ownCompletedLines === 0
    },
    action: 'play_card' as AIActionType,
    priority: 0 as ActionPriority, // CRITICAL
    value: 90
  },

  {
    id: 'lethal_score',
    name: 'Lethal Score',
    description: 'Score to reach victory threshold',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      if (!player) return false
      const threshold = 10 + (gameState.currentRound * 10)
      return player.score >= threshold - 5 && situation.ownCompletedLines > 0
    },
    action: 'score_line' as AIActionType,
    priority: 0 as ActionPriority, // CRITICAL
    value: 100
  },

  // ========================================================================
  // DEVELOPMENT SKILLS - Early game card placement
  // ========================================================================

  {
    id: 'play_high_power_early',
    name: 'Play High Power Early',
    description: 'Play high power cards early to establish board presence',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      return !!(situation.isEmptyBoard && player && player.hand.length > 3)
    },
    action: 'play_card' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 70
  },

  {
    id: 'establish_threats',
    name: 'Establish Threats',
    description: 'Play cards that can threaten opponents',
    trigger: (situation, gameState, playerId) => {
      return situation.ownCardCount < 3 && situation.isEmptyBoard === false
    },
    action: 'play_card' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 65
  },

  {
    id: 'fill_empty_board',
    name: 'Fill Empty Board',
    description: 'When behind on cards, play more cards',
    trigger: (situation) => {
      return situation.ownCardCount < situation.opponentCardCount - 1
    },
    action: 'play_card' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 60
  },

  // ========================================================================
  // CONTROL SKILLS - Disrupt opponent's plans
  // ========================================================================

  {
    id: 'apply_stun_to_threat',
    name: 'Apply Stun to Threat',
    description: 'Use Stun counters on opponent\'s threatening cards',
    trigger: (situation, gameState, playerId) => {
      return situation.opponentThreats > 0 && situation.boardControlRatio < 0.6
    },
    action: 'activate_ability' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 55
  },

  {
    id: 'destroy_high_value_target',
    name: 'Destroy High Value Target',
    description: 'Destroy opponent\'s highest power card if possible',
    trigger: (situation) => {
      return situation.opponentTotalPower > situation.ownTotalPower + 5
    },
    action: 'activate_ability' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 50
  },

  {
    id: 'place_exploit',
    name: 'Place Exploit Counter',
    description: 'Apply Exploit to enable future targeting',
    trigger: (situation) => {
      return situation.boardControlRatio > 0.5 && situation.ownCardCount > 2
    },
    action: 'activate_ability' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 45
  },

  // ========================================================================
  // UTILITY SKILLS - Card draw and resource generation
  // ========================================================================

  {
    id: 'draw_when_low',
    name: 'Draw When Low',
    description: 'Draw cards when hand is empty or very low',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      return player !== undefined && player.hand.length <= 1
    },
    action: 'draw_card' as AIActionType,
    priority: 0 as ActionPriority, // CRITICAL
    value: 80
  },

  {
    id: 'use_card_draw_ability',
    name: 'Use Card Draw Ability',
    description: 'Activate abilities that draw cards',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      return player !== undefined && player.hand.length <= 2
    },
    action: 'activate_ability' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 60
  },

  // ========================================================================
  // DEFENSIVE SKILLS - Protect own cards
  // ========================================================================

  {
    id: 'add_shield_to_key_card',
    name: 'Add Shield to Key Card',
    description: 'Protect your highest power card with Shield',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      if (!player) return false
      const ownCards = getOwnCards(gameState, playerId)
      const highestPower = Math.max(...ownCards.map(c => (c.power || 0) + (c.powerModifier || 0) + (c.bonusPower || 0)))
      return highestPower >= 4 && situation.opponentThreats > 0
    },
    action: 'activate_ability' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 40
  },

  {
    id: 'aim_for_lethal',
    name: 'Aim for Lethal',
    description: 'Use Aim counters on cards that can destroy opponents',
    trigger: (situation) => {
      return situation.ownTotalPower > situation.opponentTotalPower && situation.opponentCardCount > 0
    },
    action: 'activate_ability' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 45
  },

  // ========================================================================
  // SCORING SKILLS - Line completion and points
  // ========================================================================

  {
    id: 'score_early_advantage',
    name: 'Score Early Advantage',
    description: 'Score first if you have more cards on board',
    trigger: (situation) => {
      return situation.ownCardCount > situation.opponentCardCount && situation.ownCompletedLines > 0
    },
    action: 'score_line' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 55
  },

  {
    id: 'block_opponent_scoring',
    name: 'Block Opponent Scoring',
    description: 'Play cards to block opponent\'s potential lines',
    trigger: (situation) => {
      return situation.opponentPotentialLines > 0 && situation.ownCompletedLines === 0
    },
    action: 'play_card' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 50
  },

  // ========================================================================
  // PHASE-SPECIFIC SKILLS
  // ========================================================================

  {
    id: 'setup_play_face_up',
    name: 'Setup: Play Face Up',
    description: 'Play cards face-up during Setup to use abilities',
    trigger: (situation, gameState, playerId) => {
      const phase = gameState.currentPhase
      const player = gameState.players.find(p => p.id === playerId)
      return !!(phase === 1 && player && player.hand.length > 0)
    },
    action: 'play_card' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 50
  },

  {
    id: 'main_activate_deploy',
    name: 'Main: Activate Deploy Abilities',
    description: 'Use deploy abilities during Main phase',
    trigger: (situation, gameState, playerId) => {
      const phase = gameState.currentPhase
      return phase === 2
    },
    action: 'activate_ability' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 45
  },

  {
    id: 'commit_add_counters',
    name: 'Commit: Add Counters',
    description: 'Add beneficial counters during Commit phase',
    trigger: (situation, gameState, playerId) => {
      const phase = gameState.currentPhase
      return phase === 3
    },
    action: 'activate_ability' as AIActionType,
    priority: 2 as ActionPriority, // MEDIUM
    value: 40
  },

  // ========================================================================
  // LATE GAME SKILLS
  // ========================================================================

  {
    id: 'aggressive_scoring',
    name: 'Aggressive Scoring',
    description: 'Score aggressively in late game',
    trigger: (situation, gameState, playerId) => {
      const player = gameState.players.find(p => p.id === playerId)
      const threshold = 10 + (gameState.currentRound * 10)
      return !!(situation.isLateGame && player && player.score < threshold)
    },
    action: 'score_line' as AIActionType,
    priority: 0 as ActionPriority, // CRITICAL
    value: 85
  },

  {
    id: 'all_out_attack',
    name: 'All Out Attack',
    description: 'Use all remaining abilities in late game',
    trigger: (situation, gameState, playerId) => {
      const phase = gameState.currentPhase
      const threshold = 10 + (gameState.currentRound * 10)
      const player = gameState.players.find(p => p.id === playerId)
      return !!(situation.isLateGame && phase === 2 && player && player.score < threshold - 5)
    },
    action: 'activate_ability' as AIActionType,
    priority: 1 as ActionPriority, // HIGH
    value: 70
  }
]

/**
 * Helper function to get AI's cards on board
 */
function getOwnCards(gameState: GameState, playerId: number) {
  const cards: any[] = []
  const { board, activeGridSize } = gameState

  for (let row = 0; row < activeGridSize; row++) {
    for (let col = 0; col < activeGridSize; col++) {
      const cell = board[row]?.[col]
      if (cell?.card?.ownerId === playerId) {
        cards.push(cell.card)
      }
    }
  }

  return cards
}

/**
 * Get applicable skills for the current situation
 */
export function getApplicableSkills(
  context: AIExecutionContext
): AIKnowledgeEntry[] {
  return AI_SKILLS.filter(skill =>
    skill.trigger(context.situation, context.gameState, context.playerId)
  )
}

/**
 * Get skills by action type
 */
export function getSkillsByActionType(actionType: AIActionType): AIKnowledgeEntry[] {
  return AI_SKILLS.filter(skill => skill.action === actionType)
}

/**
 * Get skills by priority
 */
export function getSkillsByPriority(priority: ActionPriority): AIKnowledgeEntry[] {
  return AI_SKILLS.filter(skill => skill.priority === priority)
}

/**
 * Sort skills by value (highest first)
 */
export function sortSkillsByValue(skills: AIKnowledgeEntry[]): AIKnowledgeEntry[] {
  return [...skills].sort((a, b) => b.value - a.value)
}
