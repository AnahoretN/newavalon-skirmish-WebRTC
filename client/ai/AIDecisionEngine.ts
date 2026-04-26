/**
 * AI Decision Engine
 *
 * The brain of the AI system. Evaluates board state and makes decisions
 * about what actions to take based on the AI Skills knowledge base.
 */

import type {
  BoardSituation,
  CardEvaluation,
  TargetEvaluation,
  AIActionDecision,
  AIExecutionContext,
  AIGamePhase,
  CardRole,
  ActionPriority
} from './types'
import type { Card, Player, Board, GameState, AbilityAction } from '../types'
import { getApplicableSkills, sortSkillsByValue } from './AISKills'
import { getCardDefinition } from '../content'

/**
 * Analyze the board situation from the AI player's perspective
 */
export function analyzeBoardSituation(
  gameState: GameState,
  playerId: number
): BoardSituation {
  const { board, activeGridSize, players } = gameState
  const aiPlayer = players.find(p => p.id === playerId)
  if (!aiPlayer) {
    return {
      ownCardCount: 0,
      ownTotalPower: 0,
      ownCompletedLines: 0,
      ownPotentialLines: 0,
      opponentCardCount: 0,
      opponentTotalPower: 0,
      opponentCompletedLines: 0,
      opponentThreats: 0,
      boardControlRatio: 0,
      isEmptyBoard: true,
      isLateGame: false
    }
  }

  // Count AI's cards and power
  let ownCardCount = 0
  let ownTotalPower = 0
  const aiCardsWithThreat = 0

  // Count opponents' cards and power
  let opponentCardCount = 0
  let opponentTotalPower = 0
  let opponentThreats = 0

  // Count completed and potential lines
  let ownCompletedLines = 0
  let ownPotentialLines = 0
  let opponentCompletedLines = 0

  // Scan the board
  for (let row = 0; row < activeGridSize; row++) {
    for (let col = 0; col < activeGridSize; col++) {
      const cell = board[row]?.[col]
      if (!cell?.card) continue

      const card = cell.card
      const power = (card.power || 0) + (card.powerModifier || 0) + (card.bonusPower || 0)
      const isOwnCard = card.ownerId === playerId
      const hasThreat = card.statuses?.some(s => s.type === 'Threat') || false

      if (isOwnCard) {
        ownCardCount++
        ownTotalPower += power
        if (hasThreat) {
          // Count as threatening
        }
      } else {
        opponentCardCount++
        opponentTotalPower += power
        if (hasThreat) {
          opponentThreats++
        }
      }
    }
  }

  // Count completed lines
  for (let i = 0; i < activeGridSize; i++) {
    // Check rows
    let rowOwnCount = 0
    let rowOpponentCount = 0
    let rowOwnPower = 0
    let rowPotential = 0

    for (let col = 0; col < activeGridSize; col++) {
      const cell = board[i]?.[col]
      if (cell?.card) {
        if (cell.card.ownerId === playerId) {
          rowOwnCount++
          rowOwnPower += (cell.card.power || 0)
        } else {
          rowOpponentCount++
        }
      } else {
        // Empty cell - potential to complete
        if (rowOwnCount + rowOpponentCount > 0) {
          rowPotential++
        }
      }
    }

    if (rowOwnCount === activeGridSize) ownCompletedLines++
    if (rowOpponentCount === activeGridSize) opponentCompletedLines++
    if (rowOwnCount > 0 && rowOwnCount + (activeGridSize - rowOwnCount - rowOpponentCount) === activeGridSize) {
      ownPotentialLines++
    }

    // Check columns
    let colOwnCount = 0
    let colOpponentCount = 0

    for (let row = 0; row < activeGridSize; row++) {
      const cell = board[row]?.[i]
      if (cell?.card) {
        if (cell.card.ownerId === playerId) {
          colOwnCount++
        } else {
          colOpponentCount++
        }
      }
    }

    if (colOwnCount === activeGridSize) ownCompletedLines++
    if (colOpponentCount === activeGridSize) opponentCompletedLines++
  }

  // Calculate board control ratio
  const totalCards = ownCardCount + opponentCardCount
  const boardControlRatio = totalCards > 0 ? ownCardCount / totalCards : 0.5

  // Determine if late game
  const threshold = 10 + (gameState.currentRound * 10)
  const isLateGame = aiPlayer.score >= threshold * 0.6 || gameState.currentRound >= 2

  return {
    ownCardCount,
    ownTotalPower,
    ownCompletedLines,
    ownPotentialLines,
    opponentCardCount,
    opponentTotalPower,
    opponentCompletedLines,
    opponentThreats,
    boardControlRatio,
    isEmptyBoard: totalCards === 0,
    isLateGame
  }
}

/**
 * Evaluate a card for playability
 */
export function evaluateCard(
  card: Card,
  context: AIExecutionContext
): CardEvaluation {
  const { situation, config, phase } = context
  const cardDef = getCardDefinition(card.baseId || card.id)

  // Determine card role
  let role: CardRole = 'utility'
  if (cardDef) {
    const hasDeployDamage = cardDef.ABILITIES?.some((a: any) =>
      a.action === 'CREATE_STACK' && (a.details.tokenType === 'Stun' || a.details.tokenType === 'Aim')
    )
    const hasDrawAbility = cardDef.ABILITIES?.some((a: any) =>
      a.abilityText?.toLowerCase().includes('draw')
    )
    const hasHighPower = (card.power || 0) >= 4

    if (hasHighPower) role = 'win_condition'
    else if (hasDeployDamage) role = 'control'
    else if (hasDrawAbility) role = 'token_generator'
    else if (card.power >= 3) role = 'threat'
    else role = 'support'
  }

  // Calculate scores
  const powerScore = card.power || 0

  // Utility score based on abilities
  let utilityScore = 0
  if (cardDef) {
    const abilityCount = cardDef.ABILITIES?.length || 0
    utilityScore = abilityCount * 5
    if (cardDef.abilityText?.toLowerCase().includes('draw')) utilityScore += 15
    if (cardDef.abilityText?.toLowerCase().includes('destroy')) utilityScore += 10
    if (cardDef.abilityText?.toLowerCase().includes('stun')) utilityScore += 8
  }

  // Timing score - is this a good time to play this card?
  let timingScore = 50
  if (situation.isEmptyBoard && role === 'threat') timingScore += 20
  if (situation.opponentCardCount > situation.ownCardCount && role === 'control') timingScore += 15
  if (situation.isLateGame && role === 'win_condition') timingScore += 25
  if (phase === 0 && role === 'support') timingScore -= 10

  // Target score - are there good targets for this card's abilities?
  let targetScore = 50
  if (situation.opponentThreats > 0 && role === 'control') targetScore += 20
  if (situation.ownCardCount > 2 && role === 'support') targetScore += 15

  // Calculate overall playability
  const playabilityScore = (
    powerScore * 2 +
    utilityScore +
    timingScore +
    targetScore
  ) / 4

  return {
    card,
    role,
    playabilityScore,
    powerScore,
    utilityScore,
    timingScore,
    targetScore
  }
}

/**
 * Find best empty cell to place a card
 */
export function findBestPlacement(
  gameState: GameState,
  playerId: number,
  card: Card,
  situation: BoardSituation
): { row: number; col: number } | null {
  const { board, activeGridSize } = gameState
  const bestPlacements: { row: number; col: number; score: number }[] = []

  // Score each empty cell
  for (let row = 0; row < activeGridSize; row++) {
    for (let col = 0; col < activeGridSize; col++) {
      if (board[row]?.[col]?.card) continue // Cell occupied

      let score = 0

      // Prefer cells that extend existing lines
      let sameRowCards = 0
      let sameColCards = 0

      for (let i = 0; i < activeGridSize; i++) {
        if (board[row]?.[i]?.card?.ownerId === playerId) sameRowCards++
        if (board[i]?.[col]?.card?.ownerId === playerId) sameColCards++
      }

      score += sameRowCards * 10
      score += sameColCards * 10

      // Prefer center positions early game
      if (situation.isEmptyBoard) {
        const centerDist = Math.abs(row - activeGridSize / 2) + Math.abs(col - activeGridSize / 2)
        score -= centerDist * 2
      }

      // Avoid positions that help opponent complete lines
      for (let i = 0; i < activeGridSize; i++) {
        let rowOpponentCards = 0
        let colOpponentCards = 0

        if (board[row]?.[i]?.card && board[row][i].card!.ownerId !== playerId) rowOpponentCards++
        if (board[i]?.[col]?.card && board[i][col].card!.ownerId !== playerId) colOpponentCards++

        if (rowOpponentCards >= activeGridSize - 1) score -= 15
        if (colOpponentCards >= activeGridSize - 1) score -= 15
      }

      bestPlacements.push({ row, col, score })
    }
  }

  if (bestPlacements.length === 0) return null

  // Sort by score descending and return best
  bestPlacements.sort((a, b) => b.score - a.score)
  return { row: bestPlacements[0].row, col: bestPlacements[0].col }
}

/**
 * Evaluate targets for abilities
 */
export function evaluateTargets(
  gameState: GameState,
  action: AbilityAction,
  sourceCoords: { row: number; col: number }
): TargetEvaluation[] {
  const { board, activeGridSize } = gameState
  const evaluations: TargetEvaluation[] = []

  // Get targeting constraints from action
  const mustBeAdjacent = action.mustBeAdjacentToSource
  const onlyOpponents = action.onlyOpponents
  const requiredStatus = action.requiredTargetStatus

  for (let row = 0; row < activeGridSize; row++) {
    for (let col = 0; col < activeGridSize; col++) {
      const cell = board[row]?.[col]
      if (!cell?.card) continue

      let score = 50
      let reason = 'valid target'

      // Check adjacency if required
      if (mustBeAdjacent) {
        const dist = Math.abs(row - sourceCoords.row) + Math.abs(col - sourceCoords.col)
        if (dist > 1) continue // Not adjacent
      }

      // Check opponent filter
      if (onlyOpponents && cell.card.ownerId === action.sourceCoords?.ownerId) continue

      // Check required status
      if (requiredStatus && !cell.card.statuses?.some(s => s.type === requiredStatus)) {
        continue
      }

      // Score based on card power (higher value targets)
      const cardPower = (cell.card.power || 0) + (cell.card.powerModifier || 0)
      score += cardPower * 5

      // Prefer targets with more statuses
      if (cell.card.statuses && cell.card.statuses.length > 0) {
        score += cell.card.statuses.length * 3
      }

      evaluations.push({
        coords: { row, col },
        score,
        reason
      })
    }
  }

  return evaluations.sort((a, b) => b.score - a.score)
}

/**
 * Make a decision about what action to take
 */
export function makeDecision(
  context: AIExecutionContext
): AIActionDecision | null {
  const { situation, gameState, playerId, phase, config } = context

  // Get applicable skills
  const applicableSkills = getApplicableSkills(context)
  const sortedSkills = sortSkillsByValue(applicableSkills)

  if (sortedSkills.length === 0) {
    // No specific skills apply, make a default decision based on phase
    return makeDefaultDecision(context)
  }

  // Use the highest value skill
  const bestSkill = sortedSkills[0]

  return {
    type: bestSkill.action,
    priority: bestSkill.priority as ActionPriority,
    description: bestSkill.name,
    estimatedValue: bestSkill.value,
    execute: () => {
      // Execution will be handled by AIActionExecutor
      console.log(`[AI] Executing skill: ${bestSkill.name}`)
    }
  }
}

/**
 * Make a default decision when no specific skills apply
 */
function makeDefaultDecision(
  context: AIExecutionContext
): AIActionDecision | null {
  const { phase, situation, gameState, playerId } = context
  const player = gameState.players.find(p => p.id === playerId)
  if (!player) return null

  switch (phase) {
    case -1: // Preparation (Draw phase)
      if (player.hand.length < 5) {
        return {
          type: 'draw_card',
          priority: 2 as ActionPriority,
          description: 'Draw card for hand',
          estimatedValue: 30,
          execute: () => {}
        }
      }
      break

    case 0: // Setup
      if (player.hand.length > 0) {
        return {
          type: 'play_card',
          priority: 2 as ActionPriority,
          description: 'Play card to board',
          estimatedValue: 40,
          execute: () => {}
        }
      }
      break

    case 1: // Main
    case 2: // Commit
      // Check if there are abilities to activate
      if (situation.ownCardCount > 0) {
        return {
          type: 'activate_ability',
          priority: 2 as ActionPriority,
          description: 'Activate card ability',
          estimatedValue: 35,
          execute: () => {}
        }
      }
      break

    case 3: // Scoring
      if (situation.ownCompletedLines > 0) {
        return {
          type: 'score_line',
          priority: 1 as ActionPriority,
          description: 'Score completed line',
          estimatedValue: 60,
          execute: () => {}
        }
      }
      break
  }

  // If nothing else, pass turn
  return {
    type: 'pass_turn',
    priority: 3 as ActionPriority,
    description: 'No good moves, pass turn',
    estimatedValue: 0,
    execute: () => {}
  }
}

/**
 * Evaluate all cards in hand for best play
 */
export function evaluateHandCards(
  context: AIExecutionContext
): CardEvaluation[] {
  const { gameState, playerId } = context
  const player = gameState.players.find(p => p.id === playerId)
  if (!player) return []

  return player.hand
    .map(card => evaluateCard(card, context))
    .sort((a, b) => b.playabilityScore - a.playabilityScore)
}
