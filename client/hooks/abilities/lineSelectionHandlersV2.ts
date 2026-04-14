/**
 * Line Selection Handlers (Refactored)
 *
 * Unified handlers for line-based card abilities using shared lineSelection module.
 * Much cleaner and more maintainable than the previous implementation.
 *
 * Supports:
 * - Unwavering Integrator (SCORE_LAST_PLAYED_LINE)
 * - Zius, Independent Journalist (SELECT_LINE_FOR_EXPLOIT_SCORING)
 * - Centurion (CENTURION_BUFF)
 * - Logistics Chain (SELECT_DIAGONAL)
 * - IP Dept Agent (IP_AGENT_THREAT_SCORING)
 */

import type { AbilityAction, FloatingTextData } from '@/types'
import { TIMING } from '@/utils/common'
import {
  selectLineBySingleClick,
  selectLineByTwoClicks,
  filterCardsInLine,
  countStatusesInLine,
  calculateLinePower,
  getCellsInLine,
  type LineType,
  type CellCoords,
  type LineDefinition,
  LineType as LineTypeEnum
} from '@shared/utils/lineSelection'

export interface LineSelectionProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  interactionLock: React.MutableRefObject<boolean>
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  nextPhase: (forceTurnPass?: boolean) => void
  modifyBoardCardPower: (coords: { row: number; col: number }, delta: number) => void
  scoreLine: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  commandContext: any
  isWebRTCMode?: boolean
}

/**
 * Convert legacy line type to enum
 */
function getLineTypes(allowedTypes: string[]): LineType[] {
  const typeMap: Record<string, LineType> = {
    'HORIZONTAL': LineTypeEnum.HORIZONTAL,
    'VERTICAL': LineTypeEnum.VERTICAL,
    'DIAGONAL_MAIN': LineTypeEnum.DIAGONAL_MAIN,
    'DIAGONAL_ANTI': LineTypeEnum.DIAGONAL_ANTI,
    'ANY': LineTypeEnum.ANY
  }

  return allowedTypes.map(type => typeMap[type] || LineTypeEnum.ANY)
}

/**
 * Handle SCORE_LAST_PLAYED_LINE (Unwavering Integrator, IP Agent)
 * Single-click line selection for scoring
 */
function handleScoreLastPlayedLine(
  coords: CellCoords,
  props: LineSelectionProps
): boolean {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    interactionLock,
    setAbilityMode,
    markAbilityUsed,
    updatePlayerScore,
    triggerFloatingText,
    nextPhase,
    isWebRTCMode = false
  } = props

  if (!abilityMode?.sourceCoords) {
    return false
  }

  // Prevent multiple clicks
  if (interactionLock.current) {
    return true
  }

  const gridSize = gameState.board.length
  const activeGridSize = gameState.activeGridSize

  // Use single-click selection
  const result = selectLineBySingleClick(
    coords,
    abilityMode.sourceCoords,
    [LineTypeEnum.HORIZONTAL, LineTypeEnum.VERTICAL],
    gridSize,
    activeGridSize
  )

  if (!result.isValid || !result.line) {
    return true
  }

  // Lock interaction
  interactionLock.current = true

  const playerId = localPlayerId ?? gameState.activePlayerId!
  const line = result.line

  // Calculate score using shared utility
  const totalScore = calculateLinePower(
    line,
    gameState.board,
    playerId,
    true // Include opponent cards with your Exploit counters
  )

  // Generate floating texts for each card
  const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []
  const cards = filterCardsInLine(line, gameState.board, (card) => {
    // Skip stunned cards
    if (card.statuses?.some(s => s.type === 'Stun')) {
      return false
    }

    const isOwner = card.ownerId === playerId
    const hasExploit = card.statuses?.some(
      s => s.type === 'Exploit' && s.addedByPlayerId === playerId
    )

    return isOwner || hasExploit
  })

  for (const { card, coords: cardCoords } of cards) {
    const points = Math.max(0,
      card.power + (card.powerModifier || 0) + (card.bonusPower || 0)
    )
    if (points > 0) {
      scoreEvents.push({
        row: cardCoords.row,
        col: cardCoords.col,
        text: `+${points}`,
        playerId
      })
    }
  }

  // Show floating texts
  if (scoreEvents.length > 0) {
    triggerFloatingText(scoreEvents)
  }

  // Update score
  if (totalScore > 0) {
    updatePlayerScore(playerId, totalScore)
  }

  // Mark ability as used
  markAbilityUsed(
    abilityMode.sourceCoords,
    abilityMode.isDeployAbility,
    false,
    abilityMode.readyStatusToRemove
  )

  // Clear mode and pass turn
  setTimeout(() => {
    setAbilityMode(null)
    if (nextPhase) {
      nextPhase(true) // forceTurnPass=true
    }
  }, TIMING.MODE_CLEAR_DELAY)

  // Unlock interaction
  setTimeout(() => {
    interactionLock.current = false
  }, TIMING.MODE_CLEAR_DELAY + 100)

  return true
}

/**
 * Handle SELECT_LINE_FOR_EXPLOIT_SCORING (Zius Setup, Unwavering Integrator Setup)
 * Single-click line selection with optional pass-through requirement
 */
function handleSelectLineForExploitScoring(
  coords: CellCoords,
  props: LineSelectionProps
): boolean {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    interactionLock,
    setAbilityMode,
    markAbilityUsed,
    updatePlayerScore,
    triggerFloatingText,
    commandContext
  } = props

  if (!abilityMode?.sourceCoords) {
    return false
  }

  // Prevent multiple clicks
  if (interactionLock.current) {
    return true
  }

  const gridSize = gameState.board.length
  const activeGridSize = gameState.activeGridSize

  // Get target coords (for Zius) or undefined (for Integrator)
  const targetCoords = abilityMode.payload?.targetCoords || commandContext?.lastMovedCardCoords

  // Use single-click selection
  const result = selectLineBySingleClick(
    coords,
    abilityMode.sourceCoords,
    [LineTypeEnum.HORIZONTAL, LineTypeEnum.VERTICAL],
    gridSize,
    activeGridSize,
    targetCoords // Require pass-through for Zius, optional for Integrator
  )

  if (!result.isValid || !result.line) {
    return true
  }

  // Lock interaction
  interactionLock.current = true

  const actorId = abilityMode.sourceCard?.ownerId ?? localPlayerId ?? gameState.activePlayerId!
  const line = result.line

  // Count Exploit counters in line
  const exploitCount = countStatusesInLine(
    line,
    gameState.board,
    'Exploit',
    actorId
  )

  // Award points
  if (exploitCount > 0) {
    if (abilityMode.sourceCoords) {
      triggerFloatingText({
        row: abilityMode.sourceCoords.row,
        col: abilityMode.sourceCoords.col,
        text: `+${exploitCount}`,
        playerId: actorId
      })
    }
    updatePlayerScore(actorId, exploitCount)
  }

  // Mark ability as used
  markAbilityUsed(
    abilityMode.sourceCoords,
    abilityMode.isDeployAbility,
    false,
    abilityMode.readyStatusToRemove
  )

  // Clear mode
  setTimeout(() => {
    setAbilityMode(null)
    interactionLock.current = false
  }, TIMING.MODE_CLEAR_DELAY)

  return true
}

/**
 * Handle SELECT_LINE_START / SELECT_LINE_END (Centurion, Zius)
 * Two-click line selection
 */
function handleTwoClickLineSelection(
  coords: CellCoords,
  props: LineSelectionProps,
  actionType: string
): boolean {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    markAbilityUsed,
    updatePlayerScore,
    triggerFloatingText,
    modifyBoardCardPower,
    scoreLine,
    nextPhase
  } = props

  if (!abilityMode) {
    return false
  }

  const gridSize = gameState.board.length
  const activeGridSize = gameState.activeGridSize

  // Step 1: First click - SELECT_LINE_START
  if (abilityMode.mode === 'SELECT_LINE_START') {
    setAbilityMode({
      type: 'ENTER_MODE',
      mode: 'SELECT_LINE_END',
      sourceCard: abilityMode.sourceCard,
      sourceCoords: abilityMode.sourceCoords,
      isDeployAbility: abilityMode.isDeployAbility,
      payload: {
        ...abilityMode.payload,
        firstCoords: coords
      }
    })
    return true
  }

  // Step 2: Second click - SELECT_LINE_END
  if (abilityMode.mode === 'SELECT_LINE_END' && abilityMode.payload?.firstCoords) {
    const firstCoords = abilityMode.payload.firstCoords as CellCoords

    // Determine allowed line types based on action type
    let allowedTypes: LineType[]
    if (actionType === 'ZIUS_SCORING' || actionType === 'SCORE_LINE') {
      allowedTypes = [LineTypeEnum.HORIZONTAL, LineTypeEnum.VERTICAL]
    } else if (actionType === 'CENTURION_BUFF') {
      allowedTypes = [LineTypeEnum.HORIZONTAL, LineTypeEnum.VERTICAL]
    } else {
      allowedTypes = [LineTypeEnum.HORIZONTAL, LineTypeEnum.VERTICAL]
    }

    // Validate line selection
    const result = selectLineByTwoClicks(
      firstCoords,
      coords,
      allowedTypes,
      gridSize,
      activeGridSize,
      actionType === 'ZIUS_SCORING' ? abilityMode.payload?.targetCoords : undefined
    )

    if (!result.isValid || !result.line) {
      return true
    }

    const line = result.line
    const actorId = abilityMode.sourceCard?.ownerId ?? localPlayerId ?? gameState.activePlayerId!

    // Execute based on action type
    if (actionType === 'ZIUS_SCORING') {
      // Count Exploit counters and award points
      const exploitCount = countStatusesInLine(line, gameState.board, 'Exploit', actorId)

      if (exploitCount > 0 && abilityMode.sourceCoords) {
        triggerFloatingText({
          row: abilityMode.sourceCoords.row,
          col: abilityMode.sourceCoords.col,
          text: `+${exploitCount}`,
          playerId: actorId
        })
        updatePlayerScore(actorId, exploitCount)
      }

      if (abilityMode.sourceCoords && abilityMode.sourceCoords.row >= 0) {
        markAbilityUsed(abilityMode.sourceCoords, abilityMode.isDeployAbility, false, abilityMode.readyStatusToRemove)
      }
    } else if (actionType === 'CENTURION_BUFF' && abilityMode.sourceCard && abilityMode.sourceCoords) {
      // Buff all allied cards in line
      const cards = filterCardsInLine(line, gameState.board, (card) => {
        if (card.id === abilityMode.sourceCard!.id) {
          return false // Skip self
        }
        if (card.ownerId !== actorId) {
          return false // Skip opponents
        }
        return true
      })

      for (const { coords: cardCoords } of cards) {
        modifyBoardCardPower(cardCoords, 1)
      }

      markAbilityUsed(abilityMode.sourceCoords, abilityMode.isDeployAbility, false, abilityMode.readyStatusToRemove)
    } else if (actionType === 'SCORE_LINE' || !actionType) {
      // Generic line scoring
      scoreLine(
        line.startRow,
        line.startCol,
        line.endRow,
        line.endCol,
        actorId
      )

      if (!abilityMode.payload?.skipNextPhase && nextPhase) {
        nextPhase()
      }
    }

    // Clear mode
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  return false
}

/**
 * Handle SELECT_DIAGONAL (Logistics Chain)
 * Two-click diagonal selection
 */
function handleSelectDiagonal(
  coords: CellCoords,
  props: LineSelectionProps
): boolean {
  const {
    abilityMode,
    setAbilityMode,
    scoreDiagonal,
    nextPhase,
    localPlayerId,
    gameState
  } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_DIAGONAL') {
    return false
  }

  // Step 1: First click - select center point
  if (!abilityMode.payload?.firstCoords) {
    setAbilityMode(prev => {
      if (!prev || prev.mode !== 'SELECT_DIAGONAL') {
        return prev
      }
      return {
        ...prev,
        payload: {
          ...(prev.payload || {}),
          firstCoords: coords
        }
      }
    })
    return true
  }

  // Step 2: Second click - select diagonal endpoint
  const firstCoords = abilityMode.payload.firstCoords as CellCoords
  const gridSize = gameState.board.length
  const activeGridSize = gameState.activeGridSize

  const result = selectLineByTwoClicks(
    firstCoords,
    coords,
    [LineTypeEnum.DIAGONAL_MAIN, LineTypeEnum.DIAGONAL_ANTI],
    gridSize,
    activeGridSize
  )

  if (!result.isValid || !result.line) {
    return true
  }

  const line = result.line
  const ownerId = abilityMode.payload?.playerId ?? localPlayerId ?? 0
  const bonusType = abilityMode.payload?.bonusType || 'point_per_support'

  // Execute diagonal scoring
  scoreDiagonal(
    line.startRow,
    line.startCol,
    line.endRow,
    line.endCol,
    ownerId,
    bonusType
  )

  // Advance phase unless skipNextPhase is set
  if (!abilityMode.payload.skipNextPhase && nextPhase) {
    nextPhase()
  }

  // Clear mode
  setAbilityMode(null)
  return true
}

/**
 * Main line selection handler
 * Routes to appropriate sub-handler based on ability mode
 */
export function handleLineSelection(
  coords: CellCoords,
  props: LineSelectionProps
): boolean {
  const { abilityMode } = props

  if (!abilityMode) {
    return false
  }

  const { mode, payload } = abilityMode

  // Route to appropriate handler
  switch (mode) {
    case 'SCORE_LAST_PLAYED_LINE':
      return handleScoreLastPlayedLine(coords, props)

    case 'SELECT_LINE_FOR_EXPLOIT_SCORING':
      return handleSelectLineForExploitScoring(coords, props)

    case 'SELECT_LINE_START':
    case 'SELECT_LINE_END':
      return handleTwoClickLineSelection(coords, props, payload?.actionType || '')

    case 'SELECT_DIAGONAL':
      return handleSelectDiagonal(coords, props)

    default:
      return false
  }
}