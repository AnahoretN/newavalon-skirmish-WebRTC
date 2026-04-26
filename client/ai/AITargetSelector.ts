/**
 * AI Target Selector
 *
 * Selects the best targets for abilities based on various criteria:
 * - Target power (higher value targets)
 * - Target threats (high threat targets)
 * - Target statuses (vulnerable targets)
 * - Strategic value (position, blocking, etc.)
 */

import type { GameState, Card } from '../types'
import type { TargetEvaluation } from './types'
import { getCardDefinition } from '../content'

/**
 * Target selection criteria
 */
interface TargetCriteria {
  mustBeOpponent?: boolean
  mustBeOwn?: boolean
  mustHaveStatus?: string
  mustNotHaveStatus?: string
  mustBeAdjacent?: boolean
  sourceCoords?: { row: number; col: number }
  minPower?: number
  maxPower?: number
  preferredPowerRange?: [number, number]
}

/**
 * AI Target Selector
 */
export class AITargetSelector {
  private gameState: GameState
  private playerId: number

  constructor(gameState: GameState, playerId: number) {
    this.gameState = gameState
    this.playerId = playerId
  }

  /**
   * Update game state
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState
  }

  /**
   * Select targets for an ability
   */
  selectTargetsForAbility(
    ability: any,
    sourceCoords: { row: number; col: number }
  ): TargetEvaluation[] {
    const criteria = this.extractCriteriaFromAbility(ability, sourceCoords)
    return this.selectTargets(criteria, sourceCoords)
  }

  /**
   * Select best targets based on criteria
   */
  selectTargets(
    criteria: TargetCriteria,
    sourceCoords?: { row: number; col: number }
  ): TargetEvaluation[] {
    const { board, activeGridSize } = this.gameState
    const evaluations: TargetEvaluation[] = []

    for (let row = 0; row < activeGridSize; row++) {
      for (let col = 0; col < activeGridSize; col++) {
        const cell = board[row]?.[col]
        if (!cell?.card) continue

        if (this.matchesCriteria(cell.card, row, col, criteria, sourceCoords)) {
          const score = this.evaluateTarget(cell.card, row, col, criteria)
          evaluations.push({
            coords: { row, col },
            score,
            reason: this.getTargetReason(cell.card, score)
          })
        }
      }
    }

    // Sort by score descending
    return evaluations.sort((a, b) => b.score - a.score)
  }

  /**
   * Extract targeting criteria from ability definition
   */
  private extractCriteriaFromAbility(
    ability: any,
    sourceCoords: { row: number; col: number }
  ): TargetCriteria {
    const criteria: TargetCriteria = {
      sourceCoords
    }

    const details = ability.details || {}

    // Check if ability targets only opponents
    if (details.onlyOpponents || ability.onlyOpponents) {
      criteria.mustBeOpponent = true
    }

    // Check if ability targets own cards
    if (details.onlyOwn || ability.onlyOwn) {
      criteria.mustBeOwn = true
    }

    // Check required status
    if (details.requiredTargetStatus) {
      criteria.mustHaveStatus = details.requiredTargetStatus
    }

    // Check adjacency requirement
    if (details.mustBeAdjacentToSource || ability.mustBeAdjacentToSource) {
      criteria.mustBeAdjacent = true
    }

    // Power filters
    if (details.minTargetPower !== undefined) {
      criteria.minPower = details.minTargetPower
    }
    if (details.maxTargetPower !== undefined) {
      criteria.maxPower = details.maxTargetPower
    }

    return criteria
  }

  /**
   * Check if a target matches the criteria
   */
  private matchesCriteria(
    card: Card,
    row: number,
    col: number,
    criteria: TargetCriteria,
    sourceCoords?: { row: number; col: number }
  ): boolean {
    // Check owner
    if (criteria.mustBeOpponent && card.ownerId === this.playerId) {
      return false
    }
    if (criteria.mustBeOwn && card.ownerId !== this.playerId) {
      return false
    }

    // Check status requirements
    if (criteria.mustHaveStatus) {
      const hasStatus = card.statuses?.some(s => s.type === criteria.mustHaveStatus)
      if (!hasStatus) return false
    }

    if (criteria.mustNotHaveStatus) {
      const hasStatus = card.statuses?.some(s => s.type === criteria.mustNotHaveStatus)
      if (hasStatus) return false
    }

    // Check adjacency
    if (criteria.mustBeAdjacent && sourceCoords) {
      const dist = Math.abs(row - sourceCoords.row) + Math.abs(col - sourceCoords.col)
      if (dist > 1) return false
    }

    // Check power requirements
    const cardPower = (card.power || 0) + (card.powerModifier || 0) + (card.bonusPower || 0)
    if (criteria.minPower !== undefined && cardPower < criteria.minPower) {
      return false
    }
    if (criteria.maxPower !== undefined && cardPower > criteria.maxPower) {
      return false
    }
    if (criteria.preferredPowerRange) {
      const [min, max] = criteria.preferredPowerRange
      if (cardPower < min || cardPower > max) {
        return false
      }
    }

    return true
  }

  /**
   * Evaluate a target's value
   */
  private evaluateTarget(
    card: Card,
    row: number,
    col: number,
    criteria: TargetCriteria
  ): number {
    let score = 50 // Base score

    const cardPower = (card.power || 0) + (card.powerModifier || 0) + (card.bonusPower || 0)
    const cardDef = getCardDefinition(card.baseId || card.id)

    // Power-based scoring
    score += cardPower * 5

    // Status bonuses
    if (card.statuses) {
      for (const status of card.statuses) {
        switch (status.type) {
          case 'Threat':
            score += 30 // High priority to remove threats
            break
          case 'Aim':
            score += 25
            break
          case 'Shield':
            score += 20
            break
          case 'Stun':
            score += 15
            break
          case 'Exploit':
            score += 20
            break
        }
      }
    }

    // Ability-based scoring
    if (cardDef && cardDef.ABILITIES) {
      for (const ability of cardDef.ABILITIES) {
        if (ability.action === 'CREATE_STACK') {
          const tokenType = ability.details?.tokenType
          if (tokenType === 'Threat') score += 25
          if (tokenType === 'Aim') score += 20
        }
        if (ability.action === 'DESTROY') {
          score += 35 // Dangerous card
        }
      }
    }

    // Positional scoring
    score += this.evaluatePosition(row, col)

    // Strategic value
    if (criteria.mustBeOpponent) {
      // Prefer high-value targets when damaging opponents
      score += cardPower * 3
    } else {
      // When targeting own cards, prefer those that can benefit most
      score += cardPower * 2
    }

    // Check if target is about to complete a line
    if (this.wouldCompleteLine(row, col, card.ownerId)) {
      score += 40
    }

    return score
  }

  /**
   * Evaluate positional value
   */
  private evaluatePosition(row: number, col: number): number {
    let score = 0
    const { board, activeGridSize } = this.gameState

    // Center control is valuable
    const center = activeGridSize / 2
    const distFromCenter = Math.abs(row - center) + Math.abs(col - center)
    score += (activeGridSize - distFromCenter) * 2

    // Count friendly cards in same row/col
    let rowFriendly = 0
    let colFriendly = 0
    for (let i = 0; i < activeGridSize; i++) {
      if (board[row]?.[i]?.card?.ownerId === this.playerId) rowFriendly++
      if (board[i]?.[col]?.card?.ownerId === this.playerId) colFriendly++
    }
    score += rowFriendly * 5 + colFriendly * 5

    return score
  }

  /**
   * Check if a position would complete a line
   */
  private wouldCompleteLine(row: number, col: number, ownerId: number): boolean {
    const { board, activeGridSize } = this.gameState

    // Check row
    let rowComplete = true
    for (let c = 0; c < activeGridSize; c++) {
      const cell = board[row]?.[c]
      if (!cell?.card || cell.card.ownerId !== ownerId) {
        if (c !== col) rowComplete = false
      }
    }
    if (rowComplete) return true

    // Check column
    let colComplete = true
    for (let r = 0; r < activeGridSize; r++) {
      const cell = board[r]?.[col]
      if (!cell?.card || cell.card.ownerId !== ownerId) {
        if (r !== row) colComplete = false
      }
    }
    if (colComplete) return true

    return false
  }

  /**
   * Get reason for target selection
   */
  private getTargetReason(card: Card, score: number): string {
    const reasons: string[] = []

    const cardPower = (card.power || 0) + (card.powerModifier || 0) + (card.bonusPower || 0)
    reasons.push(`${cardPower} power`)

    if (card.statuses) {
      for (const status of card.statuses) {
        reasons.push(status.type)
      }
    }

    if (score >= 100) reasons.push('critical target')
    else if (score >= 80) reasons.push('high value')
    else if (score >= 60) reasons.push('medium value')

    return reasons.join(', ')
  }
}
