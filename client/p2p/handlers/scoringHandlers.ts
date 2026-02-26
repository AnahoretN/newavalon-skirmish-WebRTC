/**
 * Scoring handlers for SimpleGameLogic
 *
 * Contains all scoring-related game logic:
 * - Starting scoring phase
 * - Selecting scoring lines
 * - Calculating line scores
 * - Round/match management
 */

import type { GameState, Player } from '../../types'

/**
 * START_SCORING - start scoring phase
 */
export function handleStartScoring(state: GameState, playerId: number, enterScoringPhase: (state: GameState, playerId: number) => GameState): GameState {
  if (state.currentPhase !== 3) {return state}

  // Use enterScoringPhase for proper line calculation
  return enterScoringPhase(state, playerId)
}

/**
 * SELECT_SCORING_LINE - select line for scoring
 */
export function handleSelectScoringLine(state: GameState, playerId: number, data: any, handlePassTurn: (state: GameState, playerId: number, reason: string) => GameState): GameState {
  if (!state.isScoringStep || state.activePlayerId !== playerId) {return state}

  const { lineType, lineIndex } = data || {}
  if (!lineType) {return state}

  // Calculate points based on cards in line
  const points = calculateLineScore(state, playerId, lineType, lineIndex)

  console.log('[handleSelectScoringLine] Player', playerId, 'selected', lineType, lineIndex, 'score:', points)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, score: p.score + points }
      : p
  )

  // Pass turn
  const newState = {
    ...state,
    players: newPlayers,
    isScoringStep: false,
    scoringLines: []  // Clear scoring lines
  }

  return handlePassTurn(newState, playerId, 'scoring_complete')
}

/**
 * Calculate points for line
 * lineType: 'row' | 'col' | 'diagonal' | 'anti-diagonal'
 * lineIndex: row/column number (0-based), or undefined for diagonals
 */
export function calculateLineScore(state: GameState, playerId: number, lineType: string, lineIndex?: number): number {
  const gridSize = state.activeGridSize
  const cellsToCheck: { row: number; col: number }[] = []

  if (lineType === 'row' && lineIndex !== undefined) {
    // Horizontal line
    for (let c = 0; c < gridSize; c++) {
      cellsToCheck.push({ row: lineIndex, col: c })
    }
  } else if (lineType === 'col' && lineIndex !== undefined) {
    // Vertical line
    for (let r = 0; r < gridSize; r++) {
      cellsToCheck.push({ row: r, col: lineIndex })
    }
  } else if (lineType === 'diagonal') {
    // Main diagonal (top-left to bottom-right)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: i })
    }
  } else if (lineType === 'anti-diagonal') {
    // Anti-diagonal (top-right to bottom-left)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: gridSize - 1 - i })
    }
  }

  // Count sum of power of all player's cards in this line
  let score = 0
  for (const { row, col } of cellsToCheck) {
    const cell = state.board[row]?.[col]
    if (cell.card?.ownerId === playerId) {
      const power = cell.card.power || 0
      const powerModifier = cell.card.powerModifier || 0
      score += power + powerModifier
    }
  }

  return score
}

/**
 * Find all lines containing player's card
 * Returns array of lines that can be highlighted for scoring
 */
export function findScoringLinesWithPlayerCard(
  state: GameState,
  playerId: number
): Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return []}

  // Find coordinates of last played card
  let lastPlayedCoords: { row: number; col: number } | null = null

  if (player.lastPlayedCardId) {
    // Search by lastPlayedCardId
    for (let r = 0; r < state.activeGridSize; r++) {
      for (let c = 0; c < state.activeGridSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.id === player.lastPlayedCardId) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // If last played not found, look for any card with enteredThisTurn
  if (!lastPlayedCoords) {
    for (let r = 0; r < state.activeGridSize; r++) {
      for (let c = 0; c < state.activeGridSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.ownerId === playerId && cell.card.enteredThisTurn) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // If no card found - no lines for scoring
  if (!lastPlayedCoords) {return []}

  const { row, col } = lastPlayedCoords
  const lines: Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> = []

  // Horizontal line (row)
  const rowCells: { row: number; col: number }[] = []
  for (let c = 0; c < state.activeGridSize; c++) {
    rowCells.push({ row, col: c })
  }
  lines.push({ type: 'row', index: row, cells: rowCells })

  // Vertical line (col)
  const colCells: { row: number; col: number }[] = []
  for (let r = 0; r < state.activeGridSize; r++) {
    colCells.push({ row: r, col })
  }
  lines.push({ type: 'col', index: col, cells: colCells })

  // Diagonal lines not currently used in scoring phase
  // (may be used in card abilities)

  return lines
}

/**
 * COMPLETE_ROUND - close round end modal
 */
export function handleCompleteRound(state: GameState): GameState {
  return { ...state, isRoundEndModalOpen: false }
}

/**
 * START_NEXT_ROUND - start next round
 */
export function handleStartNextRound(state: GameState): GameState {
  const newRound = (state.currentRound || 1) + 1

  const newPlayers = state.players.map(p => ({
    ...p,
    score: 0  // Reset score
  }))

  return {
    ...state,
    currentRound: newRound,
    players: newPlayers,
    isRoundEndModalOpen: false,
    gameWinner: null
  }
}

/**
 * START_NEW_MATCH - start new match
 */
export function handleStartNewMatch(state: GameState): GameState {
  return {
    ...state,
    currentRound: 1,
    currentPhase: 1,  // Setup - can play cards immediately
    turnNumber: 1
  }
}

/**
 * Helper function to get active player IDs (not disconnected, not spectators)
 */
export function getActivePlayerIds(players: Player[]): number[] {
  return players
    .filter(p => !p.isDisconnected && !p.isSpectator)
    .map(p => p.id)
}

/**
 * Check if round should end
 */
export function shouldRoundEnd(state: GameState): boolean {
  const threshold = 10 + (state.currentRound * 10)  // 20, 30, 40
  return state.players.some(p => p.score >= threshold)
}

/**
 * End round
 */
export function endRound(state: GameState): GameState {
  const maxScore = Math.max(...state.players.map(p => p.score))
  const winners = state.players.filter(p => p.score === maxScore).map(p => p.id)

  // Check match victory (2 rounds)
  const roundWins = Object.values(state.roundWinners || {})
  const matchWinner = checkMatchWinner(roundWins, winners)

  const newRoundWinners = {
    ...(state.roundWinners || {}),
    [state.currentRound]: winners
  }

  const newState = {
    ...state,
    roundWinners: newRoundWinners,
    isRoundEndModalOpen: true
  }

  if (matchWinner) {
    newState.gameWinner = matchWinner
  }

  return newState
}

/**
 * Check match winner (2 out of 3 rounds)
 */
function checkMatchWinner(existingWins: Record<number, number[]>, newWinners: number[]): number | null {
  const allWins = { ...existingWins }

  // Count wins for each round
  const winCounts: Record<number, number> = {}
  Object.values(allWins).flat().forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })
  newWinners.forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })

  // Check who won 2 rounds
  for (const [id, count] of Object.entries(winCounts)) {
    if (count >= 2) {return parseInt(id)}
  }

  return null
}
