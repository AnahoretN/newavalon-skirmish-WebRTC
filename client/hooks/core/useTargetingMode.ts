/**
 * useTargetingMode - Хук для управления режимом прицеливания
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - setTargetingMode - активация режима прицеливания
 * - clearTargetingMode - очистка режима прицеливания
 */

import { useCallback } from 'react'
import type { TargetingModeData, AbilityAction, CommandContext, GameState } from '../../types'
import { calculateValidTargets } from '@shared/utils/targeting'
import { logger } from '../../utils/logger'

interface UseTargetingModeProps {
  // WebSocket connection
  ws: React.MutableRefObject<WebSocket | null>
  // WebRTC manager
  webrtcManager: React.MutableRefObject<ReturnType<typeof import('../../utils/webrtcManager').getWebrtcManager> | null>
  // Refs
  gameStateRef: React.MutableRefObject<GameState>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  // State setters
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
}

/**
 * Universal targeting mode activation
 * Sets the targeting mode for all clients, synchronized via server
 *
 * @param action - The AbilityAction defining targeting constraints
 * @param playerId - The player who will select the target
 * @param sourceCoords - Optional source card coordinates
 * @param preCalculatedTargets - Optional pre-calculated board targets (for line modes, etc.)
 * @param commandContext - Optional command context for multi-step actions
 */
export function useTargetingMode(props: UseTargetingModeProps) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    webrtcIsHostRef,
    setGameState,
  } = props

  const setTargetingMode = useCallback((
    action: AbilityAction,
    playerId: number,
    sourceCoords?: { row: number; col: number },
    preCalculatedTargets?: {row: number, col: number}[],
    commandContext?: CommandContext
  ) => {
    const currentGameState = gameStateRef.current

    // Use pre-calculated targets if provided, otherwise calculate them
    let boardTargets: {row: number, col: number}[] = []
    if (preCalculatedTargets) {
      boardTargets = preCalculatedTargets
    } else {
      boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)
    }

    // Check for hand targets (if applicable)
    const handTargets: { playerId: number, cardIndex: number }[] = []
    const isDeckSelectable = action.mode === 'SELECT_DECK'

    // Calculate hand targets if action has a filter for hand cards
    if (action.payload?.filter && action.mode === 'SELECT_TARGET') {
      // Find the player who owns the source card
      const sourceOwnerId = action.sourceCard?.ownerId || action.originalOwnerId || playerId
      const player = currentGameState.players.find(p => p.id === sourceOwnerId)

      if (player && player.hand) {
        // Apply the filter to each card in hand to find valid targets
        player.hand.forEach((card, index) => {
          try {
            if (action.payload.filter(card)) {
              handTargets.push({ playerId: player.id, cardIndex: index })
            }
          } catch (e) {
            // Filter failed, skip this card
          }
        })
      }
    }

    // Build targeting mode data
    const targetingModeData: TargetingModeData = {
      playerId,
      action,
      sourceCoords,
      timestamp: Date.now(),
      boardTargets,
      handTargets: handTargets.length > 0 ? handTargets : undefined,
      isDeckSelectable: isDeckSelectable || undefined,
      originalOwnerId: action.originalOwnerId,
    }

    // Update local state immediately
    setGameState(prev => ({
      ...prev,
      targetingMode: targetingModeData,
    }))
    gameStateRef.current.targetingMode = targetingModeData

    // Broadcast to all clients via WebSocket server
    if (ws.current?.readyState === WebSocket.OPEN && currentGameState.gameId) {
      ws.current.send(JSON.stringify({
        type: 'SET_TARGETING_MODE',
        gameId: currentGameState.gameId,
        targetingMode: targetingModeData,
      }))
    }

    // Broadcast via WebRTC (P2P mode)
    if (webrtcManager.current) {
      if (webrtcIsHostRef.current) {
        // Host broadcasts directly to all guests
        webrtcManager.current.broadcastToGuests({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
      } else {
        // Guest sends to host for rebroadcasting
        webrtcManager.current.sendMessageToHost({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
      }
    }

    logger.info(`[TargetingMode] Player ${playerId} activated targeting mode`, {
      mode: action.mode,
      boardTargetsCount: boardTargets.length,
    })
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Clear the active targeting mode
   * Clears the targeting mode for all clients
   */
  const clearTargetingMode = useCallback(() => {
    const currentGameState = gameStateRef.current

    // Update local state
    setGameState(prev => ({
      ...prev,
      targetingMode: null,
    }))
    gameStateRef.current.targetingMode = null

    // Broadcast to all clients via WebSocket server
    if (ws.current?.readyState === WebSocket.OPEN && currentGameState.gameId) {
      ws.current.send(JSON.stringify({
        type: 'CLEAR_TARGETING_MODE',
        gameId: currentGameState.gameId,
      }))
    }

    // Broadcast via WebRTC (P2P mode)
    if (webrtcManager.current) {
      if (webrtcIsHostRef.current) {
        // Host broadcasts directly to all guests
        webrtcManager.current.broadcastToGuests({
          type: 'CLEAR_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { timestamp: Date.now() },
          timestamp: Date.now()
        })
      } else {
        // Guest sends to host for rebroadcasting
        webrtcManager.current.sendMessageToHost({
          type: 'CLEAR_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { timestamp: Date.now() },
          timestamp: Date.now()
        })
      }
    }

    logger.debug('[TargetingMode] Cleared targeting mode')
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  return {
    setTargetingMode,
    clearTargetingMode,
  }
}
