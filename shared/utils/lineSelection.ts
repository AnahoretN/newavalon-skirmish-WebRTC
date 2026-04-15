/**
 * @file Line Selection Utilities
 *
 * Unified, memoized system for line-based card abilities.
 * Supports horizontal, vertical, and diagonal line selection.
 *
 * Used by:
 * - Unwavering Integrator (SCORE_LAST_PLAYED_LINE)
 * - Zius, Independent Journalist (SELECT_LINE_FOR_EXPLOIT_SCORING)
 * - Centurion (CENTURION_BUFF)
 * - Logistics Chain (SELECT_DIAGONAL)
 * - IP Dept Agent (IP_AGENT_THREAT_SCORING)
 */

import type { Card, Board } from '../../client/types.js'

/**
 * Line types supported by the line selection system
 */
/* eslint-disable no-unused-vars */
export enum LineType {
  HORIZONTAL = 'HORIZONTAL',  // Same row
  VERTICAL = 'VERTICAL',      // Same column
  DIAGONAL_MAIN = 'DIAGONAL_MAIN',    // Top-left to bottom-right (r - c = constant)
  DIAGONAL_ANTI = 'DIAGONAL_ANTI',    // Top-right to bottom-left (r + c = constant)
  ANY = 'ANY'                 // Any of the above
}
/* eslint-enable no-unused-vars */

/**
 * Line definition with boundaries
 */
export interface LineDefinition {
  type: LineType
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  constant?: number  // For diagonals: r - c (main) or r + c (anti)
}

/**
 * Cell coordinates
 */
export interface CellCoords {
  row: number
  col: number
}

/**
 * Result of line selection with metadata
 */
export interface LineSelectionResult {
  isValid: boolean
  line?: LineDefinition
  cells: CellCoords[]
  errorReason?: string
}

/**
 * Memoization cache for line calculations
 */
interface LineCache {
  [key: string]: {
    timestamp: number
    result: LineDefinition[]
  }
}

// Cache with 5-second TTL
const LINE_CACHE: LineCache = {}
const CACHE_TTL = 5000

/**
 * Generate cache key for line calculations
 */
function generateCacheKey(
  gridSize: number,
  activeGridSize: number,
  lineType: LineType,
  referenceCoords?: CellCoords
): string {
  const base = `${gridSize}-${activeGridSize}-${lineType}`
  if (referenceCoords) {
    return `${base}-${referenceCoords.row}-${referenceCoords.col}`
  }
  return base
}

/**
 * Get from cache or calculate fresh
 */
function getCachedOrCalculate<T>(
  key: string,
  calculator: () => T,
  now: number = Date.now()
): T {
  const cached = LINE_CACHE[key]
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.result as unknown as T
  }

  const result = calculator()
  LINE_CACHE[key] = { timestamp: now, result: result as unknown as LineDefinition[] }
  return result
}

/**
 * Clear cache (call when board state changes significantly)
 */
export function clearLineCache(): void {
  Object.keys(LINE_CACHE).forEach(key => delete LINE_CACHE[key])
}

/**
 * Calculate active grid boundaries
 */
export function calculateActiveBounds(
  gridSize: number,
  activeGridSize: number
): { minBound: number; maxBound: number; offset: number } {
  const offset = Math.floor((gridSize - activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + activeGridSize - 1

  return { minBound, maxBound, offset }
}

/**
 * Check if coordinates are within active grid bounds
 */
export function isInActiveBounds(
  coords: CellCoords,
  gridSize: number,
  activeGridSize: number
): boolean {
  const { minBound, maxBound } = calculateActiveBounds(gridSize, activeGridSize)
  return coords.row >= minBound && coords.row <= maxBound &&
         coords.col >= minBound && coords.col <= maxBound
}

/**
 * Check if two cells are on the same horizontal line (row)
 */
export function areOnSameHorizontalLine(
  coords1: CellCoords,
  coords2: CellCoords
): boolean {
  return coords1.row === coords2.row
}

/**
 * Check if two cells are on the same vertical line (column)
 */
export function areOnSameVerticalLine(
  coords1: CellCoords,
  coords2: CellCoords
): boolean {
  return coords1.col === coords2.col
}

/**
 * Check if two cells are on the same diagonal
 */
export function areOnSameDiagonal(
  coords1: CellCoords,
  coords2: CellCoords
): { onMainDiagonal: boolean; onAntiDiagonal: boolean } {
  const onMainDiagonal = (coords1.row - coords1.col) === (coords2.row - coords2.col)
  const onAntiDiagonal = (coords1.row + coords1.col) === (coords2.row + coords2.col)

  return { onMainDiagonal, onAntiDiagonal }
}

/**
 * Determine line type between two cells
 */
export function determineLineType(
  coords1: CellCoords,
  coords2: CellCoords
): LineType | null {
  if (areOnSameHorizontalLine(coords1, coords2)) {
    return LineType.HORIZONTAL
  }
  if (areOnSameVerticalLine(coords1, coords2)) {
    return LineType.VERTICAL
  }

  const { onMainDiagonal, onAntiDiagonal } = areOnSameDiagonal(coords1, coords2)
  if (onMainDiagonal) {
    return LineType.DIAGONAL_MAIN
  }
  if (onAntiDiagonal) {
    return LineType.DIAGONAL_ANTI
  }

  return null // Not on any common line
}

/**
 * Get line definition for a horizontal line through reference coords
 */
export function getHorizontalLine(
  referenceCoords: CellCoords,
  gridSize: number,
  activeGridSize: number
): LineDefinition {
  const { minBound, maxBound } = calculateActiveBounds(gridSize, activeGridSize)

  return {
    type: LineType.HORIZONTAL,
    startRow: referenceCoords.row,
    endRow: referenceCoords.row,
    startCol: minBound,
    endCol: maxBound
  }
}

/**
 * Get line definition for a vertical line through reference coords
 */
export function getVerticalLine(
  referenceCoords: CellCoords,
  gridSize: number,
  activeGridSize: number
): LineDefinition {
  const { minBound, maxBound } = calculateActiveBounds(gridSize, activeGridSize)

  return {
    type: LineType.VERTICAL,
    startRow: minBound,
    endRow: maxBound,
    startCol: referenceCoords.col,
    endCol: referenceCoords.col
  }
}

/**
 * Get line definition for a diagonal through reference coords
 */
export function getDiagonalLine(
  referenceCoords: CellCoords,
  diagonalType: 'main' | 'anti',
  gridSize: number,
  activeGridSize: number
): LineDefinition {
  const { minBound, maxBound } = calculateActiveBounds(gridSize, activeGridSize)
  const type = diagonalType === 'main' ? LineType.DIAGONAL_MAIN : LineType.DIAGONAL_ANTI

  // Calculate diagonal boundaries
  let startRow = minBound
  let endRow = maxBound
  let startCol = minBound
  let endCol = maxBound

  if (diagonalType === 'main') {
    // Main diagonal: r - c = constant
    const constant = referenceCoords.row - referenceCoords.col

    // Find intersection with active bounds
    startRow = Math.max(minBound, constant + minBound)
    endRow = Math.min(maxBound, constant + maxBound)

    startCol = startRow - constant
    endCol = endRow - constant
  } else {
    // Anti diagonal: r + c = constant
    const constant = referenceCoords.row + referenceCoords.col

    // Find intersection with active bounds
    startRow = Math.max(minBound, constant - maxBound)
    endRow = Math.min(maxBound, constant - minBound)

    startCol = constant - startRow
    endCol = constant - endRow
  }

  return {
    type,
    startRow,
    endRow,
    startCol,
    endCol,
    constant: referenceCoords.row - referenceCoords.col
  }
}

/**
 * Get all cells in a line definition
 */
export function getCellsInLine(line: LineDefinition): CellCoords[] {
  const cells: CellCoords[] = []

  if (line.type === LineType.HORIZONTAL) {
    for (let c = line.startCol; c <= line.endCol; c++) {
      cells.push({ row: line.startRow, col: c })
    }
  } else if (line.type === LineType.VERTICAL) {
    for (let r = line.startRow; r <= line.endRow; r++) {
      cells.push({ row: r, col: line.startCol })
    }
  } else if (line.type === LineType.DIAGONAL_MAIN || line.type === LineType.DIAGONAL_ANTI) {
    // Diagonal traversal
    const rowStep = line.startRow <= line.endRow ? 1 : -1
    const colStep = line.startCol <= line.endCol ? 1 : -1

    let r = line.startRow
    let c = line.startCol

    while (true) {
      cells.push({ row: r, col: c })

      if (r === line.endRow && c === line.endCol) break

      r += rowStep
      c += colStep
    }
  }

  return cells
}

/**
 * Validate line selection between two points
 * Returns detailed validation result
 */
export function validateLineSelection(
  startPoint: CellCoords,
  endPoint: CellCoords,
  allowedLineTypes: LineType[],
  gridSize: number,
  activeGridSize: number,
  requirePassThrough?: CellCoords  // Optional: must pass through this point
): LineSelectionResult {
  // Check if both points are in active bounds
  if (!isInActiveBounds(startPoint, gridSize, activeGridSize)) {
    return {
      isValid: false,
      cells: [],
      errorReason: 'Start point is outside active grid bounds'
    }
  }

  if (!isInActiveBounds(endPoint, gridSize, activeGridSize)) {
    return {
      isValid: false,
      cells: [],
      errorReason: 'End point is outside active grid bounds'
    }
  }

  // Determine line type
  const lineType = determineLineType(startPoint, endPoint)

  if (!lineType) {
    return {
      isValid: false,
      cells: [],
      errorReason: 'Points are not on the same line (horizontal, vertical, or diagonal)'
    }
  }

  // Check if line type is allowed
  if (!allowedLineTypes.includes(lineType) && !allowedLineTypes.includes(LineType.ANY)) {
    return {
      isValid: false,
      cells: [],
      errorReason: `Line type ${lineType} is not allowed. Allowed: ${allowedLineTypes.join(', ')}`
    }
  }

  // Get line definition
  let line: LineDefinition
  if (lineType === LineType.HORIZONTAL) {
    line = getHorizontalLine(startPoint, gridSize, activeGridSize)
  } else if (lineType === LineType.VERTICAL) {
    line = getVerticalLine(startPoint, gridSize, activeGridSize)
  } else if (lineType === LineType.DIAGONAL_MAIN) {
    line = getDiagonalLine(startPoint, 'main', gridSize, activeGridSize)
  } else {
    line = getDiagonalLine(startPoint, 'anti', gridSize, activeGridSize)
  }

  // Check if line passes through required point (if specified)
  if (requirePassThrough) {
    const cells = getCellsInLine(line)
    const passesThrough = cells.some(
      cell => cell.row === requirePassThrough.row && cell.col === requirePassThrough.col
    )

    if (!passesThrough) {
      return {
        isValid: false,
        cells: [],
        errorReason: 'Selected line must pass through the required point'
      }
    }
  }

  return {
    isValid: true,
    line,
    cells: getCellsInLine(line)
  }
}

/**
 * Select line by clicking a single cell
 * Used for: Integrator, IP Agent (click any cell in desired row/column)
 *
 * @param clickedCell - The cell that was clicked
 * @param referenceCoords - Reference point (card coordinates)
 * @param allowedLineTypes - What line types are allowed
 * @param gridSize - Total grid size
 * @param activeGridSize - Active grid size
 * @param requirePassThrough - Optional: must pass through this point
 */
export function selectLineBySingleClick(
  clickedCell: CellCoords,
  referenceCoords: CellCoords,
  allowedLineTypes: LineType[],
  gridSize: number,
  activeGridSize: number,
  requirePassThrough?: CellCoords
): LineSelectionResult {
  // Determine which line to select based on clicked cell
  let selectedLine: LineType

  // If clicked on reference cell itself, default to first allowed type
  if (clickedCell.row === referenceCoords.row && clickedCell.col === referenceCoords.col) {
    selectedLine = allowedLineTypes[0] === LineType.ANY ? LineType.HORIZONTAL : allowedLineTypes[0]
  } else {
    // Determine line type based on clicked cell position relative to reference
    if (areOnSameHorizontalLine(clickedCell, referenceCoords)) {
      selectedLine = LineType.HORIZONTAL
    } else if (areOnSameVerticalLine(clickedCell, referenceCoords)) {
      selectedLine = LineType.VERTICAL
    } else {
      const { onMainDiagonal } = areOnSameDiagonal(clickedCell, referenceCoords)
      selectedLine = onMainDiagonal ? LineType.DIAGONAL_MAIN : LineType.DIAGONAL_ANTI
    }
  }

  // Check if selected line type is allowed
  if (!allowedLineTypes.includes(selectedLine) && !allowedLineTypes.includes(LineType.ANY)) {
    return {
      isValid: false,
      cells: [],
      errorReason: `Cannot select ${selectedLine} line. Allowed: ${allowedLineTypes.join(', ')}`
    }
  }

  // Generate line definition
  let line: LineDefinition
  if (selectedLine === LineType.HORIZONTAL) {
    line = getHorizontalLine(clickedCell, gridSize, activeGridSize)
  } else if (selectedLine === LineType.VERTICAL) {
    line = getVerticalLine(clickedCell, gridSize, activeGridSize)
  } else if (selectedLine === LineType.DIAGONAL_MAIN) {
    line = getDiagonalLine(clickedCell, 'main', gridSize, activeGridSize)
  } else {
    line = getDiagonalLine(clickedCell, 'anti', gridSize, activeGridSize)
  }

  // Check pass-through requirement
  if (requirePassThrough) {
    const cells = getCellsInLine(line)
    const passesThrough = cells.some(
      cell => cell.row === requirePassThrough.row && cell.col === requirePassThrough.col
    )

    if (!passesThrough) {
      return {
        isValid: false,
        cells: [],
        errorReason: 'Selected line must pass through the required point'
      }
    }
  }

  return {
    isValid: true,
    line,
    cells: getCellsInLine(line)
  }
}

/**
 * Select line by two-click method
 * Used for: Zius, Centurion (click start point, then end point)
 *
 * @param startPoint - First clicked cell
 * @param endPoint - Second clicked cell
 * @param allowedLineTypes - What line types are allowed
 * @param gridSize - Total grid size
 * @param activeGridSize - Active grid size
 * @param requirePassThrough - Optional: must pass through this point
 */
export function selectLineByTwoClicks(
  startPoint: CellCoords,
  endPoint: CellCoords,
  allowedLineTypes: LineType[],
  gridSize: number,
  activeGridSize: number,
  requirePassThrough?: CellCoords
): LineSelectionResult {
  return validateLineSelection(
    startPoint,
    endPoint,
    allowedLineTypes,
    gridSize,
    activeGridSize,
    requirePassThrough
  )
}

/**
 * Calculate valid targets for line selection
 * Returns all cells that can be clicked to select a valid line
 *
 * @param referenceCoords - Reference point (card coordinates)
 * @param allowedLineTypes - What line types are allowed
 * @param gridSize - Total grid size
 * @param activeGridSize - Active grid size
 * @param requirePassThrough - Optional: must pass through this point
 */
export function calculateValidLineTargets(
  referenceCoords: CellCoords,
  allowedLineTypes: LineType[],
  gridSize: number,
  activeGridSize: number,
  requirePassThrough?: CellCoords
): CellCoords[] {
  const { minBound, maxBound } = calculateActiveBounds(gridSize, activeGridSize)

  const now = Date.now()
  const cacheKey = generateCacheKey(gridSize, activeGridSize, LineType.ANY, referenceCoords)

  // Check cache first
  const cached = getCachedOrCalculate(cacheKey, () => {
    const targets: CellCoords[] = []

    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const testCoords = { row: r, col: c }

        // For single-click selection, test if this cell would produce a valid line
        const result = selectLineBySingleClick(
          testCoords,
          referenceCoords,
          allowedLineTypes,
          gridSize,
          activeGridSize,
          requirePassThrough
        )

        if (result.isValid) {
          targets.push(testCoords)
        }
      }
    }

    return targets
  }, now)

  return cached as unknown as CellCoords[]
}

/**
 * Filter cards in line by criteria
 *
 * @param line - Line definition
 * @param board - Game board
 * @param filterFn - Optional filter function
 * @returns Array of cards that match the filter
 */
/* eslint-disable no-unused-vars */
export function filterCardsInLine(
  line: LineDefinition,
  board: Board,
  filterFn?: (card: Card, coords: CellCoords) => boolean
): Array<{ card: Card; coords: CellCoords }> {
/* eslint-enable no-unused-vars */
  const results: Array<{ card: Card; coords: CellCoords }> = []
  const cells = getCellsInLine(line)

  for (const coords of cells) {
    if (coords.row >= 0 && coords.row < board.length &&
        coords.col >= 0 && coords.col < board[0].length) {
      const cell = board[coords.row][coords.col]
      if (cell.card) {
        if (!filterFn || filterFn(cell.card, coords)) {
          results.push({ card: cell.card, coords })
        }
      }
    }
  }

  return results
}

/**
 * Count statuses in line
 *
 * @param line - Line definition
 * @param board - Game board
 * @param statusType - Status type to count
 * @param ownerId - Owner ID to filter by (optional)
 * @returns Count of matching statuses
 */
export function countStatusesInLine(
  line: LineDefinition,
  board: Board,
  statusType: string,
  ownerId?: number
): number {
  const cards = filterCardsInLine(line, board)
  let count = 0

  for (const { card } of cards) {
    if (card.statuses) {
      for (const status of card.statuses) {
        if (status.type === statusType) {
          if (ownerId === undefined || status.addedByPlayerId === ownerId) {
            count++
          }
        }
      }
    }
  }

  return count
}

/**
 * Calculate total power in line
 *
 * @param line - Line definition
 * @param board - Game board
 * @param ownerId - Owner ID to filter by (optional)
 * @param includeOpponentExploits - Include opponent cards with your Exploit counters
 * @returns Total power
 */
export function calculateLinePower(
  line: LineDefinition,
  board: Board,
  ownerId?: number,
  includeOpponentExploits: boolean = false
): number {
  const cards = filterCardsInLine(line, board)
  let totalPower = 0

  for (const { card } of cards) {
    // Skip stunned cards
    if (card.statuses?.some(s => s.type === 'Stun')) {
      continue
    }

    const isOwner = ownerId === undefined || card.ownerId === ownerId
    const hasExploit = includeOpponentExploits && card.statuses?.some(
      s => s.type === 'Exploit' && s.addedByPlayerId === ownerId
    )

    if (isOwner || hasExploit) {
      const power = Math.max(0,
        card.power + (card.powerModifier || 0) + (card.bonusPower || 0)
      )
      totalPower += power
    }
  }

  return totalPower
}

/**
 * Get line selection mode configuration
 * Returns pre-configured settings for common card abilities
 */
export function getLineSelectionModeConfig(
  cardId: string
): {
  allowedLineTypes: LineType[]
  selectionMethod: 'single-click' | 'two-click'
  requirePassThrough?: boolean
} {
  const configs: Record<string, {
    allowedLineTypes: LineType[]
    selectionMethod: 'single-click' | 'two-click'
    requirePassThrough?: boolean
  }> = {
    'unwaveringIntegrator': {
      allowedLineTypes: [LineType.HORIZONTAL, LineType.VERTICAL],
      selectionMethod: 'single-click'
    },
    'ziusIJ': {
      allowedLineTypes: [LineType.HORIZONTAL, LineType.VERTICAL],
      selectionMethod: 'single-click',
      requirePassThrough: true
    },
    'centurion': {
      allowedLineTypes: [LineType.HORIZONTAL, LineType.VERTICAL],
      selectionMethod: 'two-click'
    },
    'logisticsChain': {
      allowedLineTypes: [LineType.DIAGONAL_MAIN, LineType.DIAGONAL_ANTI],
      selectionMethod: 'two-click'
    },
    'ipDeptAgent': {
      allowedLineTypes: [LineType.HORIZONTAL, LineType.VERTICAL],
      selectionMethod: 'single-click'
    }
  }

  return configs[cardId] || {
    allowedLineTypes: [LineType.HORIZONTAL, LineType.VERTICAL],
    selectionMethod: 'single-click'
  }
}