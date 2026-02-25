/**
 * Phase Manager
 *
 * Core phase and turn management system for WebRTC P2P mode.
 * The host controls all phase transitions and broadcasts updates to guests.
 *
 * Phase flow:
 * 0. Preparation (invisible) -> Auto-draw + Round victory check -> Setup
 * 1. Setup -> Card played -> Main
 * 2. Main -> Next phase button -> Commit
 * 3. Commit -> Next phase button (no cards on board) -> Pass turn OR Next phase button -> Scoring
 * 4. Scoring -> Select line -> Score points -> Pass turn -> Preparation (next player)
 */

import type { GameState, Card } from '../../types'
import type {
  PhaseState,
  PhaseTransitionResult,
  PhaseSystemConfig,
  RoundEndInfo,
  ScoringLine,
  ScoringSelectionMode
} from './PhaseTypes'
import {
  GamePhase,
  getNextPlayer,
  getActivePlayerIds,
  shouldRoundEnd,
  determineRoundWinners,
  checkMatchOver,
  DEFAULT_PHASE_CONFIG,
  PhaseTransitionReason
} from './PhaseTypes'
import { logger } from '../../utils/logger'
// Import ready status system to update card ready statuses on turn change
import { updateReadyStatuses } from '@shared/abilities/index.js'
import { getCardAbilityInfo } from '../../utils/autoAbilities'

/**
 * Phase action request from a player
 */
export interface PhaseActionRequest {
  action: string
  playerId: number
  data?: any
}

/**
 * Callbacks for phase system events
 */
export interface PhaseSystemCallbacks {
  onPhaseChanged?: (result: PhaseTransitionResult) => void
  onRoundEnded?: (info: RoundEndInfo) => void
  onMatchEnded?: (winnerId: number | null) => void
  onScoringModeStarted?: (mode: ScoringSelectionMode) => void
  onScoringModeCompleted?: (playerId: number, line: ScoringLine, points: number) => void
  onCardDrawn?: (playerId: number, card: Card) => void
  onStateUpdateRequired?: (newState: GameState) => void
  onGuestShouldAutoDraw?: (playerId: number) => void  // NEW: Called when guest should auto-draw locally
}

/**
 * Phase Manager - Controls all phase transitions on the host
 */
export class PhaseManager {
  private state: GameState | null = null
  private config: PhaseSystemConfig
  private callbacks: PhaseSystemCallbacks

  // Scoring selection mode
  private scoringMode: ScoringSelectionMode = {
    isActive: false,
    activePlayerId: -1,
    validLines: [],
    selectedLine: null
  }

  // Track which players have auto-drawn in current turn (Preparation phase)
  private autoDrawnThisTurn: Set<number> = new Set()

  // Track players who auto-drew in the most recent Preparation phase
  // This is used by onStateUpdateRequired to detect who needs state broadcast
  private recentAutoDrawPlayers: Set<number> = new Set()

  constructor(
    config: Partial<PhaseSystemConfig> = {},
    callbacks: PhaseSystemCallbacks = {}
  ) {
    this.config = { ...DEFAULT_PHASE_CONFIG, ...config }
    this.callbacks = callbacks
  }

  /**
   * Set the game state
   */
  setState(state: GameState): void {
    this.state = state
    this.config.autoDrawEnabled = state.autoDrawEnabled ?? true
  }

  /**
   * Get current phase state
   */
  getPhaseState(): PhaseState {
    if (!this.state) {
      return {
        currentPhase: GamePhase.PREPARATION,
        activePlayerId: null,
        startingPlayerId: null,
        currentRound: 1,
        turnNumber: 1,
        isScoringStep: false,
        isRoundEndModalOpen: false,
        roundWinners: {},
        gameWinner: null,
        autoDrawEnabled: true,
      }
    }

    return {
      currentPhase: this.state.currentPhase as GamePhase,
      activePlayerId: this.state.activePlayerId,
      startingPlayerId: this.state.startingPlayerId,
      currentRound: this.state.currentRound,
      turnNumber: this.state.turnNumber,
      isScoringStep: this.state.isScoringStep || false,
      isRoundEndModalOpen: this.state.isRoundEndModalOpen || false,
      roundWinners: this.state.roundWinners || {},
      gameWinner: this.state.gameWinner || null,
      autoDrawEnabled: this.state.autoDrawEnabled ?? true,
    }
  }

  /**
   * Handle phase action from a player
   */
  handleAction(request: PhaseActionRequest): PhaseTransitionResult | null {
    if (!this.state) {
      logger.warn('[PhaseManager] No state, ignoring action')
      return null
    }

    const { action, playerId, data } = request

    // Verify it's this player's turn (unless they're controlling a dummy)
    const player = this.state.players.find(p => p.id === playerId)
    if (!player) {
      logger.warn(`[PhaseManager] Player ${playerId} not found`)
      return null
    }

    const isDummyAction = player.isDummy || this.state.players.find(p => p.id === this.state?.activePlayerId)?.isDummy
    if (this.state.activePlayerId !== playerId && !isDummyAction) {
      logger.warn(`[PhaseManager] Player ${playerId} tried to act but it's player ${this.state.activePlayerId}'s turn`)
      return null
    }

    // Handle different actions
    switch (action) {
      case 'NEXT_PHASE':
        return this.handleNextPhase(playerId)

      case 'PREVIOUS_PHASE':
        return this.handlePreviousPhase(playerId)

      case 'PASS_TURN':
        return this.handlePassTurn(playerId, data?.reason)

      case 'START_SCORING':
        return this.handleStartScoring(playerId)

      case 'SELECT_LINE':
        return this.handleSelectLine(playerId, data?.line)

      case 'ROUND_COMPLETE':
        return this.handleRoundComplete(playerId)

      case 'START_NEXT_ROUND':
        return this.handleStartNextRound(playerId)

      case 'START_NEW_MATCH':
        return this.handleStartNewMatch(playerId)

      case 'SET_PHASE':
        return this.handleSetPhase(playerId, data?.phase)

      default:
        logger.warn(`[PhaseManager] Unknown action: ${action}`)
        return null
    }
  }

  /**
   * Start the game - transition from lobby to first player's Preparation phase
   * NEW APPROACH: All players draw 6 cards (+1 for starting player) in Preparation phase
   */
  startGame(startingPlayerId: number): PhaseTransitionResult {
    if (!this.state) {
      throw new Error('[PhaseManager] Cannot start game without state')
    }

    logger.info(`[PhaseManager] Starting game with player ${startingPlayerId}`)

    const oldPhase = this.state.currentPhase as GamePhase
    const oldActivePlayer = this.state.activePlayerId

    // Update state
    this.state.isGameStarted = true
    this.state.isReadyCheckActive = false  // Close ready check when game starts
    this.state.currentPhase = GamePhase.PREPARATION
    this.state.activePlayerId = startingPlayerId
    this.state.startingPlayerId = startingPlayerId
    this.state.currentRound = 1
    this.state.turnNumber = 1

    // Clear auto-drawn tracking
    this.autoDrawnThisTurn.clear()
    this.recentAutoDrawPlayers.clear()

    // CRITICAL: Draw starting hands for ALL players (6 cards each, +1 for starting player)
    // This happens BEFORE phase transition so all states are synchronized
    logger.info(`[PhaseManager] Drawing starting hands for all players (startingPlayer=${startingPlayerId})`)
    for (const player of this.state.players) {
      if (!player.isDisconnected && player.deck && player.deck.length > 0) {
        const isStartingPlayer = player.id === startingPlayerId
        const cardsToDraw = Math.min(6, player.deck.length)

        // Draw 6 cards
        for (let i = 0; i < cardsToDraw; i++) {
          if (player.deck.length > 0) {
            const drawnCard = player.deck.shift()!
            player.hand.push(drawnCard)
          }
        }

        // If starting player, draw 7th card
        if (isStartingPlayer && player.deck.length > 0) {
          const seventhCard = player.deck.shift()!
          player.hand.push(seventhCard)
          logger.info(`[PhaseManager] Player ${player.id} (starting) drew ${player.hand.length} cards`)
        } else {
          logger.info(`[PhaseManager] Player ${player.id} drew ${player.hand.length} cards`)
        }

        // Update sizes
        player.handSize = player.hand.length
        player.deckSize = player.deck.length

        // Mark as auto-drawn for this turn
        this.autoDrawnThisTurn.add(player.id)
        this.recentAutoDrawPlayers.add(player.id)
      }
    }

    // Update ready statuses for all players
    for (const player of this.state.players) {
      updateReadyStatuses(
        { gameState: this.state, playerId: player.id },
        (card: Card) => getCardAbilityInfo(card)
      )
    }

    // Check round victory (should be false at game start)
    let prepResult: { roundEndInfo?: RoundEndInfo, newPhase: GamePhase }
    if (shouldRoundEnd(this.state.players, this.state.currentRound)) {
      const winners = determineRoundWinners(this.state.players)
      this.state.roundWinners[this.state.currentRound] = winners
      const matchCheck = checkMatchOver(this.state.roundWinners)
      const roundEndInfo: RoundEndInfo = {
        roundNumber: this.state.currentRound,
        winners,
        roundWinners: { ...this.state.roundWinners },
        isMatchOver: matchCheck.isOver,
        matchWinner: matchCheck.winner
      }
      this.state.isRoundEndModalOpen = true
      this.state.gameWinner = matchCheck.winner
      this.callbacks.onRoundEnded?.(roundEndInfo)
      if (matchCheck.isOver) {
        this.callbacks.onMatchEnded?.(matchCheck.winner)
      }
      prepResult = { roundEndInfo, newPhase: GamePhase.PREPARATION }
    } else {
      // Auto-transition to Setup
      this.state.currentPhase = GamePhase.SETUP
      prepResult = { newPhase: GamePhase.SETUP }
    }

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase: prepResult.newPhase,
      oldActivePlayer,
      newActivePlayer: startingPlayerId,
      reason: PhaseTransitionReason.GAME_STARTED,
      ...(prepResult.roundEndInfo ? { roundEndInfo: prepResult.roundEndInfo } : {})
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Handle next phase button
   */
  private handleNextPhase(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    const currentPhase = this.state.currentPhase as GamePhase

    // If in Commit phase with no cards on board, auto-pass turn
    if (currentPhase === GamePhase.COMMIT) {
      const hasCardsOnBoard = this.hasPlayerCardsOnBoard(playerId)
      if (!hasCardsOnBoard) {
        return this.passTurnToNextPlayer('no_cards_on_board')
      }
    }

    // Transition to next phase
    return this.transitionToNextPhase(playerId)
  }

  /**
   * Handle previous phase button
   */
  private handlePreviousPhase(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    const currentPhase = this.state.currentPhase as GamePhase

    // Can't go back from Preparation or Setup
    if (currentPhase <= GamePhase.SETUP) {
      return null
    }

    // Go back one phase
    const newPhase = currentPhase - 1 as GamePhase
    return this.setPhase(newPhase, playerId, PhaseTransitionReason.PREVIOUS_PHASE)
  }

  /**
   * Handle pass turn request
   * Note: playerId is the requester. For guests, only active player can request.
   * For host, host can pass turn on behalf of any player (when guest sends REQUEST_PASS_TURN).
   */
  private handlePassTurn(playerId: number, reason?: string): PhaseTransitionResult | null {
    if (!this.state) return null

    // Can only pass turn from Commit or Scoring
    const currentPhase = this.state.currentPhase as GamePhase
    if (currentPhase !== GamePhase.COMMIT && currentPhase !== GamePhase.SCORING) {
      logger.warn(`[PhaseManager] Cannot pass turn from phase ${currentPhase}`)
      return null
    }

    // If the requester is not the active player, this might be a host acting on behalf of a guest
    // Allow it but log a warning
    if (playerId !== this.state.activePlayerId) {
      logger.warn(`[PhaseManager] Player ${playerId} requesting pass turn but active player is ${this.state.activePlayerId}. Allowing for host proxy.`)
    }

    return this.passTurnToNextPlayer(reason || 'manual')
  }

  /**
   * Handle start scoring (entering Scoring phase)
   */
  private handleStartScoring(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    // Must be in Commit phase to start scoring
    const currentPhase = this.state.currentPhase as GamePhase
    if (currentPhase !== GamePhase.COMMIT) {
      logger.warn(`[PhaseManager] Cannot start scoring from phase ${currentPhase}`)
      return null
    }

    // Transition to Scoring phase
    const oldPhase = currentPhase
    const oldActivePlayer = this.state.activePlayerId

    this.state.currentPhase = GamePhase.SCORING
    this.state.isScoringStep = true

    // Calculate valid scoring lines
    const validLines = this.calculateScoringLines(playerId)

    // Activate scoring mode
    this.scoringMode = {
      isActive: true,
      activePlayerId: playerId,
      validLines,
      selectedLine: null
    }

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase: GamePhase.SCORING,
      oldActivePlayer,
      newActivePlayer: playerId,
      reason: PhaseTransitionReason.NEXT_PHASE,
      scoringStarted: true
    }

    this.notifyPhaseChange(result)
    this.callbacks.onScoringModeStarted?.(this.scoringMode)

    return result
  }

  /**
   * Handle line selection in scoring mode
   */
  private handleSelectLine(playerId: number, line: ScoringLine | null): PhaseTransitionResult | null {
    if (!this.state) return null
    if (!this.scoringMode.isActive) {
      logger.warn('[PhaseManager] No active scoring mode')
      return null
    }
    if (this.scoringMode.activePlayerId !== playerId) {
      logger.warn(`[PhaseManager] Player ${playerId} not the active scoring player`)
      return null
    }
    if (!line) {
      logger.warn('[PhaseManager] No line selected')
      return null
    }

    // Calculate points from this line
    const points = this.calculateLinePoints(line)

    // Add points to player
    const player = this.state.players.find(p => p.id === playerId)
    if (player) {
      player.score += points
    }

    // Clear scoring mode
    this.scoringMode.isActive = false
    this.state.isScoringStep = false

    // Notify callback
    this.callbacks.onScoringModeCompleted?.(playerId, line, points)

    // Pass turn to next player
    return this.passTurnToNextPlayer('scoring_complete')
  }

  /**
   * Handle round complete (after round end modal)
   */
  private handleRoundComplete(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    // Only host/active player can confirm round end
    if (this.state.activePlayerId !== playerId) {
      return null
    }

    this.state.isRoundEndModalOpen = false

    // Check if match is over
    const matchCheck = checkMatchOver(this.state.roundWinners)
    if (matchCheck.isOver) {
      this.state.gameWinner = matchCheck.winner
      this.callbacks.onMatchEnded?.(matchCheck.winner)
    }

    return null
  }

  /**
   * Handle start next round (after round end)
   */
  private handleStartNextRound(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    // Only active player can start next round
    if (this.state.activePlayerId !== playerId) {
      return null
    }

    // Reset for next round
    this.state.currentRound += 1
    this.state.turnNumber += 1
    this.state.currentPhase = GamePhase.PREPARATION
    this.state.isScoringStep = false

    // Reset all player scores
    this.state.players.forEach(p => {
      p.score = 0
    })

    // Same starting player continues
    const nextPlayerId = this.state.startingPlayerId || playerId
    this.state.activePlayerId = nextPlayerId

    // Clear auto-drawn tracking
    this.autoDrawnThisTurn.clear()

    // Execute Preparation phase
    const prepResult = this.executePreparationPhase(nextPlayerId)

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase: GamePhase.SCORING,
      newPhase: prepResult.newPhase,
      oldActivePlayer: playerId,
      newActivePlayer: nextPlayerId,
      reason: PhaseTransitionReason.GAME_STARTED,
      ...(prepResult.roundEndInfo ? { roundEndInfo: prepResult.roundEndInfo } : {})
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Handle start new match (after game over)
   */
  private handleStartNewMatch(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    // Reset match state
    this.state.currentRound = 1
    this.state.turnNumber = 1
    this.state.currentPhase = GamePhase.PREPARATION
    this.state.isScoringStep = false
    this.state.roundWinners = {}
    this.state.gameWinner = null
    this.state.isRoundEndModalOpen = false

    // Reset all player scores
    this.state.players.forEach(p => {
      p.score = 0
    })

    // Clear board
    const gridSize = this.state.activeGridSize || 4
    this.state.board = Array(gridSize).fill(null).map(() =>
      Array(gridSize).fill(null).map(() => ({ card: null }))
    )

    // Random new starting player
    const activePlayers = getActivePlayerIds(this.state.players)
    const randomIndex = Math.floor(Math.random() * activePlayers.length)
    const newStartingPlayerId = activePlayers[randomIndex]

    this.state.activePlayerId = newStartingPlayerId
    this.state.startingPlayerId = newStartingPlayerId

    // Clear auto-drawn tracking
    this.autoDrawnThisTurn.clear()

    // Execute Preparation phase
    const prepResult = this.executePreparationPhase(newStartingPlayerId)

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase: GamePhase.SCORING,
      newPhase: prepResult.newPhase,
      oldActivePlayer: playerId,
      newActivePlayer: newStartingPlayerId,
      reason: PhaseTransitionReason.GAME_STARTED,
      ...(prepResult.roundEndInfo ? { roundEndInfo: prepResult.roundEndInfo } : {})
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Handle direct phase set (when clicking on phase names in tracker)
   * Allows jumping to any phase directly
   */
  private handleSetPhase(playerId: number, targetPhase?: number): PhaseTransitionResult | null {
    if (!this.state) return null

    const oldPhase = this.state.currentPhase as GamePhase
    const oldActivePlayer = this.state.activePlayerId

    // If no target phase specified, or same as current, do nothing
    if (targetPhase === undefined || targetPhase === oldPhase) {
      return null
    }

    // Validate target phase
    if (targetPhase < 0 || targetPhase > 4) {
      logger.warn(`[PhaseManager] Invalid target phase: ${targetPhase}`)
      return null
    }

    // Special handling for scoring phase
    if (targetPhase === 4) {
      // Scoring phase - must be in Commit phase
      if (oldPhase !== GamePhase.COMMIT) {
        logger.warn(`[PhaseManager] Cannot jump to scoring from phase ${oldPhase}`)
        return null
      }
      return this.handleStartScoring(playerId)
    }

    // For other phases, just set directly
    this.state.currentPhase = targetPhase as GamePhase

    // If jumping to Preparation, also execute Preparation phase logic
    if (targetPhase === 0) {
      this.autoDrawnThisTurn.clear()
      const prepResult = this.executePreparationPhase(playerId)

      const result: PhaseTransitionResult = {
        success: true,
        oldPhase,
        newPhase: prepResult.newPhase,
        oldActivePlayer,
        newActivePlayer: this.state.activePlayerId,
        reason: PhaseTransitionReason.PHASE_SET,
        ...(prepResult.roundEndInfo ? { roundEndInfo: prepResult.roundEndInfo } : {})
      }

      this.notifyPhaseChange(result)
      return result
    }

    // Direct phase change
    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase: targetPhase as GamePhase,
      oldActivePlayer,
      newActivePlayer: this.state.activePlayerId,
      reason: PhaseTransitionReason.PHASE_SET
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Transition to next phase
   */
  private transitionToNextPhase(playerId: number): PhaseTransitionResult | null {
    if (!this.state) return null

    const currentPhase = this.state.currentPhase as GamePhase

    // Scoring phase: pass turn to next player (who will start in Preparation phase)
    if (currentPhase === GamePhase.SCORING) {
      logger.info(`[PhaseManager] transitionToNextPhase: In SCORING phase, passing turn to next player`)
      return this.passTurnToNextPlayer('next_phase_from_scoring')
    }

    // Commit -> Scoring (or pass turn if no cards)
    if (currentPhase === GamePhase.COMMIT) {
      return this.handleStartScoring(playerId)
    }

    // Otherwise just increment phase
    const nextPhase = (currentPhase + 1) as GamePhase

    // Main -> Commit is just phase change
    // Setup -> Main happens when card is played
    // Preparation -> Setup happens automatically after prep actions
    return this.setPhase(nextPhase, playerId, PhaseTransitionReason.NEXT_PHASE)
  }

  /**
   * Set specific phase
   */
  private setPhase(
    newPhase: GamePhase,
    activePlayerId: number | null,
    reason: PhaseTransitionReason
  ): PhaseTransitionResult {
    if (!this.state) {
      throw new Error('[PhaseManager] No state')
    }

    const oldPhase = this.state.currentPhase as GamePhase
    const oldActivePlayer = this.state.activePlayerId

    this.state.currentPhase = newPhase

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase,
      oldActivePlayer,
      newActivePlayer: activePlayerId,
      reason
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Pass turn to next player in order
   */
  private passTurnToNextPlayer(reason: string): PhaseTransitionResult {
    logger.info(`[PhaseManager] passTurnToNextPlayer called: reason=${reason}, currentPhase=${this.state?.currentPhase}, activePlayer=${this.state?.activePlayerId}`)

    if (!this.state) {
      throw new Error('[PhaseManager] No state')
    }

    const oldActivePlayer = this.state.activePlayerId
    const oldPhase = this.state.currentPhase as GamePhase

    // Get next player
    const activePlayerIds = getActivePlayerIds(this.state.players)
    if (activePlayerIds.length === 0) {
      logger.warn('[PhaseManager] No active players to pass turn to')
      throw new Error('[PhaseManager] No active players')
    }

    const nextPlayerId = getNextPlayer(oldActivePlayer || 1, activePlayerIds)
    logger.info(`[PhaseManager] Passing turn: player ${oldActivePlayer} -> ${nextPlayerId}, phase ${oldPhase} -> PREPARATION`)

    // Check if we've completed a full orbit (back to starting player)
    if (nextPlayerId === this.state.startingPlayerId) {
      this.state.turnNumber += 1
    }

    // Set new active player
    this.state.activePlayerId = nextPlayerId
    this.state.currentPhase = GamePhase.PREPARATION
    this.state.isScoringStep = false

    // Clear auto-drawn tracking
    this.autoDrawnThisTurn.clear()

    // Execute Preparation phase for new player
    const prepResult = this.executePreparationPhase(nextPlayerId)

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase: prepResult.newPhase,
      oldActivePlayer,
      newActivePlayer: nextPlayerId,
      reason: PhaseTransitionReason.TURN_STARTED,
      ...(prepResult.roundEndInfo ? { roundEndInfo: prepResult.roundEndInfo } : {})
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Execute Preparation phase actions
   * - Auto-draw card if enabled
   * - Check round victory
   * - Returns whether phase should stay in Preparation or can proceed to Setup
   *
   * CRITICAL: For guests, auto-draw happens LOCALLY on guest's machine.
   * Host only performs auto-draw for itself (local player).
   * Guests will draw locally and send updated hand/deck to host via STATE_UPDATE_COMPACT.
   *
   * NEW: Phase stays in PREPARATION until guest completes auto-draw.
   * Host automatically transitions to Setup after host's auto-draw completes.
   *
   * @param playerId - The active player
   * @param skipAllAutoDraw - If true, skip ALL auto-draw (host and guests). Used at game start
   *                         because all players draw their own cards via GAME_STARTING message.
   */
  private executePreparationPhase(playerId: number, skipAllAutoDraw: boolean = false): {
    roundEndInfo?: RoundEndInfo
    newPhase: GamePhase
    guestShouldAutoDraw: boolean  // NEW: Indicates to host system that guest should be notified
    waitForGuest: boolean  // NEW: If true, stay in Preparation and wait for guest to complete auto-draw
  } {
    if (!this.state) {
      return { newPhase: GamePhase.SETUP, guestShouldAutoDraw: false, waitForGuest: false }
    }

    // CRITICAL: Update ready statuses for the new active player
    // This ensures cards gain their phase-specific ready statuses (readySetup/readyCommit)
    // when it becomes their turn
    updateReadyStatuses(
      { gameState: this.state, playerId },
      (card: Card) => getCardAbilityInfo(card)
    )
    logger.debug(`[PhaseManager] Updated ready statuses for player ${playerId} in Preparation phase`)

    // 1. Auto-draw if enabled and hasn't drawn yet this turn
    // IMPORTANT: Only perform auto-draw locally for the host (localPlayerId)
    // For guests, we signal that they should auto-draw locally via guestShouldAutoDraw flag
    // Guests will receive this via phase transition and auto-draw on their machine
    const isLocalPlayer = playerId === this.config.localPlayerId
    const guestShouldAutoDraw = this.config.autoDrawEnabled && !this.autoDrawnThisTurn.has(playerId) && !isLocalPlayer

    logger.info(`[PhaseManager] executePreparationPhase START: playerId=${playerId}, localPlayerId=${this.config.localPlayerId}, isLocalPlayer=${isLocalPlayer}, autoDrawEnabled=${this.config.autoDrawEnabled}, alreadyDrawn=${this.autoDrawnThisTurn.has(playerId)}, skipAllAutoDraw=${skipAllAutoDraw}`)

    // Clear recent auto-draw tracking at the start of each Preparation phase
    this.recentAutoDrawPlayers.clear()

    // NEW APPROACH: At game start, skip ALL auto-draw because everyone draws their own cards
    if (skipAllAutoDraw) {
      logger.info(`[PhaseManager] Skipping ALL auto-draw for player ${playerId} (skipAllAutoDraw=true at game start)`)
      this.autoDrawnThisTurn.add(playerId)  // Mark as drawn so next turn works correctly
      logger.info(`[PhaseManager] SKIP PATH: going to auto-transition check`)
    } else if (this.config.autoDrawEnabled && !this.autoDrawnThisTurn.has(playerId)) {
      if (isLocalPlayer) {
        // Host draws locally
        this.performAutoDraw(playerId)
        this.recentAutoDrawPlayers.add(playerId)  // Mark for state broadcast
        logger.info(`[PhaseManager] HOST AUTO-DRAW PATH: Host auto-drew for player ${playerId} (local player), going to auto-transition check`)
      } else {
        // Signal to host system that guest should auto-draw locally
        // The host will send a message to the guest to trigger local auto-draw
        // STAY IN PREPARATION and wait for guest to complete
        logger.info(`[PhaseManager] GUEST AUTO-DRAW PATH: About to call onGuestShouldAutoDraw for player ${playerId}`)
        this.callbacks.onGuestShouldAutoDraw?.(playerId)
        logger.info(`[PhaseManager] GUEST AUTO-DRAW PATH: Signaled guest ${playerId} to auto-draw locally`)
        this.autoDrawnThisTurn.add(playerId)
        // Return early - stay in Preparation and wait for guest
        logger.info(`[PhaseManager] GUEST AUTO-DRAW PATH: Returning PREPARATION phase, waiting for guest`)
        return { newPhase: GamePhase.PREPARATION, guestShouldAutoDraw: true, waitForGuest: true }
      }
      this.autoDrawnThisTurn.add(playerId)
    } else {
      logger.info(`[PhaseManager] NO AUTO-DRAW PATH: autoDrawEnabled=${this.config.autoDrawEnabled}, alreadyDrawn=${this.autoDrawnThisTurn.has(playerId)}, going to auto-transition check`)
    }

    // 2. Check round victory
    if (shouldRoundEnd(this.state.players, this.state.currentRound)) {
      const winners = determineRoundWinners(this.state.players)

      // Update round winners
      this.state.roundWinners[this.state.currentRound] = winners

      // Check match victory
      const matchCheck = checkMatchOver(this.state.roundWinners)

      const roundEndInfo: RoundEndInfo = {
        roundNumber: this.state.currentRound,
        winners,
        roundWinners: { ...this.state.roundWinners },
        isMatchOver: matchCheck.isOver,
        matchWinner: matchCheck.winner
      }

      // Open round end modal
      this.state.isRoundEndModalOpen = true
      this.state.gameWinner = matchCheck.winner

      // Notify callbacks
      this.callbacks.onRoundEnded?.(roundEndInfo)
      if (matchCheck.isOver) {
        this.callbacks.onMatchEnded?.(matchCheck.winner)
      }

      // Stay in Preparation (modal open)
      return { roundEndInfo, newPhase: GamePhase.PREPARATION, guestShouldAutoDraw: false, waitForGuest: false }
    }

    // 3. Auto-transition to Setup (only if not waiting for guest)
    logger.info(`[PhaseManager] AUTO-TRANSITION PATH: Transitioning to Setup, newPhase=SETUP`)
    this.state.currentPhase = GamePhase.SETUP
    return { newPhase: GamePhase.SETUP, guestShouldAutoDraw, waitForGuest: false }
  }

  /**
   * Perform auto-draw for a player
   */
  private performAutoDraw(playerId: number): void {
    if (!this.state) return

    const player = this.state.players.find(p => p.id === playerId)
    if (!player || !player.deck || player.deck.length === 0) {
      return
    }

    // Draw top card
    const drawnCard = player.deck.shift()
    if (drawnCard) {
      player.hand.push(drawnCard)
      player.deckSize = player.deck.length
      player.handSize = player.hand.length

      this.callbacks.onCardDrawn?.(playerId, drawnCard)
      logger.info(`[PhaseManager] Auto-drew card for player ${playerId}`)
    }
  }

  /**
   * Mark player as having drawn (called when guest sends AUTO_DRAW_COMPLETED)
   * This prevents host from drawing again for the same player
   */
  markPlayerAsDrawn(playerId: number): void {
    this.autoDrawnThisTurn.add(playerId)
    logger.debug(`[PhaseManager] Marked player ${playerId} as drawn`)
  }

  /**
   * Complete guest auto-draw and transition to Setup
   * Called when guest completes their local auto-draw
   */
  completeGuestAutoDraw(playerId: number): PhaseTransitionResult | null {
    if (!this.state) {
      logger.warn('[PhaseManager] No state in completeGuestAutoDraw')
      return null
    }

    // Verify we're in Preparation phase for this player
    if (this.state.currentPhase !== GamePhase.PREPARATION) {
      logger.warn(`[PhaseManager] Not in Preparation phase, current phase is ${this.state.currentPhase}`)
      return null
    }

    if (this.state.activePlayerId !== playerId) {
      logger.warn(`[PhaseManager] Guest ${playerId} is not the active player (${this.state.activePlayerId})`)
      return null
    }

    logger.info(`[PhaseManager] completeGuestAutoDraw: Guest ${playerId} completed auto-draw, transitioning to Setup`)
    logger.info(`[PhaseManager] completeGuestAutoDraw: Current state - phase=${this.state.currentPhase}, activePlayer=${this.state.activePlayerId}`)

    // Check round victory before transitioning
    if (shouldRoundEnd(this.state.players, this.state.currentRound)) {
      const winners = determineRoundWinners(this.state.players)
      this.state.roundWinners[this.state.currentRound] = winners
      const matchCheck = checkMatchOver(this.state.roundWinners)

      const roundEndInfo: RoundEndInfo = {
        roundNumber: this.state.currentRound,
        winners,
        roundWinners: { ...this.state.roundWinners },
        isMatchOver: matchCheck.isOver,
        matchWinner: matchCheck.winner
      }

      this.state.isRoundEndModalOpen = true
      this.state.gameWinner = matchCheck.winner

      this.callbacks.onRoundEnded?.(roundEndInfo)
      if (matchCheck.isOver) {
        this.callbacks.onMatchEnded?.(matchCheck.winner)
      }

      // Stay in Preparation (modal open)
      const result: PhaseTransitionResult = {
        success: true,
        oldPhase: GamePhase.PREPARATION,
        newPhase: GamePhase.PREPARATION,
        oldActivePlayer: playerId,
        newActivePlayer: playerId,
        reason: PhaseTransitionReason.TURN_STARTED,
        roundEndInfo
      }
      this.notifyPhaseChange(result)
      return result
    }

    // Transition to Setup
    const oldPhase = this.state.currentPhase
    this.state.currentPhase = GamePhase.SETUP

    const result: PhaseTransitionResult = {
      success: true,
      oldPhase,
      newPhase: GamePhase.SETUP,
      oldActivePlayer: playerId,
      newActivePlayer: playerId,
      reason: PhaseTransitionReason.NEXT_PHASE
    }

    this.notifyPhaseChange(result)
    return result
  }

  /**
   * Get players who auto-drew in the most recent Preparation phase
   * Returns a copy of the set to avoid external modification
   */
  getRecentAutoDrawPlayers(): Set<number> {
    return new Set(this.recentAutoDrawPlayers)
  }

  /**
   * Clear recent auto-draw players tracking
   */
  clearRecentAutoDrawPlayers(): void {
    this.recentAutoDrawPlayers.clear()
  }

  /**
   * Complete scoring step and pass turn to next player
   * Called when a player selects a scoring line in Scoring phase
   */
  completeScoringStep(playerId: number, scoringData?: any): PhaseTransitionResult | null {
    if (!this.state) {
      logger.warn('[PhaseManager] No state in completeScoringStep')
      return null
    }

    // Verify we're in Scoring phase and scoring step is active
    if (this.state.currentPhase !== GamePhase.SCORING) {
      logger.warn(`[PhaseManager] Not in Scoring phase, current phase is ${this.state.currentPhase}`)
      return null
    }

    if (!this.state.isScoringStep) {
      logger.warn('[PhaseManager] Not in scoring step')
      return null
    }

    if (this.state.activePlayerId !== playerId) {
      logger.warn(`[PhaseManager] Player ${playerId} is not the active player (${this.state.activePlayerId})`)
      return null
    }

    logger.info(`[PhaseManager] completeScoringStep: Player ${playerId} completed scoring, passing turn`)

    // Clear scoring step
    this.state.isScoringStep = false

    // Pass turn to next player (who will start in Preparation phase)
    return this.passTurnToNextPlayer('scoring_complete')
  }

  /**
   * Calculate valid scoring lines for a player
   */
  private calculateScoringLines(playerId: number): ScoringLine[] {
    const lines: ScoringLine[] = []
    if (!this.state) return lines

    const board = this.state.board
    const size = board.length

    // Find all cells with player's "last played" cards
    const playerCells: Array<{ row: number; col: number; card: Card }> = []

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const cell = board[row]?.[col]
        const card = cell?.card
        if (card && card.ownerId === playerId) {
          // Check if this is the last played card (in boardHistory)
          const player = this.state.players.find(p => p.id === playerId)
          const boardHistory = player?.boardHistory
          if (boardHistory && boardHistory.length > 0) {
            const lastCardId = boardHistory[boardHistory.length - 1]
            if (card.id === lastCardId) {
              playerCells.push({ row, col, card })
            }
          }
        }
      }
    }

    // If no last played cards, can't score
    if (playerCells.length === 0) {
      return lines
    }

    // For each cell with player's last played card, find valid lines
    for (const { row, col } of playerCells) {
      // Row
      const rowCells: Array<{ row: number; col: number }> = []
      for (let c = 0; c < size; c++) {
        rowCells.push({ row, col: c })
      }
      const rowLine: ScoringLine = {
        type: 'row',
        index: row,
        cells: rowCells,
        scoringPlayerId: playerId,
        potentialPoints: this.calculateLinePoints({ type: 'row', index: row, cells: rowCells, scoringPlayerId: playerId })
      }
      if (rowLine.potentialPoints > 0 && !lines.some(l => l.type === 'row' && l.index === row)) {
        lines.push(rowLine)
      }

      // Column
      const colCells: Array<{ row: number; col: number }> = []
      for (let r = 0; r < size; r++) {
        colCells.push({ row: r, col })
      }
      const colLine: ScoringLine = {
        type: 'col',
        index: col,
        cells: colCells,
        scoringPlayerId: playerId,
        potentialPoints: this.calculateLinePoints({ type: 'col', index: col, cells: colCells, scoringPlayerId: playerId })
      }
      if (colLine.potentialPoints > 0 && !lines.some(l => l.type === 'col' && l.index === col)) {
        lines.push(colLine)
      }

      // Diagonal (if on main diagonal)
      if (row === col) {
        const diagCells: Array<{ row: number; col: number }> = []
        for (let i = 0; i < size; i++) {
          diagCells.push({ row: i, col: i })
        }
        const diagLine: ScoringLine = {
          type: 'diagonal',
          index: 0,
          cells: diagCells,
          scoringPlayerId: playerId,
          potentialPoints: this.calculateLinePoints({ type: 'diagonal', index: 0, cells: diagCells, scoringPlayerId: playerId })
        }
        if (diagLine.potentialPoints > 0 && !lines.some(l => l.type === 'diagonal')) {
          lines.push(diagLine)
        }
      }

      // Anti-diagonal (if on anti-diagonal)
      if (row + col === size - 1) {
        const antiDiagCells: Array<{ row: number; col: number }> = []
        for (let i = 0; i < size; i++) {
          antiDiagCells.push({ row: i, col: size - 1 - i })
        }
        const antiDiagLine: ScoringLine = {
          type: 'anti-diagonal',
          index: 0,
          cells: antiDiagCells,
          scoringPlayerId: playerId,
          potentialPoints: this.calculateLinePoints({ type: 'anti-diagonal', index: 0, cells: antiDiagCells, scoringPlayerId: playerId })
        }
        if (antiDiagLine.potentialPoints > 0 && !lines.some(l => l.type === 'anti-diagonal')) {
          lines.push(antiDiagLine)
        }
      }
    }

    return lines
  }

  /**
   * Calculate points from a scoring line
   */
  private calculateLinePoints(line: Omit<ScoringLine, 'potentialPoints'>): number {
    if (!this.state) return 0

    let points = 0
    const playerId = line.scoringPlayerId

    for (const { row, col } of line.cells) {
      const cell = this.state.board[row]?.[col]
      const card = cell?.card
      if (card && card.ownerId === playerId) {
        points += card.power + (card.powerModifier || 0)
      }
    }

    return points
  }

  /**
   * Check if player has cards on board
   */
  private hasPlayerCardsOnBoard(playerId: number): boolean {
    if (!this.state) return false

    for (const row of this.state.board) {
      for (const cell of row) {
        const card = cell?.card
        if (card && card.ownerId === playerId) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Get current scoring mode
   */
  getScoringMode(): ScoringSelectionMode {
    return this.scoringMode
  }

  /**
   * Check if player can perform an action
   */
  canPlayerAct(playerId: number): boolean {
    if (!this.state) return false

    // Active player can always act
    if (this.state.activePlayerId === playerId) {
      return true
    }

    // Anyone can act for dummy players
    const activePlayer = this.state.players.find(p => p.id === this.state?.activePlayerId)
    if (activePlayer?.isDummy) {
      return true
    }

    return false
  }

  /**
   * Notify phase change callbacks
   * Order matters: state update first, then phase change broadcast
   */
  private notifyPhaseChange(result: PhaseTransitionResult): void {
    // First: Update the state (this ensures stateManager has latest state)
    if (this.state && this.callbacks.onStateUpdateRequired) {
      this.callbacks.onStateUpdateRequired(this.state)
    }

    // Second: Broadcast phase transition (uses updated state from stateManager)
    this.callbacks.onPhaseChanged?.(result)
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PhaseSystemConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Update callbacks
   */
  updateCallbacks(callbacks: Partial<PhaseSystemCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * Reset manager state
   */
  reset(): void {
    this.scoringMode = {
      isActive: false,
      activePlayerId: -1,
      validLines: [],
      selectedLine: null
    }
    this.autoDrawnThisTurn.clear()
  }
}

export default PhaseManager
