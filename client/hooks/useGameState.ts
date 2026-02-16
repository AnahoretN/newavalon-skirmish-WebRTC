// ... existing imports
import { useState, useEffect, useCallback, useRef } from 'react'
import { DeckType, GameMode as GameModeEnum } from '../types'
import type { GameState, Player, Board, GridSize, DragItem, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData, StateDelta, Card } from '../types'
import { PLAYER_COLOR_NAMES } from '../constants'
import { rawJsonData, getCardDefinition, getCardDefinitionByName, commandCardIds } from '../content'
import { createInitialBoard, recalculateBoardStatuses } from '@shared/utils/boardUtils'
import { logger } from '../utils/logger'
import { deepCloneState, TIMING } from '../utils/common'
import { getWebrtcManager, type WebrtcEvent } from '../utils/webrtcManager'
import type { WebrtcMessage } from '../host/types'
import { toggleActivePlayer as toggleActivePlayerPhase, performPreparationPhase } from '../host/PhaseManagement'
import {
  applyStateDelta,
  createReconnectSnapshot
} from '../utils/stateDelta'
// New optimized WebRTC serialization
import {
  deserializeDelta,
  deserializeDeltaBase64,
  deserializeFromBinary,
  expandMinimalGameState
} from '../utils/webrtcSerialization'
// New WebRTC message handlers (handles CARD_STATE, ABILITY_EFFECT, SESSION_EVENT)
import { handleCodecMessage } from '../utils/webrtcMessageHandlers'
import { saveGuestData, saveWebrtcState, loadGuestData, loadHostData, loadWebrtcState, getRestorableSessionType, clearWebrtcData, broadcastHostPeerId, getHostPeerIdForGame } from '../host/WebrtcStatePersistence'
// Storage functions extracted to gameStateStorage.ts
import {
  syncGameStateImages,
  saveGameState,
  loadGameState,
  clearGameState,
  RECONNECTION_DATA_KEY
} from './core/gameStateStorage'
// Game creator functions extracted to gameCreators.ts
import {
  generateGameId,
  createDeck,
  createInitialState
} from './core/gameCreators'
// WebSocket helpers extracted to websocketHelpers.ts
import { getWebSocketURL } from './core/websocketHelpers'
// Common types extracted to types.ts
import type { ConnectionStatus, UseGameStateProps } from './core/types'
// Visual effects extracted to useVisualEffects.ts
import { useVisualEffects } from './core/useVisualEffects'
// Game settings extracted to useGameSettings.ts
import { useGameSettings } from './core/useGameSettings'
// Ready check extracted to useReadyCheck.ts
import { useReadyCheck } from './core/useReadyCheck'
// Player actions extracted to usePlayerActions.ts
import { usePlayerActions } from './core/usePlayerActions'
// Card operations extracted to useCardOperations.ts
import { useCardOperations } from './core/useCardOperations'
// Card status extracted to useCardStatus.ts
import { useCardStatus } from './core/useCardStatus'
// Deck management extracted to useDeckManagement.ts
import { useDeckManagement } from './core/useDeckManagement'
// Phase management extracted to usePhaseManagement.ts
import { usePhaseManagement } from './core/usePhaseManagement'
// Scoring extracted to useScoring.ts
import { useScoring } from './core/useScoring'
// Board manipulation extracted to useBoardManipulation.ts
import { useBoardManipulation } from './core/useBoardManipulation'
import { useCardMovement } from './core/useCardMovement'
import { useTargetingMode } from './core/useTargetingMode'
import { useWebRTC } from './core/useWebRTC'
import { useGameLifecycle } from './core/useGameLifecycle'

/**
 * Accumulates score change deltas for each player.
 * When player score changes rapidly (within 500ms), deltas are accumulated
 * and sent to server as a single message with the total delta.
 */
const scoreDeltaAccumulator = new Map<number, { delta: number, timerId: ReturnType<typeof setTimeout> }>()

export const useGameState = (props: UseGameStateProps = {}) => {
  const { abilityMode, setAbilityMode } = props;

  const [gameState, setGameState] = useState<GameState>(createInitialState())

  // Previous state ref for delta calculation
  const prevStateRef = useRef<GameState>(createInitialState())

  // Wrapper for setGameState that broadcasts delta in WebRTC mode
  const setGameStateWithDelta = useCallback((updater: React.SetStateAction<GameState>) => {
    setGameState(prevState => {
      const newState = typeof updater === 'function' ? (updater as (prev: GameState) => GameState)(prevState) : updater

      // Update previous state ref
      prevStateRef.current = prevState

      // In WebRTC host mode, broadcast state to guests
      const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'
      if (isWebRTCMode && webrtcIsHostRef.current) {
        // Schedule state broadcast after state update (use setTimeout to avoid blocking)
        setTimeout(() => {
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.broadcastGameState(newState)
            logger.debug(`[setGameStateWithDelta] Broadcast state: phase=${newState.currentPhase}, round=${newState.currentRound}`)
          }
        }, 0)
      }

      return newState
    })
  }, [])

  const [localPlayerId, setLocalPlayerId] = useState<number | null>(null)

  // Create refs early for use in hooks and effects
  const gameStateRef = useRef(gameState)
  const localPlayerIdRef = useRef(localPlayerId)

  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting')
  const [gamesList, setGamesList] = useState<{gameId: string, playerCount: number}[]>([])
  const [latestHighlight, setLatestHighlight] = useState<HighlightData | null>(null)
  const [latestFloatingTexts, setLatestFloatingTexts] = useState<FloatingTextData[] | null>(null)
  const [latestNoTarget, setLatestNoTarget] = useState<{coords: {row: number, col: number}, timestamp: number} | null>(null)
  const [latestDeckSelections, setLatestDeckSelections] = useState<DeckSelectionData[]>([])
  const [latestHandCardSelections, setLatestHandCardSelections] = useState<HandCardSelectionData[]>([])
  const [targetSelectionEffects, setTargetSelectionEffects] = useState<any[]>([])
  // Valid targets received from other players (for synchronized targeting UI)
  const [remoteValidTargets, setRemoteValidTargets] = useState<{
    playerId: number
    validHandTargets: { playerId: number, cardIndex: number }[]
    isDeckSelectable: boolean
  } | null>(null)
  const [contentLoaded, setContentLoaded] = useState(!!rawJsonData)

  // WebRTC P2P mode state
  const [webrtcEnabled, setWebrtcEnabled] = useState(false)
  const [webrtcHostId, setWebrtcHostId] = useState<string | null>(null)
  const [webrtcIsHost, setWebrtcIsHost] = useState(false)
  const webrtcIsHostRef = useRef<boolean>(false)  // Ref to always have current value
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [reconnectProgress, setReconnectProgress] = useState<{ attempt: number; maxAttempts: number; timeRemaining: number } | null>(null)
  const recentlyRestoredFromStorageRef = useRef<boolean>(false)  // Track if we just restored from localStorage (to avoid overwriting with stale state)

  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const joiningGameIdRef = useRef<string | null>(null)
  const isManualExitRef = useRef<boolean>(false)
  const isJoinAttemptRef = useRef<boolean>(false) // Track if user is trying to join via Join Game modal
  const playerTokenRef = useRef<string | undefined>(undefined)
  const receivedServerStateRef = useRef<boolean>(false) // Track if we've received server state after connection

  // WebRTC manager ref
  const webrtcManagerRef = useRef<ReturnType<typeof getWebrtcManager> | null>(null)

  // Ref for setGameStateWithDelta (used in callbacks)
  const setGameStateWithDeltaRef = useRef<(updater: React.SetStateAction<GameState>, sourcePlayerId?: number) => void>(() => {})

  // WebRTC P2P hook - handles WebRTC host/guest functions
  const webrtc = useWebRTC({
    webrtcManagerRef,
    webrtcIsHostRef,
    setWebrtcIsHost,
    setConnectionStatus,
    setWebrtcHostId,
    gameStateRef,
    localPlayerIdRef,
  })

  // Destructure WebRTC functions for direct access
  const {
    initializeWebrtcHost,
    connectAsGuest,
    sendWebrtcAction,
    requestDeckView,
    sendFullDeckToHost,
  } = webrtc

  // Update ref when function changes
  useEffect(() => {
    setGameStateWithDeltaRef.current = setGameStateWithDelta
  }, [setGameStateWithDelta])

  // Sync webrtcIsHost ref with state (for use in callbacks that need current value)
  useEffect(() => {
    webrtcIsHostRef.current = webrtcIsHost
  }, [webrtcIsHost])

  // Initialize WebRTC manager
  useEffect(() => {
    // Check if WebRTC is enabled in settings
    const webrtcSetting = localStorage.getItem('webrtc_enabled') === 'true'
    setWebrtcEnabled(webrtcSetting)

    if (webrtcSetting) {
      webrtcManagerRef.current = getWebrtcManager()
      logger.info('WebRTC manager initialized')

      // Setup WebRTC event handlers
      const cleanup = webrtcManagerRef.current.on((event: WebrtcEvent) => {
        handleWebrtcEvent(event)
      })

      return () => {
        cleanup()
        // Don't destroy manager on unmount, just cleanup listeners
        // Note: This cleanup runs on HMR and unmount - we only remove listeners
      }
    }
    return undefined
  }, [])

  // Auto-restore WebRTC session on page load
  useEffect(() => {
    // Skip if WebRTC is not enabled
    const webrtcSetting = localStorage.getItem('webrtc_enabled') === 'true'
    if (!webrtcSetting) {return}

    // Skip if URL has hostId parameter (fresh join link)
    const hash = window.location.hash.slice(1)
    if (hash) {
      const params = new URLSearchParams(hash)
      if (params.get('hostId')) {
        logger.info('[Auto-restore] Skipping due to hostId in URL (fresh join)')
        return
      }
    }

    // IMPORTANT: Prevent duplicate auto-restore on React Fast Refresh (HMR)
    // Use sessionStorage flag since it persists across HMR but not page reload
    const restoreKey = 'webrtc_auto_restore_attempted'
    if (sessionStorage.getItem(restoreKey)) {
      logger.info('[Auto-restore] Skipping - already attempted in this session')
      return
    }
    sessionStorage.setItem(restoreKey, 'true')

    // Check if there's a restorable session
    const sessionType = getRestorableSessionType()
    if (sessionType === 'none') {
      logger.info('[Auto-restore] No restorable session found')
      sessionStorage.removeItem(restoreKey)
      return
    }

    logger.info(`[Auto-restore] Found restorable ${sessionType} session, attempting restore...`)

    // Small delay to ensure WebRTC manager is ready
    setTimeout(async () => {
      if (!webrtcManagerRef.current) {
        logger.warn('[Auto-restore] WebRTC manager not ready')
        return
      }

      try {
        if (sessionType === 'host') {
          // Set restoration flag to prevent exitGame from clearing data
          isRestoringSessionRef.current = true
          logger.info('[Auto-restore] Setting restoration flag to prevent premature exit')

          // Restore host session
          const hostData = loadHostData()
          const stateData = loadWebrtcState()

          if (!hostData || !stateData) {
            logger.warn('[Auto-restore] Missing host data or state data')
            clearWebrtcData()
            isRestoringSessionRef.current = false
            sessionStorage.removeItem('webrtc_auto_restore_attempted')
            return
          }

          logger.info(`[Auto-restore] Restoring host session: old peerId=${hostData.peerId}`)

          // IMPORTANT: Do NOT reuse old peerId - PeerJS cannot reuse peerIds after page reload
          // Always create a NEW peerId and broadcast it so guests can discover it
          const peerId = await webrtcManagerRef.current.initializeAsHost()
          webrtcIsHostRef.current = true  // Set ref immediately for synchronous access
          setWebrtcIsHost(true)
          setWebrtcHostId(peerId)  // Set NEW host peer ID for sharing
          setConnectionStatus('Connected')

          // CRITICAL: Immediately broadcast NEW peerId so guests can reconnect!
          // Guests will discover this via localStorage polling
          if (stateData.gameState?.gameId) {
            broadcastHostPeerId(peerId, stateData.gameState.gameId)
            logger.info(`[Auto-restore] Broadcasted NEW host peerId ${peerId} for game ${stateData.gameState.gameId}`)
          }

          // Restore game state and localPlayerId atomically to prevent race condition
          // Use a batch update with setTimeout to ensure both are set before React renders
          if (stateData.gameState || stateData.localPlayerId !== null) {
            // Update refs synchronously for immediate access
            if (stateData.gameState) {
              gameStateRef.current = stateData.gameState
            }
            if (stateData.localPlayerId !== null) {
              localPlayerIdRef.current = stateData.localPlayerId
            }

            // Mark that we just restored from storage (to avoid overwriting with stale state)
            recentlyRestoredFromStorageRef.current = true
            // Clear the flag after 10 seconds (giving time for all guests to reconnect)
            setTimeout(() => {
              recentlyRestoredFromStorageRef.current = false
            }, 10000)

            // Batch state updates to prevent isGameActive from flickering
            setTimeout(() => {
              if (stateData.gameState) {
                setGameState(stateData.gameState)
                logger.info(`[Auto-restore] Restored game state with ${stateData.gameState.players?.length || 0} players, gameId=${stateData.gameState.gameId}`)
              }
              if (stateData.localPlayerId !== null) {
                setLocalPlayerId(stateData.localPlayerId)
                logger.info(`[Auto-restore] Restored local player ID: ${stateData.localPlayerId}`)
              }
            }, 0)
          }

          // Clear restoration flag after a delay to ensure state has been applied
          setTimeout(() => {
            isRestoringSessionRef.current = false
            logger.info('[Auto-restore] Cleared restoration flag')

            // After host restores from F5, request deck data from all connected guests
            // This is needed because guest decks are not persisted in host's gameState
            if (webrtcManagerRef.current && stateData.gameState) {
              const guestPlayers = stateData.gameState.players.filter(p => !p.isDummy && p.id !== stateData.localPlayerId)
              if (guestPlayers.length > 0) {
                logger.info(`[Auto-restore] Requesting deck data from ${guestPlayers.length} guest players`)
                webrtcManagerRef.current.broadcastToGuests({
                  type: 'REQUEST_DECK_DATA',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  timestamp: Date.now()
                })
              }
            }
          }, 500)  // Wait 500ms for guests to reconnect before requesting decks

          logger.info('[Auto-restore] Host session restoration initiated')

        } else if (sessionType === 'guest') {
          // Set restoration flag to prevent exitGame from clearing data
          isRestoringSessionRef.current = true
          logger.info('[Auto-restore] Setting restoration flag to prevent premature exit')

          // Restore guest session
          const guestData = loadGuestData()
          const stateData = loadWebrtcState()

          if (!guestData || !stateData) {
            logger.warn('[Auto-restore] Missing guest data or state data')
            clearWebrtcData()
            isRestoringSessionRef.current = false
            sessionStorage.removeItem('webrtc_auto_restore_attempted')
            return
          }

          logger.info(`[Auto-restore] Restoring guest session: old hostPeerId=${guestData.hostPeerId}, playerId=${guestData.playerId}`)

          webrtcIsHostRef.current = false  // Set ref immediately for synchronous access
          setWebrtcIsHost(false)
          setConnectionStatus('Connecting')

          // CRITICAL: Check if host has broadcasted a NEW peerId (after F5)
          // Host broadcasts new peerId to localStorage after every page reload
          let hostPeerId = guestData.hostPeerId
          if (stateData.gameState?.gameId) {
            const hostData = getHostPeerIdForGame(stateData.gameState.gameId)
            if (hostData && hostData.peerId) {
              hostPeerId = hostData.peerId
              logger.info(`[Auto-restore] Found NEW host peerId in localStorage: ${hostPeerId}`)
            }
          }

          setWebrtcHostId(hostPeerId)  // Set host peer ID (might be new)

          // If we have a player ID, reconnect as existing player
          if (guestData.playerId !== null) {
            logger.info(`[Auto-restore] Reconnecting as existing player ${guestData.playerId} to host ${hostPeerId}`)
            try {
              await webrtcManagerRef.current.initializeAsReconnectingGuest(hostPeerId, guestData.playerId)
              // Connection succeeded - we're now connected
              setConnectionStatus('Connected')
              logger.info('[Auto-restore] Successfully reconnected to host')
            } catch (err) {
              logger.error('[Auto-restore] Failed to reconnect to host:', err)
              setConnectionStatus('Disconnected')
              // Clear stale guest data so next refresh starts fresh instead of trying to reconnect again
              clearWebrtcData()
              logger.info('[Auto-restore] Cleared stale guest data due to failed reconnection')
              isRestoringSessionRef.current = false
              sessionStorage.removeItem('webrtc_auto_restore_attempted')
              return
            }
          } else {
            // New player - fall back to standard join
            logger.info(`[Auto-restore] Connecting as new player`)
            await webrtcManagerRef.current.initializeAsGuest(hostPeerId)
            setConnectionStatus('Connected')
          }

          // Restore game state and localPlayerId atomically to prevent race condition
          if (stateData.gameState || stateData.localPlayerId !== null) {
            // Update refs synchronously for immediate access
            if (stateData.gameState) {
              gameStateRef.current = stateData.gameState
            }
            if (stateData.localPlayerId !== null) {
              localPlayerIdRef.current = stateData.localPlayerId
            }

            // Mark that we just restored from storage (to avoid overwriting with stale state)
            recentlyRestoredFromStorageRef.current = true
            // Clear the flag after 10 seconds (giving time for reconnection to complete)
            setTimeout(() => {
              recentlyRestoredFromStorageRef.current = false
            }, 10000)

            // Batch state updates to prevent isGameActive from flickering
            setTimeout(() => {
              if (stateData.gameState) {
                setGameState(stateData.gameState)
                logger.info(`[Auto-restore] Restored game state with ${stateData.gameState.players?.length || 0} players, gameId=${stateData.gameState.gameId}, isGameStarted=${stateData.gameState.isGameStarted}`)

                // Verify player exists in restored state
                if (stateData.localPlayerId !== null) {
                  const playerExists = stateData.gameState.players?.some(p => p.id === stateData.localPlayerId)
                  logger.info(`[Auto-restore] Player ${stateData.localPlayerId} exists in restored state: ${playerExists}`)
                }
              }
              if (stateData.localPlayerId !== null) {
                setLocalPlayerId(stateData.localPlayerId)
                logger.info(`[Auto-restore] Restored local player ID: ${stateData.localPlayerId}`)
              }
            }, 0)
          }

          // Clear restoration flag after a delay to ensure state has been applied
          setTimeout(() => {
            isRestoringSessionRef.current = false
            logger.info('[Auto-restore] Cleared restoration flag')
          }, 100)

          logger.info('[Auto-restore] Guest session restoration initiated')
        }
      } catch (err) {
        logger.error('[Auto-restore] Failed to restore session:', err)
        clearWebrtcData()
        isRestoringSessionRef.current = false
        sessionStorage.removeItem('webrtc_auto_restore_attempted')
      }
    }, 100)
  }, [])

  // Check URL for hostId parameter (WebRTC guest join)
  useEffect(() => {
    if (!webrtcEnabled || !webrtcManagerRef.current) {return}

    const hash = window.location.hash.slice(1)
    if (!hash) {return}

    const params = new URLSearchParams(hash)
    const hostId = params.get('hostId')

    if (hostId) {
      // Auto-connect as guest to host
      logger.info(`Found hostId in URL: ${hostId}, connecting as guest...`)
      connectAsGuest(hostId)
    }
  }, [webrtcEnabled])

  // Sync refs with state values
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    localPlayerIdRef.current = localPlayerId
  }, [localPlayerId])

  // Visual effects hook - handles all visual effect triggers and broadcasts
  const visualEffects = useVisualEffects({
    ws,
    webrtcManager: webrtcManagerRef,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setLatestHighlight,
    setLatestFloatingTexts,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setTargetSelectionEffects,
    setGameState,
  })

  // Track if restoration is in progress to prevent exitGame from clearing data
  const isRestoringSessionRef = useRef(false)

  // ==================== Host PeerId Broadcasting ====================
  // Host periodically broadcasts its current peerId so guests can reconnect after F5
  useEffect(() => {
    if (!webrtcEnabled || !webrtcIsHostRef.current || !gameState?.gameId) {return}

    const gameId = gameState.gameId

    // Broadcast immediately and every 2 seconds
    const broadcast = () => {
      const currentPeerId = webrtcManagerRef.current?.getPeerId()
      if (currentPeerId && gameId) {
        broadcastHostPeerId(currentPeerId, gameId)
      }
    }

    broadcast() // Broadcast immediately
    const interval = setInterval(broadcast, 2000) // Broadcast every 2 seconds

    return () => clearInterval(interval)
  }, [webrtcEnabled, gameState?.gameId])

  // ==================== Guest Auto-Reconnect ====================
  // Guests monitor for host peerId changes and auto-reconnect
  useEffect(() => {
    if (!webrtcEnabled || webrtcIsHostRef.current || !gameState?.gameId) {return}

    const gameId = gameState.gameId

    // Function to attempt reconnection to new host peerId
    const attemptReconnect = (newHostPeerId: string): void => {
      logger.info(`[Guest Auto-Reconnect] Attempting reconnect to host: ${newHostPeerId} (old: ${webrtcHostId})`)

      // Update state first
      setWebrtcHostId(newHostPeerId)
      setConnectionStatus('Connecting')

      webrtcManagerRef.current?.initializeAsReconnectingGuest(newHostPeerId, localPlayerIdRef.current || 0)
        .then(() => {
          logger.info('[Guest Auto-Reconnect] Successfully reconnected to host')
          setConnectionStatus('Connected')
        })
        .catch((err) => {
          logger.error('[Guest Auto-Reconnect] Failed to reconnect:', err)
          setConnectionStatus('Disconnected')
        })
    }

    // Storage event handler - triggered when localStorage changes in another window
    const handleStorageChange = (e: StorageEvent) => {
      const expectedKey = `webrtc_host_${gameId}`
      if (e.key !== expectedKey || !e.newValue) {return}

      try {
        const data = JSON.parse(e.newValue)
        const newHostPeerId = data.peerId

        // Reconnect if peerId changed (regardless of connection status - the old connection is dead)
        if (newHostPeerId && newHostPeerId !== webrtcHostId) {
          attemptReconnect(newHostPeerId)
        }
      } catch (err) {
        logger.error('[Guest Auto-Reconnect] Failed to parse storage event:', err)
      }
    }

    // Check more frequently when not connected, less frequently when connected
    const checkInterval = setInterval(() => {
      // Always check if there's a newer host peerId available
      const hostData = getHostPeerIdForGame(gameId)
      if (hostData && hostData.peerId !== webrtcHostId) {
        logger.info(`[Guest Auto-Reconnect] Periodic check found new host peerId: ${hostData.peerId}`)
        attemptReconnect(hostData.peerId)
      }
    }, 2000) // Check every 2 seconds

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(checkInterval)
    }
  }, [webrtcEnabled, gameState?.gameId, webrtcHostId])

  // Auto-cleanup old floating texts (highlights persist while ability mode is active)
  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        const now = Date.now()
        // Ensure arrays exist (for backwards compatibility with old saved states)
        const prevFloatingTexts = prev.floatingTexts || []
        const filteredFloatingTexts = prevFloatingTexts.filter(t => now - t.timestamp < TIMING.FLOATING_TEXT_DURATION)

        if (filteredFloatingTexts.length !== prevFloatingTexts.length) {
          return { ...prev, floatingTexts: filteredFloatingTexts }
        }
        return prev
      })
    }, TIMING.DECK_SYNC_DELAY)
    return () => clearInterval(interval)
  }, [])

  /**
   * updateState - Low-level API to update game state and synchronize with server
   *
   * This is a low-level API that should only be used from orchestrating components.
   * It sends the updated state to the server via WebSocket for all clients to sync.
   * Avoid using this for purely local UI state mutations to avoid unnecessary server spam.
   *
   * @param newStateOrFn - New state object or function deriving new state from previous state
   */

  /**
   * Handle WebRTC events from the P2P manager
   */
  const handleWebrtcEvent = useCallback((event: WebrtcEvent) => {
    switch (event.type) {
      case 'peer_open':
        // Host: Peer is ready, peerId is available
        if (event.data?.peerId) {
          setWebrtcHostId(event.data.peerId)
          logger.info(`WebRTC peer opened with ID: ${event.data.peerId}`)
        }
        break

      case 'guest_connected':
        // Host: A new guest connected
        logger.info('Guest connected via WebRTC:', event.data?.peerId)
        break

      case 'connected_to_host':
        // Guest: Successfully connected to host
        // Update webrtcHostId from event data (important for reconnection tracking)
        if (event.data?.hostPeerId && webrtcHostId !== event.data.hostPeerId) {
          setWebrtcHostId(event.data.hostPeerId)
          logger.info(`Updated webrtcHostId to: ${event.data.hostPeerId}`)
        }
        setConnectionStatus('Connected')
        setIsReconnecting(false)
        setReconnectProgress(null)
        // Clear the restored-from-storage flag since we're now connected
        recentlyRestoredFromStorageRef.current = false
        // Clear stored reconnection data on successful connect
        try {
          localStorage.removeItem('webrtc_reconnection_data')
        } catch (e) {}
        logger.info('Connected to host via WebRTC')
        break

      case 'host_disconnected':
      case 'guest_disconnected':
        logger.warn('WebRTC peer disconnected')
        setConnectionStatus('Disconnected')
        setIsReconnecting(true)  // Show reconnection modal to all players

        // Start automatic reconnection for guests
        if (!webrtcIsHostRef.current && webrtcHostId && gameState) {
          // Store current state for reconnection
          try {
            const reconnectionData = {
              hostPeerId: webrtcHostId,
              playerId: localPlayerId,
              gameState: gameState,
              timestamp: Date.now(),
              isHost: false
            }
            localStorage.setItem('webrtc_reconnection_data', JSON.stringify(reconnectionData))
            logger.info('[Reconnection] Stored reconnection data before disconnect')

            // Start reconnection
            startGuestReconnection(webrtcHostId)
          } catch (e) {
            logger.error('[Reconnection] Failed to store data:', e)
          }
        }
        break

      case 'message_received':
        // Handle incoming WebRTC message
        handleWebrtcMessage(event.data)
        break

      case 'error':
        logger.error('WebRTC error:', event.data)
        break
    }
  }, [gameState, localPlayerId, webrtcHostId, webrtcIsHost])

  /**
   * Handle WebRTC guest join request (host only)
   * Adds new player to game and sends current state to guest
   */
  const handleWebrtcGuestJoin = useCallback((guestPeerId: string, joinData?: any) => {
    logger.info(`[handleWebrtcGuestJoin] Called for guest ${guestPeerId}, isHost: ${webrtcIsHostRef.current}`)
    if (!webrtcIsHostRef.current || !webrtcManagerRef.current) {
      logger.warn('[handleWebrtcGuestJoin] Not a host or manager not initialized')
      return
    }

    // Get guest's preferred deck from join request
    const preferredDeck = joinData?.preferredDeck || 'Random'
    logger.info(`[handleWebrtcGuestJoin] Guest's preferred deck: ${preferredDeck}`)

    setGameState(prevState => {
      if (!prevState) {
        logger.error('[handleWebrtcGuestJoin] No previous state')
        return prevState
      }

      logger.info(`[handleWebrtcGuestJoin] Current state has ${prevState.players.length} players`)

      // Find next available player ID
      const existingPlayerIds = prevState.players.map(p => p.id)
      let newPlayerId = 1
      while (existingPlayerIds.includes(newPlayerId)) {
        newPlayerId++
      }

      // Create new player with guest's preferred deck
      const newPlayer: Player = {
        id: newPlayerId,
        name: `Player ${newPlayerId}`,
        color: PLAYER_COLOR_NAMES[existingPlayerIds.length % PLAYER_COLOR_NAMES.length],
        hand: [],
        deck: [],
        discard: [],
        announcedCard: null,
        score: 0,
        isDummy: false,
        isReady: false,
        selectedDeck: preferredDeck as DeckType,
        boardHistory: [],
        autoDrawEnabled: true,
      }

      // Add new player to state
      const newState = {
        ...prevState,
        players: [...prevState.players, newPlayer]
      }

      logger.info(`[handleWebrtcGuestJoin] Calling acceptGuest for ${guestPeerId} as player ${newPlayerId}`)

      // Accept guest - send minimal join info with deck sizes (not full decks)
      // The guest will create their own minimal state
      // Optimize board to avoid sending too much data
      const optimizedBoard = prevState.board.map(row =>
        row.map(cell => ({
          ...cell,
          // Only send minimal card info for board cards
          card: cell.card ? {
            id: cell.card.id,
            baseId: cell.card.baseId,
            ownerId: cell.card.ownerId,
            name: cell.card.name,
            imageUrl: cell.card.imageUrl,
            power: cell.card.power,
            ability: cell.card.ability,
            isFaceDown: cell.card.isFaceDown,
            statuses: cell.card.statuses || [],
          } : null
        }))
      )

      // Optimize dummy player cards to avoid exceeding WebRTC message size limit
      const optimizeCards = (cards: any[]) => cards.map(card => ({
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
      }))

      webrtcManagerRef.current!.acceptGuestMinimal(
        guestPeerId,
        {
          playerId: newPlayerId,
          gameId: prevState.gameId,
          isGameStarted: prevState.isGameStarted,
          players: newState.players.map(p => {
            // For dummy players, send minimized card data so all players see dummy cards
            // For real players, send only sizes (privacy)
            if (p.isDummy) {
              return {
                id: p.id,
                name: p.name,
                color: p.color,
                isDummy: p.isDummy,
                isReady: p.isReady,
                score: p.score,
                selectedDeck: p.selectedDeck,
                // Send minimized cards for dummy players (avoid message size limit)
                hand: optimizeCards(p.hand || []),
                deck: optimizeCards(p.deck || []),
                discard: optimizeCards(p.discard || []),
                handSize: p.hand.length,
                deckSize: p.deck.length,
                discardSize: p.discard.length,
              }
            }
            return {
              id: p.id,
              name: p.name,
              color: p.color,
              isDummy: p.isDummy,
              isReady: p.isReady,
              score: p.score,
              selectedDeck: p.selectedDeck,
              // Send deck sizes so guests can see how many cards other players have
              deckSize: p.deck.length,
              handSize: p.hand.length,
              discardSize: p.discard.length,
            }
          }),
          deckSelections: newState.players.map(p => ({ id: p.id, selectedDeck: p.selectedDeck })),
          gameMode: prevState.gameMode,
          currentRound: prevState.currentRound,
          currentPhase: prevState.currentPhase,
          activePlayerId: prevState.activePlayerId,
          startingPlayerId: prevState.startingPlayerId,
          activeGridSize: prevState.activeGridSize,
          // Include optimized board state so guests can see cards on the board
          board: optimizedBoard,
        },
        newPlayerId
      )

      // No need for separate STATE_UPDATE - JOIN_ACCEPT_MINIMAL already has all necessary info
      // The guest will create their own deck when they receive the message

      // Broadcast the new player addition to all existing guests (so they see the new player in their UI)
      webrtcManagerRef.current!.broadcastGameState(newState, guestPeerId)  // Exclude the new guest (they get JOIN_ACCEPT_MINIMAL)
      logger.info(`[handleWebrtcGuestJoin] Broadcasted new player ${newPlayerId} to existing guests`)

      // Broadcast deck selection of new player to all existing guests
      webrtcManagerRef.current!.broadcastToGuests({
        type: 'SYNC_DECK_SELECTIONS',
        senderId: webrtcManagerRef.current!.getPeerId(),
        data: {
          playerId: newPlayerId,
          selectedDeck: preferredDeck,  // Use guest's preferred deck
        },
        timestamp: Date.now()
      })

      // Send host's deck data to the new guest
      // This ensures the guest can see the host's deck count and cards
      const localPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
      if (localPlayer && localPlayer.deck.length > 0) {
        const compactHostDeck = localPlayer.deck.map(card => ({
          id: card.id,
          baseId: card.baseId,
          power: card.power,
          powerModifier: card.powerModifier || 0,
          isFaceDown: card.isFaceDown || false,
          statuses: card.statuses || []
        }))

        webrtcManagerRef.current!.sendToGuest(guestPeerId, {
          type: 'CHANGE_PLAYER_DECK',
          senderId: webrtcManagerRef.current!.getPeerId(),
          playerId: localPlayer.id,
          data: {
            playerId: localPlayer.id,
            deckType: localPlayer.selectedDeck,
            deck: compactHostDeck,
            deckSize: compactHostDeck.length
          },
          timestamp: Date.now()
        })
        logger.info(`[handleWebrtcGuestJoin] Sent host deck data to new guest: ${localPlayer.selectedDeck}, ${compactHostDeck.length} cards`)
      }

      logger.info(`[handleWebrtcGuestJoin] Added player ${newPlayerId} for guest ${guestPeerId}`)

      return newState
    })
  }, [])

  /**
   * Broadcast game state via WebRTC (host only)
   * Sends optimized state using new codec system
   */
  const broadcastWebrtcState = useCallback((newState: GameState) => {
    const isHost = webrtcIsHostRef.current
    logger.info(`[broadcastWebrtcState] Called: webrtcManagerRef.current=${!!webrtcManagerRef.current}, webrtcIsHostRef.current=${isHost}`)
    if (!webrtcManagerRef.current || !isHost) {
      logger.warn('[broadcastWebrtcState] Skipping broadcast: manager or isHost missing')
      return
    }

    // Use the working JSON broadcast for now
    // TODO: Switch to new codec system after fixing card registry loading issue
    webrtcManagerRef.current.broadcastGameState(newState)
    logger.info('[broadcastWebrtcState] Broadcasted state via JSON')
  }, [])

  /**
   * Handle incoming WebRTC message
   */
  const handleWebrtcMessage = useCallback((message: any) => {
    if (!message || !message.type) {return}

    // Log ALL incoming WebRTC messages for debugging
    logger.info(`[handleWebrtcMessage] Received: ${message.type}`)

    switch (message.type) {
      case 'JOIN_ACCEPT_MINIMAL':
        // Host accepted with minimal game info (to avoid size limit)
        logger.info(`[handleWebrtcMessage] Received JOIN_ACCEPT_MINIMAL, playerId: ${message.playerId}`)
        if (message.data) {
          const info = message.data
          logger.info(`[handleWebrtcMessage] Creating minimal state with ${info.players?.length || 0} players`)

          // Create minimal game state from received info
          const minimalState: GameState = {
            gameId: info.gameId || generateGameId(),
            isGameStarted: info.isGameStarted || false,
            isPrivate: false,
            activeGridSize: (info.activeGridSize || 4) as GridSize,
            gameMode: info.gameMode || GameModeEnum.FreeForAll,
            dummyPlayerCount: 0,
            players: info.players?.map((p: any) => {
              // For dummy players, use full card data from host
              // For real players, create placeholder arrays with correct sizes
              const isDummy = p.isDummy || false

              if (isDummy && p.hand && p.deck && p.discard) {
                // Dummy player - use full cards from host
                return {
                  id: p.id,
                  name: p.name,
                  color: p.color,
                  isDummy: true,
                  isReady: p.isReady || false,
                  score: p.score || 0,
                  hand: p.hand || [],
                  deck: p.deck || [],
                  discard: p.discard || [],
                  announcedCard: null,
                  selectedDeck: p.selectedDeck || 'Random',
                  boardHistory: [],
                  autoDrawEnabled: true,
                }
              }

              // Real player - create placeholders
              const handArray: any[] = []
              const deckArray: any[] = []
              const discardArray: any[] = []

              // Create placeholder cards in hand
              for (let i = 0; i < (p.handSize || 0); i++) {
                handArray.push({
                  id: `placeholder_${p.id}_hand_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: p.id,  // IMPORTANT: Set ownerId for correct card back color
                  deck: p.selectedDeck || 'Random',
                  color: p.color
                })
              }
              // Create placeholder cards in deck
              for (let i = 0; i < (p.deckSize || 0); i++) {
                deckArray.push({
                  id: `placeholder_${p.id}_deck_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: p.id,  // IMPORTANT: Set ownerId for correct card back color
                  deck: p.selectedDeck || 'Random',
                  color: p.color
                })
              }
              // Create placeholder cards in discard
              for (let i = 0; i < (p.discardSize || 0); i++) {
                discardArray.push({
                  id: `placeholder_${p.id}_discard_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: p.id,  // IMPORTANT: Set ownerId for correct card back color
                  deck: p.selectedDeck || 'Random',
                  color: p.color
                })
              }

              return {
                id: p.id,
                name: p.name,
                color: p.color,
                isDummy: false,
                isReady: p.isReady || false,
                score: p.score || 0,
                hand: handArray,
                deck: deckArray,
                discard: discardArray,
                announcedCard: null,
                selectedDeck: p.selectedDeck || 'Random',
                boardHistory: [],
                autoDrawEnabled: true,
              }
            }) || [],
            // Use board from host if available, otherwise create empty board
            // Board state is critical for guests to see cards on the battlefield
            board: info.board || createInitialBoard(),
            hostId: 1,
            currentPhase: info.currentPhase ?? 0,
            isScoringStep: false,
            preserveDeployAbilities: false,
            autoAbilitiesEnabled: true,
            autoDrawEnabled: true,
            currentRound: info.currentRound || 1,
            turnNumber: info.turnNumber || 1,
            activePlayerId: info.activePlayerId ?? null,
            startingPlayerId: info.startingPlayerId ?? null,
            roundEndTriggered: false,
            roundWinners: {},
            gameWinner: null,
            isRoundEndModalOpen: false,
            floatingTexts: [],
            highlights: [],
            deckSelections: [],
            handCardSelections: [],
            targetingMode: null,
            spectators: [],
            revealRequests: [],
            isReadyCheckActive: false,
            localPlayerId: null,
            isSpectator: false,
          }

          setGameState(minimalState)
          if (message.playerId !== undefined) {
            setLocalPlayerId(message.playerId)
            logger.info(`[handleWebrtcMessage] Set local player ID to ${message.playerId}`)
          }

          // After joining, replace local player's placeholders with actual deck
          // Other players keep their placeholder decks (will be updated via delta)
          setGameState(prev => {
            const updatedPlayers = prev.players.map(player => {
              const playerInfo = info.players?.find((p: any) => p.id === player.id)

              if (player.id === message.playerId) {
                // Local player - create their actual deck
                // Create deck if: deck is empty, deck has placeholders, or deck size is incorrect
                const hasPlaceholders = player.deck.length === 0 || player.deck.some(c => c.isPlaceholder)
                const needsDeck = hasPlaceholders || player.deck.length !== 30  // Standard deck size

                if (playerInfo?.selectedDeck && needsDeck) {
                  const deckData = createDeck(playerInfo.selectedDeck, player.id, player.name)
                  logger.info(`[JOIN_ACCEPT_MINIMAL] Created local deck with ${deckData.length} cards from ${playerInfo.selectedDeck}`)

                  // Send deck data to host immediately after creating it
                  if (webrtcManagerRef.current && deckData.length > 0) {
                    // Use setTimeout to avoid sending during state update
                    setTimeout(() => {
                      const compactDeckData = deckData.map((card: any) => ({
                        id: card.id,
                        baseId: card.baseId,
                        power: card.power,
                        powerModifier: card.powerModifier || 0,
                        isFaceDown: card.isFaceDown || false,
                        statuses: card.statuses || []
                      }))

                      webrtcManagerRef.current!.sendAction('DECK_DATA_UPDATE', {
                        playerId: message.playerId,
                        deck: compactDeckData,
                        deckSize: compactDeckData.length
                      })
                      logger.info(`[JOIN_ACCEPT_MINIMAL] Sent deck data to host: ${playerInfo.selectedDeck}, ${compactDeckData.length} cards`)
                    }, 0)
                  }

                  // If game is already started, draw initial hand (6 cards)
                  const updatedHand = [...player.hand]
                  const updatedDeck = [...deckData]

                  if (info.isGameStarted && updatedHand.length === 0 && updatedDeck.length > 0) {
                    const cardsToDraw = 6
                    logger.info(`[JOIN_ACCEPT_MINIMAL] Game is in progress, drawing initial ${cardsToDraw} cards`)

                    for (let i = 0; i < cardsToDraw && i < updatedDeck.length; i++) {
                      const drawnCard = updatedDeck[0]
                      updatedDeck.splice(0, 1)
                      updatedHand.push(drawnCard)
                    }

                    logger.info(`[JOIN_ACCEPT_MINIMAL] Drew ${updatedHand.length} cards, deck now has ${updatedDeck.length} cards`)
                  }

                  return {
                    ...player,
                    deck: updatedDeck,
                    hand: updatedHand,
                    selectedDeck: playerInfo.selectedDeck
                  }
                }
              }
              return player
            })
            return { ...prev, players: updatedPlayers }
          })

          // Save guest connection data for page reload recovery
          try {
            const hostPeerId = webrtcManagerRef.current?.getHostPeerId()
            if (hostPeerId) {
              saveGuestData({
                hostPeerId,
                playerId: message.playerId,
                playerName: minimalState.players.find(p => p.id === message.playerId)?.name || null,
                isHost: false
              })
            }
          } catch (e) {
            logger.warn('[JOIN_ACCEPT_MINIMAL] Failed to save guest data:', e)
          }

          logger.info('Received minimal game state from host via WebRTC')
        }
        break

      case 'JOIN_ACCEPT':
        // Host accepted our join request with current game state
        logger.info(`[handleWebrtcMessage] Received JOIN_ACCEPT, playerId: ${message.playerId}, hasState: ${!!message.data?.gameState}`)
        if (message.data?.gameState) {
          const remoteState = message.data.gameState
          logger.info(`[handleWebrtcMessage] Setting game state with ${remoteState.players?.length || 0} players`)
          setGameState(remoteState)
          if (message.playerId !== undefined) {
            setLocalPlayerId(message.playerId)
            logger.info(`[handleWebrtcMessage] Set local player ID to ${message.playerId}`)

            // Save guest connection data for page reload recovery
            try {
              const hostPeerId = webrtcManagerRef.current?.getHostPeerId()
              const localPlayer = remoteState.players.find((p: any) => p.id === message.playerId)
              if (hostPeerId) {
                saveGuestData({
                  hostPeerId,
                  playerId: message.playerId,
                  playerName: localPlayer?.name || null,
                  isHost: false
                })
              }
            } catch (e) {
              logger.warn('[JOIN_ACCEPT] Failed to save guest data:', e)
            }
          }
          logger.info('Received game state from host via WebRTC')
        }
        break

      case 'JOIN_ACCEPT_BINARY':
        // Host accepted our join request with optimized binary game state
        logger.info(`[handleWebrtcMessage] Received JOIN_ACCEPT_BINARY, playerId: ${message.playerId}`)
        if (message.data instanceof Uint8Array) {
          try {
            const minimal = deserializeFromBinary(message.data) as any
            const remoteState = expandMinimalGameState(minimal)
            logger.info(`[handleWebrtcMessage] Expanded binary state with ${remoteState.players?.length || 0} players`)
            setGameState(remoteState)
            if (message.playerId !== undefined) {
              setLocalPlayerId(message.playerId)
              logger.info(`[handleWebrtcMessage] Set local player ID to ${message.playerId}`)

              // Save guest connection data for page reload recovery
              try {
                const hostPeerId = webrtcManagerRef.current?.getHostPeerId()
                const localPlayer = remoteState.players.find((p: any) => p.id === message.playerId)
                if (hostPeerId) {
                  saveGuestData({
                    hostPeerId,
                    playerId: message.playerId,
                    playerName: localPlayer?.name || null,
                    isHost: false
                  })
                }
              } catch (e) {
                logger.warn('[JOIN_ACCEPT_BINARY] Failed to save guest data:', e)
              }
            }
            logger.info(`[handleWebrtcMessage] Received optimized binary game state: ${message.data.byteLength} bytes`)
          } catch (e) {
            logger.error('[handleWebrtcMessage] Failed to deserialize binary game state:', e)
          }
        }
        break

      case 'STATE_UPDATE_COMPACT':
        // Handle STATE_UPDATE_COMPACT - both host and guest
        if (webrtcIsHostRef.current) {
          // Host handling
          if (message.senderId && message.senderId !== webrtcManagerRef.current?.getPeerId()) {
            // Host received compact state from guest - reconstruct from baseId
            logger.info(`[STATE_UPDATE_COMPACT] Host received compact state from guest ${message.senderId}`)
            if (message.data?.gameState) {
              const guestState = message.data.gameState
              setGameState(currentState => {
                const guestPlayerId = message.playerId
                if (guestPlayerId === undefined) {
                  logger.warn('[STATE_UPDATE_COMPACT] Guest state missing playerId')
                  return currentState
                }

                // Merge guest's compact state
                const mergedPlayers = currentState.players.map(p => {
                  if (p.id === guestPlayerId) {
                    const guestPlayer = guestState.players.find((gp: any) => gp.id === guestPlayerId)
                    if (guestPlayer) {
                      // Reconstruct cards from baseId using contentDatabase
                      const reconstructCard = (compactCard: any) => {
                        const cardDef = getCardDefinition(compactCard.baseId)
                        if (cardDef) {
                          return {
                            ...cardDef,
                            id: compactCard.id,
                            baseId: compactCard.baseId, // Preserve baseId
                            ownerId: guestPlayerId,
                            power: compactCard.power,
                            powerModifier: compactCard.powerModifier,
                            isFaceDown: compactCard.isFaceDown,
                            statuses: compactCard.statuses || []
                          }
                        }
                        return { id: compactCard.id, baseId: compactCard.baseId, name: 'Unknown', power: 0 }
                      }

                      const reconstructedHand = (guestPlayer.handCards || []).map(reconstructCard)
                      const reconstructedDeck = (guestPlayer.deckCards || []).map(reconstructCard)
                      const reconstructedDiscard = (guestPlayer.discardCards || []).map(reconstructCard)

                      logger.info(`[STATE_UPDATE_COMPACT] Reconstructed guest ${guestPlayerId}: hand=${reconstructedHand.length}, deck=${reconstructedDeck.length}, discard=${reconstructedDiscard.length}`)

                      return {
                        ...p,
                        hand: reconstructedHand,
                        deck: reconstructedDeck,
                        discard: reconstructedDiscard,
                        handSize: reconstructedHand.length,
                        deckSize: reconstructedDeck.length,
                        discardSize: reconstructedDiscard.length
                      }
                    }
                  }
                  return p
                })

                // Also update board from guest's state (they may have placed cards)
                const mergedBoard = guestState.board ? guestState.board : currentState.board

                const newState = {
                  ...currentState,
                  players: mergedPlayers,
                  board: mergedBoard
                }

                // Broadcast the updated state to all guests (excluding the sender)
                if (webrtcManagerRef.current) {
                  setTimeout(() => {
                    webrtcManagerRef.current!.broadcastGameState(newState, message.senderId)
                    logger.info(`[STATE_UPDATE_COMPACT] Host broadcast merged state to all guests`)
                  }, 0)
                }

                return newState
              })
            }
          } else {
            // Host received message from self (via broadcast) - ignore to prevent overwriting own deck with empty arrays
            logger.info('[STATE_UPDATE_COMPACT] Host ignoring self-sent message (would overwrite own deck)')
          }
        } else if (!webrtcIsHostRef.current && message.data?.gameState) {
          // Guest receives compact state - reconstruct full cards
          const recipientPlayerId = message.data.recipientPlayerId ?? null
          logger.info(`[STATE_UPDATE_COMPACT] Received compact state for player ${recipientPlayerId}`)
          const remoteState = message.data.gameState

          // Skip if we recently restored from localStorage (has more complete data)
          if (recentlyRestoredFromStorageRef.current) {
            logger.info('[STATE_UPDATE_COMPACT] Skipping - recently restored from localStorage')
            setGameState(currentState => ({
              ...currentState,
              currentPhase: remoteState.currentPhase,
              activePlayerId: remoteState.activePlayerId,
              startingPlayerId: remoteState.startingPlayerId,
              isReadyCheckActive: remoteState.isReadyCheckActive,
              isGameStarted: remoteState.isGameStarted,
            }))
            return
          }

          setGameState(currentState => {
            // IMPORTANT: recipientPlayerId tells us which player this state is primarily for
            // If it's for another player, we must preserve our local deck data
            const isStateForLocalPlayer = recipientPlayerId === null || recipientPlayerId === localPlayerIdRef.current
            logger.info(`[STATE_UPDATE_COMPACT] Processing state for recipient=${recipientPlayerId}, local=${localPlayerIdRef.current}, isForLocal=${isStateForLocalPlayer}`)

            const mergedPlayers = remoteState.players.map((remotePlayer: any) => {
              const localPlayer = currentState.players.find(p => p.id === remotePlayer.id)

              if (remotePlayer.id === localPlayerIdRef.current && localPlayer) {
                // This is the local player - reconstruct from compact card data or IDs
                const reconstructCard = (compactCard: any) => {
                  // If we have the full compact card data with baseId
                  if (compactCard.baseId) {
                    const cardDef = getCardDefinition(compactCard.baseId)
                    if (cardDef) {
                      return {
                        ...cardDef,
                        id: compactCard.id,
                        ownerId: localPlayerIdRef.current,
                        power: compactCard.power,
                        powerModifier: compactCard.powerModifier,
                        isFaceDown: compactCard.isFaceDown,
                        statuses: compactCard.statuses || []
                      }
                    }
                  }
                  // Fallback: use local card if exists, or create minimal
                  const localCard = localPlayer.hand.find(c => c.id === compactCard.id)
                    || localPlayer.deck.find(c => c.id === compactCard.id)
                    || localPlayer.discard.find(c => c.id === compactCard.id)
                  return localCard || { id: compactCard.id, name: 'Unknown', power: 0 }
                }

                // Check if we have compact card data (handCards, deckCards, or discardCards)
                // IMPORTANT: Check all three arrays, not just handCards - deck might be non-empty when hand is empty
                const hasCompactCardData =
                  (remotePlayer.handCards && remotePlayer.handCards.length > 0) ||
                  (remotePlayer.deckCards && remotePlayer.deckCards.length > 0) ||
                  (remotePlayer.discardCards && remotePlayer.discardCards.length > 0)

                if (hasCompactCardData) {
                  // Host sent compact card data with baseId
                  const reconstructedHand = (remotePlayer.handCards || []).map(reconstructCard)
                  const reconstructedDeck = (remotePlayer.deckCards || []).map(reconstructCard)
                  const reconstructedDiscard = (remotePlayer.discardCards || []).map(reconstructCard)

                  // IMPORTANT: Preserve baseId from compact data (it's not in cardDef)
                  reconstructedHand.forEach((card: any, i: number) => {
                    if (remotePlayer.handCards?.[i]?.baseId && !card.baseId) {
                      card.baseId = remotePlayer.handCards[i].baseId
                    }
                  })
                  reconstructedDeck.forEach((card: any, i: number) => {
                    if (remotePlayer.deckCards?.[i]?.baseId && !card.baseId) {
                      card.baseId = remotePlayer.deckCards[i].baseId
                    }
                  })
                  reconstructedDiscard.forEach((card: any, i: number) => {
                    if (remotePlayer.discardCards?.[i]?.baseId && !card.baseId) {
                      card.baseId = remotePlayer.discardCards[i].baseId
                    }
                  })

                  logger.debug(`[STATE_UPDATE_COMPACT] Reconstructed ${reconstructedHand.length} hand, ${reconstructedDeck.length} deck, ${reconstructedDiscard.length} discard`)

                  return {
                    ...remotePlayer,
                    hand: reconstructedHand,
                    deck: reconstructedDeck,
                    discard: reconstructedDiscard,
                  }
                } else {
                  // Host sent only IDs (old format) - reconstruct from local state
                  const reconstructedHand = (remotePlayer.handIds || []).map((id: string) => {
                    const card = localPlayer.hand.find(c => c.id === id)
                      || localPlayer.deck.find(c => c.id === id)
                      || localPlayer.discard.find(c => c.id === id)
                    return card || { id, name: '?', isPlaceholder: false }
                  })
                  const reconstructedDeck = (remotePlayer.deckIds || []).map((id: string) => {
                    const card = localPlayer.deck.find(c => c.id === id)
                      || localPlayer.hand.find(c => c.id === id)
                      || localPlayer.discard.find(c => c.id === id)
                    return card || { id, name: '?', isPlaceholder: false }
                  })
                  const reconstructedDiscard = (remotePlayer.discardIds || []).map((id: string) => {
                    const card = localPlayer.discard.find(c => c.id === id)
                      || localPlayer.hand.find(c => c.id === id)
                      || localPlayer.deck.find(c => c.id === id)
                    return card || { id, name: '?', isPlaceholder: false }
                  })

                  logger.debug(`[STATE_UPDATE_COMPACT] Reconstructed from IDs: ${reconstructedHand.length} hand, ${reconstructedDeck.length} deck, ${reconstructedDiscard.length} discard`)

                  return {
                    ...remotePlayer,
                    hand: reconstructedHand,
                    deck: reconstructedDeck,
                    discard: reconstructedDiscard,
                  }
                }
              } else {
                // Other players - handle deck data based on recipientPlayerId
                const remoteDeckSize = remotePlayer.deckSize ?? remotePlayer.deck?.length ?? 0
                const remoteHandSize = remotePlayer.handSize ?? remotePlayer.hand?.length ?? 0

                // Check if host is sending actual deck data (not just size)
                const hostSendingDeckData = remotePlayer.deckCards && remotePlayer.deckCards.length > 0

                let finalDeck: any[]
                if (hostSendingDeckData) {
                  // Host sent deck data - reconstruct from compact cards
                  // This happens when recipientPlayerId matches this player (host sends full deck data)
                  const reconstructCard = (compactCard: any) => {
                    if (compactCard.baseId) {
                      const cardDef = getCardDefinition(compactCard.baseId)
                      if (cardDef) {
                        return {
                          ...cardDef,
                          id: compactCard.id,
                          baseId: compactCard.baseId,
                          ownerId: remotePlayer.id,
                          power: compactCard.power,
                          powerModifier: compactCard.powerModifier,
                          isFaceDown: compactCard.isFaceDown,
                          statuses: compactCard.statuses || []
                        }
                      }
                    }
                    return { id: compactCard.id, name: 'Unknown', power: 0 }
                  }
                  finalDeck = remotePlayer.deckCards.map(reconstructCard)
                  logger.debug(`[STATE_UPDATE_COMPACT] Reconstructed deck for player ${remotePlayer.id}: ${finalDeck.length} cards`)
                } else {
                  // Host is NOT sending deck data for this player
                  // Check if we have existing non-placeholder deck data from CHANGE_PLAYER_DECK
                  const hasRealDeckData = localPlayer && localPlayer.deck.length > 0 &&
                    localPlayer.deck.some((c: any) => !c.isPlaceholder)

                  if (hasRealDeckData) {
                    // Preserve real deck data from previous CHANGE_PLAYER_DECK message
                    // But adjust size to match remoteDeckSize (in case cards were drawn)
                    finalDeck = localPlayer.deck.slice(0, remoteDeckSize)
                    logger.debug(`[STATE_UPDATE_COMPACT] Preserved deck for player ${remotePlayer.id}: ${finalDeck.length} cards`)
                  } else {
                    // Create placeholders - we don't have real data for this player's deck
                    finalDeck = []
                    for (let i = 0; i < remoteDeckSize; i++) {
                      finalDeck.push({
                        id: `placeholder_${remotePlayer.id}_deck_${i}`,
                        name: '?',
                        isPlaceholder: true,
                        ownerId: remotePlayer.id,
                        deck: remotePlayer.selectedDeck || 'Random',
                        color: remotePlayer.color
                      })
                    }
                  }
                }

                // Process hand cards - reconstruct revealed cards, create placeholders for face-down
                const processHandCard = (remoteCard: any, index: number) => {
                  // Check if this is a revealed card (has baseId) or a card back (placeholder/cardBack)
                  if (remoteCard.baseId && !remoteCard.isPlaceholder && !remoteCard.isCardBack) {
                    // Revealed card - reconstruct from compact data
                    const cardDef = getCardDefinition(remoteCard.baseId)
                    if (cardDef) {
                      return {
                        ...cardDef,
                        id: remoteCard.id,
                        baseId: remoteCard.baseId,
                        ownerId: remotePlayer.id,
                        power: remoteCard.power,
                        powerModifier: remoteCard.powerModifier || 0,
                        isFaceDown: remoteCard.isFaceDown || false,
                        statuses: remoteCard.statuses || []
                      }
                    }
                  }
                  // Face-down card or placeholder - create placeholder
                  return {
                    id: remoteCard.id || `placeholder_${remotePlayer.id}_hand_${index}`,
                    name: '?',
                    isPlaceholder: true,
                    isCardBack: true,
                    ownerId: remotePlayer.id,
                    deck: remotePlayer.selectedDeck || 'Random',
                    color: remotePlayer.color
                  }
                }

                // Use remote hand if available (has card data), otherwise create placeholders
                let finalHand: any[]
                if (remotePlayer.hand && remotePlayer.hand.length > 0) {
                  // Remote has hand data - process each card
                  finalHand = remotePlayer.hand.map((card: any, i: number) => processHandCard(card, i))
                  const revealedCount = finalHand.filter((c: any) => !c.isPlaceholder).length
                  if (revealedCount > 0) {
                    logger.info(`[STATE_UPDATE_COMPACT] Reconstructed ${revealedCount}/${finalHand.length} revealed hand cards for player ${remotePlayer.id}`)
                  }
                } else {
                  // No hand data - create placeholders based on size
                  finalHand = []
                  for (let i = 0; i < remoteHandSize; i++) {
                    finalHand.push({
                      id: `placeholder_${remotePlayer.id}_hand_${i}`,
                      name: '?',
                      isPlaceholder: true,
                      ownerId: remotePlayer.id,
                      deck: remotePlayer.selectedDeck || 'Random',
                      color: remotePlayer.color
                    })
                  }
                }

                return {
                  ...remotePlayer,
                  hand: finalHand,
                  deck: finalDeck,
                  discard: localPlayer?.discard || [], // Preserve discard (may have real data from abilities)
                }
              }
            })

            // Reconstruct board cards from baseId (host sends optimized board data)
            const reconstructedBoard = remoteState.board ? remoteState.board.map((row: any[]) =>
              row.map((cell: any) => {
                if (!cell || !cell.card) { return cell }

                // Reconstruct card from baseId
                const cardDef = getCardDefinition(cell.card.baseId || cell.card.id)
                if (cardDef) {
                  return {
                    ...cell,
                    card: {
                      ...cardDef,
                      id: cell.card.id,
                      baseId: cell.card.baseId || cell.card.id,
                      ownerId: cell.card.ownerId,
                      ownerName: cell.card.ownerName,
                      power: cell.card.power,
                      powerModifier: cell.card.powerModifier,
                      isFaceDown: cell.card.isFaceDown || false,
                      statuses: cell.card.statuses || [],
                      enteredThisTurn: cell.card.enteredThisTurn,
                      deck: cell.card.deck
                    }
                  }
                }
                // Fallback: return card as-is if no definition found
                return cell
              })
            ) : currentState.board

            // Recalculate board statuses (Support, Threat, hero passives like Mr. Pearl bonus)
            // This ensures passive abilities from all players' cards are properly applied
            const recalculatedBoard = recalculateBoardStatuses({
              ...remoteState,
              players: mergedPlayers,
              board: reconstructedBoard
            })

            return {
              ...remoteState,
              players: mergedPlayers,
              board: recalculatedBoard
            }
          })
        }
        break

      case 'STATE_UPDATE':
        if (webrtcIsHostRef.current && message.senderId && message.senderId !== webrtcManagerRef.current?.getPeerId()) {
          // Host received STATE_UPDATE from a guest - merge their state and broadcast to all
          logger.info(`[STATE_UPDATE] Host received state from guest ${message.senderId}`)
          if (message.data?.gameState) {
            const guestState = message.data.gameState
            setGameState(currentState => {
              // Find the guest's player ID
              const guestPlayerId = message.playerId
              if (guestPlayerId === undefined) {
                logger.warn('[STATE_UPDATE] Guest state missing playerId')
                return currentState
              }

              // Merge guest's state into current state
              const mergedPlayers = currentState.players.map(p => {
                if (p.id === guestPlayerId) {
                  // This is the guest - update their data from their state
                  const guestPlayer = guestState.players.find((gp: any) => gp.id === guestPlayerId)
                  if (guestPlayer) {
                    // Guest sends full hand/deck/discard - use them directly
                    const guestHand = guestPlayer.hand || []
                    const guestDeck = guestPlayer.deck || []
                    const guestDiscard = guestPlayer.discard || []

                    logger.info(`[STATE_UPDATE] Merging guest ${guestPlayerId} state: hand=${guestHand.length}, deck=${guestDeck.length}, discard=${guestDiscard.length}`)

                    const mergedPlayer = {
                      ...p,
                      // Use guest's actual card data
                      hand: guestHand,
                      deck: guestDeck,
                      discard: guestDiscard,
                      // Update sizes to match
                      handSize: guestHand.length,
                      deckSize: guestDeck.length,
                      discardSize: guestDiscard.length
                    }

                    logger.info(`[STATE_UPDATE] After merge - player ${guestPlayerId}: deckSize=${mergedPlayer.deckSize}, handSize=${mergedPlayer.handSize}`)

                    return mergedPlayer
                  }
                }
                return p
              })

              // Also update board from guest's state (they may have placed cards)
              const mergedBoard = guestState.board ? guestState.board : currentState.board

              const newState = {
                ...currentState,
                players: mergedPlayers,
                board: mergedBoard
              }

              // Broadcast the updated state to all guests (excluding the sender)
              if (webrtcManagerRef.current) {
                setTimeout(() => {
                  webrtcManagerRef.current!.broadcastGameState(newState, message.senderId)
                  logger.info(`[STATE_UPDATE] Host broadcast merged state to all guests after guest update`)
                }, 0)
              }

              return newState
            })
          }
          break
        }

        // Host broadcasted state update (guest receiving)
        // Mark that we've received state from host (similar to server state in WebSocket mode)
        receivedServerStateRef.current = true
        if (message.data?.gameState) {
          const remoteState = message.data.gameState

          // If we just restored from localStorage, prefer our restored state over host's state
          // (because host might have stale data or our local data is more complete)
          if (recentlyRestoredFromStorageRef.current) {
            logger.info('[STATE_UPDATE] Skipping merge - recently restored from localStorage with more complete data')
            // Still update some critical fields from host (like phase, activePlayer, etc.)
            setGameState(currentState => ({
              ...currentState,
              // Only sync these critical fields from host
              currentPhase: remoteState.currentPhase,
              activePlayerId: remoteState.activePlayerId,
              startingPlayerId: remoteState.startingPlayerId,
              isReadyCheckActive: remoteState.isReadyCheckActive,
              isGameStarted: remoteState.isGameStarted,
              // Preserve all local data (players, board, etc.)
            }))
            return
          }

          // Use functional update to get the absolute latest state
          setGameState(currentState => {
            // Merge remote state with local state, preserving local player's full hand
            const mergedPlayers = remoteState.players.map((remotePlayer: any) => {
              const localPlayer = currentState.players.find(p => p.id === remotePlayer.id)

              if (remotePlayer.id === localPlayerIdRef.current && localPlayer) {
                // This is the local player
                // If local player just joined (hand is empty or has only placeholders), use remote hand
                // Otherwise preserve local hand (privacy - host might not have our actual cards)
                const hasOnlyPlaceholders = localPlayer.hand.every(c => c.isPlaceholder) || localPlayer.hand.length === 0

                // Get expected sizes from remote state (host's authoritative sizes)
                const remoteHandSize = remotePlayer.handSize ?? remotePlayer.hand?.length ?? 0

                if (hasOnlyPlaceholders && remotePlayer.hand && remotePlayer.hand.length > 0) {
                  // Guest just joined - use the remote hand/deck from host
                  logger.info(`[STATE_UPDATE] Guest just joined, using remote hand/deck from host`)
                  return {
                    ...remotePlayer,
                    hand: remotePlayer.hand,
                    deck: remotePlayer.deck || localPlayer.deck,
                    discard: remotePlayer.discard || localPlayer.discard,
                  }
                } else {
                  // Preserve local hand/deck (already have actual cards)
                  // BUT sync hand/deck sizes if they differ (e.g., Preparation phase drew a card)
                  let syncedHand = localPlayer.hand
                  let syncedDeck = localPlayer.deck

                  // If remote expects more cards in hand than we have, draw from deck
                  if (remoteHandSize > localPlayer.hand.length && syncedDeck.length > 0) {
                    const cardsToDraw = remoteHandSize - localPlayer.hand.length
                    const newHand = [...localPlayer.hand]
                    const newDeck = [...localPlayer.deck]

                    for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
                      const drawnCard = newDeck[0]
                      newDeck.splice(0, 1)
                      newHand.push(drawnCard)
                    }

                    syncedHand = newHand
                    syncedDeck = newDeck
                    logger.info(`[STATE_UPDATE] Drew ${cardsToDraw} cards to sync hand size to ${remoteHandSize}`)
                  }

                  return {
                    ...remotePlayer,
                    hand: syncedHand,
                    deck: syncedDeck,
                    discard: remotePlayer.discard || localPlayer.discard,
                  }
                }
              } else {
                // Other players - use remote state
                // For dummy players: always use real cards (everyone sees dummy cards)
                // For real players: use placeholder cards unless hideDummyCards is off
                const isDummy = remotePlayer.isDummy || false

                if (isDummy) {
                  // Dummy players - use real cards from host
                  logger.info(`[STATE_UPDATE] Using real cards for dummy player ${remotePlayer.id}`)
                  return {
                    ...remotePlayer,
                    hand: remotePlayer.hand || [],
                    deck: remotePlayer.deck || [],
                    discard: remotePlayer.discard || [],
                  }
                }

                // Real players - use placeholder decks/hands with correct size for UI
                const remoteDeckSize = remotePlayer.deckSize ?? remotePlayer.deck?.length ?? 0
                const remoteHandSize = remotePlayer.handSize ?? remotePlayer.hand?.length ?? 0

                logger.info(`[STATE_UPDATE] Player ${remotePlayer.id}: deckSize=${remoteDeckSize}, handSize=${remoteHandSize}`)

                const placeholderDeck: any[] = []
                for (let i = 0; i < remoteDeckSize; i++) {
                  placeholderDeck.push({
                    id: `placeholder_${remotePlayer.id}_deck_${i}`,
                    name: '?',
                    isPlaceholder: true,
                    ownerId: remotePlayer.id,  // IMPORTANT: Set ownerId for correct card back color
                    deck: remotePlayer.selectedDeck || 'Random',
                    color: remotePlayer.color
                  })
                }

                const placeholderHand: any[] = []
                for (let i = 0; i < remoteHandSize; i++) {
                  placeholderHand.push({
                    id: `placeholder_${remotePlayer.id}_hand_${i}`,
                    name: '?',
                    isPlaceholder: true,
                    ownerId: remotePlayer.id,  // IMPORTANT: Set ownerId for correct card back color
                    deck: remotePlayer.selectedDeck || 'Random',
                    color: remotePlayer.color
                  })
                }

                logger.info(`[STATE_UPDATE] Created ${placeholderDeck.length} deck placeholders and ${placeholderHand.length} hand placeholders for player ${remotePlayer.id}`)

                return {
                  ...remotePlayer,
                  hand: placeholderHand,
                  deck: placeholderDeck,
                  discard: remotePlayer.discard || [],
                }
              }
            })

            const resultState = {
              ...remoteState,
              players: mergedPlayers,
            }

            // Persist state for guest after receiving full state update from host
            if (!webrtcIsHostRef.current) {
              try {
                const hostPeerId = webrtcManagerRef.current?.getHostPeerId()
                if (hostPeerId && localPlayerIdRef.current !== null) {
                  saveWebrtcState({
                    gameState: resultState,
                    localPlayerId: localPlayerIdRef.current,
                    isHost: false
                  })
                  logger.debug('[STATE_UPDATE] Saved merged state for guest auto-restore')
                }
              } catch (e) {
                logger.warn('[STATE_UPDATE] Failed to persist guest state:', e)
              }
            }

            return resultState
          })
          logger.debug('Received state update from host via WebRTC')
        }
        break

      case 'RECONNECT_SNAPSHOT':
        // Host sent compact reconnect snapshot (for guests reconnecting after page reload)
        // This is much smaller than full STATE_UPDATE and avoids "Message too big for JSON channel" error
        logger.info('[RECONNECT_SNAPSHOT] Received compact reconnect snapshot from host')
        receivedServerStateRef.current = true
        if (message.data) {
          const snapshot = message.data as any
          setGameState(prev => {
            // Build players from snapshot data
            const localPlayerId = localPlayerIdRef.current

            const rebuiltPlayers = snapshot.players.map((sp: any) => {
              // Find existing local player state to preserve their actual cards
              const existingLocal = prev.players.find(p => p.id === sp.id)

              if (sp.id === localPlayerId && existingLocal) {
                // This is the local player - preserve their hand/deck if they have real cards
                const hasRealCards = existingLocal.hand.some((c: any) => !c.isPlaceholder)

                if (hasRealCards) {
                  // Keep local player's actual cards, sync sizes if needed
                  let syncedHand = [...existingLocal.hand]
                  const syncedDeck = [...existingLocal.deck]

                  // Adjust hand size
                  if (sp.handSize > syncedHand.length) {
                    const needed = sp.handSize - syncedHand.length
                    for (let i = 0; i < needed && syncedDeck.length > 0; i++) {
                      syncedHand.push(syncedDeck.shift()!)
                    }
                  } else if (sp.handSize < syncedHand.length) {
                    syncedHand = syncedHand.slice(0, sp.handSize)
                  }

                  return {
                    ...sp,
                    hand: syncedHand,
                    deck: syncedDeck,
                    discard: existingLocal.discard
                  }
                }
              }

              // For other players or if local has no real cards, create placeholders
              const placeholderHand: any[] = []
              for (let i = 0; i < sp.handSize; i++) {
                placeholderHand.push({
                  id: `placeholder_${sp.id}_hand_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: sp.id,
                  deck: sp.selectedDeck || 'Random',
                  color: sp.color
                })
              }

              const placeholderDeck: any[] = []
              for (let i = 0; i < sp.deckSize; i++) {
                placeholderDeck.push({
                  id: `placeholder_${sp.id}_deck_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: sp.id,
                  deck: sp.selectedDeck || 'Random',
                  color: sp.color
                })
              }

              const placeholderDiscard: any[] = []
              for (let i = 0; i < sp.discardSize; i++) {
                placeholderDiscard.push({
                  id: `placeholder_${sp.id}_discard_${i}`,
                  name: '?',
                  isPlaceholder: true,
                  ownerId: sp.id,
                  deck: sp.selectedDeck || 'Random',
                  color: sp.color
                })
              }

              return {
                ...sp,
                hand: placeholderHand,
                deck: placeholderDeck,
                discard: placeholderDiscard
              }
            })

            const resultState = {
              gameId: snapshot.gameId,
              gameMode: snapshot.gameMode,
              isPrivate: snapshot.isPrivate,
              isGameStarted: snapshot.isGameStarted,
              isReadyCheckActive: snapshot.isReadyCheckActive,
              activeGridSize: snapshot.activeGridSize,
              currentPhase: snapshot.currentPhase,
              isScoringStep: snapshot.isScoringStep,
              activePlayerId: snapshot.activePlayerId,
              startingPlayerId: snapshot.startingPlayerId,
              currentRound: snapshot.currentRound,
              turnNumber: snapshot.turnNumber,
              roundWinners: snapshot.roundWinners || {},
              gameWinner: snapshot.gameWinner,
              isRoundEndModalOpen: snapshot.isRoundEndModalOpen,
              dummyPlayerCount: snapshot.dummyPlayerCount,
              players: rebuiltPlayers,
              board: snapshot.board,
              spectators: prev.spectators,
              hostId: prev.hostId,
              revealRequests: prev.revealRequests,
              preserveDeployAbilities: prev.preserveDeployAbilities,
              highlights: prev.highlights,
              floatingTexts: prev.floatingTexts,
              targetingMode: prev.targetingMode,
              abilityMode: prev.abilityMode
            } as GameState

            // Persist state for guest auto-restore
            if (!webrtcIsHostRef.current && localPlayerId !== null) {
              try {
                saveWebrtcState({
                  gameState: resultState as any,
                  localPlayerId,
                  isHost: false
                })
                logger.debug('[RECONNECT_SNAPSHOT] Saved state for guest auto-restore')
              } catch (e) {
                logger.warn('[RECONNECT_SNAPSHOT] Failed to save state:', e)
              }
            }

            logger.info(`[RECONNECT_SNAPSHOT] Restored game state: phase=${resultState.currentPhase}, players=${resultState.players.length}`)
            return resultState
          })
        }
        break

      case 'STATE_DELTA':
        // Host: received delta from guest, rebroadcast to all other guests
        // Guest: received delta broadcast from host
        // Mark that we've received state from host (enables sending our own deltas)
        if (!webrtcIsHostRef.current) {
          receivedServerStateRef.current = true
        }
        logger.info(`[STATE_DELTA] Received STATE_DELTA message, isHost: ${webrtcIsHostRef.current}, senderId: ${message.senderId}`)
        if (message.data?.delta) {
          const delta: StateDelta = message.data.delta
          logger.info(`[STATE_DELTA] Delta: playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}, phaseDelta=${!!delta.phaseDelta}`)

          // Log board cells for debugging
          if (delta.boardCells && delta.boardCells.length > 0) {
            delta.boardCells.forEach(bc => {
              logger.info(`[STATE_DELTA] Board cell [${bc.row},${bc.col}]: card=${bc.card?.name || '(empty)'}, owner=${bc.card?.ownerId}`)
            })
          }

          // If we're the host, rebroadcast this delta to all OTHER guests
          if (webrtcIsHostRef.current && message.senderId && webrtcManagerRef.current) {
            logger.info(`[STATE_DELTA] Host rebroadcasting delta from guest ${message.senderId} to other guests`)
            webrtcManagerRef.current.broadcastStateDelta(delta, message.senderId)
          }

          // Log phase delta details
          if (delta.phaseDelta) {
            logger.info(`[STATE_DELTA] phaseDelta:`, JSON.stringify(delta.phaseDelta))
          }

          // Log player delta details for debugging
          if (delta.playerDeltas) {
            Object.entries(delta.playerDeltas).forEach(([playerId, playerDelta]) => {
              logger.info(`[STATE_DELTA] Player ${playerId} delta: handSizeDelta=${playerDelta.handSizeDelta}, deckSizeDelta=${playerDelta.deckSizeDelta}`)
            })
          }

          // Apply the delta locally
          setGameState(prev => {
            // Find local player ID from current state
            const currentLocalPlayerId = localPlayerIdRef.current || prev.localPlayerId
            logger.info(`[STATE_DELTA] Applying delta with localPlayerId=${currentLocalPlayerId}, currentPhase before=${prev.currentPhase}`)
            const result = applyStateDelta(prev, delta, currentLocalPlayerId)
            logger.info(`[STATE_DELTA] Applying delta with localPlayerId=${currentLocalPlayerId}, currentPhase after=${result.currentPhase}`)

            // Persist state after receiving delta (for both host and guest)
            try {
              if (result.gameId && currentLocalPlayerId !== null) {
                saveWebrtcState({
                  gameState: result,
                  localPlayerId: currentLocalPlayerId,
                  isHost: webrtcIsHostRef.current
                })
                logger.debug(`[STATE_DELTA] Saved state for ${webrtcIsHostRef.current ? 'host' : 'guest'} auto-restore`)
              }
            } catch (e) {
              logger.warn('[STATE_DELTA] Failed to persist state:', e)
            }

            return result
          })
        }
        break

      case 'STATE_DELTA_BINARY': {
        // Optimized binary state delta (MessagePack + short keys)
        if (!webrtcIsHostRef.current) {
          receivedServerStateRef.current = true
        }
        logger.info(`[STATE_DELTA_BINARY] Received binary delta, isHost: ${webrtcIsHostRef.current}, senderId: ${message.senderId}, dataType=${message.data?.constructor?.name}, typeof=${typeof message.data}`)

        // Handle both Uint8Array (direct binary) and base64 string (bypasses PeerJS JSON serialization)
        let delta: StateDelta | null = null

        if (message.data instanceof Uint8Array) {
          // Direct binary (rare with PeerJS JSON serialization)
          try {
            delta = deserializeDelta(message.data)
            if (delta) {
              logger.info(`[STATE_DELTA_BINARY] Deserialized from Uint8Array: playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}`)
            }
          } catch (e) {
            logger.error('[STATE_DELTA_BINARY] Failed to deserialize Uint8Array:', e)
          }
        } else if (typeof message.data === 'string') {
          // Base64 encoded string (bypasses PeerJS JSON serialization)
          try {
            delta = deserializeDeltaBase64(message.data)
            if (delta) {
              logger.info(`[STATE_DELTA_BINARY] Deserialized from base64 (${message.data.length} chars): playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, boardCells=${delta.boardCells?.length || 0}, phaseDelta=${!!delta.phaseDelta}`)
            }
          } catch (e) {
            logger.error('[STATE_DELTA_BINARY] Failed to deserialize base64 string:', e)
          }
        } else {
          logger.error(`[STATE_DELTA_BINARY] Unexpected data type: ${typeof message.data}, constructor: ${message.data?.constructor?.name}`)
        }

        if (delta) {
          // If we're the host, rebroadcast this delta to all OTHER guests
          if (webrtcIsHostRef.current && message.senderId && webrtcManagerRef.current) {
            logger.info(`[STATE_DELTA_BINARY] Host rebroadcasting binary delta from guest ${message.senderId} to other guests`)
            webrtcManagerRef.current.broadcastStateDelta(delta, message.senderId)
          }

          // Apply the delta locally
          setGameState(prev => {
            const currentLocalPlayerId = localPlayerIdRef.current || prev.localPlayerId
            logger.info(`[STATE_DELTA_BINARY] Applying delta with localPlayerId=${currentLocalPlayerId}, currentPhase before=${prev.currentPhase}`)
            const result = applyStateDelta(prev, delta, currentLocalPlayerId)
            logger.info(`[STATE_DELTA_BINARY] Applied delta - phase after=${result.currentPhase}, board has ${result.board.flat().filter(c => c?.card).length} cards`)

            // Persist state after receiving delta
            try {
              if (result.gameId && currentLocalPlayerId !== null) {
                saveWebrtcState({
                  gameState: result,
                  localPlayerId: currentLocalPlayerId,
                  isHost: webrtcIsHostRef.current
                })
                logger.debug(`[STATE_DELTA_BINARY] Saved state for ${webrtcIsHostRef.current ? 'host' : 'guest'} auto-restore`)
              }
            } catch (e) {
              logger.warn('[STATE_DELTA_BINARY] Failed to persist state:', e)
            }

            return result
          })
        }
        break
      }

      case 'CARD_STATE':
        // New binary card state update
        logger.info(`[handleWebrtcMessage] Received CARD_STATE`)
        if (typeof message.data === 'string') {
          // Decode base64 to Uint8Array (PeerJS converts to string)
          try {
            const binaryString = atob(message.data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            setGameState(prev => {
              const updatedState = handleCodecMessage(
                0x02, // CodecMessageType.CARD_STATE
                bytes,
                prev,
                localPlayerIdRef.current || prev.localPlayerId
              )
              return updatedState.gameState
            })
          } catch (e) {
            logger.error('[handleWebrtcMessage] Failed to decode CARD_STATE:', e)
          }
        } else if (message.data instanceof Uint8Array) {
          setGameState(prev => {
            const updatedState = handleCodecMessage(
              0x02, // CodecMessageType.CARD_STATE
              message.data,
              prev,
              localPlayerIdRef.current || prev.localPlayerId
            )
            return updatedState.gameState
          })
        }
        break

      case 'ABILITY_EFFECT':
        // Visual effects (highlights, floating text, etc.)
        logger.info(`[handleWebrtcMessage] Received ABILITY_EFFECT`)
        if (typeof message.data === 'string') {
          // Decode base64 to Uint8Array
          try {
            const binaryString = atob(message.data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            setGameState(prev => {
              const { gameState: updatedState } = handleCodecMessage(
                0x03, // CodecMessageType.ABILITY_EFFECT
                bytes,
                prev,
                localPlayerIdRef.current || prev.localPlayerId
              )
              return updatedState
            })
          } catch (e) {
            logger.error('[handleWebrtcMessage] Failed to decode ABILITY_EFFECT:', e)
          }
        } else if (message.data instanceof Uint8Array) {
          setGameState(prev => {
            const { gameState: updatedState } = handleCodecMessage(
              0x03, // CodecMessageType.ABILITY_EFFECT
              message.data,
              prev,
              localPlayerIdRef.current || prev.localPlayerId
            )
            return updatedState
          })
        }
        break

      case 'SESSION_EVENT':
        // Session events (phase change, round end, etc.)
        logger.info(`[handleWebrtcMessage] Received SESSION_EVENT`)
        if (typeof message.data === 'string') {
          // Decode base64 to Uint8Array
          try {
            const binaryString = atob(message.data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            setGameState(prev => {
              return handleCodecMessage(
                0x04, // CodecMessageType.SESSION_EVENT
                bytes,
                prev,
                localPlayerIdRef.current || prev.localPlayerId
              ).gameState
            })
          } catch (e) {
            logger.error('[handleWebrtcMessage] Failed to decode SESSION_EVENT:', e)
          }
        } else if (message.data instanceof Uint8Array) {
          setGameState(prev => {
            return handleCodecMessage(
              0x04, // CodecMessageType.SESSION_EVENT
              message.data,
              prev,
              localPlayerIdRef.current || prev.localPlayerId
            ).gameState
          })
        }
        break

      case 'JOIN_REQUEST':
        // Guest wants to join (host only)
        logger.info(`[handleWebrtcMessage] Received JOIN_REQUEST, senderId: ${message.senderId}, isHost: ${webrtcIsHostRef.current}`)
        if (webrtcIsHostRef.current && message.senderId) {
          logger.info(`Host received JOIN_REQUEST from ${message.senderId}, data:`, message.data)
          handleWebrtcGuestJoin(message.senderId, message.data)
        } else {
          logger.warn(`[handleWebrtcMessage] Cannot process JOIN_REQUEST - isHost: ${webrtcIsHostRef.current}, senderId: ${message.senderId}`)
        }
        break

      case 'ACTION':
        // Guest sent action to host (host only)
        if (webrtcIsHostRef.current && message.data) {
          const { actionType, actionData } = message.data
          logger.info(`[ACTION] Received action type: ${actionType}`)

          // Handle different action types
          if (actionType === 'STATE_UPDATE' && actionData?.gameState) {
            // If host recently restored from storage, ignore guest state updates
            // Host is the authoritative source after F5 restore
            if (recentlyRestoredFromStorageRef.current) {
              logger.info('[ACTION] Ignoring STATE_UPDATE from guest - host recently restored from storage and is authoritative')
              // Still send current host state to the guest to ensure they sync properly
              if (webrtcManagerRef.current && message.senderId) {
                webrtcManagerRef.current.sendToGuest(message.senderId, {
                  type: 'STATE_UPDATE',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  data: { gameState: gameStateRef.current },
                  timestamp: Date.now()
                })
              }
              break
            }

            // Guest sent state update - merge with host state to preserve decks
            setGameState(prev => {
              const guestState = actionData.gameState
              // Merge players: preserve deck/discard/score from host state for players that aren't the guest
              // IMPORTANT: Host is authoritative for scores, decks, and discards - guests may have stale data after F5
              const mergedPlayers = guestState.players.map((guestPlayer: any) => {
                const hostPlayer = prev.players.find(p => p.id === guestPlayer.id)
                if (hostPlayer && guestPlayer.id !== localPlayerIdRef.current) {
                  // This is another player (not guest, not local) - preserve authoritative data from host
                  return {
                    ...guestPlayer,
                    deck: hostPlayer.deck || guestPlayer.deck,
                    discard: hostPlayer.discard || guestPlayer.discard,
                    score: hostPlayer.score,  // Host is authoritative for scores
                  }
                }
                return guestPlayer
              })

              const mergedState = {
                ...guestState,
                players: mergedPlayers,
              }

              // Broadcast to all guests (including sender for consistency)
              if (webrtcManagerRef.current) {
                webrtcManagerRef.current.broadcastToGuests({
                  type: 'STATE_UPDATE',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  data: { gameState: mergedState },
                  timestamp: Date.now()
                })
              }

              return mergedState
            })
          } else if (actionType === 'STATE_DELTA' && actionData?.delta) {
            // Guest sent state delta - apply and broadcast to all
            setGameState(prev => {
              const delta: StateDelta = actionData.delta
              logger.info(`[ACTION] Received STATE_DELTA from guest, broadcasting to all`)

              // If host recently restored from storage, ignore score deltas from guests
              // Host's scores are authoritative after F5 restore
              let safeDelta = delta
              if (recentlyRestoredFromStorageRef.current && delta.playerDeltas) {
                logger.info('[ACTION] Filtering score deltas from guest - host recently restored from storage')
                safeDelta = {
                  ...delta,
                  playerDeltas: Object.fromEntries(
                    Object.entries(delta.playerDeltas).map(([playerId, playerDelta]) => {
                      const filteredDelta = { ...playerDelta }
                      delete filteredDelta.scoreDelta  // Remove score delta - host is authoritative
                      return [playerId, filteredDelta]
                    })
                  )
                }
              }

              // Apply delta to host state (host doesn't need localPlayerId since they track all decks)
              const currentLocalPlayerId = localPlayerIdRef.current || prev.localPlayerId
              const updatedState = applyStateDelta(prev, safeDelta, currentLocalPlayerId)

              // Broadcast to all guests (including sender for consistency)
              // Use the filtered delta if we filtered score deltas
              if (webrtcManagerRef.current) {
                webrtcManagerRef.current.broadcastStateDelta(safeDelta)
              }

              return updatedState
            })
          } else if (actionType === 'NEXT_PHASE') {
            // Guest wants to advance to next phase
            setGameState(prev => {
              const currentState = prev
              const currentPhase = currentState.currentPhase
              const enteringScoringPhase = currentPhase === 2 && !currentState.isScoringStep

              const newPhase = currentPhase + 1
              return {
                ...currentState,
                currentPhase: newPhase,
                ...(enteringScoringPhase && { isScoringStep: true })
              }
            })
          } else if (actionType === 'PREV_PHASE') {
            // Guest wants to go to previous phase
            setGameState(prev => {
              const currentState = prev
              if (currentState.isScoringStep) {
                return { ...currentState, isScoringStep: false, currentPhase: Math.max(1, currentState.currentPhase - 1) }
              }
              return {
                ...currentState,
                currentPhase: Math.max(1, currentState.currentPhase - 1),
              }
            })
          } else if (actionType === 'SET_PHASE' && actionData?.phaseIndex !== undefined) {
            // Guest wants to set specific phase
            setGameState(prev => ({ ...prev, currentPhase: actionData.phaseIndex }))
          } else if (actionType === 'UPDATE_PLAYER_NAME' && actionData?.playerId !== undefined && actionData?.name !== undefined) {
            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p => p.id === actionData.playerId ? { ...p, name: actionData.name } : p),
            }))
          } else if (actionType === 'CHANGE_PLAYER_COLOR' && actionData?.playerId !== undefined && actionData?.color !== undefined) {
            // Guest changed color - update and broadcast to all guests
            const playerId = actionData.playerId
            const color = actionData.color
            logger.info(`[ACTION] Guest changed color for player ${playerId}`)
            setGameState(prev => {
              const newState = {
                ...prev,
                players: prev.players.map(p => p.id === playerId ? { ...p, color } : p),
              }
              // Broadcast color change to all guests (exclude sender who already has the change)
              if (webrtcManagerRef.current) {
                webrtcManagerRef.current.broadcastToGuests({
                  type: 'CHANGE_PLAYER_COLOR',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  data: { playerId, color },
                  timestamp: Date.now()
                })
              }
              return newState
            })
          } else if (actionType === 'UPDATE_PLAYER_SCORE' && actionData?.playerId !== undefined && actionData?.delta !== undefined) {
            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p =>
                p.id === actionData.playerId ? { ...p, score: Math.max(0, p.score + actionData.delta) } : p
              ),
            }))
          } else if (actionType === 'CHANGE_PLAYER_DECK' && actionData?.playerId !== undefined) {
            const playerId = actionData.playerId
            const deckType = actionData.deckType
            const receivedDeck = actionData.deck as any[] | undefined

            setGameState(prev => {
              const player = prev.players.find(p => p.id === playerId)
              if (!player) {return prev}

              let deckData: Card[]

              if (receivedDeck && receivedDeck.length > 0) {
                // Guest sent their deck data - reconstruct full cards from baseId
                logger.info(`[CHANGE_PLAYER_DECK] Host received ${receivedDeck.length} cards for player ${playerId}`)
                deckData = receivedDeck.map((compactCard: any) => {
                  if (compactCard.baseId) {
                    const cardDef = getCardDefinition(compactCard.baseId)
                    if (cardDef) {
                      return {
                        ...cardDef,
                        id: compactCard.id,
                        baseId: compactCard.baseId,
                        deck: deckType,
                        ownerId: playerId,
                        ownerName: player.name,
                        power: compactCard.power,
                        powerModifier: compactCard.powerModifier || 0,
                        isFaceDown: compactCard.isFaceDown || false,
                        statuses: compactCard.statuses || []
                      }
                    }
                  }
                  // Fallback for cards without baseId
                  return {
                    id: compactCard.id,
                    baseId: compactCard.id,
                    name: 'Unknown',
                    deck: deckType,
                    ownerId: playerId,
                    ownerName: player.name,
                    power: compactCard.power || 0,
                    powerModifier: 0,
                    isFaceDown: false,
                    statuses: [],
                    imageUrl: '',
                    ability: ''
                  }
                })
              } else {
                // No deck data received - create deck locally (for host's own deck changes)
                deckData = createDeck(deckType, playerId, player.name)
                logger.info(`[CHANGE_PLAYER_DECK] Host created deck for player ${playerId} with ${deckData.length} cards from ${deckType}`)
              }

              const newState = {
                ...prev,
                players: prev.players.map(p =>
                  p.id === playerId
                    ? { ...p, selectedDeck: deckType, deck: deckData, hand: [], discard: [], announcedCard: null, boardHistory: [] }
                    : p
                ),
              }

              // Broadcast to all other guests (exclude sender if we know who sent it)
              if (webrtcManagerRef.current) {
                // Create compact deck data for broadcasting
                const compactDeckForBroadcast = deckData.map(card => ({
                  id: card.id,
                  baseId: card.baseId,
                  power: card.power,
                  powerModifier: card.powerModifier || 0,
                  isFaceDown: card.isFaceDown || false,
                  statuses: card.statuses || []
                }))

                webrtcManagerRef.current.broadcastToGuests({
                  type: 'CHANGE_PLAYER_DECK',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  playerId,
                  data: {
                    playerId,
                    deckType,
                    deck: compactDeckForBroadcast,
                    deckSize: compactDeckForBroadcast.length
                  },
                  timestamp: Date.now()
                })
                logger.info(`[CHANGE_PLAYER_DECK] Broadcasted deck change for player ${playerId} to all guests`)
              }

              return newState
            })
          } else if (actionType === 'TOGGLE_ACTIVE_PLAYER' && actionData?.playerId !== undefined) {
            setGameState(prev => {
              const currentPlayer = prev.players.find(p => p.id === actionData.playerId)
              if (!currentPlayer) {return prev}

              // Use the proper toggleActivePlayer function from PhaseManagement
              // This handles the Preparation phase (draw card) and transition to Setup
              const newState = toggleActivePlayerPhase(prev, actionData.playerId)

              // Broadcast the state change to all guests
              if (webrtcManagerRef.current) {
                webrtcManagerRef.current.broadcastGameState(newState)
              }

              return newState
            })
          } else if (actionType === 'TOGGLE_AUTO_DRAW' && actionData?.playerId !== undefined) {
            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p =>
                p.id === actionData.playerId ? { ...p, autoDrawEnabled: !p.autoDrawEnabled } : p
              ),
            }))
          } else if (actionType === 'START_NEXT_ROUND') {
            setGameState(prev => ({
              ...prev,
              isRoundEndModalOpen: false,
              currentRound: (prev.currentRound || 1) + 1,
              players: prev.players.map(p => ({
                ...p,
                score: 0,
              })),
            }))
          } else if (actionType === 'RESET_DEPLOY_STATUS') {
            setGameState(prev => {
              const updatedBoard = prev.board.map(row =>
                row.map(cell => {
                  if (cell.card?.statuses) {
                    return {
                      ...cell,
                      card: {
                        ...cell.card,
                        statuses: cell.card.statuses.filter(s => s.type !== 'DeployAbilityUsed')
                      }
                    }
                  }
                  return cell
                })
              )
              return { ...prev, board: updatedBoard, preserveDeployAbilities: false }
            })
          } else if (actionType === 'DECK_DATA_UPDATE' && actionData?.playerId !== undefined && actionData?.deck) {
            // Guest sends their full deck to host after joining
            // Host stores this deck so they can see it and provide it for deck view
            const guestPlayerId = actionData.playerId
            const deck = actionData.deck as any[]
            const deckSize = actionData.deckSize as number

            logger.info(`[ACTION] DECK_DATA_UPDATE: Received ${deck.length} cards for guest ${guestPlayerId}`)

            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p => {
                if (p.id === guestPlayerId) {
                  // Update guest's deck with the full data they sent
                  return { ...p, deck: [...deck], deckSize: deckSize || deck.length }
                }
                return p
              })
            }))
          } else {
            logger.warn(`[ACTION] Unknown action type: ${actionType}`)
          }
        }
        break

      case 'PLAYER_LEAVE':
        // Player is leaving
        logger.info('Player left via WebRTC')
        break

      case 'PLAYER_RECONNECT':
        // Guest is reconnecting after page reload (host only)
        logger.info(`[PLAYER_RECONNECT] Guest ${message.playerId} reconnecting from ${message.senderId}`)
        if (webrtcIsHostRef.current && message.playerId !== undefined && message.senderId) {
          // Send compact reconnect snapshot to avoid "Message too big for JSON channel" error
          const currentState = gameStateRef.current
          logger.info(`[PLAYER_RECONNECT] Current state: hasGameId=${!!currentState?.gameId}, gameId=${currentState?.gameId}, hasPlayers=${currentState?.players?.length || 0}`)
          if (currentState && currentState.gameId) {
            logger.info(`[PLAYER_RECONNECT] Sending compact reconnect snapshot to player ${message.playerId}`)
            const reconnectSnapshot = createReconnectSnapshot(currentState, message.playerId)
            webrtcManagerRef.current?.sendToGuest(message.senderId, {
              type: 'RECONNECT_SNAPSHOT',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: reconnectSnapshot.data,
              timestamp: Date.now()
            })
            logger.info(`[PLAYER_RECONNECT] Sent compact snapshot to player ${message.playerId}`)
          } else {
            logger.warn('[PLAYER_RECONNECT] No valid game state to send')
          }
        }
        break

      case 'START_READY_CHECK':
        // Host started ready check
        logger.info('[handleWebrtcMessage] START_READY_CHECK received')
        if (message.data?.isReadyCheckActive !== undefined || message.data?.isPrivate !== undefined) {
          setGameState(prev => ({
            ...prev,
            isReadyCheckActive: message.data.isReadyCheckActive ?? true,
            isPrivate: message.data.isPrivate ?? true
          }))
        }
        break

      case 'CANCEL_READY_CHECK':
        // Host cancelled ready check
        logger.info('[handleWebrtcMessage] CANCEL_READY_CHECK received')
        if (message.data?.isReadyCheckActive !== undefined) {
          setGameState(prev => ({
            ...prev,
            isReadyCheckActive: message.data.isReadyCheckActive
          }))
        }
        break

      case 'PLAYER_READY':
        // A player is ready (host only)
        if (webrtcIsHostRef.current && message.playerId !== undefined) {
          setGameState(prev => {
            const updatedPlayers = prev.players.map(p =>
              p.id === message.playerId ? { ...p, isReady: true } : p
            )
            const newState = { ...prev, players: updatedPlayers }
            logger.info(`Player ${message.playerId} is ready via WebRTC`)

            // Broadcast the ready status to all guests (so they see the updated status)
            if (webrtcManagerRef.current) {
              webrtcManagerRef.current.broadcastGameState(newState)
              logger.info(`[PLAYER_READY] Broadcasted ready status for player ${message.playerId}`)
            }

            // Check if all real players are ready
            const realPlayers = newState.players.filter(p => !p.isDummy && !p.isDisconnected)
            const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady)

            if (allReady && newState.isReadyCheckActive && !newState.isGameStarted) {
              logger.info('[PLAYER_READY] All players ready! Starting game...')
              // All players ready - start the game!
              const allPlayers = newState.players.filter(p => !p.isDisconnected)
              const randomIndex = Math.floor(Math.random() * allPlayers.length)
              const startingPlayerId = allPlayers[randomIndex].id

              // Prepare final state with cards drawn for all players
              let finalState = { ...newState }
              finalState.isReadyCheckActive = false
              finalState.isGameStarted = true
              finalState.startingPlayerId = startingPlayerId
              finalState.activePlayerId = startingPlayerId
              finalState.currentPhase = 0  // Preparation phase

              // Draw cards for each player
              finalState.players = finalState.players.map(player => {
                if (player.hand.length === 0 && player.deck.length > 0) {
                  const cardsToDraw = 6
                  const newHand = [...player.hand]
                  const newDeck = [...player.deck]

                  for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
                    const drawnCard = newDeck[0]
                    newDeck.splice(0, 1)
                    newHand.push(drawnCard)
                  }

                  logger.info(`[PLAYER_READY] Drew ${newHand.length} cards for player ${player.id}`)
                  return { ...player, hand: newHand, deck: newDeck }
                }
                return player
              })

              // IMPORTANT: Perform Preparation phase for starting player (draws 7th card, transitions to Setup)
              // This MUST be done before creating minimalState for broadcast
              finalState = performPreparationPhase(finalState, startingPlayerId)
              logger.info(`[PLAYER_READY] Preparation phase completed, currentPhase=${finalState.currentPhase}`)

              // Broadcast game start notification first
              if (webrtcManagerRef.current) {
                webrtcManagerRef.current.broadcastToGuests({
                  type: 'GAME_START',
                  senderId: webrtcManagerRef.current.getPeerId(),
                  data: {
                    startingPlayerId,
                    activePlayerId: startingPlayerId,
                    isGameStarted: true,
                    isReadyCheckActive: false
                  },
                  timestamp: Date.now()
                })

                // Then broadcast game state
                // For real players: only send sizes (privacy), guests will draw their own cards
                // For dummy players: send actual card data (all players see dummy cards)
                setTimeout(() => {
                  logger.info('[PLAYER_READY] About to broadcast state after game start')
                  // Don't pre-empty the arrays - let createOptimizedStateForBroadcast handle it
                  // It will send optimized data for dummy players and sizes for real players
                  logger.info(`[PLAYER_READY] Broadcasting state, player sizes: P1 deck=${finalState.players[0]?.deck.length}, hand=${finalState.players[0]?.hand.length}`)
                  logger.info(`[PLAYER_READY] Broadcasting state with currentPhase=${finalState.currentPhase}`)
                  broadcastWebrtcState(finalState)
                  logger.info('[PLAYER_READY] Broadcasted state after game start')
                }, 100)
              }

              return finalState
            }

            return newState
          })
        }
        // Guest: receive the ready status broadcast from host
        else if (!webrtcIsHostRef.current) {
          // Guest receives the delta via STATE_DELTA, no special handling needed here
          logger.info('[PLAYER_READY] Guest received ready status (via STATE_DELTA)')
        }
        break

      case 'ASSIGN_TEAMS':
        // Host assigned teams
        logger.info('[handleWebrtcMessage] ASSIGN_TEAMS received')
        if (message.data?.assignments) {
          setGameState(prev => {
            const updatedPlayers = prev.players.map(p => {
              // Find which team this player is in
              let teamId = p.teamId || 1
              for (const [team, playerIds] of Object.entries(message.data.assignments)) {
                const ids = playerIds as number[]  // Type assertion
                if (ids.includes(p.id)) {
                  teamId = parseInt(team)
                  break
                }
              }
              return { ...p, teamId }
            })
            return { ...prev, players: updatedPlayers }
          })
        }
        break

      case 'SET_GAME_MODE':
        // Host set game mode
        logger.info('[handleWebrtcMessage] SET_GAME_MODE received')
        if (message.data?.mode !== undefined) {
          setGameState(prev => ({ ...prev, gameMode: message.data.mode }))
        }
        break

      case 'SET_GAME_PRIVACY':
        // Host set game privacy
        logger.info('[handleWebrtcMessage] SET_GAME_PRIVACY received')
        if (message.data?.isPrivate !== undefined) {
          setGameState(prev => ({ ...prev, isPrivate: message.data.isPrivate }))
        }
        break

      case 'SET_GRID_SIZE':
        // Host set grid size
        logger.info('[handleWebrtcMessage] SET_GRID_SIZE received')
        if (message.data?.size !== undefined) {
          setGameState(prev => {
            const size = message.data.size
            // Recreate board if size changed
            const newBoard = []
            for (let i = 0; i < size; i++) {
              const row: any[] = []
              for (let j = 0; j < size; j++) {
                row.push({ card: null })
              }
              newBoard.push(row)
            }
            return { ...prev, activeGridSize: size, board: newBoard }
          })
        }
        break

      case 'SET_DUMMY_PLAYER_COUNT':
        // Host set dummy player count
        logger.info('[handleWebrtcMessage] SET_DUMMY_PLAYER_COUNT received')
        if (message.data?.count !== undefined) {
          setGameState(prev => ({ ...prev, dummyPlayerCount: message.data.count }))
        }
        break

      case 'HOST_READY':
        // Host marked themselves as ready (guest only)
        if (message.playerId !== undefined) {
          logger.info(`[handleWebrtcMessage] Host (player ${message.playerId}) is ready`)
          setGameState(prev => {
            const updatedPlayers = prev.players.map(p =>
              p.id === message.playerId ? { ...p, isReady: true } : p
            )
            return { ...prev, players: updatedPlayers }
          })
        }
        break

      case 'GAME_START':
        // Host started the game (guest only)
        // Mark that we've received state from host (enables sending our own deltas)
        receivedServerStateRef.current = true
        logger.info('[handleWebrtcMessage] Game starting!', message.data)
        // Log current deck/hand sizes before applying GAME_START
        if (gameStateRef.current) {
          logger.info(`[GAME_START] Current phase before: ${gameStateRef.current.currentPhase}`)
          gameStateRef.current.players.forEach(p => {
            logger.info(`[GAME_START] Before: Player ${p.id} - deck: ${p.deck.length}, hand: ${p.hand.length}`)
          })
        }
        if (message.data) {
          setGameState(prev => {
            // Log sizes before drawing
            logger.info(`[GAME_START] Processing for localPlayerId=${localPlayerIdRef.current}`)
            prev.players.forEach(p => {
              logger.info(`[GAME_START] Player ${p.id} before: deck=${p.deck.length}, hand=${p.hand.length}`)
            })

            const startingPlayerId = message.data.startingPlayerId ?? message.data.activePlayerId
            const newState = {
              ...prev,
              isGameStarted: message.data.isGameStarted ?? true,
              isReadyCheckActive: false,
              startingPlayerId: startingPlayerId,
              activePlayerId: message.data.activePlayerId,
              // IMPORTANT: Don't set phase here! Let the host's STATE_UPDATE set the correct phase.
              // The host will have already executed Preparation phase and will send currentPhase=1 (Setup)
              currentPhase: prev.currentPhase  // Keep current phase until STATE_UPDATE arrives
            }

            // Draw initial hand (6 cards) for the local player only
            // Other players' deck/hand sizes will be updated via STATE_UPDATE from host
            const localPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
            if (localPlayer && localPlayer.hand.length === 0 && localPlayer.deck.length > 0) {
              const cardsToDraw = 6
              const newHand = [...localPlayer.hand]
              const newDeck = [...localPlayer.deck]

              for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
                const drawnCard = newDeck[0]
                newDeck.splice(0, 1)
                newHand.push(drawnCard)
              }

              // Update the local player in players array
              newState.players = newState.players.map(p =>
                p.id === localPlayerIdRef.current
                  ? { ...p, hand: newHand, deck: newDeck }
                  : p
              )

              logger.info(`[GAME_START] Drew ${newHand.length} cards for local player ${localPlayerIdRef.current}, deck now has ${newDeck.length} cards`)
            }

            // NOTE: Preparation phase for the starting player will be handled via STATE_UPDATE from host
            // The host has already executed it and will send the correct state

            // Log sizes after drawing
            newState.players.forEach(p => {
              logger.info(`[GAME_START] Player ${p.id} after: deck=${p.deck.length}, hand=${p.hand.length}`)
            })

            logger.info(`[GAME_START] Final state: currentPhase=${newState.currentPhase}, activePlayerId=${newState.activePlayerId}, startingPlayerId=${newState.startingPlayerId}`)

            return newState
          })
        }
        break

      case 'ACTIVE_PLAYER_CHANGED':
        // Host changed the active player
        logger.info('[handleWebrtcMessage] Active player changed!', message.data)
        if (message.data) {
          setGameState(prev => {
            const newState = {
              ...prev,
              activePlayerId: message.data.activePlayerId
            }

            // Update phase if provided
            if (message.data.currentPhase !== undefined) {
              newState.currentPhase = message.data.currentPhase
            }

            // Update turn number if provided
            if (message.data.turnNumber !== undefined) {
              newState.turnNumber = message.data.turnNumber
            }

            // If entering Preparation phase for local player, draw a card
            if (newState.currentPhase === 0 && newState.activePlayerId === localPlayerIdRef.current) {
              const localPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
              if (localPlayer && localPlayer.deck.length > 0) {
                const drawnCard = localPlayer.deck[0]
                const newDeck = [...localPlayer.deck.slice(1)]
                const newHand = [...localPlayer.hand, drawnCard]

                newState.players = newState.players.map(p =>
                  p.id === localPlayerIdRef.current
                    ? { ...p, deck: newDeck, hand: newHand }
                    : p
                )

                logger.info(`[ACTIVE_PLAYER_CHANGED] Local player drew card in Preparation phase`)
              }

              // Transition to Setup phase
              newState.currentPhase = 1
            }

            return newState
          })
        }
        break

      case 'SYNC_DECK_SELECTIONS':
        // Host broadcasts deck selection changes to all guests
        logger.info('[SYNC_DECK_SELECTIONS] Received deck selection sync', message.data)
        if (message.data) {
          setGameState(prev => {
            // Handle single player deck update (new player joined)
            if (message.data.playerId !== undefined && message.data.selectedDeck !== undefined) {
              // Skip if this is about the local player - we already have our correct selection
              if (message.data.playerId === localPlayerIdRef.current) {
                logger.info(`[SYNC_DECK_SELECTIONS] Skipping update for local player ${message.data.playerId}`)
                return prev
              }
              return {
                ...prev,
                players: prev.players.map(p =>
                  p.id === message.data.playerId ? { ...p, selectedDeck: message.data.selectedDeck } : p
                ),
              }
            }
            // Handle full deck selections array
            if (message.data.deckSelections && Array.isArray(message.data.deckSelections)) {
              return {
                ...prev,
                players: prev.players.map(p => {
                  // Skip local player - they already have their correct selection
                  if (p.id === localPlayerIdRef.current) {
                    return p
                  }
                  const deckSel = message.data.deckSelections.find((ds: any) => ds.id === p.id)
                  return deckSel ? { ...p, selectedDeck: deckSel.selectedDeck } : p
                }),
              }
            }
            return prev
          })
        }
        break

      case 'CHANGE_PLAYER_DECK':
        // Player changed deck selection - host broadcasts to all guests
        logger.info('[CHANGE_PLAYER_DECK] Received deck change broadcast', message.data)
        if (!message.data || message.data.playerId === undefined) {
          break
        }

        {
          const targetPlayerId = message.data.playerId
          const deckType = message.data.deckType
          const receivedDeck = message.data.deck as any[] | undefined

          // Skip if this is about the local player - they already have their correct deck
          if (targetPlayerId === localPlayerIdRef.current) {
            logger.info(`[CHANGE_PLAYER_DECK] Skipping update for local player ${targetPlayerId}`)
            break
          }

          setGameState(prev => {
            const player = prev.players.find(p => p.id === targetPlayerId)
            if (!player) {return prev}

            let deckData: Card[]

          if (receivedDeck && receivedDeck.length > 0) {
            // Reconstruct from baseId using local card database
            deckData = receivedDeck.map((compactCard: any) => {
              if (compactCard.baseId) {
                const cardDef = getCardDefinition(compactCard.baseId)
                if (cardDef) {
                  return {
                    ...cardDef,
                    id: compactCard.id,
                    baseId: compactCard.baseId,
                    deck: deckType,
                    ownerId: targetPlayerId,
                    ownerName: player.name,
                    power: compactCard.power,
                    powerModifier: compactCard.powerModifier || 0,
                    isFaceDown: compactCard.isFaceDown || false,
                    statuses: compactCard.statuses || []
                  }
                }
                // Fallback for cards with baseId but no definition found
                return {
                  id: compactCard.id,
                  baseId: compactCard.baseId,
                  name: 'Unknown',
                  deck: deckType,
                  ownerId: targetPlayerId,
                  ownerName: player.name,
                  power: compactCard.power || 0,
                  powerModifier: 0,
                  isFaceDown: false,
                  statuses: [],
                  imageUrl: '',
                  ability: ''
                }
              }
              // Fallback for cards without baseId
              return {
                id: compactCard.id,
                baseId: compactCard.id,
                name: 'Unknown',
                deck: deckType,
                ownerId: targetPlayerId,
                ownerName: player.name,
                power: compactCard.power || 0,
                powerModifier: 0,
                isFaceDown: false,
                statuses: [],
                imageUrl: '',
                ability: ''
              }
            })
          } else {
            // No deck data - create locally (shouldn't happen with new system)
            deckData = createDeck(deckType, targetPlayerId, player.name)
            logger.info(`[CHANGE_PLAYER_DECK] Creating deck locally for player ${targetPlayerId} from ${deckType}`)
          }

          return {
            ...prev,
            players: prev.players.map(p =>
              p.id === targetPlayerId
                ? { ...p, selectedDeck: deckType, deck: deckData, hand: [], discard: [], announcedCard: null, boardHistory: [] }
                : p
            ),
          }
        })
        }
        break

      case 'GAME_RESET':
        // Handle game reset message (from host in WebRTC mode)
        logger.info('[GameReset] Received GAME_RESET message via WebRTC')
        {
          setGameState(prev => {
          // Create fresh board with correct grid size
          const gridSize: number = (message.data.activeGridSize as unknown as number) || 8
          const newBoard: Board = []
          for (let i = 0; i < gridSize; i++) {
            const row: any[] = []
            for (let j = 0; j < gridSize; j++) {
              row.push({ card: null })
            }
            newBoard.push(row)
          }

          // Process players - create decks locally for real players, use provided data for dummies
          const players = (message.data.players || []).map((p: any) => {
            if (p.isDummy && p.hand && p.deck && p.discard) {
              // Dummy player - use provided card data
              return {
                ...p,
                boardHistory: [],
              }
            } else {
              // Real player - create deck locally
              const deckType = p.selectedDeck || 'SynchroTech'
              return {
                ...p,
                hand: [],
                deck: createDeck(deckType as any, p.id, p.name),
                discard: [],
                boardHistory: [],
              }
            }
          })

          const resetState = {
            ...prev,
            players: players,
            gameMode: message.data.gameMode,
            isPrivate: message.data.isPrivate,
            activeGridSize: message.data.activeGridSize,
            dummyPlayerCount: message.data.dummyPlayerCount,
            autoAbilitiesEnabled: message.data.autoAbilitiesEnabled,
            isGameStarted: message.data.isGameStarted,
            currentPhase: message.data.currentPhase,
            currentRound: message.data.currentRound,
            turnNumber: message.data.turnNumber,
            activePlayerId: message.data.activePlayerId,
            startingPlayerId: message.data.startingPlayerId,
            roundWinners: message.data.roundWinners || {},
            gameWinner: message.data.gameWinner,
            isRoundEndModalOpen: message.data.isRoundEndModalOpen,
            isReadyCheckActive: message.data.isReadyCheckActive,
            // Use new board with correct grid size
            board: newBoard,
            // Clear other state
            targetingMode: null,
            floatingTexts: [],
          }
          gameStateRef.current = resetState
          logger.info('[GameReset] Game reset complete in WebRTC mode')
          return resetState
        })
        }
        break

      // Ability mode synchronization messages
      case 'ABILITY_MODE_SET':
        // Host broadcasts ability mode to all clients
        if (message.data?.abilityMode) {
          setGameState(prev => ({
            ...prev,
            abilityMode: message.data.abilityMode,
          }))
          logger.info('[AbilityMode] Received ability mode from host', {
            playerId: message.data.abilityMode.playerId,
            mode: message.data.abilityMode.mode,
          })
        }
        break

      case 'ABILITY_TARGET_SELECTED':
        // Target selected notification
        logger.info('[Ability] Target selected', message.data)
        break

      case 'ABILITY_COMPLETED':
        // Ability completed - clear mode
        setGameState(prev => ({
          ...prev,
          abilityMode: null,
        }))
        logger.info('[Ability] Ability completed', message.data)
        break

      case 'ABILITY_CANCELLED':
        // Ability cancelled - clear mode
        setGameState(prev => ({
          ...prev,
          abilityMode: null,
        }))
        logger.info('[Ability] Ability cancelled')
        break

      case 'CHANGE_PLAYER_COLOR':
        // Player color change broadcast (host -> guests, or guest -> host -> guests)
        logger.info('[CHANGE_PLAYER_COLOR] Received color change broadcast', message.data)
        if (!message.data || message.data.playerId === undefined) {
          break
        }

        {
          const colorPlayerId = message.data.playerId
          const newColor = message.data.color

          // Skip if this is about the local player - they already have their correct color
          if (colorPlayerId === localPlayerIdRef.current) {
            logger.info(`[CHANGE_PLAYER_COLOR] Skipping update for local player ${colorPlayerId}`)
            break
          }

          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => p.id === colorPlayerId ? { ...p, color: newColor } : p),
          }))
          logger.info(`[CHANGE_PLAYER_COLOR] Updated color for player ${colorPlayerId}`)
        }
        break

      // Visual effects messages (for P2P mode)
      case 'TRIGGER_HIGHLIGHT':
        // Guest sent highlight trigger to host - host needs to apply locally AND broadcast to all guests
        if (message.data?.highlightData) {
          const highlightData = message.data.highlightData
          // Apply locally (host sees the effect)
          setLatestHighlight(highlightData)

          // Host: broadcast to all other guests (excluding the sender)
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'HIGHLIGHT_TRIGGERED' as const,
              senderId: message.senderId,
              data: highlightData,
              timestamp: Date.now()
            }, message.senderId)  // Exclude sender from broadcast
          }
        }
        break

      case 'HIGHLIGHT_TRIGGERED':
        // Host broadcasted highlight to all guests
        if (message.data) {
          // Ignore if we're the sender (host doesn't send to self, but guest might receive echo)
          const myPeerId = webrtcManagerRef.current?.getPeerId()
          if (message.senderId !== myPeerId) {
            setLatestHighlight(message.data)
          }
        }
        break

      case 'TRIGGER_FLOATING_TEXT':
        // Guest sent floating text trigger to host - host applies locally and broadcasts
        if (message.data?.textData) {
          const textData = message.data.textData
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, textData].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'FLOATING_TEXT_TRIGGERED' as const,
              senderId: message.senderId,
              data: textData,
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'TRIGGER_FLOATING_TEXT_BATCH':
        // Guest sent floating text batch trigger to host
        if (message.data?.batch) {
          const batch = message.data.batch
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, ...batch].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'FLOATING_TEXT_BATCH_TRIGGERED' as const,
              senderId: message.senderId,
              data: { batch },
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'FLOATING_TEXT_TRIGGERED':
      case 'FLOATING_TEXT_BATCH_TRIGGERED': {
        // Host broadcasted floating texts to all guests
        // Ignore if we're the sender (to avoid duplicate)
        const myPeerIdFloat = webrtcManagerRef.current?.getPeerId()
        if (message.data?.batch && message.senderId !== myPeerIdFloat) {
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, ...message.data.batch].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        } else if (message.data?.textData && message.senderId !== myPeerIdFloat) {
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, message.data.textData].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        }
        break
      }

      case 'TRIGGER_NO_TARGET':
        // Guest sent no-target trigger to host
        if (message.data?.coords) {
          const coords = message.data.coords
          const timestamp = message.data.timestamp
          setLatestNoTarget({ coords, timestamp })
          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'NO_TARGET_TRIGGERED' as const,
              senderId: message.senderId,
              data: { coords, timestamp },
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'NO_TARGET_TRIGGERED':
        // Host broadcasted no-target overlay to all guests
        if (message.data?.coords) {
          const myPeerId = webrtcManagerRef.current?.getPeerId()
          if (message.senderId !== myPeerId) {
            setLatestNoTarget({ coords: message.data.coords, timestamp: message.data.timestamp })
          }
        }
        break

      case 'TRIGGER_DECK_SELECTION':
        // Guest sent deck selection trigger to host - host applies locally and broadcasts
        if (message.data) {
          const deckSelectionData = message.data
          setLatestDeckSelections(prev => [...prev, deckSelectionData])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== deckSelectionData.timestamp))
          }, 1000)

          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'DECK_SELECTION_TRIGGERED' as const,
              senderId: message.senderId,
              data: deckSelectionData,
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'TRIGGER_HAND_CARD_SELECTION':
        // Guest sent hand card selection trigger to host - host applies locally and broadcasts
        if (message.data) {
          const handCardSelectionData = message.data
          setLatestHandCardSelections(prev => [...prev, handCardSelectionData])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== handCardSelectionData.timestamp))
          }, 1000)

          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'HAND_CARD_SELECTION_TRIGGERED' as const,
              senderId: message.senderId,
              data: handCardSelectionData,
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'TRIGGER_TARGET_SELECTION':
        // Guest sent target selection effect to host - host applies locally and broadcasts
        if (message.data) {
          const targetSelectionData = message.data
          setTargetSelectionEffects(prev => [...prev, targetSelectionData])
          // Auto-remove after 1 second
          setTimeout(() => {
            setTargetSelectionEffects(prev => prev.filter(e => e.timestamp !== targetSelectionData.timestamp))
          }, 1000)

          // Host: broadcast to all other guests
          if (webrtcIsHostRef.current && webrtcManagerRef.current && message.senderId) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'TARGET_SELECTION_TRIGGERED' as const,
              senderId: message.senderId,
              data: targetSelectionData,
              timestamp: Date.now()
            }, message.senderId)
          }
        }
        break

      case 'TARGET_SELECTION_TRIGGERED':
        // Host broadcasted target selection effect to all guests
        // Ignore if we sent this message ourselves (to avoid duplicate)
        if (message.data && message.senderId !== webrtcManagerRef.current?.getPeerId()) {
          setTargetSelectionEffects(prev => [...prev, message.data])
          // Auto-remove after 1 second
          setTimeout(() => {
            setTargetSelectionEffects(prev => prev.filter(e => e.timestamp !== message.data.timestamp))
          }, 1000)
        }
        break

      case 'DECK_SELECTION_TRIGGERED':
        // Host (or relay) broadcasted deck selection to all
        // Ignore if we sent this message ourselves
        if (message.data && message.senderId !== webrtcManagerRef.current?.getPeerId()) {
          setLatestDeckSelections(prev => [...prev, message.data])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== message.data.timestamp))
          }, 1000)
        }
        break

      case 'HAND_CARD_SELECTION_TRIGGERED':
        // Host (or relay) broadcasted hand card selection to all
        // Ignore if we sent this message ourselves
        if (message.data && message.senderId !== webrtcManagerRef.current?.getPeerId()) {
          setLatestHandCardSelections(prev => [...prev, message.data])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== message.data.timestamp))
          }, 1000)
        }
        break

      case 'SET_TARGETING_MODE':
        // Targeting mode synchronization (P2P)
        if (message.data?.targetingMode) {
          const targetingMode = message.data.targetingMode
          setGameState(prev => ({
            ...prev,
            targetingMode: targetingMode,
          }))
          gameStateRef.current.targetingMode = targetingMode
          logger.info('[TargetingMode] Received targeting mode via WebRTC', {
            playerId: targetingMode.playerId,
            mode: targetingMode.action.mode,
          })
        }
        break

      case 'CLEAR_TARGETING_MODE':
        // Clear targeting mode (P2P)
        setGameState(prev => ({
          ...prev,
          targetingMode: null,
        }))
        gameStateRef.current.targetingMode = null
        logger.debug('[TargetingMode] Cleared targeting mode via WebRTC')
        break

      case 'SYNC_VALID_TARGETS':
        // Receive valid targets from other players (P2P)
        if (message.data?.playerId !== localPlayerIdRef.current) {
          setRemoteValidTargets({
            playerId: message.data.playerId,
            validHandTargets: message.data.validHandTargets || [],
            isDeckSelectable: message.data.isDeckSelectable || false,
          })
          // Auto-clear after 10 seconds to prevent stale data
          setTimeout(() => {
            setRemoteValidTargets(prev => prev?.playerId === message.data.playerId ? null : prev)
          }, 10000)
        }
        break

      case 'RECONNECT_ACCEPT':
        // Host accepted our reconnection, sending current game state
        logger.info('[Reconnection] Host accepted reconnection, restoring state')
        if (message.data?.gameState) {
          const restoredState = message.data.gameState
          setGameState(restoredState)
          setConnectionStatus('Connected')
          logger.info(`[Reconnection] State restored with ${restoredState.players?.length || 0} players`)

          // Clear stored reconnection data on successful reconnect
          try {
            localStorage.removeItem('webrtc_reconnection_data')
          } catch (e) {
            logger.warn('[Reconnection] Failed to clear stored data:', e)
          }
        }
        break

      case 'RECONNECT_REJECT': {
        // Host rejected our reconnection (timeout or game over)
        const rejectReason = message.data?.reason || 'unknown'
        logger.warn(`[Reconnection] Reconnection rejected: ${rejectReason}`)
        setConnectionStatus('Disconnected')
        // Clear stored data
        try {
          localStorage.removeItem('webrtc_reconnection_data')
        } catch (e) {}
        break
      }

      case 'PLAYER_DISCONNECTED':
        // Host broadcast that a player disconnected
        if (message.data?.playerId !== undefined) {
          logger.info(`[Reconnection] Player ${message.data.playerId} disconnected, reconnection window open`)
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.id === message.data.playerId ? { ...p, isDisconnected: true } : p
            )
          }))
        }
        break

      case 'PLAYER_RECONNECTED':
        // Host broadcast that a player reconnected
        if (message.data?.playerId !== undefined) {
          logger.info(`[Reconnection] Player ${message.data.playerId} reconnected`)
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.id === message.data.playerId ? { ...p, isDisconnected: false } : p
            )
          }))
        }
        break

      case 'PLAYER_CONVERTED_TO_DUMMY':
        // Host broadcast that a player was converted to dummy after timeout
        if (message.data?.playerId !== undefined) {
          logger.info(`[Reconnection] Player ${message.data.playerId} converted to dummy`)
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.id === message.data.playerId ? { ...p, isDummy: true, isDisconnected: true } : p
            )
          }))
        }
        break

      case 'REQUEST_DECK_VIEW':
        // Guest requests to view another player's deck
        if (webrtcIsHostRef.current && message.data?.targetPlayerId !== undefined) {
          const targetPlayerId = message.data.targetPlayerId as number
          const requestingPlayerId = message.playerId

          logger.info(`[REQUEST_DECK_VIEW] Player ${requestingPlayerId} wants to view deck of player ${targetPlayerId}`)

          // Find the target player
          const targetPlayer = gameState.players.find(p => p.id === targetPlayerId)
          if (targetPlayer && webrtcManagerRef.current) {
            // Send COMPACT deck data (id + baseId) - requester can reconstruct full cards from their contentDatabase
            // If target is the host or a dummy, we have the full deck
            // If target is a guest, we need to use the deckCards (if available) or reconstruct from stored data
            let deckToSend: any[] = []

            if (targetPlayerId === localPlayerIdRef.current || targetPlayer.isDummy) {
              // Host or dummy - we have full deck data
              logger.info(`[REQUEST_DECK_VIEW] Host/dummy deck has ${targetPlayer.deck.length} cards, first card baseId: ${targetPlayer.deck[0]?.baseId}`)
              deckToSend = targetPlayer.deck.map((c: any) => ({
                id: c.id,
                baseId: c.baseId,
                deck: c.deck, // Include deck so guest can see correct card back
                power: c.power,
                powerModifier: c.powerModifier,
                isFaceDown: c.isFaceDown,
                statuses: c.statuses || []
              }))
            } else {
              // Guest player - use deckCards from compact state or send deck array
              if ((targetPlayer as any).deckCards && (targetPlayer as any).deckCards.length > 0) {
                deckToSend = (targetPlayer as any).deckCards
              } else {
                // Fallback: send deck array (should have been reconstructed from compact data)
                deckToSend = targetPlayer.deck.map((c: any) => ({
                  id: c.id,
                  baseId: c.baseId,
                  power: c.power,
                  powerModifier: c.powerModifier,
                  isFaceDown: c.isFaceDown,
                  statuses: c.statuses || []
                }))
              }
            }

            const deckData = {
              targetPlayerId,
              deckCards: deckToSend, // Send compact card data with baseId
              deckSize: deckToSend.length
            }

            // Send directly to the requesting peer
            const responseMessage: WebrtcMessage = {
              type: 'DECK_VIEW_DATA',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: deckData,
              timestamp: Date.now()
            }

            // Send to the specific guest
            webrtcManagerRef.current.sendToGuest(message.senderId || '', responseMessage)
            logger.info(`[REQUEST_DECK_VIEW] Sent ${deckData.deckCards.length} cards for player ${targetPlayerId}`)
          }
        }
        break

      case 'DECK_VIEW_DATA':
        // Host sends compact deck data for viewing
        if (message.data?.targetPlayerId !== undefined && message.data?.deckCards) {
          const targetPlayerId = message.data.targetPlayerId as number
          const deckCards = message.data.deckCards as any[]

          logger.info(`[DECK_VIEW_DATA] Received ${deckCards.length} deck cards for player ${targetPlayerId}`)

          // Reconstruct full cards from baseId using contentDatabase
          const reconstructDeckCard = (compactCard: any): Card => {
            if (compactCard.baseId) {
              const cardDef = getCardDefinition(compactCard.baseId)
              if (cardDef) {
                return {
                  ...cardDef,
                  id: compactCard.id,
                  baseId: compactCard.baseId, // Preserve baseId from compact data
                  deck: compactCard.deck || DeckType.SynchroTech, // Add deck property
                  ownerId: targetPlayerId,
                  power: compactCard.power,
                  powerModifier: compactCard.powerModifier,
                  isFaceDown: compactCard.isFaceDown,
                  statuses: compactCard.statuses || []
                }
              } else {
                logger.warn(`[DECK_VIEW_DATA] Card definition not found for baseId: ${compactCard.baseId}`)
              }
            } else {
              logger.warn(`[DECK_VIEW_DATA] Card missing baseId, id: ${compactCard.id}`)
            }
            // Fallback: create minimal card with all required properties
            const fallbackCard: Card = {
              id: compactCard.id,
              baseId: compactCard.baseId || compactCard.id,
              name: 'Unknown',
              imageUrl: '',
              fallbackImage: '',
              power: compactCard.power || 0,
              powerModifier: 0,
              isFaceDown: false,
              statuses: [],
              deck: DeckType.SynchroTech,
              color: 'Red',
              ability: '',
              bonusPower: 0,
              isPlaceholder: false
            }
            return fallbackCard
          }

          const reconstructedDeck: Card[] = deckCards.map(reconstructDeckCard)

          // Update the target player's deck in local state
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => {
              if (p.id === targetPlayerId) {
                return { ...p, deck: reconstructedDeck } // Replace with reconstructed deck
              }
              return p
            })
          }))
        }
        break

      case 'DECK_DATA_UPDATE':
        // Guest sends their full deck to host (for deck view feature)
        // Host stores this deck and can provide it when someone requests deck view
        if (webrtcIsHostRef.current && message.playerId !== undefined && message.data?.deck) {
          const guestPlayerId = message.playerId
          const deck = message.data.deck as any[]
          const deckSize = message.data.deckSize as number

          logger.info(`[DECK_DATA_UPDATE] Received ${deck.length} cards for guest ${guestPlayerId}, deckSize=${deckSize}`)

          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p => {
              if (p.id === guestPlayerId) {
                // Update guest's deck with the full data
                return { ...p, deck: [...deck], deckSize: deckSize }
              }
              return p
            })
          }))
        }
        break

      case 'REQUEST_DECK_DATA':
        // Host requests deck data from all guests after F5 restore
        // Guests should send their deck data to host
        if (!webrtcIsHostRef.current && webrtcManagerRef.current) {
          const localPlayer = gameState.players.find(p => p.id === localPlayerIdRef.current)
          if (localPlayer && localPlayer.deck.length > 0) {
            logger.info(`[REQUEST_DECK_DATA] Host requested deck data, sending ${localPlayer.deck.length} cards`)

            const compactDeckData = localPlayer.deck.map(card => ({
              id: card.id,
              baseId: card.baseId,
              power: card.power,
              powerModifier: card.powerModifier || 0,
              isFaceDown: card.isFaceDown || false,
              statuses: card.statuses || []
            }))

            webrtcManagerRef.current.sendAction('DECK_DATA_UPDATE', {
              playerId: localPlayerIdRef.current,
              deck: compactDeckData,
              deckSize: compactDeckData.length
            })
          }
        }
        break

      default:
        // Log unknown message types for debugging
        logger.warn(`[handleWebrtcMessage] Unknown message type: ${message.type}`, message)
        break
    }
  }, [webrtcIsHost, createDeck, broadcastWebrtcState, gameState, localPlayerId])

  /**
   * Start guest reconnection process
   * IMPORTANT: This function checks localStorage on each attempt for new host peerId
   * This allows guests to reconnect after host F5 (which generates new peerId)
   */
  const startGuestReconnection = useCallback((initialHostPeerId: string) => {
    if (!webrtcManagerRef.current || isReconnecting) {
      return
    }

    logger.info('[Reconnection] Starting guest reconnection to host:', initialHostPeerId)
    setIsReconnecting(true)
    setConnectionStatus('Connecting')

    const reconnectionTimeout = 30000 // 30 seconds
    const retryInterval = 1000 // Start with 1 second
    let attempts = 0
    const maxAttempts = reconnectionTimeout / retryInterval

    // Store reconnection data
    try {
      const reconnectionData = {
        hostPeerId: initialHostPeerId,
        playerId: localPlayerId,
        gameState: gameState,
        timestamp: Date.now(),
        isHost: false
      }
      localStorage.setItem('webrtc_reconnection_data', JSON.stringify(reconnectionData))
    } catch (e) {
      logger.error('[Reconnection] Failed to store data:', e)
    }

    const attemptReconnect = async () => {
      attempts++
      const timeRemaining = Math.max(0, reconnectionTimeout - (attempts * retryInterval))

      setReconnectProgress({ attempt: attempts, maxAttempts, timeRemaining })

      if (timeRemaining <= 0) {
        // Timeout expired - clear stale data so user can start fresh
        logger.warn('[Reconnection] Reconnection timeout expired - clearing stale data')
        setIsReconnecting(false)
        setReconnectProgress(null)
        clearWebrtcData()
        return
      }

      // CRITICAL: Check localStorage for updated host peerId on each attempt
      // This allows reconnection after host F5 (new peerId)
      let hostPeerId = initialHostPeerId
      if (gameState?.gameId) {
        const hostData = getHostPeerIdForGame(gameState.gameId)
        if (hostData && hostData.peerId !== initialHostPeerId) {
          hostPeerId = hostData.peerId
          logger.info(`[Reconnection] Found new host peerId in localStorage: ${hostPeerId}`)
          // Update the stored reconnection data
          try {
            const reconnectionData = {
              hostPeerId: hostPeerId,
              playerId: localPlayerId,
              gameState: gameState,
              timestamp: Date.now(),
              isHost: false
            }
            localStorage.setItem('webrtc_reconnection_data', JSON.stringify(reconnectionData))
          } catch (e) {
            logger.error('[Reconnection] Failed to update reconnection data:', e)
          }
        }
      }

      logger.info(`[Reconnection] Attempt ${attempts}/${maxAttempts} to ${hostPeerId} (${Math.round(timeRemaining / 1000)}s remaining)`)

      try {
        // Try to reconnect as existing player
        // If we have a playerId, use initializeAsReconnectingGuest to restore session
        // Otherwise use initializeAsGuest for new connection
        const currentLocalPlayerId = localPlayerId || localPlayerIdRef.current
        if (currentLocalPlayerId !== null) {
          logger.info(`[Reconnection] Reconnecting as existing player ${currentLocalPlayerId} to host ${hostPeerId}`)
          await webrtcManagerRef.current!.initializeAsReconnectingGuest(hostPeerId, currentLocalPlayerId)
        } else {
          logger.info('[Reconnection] No playerId, connecting as new player')
          await webrtcManagerRef.current!.initializeAsGuest(hostPeerId)
        }
        // If we get here without error, reconnection succeeded
        logger.info('[Reconnection] Successfully reconnected!')
        setIsReconnecting(false)
        setReconnectProgress(null)
      } catch (err) {
        logger.warn('[Reconnection] Reconnection attempt failed:', err)
        // Schedule next attempt
        setTimeout(attemptReconnect, retryInterval)
      }
    }

    // Start first attempt
    attemptReconnect()
  }, [isReconnecting, gameState, localPlayerId])

  const updateState = useCallback((newStateOrFn: GameState | ((prevState: GameState) => GameState)) => {
    setGameState((prevState) => {
      // Guard against undefined prevState
      if (!prevState) {
        logger.error('[updateState] prevState is undefined, skipping update')
        return prevState
      }

      // Compute the new state once, using prevState from React for consistency
      const newState = typeof newStateOrFn === 'function' ? newStateOrFn(prevState) : newStateOrFn

      // Guard against undefined newState
      if (!newState) {
        logger.error('[updateState] newState is undefined, skipping update')
        return prevState
      }

      // IMPORTANT: Don't send UPDATE_STATE until we've received the first server state after connection
      // EXCEPTION: Allow game creation (prevState.gameId is null, newState.gameId is set)
      // This prevents stale client state from overwriting fresh server state on reconnection
      // while still allowing new game creation
      const isCreatingNewGame = !prevState.gameId && newState.gameId
      if (!receivedServerStateRef.current && !isCreatingNewGame) {
        logger.debug('[updateState] Skipping UPDATE_STATE - waiting for server sync')
        return newState
      }

      // Use WebRTC for P2P communication if enabled
      if (webrtcEnabled && webrtcManagerRef.current) {
        if (webrtcIsHostRef.current) {
          // Host broadcasts full state to all guests (personalized for each)
          webrtcManagerRef.current.broadcastGameState(newState)
          logger.info(`[updateState] Host broadcast state: phase=${newState.currentPhase}, activePlayer=${newState.activePlayerId}`)

          // Save game state for auto-restore after F5 (host only)
          if (newState.gameId && localPlayerIdRef.current !== null) {
            try {
              saveWebrtcState({
                gameState: newState,
                localPlayerId: localPlayerIdRef.current,
                isHost: true
              })
              logger.debug('[updateState] Saved game state for host auto-restore')
            } catch (e) {
              logger.warn('[updateState] Failed to save game state:', e)
            }
          }
        } else {
          // Guest sends full state to host - host will merge and broadcast to all
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.sendStateToHost(newState, localPlayerIdRef.current)
            logger.info(`[updateState] Guest sent state to host: phase=${newState.currentPhase}, activePlayer=${newState.activePlayerId}`)
          }
        }
        return newState
      }

      // Send WebSocket message with the computed state (traditional mode)
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const payload: { type: string; gameState: GameState; playerToken?: string } = {
          type: 'UPDATE_STATE',
          gameState: newState
        }
        // Include playerToken for reconnection if available
        if (playerTokenRef.current) {
          payload.playerToken = playerTokenRef.current
        }
        ws.current.send(JSON.stringify(payload))
      }

      return newState
    })
  }, [webrtcEnabled, webrtcIsHost, broadcastWebrtcState])

  // Game settings hook - handles game configuration functions
  const gameSettings = useGameSettings({
    ws,
    webrtcManager: webrtcManagerRef,
    gameStateRef,
    webrtcIsHostRef,
    setGameState,
    updateState,
  })

  // Ready check hook - handles ready check functions
  const readyCheck = useReadyCheck({
    ws,
    webrtcManager: webrtcManagerRef,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    setGameState,
  })

  // Player actions hook - handles simple player operations
  const playerActions = usePlayerActions({
    updateState,
    sendWebrtcAction,
    webrtcIsHostRef,
    webrtcManagerRef,
  })

  // Card operations hook - handles card drawing, shuffling, flipping
  const cardOperations = useCardOperations({
    ws,
    webrtcManager: webrtcManagerRef,
    gameStateRef,
    localPlayerIdRef,
    webrtcIsHostRef,
    updateState,
  })

  // Card status hook - handles adding/removing statuses from cards
  const cardStatus = useCardStatus({
    localPlayerIdRef,
    updateState,
  })

  // Destructure card status functions for direct access
  const {
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    modifyBoardCardPower,
    addAnnouncedCardStatus,
    removeAnnouncedCardStatus,
    modifyAnnouncedCardPower,
    addHandCardStatus,
    removeHandCardStatus,
    revealHandCard,
    revealBoardCard,
    requestCardReveal,
    respondToRevealRequest,
    removeRevealedStatus,
  } = cardStatus

  // Deck management hook - handles deck operations
  const deckManagement = useDeckManagement({
    webrtcIsHostRef,
    sendWebrtcAction,
    webrtcManagerRef,
    localPlayerIdRef,
    getCardDefinition,
    commandCardIds,
    createDeck,
    updateState,
  })

  // Destructure deck management functions for direct access
  const {
    changePlayerDeck,
    loadCustomDeck,
    resurrectDiscardedCard,
    reorderTopDeck,
    reorderCards,
    recoverDiscardedCard,
  } = deckManagement

  // Phase management hook - handles phase and round management
  const phaseManagement = usePhaseManagement({
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
  })

  // Destructure phase management functions for direct access
  const {
    toggleActivePlayer,
    toggleAutoDraw,
    setPhase,
    nextPhase,
    prevPhase,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
  } = phaseManagement

  // ... WebSocket logic (connectWebSocket, forceReconnect, joinGame, etc.) kept as is ...
  const connectWebSocket = useCallback(() => {
    // Skip WebSocket connection in WebRTC P2P mode
    if (localStorage.getItem('webrtc_enabled') === 'true') {
      logger.info('WebRTC P2P mode enabled - skipping WebSocket connection')
      setConnectionStatus('Connected') // Set as "connected" for UI purposes
      return
    }

    if (isManualExitRef.current) {
      return
    }
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    const WS_URL = getWebSocketURL()

    // GUARD: If no URL is configured, stop trying to connect.
    if (!WS_URL) {
      logger.warn('No WebSocket URL configured in settings. Waiting for user input.')
      setConnectionStatus('Disconnected')
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      return
    }

    try {
      ws.current = new WebSocket(WS_URL)
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      setConnectionStatus('Disconnected')
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, TIMING.RECONNECT_DELAY)
      return
    }
    setConnectionStatus('Connecting')

    ws.current.onopen = () => {
      // Reset the server state sync flag - we haven't received server state yet on this connection
      receivedServerStateRef.current = false

      logger.info('WebSocket connection established')
      setConnectionStatus('Connected')

      // Save the active WebSocket URL for link sharing
      const customUrl = localStorage.getItem('custom_ws_url')
      if (customUrl && customUrl.trim() !== '') {
        localStorage.setItem('websocket_url', customUrl.trim())
      }

      const currentGameState = gameStateRef.current
      logger.info('Current gameState on open:', currentGameState ? `gameId=${currentGameState.gameId}` : 'null')
      logger.info('playerTokenRef.current on open:', playerTokenRef.current ? 'YES' : 'NO')

      // Only send JOIN_GAME if we have an active game
      // Don't send GET_GAMES_LIST on connect - it causes issues with tunnel connections (ngrok/cloudflared)
      if (currentGameState && currentGameState.gameId && ws.current?.readyState === WebSocket.OPEN) {
        let playerToken = playerTokenRef.current  // Use playerTokenRef first (restored from state)

        // If no token in ref, try to find it from RECONNECTION_DATA_KEY or from gameState players
        if (!playerToken) {
          // Try RECONNECTION_DATA_KEY first
          try {
            const stored = localStorage.getItem(RECONNECTION_DATA_KEY)
            if (stored) {
              const data = JSON.parse(stored)
              logger.info('RECONNECTION_DATA_KEY:', data?.gameId, currentGameState.gameId)
              if (data?.playerToken) {
                playerToken = data.playerToken
                playerTokenRef.current = playerToken
                logger.info('Using playerToken from RECONNECTION_DATA_KEY')
              }
            }
          } catch (e) {
            console.warn('Failed to parse reconnection data:', e instanceof Error ? e.message : String(e))
          }

          // If still no token, try to get it from the player in gameState
          if (!playerToken && currentGameState.players && localPlayerIdRef.current) {
            const localPlayer = currentGameState.players.find((p: Player) => p.id === localPlayerIdRef.current)
            if (localPlayer?.playerToken) {
              playerToken = localPlayer.playerToken
              playerTokenRef.current = playerToken
              logger.info('Using playerToken from gameState player')
            }
          }
        }

        logger.info('JoinGame: Sending reconnection with token:', playerToken ? 'YES' : 'NO', 'gameId:', currentGameState.gameId)
        ws.current.send(JSON.stringify({
          type: 'JOIN_GAME',
          gameId: currentGameState.gameId,
          playerToken: playerToken,
        }))
        // Note: Deck data will be sent after JOIN_SUCCESS confirmation if player is host
      }
      // If no active game, just wait - don't send any message (matches old working version)
    }
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'GAMES_LIST') {
          setGamesList(data.games)
        } else if (data.type === 'JOIN_SUCCESS') {
          // Handle spectator mode
          if (data.isSpectator) {
            setLocalPlayerId(null)
            logger.info('Joined as spectator:', data.message || 'Spectator mode')
            joiningGameIdRef.current = null
            return
          }

          // Regular player join
          setLocalPlayerId(data.playerId)
          const gameId = joiningGameIdRef.current || gameStateRef.current.gameId
          if (gameId && data.playerId !== null && data.playerToken) {
            // Save player token for reconnection
            playerTokenRef.current = data.playerToken
            // Always save both RECONNECTION_DATA_KEY and try to save full game state
            localStorage.setItem(RECONNECTION_DATA_KEY, JSON.stringify({
              gameId,
              playerId: data.playerId,
              playerToken: data.playerToken,
              timestamp: Date.now(),
            }))
            // Save full game state if we have a matching game state
            if (gameStateRef.current.gameId === gameId) {
              saveGameState(gameStateRef.current, data.playerId, data.playerToken)
            }
          } else if (data.playerId === null) {
            clearGameState()
            playerTokenRef.current = undefined
          }
          joiningGameIdRef.current = null
          if (data.playerId === 1) {
            setTimeout(() => {
              if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
              }
            }, TIMING.DECK_SYNC_DELAY)
          }
        } else if (data.type === 'CONNECTION_ESTABLISHED') {
          // Server acknowledging connection - no action needed
          logger.info('Connection acknowledged by server')

          // Check for pending invite join
          const pendingInviteGame = sessionStorage.getItem('pending_invite_game')
          const pendingInviteName = sessionStorage.getItem('pending_invite_name')
          if (pendingInviteGame && ws.current) {
            sessionStorage.removeItem('pending_invite_game')
            sessionStorage.removeItem('pending_invite_name')
            logger.info('Auto-joining invite game:', pendingInviteGame)
            ws.current.send(JSON.stringify({
              type: 'JOIN_AS_INVITE',
              gameId: pendingInviteGame,
              playerName: pendingInviteName || 'Player'
            }))
          }
        } else if (data.type === 'DECK_DATA_UPDATED') {
          // Deck data synced with server - no action needed
          logger.info('Deck data synced with server')
        } else if (data.type === 'ERROR') {
          if (data.message.includes('not found') || data.message.includes('Dummy')) {
            // Game not found - clear state and return to menu
            logger.info('Game not found error - clearing state')
            const newState = createInitialState()
            setGameState(newState)
            gameStateRef.current = newState
            setLocalPlayerId(null)
            clearGameState()
            joiningGameIdRef.current = null
          } else if (data.message.includes('already started') && isJoinAttemptRef.current) {
            // Game already started - show alert ONLY when user tries to join via Join Game modal
            // Skip this error for automatic reconnection (F5, reconnect, etc.)
            logger.info('Game already started - showing alert and returning to menu')
            alert('This game has already started.')
            const newState = createInitialState()
            setGameState(newState)
            gameStateRef.current = newState
            setLocalPlayerId(null)
            clearGameState()
            joiningGameIdRef.current = null
            isJoinAttemptRef.current = false
          } else {
            console.warn('Server Error:', data.message)
          }
        } else if (data.type === 'HIGHLIGHT_TRIGGERED') {
          setLatestHighlight(data.highlightData)
        } else if (data.type === 'NO_TARGET_TRIGGERED') {
          setLatestNoTarget({ coords: data.coords, timestamp: data.timestamp })
        } else if (data.type === 'DECK_SELECTION_TRIGGERED') {
          setLatestDeckSelections(prev => [...prev, data.deckSelectionData])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== data.deckSelectionData.timestamp))
          }, 1000)
        } else if (data.type === 'HAND_CARD_SELECTION_TRIGGERED') {
          setLatestHandCardSelections(prev => [...prev, data.handCardSelectionData])
          // Auto-remove after 1 second
          setTimeout(() => {
            setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== data.handCardSelectionData.timestamp))
          }, 1000)
        } else if (data.type === 'FLOATING_TEXT_TRIGGERED') {
          // Add floating text to gameState for all players to see
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, data.floatingTextData].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        } else if (data.type === 'FLOATING_TEXT_BATCH_TRIGGERED') {
          // Add multiple floating texts to gameState
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, ...data.batch].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        } else if (data.type === 'SYNC_VALID_TARGETS') {
          // Receive valid targets from other players
          // Ignore targets from ourselves to avoid overwriting our local state
          if (data.playerId !== localPlayerIdRef.current) {
            setRemoteValidTargets({
              playerId: data.playerId,
              validHandTargets: data.validHandTargets || [],
              isDeckSelectable: data.isDeckSelectable || false,
            })
            // Auto-clear after 10 seconds to prevent stale data
            setTimeout(() => {
              setRemoteValidTargets(prev => prev?.playerId === data.playerId ? null : prev)
            }, 10000)
          }
        } else if (data.type === 'TARGET_SELECTION_TRIGGERED') {
          // Target selection effect (white ripple animation)
          // Only apply if sent by another player (ignore echoes of our own messages)
          if (data.effect && data.playerId !== localPlayerIdRef.current) {
            setTargetSelectionEffects(prev => [...prev, data.effect])
            // Auto-remove after 1 second
            setTimeout(() => {
              setTargetSelectionEffects(prev => prev.filter(e => e.timestamp !== data.effect.timestamp))
            }, 1000)
          }
        } else if (data.type === 'TARGETING_MODE_SET') {
          // Receive targeting mode from any player (including ourselves for confirmation)
          const targetingMode = data.targetingMode
          if (targetingMode) {
            setGameState(prev => ({
              ...prev,
              targetingMode: targetingMode,
            }))
            gameStateRef.current.targetingMode = targetingMode
            logger.info('[TargetingMode] Received targeting mode from server', {
              playerId: targetingMode.playerId,
              mode: targetingMode.action.mode,
            })
          }
        } else if (data.type === 'TARGETING_MODE_CLEARED') {
          // Clear targeting mode for all clients
          setGameState(prev => ({
            ...prev,
            targetingMode: null,
          }))
          gameStateRef.current.targetingMode = null
          logger.debug('[TargetingMode] Cleared targeting mode from server')
        } else if (data.type === 'ABILITY_MODE_SET') {
          // Host broadcasts ability mode to all clients
          // All clients show the same visual effects for the ability
          if (data.abilityMode) {
            setGameState(prev => ({
              ...prev,
              abilityMode: data.abilityMode,
            }))
            logger.info('[AbilityMode] Received ability mode from host', {
              playerId: data.abilityMode.playerId,
              mode: data.abilityMode.mode,
              sourceCard: data.abilityMode.sourceCardName,
            })
          }
        } else if (data.type === 'ABILITY_TARGET_SELECTED') {
          // Target selected notification
          logger.info('[Ability] Target selected', data.data)
        } else if (data.type === 'ABILITY_COMPLETED') {
          // Ability completed - clear mode
          setGameState(prev => ({
            ...prev,
            abilityMode: null,
          }))
          logger.info('[Ability] Ability completed', data.data)
        } else if (data.type === 'ABILITY_CANCELLED') {
          // Ability cancelled - clear mode
          setGameState(prev => ({
            ...prev,
            abilityMode: null,
          }))
          logger.info('[Ability] Ability cancelled')
        } else if (data.type === 'GAME_RESET') {
          // Handle compact game reset message (much smaller than full gameState)
          logger.info('[GameReset] Received GAME_RESET message from server')
          setGameState(prev => {
            // Create fresh board with correct grid size
            const gridSize: number = (data.activeGridSize as unknown as number) || 8;
            const newBoard: Board = []
            for (let i = 0; i < gridSize; i++) {
              const row: any[] = []
              for (let j = 0; j < gridSize; j++) {
                row.push({ card: null })
              }
              newBoard.push(row)
            }

            const resetState = {
              ...prev,
              players: data.players || [],
              gameMode: data.gameMode,
              isPrivate: data.isPrivate,
              activeGridSize: data.activeGridSize,
              dummyPlayerCount: data.dummyPlayerCount,
              autoAbilitiesEnabled: data.autoAbilitiesEnabled,
              isGameStarted: data.isGameStarted,
              currentPhase: data.currentPhase,
              currentRound: data.currentRound,
              turnNumber: data.turnNumber,
              activePlayerId: data.activePlayerId,
              startingPlayerId: data.startingPlayerId,
              roundWinners: data.roundWinners || {},
              gameWinner: data.gameWinner,
              isRoundEndModalOpen: data.isRoundEndModalOpen,
              isReadyCheckActive: data.isReadyCheckActive,
              // Use new board with correct grid size
              board: newBoard,
              // Clear other state
              targetingMode: null,
              floatingTexts: [],
            }
            gameStateRef.current = resetState
            return resetState
          })
        } else if (!data.type && data.players && data.board) {
          // Only update gameState if it's a valid game state (no type, but has required properties)
          // Sync card images from database (important for tokens after reconnection)
          const syncedData = syncGameStateImages(data)

          // IMPORTANT: Prevent phase flicker by validating phase transitions
          // Only ignore delayed updates if we're NOT in scoring step OR if this is a forced sync
          const currentState = gameStateRef.current
          if (!currentState.isScoringStep && syncedData.isScoringStep && syncedData.currentPhase !== 2) {
            // Incoming scoring state but we're not in commit phase - likely old state
            logger.debug('Ignoring delayed scoring state update')
            return
          }

          // Clear isScoringStep when server broadcasts state with different phase or different active player
          // This ensures that after turn passing (server-side), the client exits scoring mode
          // Also clear if server has moved past Scoring phase (4) to Setup (1) or later
          const shouldClearScoringStep = currentState.isScoringStep && (
            syncedData.currentPhase !== currentState.currentPhase ||
            syncedData.activePlayerId !== currentState.activePlayerId ||
            syncedData.currentPhase !== 4  // Server has moved past Scoring phase
          )
          if (shouldClearScoringStep) {
            syncedData.isScoringStep = false
          }

          setGameState(syncedData)
          gameStateRef.current = syncedData

          // Auto-save game state when receiving updates from server
          if (localPlayerIdRef.current !== null && syncedData.gameId) {
            // Get player token from reconnection_data or from the player in gameState
            let playerToken = undefined
            try {
              const stored = localStorage.getItem(RECONNECTION_DATA_KEY)
              if (stored) {
                const parsed = JSON.parse(stored)
                playerToken = parsed.playerToken
              }
            } catch (e) { /* ignore */ }

            // Also try to get token from current player in gameState
            if (!playerToken && syncedData.players) {
              const localPlayer = syncedData.players.find((p: Player) => p.id === localPlayerIdRef.current)
              if (localPlayer?.playerToken) {
                playerToken = localPlayer.playerToken
                // Update playerTokenRef if we found it in gameState
                playerTokenRef.current = playerToken
              }
            }

            saveGameState(syncedData, localPlayerIdRef.current, playerToken)
          }
        } else {
          // Log the actual message type and all keys in data for debugging
          console.warn('Unknown message type:', data.type, 'keys:', Object.keys(data), 'data:', data)
        }
      } catch (error) {
        console.error('Failed to parse message from server:', event.data, error)
      }
    }
    ws.current.onclose = () => {
      logger.info('WebSocket connection closed')
      setConnectionStatus('Disconnected')

      if (!isManualExitRef.current) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, TIMING.RECONNECT_DELAY)
      }
    }
    ws.current.onerror = (event) => console.error('WebSocket error event:', event)
  }, [setGameState, createInitialState])

  // Join as invite - automatically joins as new player or spectator
  const joinAsInvite = useCallback((gameId: string, playerName: string = 'Player'): void => {
    isManualExitRef.current = false
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'JOIN_AS_INVITE',
        gameId,
        playerName
      }))
    } else {
      // Store for after connection
      sessionStorage.setItem('pending_invite_game', gameId)
      sessionStorage.setItem('pending_invite_name', playerName)
      connectWebSocket()
    }
  }, [connectWebSocket])

  useEffect(() => {
    isManualExitRef.current = false

    // Check if there's an invite link in sessionStorage - if so, skip state restoration
    // This ensures invite joins work correctly even if the browser has saved state from a previous game
    const hasInviteLink = sessionStorage.getItem('invite_game_id')
    const hasInviteHostId = sessionStorage.getItem('invite_host_id')

    if (hasInviteLink && !hasInviteHostId) {
      // Only use WebSocket for legacy invites without hostId
      // WebRTC invites use hostId parameter instead
      logger.info('[inviteLinks] Legacy invite link detected, using WebSocket (will be deprecated)')
      connectWebSocket()
      return () => {
        isManualExitRef.current = true
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        if (ws.current) {
          ws.current.onclose = null
          ws.current.close()
        }
      }
    }

    if (hasInviteLink && hasInviteHostId) {
      // WebRTC invite - skip WebSocket, let App.tsx handle WebRTC connection
      logger.info('[inviteLinks] WebRTC invite link detected, skipping WebSocket connection')
      return () => {
        isManualExitRef.current = true
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        if (ws.current) {
          ws.current.onclose = null
          ws.current.close()
        }
      }
    }

    // Check navigation type to determine if we should restore state
    // PerformanceNavigationTiming.type values:
    // 0 = TYPE_NAVIGATE - normal navigation (restore state)
    // 1 = TYPE_RELOAD - normal reload/F5 (restore state)
    // 2 = TYPE_BACK_FORWARD - back/forward button (restore state)
    // For hard reload (Shift+F5, Ctrl+Shift+R), we need to detect differently
    const navigationEntries = performance.getEntriesByType('navigation')
    const navEntry = navigationEntries.length > 0 ? navigationEntries[0] as PerformanceNavigationTiming : null
    const navigationType = navEntry?.type ?? 0

    // Check if this is a hard reload (Shift+F5 or Ctrl+Shift+R)
    // Unfortunately, browser APIs don't provide a reliable way to distinguish
    // F5 from Shift+F5. Both return type=1 (reload).
    // We'll always restore on reload - user can clear data manually if needed.

    // Try to restore state for normal navigation/reload
    // Note: Shift+F5 and Ctrl+Shift+R clear localStorage in some browsers when clearing cache
    // but when they don't, we rely on user manually clearing if needed
    const savedState = loadGameState()

    if (savedState) {
      logger.info(`Restoring saved game state (nav type: ${navigationType}):`, savedState.gameState.gameId)
      setGameState(savedState.gameState)
      setLocalPlayerId(savedState.localPlayerId)
      gameStateRef.current = savedState.gameState
      localPlayerIdRef.current = savedState.localPlayerId
      playerTokenRef.current = savedState.playerToken
    } else {
      // No saved state - first load or cache/data was cleared
      logger.info('No saved game state, starting fresh')
    }

    connectWebSocket()
    return () => {
      isManualExitRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (ws.current) {
        ws.current.onclose = null
        ws.current.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run only once on mount

  // Sync card images after rawJsonData is loaded
  // This fixes token images after page refresh
  useEffect(() => {
    if (rawJsonData && gameStateRef.current && gameStateRef.current.gameId) {
      const synced = syncGameStateImages(gameStateRef.current)
      // Only update if something actually changed
      if (synced !== gameStateRef.current) {
        setGameState(synced)
        gameStateRef.current = synced
      }
    }
  }, [])

  // Poll for rawJsonData to be loaded and sync images
  // This is needed because rawJsonData is loaded asynchronously in App.tsx
  useEffect(() => {
    if (contentLoaded) {return} // Already loaded

    const checkInterval = setInterval(() => {
      if (rawJsonData && gameStateRef.current && gameStateRef.current.gameId) {
        const synced = syncGameStateImages(gameStateRef.current)
        setGameState({ ...synced }) // Force re-render
        gameStateRef.current = synced
        setContentLoaded(true)
        clearInterval(checkInterval)
      }
    }, 100) // Check every 100ms

    return () => clearInterval(checkInterval)
  }, [contentLoaded])

  // Ready check functions from useReadyCheck hook
  const {
    startReadyCheck,
    cancelReadyCheck,
    playerReady,
  } = readyCheck

  // Player actions from usePlayerActions hook
  const {
    updatePlayerName,
    changePlayerColor,
  } = playerActions

  // Card operations from useCardOperations hook
  const {
    drawCard,
    drawCardsBatch,
    shufflePlayerDeck,
    flipBoardCard,
    flipBoardCardFaceDown,
  } = cardOperations

  // Game settings functions from useGameSettings hook
  const {
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    setDummyPlayerCount,
  } = gameSettings

  const syncGame = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId && localPlayerIdRef.current === 1) {
      ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
      const currentState = gameStateRef.current
      const refreshedState = deepCloneState(currentState)
      refreshedState.players.forEach((p: Player) => {
        const piles: Array<keyof Pick<Player, 'hand' | 'deck' | 'discard'>> = ['hand', 'deck', 'discard']
        piles.forEach(pile => {
          if (p[pile]) {
            p[pile] = p[pile].map(c => {
              const def = getCardDefinitionByName(c.name)
              return def ? { ...c, ...def } : c
            })
          }
        })
        if (p.announcedCard) {
          const def = getCardDefinitionByName(p.announcedCard.name)
          if (def) {
            p.announcedCard = { ...p.announcedCard, ...def }
          }
        }
      })
      refreshedState.board.forEach((row: any[]) => {
        row.forEach(cell => {
          if (cell.card) {
            const def = getCardDefinitionByName(cell.card.name)
            if (def) {
              cell.card = { ...cell.card, ...def }
            }
          }
        })
      })
      ws.current.send(JSON.stringify({ type: 'FORCE_SYNC', gameState: refreshedState }))
      setGameState(refreshedState)
    }
  }, [])

  const updatePlayerScore = useCallback((playerId: number, delta: number) => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      logger.warn('[ScoreUpdate] Blocked: game not started')
      return
    }
    if (currentState.isRoundEndModalOpen) {
      logger.warn('[ScoreUpdate] Blocked: round end modal is open')
      return
    }
    if (delta === 0) {
      return
    }

    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // IMMEDIATE local update for UI responsiveness
    // In WebRTC mode, use updateState to broadcast delta
    // In WebSocket mode, use setGameState for local optimistic update
    if (isWebRTCMode) {
      updateState(prev => ({
        ...prev,
        players: prev.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + delta) }
            : p
        ),
      }))
    } else {
      // WebSocket mode: local optimistic update
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + delta) }
            : p
        ),
      }))
    }

    // For WebSocket mode, accumulate and send to server
    if (!isWebRTCMode) {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        logger.warn('[ScoreUpdate] Blocked: WebSocket not open')
        return
      }

      const existing = scoreDeltaAccumulator.get(playerId)
      if (existing) {
        // Clear existing timer and accumulate delta
        clearTimeout(existing.timerId)
        const newDelta = existing.delta + delta
        const timerId = setTimeout(() => {
          const accumulated = scoreDeltaAccumulator.get(playerId)
          if (accumulated && ws.current?.readyState === WebSocket.OPEN) {
            logger.info(`[ScoreUpdate] Sending accumulated delta: player=${playerId}, delta=${accumulated.delta}`)
            ws.current.send(JSON.stringify({
              type: 'UPDATE_PLAYER_SCORE',
              gameId: gameStateRef.current.gameId,
              playerId: playerId,
              delta: accumulated.delta
            }))
          }
          scoreDeltaAccumulator.delete(playerId)
        }, 500)
        scoreDeltaAccumulator.set(playerId, { delta: newDelta, timerId })
      } else {
        // Start new accumulation
        const timerId = setTimeout(() => {
          const accumulated = scoreDeltaAccumulator.get(playerId)
          if (accumulated && ws.current?.readyState === WebSocket.OPEN) {
            logger.info(`[ScoreUpdate] Sending delta: player=${playerId}, delta=${accumulated.delta}`)
            ws.current.send(JSON.stringify({
              type: 'UPDATE_PLAYER_SCORE',
              gameId: gameStateRef.current.gameId,
              playerId: playerId,
              delta: accumulated.delta
            }))
          }
          scoreDeltaAccumulator.delete(playerId)
        }, 500)
        scoreDeltaAccumulator.set(playerId, { delta, timerId })
      }
    }
  }, [setGameState, updateState])

  // Visual effects functions from useVisualEffects hook
  const {
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    syncValidTargets,
    triggerTargetSelection,
  } = visualEffects

  // Scoring hook - handles scoring functions
  const scoring = useScoring({
    ws,
    gameStateRef,
    updateState,
    updatePlayerScore,
    triggerFloatingText,
  })

  // Destructure scoring functions for direct access
  const {
    scoreLine,
    scoreDiagonal,
  } = scoring

  // Board manipulation hook - handles board/card manipulation functions
  const boardManipulation = useBoardManipulation({
    updateState,
    rawJsonData,
  })

  // Card movement hook - handles item movement between zones
  const cardMovement = useCardMovement({
    updateState,
    localPlayerIdRef,
    updatePlayerScore,
  })

  // Destructure card movement functions for direct access
  const {
    moveItem,
  } = cardMovement

  // Targeting mode hook - handles targeting mode activation and clearing
  const targetingMode = useTargetingMode({
    ws,
    webrtcManager: webrtcManagerRef,
    gameStateRef,
    webrtcIsHostRef,
    setGameState,
  })

  // Game lifecycle hook - handles game creation/joining/exiting
  const gameLifecycle = useGameLifecycle({
    ws,
    gameStateRef,
    localPlayerIdRef,
    isRestoringSessionRef,
    isManualExitRef,
    webrtcIsHostRef,
    receivedServerStateRef,
    joiningGameIdRef,
    setGameState,
    setLocalPlayerId,
    connectWebSocket,
    updateState,
  })

  // Destructure targeting mode functions for direct access
  const {
    setTargetingMode,
    clearTargetingMode,
  } = targetingMode

  // Destructure game lifecycle functions for direct access
  const {
    createGame,
    joinGame,
    exitGame,
    requestGamesList,
    forceReconnect,
  } = gameLifecycle

  return {
    gameState,
    localPlayerId,
    setLocalPlayerId,
    draggedItem,
    setDraggedItem,
    connectionStatus,
    gamesList,
    latestHighlight,
    latestFloatingTexts,
    latestNoTarget,
    latestDeckSelections,
    latestHandCardSelections,
    joinAsInvite,
    startReadyCheck,
    cancelReadyCheck,
    playerReady,
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    setDummyPlayerCount,
    updatePlayerName,
    changePlayerColor,
    updatePlayerScore,
    changePlayerDeck,
    loadCustomDeck,
    drawCard,
    drawCardsBatch,
    shufflePlayerDeck,
    moveItem,
    handleDrop: moveItem,  // Alias for backward compatibility
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    modifyBoardCardPower,
    addAnnouncedCardStatus,
    removeAnnouncedCardStatus,
    modifyAnnouncedCardPower,
    addHandCardStatus,
    removeHandCardStatus,
    flipBoardCard,
    flipBoardCardFaceDown,
    revealHandCard,
    revealBoardCard,
    requestCardReveal,
    respondToRevealRequest,
    syncGame,
    removeRevealedStatus,
    toggleActivePlayer,
    toggleAutoDraw,
    // Visual effects triggers
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerTargetSelection,
    // Visual effects state
    targetSelectionEffects,
    syncValidTargets,
    remoteValidTargets,
    setTargetingMode,
    clearTargetingMode,
    nextPhase,
    prevPhase,
    setPhase,
    markAbilityUsed: boardManipulation.markAbilityUsed,
    applyGlobalEffect: boardManipulation.applyGlobalEffect,
    swapCards: boardManipulation.swapCards,
    transferStatus: boardManipulation.transferStatus,
    transferAllCounters: boardManipulation.transferAllCounters,
    spawnToken: boardManipulation.spawnToken,
    resetDeployStatus: boardManipulation.resetDeployStatus,
    removeStatusByType: boardManipulation.removeStatusByType,
    recoverDiscardedCard,
    resurrectDiscardedCard,
    scoreLine,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
    scoreDiagonal,
    reorderTopDeck,
    reorderCards,
    updateState,
    // Deck viewing function
    requestDeckView,
    sendFullDeckToHost,
    // Game lifecycle functions
    createGame,
    joinGame,
    joinGameViaModal: joinGame, // Alias for backwards compatibility
    exitGame,
    requestGamesList,
    forceReconnect,
    // WebRTC P2P functions
    webrtcHostId,
    webrtcIsHost,
    initializeWebrtcHost,
    connectAsGuest,
    sendWebrtcAction,
    // Reconnection state
    isReconnecting,
    reconnectProgress,
  }
}

// Re-export types for convenience
export type { ConnectionStatus } from './core/types'
