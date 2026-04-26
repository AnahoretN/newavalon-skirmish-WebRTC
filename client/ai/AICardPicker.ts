/**
 * AI Card Picker
 *
 * Selects which cards to play and in what order.
 * Considers:
 * - Card type (unit vs command)
 * - Card power and abilities
 * - Board situation
 * - Strategic value
 * - Resource management (don't waste strong cards unnecessarily)
 */

import type { GameState, Card } from '../types'
import type { AIExecutionContext, BoardSituation } from './types'
import { getCardDefinition } from '../content'

/**
 * Card play decision
 */
export interface CardPlayDecision {
  card: Card
  row: number
  col: number
  faceUp: boolean
  playabilityScore: number
  reason: string
}

/**
 * AI Card Picker
 */
export class AICardPicker {
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
   * Select best card to play of a specific type
   */
  selectBestCardToPlay(
    cardType: 'unit' | 'command' | 'any',
    context: AIExecutionContext
  ): CardPlayDecision | null {
    const player = this.getPlayer()
    if (!player || player.hand.length === 0) return null

    // Get cards of requested type
    let cardsToConsider: Card[] = []

    if (cardType === 'unit') {
      cardsToConsider = this.getUnitCards(player.hand)
    } else if (cardType === 'command') {
      cardsToConsider = this.getCommandCards(player.hand)
    } else {
      cardsToConsider = player.hand
    }

    if (cardsToConsider.length === 0) return null

    // Evaluate each card
    const decisions: CardPlayDecision[] = []

    for (const card of cardsToConsider) {
      const decision = this.evaluateCardForPlay(card, context)
      if (decision) {
        decisions.push(decision)
      }
    }

    if (decisions.length === 0) return null

    // Sort by playability score and return best
    decisions.sort((a, b) => b.playabilityScore - a.playabilityScore)
    return decisions[0]
  }

  /**
   * Evaluate a card for playing
   */
  private evaluateCardForPlay(
    card: Card,
    context: AIExecutionContext
  ): CardPlayDecision | null {
    const { situation } = context
    const cardDef = getCardDefinition(card.baseId || card.id)
    if (!cardDef) return null

    // Find best placement
    const placement = this.findBestPlacement(card, situation)
    if (!placement) return null

    // Calculate playability score
    let score = 50 // Base score

    // Power contribution
    const cardPower = card.power || 0
    score += cardPower * 3

    // Ability value
    if (cardDef.ABILITIES) {
      for (const ability of cardDef.ABILITIES) {
        switch (ability.action) {
          case 'CREATE_STACK':
            const tokenType = ability.details?.tokenType
            if (tokenType === 'Threat') score += 20
            if (tokenType === 'Aim') score += 18
            if (tokenType === 'Shield') score += 15
            if (tokenType === 'Stun') score += 22
            if (tokenType === 'Exploit') score += 17
            break
          case 'DRAW':
            score += 25
            break
          case 'DESTROY':
            score += 30
            break
        }
      }
    }

    // Timing adjustments
    if (situation.isEmptyBoard && cardPower >= 3) {
      score += 15 // High power early is good
    }

    if (situation.opponentCardCount > situation.ownCardCount) {
      score += 10 // Behind, need to develop
    }

    if (situation.isLateGame && cardPower >= 4) {
      score += 20 // High power late game
    }

    // Resource conservation - don't waste strong cards when not needed
    if (cardPower >= 5 && situation.ownCardCount >= 4) {
      score -= 10 // Save strong cards for later
    }

    // Determine face-up/face-down
    // Face-up is generally better for AI to use abilities
    const faceUp = this.shouldPlayFaceUp(card, cardDef, situation)

    // Generate reason
    const reason = this.generatePlayReason(card, cardDef, placement, score)

    return {
      card,
      row: placement.row,
      col: placement.col,
      faceUp,
      playabilityScore: score,
      reason
    }
  }

  /**
   * Find best placement for a card
   */
  private findBestPlacement(
    card: Card,
    situation: BoardSituation
  ): { row: number; col: number } | null {
    const { board, activeGridSize } = this.gameState
    const placements: { row: number; col: number; score: number }[] = []

    for (let row = 0; row < activeGridSize; row++) {
      for (let col = 0; col < activeGridSize; col++) {
        if (board[row]?.[col]?.card) continue

        let score = 0

        // Count friendly cards in same row/col
        let rowFriendly = 0
        let colFriendly = 0
        let rowOpponent = 0
        let colOpponent = 0

        for (let i = 0; i < activeGridSize; i++) {
          const rowCell = board[row]?.[i]
          const colCell = board[i]?.[col]

          if (rowCell?.card?.ownerId === this.playerId) rowFriendly++
          else if (rowCell?.card) rowOpponent++

          if (colCell?.card?.ownerId === this.playerId) colFriendly++
          else if (colCell?.card) colOpponent++
        }

        // Prefer extending own lines
        score += rowFriendly * 10
        score += colFriendly * 10

        // Avoid helping opponent complete lines
        if (rowOpponent >= activeGridSize - 1) score -= 25
        if (colOpponent >= activeGridSize - 1) score -= 25

        // Center control
        const center = activeGridSize / 2
        const distFromCenter = Math.abs(row - center) + Math.abs(col - center)
        score += (activeGridSize - distFromCenter) * 2

        // Prefer positions that create scoring potential
        if (rowFriendly >= 1 || colFriendly >= 1) {
          score += 5
        }

        placements.push({ row, col, score })
      }
    }

    if (placements.length === 0) return null

    placements.sort((a, b) => b.score - a.score)
    return { row: placements[0].row, col: placements[0].col }
  }

  /**
   * Determine if card should be played face-up
   */
  private shouldPlayFaceUp(
    card: Card,
    cardDef: any,
    situation: BoardSituation
  ): boolean {
    // Generally play face-up to use abilities
    // Exception: might want face-down for bluff or to protect from destruction

    // Always face-up for now - AI benefits from using abilities
    return true
  }

  /**
   * Generate reason for playing card
   */
  private generatePlayReason(
    card: Card,
    cardDef: any,
    placement: { row: number; col: number },
    score: number
  ): string {
    const reasons: string[] = []

    const cardPower = card.power || 0
    reasons.push(`${cardPower} power`)

    if (cardDef.ABILITIES && cardDef.ABILITIES.length > 0) {
      reasons.push(`${cardDef.ABILITIES.length} abilities`)
    }

    if (score >= 80) reasons.push('excellent play')
    else if (score >= 65) reasons.push('good play')
    else if (score >= 50) reasons.push('decent play')

    return reasons.join(', ')
  }

  /**
   * Get unit cards from hand
   */
  private getUnitCards(hand: Card[]): Card[] {
    return hand.filter(card => {
      const cardDef = getCardDefinition(card.baseId || card.id)
      if (!cardDef) return false

      // Command cards have ● separated options
      return !!(cardDef.abilityText && !cardDef.abilityText.includes('●'))
    })
  }

  /**
   * Get command cards from hand
   */
  private getCommandCards(hand: Card[]): Card[] {
    return hand.filter(card => {
      const cardDef = getCardDefinition(card.baseId || card.id)
      if (!cardDef) return false

      // Command cards have ● separated options
      return !!(cardDef.abilityText && cardDef.abilityText.includes('●'))
    })
  }

  /**
   * Get player
   */
  private getPlayer(): ReturnType<typeof this.gameState.players.find> {
    return this.gameState.players.find(p => p.id === this.playerId)
  }
}
