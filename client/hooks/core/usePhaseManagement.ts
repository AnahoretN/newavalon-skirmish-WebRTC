/**
 * usePhaseManagement - Хук для управления фазами и раундами игры
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - toggleActivePlayer - переключить активного игрока
 * - toggleAutoDraw - переключить автодобор карт
 * - setPhase - установить фазу
 * - nextPhase - следующая фаза
 * - prevPhase - предыдущая фаза
 * - closeRoundEndModal - закрыть модалку конца раунда и начать следующий
 * - closeRoundEndModalOnly - просто закрыть модалку
 * - resetGame - сбросить игру в лобби
 */

import { useCallback } from 'react'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import { logger } from '../../utils/logger'
import { deepCloneState } from '../../utils/common'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import { toggleActivePlayer as toggleActivePlayerPhase, passTurnToNextPlayer, playerHasCardsOnBoard } from '../../host/PhaseManagement'
import type { GameState, Board, DeckType } from '../../types'

interface UsePhaseManagementProps {
  ws: React.MutableRefObject<WebSocket | null>
  webrtcManagerRef: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  gameStateRef: React.MutableRefObject<GameState>
  scoreDeltaAccumulator: Map<number, { delta: number, timerId: ReturnType<typeof setTimeout> }>
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
  updateState: (updater: (prevState: GameState) => GameState) => void
  abilityMode?: any
  setAbilityMode?: ((mode: any) => void) | null
  createDeck: (deckType: DeckType, playerId: number, playerName: string) => any[]
}

export function usePhaseManagement(props: UsePhaseManagementProps) {
  const {
    ws,
    webrtcManagerRef,
    webrtcIsHostRef,
    gameStateRef,
    scoreDeltaAccumulator,
    setGameState,
    updateState,
    abilityMode,
    setAbilityMode,
    createDeck,
  } = props

  /**
   * Toggle active player
   */
  const toggleActivePlayer = useCallback((playerId: number) => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode && webrtcManagerRef.current) {
      // WebRTC P2P mode
      if (webrtcIsHostRef.current) {
        // Host: process locally using toggleActivePlayer from PhaseManagement
        logger.info(`[toggleActivePlayer] Host toggling active player to ${playerId}`)
        setGameState(prev => {
          // Use the imported toggleActivePlayer function from PhaseManagement
          const newState = toggleActivePlayerPhase(prev, playerId)
          // Broadcast to guests via WebRTC
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'ACTIVE_PLAYER_CHANGED',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: {
                activePlayerId: newState.activePlayerId,
                currentPhase: newState.currentPhase,
                turnNumber: newState.turnNumber
              },
              timestamp: Date.now()
            })
          }
          return newState
        })
      } else {
        // Guest: send to host
        webrtcManagerRef.current.sendMessageToHost({
          type: 'TOGGLE_ACTIVE_PLAYER',
          senderId: undefined,
          data: { playerId },
          timestamp: Date.now()
        })
        logger.info(`[toggleActivePlayer] Sent TOGGLE_ACTIVE_PLAYER for player ${playerId} via WebRTC`)
      }
    } else if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      // Flush any pending score deltas before toggling active player
      // This ensures server has up-to-date scores for round end check
      scoreDeltaAccumulator.forEach((accumulated, pid) => {
        clearTimeout(accumulated.timerId)
        logger.info(`[ScoreFlush] Flushing on toggle: player=${pid}, delta=${accumulated.delta}`)
        ws.current!.send(JSON.stringify({
          type: 'UPDATE_PLAYER_SCORE',
          gameId: gameStateRef.current.gameId,
          playerId: pid,
          delta: accumulated.delta
        }))
      })
      scoreDeltaAccumulator.clear()

      ws.current.send(JSON.stringify({
        type: 'TOGGLE_ACTIVE_PLAYER',
        gameId: gameStateRef.current.gameId,
        playerId
      }))
    }
  }, [ws, webrtcManagerRef, webrtcIsHostRef, gameStateRef, scoreDeltaAccumulator, setGameState])

  /**
   * Toggle auto draw for a player
   */
  const toggleAutoDraw = useCallback((playerId: number, enabled: boolean) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'TOGGLE_AUTO_DRAW',
        gameId: gameStateRef.current.gameId,
        playerId,
        enabled
      }))
    }
  }, [])

  /**
   * Set current phase
   */
  const setPhase = useCallback((phaseIndex: number) => {
    // Check if we need to clear line selection mode
    const isClearingLineSelectionMode = abilityMode && setAbilityMode && abilityMode.mode &&
      ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'].includes(abilityMode.mode);

    if (isClearingLineSelectionMode) {
      setAbilityMode(null);
    }

    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }

      // Allow phases 1-4 (Setup, Main, Commit, Scoring), phase 0 (Preparation) is hidden
      const newPhase = Math.max(1, Math.min(phaseIndex, 4))
      const enteringScoringPhase = newPhase === 4

      // When entering Scoring phase from any phase, enable scoring step
      // This matches the behavior of nextPhase
      // If clearing line selection mode, also close isScoringStep to prevent re-triggering
      return {
        ...currentState,
        currentPhase: newPhase,
        ...(enteringScoringPhase && !isClearingLineSelectionMode ? { isScoringStep: true } : {}),
        ...(isClearingLineSelectionMode ? { isScoringStep: false } : {}),
      }
    })
  }, [updateState, abilityMode, setAbilityMode])

  /**
   * Move to next phase
   */
  const nextPhase = useCallback(() => {
    // Always clear line selection modes when changing phase
    if (abilityMode && setAbilityMode && abilityMode.mode) {
      const lineSelectionModes = ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'];
      if (lineSelectionModes.includes(abilityMode.mode)) {
        setAbilityMode(null);
      }
    }

    const currentState = gameStateRef.current
    const isWebRTCMode = getWebRTCEnabled()

    // When at Scoring phase (4) or in scoring step, send NEXT_PHASE to server
    // Server will handle turn passing and Preparation phase for next player
    // CRITICAL: Only send to server if BOTH conditions are aligned - prevent race conditions
    // where isScoringStep might be true but currentPhase has already changed
    // NOTE: In WebRTC mode, we skip server-side turn passing and handle it locally
    if (currentState.isGameStarted && currentState.currentPhase === 4 && currentState.isScoringStep && !isWebRTCMode) {
      // CRITICAL: Flush any pending score deltas BEFORE passing turn
      // This ensures server has up-to-date scores for round end check
      if (ws.current?.readyState === WebSocket.OPEN) {
        // Send all accumulated score deltas immediately
        scoreDeltaAccumulator.forEach((accumulated, playerId) => {
          clearTimeout(accumulated.timerId)
          logger.info(`[ScoreFlush] Flushing pending score: player=${playerId}, delta=${accumulated.delta}`)
          ws.current!.send(JSON.stringify({
            type: 'UPDATE_PLAYER_SCORE',
            gameId: currentState.gameId,
            playerId: playerId,
            delta: accumulated.delta
          }))
        })
        scoreDeltaAccumulator.clear()

        // Now send NEXT_PHASE
        ws.current.send(JSON.stringify({
          type: 'NEXT_PHASE',
          gameId: currentState.gameId
        }))
      }
      return
    }

    // WebRTC mode: Handle turn passing when at Scoring phase and in scoring step
    // Case 1: Auto-pass turn after finishing Scoring phase
    if (isWebRTCMode && currentState.isGameStarted && currentState.currentPhase === 4 && currentState.isScoringStep) {
      updateState(currentState => {
        // Use passTurnToNextPlayer to properly transition to next player
        // This handles: Preparation phase, card drawing, includes dummy players
        return passTurnToNextPlayer(currentState)
      })
      return
    }

    // For normal phase transitions (1->2, 2->3, 3->4), use local updateState
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)

      const nextPhaseIndex = currentState.currentPhase + 1

      // Only consume deploy abilities if preserveDeployAbilities is false (new ready status system)
      if (!currentState.preserveDeployAbilities) {
        newState.board.forEach(row => {
          row.forEach(cell => {
            if (cell.card?.statuses) {
              // Remove readyDeploy status from all cards
              cell.card.statuses = cell.card.statuses.filter(s => s.type !== 'readyDeploy')
            }
          })
        })
      }

      // When transitioning from Commit (phase 3) to Scoring (phase 4), enable scoring step
      // Case 2: If player has no cards on board during Commit phase, auto-pass turn
      if (isWebRTCMode && nextPhaseIndex === 4 && currentState.currentPhase === 3) {
        // Check if active player has any cards on board
        const hasCards = playerHasCardsOnBoard(currentState, currentState.activePlayerId!)

        if (!hasCards) {
          logger.info(`[nextPhase] Player ${currentState.activePlayerId} has no cards on board in Commit phase, auto-passing turn`)
          // Auto-pass to next player - this will put us in their Preparation phase
          return passTurnToNextPlayer(currentState)
        }

        // Entering Scoring phase from Commit - enable scoring
        newState.isScoringStep = true
        newState.currentPhase = 4
        return newState
      }

      // Non-WebRTC mode: normal transition from Commit to Scoring
      if (nextPhaseIndex === 4 && currentState.currentPhase === 3) {
        // Entering Scoring phase from Commit - enable scoring
        newState.isScoringStep = true
        newState.currentPhase = 4
        return newState
      }

      // Handle Resurrected expiration for normal phase transitions
      newState.board.forEach(row => {
        row.forEach(cell => {
          if (cell.card?.statuses) {
            const resurrectedIdx = cell.card.statuses.findIndex(s => s.type === 'Resurrected')
            if (resurrectedIdx !== -1) {
              const addedBy = cell.card.statuses[resurrectedIdx].addedByPlayerId
              cell.card.statuses.splice(resurrectedIdx, 1)
              if (cell.card.baseId !== 'luciusTheImmortal') {
                cell.card.statuses.push({ type: 'Stun', addedByPlayerId: addedBy })
                cell.card.statuses.push({ type: 'Stun', addedByPlayerId: addedBy })
              }
            }
          }
        })
      })
      // Recalculate for phase transitions where Resurrected might expire
      newState.board = recalculateBoardStatuses(newState)

      newState.currentPhase = nextPhaseIndex
      return newState
    })
  }, [updateState, abilityMode, setAbilityMode, gameStateRef, ws, scoreDeltaAccumulator])

  /**
   * Move to previous phase
   */
  const prevPhase = useCallback(() => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      // Always clear line selection modes when changing phase
      if (abilityMode && setAbilityMode && abilityMode.mode) {
        const lineSelectionModes = ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'];
        if (lineSelectionModes.includes(abilityMode.mode)) {
          setAbilityMode(null);
        }
      }

      // If in scoring step, exit it AND move to previous phase (Commit or Setup)
      if (currentState.isScoringStep) {
        return { ...currentState, isScoringStep: false, currentPhase: Math.max(1, currentState.currentPhase - 1) }
      }
      // Otherwise just move to previous phase (but not below Setup/1)
      // Preparation (0) is only accessed via turn passing, not manual navigation
      return {
        ...currentState,
        currentPhase: Math.max(1, currentState.currentPhase - 1),
      }
    })
  }, [updateState, abilityMode, setAbilityMode])

  /**
   * Close round end modal and start next round
   * Resets player scores and closes the modal
   */
  const closeRoundEndModal = useCallback(() => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode) {
      // WebRTC mode: Update state locally and broadcast via updateState
      updateState(prev => ({
        ...prev,
        isRoundEndModalOpen: false,
        currentRound: (prev.currentRound || 1) + 1,
        players: prev.players.map(p => ({
          ...p,
          score: 0,
        })),
      }))
    } else if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      // Server mode: Optimistic updates + WebSocket message
      setGameState(prev => ({
        ...prev,
        isRoundEndModalOpen: false,
        currentRound: (prev.currentRound || 1) + 1,
        players: prev.players.map(p => ({
          ...p,
          score: 0,
        })),
      }))

      // Send START_NEXT_ROUND to server to sync with all clients
      ws.current.send(JSON.stringify({
        type: 'START_NEXT_ROUND',
        gameId: gameStateRef.current.gameId,
      }))
    }
  }, [setGameState, updateState, ws, gameStateRef])

  /**
   * Just close the round end modal (for "Continue Game" button after match ends)
   * Does NOT reset scores or start new round - just lets players view the board
   */
  const closeRoundEndModalOnly = useCallback(() => {
    setGameState(prev => ({
      ...prev,
      isRoundEndModalOpen: false,
    }))
  }, [setGameState])

  /**
   * Reset game to lobby state while preserving players and deck selections
   * Supports both WebSocket (server) and WebRTC (P2P) modes
   */
  const resetGame = useCallback(() => {
    const isWebRTCMode = getWebRTCEnabled()

    if (isWebRTCMode) {
      // WebRTC P2P mode: Reset locally and broadcast
      const currentState = gameStateRef.current

      // Create fresh decks for all players based on their selectedDeck
      const resetPlayers = currentState.players.map(p => {
        const deckType = p.selectedDeck || 'SynchroTech'
        return {
          ...p,
          hand: [],
          deck: createDeck(deckType as any, p.id, p.name),
          discard: [],
          score: 0,
          isReady: p.isDummy || false, // Dummy players are always ready, real players are not ready after reset
          announcedCard: null,
          boardHistory: [],
        }
      })

      // Create fresh board with correct grid size
      const gridSize: number = (currentState.activeGridSize as unknown as number) || 8
      const newBoard: Board = []
      for (let i = 0; i < gridSize; i++) {
        const row: any[] = []
        for (let j = 0; j < gridSize; j++) {
          row.push({ card: null })
        }
        newBoard.push(row)
      }

      const resetState: GameState = {
        ...currentState,
        players: resetPlayers,
        board: newBoard,
        isGameStarted: false,
        currentPhase: 0,
        currentRound: 1,
        turnNumber: 1,
        activePlayerId: null,
        startingPlayerId: null,
        roundWinners: {},
        gameWinner: null,
        roundEndTriggered: false,
        isRoundEndModalOpen: false,
        isReadyCheckActive: false,
        // Clear other state
        targetingMode: null,
        floatingTexts: [],
      }

      // Update local state (this will broadcast delta in WebRTC mode)
      setGameState(resetState)
      gameStateRef.current = resetState

      logger.info('[GameReset] Game reset in WebRTC mode')

      // Broadcast GAME_RESET message to all WebRTC peers
      // Send minimal data to avoid WebRTC message size limit
      // Guests will recreate their decks locally using createDeck()
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.broadcastToGuests({
          type: 'GAME_RESET',
          senderId: webrtcManagerRef.current.getPeerId(),
          data: {
            players: resetPlayers.map(p => ({
              id: p.id,
              name: p.name,
              color: p.color,
              selectedDeck: p.selectedDeck,
              isDummy: p.isDummy,
              isDisconnected: p.isDisconnected,
              autoDrawEnabled: p.autoDrawEnabled,
              // Only send sizes, not full card arrays (guests create decks locally)
              handSize: p.hand.length,
              deckSize: p.deck.length,
              discardSize: p.discard.length,
              // For dummy players, send minimized card data so guests can see them
              ...(p.isDummy && {
                hand: p.hand.map((card: any) => ({
                  id: card.id,
                  baseId: card.baseId,
                  name: card.name,
                  imageUrl: card.imageUrl,
                  power: card.power,
                  powerModifier: card.powerModifier,
                  ability: card.ability,
                  ownerId: card.ownerId,
                  color: card.color,
                  deck: card.deck,
                  isFaceDown: card.isFaceDown,
                  types: card.types,
                  faction: card.faction,
                  statuses: card.statuses,
                })),
                deck: p.deck.map((card: any) => ({
                  id: card.id,
                  baseId: card.baseId,
                  name: card.name,
                  imageUrl: card.imageUrl,
                  power: card.power,
                  powerModifier: card.powerModifier,
                  ability: card.ability,
                  ownerId: card.ownerId,
                  color: card.color,
                  deck: card.deck,
                  isFaceDown: card.isFaceDown,
                  types: card.types,
                  faction: card.faction,
                  statuses: card.statuses,
                })),
                discard: p.discard.map((card: any) => ({
                  id: card.id,
                  baseId: card.baseId,
                  name: card.name,
                  imageUrl: card.imageUrl,
                  power: card.power,
                  powerModifier: card.powerModifier,
                  ability: card.ability,
                  ownerId: card.ownerId,
                  color: card.color,
                  deck: card.deck,
                  isFaceDown: card.isFaceDown,
                  types: card.types,
                  faction: card.faction,
                  statuses: card.statuses,
                })),
              }),
              score: p.score,
              isReady: p.isReady,
              announcedCard: p.announcedCard,
            })),
            gameMode: resetState.gameMode,
            isPrivate: resetState.isPrivate,
            activeGridSize: resetState.activeGridSize,
            dummyPlayerCount: resetState.dummyPlayerCount,
            autoAbilitiesEnabled: resetState.autoAbilitiesEnabled,
            isGameStarted: false,
            currentPhase: 0,
            currentRound: 1,
            turnNumber: 1,
            activePlayerId: null,
            startingPlayerId: null,
            roundWinners: {},
            gameWinner: null,
            isRoundEndModalOpen: false,
            isReadyCheckActive: false,
          },
          timestamp: Date.now()
        })
        logger.info('[GameReset] Broadcasted GAME_RESET message to guests')
      }
    } else if (ws.current?.readyState === WebSocket.OPEN) {
      // WebSocket mode: Send RESET_GAME message to server
      ws.current.send(JSON.stringify({
        type: 'RESET_GAME',
        gameId: gameStateRef.current.gameId,
      }))
    }
  }, [ws, webrtcManagerRef, gameStateRef, setGameState, createDeck])

  return {
    toggleActivePlayer,
    toggleAutoDraw,
    setPhase,
    nextPhase,
    prevPhase,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
  }
}
