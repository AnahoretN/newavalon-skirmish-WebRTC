/**
 * Line Selection Handlers
 *
 * Handles line selection for abilities like Integrator, Zius, Centurion
 */

import type { AbilityAction, FloatingTextData } from '@/types'
import { TIMING } from '@/utils/common'
import { logger } from '@/utils/logger'

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
  isWebRTCMode?: boolean  // Whether WebRTC P2P mode is enabled
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
    isWebRTCMode = false,
  } = props

  if (!abilityMode) {
    return false
  }

  const { mode, sourceCard, sourceCoords, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  // Log for debugging
  logger.info('[lineSelectionHandlers] handleLineSelection called', {
    mode,
    hasSourceCoords: !!sourceCoords,
    sourceCoords,
    clickedCoords: coords,
    isWebRTCMode
  })

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

    // Check if this is WebRTC guest mode
    const hasWebrtcGlobal = typeof window !== 'undefined' && (window as any).webrtcManager
    const isHostFlag = hasWebrtcGlobal ? (window as any).webrtcIsHost : true
    const isWebRTCGuest = isWebRTCMode && hasWebrtcGlobal && !isHostFlag

    logger.info('[lineSelectionHandlers] Checking WebRTC mode', {
      isWebRTCMode,
      hasWebrtcGlobal,
      isHostFlag,
      isWebRTCGuest,
      mode,
      r1, c1, r2, c2
    })

    if (isWebRTCGuest) {
      // Guest: Calculate score locally, then send result to host
      const playerId = localPlayerId ?? gameState.activePlayerId!
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

      // Check for Data Liberator (allows scoring opponent's cards with Exploit)
      const hasActiveLiberator = gameState.board.some((row: any[]) =>
        row.some((cell: any) =>
          cell.card?.ownerId === playerId &&
          cell.card.name.toLowerCase().includes('data liberator') &&
          cell.card.statuses?.some((s: any) => s.type === 'Support'),
        ),
      )

      // Calculate score
      let totalScore = 0
      const scoreEvents: { row: number; col: number; text: string; playerId: number }[] = []

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

      logger.info('[lineSelectionHandlers] Guest calculated score', { totalScore, scoreEventsCount: scoreEvents.length })

      // Show floating texts locally (guest sees them immediately)
      if (scoreEvents.length > 0) {
        triggerFloatingText(scoreEvents)
      }

      // Update local score immediately so guest sees the updated score in their panel
      const webrtcManager = (window as any).webrtcManager
      if (totalScore > 0) {
        // Get current player score from gameState
        const currentPlayer = gameState.players.find((p: any) => p.id === playerId)
        const currentScore = currentPlayer?.score ?? 0
        const newScore = currentScore + totalScore

        // Update local state with new score
        updatePlayerScore(playerId, totalScore)

        // Send new total score to host (host will broadcast to other guests)
        // We send the NEW total score, not the delta, to avoid double-counting
        webrtcManager.sendMessageToHost({
          type: 'SCORING_LINE_SELECTED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          data: {
            sourceCoords: { row: r1, col: c1 },
            selectedCoords: { row: r2, col: c2 },
            mode: 'SCORE_LAST_PLAYED_LINE',
            newScore,  // Send new total score, not delta
            scoreEvents,
          },
          timestamp: Date.now()
        })
      } else {
        // Even with zero score, send the message to close scoring mode
        const currentPlayer = gameState.players.find((p: any) => p.id === playerId)
        const currentScore = currentPlayer?.score ?? 0

        webrtcManager.sendMessageToHost({
          type: 'SCORING_LINE_SELECTED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          data: {
            sourceCoords: { row: r1, col: c1 },
            selectedCoords: { row: r2, col: c2 },
            mode: 'SCORE_LAST_PLAYED_LINE',
            newScore: currentScore,  // Current score (no change)
            scoreEvents: [],
          },
          timestamp: Date.now()
        })
      }

      // Close mode immediately
      setAbilityMode(null)

      // Request pass turn - host will transition to next player with Preparation phase
      // This is done after sending the score so host has the updated score
      setTimeout(() => {
        webrtcManager.sendMessageToHost({
          type: 'REQUEST_PASS_TURN',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          timestamp: Date.now()
        })
      }, 100) // Small delay to ensure score update is processed first

      // Unlock after delay
      setTimeout(() => {
        interactionLock.current = false
      }, TIMING.MODE_CLEAR_DELAY)

      return true
    }

    // Host (or non-WebRTC): Process scoring locally
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

    // Send floating texts for all players to see
    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    // For WebRTC host: use updatePlayerScore to update UI immediately
    // updatePlayerScore will call through to HostManager's updateHostPlayerScore
    if (isWebRTCMode && (window as any).webrtcIsHost) {
      if (totalScore > 0) {
        // This will update UI and broadcast to guests
        updatePlayerScore(playerId, totalScore)
      }

      // Broadcast ability mode clear to guests
      const webrtcManager = (window as any).webrtcManager
      if (webrtcManager?.broadcastToGuests) {
        webrtcManager.broadcastToGuests({
          type: 'ABILITY_MODE_CLEARED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          data: {
            mode: 'SCORE_LAST_PLAYED_LINE',
            playerId,
            scoreEvents,
          },
          timestamp: Date.now()
        })
      }

      // CRITICAL: For host, delay nextPhase to allow React state update to propagate
      // This ensures the score update is visible before the phase changes
      if (nextPhase) {
        setTimeout(() => {
          nextPhase(true) // forceTurnPass=true to pass to next player
        }, 50) // Small delay to let React render the updated score
      }
    } else {
      // Non-WebRTC mode: use standard updatePlayerScore
      if (totalScore > 0) {
        updatePlayerScore(playerId, totalScore)
      }

      // Pass turn after scoring
      if (nextPhase) {
        nextPhase(true) // forceTurnPass=true to pass to next player
      }
    }

    // Mark ability as used and close mode (same pattern as other modes)
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }

    // Clear mode with standard delay (like all other ability modes)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

    // Unlock interaction after a short delay
    setTimeout(() => {
      interactionLock.current = false
    }, TIMING.MODE_CLEAR_DELAY + 100)

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
