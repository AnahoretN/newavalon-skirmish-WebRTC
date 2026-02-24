/**
 * useVisualEffects2 - ID-based Visual Effects System
 *
 * Replaces the old useVisualEffects hook with a proper ID-based system:
 * - Each effect has a unique 5-character ID
 * - Host tracks all effects and broadcasts add/remove messages
 * - Guests send effects to host, host rebroadcasts to all guests
 * - Automatic cleanup of expired effects
 *
 * This provides reliable synchronization with minimal message size.
 */

import { useCallback, useEffect, useRef } from 'react'
import type {
  VisualEffect,
  HighlightEffect,
  FloatingTextEffect,
  NoTargetEffect,
  ClickWaveEffect,
  AbilityAction,
  CommandContext,
} from '../types'
import type { WebRTCManager } from './core/types'
import {
  EffectsManager,
  generateEffectId,
  createHighlightEffect,
  createFloatingTextEffect,
  createNoTargetEffect,
  createClickWaveEffect,
  createTargetingModeEffect,
  encodeEffect,
  decodeEffect,
  type EffectAddMessage,
  type EffectRemoveMessage,
} from '../host/EffectsManager'
import { calculateValidTargets } from '@shared/utils/targeting'
import { logger } from '../utils/logger'

interface UseVisualEffects2Props {
  // WebSocket connection
  ws: React.MutableRefObject<WebSocket | null>
  // WebRTC manager
  webrtcManager: React.MutableRefObject<WebRTCManager | null>
  // Refs
  gameStateRef: React.MutableRefObject<any>
  localPlayerIdRef: React.MutableRefObject<number | null>
  webrtcIsHostRef: React.MutableRefObject<boolean>
  // State setters
  setGameState: React.Dispatch<React.SetStateAction<any>>
}

/**
 * Convert legacy highlight data to effect
 */
function highlightToEffect(data: {
  type: 'row' | 'col' | 'cell',
  row?: number,
  col?: number,
  playerId: number,
}, id?: string): HighlightEffect {
  return createHighlightEffect(data.playerId, data.type, data.row, data.col, id)
}

/**
 * Convert legacy floating text data to effect
 */
function floatingTextToEffect(data: {
  row: number,
  col: number,
  text: string,
  playerId: number,
  color?: string,
}, id?: string): FloatingTextEffect {
  return createFloatingTextEffect(data.playerId, data.row, data.col, data.text, data.color, id)
}

/**
 * Convert legacy no target data to effect
 */
function noTargetToEffect(data: {
  row: number,
  col: number,
  playerId: number,
}, id?: string): NoTargetEffect {
  return createNoTargetEffect(data.playerId, data.row, data.col, id)
}

/**
 * Convert legacy click wave data to effect
 */
function clickWaveToEffect(data: {
  location: 'board' | 'hand' | 'emptyCell',
  row?: number,
  col?: number,
  handPlayerId?: number,
  handCardIndex?: number,
  playerId: number,
}, id?: string): ClickWaveEffect {
  return createClickWaveEffect(
    data.playerId,
    data.location,
    data.row,
    data.col,
    data.handPlayerId,
    data.handCardIndex,
    id
  )
}

/**
 * Main hook for ID-based visual effects management
 */
export function useVisualEffects2(props: UseVisualEffects2Props) {
  const {
    ws,
    webrtcManager,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setGameState,
  } = props

  // Effects manager instance (local effects tracking)
  const effectsManagerRef = useRef<EffectsManager | null>(null)

  // Throttle for click waves
  const lastClickTimeRef = useRef<Record<number, number>>({})
  const CLICK_THROTTLE_MS = 500

  // Initialize effects manager
  useEffect(() => {
    const manager = new EffectsManager({
      onEffectAdd: (effect) => {
        // Update game state with new effect
        setGameState((prev: any) => {
          const effects = prev.visualEffects || new Map()
          effects.set(effect.id, effect)
          return { ...prev, visualEffects: new Map(effects) }
        })
      },
      onEffectRemove: (effectId) => {
        // Remove effect from game state
        setGameState((prev: any) => {
          const effects = prev.visualEffects || new Map()
          effects.delete(effectId)
          return { ...prev, visualEffects: new Map(effects) }
        })
      },
    })
    effectsManagerRef.current = manager

    return () => {
      manager.destroy()
      effectsManagerRef.current = null
    }
  }, [setGameState])

  /**
   * Broadcast effect add message to other players
   */
  const broadcastEffectAdd = useCallback((effect: VisualEffect) => {
    const encoded = encodeEffect(effect)

    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      // WebSocket mode - send to server for broadcast
      ws.current.send(JSON.stringify({
        type: 'EFFECT_ADD',
        gameId: gameStateRef.current.gameId,
        data: encoded,
      }))
    } else if (webrtcManager.current) {
      // WebRTC P2P mode
      const message = {
        type: 'EFFECT_ADD' as const,
        senderId: webrtcManager.current.getPeerId(),
        timestamp: Date.now(),
        data: encoded,
      }

      if (webrtcIsHostRef.current) {
        // Host broadcasts to all guests
        webrtcManager.current.broadcastToGuests(message)
      } else {
        // Guest sends to host for rebroadcast
        webrtcManager.current.sendMessageToHost(message)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef])

  /**
   * Broadcast effect remove message to other players
   */
  const broadcastEffectRemove = useCallback((effectId: string) => {
    const data: EffectRemoveMessage = { i: effectId }

    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      // WebSocket mode
      ws.current.send(JSON.stringify({
        type: 'EFFECT_REMOVE',
        gameId: gameStateRef.current.gameId,
        data,
      }))
    } else if (webrtcManager.current) {
      // WebRTC P2P mode
      const message = {
        type: 'EFFECT_REMOVE' as const,
        senderId: webrtcManager.current.getPeerId(),
        timestamp: Date.now(),
        data,
      }

      if (webrtcIsHostRef.current) {
        // Host broadcasts to all guests
        webrtcManager.current.broadcastToGuests(message)
      } else {
        // Guest sends to host for rebroadcast
        webrtcManager.current.sendMessageToHost(message)
      }
    }
  }, [ws, webrtcManager, gameStateRef, webrtcIsHostRef])

  /**
   * Add an effect locally and broadcast to others
   */
  const addEffect = useCallback((effect: VisualEffect, broadcast = true) => {
    const manager = effectsManagerRef.current
    if (!manager) return

    // Add locally
    const added = manager.addEffect(effect)
    if (added && broadcast) {
      // Broadcast to others
      broadcastEffectAdd(effect)
    }

    return added
  }, [broadcastEffectAdd])

  /**
   * Remove an effect locally and broadcast to others
   */
  const removeEffect = useCallback((effectId: string, broadcast = true) => {
    const manager = effectsManagerRef.current
    if (!manager) return

    // Remove locally
    const removed = manager.removeEffect(effectId)
    if (removed && broadcast) {
      // Broadcast to others
      broadcastEffectRemove(effectId)
    }

    return removed
  }, [broadcastEffectRemove])

  /**
   * Trigger highlight effect (legacy API compatibility)
   */
  const triggerHighlight = useCallback((
    type: 'row' | 'col' | 'cell',
    row?: number,
    col?: number,
    playerId?: number
  ) => {
    const actualPlayerId = playerId ?? localPlayerIdRef.current
    if (actualPlayerId === null) return

    const effect = createHighlightEffect(actualPlayerId, type, row, col)
    addEffect(effect)
  }, [localPlayerIdRef, addEffect])

  /**
   * Trigger floating text effect(s) (legacy API compatibility)
   */
  const triggerFloatingText = useCallback((
    data: Omit<FloatingTextEffect, 'id' | 'type' | 'playerId' | 'createdAt'> |
           Omit<FloatingTextEffect, 'id' | 'type' | 'playerId' | 'createdAt'>[]
  ) => {
    const playerId = localPlayerIdRef.current
    if (playerId === null) return

    const items = Array.isArray(data) ? data : [data]
    items.forEach(item => {
      const effect = createFloatingTextEffect(
        playerId,
        item.row,
        item.col,
        item.text,
        item.color
      )
      addEffect(effect)
    })
  }, [localPlayerIdRef, addEffect])

  /**
   * Trigger no-target overlay (legacy API compatibility)
   */
  const triggerNoTarget = useCallback((
    coords: { row: number, col: number }
  ) => {
    const playerId = localPlayerIdRef.current
    if (playerId === null) return

    const effect = createNoTargetEffect(playerId, coords.row, coords.col)
    addEffect(effect)
  }, [localPlayerIdRef, addEffect])

  /**
   * Trigger click wave effect (legacy API compatibility)
   */
  const triggerClickWave = useCallback((
    location: 'board' | 'hand' | 'emptyCell',
    boardCoords?: { row: number; col: number },
    handTarget?: { playerId: number; cardIndex: number }
  ) => {
    const playerId = localPlayerIdRef.current
    if (playerId === null) return

    // Throttle click waves
    const now = Date.now()
    const lastClickTime = lastClickTimeRef.current[playerId] || 0
    if (now - lastClickTime < CLICK_THROTTLE_MS) {
      return
    }
    lastClickTimeRef.current[playerId] = now

    const effect = createClickWaveEffect(
      playerId,
      location,
      boardCoords?.row,
      boardCoords?.col,
      handTarget?.playerId,
      handTarget?.cardIndex
    )
    addEffect(effect)

    // Auto-remove after animation
    setTimeout(() => {
      removeEffect(effect.id)
    }, 600)
  }, [localPlayerIdRef, addEffect, removeEffect])

  /**
   * Set targeting mode (legacy API compatibility)
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
    let boardTargets: { row: number, col: number }[] = []
    if (preCalculatedTargets) {
      boardTargets = preCalculatedTargets
    } else if (sourceCoords) {
      boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)
    }

    // Create targeting mode effect
    const effect = createTargetingModeEffect(
      playerId,
      action.mode || '',
      boardTargets,
      preCalculatedHandTargets || [],
      false, // isDeckSelectable - can be passed as param if needed
      sourceCoords?.row,
      sourceCoords?.col
    )

    addEffect(effect)

    // Also update legacy targetingMode field for backward compatibility
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: {
        playerId,
        action,
        sourceCoords,
        timestamp: Date.now(),
        boardTargets,
        handTargets: preCalculatedHandTargets,
      },
    }))
  }, [gameStateRef, setGameState, addEffect])

  /**
   * Clear targeting mode (legacy API compatibility)
   */
  const clearTargetingMode = useCallback(() => {
    const manager = effectsManagerRef.current
    if (!manager) return

    // Remove all targeting mode effects
    const targetingEffects = manager.getEffectsByType('targetingMode')
    targetingEffects.forEach(effect => {
      removeEffect(effect.id)
    })

    // Also clear legacy targetingMode field
    setGameState((prev: any) => ({
      ...prev,
      targetingMode: null,
    }))
  }, [removeEffect, setGameState])

  /**
   * Handle incoming EFFECT_ADD message
   */
  const handleEffectAdd = useCallback((message: any) => {
    const ourPeerId = webrtcManager.current?.getPeerId()

    // Ignore loopback (our own message)
    if (message.senderId && message.senderId === ourPeerId) {
      return
    }

    const encoded = message.data as EffectAddMessage
    const effect = decodeEffect(encoded)

    if (effect) {
      // Add locally without rebroadcasting
      addEffect(effect, false)
    } else {
      logger.warn('[handleEffectAdd] Failed to decode effect:', encoded)
    }
  }, [addEffect])

  /**
   * Handle incoming EFFECT_REMOVE message
   */
  const handleEffectRemove = useCallback((message: any) => {
    const ourPeerId = webrtcManager.current?.getPeerId()

    // Ignore loopback
    if (message.senderId && message.senderId === ourPeerId) {
      return
    }

    const data = message.data as EffectRemoveMessage
    // Remove locally without rebroadcasting
    removeEffect(data.i, false)
  }, [removeEffect])

  /**
   * Handle incoming EFFECT_CLEAR_ALL message
   */
  const handleEffectClearAll = useCallback(() => {
    const manager = effectsManagerRef.current
    if (!manager) return

    manager.clearAll()
  }, [])

  return {
    // Legacy API for backward compatibility
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerClickWave,
    setTargetingMode,
    clearTargetingMode,

    // New API
    addEffect,
    removeEffect,
    effectsManager: effectsManagerRef.current,

    // Message handlers (to be registered in useGameState)
    handleEffectAdd,
    handleEffectRemove,
    handleEffectClearAll,
  }
}
