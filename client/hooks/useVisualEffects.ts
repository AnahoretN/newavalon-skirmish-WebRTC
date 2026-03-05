/**
 * useVisualEffects - Hook for managing visual effects
 *
 * Refactored to work with SimpleP2P system
 * - Manages React state for effects
 * - Broadcasts via SimpleVisualEffects (host) or direct messages (guest)
 * - Works in both P2P and WebSocket modes
 */

import { useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'
import type { HighlightData, FloatingTextData, TargetingModeData, AbilityAction, CommandContext, GameState } from '../types'
import { SimpleVisualEffects } from '../p2p/SimpleVisualEffects'
import type { SimpleHost } from '../p2p/SimpleHost'
import type { SimpleGuest } from '../p2p/SimpleGuest'
import { initClickWaveOverlay, triggerDirectClickWave, type ClickWaveData } from './useDirectClickWave'

interface UseVisualEffectsProps {
  // SimpleHost (P2P mode)
  simpleHost: SimpleHost | null
  // SimpleGuest (P2P mode - for guests)
  simpleGuest: SimpleGuest | null

  // Local refs
  gameStateRef: React.MutableRefObject<GameState>
  localPlayerIdRef: React.MutableRefObject<number | null>

  // State setters (accept union types for P2P compatibility)
  setLatestHighlight: React.Dispatch<React.SetStateAction<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>>
  setLatestFloatingTexts: React.Dispatch<React.SetStateAction<FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[] | null>>
  setLatestNoTarget: React.Dispatch<React.SetStateAction<{ coords: { row: number; col: number }; timestamp: number } | null>>
  setLatestDeckSelections: React.Dispatch<React.SetStateAction<Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>>>
  setLatestHandCardSelections: React.Dispatch<React.SetStateAction<Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>>>
  setClickWaves: React.Dispatch<React.SetStateAction<Array<any>>>
  setGameState: React.Dispatch<React.SetStateAction<any>>
}

/**
 * Hook for visual effects management
 * Works with both P2P and WebSocket modes
 */
export function useVisualEffects(props: UseVisualEffectsProps) {
  const {
    simpleHost,
    simpleGuest,
    gameStateRef,
    localPlayerIdRef,
    setLatestHighlight,
    setLatestFloatingTexts,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setGameState,
  } = props

  // Initialize click wave overlay on mount
  useEffect(() => {
    initClickWaveOverlay()
  }, [])

  /**
   * Trigger highlight effect on a cell
   */
  const triggerHighlight = useCallback((highlightData: Omit<HighlightData, 'timestamp'>) => {
    const fullHighlightData: HighlightData = { ...highlightData, timestamp: Date.now() }

    // Immediately update local state
    setLatestHighlight(fullHighlightData)

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastHighlight(fullHighlightData)
    }
  }, [simpleHost, setLatestHighlight])

  /**
   * Trigger floating text effect(s)
   */
  const triggerFloatingText = useCallback((
    data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]
  ) => {
    const items = Array.isArray(data) ? data : [data]
    const timestamp = Date.now()
    const batch = items.map((item, i) => ({ ...item, timestamp: timestamp + i })) as FloatingTextData[]

    // CRITICAL: Use flushSync to ensure state update is processed immediately
    // This ensures useEffect in App.tsx fires synchronously
    flushSync(() => {
      setLatestFloatingTexts(batch)
    })

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastFloatingText(batch)
    }
  }, [simpleHost, setLatestFloatingTexts])

  /**
   * Trigger "no target" overlay effect
   */
  const triggerNoTarget = useCallback((coords: { row: number; col: number }) => {
    const timestamp = Date.now()

    // Immediately update local state
    setLatestNoTarget({ coords, timestamp })

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastNoTarget(coords)
    }
  }, [simpleHost, setLatestNoTarget])

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

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastDeckSelection(playerId, selectedByPlayerId)
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== deckSelectionData.timestamp))
    }, 1000)
  }, [simpleHost, setLatestDeckSelections])

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

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastHandCardSelection(playerId, cardIndex, selectedByPlayerId)
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== handCardSelectionData.timestamp))
    }, 1000)
  }, [simpleHost, setLatestHandCardSelections])

  /**
   * Trigger click wave effect (colored ripple animation)
   * Shows when any player clicks on a card or cell
   * Uses DIRECT DOM for instant local display, React state for network sync
   *
   * @param location - The location where the click occurred
   * @param boardCoords - Board coordinates (for board location)
   * @param handTarget - Hand card target (for hand location)
   * @param effectOwnerId - Optional: Use this player's color instead of local player's
   *                       This is used for command cards like False Orders where the effect
   *                       should show the command owner's color, not the card mover's color.
   */
  const triggerClickWave = useCallback((
    location: 'board' | 'hand' | 'deck',
    boardCoords?: { row: number; col: number },
    handTarget?: { playerId: number; cardIndex: number },
    effectOwnerId?: number
  ) => {
    if (localPlayerIdRef.current === null) {
      return
    }

    // Get player color from game state
    // Use effectOwnerId if provided (for command card effects), otherwise use local player
    const playerIdForColor = effectOwnerId ?? localPlayerIdRef.current
    const player = gameStateRef.current.players.find(p => p.id === playerIdForColor)
    if (!player) {
      return
    }

    const wave = {
      timestamp: Date.now(),
      location,
      boardCoords,
      handTarget,
      clickedByPlayerId: localPlayerIdRef.current, // Who actually clicked
      playerColor: player.color, // Color of effectOwnerId or local player
      // Only add _local flag for host (player 1) to prevent duplicate display
      // Guest clicks should be seen by host via onClickWave callback
      _local: localPlayerIdRef.current === 1,
    }

    // INSTANT: Direct DOM manipulation - bypasses React entirely
    // This shows the wave IMMEDIATELY without waiting for React re-render
    triggerDirectClickWave(wave as ClickWaveData)

    // Still update React state for:
    // 1. Guests in P2P mode (they receive state via SimpleHost)
    // 2. Debugging/development tools
    // 3. Fallback if direct DOM fails
    flushSync(() => {
      setClickWaves(prev => [...prev, wave])
    })

    // Broadcast via SimpleHost if available (P2P host mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.broadcastClickWave(wave)
    }
    // Send action via SimpleGuest if available (P2P guest mode)
    else if (simpleGuest) {
      simpleGuest.sendAction('CLICK_WAVE', wave)
    }

    // Auto-remove from React state after animation completes
    // (Direct DOM handles its own cleanup)
    setTimeout(() => {
      setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
    }, 700)
  }, [simpleHost, simpleGuest, gameStateRef, localPlayerIdRef, setClickWaves])

  /**
   * Set targeting mode for all clients
   */
  const setTargetingMode = useCallback((
    action: AbilityAction,
    playerId: number,
    sourceCoords?: { row: number; col: number },
    preCalculatedTargets?: { row: number, col: number }[],
    _commandContext?: CommandContext,
    preCalculatedHandTargets?: { playerId: number, cardIndex: number }[]
  ) => {
    const currentGameState = gameStateRef.current
    if (!currentGameState || !currentGameState.board) {
      console.warn('[setTargetingMode] No game state or board available')
      return
    }

    // CRITICAL: For command cards like Tactical Maneuver, chainedAction is in action.payload.chainedAction
    // For other abilities, it might be at action.chainedAction. Check both.
    const actualChainedAction = action.chainedAction || action.payload?.chainedAction

    const targetingModeData: TargetingModeData = {
      playerId,
      action,
      sourceCoords,
      timestamp: Date.now(),
      boardTargets: preCalculatedTargets,
      handTargets: preCalculatedHandTargets,
      // Extract these from action for easier access (also available via action.chainedAction)
      chainedAction: actualChainedAction,
      originalOwnerId: action.originalOwnerId,
    }

    console.log('[setTargetingMode]', {
      mode: action.mode,
      hasDirectChainedAction: !!action.chainedAction,
      hasPayloadChainedAction: !!action.payload?.chainedAction,
      actualChainedAction,
    })

    // Update local state immediately
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: targetingModeData,
    }))

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.setTargetingMode(targetingModeData)
    }
  }, [simpleHost, gameStateRef, setGameState])

  /**
   * Clear targeting mode for all clients
   */
  const clearTargetingMode = useCallback(() => {
    // Clear local state
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: null,
    }))

    // Broadcast via SimpleHost if available (P2P mode)
    if (simpleHost) {
      const effects = new SimpleVisualEffects(simpleHost)
      effects.clearTargetingMode()
    }
  }, [simpleHost, setGameState])

  return {
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    setTargetingMode,
    clearTargetingMode,
  }
}
