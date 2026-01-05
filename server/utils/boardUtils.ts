/**
 * @file Board utilities for game state management
 * Shared between client and server
 *
 * Card IDs for Hero passives:
 * - Mr. Pearl (mrPearlDoF): +1 Power to other own units in lines
 * - Reverend of The Choir (reverendOfTheChoir): Support to all own units in lines
 */

import type { Board, GameState } from '../types/types.js'

const GRID_MAX_SIZE = 7

// Hero card baseIds for passive abilities (direct ID matching)
const HERO_MR_PEARL_ID = 'mrPearlDoF'
const HERO_REVEREND_ID = 'reverendOfTheChoir'

/**
 * Optimized deep clone for board data structure.
 * Much faster than JSON.parse(JSON.stringify()) for our specific use case.
 */
function cloneBoard(board: Board): Board {
  // Use structuredClone if available (modern Node.js 17+)
  if (typeof structuredClone !== 'undefined') {
    return structuredClone(board)
  }
  // Fallback to JSON method
  return JSON.parse(JSON.stringify(board))
}

/**
 * Creates an empty game board of the maximum possible size.
 * @returns {Board} An empty board.
 */
export const createInitialBoard = (): Board =>
  Array(GRID_MAX_SIZE).fill(null).map(() => Array(GRID_MAX_SIZE).fill(null).map(() => ({ card: null })))

/**
 * Recalculates "Support" and "Threat" statuses for all cards on the board.
 * Also calculates passive buffs like Mr. Pearl's bonus power and Reverend's Support.
 * This function is computationally intensive and should be called only when the board changes.
 * @param {GameState} gameState The entire current game state.
 * @returns {Board} A new board object with updated statuses.
 */
export const recalculateBoardStatuses = (gameState: GameState): Board => {
  const { board, activeGridSize, players } = gameState
  const newBoard = cloneBoard(board)
  const GRID_SIZE = newBoard.length
  const offset = Math.floor((GRID_SIZE - activeGridSize) / 2)

  const playerTeamMap = new Map<number, number | undefined>()
  players.forEach((p: { id: number; teamId?: number }) => playerTeamMap.set(p.id, p.teamId))

  // 1. Reset dynamic properties
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const card = newBoard[r][c].card
      if (card) {
        // Remove auto statuses
        if (card.statuses) {
          card.statuses = card.statuses.filter((s: {type: string}) => s.type !== 'Support' && s.type !== 'Threat')
        }
        // Reset bonus power
        delete card.bonusPower
      }
    }
  }

  // 2. Standard Support/Threat Logic
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const card = newBoard[r][c].card
      if (card?.ownerId === undefined || card.isFaceDown) {
        continue
      }

      const ownerId = card.ownerId
      const ownerTeamId = playerTeamMap.get(ownerId)

      const neighborsPos = [
        { r: r - 1, c: c }, { r: r + 1, c: c },
        { r: r, c: c - 1 }, { r: r, c: c + 1 },
      ]

      const enemyNeighborsByPlayer: { [key: number]: { r: number, c: number }[] } = {}
      let hasFriendlyNeighbor = false

      // Check all adjacent cells.
      for (const pos of neighborsPos) {
        const { r: nr, c: nc } = pos
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
          const neighborCard = newBoard[nr][nc].card

          // A Stunned card cannot provide Support or create Threat.
          const isNeighborStunned = neighborCard?.statuses?.some((s: {type: string}) => s.type === 'Stun')

          if (neighborCard?.ownerId !== undefined && !neighborCard.isFaceDown && !isNeighborStunned) {
            const neighborOwnerId = neighborCard.ownerId
            const neighborTeamId = playerTeamMap.get(neighborOwnerId)

            // A neighbor is friendly if they are the same player, or if they are on the same team (and teams exist).
            // If teams are undefined, ownerTeamId !== undefined checks ensure we fall back to simple ID comparison.
            const isFriendly = ownerId === neighborOwnerId || (ownerTeamId !== undefined && ownerTeamId === neighborTeamId)

            if (isFriendly) {
              hasFriendlyNeighbor = true
            } else {
              if (!enemyNeighborsByPlayer[neighborOwnerId]) {
                enemyNeighborsByPlayer[neighborOwnerId] = []
              }
              enemyNeighborsByPlayer[neighborOwnerId].push({ r: nr, c: nc })
            }
          }
        }
      }

      // Apply "Support" Status if a friendly neighbor exists.
      if (hasFriendlyNeighbor) {
        if (!card.statuses) {
          card.statuses = []
        }
        if (!card.statuses.some((s: {type: string}) => s.type === 'Support')) {
          card.statuses.push({ type: 'Support', addedByPlayerId: ownerId })
        }
      }

      let threateningPlayerId: number | null = null

      // Apply "Threat" Status Condition A: Pinned by two cards of the same enemy.
      for (const enemyPlayerId in enemyNeighborsByPlayer) {
        const neighbors = enemyNeighborsByPlayer[enemyPlayerId]
        if (neighbors && neighbors.length >= 2) {
          threateningPlayerId = parseInt(enemyPlayerId, 10)
          break
        }
      }

      // Apply "Threat" Status Condition B: On the active border with an enemy neighbor.
      if (threateningPlayerId === null) {
        const isActiveCell = r >= offset && r < offset + activeGridSize &&
                                    c >= offset && c < offset + activeGridSize

        if (isActiveCell) {
          const isCardOnEdge = r === offset || r === offset + activeGridSize - 1 ||
                                         c === offset || c === offset + activeGridSize - 1

          const hasEnemyNeighbor = Object.keys(enemyNeighborsByPlayer).length > 0

          if (isCardOnEdge && hasEnemyNeighbor) {
            const firstEnemyKey = Object.keys(enemyNeighborsByPlayer)[0]
            if (firstEnemyKey) {
              threateningPlayerId = parseInt(firstEnemyKey, 10)
            }
          }
        }
      }

      if (threateningPlayerId !== null) {
        if (!card.statuses) {
          card.statuses = []
        }
        if (!card.statuses.some((s: {type: string}) => s.type === 'Threat')) {
          card.statuses.push({ type: 'Threat', addedByPlayerId: threateningPlayerId })
        }
      }
    }
  }

  // 3. Hero Passives (Reverend & Mr. Pearl) - Optimized version
  // Collect hero positions first, then apply effects row/column by row/column
  // to reduce redundant iterations

  interface HeroPosition {
    r: number
    c: number
    ownerId: number
    baseId: string
  }

  const reverends: HeroPosition[] = []
  const mrPearls: HeroPosition[] = []

  // Single pass to collect hero positions
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const card = newBoard[r][c].card
      const isStunned = card?.statuses?.some((s: {type: string}) => s.type === 'Stun')

      if (card?.baseId && !card.isFaceDown && card.ownerId !== undefined && !isStunned) {
        if (card.baseId === HERO_REVEREND_ID) {
          reverends.push({ r, c, ownerId: card.ownerId, baseId: card.baseId })
        } else if (card.baseId === HERO_MR_PEARL_ID) {
          mrPearls.push({ r, c, ownerId: card.ownerId, baseId: card.baseId })
        }
      }
    }
  }

  // Apply Reverend Support effects - process each affected row/col only once
  const processedRowsForReverend = new Set<string>()
  const processedColsForReverend = new Set<string>()

  for (const hero of reverends) {
    const { r, c, ownerId } = hero

    // Process row if not already processed for this player
    const rowKey = `${r}-${ownerId}`
    if (!processedRowsForReverend.has(rowKey)) {
      processedRowsForReverend.add(rowKey)
      for (let i = 0; i < GRID_SIZE; i++) {
        const target = newBoard[r][i].card
        if (target && target.ownerId === ownerId && !target.isFaceDown) {
          if (!target.statuses) {
            target.statuses = []
          }
          if (!target.statuses.some((s: {type: string}) => s.type === 'Support')) {
            target.statuses.push({ type: 'Support', addedByPlayerId: ownerId })
          }
        }
      }
    }

    // Process column if not already processed for this player
    const colKey = `${c}-${ownerId}`
    if (!processedColsForReverend.has(colKey)) {
      processedColsForReverend.add(colKey)
      for (let i = 0; i < GRID_SIZE; i++) {
        const target = newBoard[i][c].card
        if (target && target.ownerId === ownerId && !target.isFaceDown) {
          if (!target.statuses) {
            target.statuses = []
          }
          if (!target.statuses.some((s: {type: string}) => s.type === 'Support')) {
            target.statuses.push({ type: 'Support', addedByPlayerId: ownerId })
          }
        }
      }
    }
  }

  // Apply Mr. Pearl bonus power effects - process each affected row/col only once
  const processedRowsForPearl = new Set<string>()
  const processedColsForPearl = new Set<string>()

  for (const hero of mrPearls) {
    const { r, c, ownerId } = hero

    // Process row if not already processed for this player
    const rowKey = `${r}-${ownerId}`
    if (!processedRowsForPearl.has(rowKey)) {
      processedRowsForPearl.add(rowKey)
      for (let i = 0; i < GRID_SIZE; i++) {
        const target = newBoard[r][i].card
        // Exclude the hero card itself - only buff OTHER units
        if (target && target.ownerId === ownerId && !target.isFaceDown && target.baseId !== HERO_MR_PEARL_ID) {
          target.bonusPower = (target.bonusPower || 0) + 1
        }
      }
    }

    // Process column if not already processed for this player
    const colKey = `${c}-${ownerId}`
    if (!processedColsForPearl.has(colKey)) {
      processedColsForPearl.add(colKey)
      for (let i = 0; i < GRID_SIZE; i++) {
        const target = newBoard[i][c].card
        // Exclude the hero card itself - only buff OTHER units
        if (target && target.ownerId === ownerId && !target.isFaceDown && target.baseId !== HERO_MR_PEARL_ID) {
          target.bonusPower = (target.bonusPower || 0) + 1
        }
      }
    }
  }

  return newBoard
}
