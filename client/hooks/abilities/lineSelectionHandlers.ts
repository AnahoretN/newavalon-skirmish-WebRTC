/**
 * Line Selection Handlers
 *
 * Handles line selection for abilities like Integrator, Zius, Centurion
 */

import type { AbilityAction, FloatingTextData } from '@/types'
import { TIMING } from '@/utils/common'

/* eslint-disable @typescript-eslint/no-unused-vars -- props passed to functions but not all used in every function */

export interface LineSelectionProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  interactionLock: React.MutableRefObject<boolean>
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  nextPhase: () => void
  modifyBoardCardPower: (coords: { row: number; col: number }, delta: number) => void
  scoreLine: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  commandContext: any
}

/**
 * Handle line selection for various ability modes
 * Returns true if the selection was handled, false otherwise
 */
export function handleLineSelection(
  coords: { row: number; col: number },
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
    modifyBoardCardPower,
    scoreLine,
    scoreDiagonal,
    commandContext,
  } = props

  if (!abilityMode) {
    return false
  }

  const { mode, sourceCard, sourceCoords, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  // SCORE_LAST_PLAYED_LINE (Integrator)
  if (mode === 'SCORE_LAST_PLAYED_LINE' && abilityMode.sourceCoords) {
    // Prevent multiple clicks
    if (interactionLock.current) {
      return true
    }

    const { row: r1, col: c1 } = abilityMode.sourceCoords
    const { row: r2, col: c2 } = coords
    if (r1 !== r2 && c1 !== c2) {
      return true
    }

    // Lock interaction to prevent multiple clicks
    interactionLock.current = true

    // Calculate score locally first
    const playerId = gameState.activePlayerId!
    const gridSize = gameState.board.length
    let rStart = r1, rEnd = r1, cStart = c1, cEnd = c1
    if (r1 === r2) {
      rStart = r1; rEnd = r1
      cStart = 0; cEnd = gridSize - 1
    } else if (c1 === c2) {
      cStart = c2; cEnd = c2
      rStart = 0; rEnd = gridSize - 1
    } else {
      interactionLock.current = false
      return true
    }

    const hasActiveLiberator = gameState.board.some((row: any[]) =>
      row.some((cell: any) =>
        cell.card?.ownerId === playerId &&
        cell.card.name.toLowerCase().includes('data liberator') &&
        cell.card.statuses?.some((s: any) => s.type === 'Support'),
      ),
    )

    let totalScore = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let r = rStart; r <= rEnd; r++) {
      for (let c = cStart; c <= cEnd; c++) {
        const cell = gameState.board[r][c]
        const card = cell.card
        if (card && !card.statuses?.some((s: any) => s.type === 'Stun')) {
          const isOwner = card.ownerId === playerId
          const hasExploit = card.statuses?.some((s: any) => s.type === 'Exploit' && s.addedByPlayerId === playerId)
          if (isOwner || (hasActiveLiberator && hasExploit && card.ownerId !== playerId)) {
            const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            if (points > 0) {
              totalScore += points
              scoreEvents.push({ row: r, col: c, text: `+${points}`, playerId })
            }
          }
        }
      }
    }

    // Clear ability mode immediately to prevent further interactions
    setAbilityMode(null)

    // Send floating texts for all players to see
    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    // Update score using updatePlayerScore which handles both local update and server sync
    if (totalScore > 0) {
      updatePlayerScore(playerId, totalScore)
    }

    // Pass turn after scoring - nextPhase will send NEXT_PHASE to server
    nextPhase()

    // Unlock interaction after a short delay
    setTimeout(() => {
      interactionLock.current = false
    }, 200)
    return true
  }

  // SELECT_LINE_START
  if (mode === 'SELECT_LINE_START') {
    setAbilityMode({
      type: 'ENTER_MODE',
      mode: 'SELECT_LINE_END',
      sourceCard,
      sourceCoords,
      isDeployAbility,
      payload: { ...payload, firstCoords: coords },
    })
    return true
  }

  // SELECT_LINE_END
  if (mode === 'SELECT_LINE_END' && payload?.firstCoords) {
    const { row: r1, col: c1 } = payload.firstCoords
    const { row: r2, col: c2 } = coords
    if (r1 !== r2 && c1 !== c2) {
      return true
    }
    const actionType = payload.actionType

    const actorId = sourceCard?.ownerId ?? (gameState.players.find((p: any) => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))

    // ZIUS_SCORING
    if (actionType === 'ZIUS_SCORING') {
      // Validate that the selected line passes through the target card (where Exploit was placed)
      const targetCoords = commandContext.lastMovedCardCoords

      if (targetCoords) {
        // Check if targetCoords is on the selected line
        const isOnRow = r1 === r2 && targetCoords.row === r1
        const isOnCol = c1 === c2 && targetCoords.col === c1

        if (!isOnRow && !isOnCol) {
          // Selected line does NOT pass through the target card - invalid selection
          return true
        }
      }

      const gridSize = gameState.board.length
      let startR = 0, endR = gridSize - 1
      let startC = 0, endC = gridSize - 1

      if (r1 === r2) {
        startR = endR = r1
      } else if (c1 === c2) {
        startC = endC = c1
      } else {
        return true
      }

      let exploitCount = 0
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) {
          const cell = gameState.board[r][c]
          if (cell.card) {
            exploitCount += cell.card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
          }
        }
      }

      if (exploitCount > 0 && actorId) {
        if (sourceCoords) {
          triggerFloatingText({
            row: sourceCoords.row,
            col: sourceCoords.col,
            text: `+${exploitCount}`,
            playerId: actorId,
          })
        }
        updatePlayerScore(actorId, exploitCount)
      }
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
    }
    // CENTURION_BUFF
    else if (actionType === 'CENTURION_BUFF' && sourceCard && sourceCoords && actorId) {
      const gridSize = gameState.board.length
      let startR = 0, endR = gridSize - 1
      let startC = 0, endC = gridSize - 1
      if (r1 === r2) {
        startR = endR = r1
      } else {
        startC = endC = c1
      }
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) {
          const targetCard = gameState.board[r][c].card
          if (targetCard) {
            const isSelf = targetCard.id === sourceCard.id
            const isOwner = targetCard.ownerId === actorId
            const activePlayer = gameState.players.find((p: any) => p.id === actorId)
            const targetPlayer = gameState.players.find((p: any) => p.id === targetCard.ownerId)
            const isTeammate = activePlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined && activePlayer.teamId === targetPlayer.teamId
            if (!isSelf && (isOwner || isTeammate)) {
              modifyBoardCardPower({ row: r, col: c }, 1)
            }
          }
        }
      }
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }
    // SCORE_LINE or generic
    else if (actionType === 'SCORE_LINE' || !actionType) {
      scoreLine(r1, c1, r2, c2, actorId!)
      // Advance phase after scoring, unless skipNextPhase is set (e.g., Logistics Chain)
      if (!payload.skipNextPhase) {
        nextPhase()
      }
    }
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SELECT_DIAGONAL
  if (mode === 'SELECT_DIAGONAL' && payload.actionType === 'SCORE_DIAGONAL') {
    const actorId = sourceCard?.ownerId ?? (gameState.players.find((p: any) => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))
    if (!payload.firstCoords) {
      setAbilityMode({ ...abilityMode, payload: { ...payload, firstCoords: coords } })
      return true
    } else {
      const { row: r1, col: c1 } = payload.firstCoords
      const { row: r2, col: c2 } = coords

      if (Math.abs(r1 - r2) !== Math.abs(c1 - c2)) {
        setAbilityMode(null)
        return true
      }

      scoreDiagonal(r1, c1, r2, c2, actorId!, payload.bonusType)
      // Advance phase after scoring, unless skipNextPhase is set (e.g., Logistics Chain)
      if (!payload.skipNextPhase) {
        nextPhase()
      }
      setAbilityMode(null)  // Clear immediately to prevent duplicate processing
      return true
    }
  }

  return false
}
