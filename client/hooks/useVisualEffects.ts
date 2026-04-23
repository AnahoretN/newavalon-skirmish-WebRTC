/**
 * useVisualEffects - Hook for managing visual effects
 *
 * Refactored to work with SimpleP2P system
 * - Manages React state for effects
 * - Broadcasts via SimpleVisualEffects (host) or direct messages (guest)
 * - Works in both P2P and WebSocket modes
 */

import { useCallback, useEffect, useRef } from 'react'
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

  // Track targeting mode clear timestamp to prevent race conditions
  const targetingModeClearRef = useRef<number>(0)

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

    // Defer state update to avoid flushSync during render cycle
    setTimeout(() => {
      setLatestFloatingTexts(batch)
    }, 0)

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
    // Defer to avoid flushSync during render cycle
    setTimeout(() => {
      setClickWaves(prev => [...prev, wave])
    }, 0)

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
   *
   * RULES:
   * 1. Only the OWNER (playerId === localPlayerId) can control targetingMode
   * 2. Remote updates are for DISPLAY ONLY - cannot overwrite local targetingMode
   * 3. When owner clears targetingMode, it's cleared for everyone
   * 4. For DUMMY players, any player can set/clear their targetingMode
   */
  const setTargetingMode = useCallback((
    action: AbilityAction,
    playerId: number,
    sourceCoords?: { row: number; col: number },
    preCalculatedTargets?: { row: number, col: number }[],
    _commandContext?: CommandContext,
    preCalculatedHandTargets?: { playerId: number, cardIndex: number }[],
    isLocal: boolean = true
  ) => {
    const newTimestamp = Date.now()
    const currentGameState = gameStateRef.current
    if (!currentGameState || !currentGameState.board) {
      console.log('[VISUAL EFFECTS] setTargetingMode: NO GAMESTATE')
      return
    }

    const localPlayerId = currentGameState.localPlayerId

    // CRITICAL: Check if the targetingMode owner is a dummy player
    const ownerPlayer = currentGameState.players?.find(p => p.id === playerId)
    const isOwnerDummy = ownerPlayer?.isDummy ?? false

    console.log('[VISUAL EFFECTS] setTargetingMode called:', {
      mode: action.mode,
      actionType: action.payload?.actionType,
      playerId,
      localPlayerId,
      sourceCard: action.sourceCard?.name,
      sourceCardOwnerId: action.sourceCard?.ownerId,
      preCalculatedTargetsCount: preCalculatedTargets?.length,
      preCalculatedHandTargetsCount: preCalculatedHandTargets?.length,
      preCalculatedHandTargets: preCalculatedHandTargets,
      isLocal,
      isOwnerDummy,
      ownerPlayerName: ownerPlayer?.name,
    })

    // CRITICAL: Only the OWNER can set targetingMode (unless owner is dummy)
    // Remote updates are ignored if we have our own local targetingMode
    const isOwner = playerId === localPlayerId
    const hasLocalTargetingMode = currentGameState.targetingMode?.ownerId === localPlayerId

    // Allow remote targetingMode update if:
    // 1. We don't have local targetingMode, OR
    // 2. The owner is a dummy player (dummies are controlled by all players)
    const shouldAllowRemoteUpdate = !hasLocalTargetingMode || isOwnerDummy

    if (!isLocal && !shouldAllowRemoteUpdate) {
      console.log('[VISUAL EFFECTS] Ignoring REMOTE targetingMode update (we have our local mode):', {
        remotePlayerId: playerId,
        localPlayerId,
        localMode: currentGameState.targetingMode.action.mode,
      })
      return
    }

    // CRITICAL: For command cards like Tactical Maneuver, chainedAction is in action.payload.chainedAction
    // For other abilities, it might be at action.chainedAction. Check both.
    const actualChainedAction = action.chainedAction || action.payload?.chainedAction

    const targetingModeData: TargetingModeData = {
      playerId,
      action,
      sourceCoords,
      timestamp: newTimestamp,
      boardTargets: preCalculatedTargets,
      handTargets: preCalculatedHandTargets,
      // Extract these from action for easier access (also available via action.chainedAction)
      chainedAction: actualChainedAction,
      originalOwnerId: action.originalOwnerId,
      ownerId: playerId, // The player who created this targeting mode
    }

    console.log('[VISUAL EFFECTS] targetingModeData created:', {
      playerId,
      hasHandTargets: !!targetingModeData.handTargets,
      handTargetsLength: targetingModeData.handTargets?.length || 0,
      handTargets: targetingModeData.handTargets,
    })

    // Update local state immediately
    setGameState((prev: any) => {
      console.log('[VISUAL EFFECTS] Setting targetingMode in local state', {
        prevTargetingMode: prev.targetingMode ? { mode: prev.targetingMode.action.mode, playerId: prev.targetingMode.playerId } : null,
        newTargetingMode: { mode: action.mode, playerId, handTargetsCount: preCalculatedHandTargets?.length },
        targetingModeDataHandTargets: targetingModeData.handTargets?.length || 0,
      })
      const newState = {
        ...prev,
        targetingMode: targetingModeData,
      }
      console.log('[VISUAL EFFECTS] New gameState targetingMode:', {
        hasTargetingMode: !!newState.targetingMode,
        hasHandTargets: !!newState.targetingMode?.handTargets,
        handTargetsLength: newState.targetingMode?.handTargets?.length || 0,
        handTargets: newState.targetingMode?.handTargets,
      })
      return newState
    })

    // Broadcast via SimpleHost if available (P2P mode)
    // CRITICAL: Broadcast if we are HOST OR if owner is DUMMY (to sync across all clients)
    // When setting targetingMode for dummy player, any player can broadcast to ensure sync
    const shouldBroadcast = simpleHost && (localPlayerId === 1 || isOwnerDummy)
    console.log('[VISUAL EFFECTS] Broadcast check:', {
      hasSimpleHost: !!simpleHost,
      hasSimpleGuest: !!simpleGuest,
      localPlayerId,
      isHost: localPlayerId === 1,
      isOwnerDummy,
      shouldBroadcast,
    })
    if (shouldBroadcast) {
      // CRITICAL: When HOST sets targeting mode, update SimpleHost state directly
      // This ensures targetingMode is included in state broadcasts to all clients
      // including the host itself (via notifyStateUpdate callback)
      if (localPlayerId === 1) {
        simpleHost.setTargetingMode(targetingModeData)
        console.log('[VISUAL EFFECTS] Host setting targetingMode in SimpleHost state', {
          reason: 'isHost',
        })
      } else {
        // Non-host player setting targeting mode for dummy player - broadcast via SimpleVisualEffects
        const effects = new SimpleVisualEffects(simpleHost)
        effects.setTargetingMode(targetingModeData)
        console.log('[VISUAL EFFECTS] Broadcasting targetingMode to all clients via SimpleHost', {
          reason: 'isOwnerDummy',
        })
      }
    } else if (simpleGuest) {
      // CRITICAL: Guests must send targetingMode to host for broadcast
      // This fixes abilities like Faber that require hand card targeting
      simpleGuest.sendAction('TARGETING_MODE', targetingModeData)
      console.log('[VISUAL EFFECTS] Sending targetingMode to host via SimpleGuest')
    }
  }, [simpleHost, simpleGuest, gameStateRef, setGameState])

  /**
   * Clear targeting mode for all clients
   *
   * RULES:
   * 1. OWNER (ownerId === localPlayerId) can clear their own targetingMode
   * 2. HOST (localPlayerId === 1) can clear any targetingMode (controls gameState)
   * 3. ANY PLAYER can clear targetingMode if the owner is a DUMMY player (dummies are controlled by all players)
   * 4. When cleared, HOST broadcasts to all clients
   */
  const clearTargetingMode = useCallback(() => {
    console.log('[VISUAL EFFECTS] clearTargetingMode called')
    const currentGameState = gameStateRef.current
    const localPlayerId = currentGameState?.localPlayerId
    const targetingMode = currentGameState?.targetingMode

    if (!targetingMode) {
      console.log('[VISUAL EFFECTS] No targetingMode to clear')
      return
    }

    const isOwner = targetingMode.ownerId === localPlayerId
    const isHost = localPlayerId === 1

    // CRITICAL: Check if targetingMode owner is a dummy player
    // Dummy players are controlled by ALL players, so anyone can clear their targetingMode
    const ownerPlayer = currentGameState?.players?.find(p => p.id === targetingMode.ownerId)
    const isOwnerDummy = ownerPlayer?.isDummy ?? false

    // Only OWNER, HOST, or ANYONE (if owner is dummy) can clear targetingMode
    if (!isOwner && !isHost && !isOwnerDummy) {
      console.log('[VISUAL EFFECTS] Ignoring clear request (not owner, not host, and owner is not dummy):', {
        ownerId: targetingMode.ownerId,
        localPlayerId,
        isOwnerDummy,
      })
      return
    }

    // Clear local state
    setGameState((prev: any) => {
      console.log('[VISUAL EFFECTS] Clearing targetingMode in local state', {
        hadTargetingMode: !!prev.targetingMode,
        playerId: prev.targetingMode?.playerId,
        ownerId: prev.targetingMode?.ownerId,
        isOwner,
        isHost,
        isOwnerDummy,
      })
      return {
        ...prev,
        targetingMode: null,
      }
    })

    // Broadcast via SimpleHost if available (P2P mode)
    // CRITICAL: Broadcast if we are HOST OR if owner is DUMMY (to sync across all clients)
    // When clearing targetingMode for dummy player, any player can broadcast to ensure sync
    if (simpleHost && (isHost || isOwnerDummy)) {
      // CRITICAL: When HOST clears targeting mode, update SimpleHost state directly
      // This ensures the cleared targetingMode is reflected in state broadcasts
      if (isHost) {
        simpleHost.clearTargetingMode()
        console.log('[VISUAL EFFECTS] Host clearing targetingMode in SimpleHost state', {
          reason: 'isHost',
        })
      } else {
        // Non-host player clearing targeting mode for dummy player - broadcast via SimpleVisualEffects
        const effects = new SimpleVisualEffects(simpleHost)
        effects.clearTargetingMode()
        console.log('[VISUAL EFFECTS] Broadcasting clearTargetingMode to all clients', {
          reason: 'isOwnerDummy',
        })
      }
    }
  }, [simpleHost, gameStateRef, setGameState])

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
