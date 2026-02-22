/**
 * useScoring - Хук для подсчёта очков
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - scoreLine - подсчитать очки за линию (горизонтальную или вертикальную)
 * - scoreDiagonal - подсчитать очки за диагональ
 */

import { useCallback } from 'react'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import { deepCloneState } from '../../utils/common'
import { passTurnToNextPlayer } from '../../host/PhaseManagement'
import type { GameState, FloatingTextData } from '../../types'

interface UseScoringProps {
  ws: React.MutableRefObject<WebSocket | null>
  gameStateRef: React.MutableRefObject<GameState>
  updateState: (updater: (prevState: GameState) => GameState) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (events: Omit<FloatingTextData, 'timestamp'>[]) => void
  clearTargetingMode?: () => void
  webrtcIsHostRef?: React.MutableRefObject<boolean>
}

export function useScoring(props: UseScoringProps) {
  const {
    ws,
    gameStateRef,
    updateState,
    updatePlayerScore,
    triggerFloatingText,
    clearTargetingMode,
    webrtcIsHostRef,
  } = props

  /**
   * Score a line (horizontal or vertical) for a player
   */
  const scoreLine = useCallback((row1: number, col1: number, row2: number, col2: number, playerId: number) => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      return
    }
    // Block scoring after round has ended
    if (currentState.isRoundEndModalOpen) {
      return
    }

    const hasActiveLiberator = currentState.board.some(row =>
      row.some(cell =>
        cell.card?.ownerId === playerId &&
              cell.card.name.toLowerCase().includes('data liberator') &&
              cell.card.statuses?.some(s => s.type === 'Support'),
      ),
    )

    const gridSize = currentState.board.length
    let rStart = row1, rEnd = row1, cStart = col1, cEnd = col1
    if (row1 === row2) {
      rStart = row1; rEnd = row1
      cStart = 0; cEnd = gridSize - 1
    } else if (col1 === col2) {
      cStart = col1; cEnd = col1
      rStart = 0; rEnd = gridSize - 1
    } else {
      return
    }

    let totalScore = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let r = rStart; r <= rEnd; r++) {
      for (let c = cStart; c <= cEnd; c++) {
        const cell = currentState.board[r][c]
        const card = cell.card

        if (card && !card.statuses?.some(s => s.type === 'Stun')) {
          const isOwner = card.ownerId === playerId
          const hasExploit = card.statuses?.some(s => s.type === 'Exploit' && s.addedByPlayerId === playerId)

          // Cards with your Exploit tokens score Points for you, regardless of who owns the card
          // The isOwner check is for normal scoring (your own cards)
          // The hasExploit check is for Data Liberator ability - it allows scoring other players' cards with your Exploit tokens
          if (isOwner || (hasActiveLiberator && hasExploit)) {
            const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            if (points > 0) {
              totalScore += points
              scoreEvents.push({
                row: r,
                col: c,
                text: `+${points}`,
                playerId: playerId,
              })
            }
          }
        }
      }
    }

    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    // Update score
    const isWebRTCMode = getWebRTCEnabled()

    // Use updateState in WebRTC mode to broadcast delta, use updatePlayerScore in WebSocket mode
    if (isWebRTCMode) {
      updateState(prevState => ({
        ...prevState,
        players: prevState.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + totalScore) }
            : p
        ),
      }))
    } else {
      updatePlayerScore(playerId, totalScore)
    }

    // For WebSocket mode, also send to server
    if (!isWebRTCMode) {
      updatePlayerScore(playerId, totalScore)
    }

    // Case 3: Auto-pass after scoring: if in Scoring phase (4) and points were scored,
    // automatically pass turn to next player after a short delay
    // IMPORTANT: In WebRTC mode, ONLY the host should trigger turn passing
    // Guests should wait for the host to broadcast the state change
    const shouldAutoPass = totalScore > 0 &&
      currentState.currentPhase === 4 &&
      currentState.activePlayerId === playerId &&
      (!isWebRTCMode || webrtcIsHostRef?.current !== false) // In WebRTC, only host auto-passes

    if (shouldAutoPass) {
      const gameId = currentState.gameId
      setTimeout(() => {
        // Clear targeting mode first (for all clients)
        clearTargetingMode?.()

        if (isWebRTCMode) {
          // WebRTC mode: Pass turn locally (host only - guarded by shouldAutoPass check)
          updateState(prevState => passTurnToNextPlayer(prevState))
        } else if (ws.current?.readyState === WebSocket.OPEN && gameId) {
          // WebSocket mode: Send NEXT_PHASE to server
          ws.current.send(JSON.stringify({
            type: 'NEXT_PHASE',
            gameId: gameId
          }))
        }
      }, 100) // 100ms delay to show scoring animation
    }
  }, [triggerFloatingText, updatePlayerScore, updateState, ws, gameStateRef, clearTargetingMode, passTurnToNextPlayer, webrtcIsHostRef])

  /**
   * Score a diagonal for a player with optional bonus per support
   */
  const scoreDiagonal = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      return
    }
    // Block scoring after round has ended
    if (currentState.isRoundEndModalOpen) {
      return
    }

    const dRow = r2 > r1 ? 1 : -1
    const dCol = c2 > c1 ? 1 : -1
    const steps = Math.abs(r1 - r2)

    let totalScore = 0
    let totalBonus = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let i = 0; i <= steps; i++) {
      const r = r1 + (i * dRow)
      const c = c1 + (i * dCol)

      if (r < 0 || r >= currentState.board.length || c < 0 || c >= currentState.board.length) {
        continue
      }

      const cell = currentState.board[r][c]
      const card = cell.card

      if (card && !card.statuses?.some(s => s.type === 'Stun')) {
        const isOwner = card.ownerId === playerId
        const hasExploit = card.statuses?.some(s => s.type === 'Exploit' && s.addedByPlayerId === playerId)

        // Cards with your Exploit tokens score Points for you, regardless of who owns the card
        if (isOwner || hasExploit) {
          const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
          if (points > 0) {
            totalScore += points
            scoreEvents.push({
              row: r,
              col: c,
              text: `+${points}`,
              playerId: playerId,
            })
          }

          if (bonusType && card.statuses?.some(s => s.type === 'Support' && s.addedByPlayerId === playerId)) {
            totalBonus += 1
          }
        }
      }
    }

    if (bonusType === 'point_per_support' && totalBonus > 0) {
      totalScore += totalBonus
    }

    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    // Update score
    const isWebRTCMode = getWebRTCEnabled()

    // Use updateState in WebRTC mode to broadcast delta, use updatePlayerScore in WebSocket mode
    if (isWebRTCMode) {
      updateState(prevState => ({
        ...prevState,
        players: prevState.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + totalScore) }
            : p
        ),
      }))
    } else {
      updatePlayerScore(playerId, totalScore)
    }

    // For WebSocket mode, also send to server
    if (!isWebRTCMode) {
      updatePlayerScore(playerId, totalScore)
    }

    // Handle draw_per_support bonus - needs local state update for hand/deck
    if (bonusType === 'draw_per_support' && totalBonus > 0) {
      updateState(prevState => {
        const newState: GameState = deepCloneState(prevState)
        const player = newState.players.find(p => p.id === playerId)
        if (player && player.deck.length > 0) {
          for (let i = 0; i < totalBonus; i++) {
            if (player.deck.length > 0) {
              player.hand.push(player.deck.shift()!)
            }
          }
        }
        return newState
      })
    }

    // Case 3: Auto-pass after scoring: if in Scoring phase (4) and points were scored,
    // automatically pass turn to next player after a short delay
    // IMPORTANT: In WebRTC mode, ONLY the host should trigger turn passing
    // Guests should wait for the host to broadcast the state change
    const shouldAutoPass = totalScore > 0 &&
      currentState.currentPhase === 4 &&
      currentState.activePlayerId === playerId &&
      (!isWebRTCMode || webrtcIsHostRef?.current !== false) // In WebRTC, only host auto-passes

    if (shouldAutoPass) {
      const gameId = currentState.gameId
      setTimeout(() => {
        // Clear targeting mode first (for all clients)
        clearTargetingMode?.()

        if (isWebRTCMode) {
          // WebRTC mode: Pass turn locally (host only - guarded by shouldAutoPass check)
          updateState(prevState => passTurnToNextPlayer(prevState))
        } else if (ws.current?.readyState === WebSocket.OPEN && gameId) {
          // WebSocket mode: Send NEXT_PHASE to server
          ws.current.send(JSON.stringify({
            type: 'NEXT_PHASE',
            gameId: gameId
          }))
        }
      }, 500) // 500ms delay to show scoring animation
    }
  }, [triggerFloatingText, updatePlayerScore, updateState, ws, gameStateRef, clearTargetingMode, passTurnToNextPlayer, webrtcIsHostRef])

  return {
    scoreLine,
    scoreDiagonal,
  }
}
