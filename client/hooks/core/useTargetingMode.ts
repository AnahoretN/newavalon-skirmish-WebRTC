/**
 * useTargetingMode - Хук для управления режимом прицеливания
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - setTargetingMode - активация режима прицеливания
 * - clearTargetingMode - очистка режима прицеливания
 *
 * WebRTC P2P mode:
 * - Guests send ABILITY_ACTIVATED to host, host calculates targeting mode and broadcasts
 * - Host broadcasts directly with SET_TARGETING_MODE
 */

import { useCallback } from 'react'
import type { TargetingModeData, AbilityAction, CommandContext, GameState } from '../../types'
import { calculateValidTargets } from '@shared/utils/targeting'
import { logger } from '../../utils/logger'
import type { WebRTCManager } from './types'

interface UseTargetingModeProps {
  // WebSocket connection
  ws: React.MutableRefObject<WebSocket | null>
  // WebRTC manager
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  // Refs
  gameStateRef: React.MutableRefObject<GameState>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  localPlayerIdRef: React.MutableRefObject<number | null>
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
 * @param preCalculatedHandTargets - Optional pre-calculated hand targets (for token targeting)
 */
export function useTargetingMode(props: UseTargetingModeProps) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    webrtcIsHostRef,
    localPlayerIdRef,
    setGameState,
  } = props

  const setTargetingMode = useCallback((
    action: AbilityAction,
    playerId: number,
    sourceCoords?: { row: number; col: number },
    preCalculatedTargets?: {row: number, col: number}[],
    commandContext?: CommandContext,
    preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]
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

    // Use pre-calculated hand targets if provided, otherwise calculate them
    let handTargets: { playerId: number, cardIndex: number }[] = []
    if (preCalculatedHandTargets) {
      handTargets = preCalculatedHandTargets
    } else {
      // Check for hand targets (if applicable)
      handTargets = []

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
    }

    const isDeckSelectable = action.mode === 'SELECT_DECK'

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
        // Host broadcasts directly to all guests with SET_TARGETING_MODE
        webrtcManager.current.broadcastToGuests({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
      } else {
        // Guest sends ABILITY_ACTIVATED to host - host will infer targeting mode
        // Get source card info from game state
        let cardId = ''
        let cardName = ''
        let abilityType = 'deploy'

        if (sourceCoords) {
          const card = currentGameState.board[sourceCoords.row]?.[sourceCoords.col]?.card
          if (card) {
            cardId = card.id || ''
            cardName = card.name || ''
          }
        }

        // Determine ability type from phase or action
        const phase = currentGameState.currentPhase
        if (phase === 0) abilityType = 'setup'
        else if (phase === 2) abilityType = 'commit'

        const success = webrtcManager.current.sendMessageToHost({
          type: 'ABILITY_ACTIVATED',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          playerId: localPlayerIdRef.current ?? undefined,
          data: {
            coords: sourceCoords,
            cardId,
            cardName,
            abilityType,
            mode: action.mode,
            actionType: action.payload?.actionType,
            action,
            boardTargets,
            handTargets
          },
          timestamp: Date.now()
        })
        logger.info(`[TargetingMode] Guest sent ABILITY_ACTIVATED to host`, {
          success,
          playerId,
          boardTargetsCount: boardTargets.length,
          handTargetsCount: handTargets.length,
          abilityType
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
        // Guest sends ABILITY_CANCELLED to host
        webrtcManager.current.sendMessageToHost({
          type: 'ABILITY_CANCELLED',
          senderId: webrtcManager.current.getPeerId?.() ?? undefined,
          playerId: localPlayerIdRef.current ?? undefined,
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
