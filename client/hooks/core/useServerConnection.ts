/**
 * useServerConnection - WebSocket connection management hook
 *
 * Extracted from useGameState.ts for separation of concerns.
 * Handles all WebSocket-related functionality:
 * - Connection management (connect, reconnect, disconnect)
 * - Message handling (incoming server messages)
 * - Game lifecycle via WebSocket (create, join, exit games)
 * - Visual effects from server broadcasts
 *
 * This hook does NOT include any WebRTC-related code.
 */

import { useCallback, useRef } from 'react'
import type { GameState, Player, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData, Board } from '../../types'
import { logger } from '../../utils/logger'
import { TIMING } from '../../utils/common'
import { rawJsonData } from '../../content'
import { getWebRTCEnabled } from '../useWebRTCEnabled'
import { getWebSocketURL } from './websocketHelpers'
import { syncGameStateImages, saveGameState, clearGameState, RECONNECTION_DATA_KEY } from './gameStateStorage'
import { createInitialState, generateGameId, createNewPlayer } from './gameCreators'
import type { ConnectionStatus } from './types'

/**
 * Props for the useServerConnection hook
 */
export interface UseServerConnectionProps {
  /** Reference to the current game state */
  gameStateRef: React.MutableRefObject<GameState>
  /** Reference to the local player ID */
  localPlayerIdRef: React.MutableRefObject<number | null>
  /** Function to update the game state */
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
  /** Function to set the local player ID */
  setLocalPlayerId: React.Dispatch<React.SetStateAction<number | null>>
  /** Function to set the connection status */
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>
  /** Function to set the games list */
  setGamesList: React.Dispatch<React.SetStateAction<{gameId: string, playerCount: number}[]>>
  /** Function to set the latest highlight */
  setLatestHighlight: React.Dispatch<React.SetStateAction<HighlightData | null>>
  /** Function to set the latest no-target overlay */
  setLatestNoTarget: React.Dispatch<React.SetStateAction<{coords: {row: number, col: number}, timestamp: number} | null>>
  /** Function to set the latest deck selections */
  setLatestDeckSelections: React.Dispatch<React.SetStateAction<DeckSelectionData[]>>
  /** Function to set the latest hand card selections */
  setLatestHandCardSelections: React.Dispatch<React.SetStateAction<HandCardSelectionData[]>>
  /** Function to set the click waves */
  setClickWaves: React.Dispatch<React.SetStateAction<any[]>>
  /** Function to set the latest floating texts */
  setLatestFloatingTexts: React.Dispatch<React.SetStateAction<FloatingTextData[] | null>>
  /** Function to set the remote valid targets */
  setRemoteValidTargets: React.Dispatch<React.SetStateAction<{
    playerId: number
    validHandTargets: { playerId: number, cardIndex: number }[]
    isDeckSelectable: boolean
  } | null>>
  /** Reference to track if user is manually exiting */
  isManualExitRef: React.MutableRefObject<boolean>
  /** Reference for tracking joining game ID */
  joiningGameIdRef: React.MutableRefObject<string | null>
  /** Reference for tracking player token */
  playerTokenRef: React.MutableRefObject<string | undefined>
  /** Reference to track if server state was received */
  receivedServerStateRef: React.MutableRefObject<boolean>
  /** Reference to track if user is trying to join via modal */
  isJoinAttemptRef: React.MutableRefObject<boolean>
}

export function useServerConnection(props: UseServerConnectionProps) {
  const {
    gameStateRef,
    localPlayerIdRef,
    setGameState,
    setLocalPlayerId,
    setConnectionStatus,
    setGamesList,
    setLatestHighlight,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setLatestFloatingTexts,
    setRemoteValidTargets,
    isManualExitRef,
    joiningGameIdRef,
    playerTokenRef,
    receivedServerStateRef,
    isJoinAttemptRef,
  } = props

  // WebSocket reference
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  /**
   * Establish WebSocket connection to server
   * Handles reconnection logic and skips connection in WebRTC P2P mode
   */
  const connectWebSocket = useCallback(() => {
    // Skip WebSocket connection in WebRTC P2P mode
    if (getWebRTCEnabled()) {
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
      logger.error('Failed to create WebSocket:', error)
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
        } else if (data.type === 'CLICK_WAVE_TRIGGERED') {
          // Click wave effect (colored ripple animation)
          // Only apply if sent by another player (ignore echoes of our own messages)
          if (data.wave && data.wave.clickedByPlayerId !== localPlayerIdRef.current) {
            setClickWaves(prev => [...prev, data.wave])
            // Auto-remove after 600ms (animation duration)
            setTimeout(() => {
              setClickWaves(prev => prev.filter(w => w.timestamp !== data.wave.timestamp))
            }, 600)
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
            // Support both old format (with action) and new format (with mode directly)
            const mode = targetingMode.mode || targetingMode.action?.mode
            logger.info('[TargetingMode] Received targeting mode from server', {
              playerId: targetingMode.playerId,
              mode: mode,
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
            abilityMode: undefined,
          }))
          logger.info('[Ability] Ability completed', data.data)
        } else if (data.type === 'ABILITY_CANCELLED') {
          // Ability cancelled - clear mode
          setGameState(prev => ({
            ...prev,
            abilityMode: undefined,
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
        logger.error('Failed to parse message from server:', event.data, error)
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

    ws.current.onerror = (event) => logger.error('WebSocket error event:', event)
  }, [
    setGameState,
    setConnectionStatus,
    setGamesList,
    setLatestHighlight,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setLatestFloatingTexts,
    setRemoteValidTargets,
    setLocalPlayerId,
    createInitialState,
    isManualExitRef,
    gameStateRef,
    localPlayerIdRef,
    playerTokenRef,
    receivedServerStateRef,
    joiningGameIdRef,
  ])

  /**
   * Force reconnection to WebSocket server
   * Closes existing connection if open, or triggers new connection
   */
  const forceReconnect = useCallback(() => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      ws.current.close()
    } else {
      // If the socket was not open (e.g. initially missing URL), we must trigger connection manually.
      connectWebSocket()
    }
  }, [ws, connectWebSocket])

  /**
   * Join an existing game by ID
   * Handles reconnection with playerToken if available
   */
  const joinGame = useCallback((gameId: string): void => {
    isManualExitRef.current = false
    if (ws.current?.readyState === WebSocket.OPEN) {
      joiningGameIdRef.current = gameId
      let reconnectionData = null
      try {
        const storedData = localStorage.getItem(RECONNECTION_DATA_KEY)
        if (storedData) {
          reconnectionData = JSON.parse(storedData)
        }
      } catch (e) {
        clearGameState()
      }
      const payload: { type: string; gameId: string; playerToken?: string } = { type: 'JOIN_GAME', gameId }
      if (reconnectionData?.gameId === gameId && reconnectionData.playerToken) {
        payload.playerToken = reconnectionData.playerToken
        logger.info(`JoinGame: Sending reconnection with token ${reconnectionData.playerToken.substring(0, 8)}... for player ${reconnectionData.playerId}`)
      } else {
        logger.info(`JoinGame: No reconnection data or gameId mismatch. storedGameId=${reconnectionData?.gameId}, requestedGameId=${gameId}`)
      }
      ws.current.send(JSON.stringify(payload))
    } else {
      connectWebSocket()
      joiningGameIdRef.current = gameId
    }
  }, [ws, isManualExitRef, joiningGameIdRef, connectWebSocket])

  /**
   * Join as invite - automatically joins as new player or spectator
   */
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

  /**
   * Create a new game
   * Generates unique game ID and returns initial game data
   * The parent component is responsible for calling updateState with this data
   */
  const createGame = useCallback((): { gameId: string; initialState: GameState } => {
    isManualExitRef.current = false
    clearGameState()
    const newGameId = generateGameId()
    const initialState = {
      ...createInitialState(),
      gameId: newGameId,
      players: [createNewPlayer(1)],
    }
    // Mark that we're creating a new game - client is the authority here
    receivedServerStateRef.current = true

    // Send messages to server after a delay
    setTimeout(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: newGameId }))
        ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
      }
    }, TIMING.DECK_SYNC_DELAY)

    return { gameId: newGameId, initialState }
  }, [isManualExitRef, receivedServerStateRef])

  /**
   * Request the list of available games from the server
   */
  const requestGamesList = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'GET_GAMES_LIST' }))
    }
  }, [ws])

  /**
   * Exit the current game
   * Clears state, notifies server, closes connection, and reconnects
   */
  const exitGame = useCallback((
    isRestoringSessionRef: React.MutableRefObject<boolean>,
    webrtcIsHostRef: React.MutableRefObject<boolean>,
    clearHostPeerIdBroadcast: (gameId: string) => void,
    clearWebrtcData: () => void,
  ) => {
    // Don't exit if we're in the middle of restoring a session
    if (isRestoringSessionRef.current) {
      logger.info('[exitGame] Skipping exit during session restoration')
      return
    }

    isManualExitRef.current = true
    const gameIdToLeave = gameStateRef.current.gameId
    const playerIdToLeave = localPlayerIdRef.current

    // Clear host peerId broadcast if we're the host
    if (gameIdToLeave && webrtcIsHostRef.current) {
      clearHostPeerIdBroadcast(gameIdToLeave)
    }

    // Clear WebRTC persistence data on manual exit
    try {
      clearWebrtcData()
      // Clear the auto-restore flag so page reload can start fresh
      sessionStorage.removeItem('webrtc_auto_restore_attempted')
      logger.info('[exitGame] Cleared WebRTC persistence data')
    } catch (e) {
      logger.warn('[exitGame] Failed to clear WebRTC data:', e)
    }

    setGameState(createInitialState())
    setLocalPlayerId(null)
    clearGameState()

    if (ws.current) {
      ws.current.onclose = null
    }

    if (ws.current?.readyState === WebSocket.OPEN && gameIdToLeave && playerIdToLeave !== null) {
      ws.current.send(JSON.stringify({ type: 'EXIT_GAME', gameId: gameIdToLeave, playerId: playerIdToLeave }))
    }

    if (ws.current) {
      ws.current.close()
    }

    setTimeout(() => {
      isManualExitRef.current = false
      connectWebSocket()
    }, TIMING.RECONNECT_DELAY)
  }, [
    gameStateRef,
    localPlayerIdRef,
    isManualExitRef,
    setGameState,
    setLocalPlayerId,
    ws,
    connectWebSocket,
  ])

  return {
    ws,
    reconnectTimeoutRef,
    connectWebSocket,
    forceReconnect,
    createGame,
    joinGame,
    joinAsInvite,
    exitGame,
    requestGamesList,
  }
}
