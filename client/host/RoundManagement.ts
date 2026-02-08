/**
 * Round Management for Host P2P
 * Handles round victory detection, winner tracking, and round transitions
 * Ported from server/handlers/phaseManagement.ts
 */

import type { GameState } from '../types'
import { logger } from '../utils/logger'

export interface RoundWinners {
  [roundNumber: number]: number[]  // roundNumber -> [playerIds]
}

/**
 * Get victory threshold for a given round
 * Formula: 10 + (roundNumber * 10)
 * Round 1: 20 points, Round 2: 30 points, etc.
 */
export function getRoundVictoryThreshold(roundNumber: number): number {
  return 10 + (roundNumber * 10)
}

/**
 * Check if round should end
 * Checks if any player has reached the victory threshold
 * Only checked during Setup phase when first player becomes active
 */
export function checkRoundEnd(gameState: GameState): {
  shouldEnd: boolean
  roundWinners: number[]
  newRoundWinners?: Record<number, number[]>
} {
  if (!gameState.isGameStarted) {
    return { shouldEnd: false, roundWinners: [] }
  }

  // Only check during Setup phase (1) when first player becomes active
  // This is the design: round ends when first player in Setup phase
  const isSetupPhase = gameState.currentPhase === 1
  const isFirstPlayerActive = gameState.activePlayerId === gameState.startingPlayerId

  if (!isSetupPhase || !isFirstPlayerActive) {
    return { shouldEnd: false, roundWinners: [] }
  }

  const roundNumber = gameState.currentRound || 1
  const threshold = getRoundVictoryThreshold(roundNumber)
  const winners: number[] = []

  // Find all players who reached the threshold
  for (const player of gameState.players) {
    if (!player.isDummy && !player.isDisconnected && player.score >= threshold) {
      winners.push(player.id)
    }
  }

  const shouldEnd = winners.length > 0
  return {
    shouldEnd,
    roundWinners: winners
  }
}

/**
 * End the current round
 * Updates roundWinners, checks for game winner
 */
export function endRound(gameState: GameState): GameState {
  const { shouldEnd, roundWinners } = checkRoundEnd(gameState)

  if (!shouldEnd) {
    return gameState
  }

  const roundNumber = gameState.currentRound || 1

  // Update round winners
  const newRoundWinners: RoundWinners = {
    ...gameState.roundWinners,
    [roundNumber]: roundWinners
  }

  // Check for game winner (first to 2 round wins)
  const playerRoundWins = new Map<number, number>()
  for (const [rnd, winners] of Object.entries(newRoundWinners)) {
    for (const winnerId of winners) {
      const current = playerRoundWins.get(winnerId) || 0
      playerRoundWins.set(winnerId, current + 1)
    }
  }

  // Find game winner(s) - first to 2 wins
  let gameWinner: number | null = null
  for (const [playerId, winCount] of playerRoundWins.entries()) {
    if (winCount >= 2) {
      gameWinner = playerId
      break
    }
  }

  logger.info(`[endRound] Round ${roundNumber} ended. Winners: [${roundWinners.join(', ')}], Game winner: ${gameWinner || 'none'}`)

  return {
    ...gameState,
    roundWinners: newRoundWinners,
    gameWinner,
    isRoundEndModalOpen: true
  }
}

/**
 * Start next round
 * Resets scores, keeps cards on board
 */
export function startNextRound(gameState: GameState): GameState {
  const roundNumber = (gameState.currentRound || 0) + 1

  // Reset all player scores to 0
  const updatedPlayers = gameState.players.map(p => ({
    ...p,
    score: 0
  }))

  logger.info(`[startNextRound] Starting round ${roundNumber}. Scores reset.`)

  return {
    ...gameState,
    currentRound: roundNumber,
    turnNumber: 0,
    players: updatedPlayers,
    isRoundEndModalOpen: false
  }
}

/**
 * Check if player can win a round (reached threshold)
 */
export function hasPlayerReachedThreshold(gameState: GameState, playerId: number): boolean {
  const roundNumber = gameState.currentRound || 1
  const threshold = getRoundVictoryThreshold(roundNumber)
  const player = gameState.players.find(p => p.id === playerId)
  return player ? player.score >= threshold : false
}
