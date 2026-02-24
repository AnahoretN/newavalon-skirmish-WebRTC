/**
 * usePhaseManagement - Хук для отображения фаз игры
 *
 * Отображает текущую фазу и информацию о ходе в UI.
 * Управление фазами происходит через usePhaseActions или напрямую на хосте.
 */

import { useMemo } from 'react'
import type { GameState } from '../../types'
import type { GamePhase } from '../../host/phase/PhaseTypes'
import { getPhaseName, getVictoryThreshold } from '../../host/phase/PhaseTypes'

interface UsePhaseManagementProps {
  gameStateRef: React.MutableRefObject<GameState>
}

interface PhaseDisplayInfo {
  currentPhase: number
  phaseName: string
  phaseIndex: number  // For display (1-4, hiding phase 0)
  isActive: boolean
  isPreparation: boolean
  isSetup: boolean
  isMain: boolean
  isCommit: boolean
  isScoring: boolean
}

interface RoundDisplayInfo {
  currentRound: number
  turnNumber: number
  victoryThreshold: number
  isRoundOver: boolean
  matchWinner: number | null
}

export function usePhaseManagement(props: UsePhaseManagementProps) {
  const { gameStateRef } = props

  /**
   * Get phase display info
   */
  const getPhaseInfo = useMemo(() => {
    const currentPhase = gameStateRef.current.currentPhase
    const phaseName = getPhaseName(currentPhase as GamePhase)

    const info: PhaseDisplayInfo = {
      currentPhase,
      phaseName: currentPhase === 0 ? '' : phaseName,
      phaseIndex: Math.max(0, currentPhase - 1), // Convert 0-4 to display index
      isActive: true,
      isPreparation: currentPhase === 0,
      isSetup: currentPhase === 1,
      isMain: currentPhase === 2,
      isCommit: currentPhase === 3,
      isScoring: currentPhase === 4,
    }

    return info
  }, [gameStateRef])

  /**
   * Get round display info
   */
  const getRoundInfo = useMemo(() => {
    const state = gameStateRef.current
    const currentRound = state.currentRound
    const victoryThreshold = getVictoryThreshold(currentRound)

    // Check if round is over (anyone met threshold)
    const isRoundOver = state.players.some(p => p.score >= victoryThreshold)

    const info: RoundDisplayInfo = {
      currentRound,
      turnNumber: state.turnNumber,
      victoryThreshold,
      isRoundOver,
      matchWinner: state.gameWinner,
    }

    return info
  }, [gameStateRef])

  /**
   * Get all phase names for display
   */
  const getAllPhaseNames = useMemo(() => {
    return ['Setup', 'Main', 'Commit', 'Scoring']
  }, [])

  /**
   * Get round winners
   */
  const getRoundWinners = useMemo(() => {
    return gameStateRef.current.roundWinners || {}
  }, [gameStateRef])

  /**
   * Check if match is over
   */
  const isMatchOver = useMemo(() => {
    return gameStateRef.current.gameWinner !== null
  }, [gameStateRef])

  return {
    getPhaseInfo,
    getRoundInfo,
    getAllPhaseNames,
    getRoundWinners,
    isMatchOver,

    // Convenience getters
    getCurrentPhase: () => gameStateRef.current.currentPhase,
    getCurrentPhaseName: () => {
      const phase = gameStateRef.current.currentPhase
      return phase === 0 ? '' : getPhaseName(phase as GamePhase)
    },
    getActivePlayerId: () => gameStateRef.current.activePlayerId,
    getStartingPlayerId: () => gameStateRef.current.startingPlayerId,
    isScoringStep: () => gameStateRef.current.isScoringStep || false,
    isRoundEndModalOpen: () => gameStateRef.current.isRoundEndModalOpen || false,
  }
}
