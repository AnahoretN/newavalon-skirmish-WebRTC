/**
 * AI Phase Controller
 *
 * Manages AI behavior for each game phase according to the rules:
 *
 * SETUP PHASE:
 * - Determine order of ability activations
 * - Apply all abilities one by one
 * - For abilities with targets: select most important target and apply
 * - When all abilities applied OR no cards with unapplied setup abilities remain -> move to MAIN
 *
 * MAIN PHASE:
 * - MUST play 1 unit card if available
 * - Can play any number of command cards
 * - Can play: command -> unit -> command -> unit -> deploy ability, etc.
 * - When all available abilities applied -> move to COMMIT
 *
 * COMMIT PHASE:
 * - Determine order of ability activations
 * - Apply all abilities one by one with target selection
 * - When all abilities applied OR no cards with unapplied commit abilities remain -> move to SCORING
 *
 * SCORING PHASE:
 * - Select line that gives maximum points
 */

import type { GameState, Card, Player } from '../types'
import type { AIExecutionContext, BoardSituation, TargetEvaluation, AIActionCallbacks, PhaseExecutionResult } from './types'
import { getCardDefinition } from '../content'
import { AITargetSelector } from './AITargetSelector'
import { AICardPicker, CardPlayDecision } from './AICardPicker'

/**
 * Ability execution plan
 */
interface AbilityExecutionPlan {
  card: Card
  coords: { row: number; col: number }
  ability: any
  priority: number
  targets?: TargetEvaluation[]
  canExecute: boolean
}

/**
 * AI Phase Controller
 */
export class AIPhaseController {
  private gameState: GameState
  private playerId: number
  private targetSelector: AITargetSelector
  private cardPicker: AICardPicker
  private executedAbilities: Set<string> = new Set()
  private playedCards: Set<string> = new Set()

  constructor(gameState: GameState, playerId: number) {
    this.gameState = gameState
    this.playerId = playerId
    this.targetSelector = new AITargetSelector(gameState, playerId)
    this.cardPicker = new AICardPicker(gameState, playerId)
  }

  /**
   * Update game state
   */
  updateGameState(gameState: GameState): void {
    this.gameState = gameState
    this.targetSelector.updateGameState(gameState)
    this.cardPicker.updateGameState(gameState)
  }

  /**
   * Reset tracking for new turn
   */
  resetTurn(): void {
    this.executedAbilities.clear()
    this.playedCards.clear()
  }

  /**
   * Execute SETUP phase
   */
  async executeSetupPhase(
    context: AIExecutionContext,
    callbacks: AIActionCallbacks
  ): Promise<PhaseExecutionResult> {
    const player = this.getPlayer()
    if (!player) {
      return { success: false, action: 'no_player', description: 'Player not found' }
    }

    // Step 1: Get all cards with deploy abilities that haven't been executed
    const abilityPlans = this.getDeployAbilityPlans()

    if (abilityPlans.length > 0) {
      // Sort by priority and execute highest priority ability
      abilityPlans.sort((a, b) => b.priority - a.priority)
      const plan = abilityPlans[0]

      if (plan.canExecute && plan.targets && plan.targets.length > 0) {
        // Execute ability with best target
        await this.executeAbilityWithTarget(plan, callbacks)

        // Mark as executed
        const abilityKey = this.getAbilityKey(plan.card, plan.ability)
        this.executedAbilities.add(abilityKey)

        return {
          success: true,
          action: 'deploy_ability',
          description: `Applied ${plan.card.name} deploy ability`,
          shouldContinue: true
        }
      } else if (plan.canExecute) {
        // Execute ability without target
        await this.executeAbility(plan, callbacks)

        const abilityKey = this.getAbilityKey(plan.card, plan.ability)
        this.executedAbilities.add(abilityKey)

        return {
          success: true,
          action: 'deploy_ability',
          description: `Applied ${plan.card.name} deploy ability`,
          shouldContinue: true
        }
      }
    }

    // Step 2: No more deploy abilities to execute - check if we should move to MAIN
    // First, check if there are any cards on board with unexecuted deploy abilities
    const hasUnexecutedDeployAbilities = this.hasUnexecutedAbilities('deploy')

    if (!hasUnexecutedDeployAbilities) {
      // All deploy abilities done, move to MAIN
      return {
        success: true,
        action: 'move_to_main',
        description: 'Setup complete, moving to MAIN',
        nextPhase: 2
      }
    }

    // Still have abilities but none can execute now (no valid targets)
    // This is normal - move to MAIN phase
    return {
      success: true,
      action: 'move_to_main',
      description: 'No more executable deploy abilities',
      nextPhase: 2
    }
  }

  /**
   * Execute MAIN phase
   */
  async executeMainPhase(
    context: AIExecutionContext,
    callbacks: AIActionCallbacks
  ): Promise<PhaseExecutionResult> {
    const player = this.getPlayer()
    if (!player) {
      return { success: false, action: 'no_player', description: 'Player not found' }
    }

    // Step 1: Check for pending deploy abilities from newly played cards
    const abilityPlans = this.getDeployAbilityPlans()
    const unexecutedDeployPlans = abilityPlans.filter(
      plan => !this.executedAbilities.has(this.getAbilityKey(plan.card, plan.ability))
    )

    if (unexecutedDeployPlans.length > 0) {
      unexecutedDeployPlans.sort((a, b) => b.priority - a.priority)
      const plan = unexecutedDeployPlans[0]

      if (plan.canExecute) {
        if (plan.targets && plan.targets.length > 0) {
          await this.executeAbilityWithTarget(plan, callbacks)
        } else {
          await this.executeAbility(plan, callbacks)
        }

        this.executedAbilities.add(this.getAbilityKey(plan.card, plan.ability))
        return {
          success: true,
          action: 'deploy_ability',
          description: `Applied ${plan.card.name} deploy ability`,
          shouldContinue: true
        }
      }
    }

    // Step 2: Check if we MUST play a unit card (requirement: at least 1 unit if available)
    const hasNotPlayedUnitThisTurn = !this.hasPlayedUnitThisTurn()
    const unitCardsInHand = this.getUnitCardsInHand()

    if (hasNotPlayedUnitThisTurn && unitCardsInHand.length > 0) {
      // MUST play a unit - select best unit
      const cardDecision = this.cardPicker.selectBestCardToPlay('unit', context)

      if (cardDecision) {
        await this.playCardDecision(cardDecision, callbacks)
        this.playedCards.add(cardDecision.card.id)
        return {
          success: true,
          action: 'play_unit',
          description: `Played unit ${cardDecision.card.name}`,
          shouldContinue: true
        }
      }
    }

    // Step 3: Can play command cards if beneficial
    const commandCardsInHand = this.getCommandCardsInHand()
    if (commandCardsInHand.length > 0) {
      // Evaluate if playing a command is beneficial
      const cardDecision = this.cardPicker.selectBestCardToPlay('command', context)

      if (cardDecision && cardDecision.playabilityScore > 30) {
        await this.playCardDecision(cardDecision, callbacks)
        this.playedCards.add(cardDecision.card.id)
        return {
          success: true,
          action: 'play_command',
          description: `Played command ${cardDecision.card.name}`,
          shouldContinue: true
        }
      }
    }

    // Step 4: Check if there are more abilities to execute
    const hasUnexecutedAbilities = this.hasUnexecutedAbilities(null) // Check all abilities

    if (hasUnexecutedAbilities) {
      // Try to execute more abilities
      return await this.executeSetupPhase(context, callbacks) // Reuse deploy logic
    }

    // Step 5: All done, move to COMMIT
    return {
      success: true,
      action: 'move_to_commit',
      description: 'Main phase complete',
      nextPhase: 3
    }
  }

  /**
   * Execute COMMIT phase
   */
  async executeCommitPhase(
    context: AIExecutionContext,
    callbacks: AIActionCallbacks
  ): Promise<PhaseExecutionResult> {
    const player = this.getPlayer()
    if (!player) {
      return { success: false, action: 'no_player', description: 'Player not found' }
    }

    // Get all commit ability plans
    const abilityPlans = this.getCommitAbilityPlans()

    if (abilityPlans.length > 0) {
      abilityPlans.sort((a, b) => b.priority - a.priority)
      const plan = abilityPlans[0]

      if (plan.canExecute) {
        if (plan.targets && plan.targets.length > 0) {
          await this.executeAbilityWithTarget(plan, callbacks)
        } else {
          await this.executeAbility(plan, callbacks)
        }

        this.executedAbilities.add(this.getAbilityKey(plan.card, plan.ability))
        return {
          success: true,
          action: 'commit_ability',
          description: `Applied ${plan.card.name} commit ability`,
          shouldContinue: true
        }
      }
    }

    // No more commit abilities, move to SCORING
    return {
      success: true,
      action: 'move_to_scoring',
      description: 'Commit phase complete',
      nextPhase: 4
    }
  }

  /**
   * Execute SCORING phase
   */
  async executeScoringPhase(
    context: AIExecutionContext,
    callbacks: AIActionCallbacks
  ): Promise<PhaseExecutionResult> {
    // Find all completed lines and their point values
    const scoringLines = this.getCompletedLinesWithScores()

    if (scoringLines.length > 0) {
      // Sort by score descending and select best
      scoringLines.sort((a, b) => b.score - a.score)
      const bestLine = scoringLines[0]

      await callbacks.scoreLine(
        bestLine.r1, bestLine.c1,
        bestLine.r2, bestLine.c2,
        this.playerId
      )

      return {
        success: true,
        action: 'score_line',
        description: `Scored ${bestLine.type} line for ${bestLine.score} points`,
        shouldContinue: true
      }
    }

    // No completed lines - check if we should pass turn
    const player = this.getPlayer()
    if (player && player.hand.length === 0) {
      return {
        success: true,
        action: 'pass_turn',
        description: 'No cards and no lines, passing turn',
        shouldPassTurn: true
      }
    }

    // Wait for more actions
    return {
      success: true,
      action: 'wait',
      description: 'Waiting for lines to complete'
    }
  }

  /**
   * Get all deploy ability execution plans
   */
  private getDeployAbilityPlans(): AbilityExecutionPlan[] {
    return this.getAbilityPlans('deploy')
  }

  /**
   * Get all commit ability execution plans
   */
  private getCommitAbilityPlans(): AbilityExecutionPlan[] {
    return this.getAbilityPlans('commit')
  }

  /**
   * Get ability execution plans for a specific type
   */
  private getAbilityPlans(abilityType: string | null): AbilityExecutionPlan[] {
    const plans: AbilityExecutionPlan[] = []
    const { board, activeGridSize } = this.gameState

    for (let row = 0; row < activeGridSize; row++) {
      for (let col = 0; col < activeGridSize; col++) {
        const cell = board[row]?.[col]
        if (!cell?.card || cell.card.ownerId !== this.playerId) continue

        const cardDef = getCardDefinition(cell.card.baseId || cell.card.id)
        if (!cardDef || !cardDef.ABILITIES) continue

        for (const ability of cardDef.ABILITIES) {
          // Filter by ability type if specified
          if (abilityType && ability.type !== abilityType) continue

          const abilityKey = this.getAbilityKey(cell.card, ability)
          if (this.executedAbilities.has(abilityKey)) continue

          // Evaluate if this ability can be executed
          const targets = this.targetSelector.selectTargetsForAbility(
            ability,
            { row, col }
          )

          const canExecute = this.canExecuteAbility(ability, targets)

          plans.push({
            card: cell.card,
            coords: { row, col },
            ability,
            priority: this.calculateAbilityPriority(cell.card, ability, targets),
            targets,
            canExecute
          })
        }
      }
    }

    return plans
  }

  /**
   * Calculate priority for an ability
   */
  private calculateAbilityPriority(
    card: Card,
    ability: any,
    targets: TargetEvaluation[]
  ): number {
    let priority = 50 // Base priority

    // Higher priority for abilities with good targets
    if (targets.length > 0) {
      const bestTarget = targets[0]
      priority += bestTarget.score
    }

    // Higher priority for high-power cards
    priority += (card.power || 0) * 2

    // Adjust based on ability action type
    switch (ability.action) {
      case 'CREATE_STACK':
        const tokenType = ability.details?.tokenType
        if (tokenType === 'Stun') priority += 30
        if (tokenType === 'Aim') priority += 25
        if (tokenType === 'Exploit') priority += 20
        if (tokenType === 'Shield') priority += 15
        break
      case 'DESTROY':
        priority += 40
        break
      case 'DRAW':
        priority += 35
        break
    }

    return priority
  }

  /**
   * Check if an ability can be executed
   */
  private canExecuteAbility(ability: any, targets: TargetEvaluation[]): boolean {
    // If ability requires targets, check if we have valid targets
    if (ability.requiresTarget && targets.length === 0) {
      return false
    }

    return true
  }

  /**
   * Execute ability with target
   */
  private async executeAbilityWithTarget(
    plan: AbilityExecutionPlan,
    callbacks: AIActionCallbacks
  ): Promise<void> {
    const target = plan.targets![0]
    await callbacks.activateAbility(
      plan.card,
      plan.ability,
      plan.coords,
      target.coords
    )
  }

  /**
   * Execute ability without target
   */
  private async executeAbility(
    plan: AbilityExecutionPlan,
    callbacks: AIActionCallbacks
  ): Promise<void> {
    await callbacks.activateAbility(
      plan.card,
      plan.ability,
      plan.coords,
      null
    )
  }

  /**
   * Play a card based on decision
   */
  private async playCardDecision(
    decision: CardPlayDecision,
    callbacks: AIActionCallbacks
  ): Promise<void> {
    await callbacks.playCard(
      decision.card,
      decision.row,
      decision.col,
      this.playerId,
      decision.faceUp
    )
  }

  /**
   * Get completed lines with their scores
   */
  private getCompletedLinesWithScores(): Array<{
    type: string
    score: number
    r1: number
    c1: number
    r2: number
    c2: number
  }> {
    const lines: Array<{
      type: string
      score: number
      r1: number
      c1: number
      r2: number
      c2: number
    }> = []

    const { board, activeGridSize } = this.gameState

    // Check rows
    for (let row = 0; row < activeGridSize; row++) {
      let hasCard = true
      let score = 0

      for (let col = 0; col < activeGridSize; col++) {
        const cell = board[row]?.[col]
        if (!cell?.card) {
          hasCard = false
          break
        }
        if (cell.card.ownerId === this.playerId) {
          score += (cell.card.power || 0) +
                   (cell.card.powerModifier || 0) +
                   (cell.card.bonusPower || 0)
        }
      }

      if (hasCard) {
        lines.push({
          type: 'row',
          score,
          r1: row,
          c1: 0,
          r2: row,
          c2: activeGridSize - 1
        })
      }
    }

    // Check columns
    for (let col = 0; col < activeGridSize; col++) {
      let hasCard = true
      let score = 0

      for (let row = 0; row < activeGridSize; row++) {
        const cell = board[row]?.[col]
        if (!cell?.card) {
          hasCard = false
          break
        }
        if (cell.card.ownerId === this.playerId) {
          score += (cell.card.power || 0) +
                   (cell.card.powerModifier || 0) +
                   (cell.card.bonusPower || 0)
        }
      }

      if (hasCard) {
        lines.push({
          type: 'col',
          score,
          r1: 0,
          c1: col,
          r2: activeGridSize - 1,
          c2: col
        })
      }
    }

    return lines
  }

  /**
   * Check if there are unexecuted abilities
   */
  private hasUnexecutedAbilities(abilityType: string | null): boolean {
    const { board, activeGridSize } = this.gameState

    for (let row = 0; row < activeGridSize; row++) {
      for (let col = 0; col < activeGridSize; col++) {
        const cell = board[row]?.[col]
        if (!cell?.card || cell.card.ownerId !== this.playerId) continue

        const cardDef = getCardDefinition(cell.card.baseId || cell.card.id)
        if (!cardDef || !cardDef.ABILITIES) continue

        for (const ability of cardDef.ABILITIES) {
          if (abilityType && ability.type !== abilityType) continue

          const abilityKey = this.getAbilityKey(cell.card, ability)
          if (!this.executedAbilities.has(abilityKey)) {
            return true
          }
        }
      }
    }

    return false
  }

  /**
   * Check if player has played a unit this turn
   */
  private hasPlayedUnitThisTurn(): boolean {
    for (const cardId of this.playedCards) {
      const card = this.findCardById(cardId)
      if (card && this.isUnitCard(card)) {
        return true
      }
    }
    return false
  }

  /**
   * Get unit cards in hand
   */
  private getUnitCardsInHand(): Card[] {
    const player = this.getPlayer()
    if (!player) return []

    return player.hand.filter(card => this.isUnitCard(card))
  }

  /**
   * Get command cards in hand
   */
  private getCommandCardsInHand(): Card[] {
    const player = this.getPlayer()
    if (!player) return []

    return player.hand.filter(card => this.isCommandCard(card))
  }

  /**
   * Check if card is a unit
   */
  private isUnitCard(card: Card): boolean {
    const cardDef = getCardDefinition(card.baseId || card.id)
    if (!cardDef) return false

    // Command cards have command options
    if (cardDef.abilityText && cardDef.abilityText.includes('●')) {
      return false
    }

    return true
  }

  /**
   * Check if card is a command
   */
  private isCommandCard(card: Card): boolean {
    const cardDef = getCardDefinition(card.baseId || card.id)
    if (!cardDef) return false

    // Command cards have command options separated by ●
    return !!(cardDef.abilityText && cardDef.abilityText.includes('●'))
  }

  /**
   * Find card by ID in game state
   */
  private findCardById(cardId: string): Card | null {
    const { board, activeGridSize } = this.gameState
    const player = this.getPlayer()

    // Check hand
    if (player) {
      const handCard = player.hand.find(c => c.id === cardId)
      if (handCard) return handCard
    }

    // Check board
    for (let row = 0; row < activeGridSize; row++) {
      for (let col = 0; col < activeGridSize; col++) {
        const cell = board[row]?.[col]
        if (cell?.card?.id === cardId) {
          return cell.card
        }
      }
    }

    return null
  }

  /**
   * Get unique key for an ability
   */
  private getAbilityKey(card: Card, ability: any): string {
    return `${card.id}_${ability.type}_${ability.action || 'default'}`
  }

  /**
   * Get player
   */
  private getPlayer(): Player | undefined {
    return this.gameState.players.find(p => p.id === this.playerId)
  }
}

