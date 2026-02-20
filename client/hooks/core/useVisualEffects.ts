/**
 * useVisualEffects - Хук для управления визуальными эффектами
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - triggerHighlight - подсветка клетки
 * - triggerFloatingText - плавающий текст
 * - triggerNoTarget - оверлей "нет цели"
 * - triggerDeckSelection - выбор колоды
 * - triggerHandCardSelection - выбор карты из руки
 * - syncValidTargets - синхронизация валидных целей
 * - triggerClickWave - эффект волны при клике
 * - setTargetingMode - режим прицеливания
 * - clearTargetingMode - очистка режима прицеливания
 */

import { useCallback, useRef } from 'react'
import { calculateValidTargets } from '@shared/utils/targeting'
import type { HighlightData, FloatingTextData, TargetingModeData, AbilityAction, CommandContext, GameState } from '../../types'
import type { WebRTCManager } from './types'

interface UseVisualEffectsProps {
  // WebSocket connection
  ws: React.MutableRefObject<WebSocket | null>
  // WebRTC manager
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  // Refs
  gameStateRef: React.MutableRefObject<GameState>
  localPlayerIdRef: React.MutableRefObject<number | null>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  // State setters
  setLatestHighlight: React.Dispatch<React.SetStateAction<HighlightData | null>>
  setLatestFloatingTexts: React.Dispatch<React.SetStateAction<FloatingTextData[] | null>>
  setLatestNoTarget: React.Dispatch<React.SetStateAction<{ coords: { row: number; col: number }; timestamp: number } | null>>
  setLatestDeckSelections: React.Dispatch<React.SetStateAction<Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>>>
  setLatestHandCardSelections: React.Dispatch<React.SetStateAction<Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>>>
  setClickWaves: React.Dispatch<React.SetStateAction<Array<any>>>
  setGameState: React.Dispatch<React.SetStateAction<any>>
}

export function useVisualEffects(props: UseVisualEffectsProps) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setLatestHighlight,
    setLatestFloatingTexts,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setGameState,
  } = props

  // Throttle click waves to once per 500ms per player
  const lastClickTimeRef = useRef<Record<number, number>>({})
  const CLICK_THROTTLE_MS = 500

  /**
   * Trigger highlight effect on a cell
   */
  const triggerHighlight = useCallback((highlightData: Omit<HighlightData, 'timestamp'>) => {
    const fullHighlightData: HighlightData = { ...highlightData, timestamp: Date.now() }

    // Immediately update local state
    setLatestHighlight(fullHighlightData)

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_HIGHLIGHT',
        gameId: gameStateRef.current.gameId,
        highlightData: fullHighlightData
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'HIGHLIGHT_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: fullHighlightData,
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setLatestHighlight])

  /**
   * Trigger floating text effect(s)
   */
  const triggerFloatingText = useCallback((
    data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]
  ) => {
    const items = Array.isArray(data) ? data : [data]
    const timestamp = Date.now()
    const batch = items.map((item, i) => ({ ...item, timestamp: timestamp + i }))

    // Immediately update local state
    setLatestFloatingTexts(batch)

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_FLOATING_TEXT_BATCH',
        gameId: gameStateRef.current.gameId,
        batch,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'FLOATING_TEXT_BATCH_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: { batch },
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setLatestFloatingTexts])

  /**
   * Trigger "no target" overlay effect
   */
  const triggerNoTarget = useCallback((coords: { row: number, col: number }) => {
    const timestamp = Date.now()

    // Immediately update local state
    setLatestNoTarget({ coords, timestamp })

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_NO_TARGET',
        gameId: gameStateRef.current.gameId,
        coords,
        timestamp,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'NO_TARGET_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: { coords, timestamp },
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setLatestNoTarget])

  /**
   * Trigger deck selection effect
   */
  const triggerDeckSelection = useCallback((playerId: number, selectedByPlayerId: number) => {
    const deckSelectionData = {
      playerId,
      selectedByPlayerId,
      timestamp: Date.now(),
    }

    // Immediately update local state
    setLatestDeckSelections(prev => [...prev, deckSelectionData])

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_DECK_SELECTION',
        gameId: gameStateRef.current.gameId,
        deckSelectionData,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'DECK_SELECTION_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: deckSelectionData,
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== deckSelectionData.timestamp))
    }, 1000)
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setLatestDeckSelections])

  /**
   * Trigger hand card selection effect
   */
  const triggerHandCardSelection = useCallback((
    playerId: number,
    cardIndex: number,
    selectedByPlayerId: number
  ) => {
    const handCardSelectionData = {
      playerId,
      cardIndex,
      selectedByPlayerId,
      timestamp: Date.now(),
    }

    // Immediately update local state
    setLatestHandCardSelections(prev => [...prev, handCardSelectionData])

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_HAND_CARD_SELECTION',
        gameId: gameStateRef.current.gameId,
        handCardSelectionData,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'HAND_CARD_SELECTION_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: handCardSelectionData,
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== handCardSelectionData.timestamp))
    }, 1000)
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setLatestHandCardSelections])

  /**
   * Sync valid targets to other players
   * @deprecated Targeting mode is now synchronized via gameState.targetingMode (SET_TARGETING_MODE)
   * This function is kept for backwards compatibility but does nothing
   */
  const syncValidTargets = useCallback((_validTargetsData: {
    validHandTargets: { playerId: number, cardIndex: number }[]
    isDeckSelectable: boolean
  }) => {
    // Targeting mode is now synchronized via SET_TARGETING_MODE / CLEAR_TARGETING_MODE
    // This function is kept for backwards compatibility only
  }, [])

  /**
   * Trigger click wave effect (colored ripple animation)
   * Shows when any player clicks on a card or cell
   * Throttled to once per 500ms per player
   */
  const triggerClickWave = useCallback((
    location: 'board' | 'hand' | 'deck',
    boardCoords?: { row: number; col: number },
    handTarget?: { playerId: number; cardIndex: number }
  ) => {
    if (localPlayerIdRef.current === null) {
      return
    }

    // Check throttle - don't allow more than one click wave per 500ms per player
    const playerId = localPlayerIdRef.current
    const now = Date.now()
    const lastClickTime = lastClickTimeRef.current[playerId] || 0
    if (now - lastClickTime < CLICK_THROTTLE_MS) {
      return
    }
    lastClickTimeRef.current[playerId] = now

    // Get player color from game state
    const player = gameStateRef.current.players.find(p => p.id === playerId)
    if (!player) {return}

    const wave = {
      timestamp: Date.now(),
      location,
      boardCoords,
      handTarget,
      clickedByPlayerId: playerId,
      playerColor: player.color,
    }

    // Immediately update local state
    setClickWaves(prev => [...prev, wave])

    // Broadcast to other players
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_CLICK_WAVE',
        gameId: gameStateRef.current.gameId,
        wave,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'CLICK_WAVE_TRIGGERED' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: wave,
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }

    // Auto-remove after animation completes (600ms)
    setTimeout(() => {
      setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
    }, 600)
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setClickWaves])

  /**
   * Set targeting mode for all clients
   */
  const setTargetingMode = useCallback((
    action: AbilityAction,
    playerId: number,
    sourceCoords?: { row: number; col: number },
    preCalculatedTargets?: { row: number, col: number }[],
    commandContext?: CommandContext,
    preCalculatedHandTargets?: { playerId: number, cardIndex: number }[]
  ) => {
    const currentGameState = gameStateRef.current
    if (!currentGameState || !currentGameState.board) {
      console.warn('[setTargetingMode] No game state or board available')
      return
    }

    // Calculate valid board targets
    let boardTargets: { row: number, col: number }[] | undefined

    if (preCalculatedTargets) {
      boardTargets = preCalculatedTargets
    } else if (sourceCoords) {
      boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)
    }

    const targetingModeData: TargetingModeData = {
      playerId,
      action,
      sourceCoords,
      timestamp: Date.now(),
      boardTargets,
      handTargets: preCalculatedHandTargets,
    }

    // Update local state immediately
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: targetingModeData,
    }))

    // Broadcast to all players
    if (ws.current?.readyState === WebSocket.OPEN && currentGameState.gameId) {
      ws.current.send(JSON.stringify({
        type: 'SET_TARGETING_MODE',
        gameId: currentGameState.gameId,
        targetingMode: targetingModeData,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'SET_TARGETING_MODE' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: targetingModeData,
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  /**
   * Clear targeting mode for all clients
   */
  const clearTargetingMode = useCallback(() => {
    const currentGameState = gameStateRef.current

    // Clear local state
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: null,
    }))

    // Broadcast to all players
    if (ws.current?.readyState === WebSocket.OPEN && currentGameState?.gameId) {
      ws.current.send(JSON.stringify({
        type: 'CLEAR_TARGETING_MODE',
        gameId: currentGameState.gameId,
      }))
    } else if (webrtcManager.current) {
      const webrtcMessage = {
        type: 'CLEAR_TARGETING_MODE' as const,
        senderId: webrtcManager.current.getPeerId(),
        data: {},
        timestamp: Date.now()
      }

      if (webrtcIsHostRef.current) {
        webrtcManager.current.broadcastToGuests(webrtcMessage)
      } else {
        webrtcManager.current.sendMessageToHost(webrtcMessage)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef, setGameState])

  return {
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    syncValidTargets,
    triggerClickWave,
    setTargetingMode,
    clearTargetingMode,
  }
}
