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

    // Validate playerId
    if (typeof playerId !== 'number') {
      logger.error(`[TargetingMode] Invalid playerId type: ${typeof playerId}, value:`, playerId)
      return
    }

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
      logger.info(`[TargetingMode] Calculating hand targets for action`, {
        actionMode: action.mode,
        filterType: typeof action.payload.filter,
        hasActionType: !!action.payload.actionType,
      })
      // Check ALL players' hands for valid targets, not just the source card owner
      // This allows abilities that target other players' hand cards
      for (const player of currentGameState.players) {
        if (player.hand) {
          // Apply the filter to each card in hand to find valid targets
          player.hand.forEach((card, index) => {
            try {
              if (action.payload.filter(card)) {
                handTargets.push({ playerId: player.id, cardIndex: index })
                logger.debug(`[TargetingMode] Found hand target: player ${player.id}, card ${index}, card ${card.name}`)
              }
            } catch (e) {
              logger.warn(`[TargetingMode] Filter failed for card ${card.name}:`, e)
              // Filter failed, skip this card
            }
          })
        }
      }
      logger.info(`[TargetingMode] Hand targets calculated: ${handTargets.length} targets`)
    } else {
      logger.info(`[TargetingMode] No hand targets calculated - no filter or wrong mode`, {
        hasFilter: !!action.payload?.filter,
        mode: action.mode,
      })
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
        const success = webrtcManager.current.sendMessageToHost({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
        logger.info(`[TargetingMode] Guest sent SET_TARGETING_MODE to host`, {
          success,
          playerId,
          boardTargetsCount: boardTargets.length,
          handTargetsCount: handTargets.length
        })
      }
    }

    logger.info(`[TargetingMode] Player ${playerId} (type: ${typeof playerId}) activated targeting mode`, {
      mode: action.mode,
      boardTargetsCount: boardTargets.length,
      handTargetsCount: handTargets.length,
      isDeckSelectable: isDeckSelectable || false,
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
