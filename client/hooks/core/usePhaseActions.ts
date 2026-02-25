/**
 * usePhaseActions - Hook for phase-related actions
 *
 * Provides methods to request phase actions from the host.
 * In WebRTC P2P mode, guests send requests to host who makes the final decision.
 * In host mode, actions are processed locally.
 *
 * This hook works for both host and guest clients.
 */

import { useRef, useCallback, useEffect } from 'react'
import type { GameState } from '../../types'
import type { ScoringLine, GamePhase } from '../../host/phase/PhaseTypes'
import { getPhaseName } from '../../host/phase/PhaseTypes'
import { initializePhaseSystem } from '../../host/HostPhaseIntegration'
import { initializePhaseSystemForGuest } from '../../host/GuestPhaseIntegration'
import { encodePhaseAction, createPhaseMessage, PhaseActionType } from '../../host/phase/PhaseMessageCodec'

interface UsePhaseActionsProps {
  gameStateRef: React.MutableRefObject<GameState>
  localPlayerId: number | null
  isHost: boolean
  hostManager?: any
  guestConnection?: any
  onStateUpdate?: (newState: GameState) => void
  drawCard?: (playerId: number) => void  // For auto-draw sync
}

interface PhaseActionsResult {
  // Action methods
  nextPhase: (forceTurnPass?: boolean) => void
  previousPhase: () => void
  passTurn: () => void
  startScoring: () => void
  selectScoringLine: (line: ScoringLine) => void
  completeRound: () => void
  startNextRound: () => void
  startNewMatch: () => void

  // Direct phase control (no turn restrictions)
  setPhase: (phaseNumber: number) => void  // Directly set phase 0-4

  // State queries
  getCurrentPhase: () => number
  getCurrentPhaseName: () => string
  getActivePlayerId: () => number | null
  isMyTurn: () => boolean
  canAct: () => boolean
  isScoringStep: () => boolean
  isRoundEndModalOpen: () => boolean

  // Victory/round info
  getCurrentRound: () => number
  getVictoryThreshold: () => number
  checkRoundEnd: () => boolean
}

/**
 * Hook for phase actions
 * Works for both host (direct control) and guest (request to host)
 */
export function usePhaseActions(props: UsePhaseActionsProps): PhaseActionsResult {
  const {
    gameStateRef,
    localPlayerId,
    drawCard,
    isHost,
    hostManager,
    guestConnection,
    onStateUpdate
  } = props

  // Track if phase system is initialized
  const phaseSystemInitialized = useRef(false)

  /**
   * Initialize phase system on mount
   */
  useEffect(() => {
    if (phaseSystemInitialized.current) {
      return
    }

    if (isHost && hostManager) {
      // Initialize phase system on host
      try {
        initializePhaseSystem(hostManager, {
          onPhaseChanged: (_result) => {
            // Phase changed - state will be updated via HostManager's onStateUpdate
            if (onStateUpdate) {
              const state = hostManager.stateManager?.getState()
              if (state) onStateUpdate(state)
            }
          },
          onRoundEnded: (_info) => {
            // Round ended - update state
            if (onStateUpdate) {
              const state = hostManager.stateManager?.getState()
              if (state) onStateUpdate(state)
            }
          },
          onMatchEnded: () => {
            // Match ended - update state
            if (onStateUpdate) {
              const state = hostManager.stateManager?.getState()
              if (state) onStateUpdate(state)
            }
          }
        })
        phaseSystemInitialized.current = true
      } catch (e) {
        console.error('[usePhaseActions] Failed to initialize host phase system:', e)
      }
    } else if (!isHost && guestConnection) {
      // Initialize phase system on guest
      try {
        initializePhaseSystemForGuest(guestConnection, {
          gameStateRef,
          localPlayerId,  // Pass localPlayerId for auto-draw detection
          onDrawCard: drawCard,  // Pass drawCard for auto-draw (works like clicking deck)
          onPhaseTransition: (_oldPhase, _newPhase, _oldActivePlayer, _newActivePlayer) => {
            // Phase transition - trigger state update
            // CRITICAL: Don't trigger update for initial Preparation→Setup transition at game start
            // Host already broadcasts complete state with drawn cards via CARD_STATE
            // If we trigger update here, guests will send empty STATE_UPDATE_COMPACT back
            const isInitialGameStartTransition = _oldPhase === 0 && _newPhase === 1
            if (onStateUpdate && !isInitialGameStartTransition) {
              onStateUpdate(gameStateRef.current)
            }
          },
          onTurnChanged: () => {
            // Turn changed - trigger state update
            if (onStateUpdate) {
              onStateUpdate(gameStateRef.current)
            }
          },
          onRoundEnded: () => {
            // Round ended - trigger state update
            if (onStateUpdate) {
              onStateUpdate(gameStateRef.current)
            }
          },
          onMatchEnded: () => {
            // Match ended - trigger state update
            if (onStateUpdate) {
              onStateUpdate(gameStateRef.current)
            }
          },
          onScoringModeStarted: (activePlayerId: number, validLinesCount: number) => {
            // Scoring mode started - update state
            if (onStateUpdate) {
              const state = gameStateRef.current
              state.isScoringStep = true
              onStateUpdate(state)
            }
          },
          onScoringModeCompleted: (info: any) => {
            // Scoring mode completed - update state
            if (onStateUpdate) {
              const state = gameStateRef.current
              state.isScoringStep = false
              onStateUpdate(state)
            }
          }
        })
        phaseSystemInitialized.current = true
      } catch (e) {
        console.error('[usePhaseActions] Failed to initialize guest phase system:', e)
      }
    }
  }, [isHost, hostManager, guestConnection, gameStateRef, onStateUpdate, localPlayerId, drawCard])

  /**
   * Send phase action request
   * Both host and guest send PHASE_ACTION_REQUEST message
   * Host processes it via handlePhaseMessage, guest sends to host
   */
  const sendPhaseAction = useCallback((action: string, data?: any) => {
    if (!localPlayerId) {
      console.warn('[usePhaseActions] No local player ID')
      return
    }

    const gameState = gameStateRef.current
    // NOTE: Any player can change phases at any time - no turn restriction

    // Map action string to PhaseActionType number
    const actionMap: Record<string, number> = {
      'NEXT_PHASE': 1,
      'PREVIOUS_PHASE': 2,
      'PASS_TURN': 3,
      'START_SCORING': 4,
    }

    const actionType = actionMap[action]
    if (actionType === undefined) {
      console.warn('[usePhaseActions] Unknown action:', action)
      return
    }

    // Debug logging
    console.log('[usePhaseActions] Sending phase action:', {
      action,
      actionType,
      localPlayerId,
      isHost,
      currentPhase: gameState.currentPhase,
      activePlayerId: gameState.activePlayerId
    })

    try {
      if (isHost && hostManager) {
        // Host processes action directly and broadcasts result
        hostManager.handlePhaseAction(actionType, localPlayerId)
      } else if (guestConnection) {
        // Guest sends request to host
        // Create binary message
        const binaryData = encodePhaseAction(actionType, localPlayerId, data)
        const message = createPhaseMessage(binaryData, 'PHASE_ACTION_REQUEST')
        guestConnection.sendMessage(message)
      }
    } catch (e) {
      console.error('[usePhaseActions] Failed to send phase action:', e)
    }
  }, [localPlayerId, isHost, hostManager, guestConnection, gameStateRef])

  /**
   * Move to next phase
   * @param forceTurnPass - If true, pass turn to next player instead of advancing phase
   */
  const nextPhase = useCallback((forceTurnPass?: boolean) => {
    if (forceTurnPass) {
      console.log('[usePhaseActions] nextPhase called with forceTurnPass=true - will send PASS_TURN action')
      sendPhaseAction('PASS_TURN', { reason: 'scoring_complete' })
    } else {
      console.log('[usePhaseActions] nextPhase called - will send NEXT_PHASE action')
      sendPhaseAction('NEXT_PHASE')
    }
  }, [sendPhaseAction])

  /**
   * Move to previous phase
   */
  const previousPhase = useCallback(() => {
    console.log('[usePhaseActions] previousPhase called - will send PREVIOUS_PHASE action')
    sendPhaseAction('PREVIOUS_PHASE')
  }, [sendPhaseAction])

  /**
   * Pass turn to next player
   */
  const passTurn = useCallback(() => {
    console.log('[usePhaseActions] passTurn called - will send PASS_TURN action')
    sendPhaseAction('PASS_TURN', { reason: 'manual' })
  }, [sendPhaseAction])

  /**
   * Enter scoring phase
   */
  const startScoring = useCallback(() => {
    sendPhaseAction('START_SCORING')
  }, [sendPhaseAction])

  /**
   * Select a scoring line
   */
  const selectScoringLine = useCallback((line: ScoringLine) => {
    sendPhaseAction('SELECT_LINE', { line })
  }, [sendPhaseAction])

  /**
   * Complete round (close round end modal)
   */
  const completeRound = useCallback(() => {
    sendPhaseAction('ROUND_COMPLETE')
  }, [sendPhaseAction])

  /**
   * Start next round
   */
  const startNextRound = useCallback(() => {
    sendPhaseAction('START_NEXT_ROUND')
  }, [sendPhaseAction])

  /**
   * Start new match
   */
  const startNewMatch = useCallback(() => {
    sendPhaseAction('START_NEW_MATCH')
  }, [sendPhaseAction])

  /**
   * Send phase action directly without turn restrictions
   * Any player can change phases at any time
   */
  const sendPhaseActionDirect = useCallback((action: string, data?: any) => {
    if (!localPlayerId) {
      console.warn('[usePhaseActions] No local player ID')
      return
    }

    const gameState = gameStateRef.current

    // Map action string to PhaseActionType number
    const actionMap: Record<string, number> = {
      'NEXT_PHASE': PhaseActionType.NEXT_PHASE,
      'PREVIOUS_PHASE': PhaseActionType.PREVIOUS_PHASE,
      'PASS_TURN': PhaseActionType.PASS_TURN,
      'START_SCORING': PhaseActionType.START_SCORING,
      'SET_PHASE': PhaseActionType.SET_PHASE,
    }

    const actionType = actionMap[action]
    if (actionType === undefined) {
      console.warn('[usePhaseActions] Unknown action:', action)
      return
    }

    console.log('[usePhaseActions] Sending direct phase action:', {
      action,
      actionType,
      localPlayerId,
      isHost,
      currentPhase: gameState.currentPhase,
      data
    })

    try {
      if (isHost && hostManager) {
        // Host processes action directly and broadcasts result
        hostManager.handlePhaseAction(actionType, localPlayerId, data)
      } else if (guestConnection) {
        // Guest sends request to host
        // Create binary message
        const binaryData = encodePhaseAction(actionType, localPlayerId, data)
        const message = createPhaseMessage(binaryData, 'PHASE_ACTION_REQUEST')
        guestConnection.sendMessage(message)
      }
    } catch (e) {
      console.error('[usePhaseActions] Failed to send phase action:', e)
    }
  }, [localPlayerId, isHost, hostManager, guestConnection, gameStateRef])

  /**
   * Directly set a specific phase (0-4)
   * Any player can call this at any time
   */
  const setPhase = useCallback((phaseNumber: number) => {
    const clampedPhase = Math.max(0, Math.min(4, phaseNumber))
    console.log('[usePhaseActions] setPhase called:', phaseNumber, 'clamped:', clampedPhase)
    sendPhaseActionDirect('SET_PHASE', { phase: clampedPhase })
  }, [sendPhaseActionDirect])

  /**
   * Get current phase
   */
  const getCurrentPhase = useCallback((): number => {
    return gameStateRef.current.currentPhase
  }, [gameStateRef])

  /**
   * Get current phase name
   */
  const getCurrentPhaseName = useCallback((): string => {
    const phase = getCurrentPhase()
    if (phase === 0) return 'Preparation' // Hidden
    return getPhaseName(phase as GamePhase)
  }, [getCurrentPhase])

  /**
   * Get active player ID
   */
  const getActivePlayerId = useCallback((): number | null => {
    return gameStateRef.current.activePlayerId
  }, [gameStateRef])

  /**
   * Check if it's my turn
   */
  const isMyTurn = useCallback((): boolean => {
    return gameStateRef.current.activePlayerId === localPlayerId
  }, [gameStateRef, localPlayerId])

  /**
   * Check if current player can act (either their turn or controlling dummy)
   */
  const canAct = useCallback((): boolean => {
    const gameState = gameStateRef.current
    const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
    return gameState.activePlayerId === localPlayerId || (activePlayer?.isDummy ?? false)
  }, [gameStateRef, localPlayerId])

  /**
   * Check if in scoring step
   */
  const isScoringStep = useCallback((): boolean => {
    return gameStateRef.current.isScoringStep || false
  }, [gameStateRef])

  /**
   * Check if round end modal is open
   */
  const isRoundEndModalOpen = useCallback((): boolean => {
    return gameStateRef.current.isRoundEndModalOpen || false
  }, [gameStateRef])

  /**
   * Get current round number
   */
  const getCurrentRound = useCallback((): number => {
    return gameStateRef.current.currentRound
  }, [gameStateRef])

  /**
   * Get victory threshold for current round
   * Round 1: 20, Round 2: 30, Round 3: 40
   */
  const getVictoryThreshold = useCallback((): number => {
    const round = getCurrentRound()
    return 10 + (round * 10)
  }, [getCurrentRound])

  /**
   * Check if round should end (someone has enough points)
   */
  const checkRoundEnd = useCallback((): boolean => {
    const threshold = getVictoryThreshold()
    return gameStateRef.current.players.some(p => p.score >= threshold)
  }, [gameStateRef, getVictoryThreshold])

  return {
    // Action methods
    nextPhase,
    previousPhase,
    passTurn,
    startScoring,
    selectScoringLine,
    completeRound,
    startNextRound,
    startNewMatch,

    // Direct phase control (no turn restrictions)
    setPhase,

    // State queries
    getCurrentPhase,
    getCurrentPhaseName,
    getActivePlayerId,
    isMyTurn,
    canAct,
    isScoringStep,
    isRoundEndModalOpen,

    // Victory/round info
    getCurrentRound,
    getVictoryThreshold,
    checkRoundEnd,
  }
}

export default usePhaseActions
