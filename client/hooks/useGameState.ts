// ... existing imports
import { useState, useEffect, useCallback, useRef } from 'react'
import { DeckType, GameMode as GameModeEnum } from '../types'
import type { GameState, Player, Board, GridSize, Card, DragItem, DropTarget, PlayerColor, RevealRequest, CardIdentifier, CustomDeckFile, HighlightData, FloatingTextData } from '../types'
import { shuffleDeck, PLAYER_COLOR_NAMES, TURN_PHASES, MAX_PLAYERS } from '../constants'
import { decksData, countersDatabase, rawJsonData, getCardDefinitionByName, getCardDefinition, commandCardIds } from '../content'
import { createInitialBoard, recalculateBoardStatuses } from '@server/utils/boardUtils'
import { logger } from '../utils/logger'
import { initializeReadyStatuses, removeAllReadyStatuses, resetPhaseReadyStatuses } from '../utils/autoAbilities'

// Helper to determine the correct WebSocket URL
const getWebSocketURL = () => {
  const customUrl = localStorage.getItem('custom_ws_url')
  if (!customUrl || customUrl.trim() === '') {
    // No custom URL configured - user must set one in settings
    logger.warn('No custom WebSocket URL configured in settings.')
    return null
  }

  let url = customUrl.trim()
  // Remove trailing slash
  if (url.endsWith('/')) {
    url = url.slice(0, -1)
  }

  // Auto-correct protocol if user pasted http/https
  if (url.startsWith('https://')) {
    url = url.replace('https://', 'wss://')
  } else if (url.startsWith('http://')) {
    url = url.replace('http://', 'ws://')
  }

  // Ensure the URL has a valid WebSocket protocol
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    logger.warn('Invalid WebSocket URL format (must start with ws:// or wss://)')
    return null
  }

  logger.info(`Using custom WebSocket URL: ${url}`)
  return url
}

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected';
const generateGameId = () => Math.random().toString(36).substring(2, 18).toUpperCase()

const syncLastPlayed = (board: Board, player: Player) => {
  board.forEach(row => row.forEach(cell => {
    if (cell.card?.statuses) {
      cell.card.statuses = cell.card.statuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === player.id))
    }
  }))

  // Safety check for boardHistory existence
  if (!player.boardHistory) {
    player.boardHistory = []
  }

  let found = false
  while (player.boardHistory.length > 0 && !found) {
    const lastId = player.boardHistory[player.boardHistory.length - 1]
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c].card?.id === lastId) {
          const card = board[r][c].card
          if (!card) {
            continue
          }
          if (!card.statuses) {
            card.statuses = []
          }
          card.statuses.push({ type: 'LastPlayed', addedByPlayerId: player.id })
          found = true
          break
        }
      }
      if (found) {
        break
      }
    }
    if (!found) {
      player.boardHistory.pop()
    }
  }
}

// localStorage keys for game state persistence
const GAME_STATE_KEY = 'avalon_game_state'
const RECONNECTION_DATA_KEY = 'reconnection_data'

/**
 * Sync card data (imageUrl, fallbackImage) from database
 * This is needed after restoring from localStorage or receiving state from server
 */
const syncCardImages = (card: any): any => {
  if (!card || !rawJsonData) return card
  const { cardDatabase, tokenDatabase } = rawJsonData

  // Special handling for tokens
  if (card.deck === DeckType.Tokens || card.id?.startsWith('TKN_')) {
    // Try baseId first (most reliable)
    if (card.baseId && tokenDatabase[card.baseId]) {
      const dbCard = tokenDatabase[card.baseId]
      return { ...card, imageUrl: dbCard.imageUrl, fallbackImage: dbCard.fallbackImage }
    }
    // Try to find by name (fallback for tokens without proper baseId)
    const tokenKey = Object.keys(tokenDatabase).find(key => tokenDatabase[key].name === card.name)
    if (tokenKey) {
      const dbCard = tokenDatabase[tokenKey]
      return { ...card, imageUrl: dbCard.imageUrl, fallbackImage: dbCard.fallbackImage, baseId: tokenKey }
    }
  }
  // Regular cards
  else if (card.baseId && cardDatabase[card.baseId]) {
    const dbCard = cardDatabase[card.baseId]
    return { ...card, imageUrl: dbCard.imageUrl, fallbackImage: dbCard.fallbackImage }
  }
  return card
}

/**
 * Sync all card images in a game state with the current database
 */
const syncGameStateImages = (gameState: GameState): GameState => {
  if (!rawJsonData) return gameState

  // Sync all cards in the board
  const syncedBoard = gameState.board?.map(row =>
    row.map(cell => ({
      ...cell,
      card: cell.card ? syncCardImages(cell.card) : null
    }))
  ) || gameState.board

  // Sync all cards in players' hands, decks, discard
  const syncedPlayers = gameState.players?.map(player => ({
    ...player,
    hand: player.hand?.map(syncCardImages) || [],
    deck: player.deck?.map(syncCardImages) || [],
    discard: player.discard?.map(syncCardImages) || [],
    announcedCard: player.announcedCard ? syncCardImages(player.announcedCard) : null,
  })) || gameState.players

  return {
    ...gameState,
    board: syncedBoard,
    players: syncedPlayers
  }
}

// Save full game state to sessionStorage instead of localStorage
// sessionStorage persists on normal refresh (F5) but is cleared on tab close
// This allows game state restoration during normal play while clearing on hard refresh
const saveGameState = (gameState: GameState, localPlayerId: number | null, playerToken?: string) => {
  try {
    // Sync images before saving to ensure all cards have proper imageUrl
    const syncedState = syncGameStateImages(gameState)

    const data = {
      gameState: syncedState,
      localPlayerId,
      playerToken,
      timestamp: Date.now(),
    }
    // Use sessionStorage instead of localStorage - cleared on tab close, persists on refresh
    sessionStorage.setItem(GAME_STATE_KEY, JSON.stringify(data))
    // Set a flag in sessionStorage to indicate this was a normal save (not hard refresh)
    sessionStorage.setItem('game_state_valid', 'true')
    // Also update reconnection_data for backward compatibility (keep in localStorage for reconnect)
    if (syncedState.gameId && localPlayerId !== null) {
      localStorage.setItem(RECONNECTION_DATA_KEY, JSON.stringify({
        gameId: syncedState.gameId,
        playerId: localPlayerId,
        playerToken: playerToken || null,
        timestamp: Date.now(),
      }))
    }
  } catch (e) {
    console.warn('Failed to save game state:', e)
  }
}

// Load game state from sessionStorage
const loadGameState = (): { gameState: GameState; localPlayerId: number; playerToken?: string } | null => {
  try {
    // Check if this is a valid restore (not after hard refresh)
    // The flag is set when saving and cleared on hard refresh in some browsers
    const isValid = sessionStorage.getItem('game_state_valid')
    if (!isValid) {
      // Either no saved state or this is a hard refresh - don't restore
      return null
    }

    const stored = sessionStorage.getItem(GAME_STATE_KEY)
    if (!stored) return null
    const data = JSON.parse(stored)
    // Check if state is not too old (24 hours max)
    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - data.timestamp > maxAge) {
      sessionStorage.removeItem(GAME_STATE_KEY)
      sessionStorage.removeItem('game_state_valid')
      localStorage.removeItem(RECONNECTION_DATA_KEY)
      return null
    }

    const restoredState = data.gameState as GameState
    // Sync card images from database
    const syncedState = syncGameStateImages(restoredState)

    return { gameState: syncedState, localPlayerId: data.localPlayerId, playerToken: data.playerToken }
  } catch (e) {
    console.warn('Failed to load game state:', e)
    return null
  }
}

// Clear saved game state
const clearGameState = () => {
  sessionStorage.removeItem(GAME_STATE_KEY)
  sessionStorage.removeItem('game_state_valid')
  localStorage.removeItem(RECONNECTION_DATA_KEY)
}

export const useGameState = () => {
  // ... state initialization logic kept as is ...
  // Track when rawJsonData is loaded for syncing images
  const [contentLoaded, setContentLoaded] = useState(!!rawJsonData)

  const createDeck = useCallback((deckType: DeckType, playerId: number, playerName: string): Card[] => {
    const deck = decksData[deckType]
    if (!deck) {
      console.error(`Deck data for ${deckType} not loaded! Returning empty deck.`)
      return []
    }
    const deckWithOwner = [...deck].map(card => ({ ...card, ownerId: playerId, ownerName: playerName }))
    return shuffleDeck(deckWithOwner)
  }, [])

  const createNewPlayer = useCallback((id: number, isDummy = false): Player => {
    const initialDeckType = Object.keys(decksData)[0] as DeckType
    const player = {
      id,
      name: isDummy ? `Dummy ${id - 1}` : `Player ${id}`,
      score: 0,
      hand: [],
      deck: [] as Card[],
      discard: [],
      announcedCard: null,
      selectedDeck: initialDeckType,
      color: PLAYER_COLOR_NAMES[id - 1] || 'blue',
      isDummy,
      isReady: false,
      boardHistory: [],
      autoDrawEnabled: true, // Auto-draw is enabled by default for all players
    }
    player.deck = createDeck(initialDeckType, id, player.name)
    return player
  }, [createDeck])

  const createInitialState = useCallback((): GameState => ({
    players: [],
    board: createInitialBoard(),
    activeGridSize: 7,
    gameId: null,
    dummyPlayerCount: 0,
    isGameStarted: false,
    gameMode: GameModeEnum.FreeForAll,
    isPrivate: true,
    isReadyCheckActive: false,
    revealRequests: [],
    activePlayerId: null, // Aligned with server default (null)
    startingPlayerId: null, // Aligned with server default (null)
    currentPhase: 0,
    isScoringStep: false,
    preserveDeployAbilities: false,
    autoAbilitiesEnabled: true, // Match server default
    autoDrawEnabled: true, // Match server default
    currentRound: 1,
    turnNumber: 1,
    roundEndTriggered: false,
    roundWinners: {},
    gameWinner: null,
    isRoundEndModalOpen: false,
  }), [])

  const [gameState, setGameState] = useState<GameState>(createInitialState)
  const [localPlayerId, setLocalPlayerId] = useState<number | null>(null)
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting')
  const [gamesList, setGamesList] = useState<{gameId: string, playerCount: number}[]>([])
  const [latestHighlight, setLatestHighlight] = useState<HighlightData | null>(null)
  const [latestFloatingTexts, setLatestFloatingTexts] = useState<FloatingTextData[] | null>(null)
  const [latestNoTarget, setLatestNoTarget] = useState<{coords: {row: number, col: number}, timestamp: number} | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const joiningGameIdRef = useRef<string | null>(null)
  const isManualExitRef = useRef<boolean>(false)
  const playerTokenRef = useRef<string | undefined>(undefined)

  const gameStateRef = useRef(gameState)
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  const localPlayerIdRef = useRef(localPlayerId)
  useEffect(() => {
    localPlayerIdRef.current = localPlayerId
  }, [localPlayerId])

  /**
   * updateState - Low-level API to update game state and synchronize with server
   *
   * This is a low-level API that should only be used from orchestrating components.
   * It sends the updated state to the server via WebSocket for all clients to sync.
   * Avoid using this for purely local UI state mutations to avoid unnecessary server spam.
   *
   * @param newStateOrFn - New state object or function deriving new state from previous state
   */
  const updateState = useCallback((newStateOrFn: GameState | ((prevState: GameState) => GameState)) => {
    setGameState((prevState) => {
      // Compute the new state once, using prevState from React for consistency
      const newState = typeof newStateOrFn === 'function' ? newStateOrFn(prevState) : newStateOrFn

      // Send WebSocket message with the computed state
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
  }, [])

  // ... WebSocket logic (connectWebSocket, forceReconnect, joinGame, etc.) kept as is ...
  const connectWebSocket = useCallback(() => {
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
      reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, 3000)
      return
    }
    setConnectionStatus('Connecting')
    ws.current.onopen = () => {
      logger.info('WebSocket connection established')
      setConnectionStatus('Connected')
      const currentGameState = gameStateRef.current
      if (currentGameState && currentGameState.gameId && ws.current?.readyState === WebSocket.OPEN) {
        let playerToken = undefined
        try {
          const stored = localStorage.getItem(RECONNECTION_DATA_KEY)
          if (stored) {
            const data = JSON.parse(stored)
            if (data?.gameId === currentGameState.gameId && data?.playerToken) {
              playerToken = data.playerToken
            }
          }
        } catch (e) {
          console.warn('Failed to parse reconnection data, clearing cache:', e instanceof Error ? e.message : String(e))
          clearGameState()
        }

        ws.current.send(JSON.stringify({
          type: 'JOIN_GAME',
          gameId: currentGameState.gameId,
          playerToken: playerToken,
        }))
        // Note: Deck data will be sent after JOIN_SUCCESS confirmation if player is host
      }
    }
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'GAMES_LIST') {
          setGamesList(data.games)
        } else if (data.type === 'JOIN_SUCCESS') {
          setLocalPlayerId(data.playerId)
          const gameId = joiningGameIdRef.current || gameStateRef.current.gameId
          if (gameId && data.playerId !== null && data.playerToken) {
            // Save player token for reconnection
            playerTokenRef.current = data.playerToken
            // Save current game state with new player token
            if (gameStateRef.current.gameId === gameId) {
              saveGameState(gameStateRef.current, data.playerId, data.playerToken)
            } else {
              localStorage.setItem(RECONNECTION_DATA_KEY, JSON.stringify({
                gameId,
                playerId: data.playerId,
                playerToken: data.playerToken,
                timestamp: Date.now(),
              }))
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
            }, 500)
          }
        } else if (data.type === 'CONNECTION_ESTABLISHED') {
          // Server acknowledging connection - no action needed
          logger.info('Connection acknowledged by server')
        } else if (data.type === 'DECK_DATA_UPDATED') {
          // Deck data synced with server - no action needed
          logger.info('Deck data synced with server')
        } else if (data.type === 'ERROR') {
          if (data.message.includes('not found') || data.message.includes('Dummy')) {
            logger.info('Game not found error - clearing state')
            // Clear game state immediately to prevent reconnection attempts
            const newState = createInitialState()
            setGameState(newState)
            // Also update the ref immediately
            gameStateRef.current = newState
            setLocalPlayerId(null)
            clearGameState()
            // Clear the joining game ref as well
            joiningGameIdRef.current = null
            logger.info('State cleared, gameId now =', gameStateRef.current.gameId)
          } else {
            console.warn('Server Error:', data.message)
          }
        } else if (data.type === 'HIGHLIGHT_TRIGGERED') {
          setLatestHighlight(data.highlightData)
        } else if (data.type === 'NO_TARGET_TRIGGERED') {
          setLatestNoTarget({ coords: data.coords, timestamp: data.timestamp })
        } else if (data.type === 'FLOATING_TEXT_TRIGGERED') {
          setLatestFloatingTexts([data.floatingTextData])
        } else if (data.type === 'FLOATING_TEXT_BATCH_TRIGGERED') {
          setLatestFloatingTexts(data.batch)
        } else if (!data.type && data.players && data.board) {
          // Only update gameState if it's a valid game state (no type, but has required properties)
          // Sync card images from database (important for tokens after reconnection)
          const syncedData = syncGameStateImages(data)

          // IMPORTANT: Prevent phase flicker by validating phase transitions
          // If we're currently in scoring step and incoming state is not, verify it's a valid transition
          const currentState = gameStateRef.current
          if (currentState.isScoringStep && !syncedData.isScoringStep && syncedData.currentPhase !== 0) {
            // We're in scoring, incoming is non-scoring but not setup phase - likely old state
            logger.debug('Ignoring delayed state update (expected setup phase after scoring)')
            return
          }
          // If we're NOT in scoring and incoming IS in scoring, verify current phase is commit (2)
          if (!currentState.isScoringStep && syncedData.isScoringStep && currentState.currentPhase !== 2) {
            // Incoming scoring state but we're not in commit phase - likely old state
            logger.debug('Ignoring delayed scoring state update')
            return
          }

          setGameState(syncedData)
          gameStateRef.current = syncedData

          // Auto-save game state when receiving updates from server
          if (localPlayerIdRef.current !== null && syncedData.gameId) {
            // Get player token from reconnection_data
            let playerToken = undefined
            try {
              const stored = localStorage.getItem(RECONNECTION_DATA_KEY)
              if (stored) {
                const parsed = JSON.parse(stored)
                playerToken = parsed.playerToken
              }
            } catch (e) { /* ignore */ }
            saveGameState(syncedData, localPlayerIdRef.current, playerToken)
          }
        } else {
          console.warn('Unknown message type:', data.type, data)
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
        reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, 3000)
      }
    }
    ws.current.onerror = (event) => console.error('WebSocket error event:', event)
  }, [setGameState, createInitialState])

  const forceReconnect = useCallback(() => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      ws.current.close()
    } else {
      // If the socket was not open (e.g. initially missing URL), we must trigger connection manually.
      connectWebSocket()
    }
  }, [connectWebSocket])

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
      }
      ws.current.send(JSON.stringify(payload))
    } else {
      connectWebSocket()
      joiningGameIdRef.current = gameId
    }
  }, [connectWebSocket])

  useEffect(() => {
    isManualExitRef.current = false

    // Check navigation type to determine if we should restore state
    // TYPE_RELOAD = 1 (normal refresh) - restore state
    // TYPE_NAVIGATE = 0 (normal navigation) - restore state
    // TYPE_BACK_FORWARD = 2 - restore state
    // Hard refresh (Ctrl+Shift+R) clears sessionStorage, so no flag = no restore
    const navigationEntries = performance.getEntriesByType('navigation')
    const navigationType = navigationEntries.length > 0
      ? (navigationEntries[0] as PerformanceNavigationTiming).type
      : 0

    // Check for special navigation types that should NOT restore state
    // If sessionStorage was cleared (hard refresh), don't try to restore
    const hasValidFlag = sessionStorage.getItem('game_state_valid')

    // Restore state only if flag exists (not cleared by hard refresh/cache clear)
    if (hasValidFlag) {
      const savedState = loadGameState()
      if (savedState) {
        logger.info(`Restoring saved game state (nav type: ${navigationType}):`, savedState.gameState.gameId)
        setGameState(savedState.gameState)
        setLocalPlayerId(savedState.localPlayerId)
        gameStateRef.current = savedState.gameState
        localPlayerIdRef.current = savedState.localPlayerId
        playerTokenRef.current = savedState.playerToken
      }
    } else {
      // No valid flag - this is a hard refresh, cache clear, or first load
      logger.info('No valid game state flag, starting fresh')
      clearGameState()
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
  }, [rawJsonData]) // Re-run when rawJsonData changes

  // Poll for rawJsonData to be loaded and sync images
  // This is needed because rawJsonData is loaded asynchronously in App.tsx
  useEffect(() => {
    if (contentLoaded) return // Already loaded

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

  const createGame = useCallback(() => {
    isManualExitRef.current = false
    clearGameState()
    const newGameId = generateGameId()
    const initialState = {
      ...createInitialState(),
      gameId: newGameId,
      players: [createNewPlayer(1)],
    }
    updateState(initialState)
    // Wait for server to process UPDATE_STATE and assign playerId before sending other messages
    setTimeout(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: newGameId }))
        ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
      }
    }, 100)
  }, [updateState, createInitialState, createNewPlayer])

  const requestGamesList = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'GET_GAMES_LIST' }))
    }
  }, [])

  const exitGame = useCallback(() => {
    isManualExitRef.current = true
    const gameIdToLeave = gameStateRef.current.gameId
    const playerIdToLeave = localPlayerIdRef.current

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
    }, 100)

  }, [createInitialState, connectWebSocket])

  // ... (startReadyCheck, cancelReadyCheck, playerReady, assignTeams, setGameMode, setGamePrivacy, syncGame, resetGame, setActiveGridSize, setDummyPlayerCount methods kept as is) ...
  const startReadyCheck = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'START_READY_CHECK', gameId: gameStateRef.current.gameId }))
    }
  }, [])

  const cancelReadyCheck = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'CANCEL_READY_CHECK', gameId: gameStateRef.current.gameId }))
    }
  }, [])

  const playerReady = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId && localPlayerIdRef.current !== null) {
      ws.current.send(JSON.stringify({ type: 'PLAYER_READY', gameId: gameStateRef.current.gameId, playerId: localPlayerIdRef.current }))
    }
  }, [])

  const assignTeams = useCallback((teamAssignments: Record<number, number[]>) => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'ASSIGN_TEAMS', gameId: gameStateRef.current.gameId, assignments: teamAssignments }))
    }
  }, [])

  const setGameMode = useCallback((mode: GameModeEnum) => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_MODE', gameId: gameStateRef.current.gameId, mode }))
    }
  }, [])

  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_PRIVACY', gameId: gameStateRef.current.gameId, isPrivate }))
    }
  }, [])

  const syncGame = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId && localPlayerIdRef.current === 1) {
      ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))
      const currentState = gameStateRef.current
      const refreshedState = JSON.parse(JSON.stringify(currentState))
      refreshedState.players.forEach((p: Player) => {
        ['hand', 'deck', 'discard'].forEach(pile => {
          // @ts-ignore
          if (p[pile]) {
            // @ts-ignore
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

  const resetGame = useCallback(() => {
    updateState(currentState => {
      if (localPlayerIdRef.current !== 1) {
        return currentState
      }
      const newPlayers = currentState.players.map(player => {
        const newDeck = createDeck(player.selectedDeck, player.id, player.name)
        return {
          ...player,
          hand: [],
          deck: newDeck,
          discard: [],
          announcedCard: null,
          score: 0,
          isReady: false,
          boardHistory: [], // Reset history
        }
      })
      return {
        ...currentState,
        players: newPlayers,
        board: createInitialBoard(),
        isGameStarted: false,
        isReadyCheckActive: false,
        revealRequests: [],
        activePlayerId: null, // Aligned with server default (null)
        startingPlayerId: null, // Aligned with server default (null)
        currentPhase: 0,
        isScoringStep: false,
        currentRound: 1,
        turnNumber: 1,
        roundEndTriggered: false,
        roundWinners: {},
        gameWinner: null,
        isRoundEndModalOpen: false,
      }
    })
  }, [updateState, createDeck])


  const setActiveGridSize = useCallback((size: GridSize) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const newState = { ...currentState, activeGridSize: size }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const setDummyPlayerCount = useCallback((count: number) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const realPlayers = currentState.players.filter(p => !p.isDummy)
      if (realPlayers.length + count > MAX_PLAYERS) {
        return currentState
      }
      const newPlayers = [...realPlayers]
      for (let i = 0; i < count; i++) {
        const dummyId = newPlayers.length + 1
        const dummyPlayer = createNewPlayer(dummyId, true)
        dummyPlayer.name = `Dummy ${i + 1}`
        newPlayers.push(dummyPlayer)
      }
      return { ...currentState, players: newPlayers, dummyPlayerCount: count }
    })
  }, [updateState, createNewPlayer])

  const addBoardCardStatus = useCallback((boardCoords: { row: number; col: number }, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        // Lucius, The Immortal Immunity: Cannot be stunned
        // Uses strict baseId check OR Name+Hero check as a fallback
        if (status === 'Stun') {
          if (card.baseId === 'luciusTheImmortal') {
            return currentState
          }
          // Robust Fallback: Name + Hero Type
          if (card.name.includes('Lucius') && card.types?.includes('Hero')) {
            return currentState
          }
        }

        if (['Support', 'Threat', 'Revealed'].includes(status)) {
          const alreadyHasStatusFromPlayer = card.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  const removeBoardCardStatus = useCallback((boardCoords: { row: number; col: number }, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        const lastIndex = card.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          card.statuses.splice(lastIndex, 1)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const removeBoardCardStatusByOwner = useCallback((boardCoords: { row: number; col: number }, status: string, ownerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        const index = card.statuses.findIndex(s => s.type === status && s.addedByPlayerId === ownerId)
        if (index > -1) {
          card.statuses.splice(index, 1)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const modifyBoardCardPower = useCallback((boardCoords: { row: number; col: number }, delta: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        if (card.powerModifier === undefined) {
          card.powerModifier = 0
        }
        card.powerModifier += delta
      }
      return newState
    })
  }, [updateState])

  // ... (Other status/card modification methods kept as is: addAnnouncedCardStatus, removeAnnouncedCardStatus, modifyAnnouncedCardPower, addHandCardStatus, removeHandCardStatus, flipBoardCard, flipBoardCardFaceDown, revealHandCard, revealBoardCard, requestCardReveal, respondToRevealRequest, removeRevealedStatus) ...
  const addAnnouncedCardStatus = useCallback((playerId: number, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard) {
        if (['Support', 'Threat', 'Revealed'].includes(status)) {
          const alreadyHasStatusFromPlayer = player.announcedCard.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!player.announcedCard.statuses) {
          player.announcedCard.statuses = []
        }
        player.announcedCard.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  const removeAnnouncedCardStatus = useCallback((playerId: number, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard?.statuses) {
        const lastIndex = player.announcedCard.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          player.announcedCard.statuses.splice(lastIndex, 1)
        }
      }
      return newState
    })
  }, [updateState])

  const modifyAnnouncedCardPower = useCallback((playerId: number, delta: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player?.announcedCard) {
        if (player.announcedCard.powerModifier === undefined) {
          player.announcedCard.powerModifier = 0
        }
        player.announcedCard.powerModifier += delta
      }
      return newState
    })
  }, [updateState])

  const addHandCardStatus = useCallback((playerId: number, cardIndex: number, status: string, addedByPlayerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player?.hand[cardIndex]) {
        const card = player.hand[cardIndex]
        if (['Support', 'Threat', 'Revealed'].includes(status)) {
          const alreadyHasStatusFromPlayer = card.statuses?.some(s => s.type === status && s.addedByPlayerId === addedByPlayerId)
          if (alreadyHasStatusFromPlayer) {
            return currentState
          }
        }
        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: status, addedByPlayerId })
      }
      return newState
    })
  }, [updateState])

  const removeHandCardStatus = useCallback((playerId: number, cardIndex: number, status: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      const card = player?.hand[cardIndex]
      if (card?.statuses) {
        const lastIndex = card.statuses.map(s => s.type).lastIndexOf(status)
        if (lastIndex > -1) {
          card.statuses.splice(lastIndex, 1)
        }
        if (status === 'Revealed') {
          const hasRevealed = card.statuses.some(s => s.type === 'Revealed')
          if (!hasRevealed) {
            delete card.revealedTo
          }
        }
      }
      return newState
    })
  }, [updateState])

  const flipBoardCard = useCallback((boardCoords: { row: number; col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        card.isFaceDown = false
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const flipBoardCardFaceDown = useCallback((boardCoords: { row: number; col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        card.isFaceDown = true
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const revealHandCard = useCallback((playerId: number, cardIndex: number, revealTarget: 'all' | number[]) => {
    updateState(currentState => {
      const player = currentState.players.find(p => p.id === playerId)
      if (!player?.hand[cardIndex]) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const cardToReveal = newState.players.find(p => p.id === playerId)!.hand[cardIndex]
      if (revealTarget === 'all') {
        cardToReveal.revealedTo = 'all'
        if (!cardToReveal.statuses) {
          cardToReveal.statuses = []
        }
        if (!cardToReveal.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === playerId)) {
          cardToReveal.statuses.push({ type: 'Revealed', addedByPlayerId: playerId })
        }
      } else {
        if (!cardToReveal.revealedTo || cardToReveal.revealedTo === 'all' || !Array.isArray(cardToReveal.revealedTo)) {
          cardToReveal.revealedTo = []
        }
        const newRevealedIds = revealTarget.filter(id => !(cardToReveal.revealedTo as number[]).includes(id));
        (cardToReveal.revealedTo).push(...newRevealedIds)
      }
      return newState
    })
  }, [updateState])

  const revealBoardCard = useCallback((boardCoords: { row: number, col: number }, revealTarget: 'all' | number[]) => {
    updateState(currentState => {
      const cardToReveal = currentState.board[boardCoords.row][boardCoords.col].card
      if (!cardToReveal) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const cardInNewState = newState.board[boardCoords.row][boardCoords.col].card!
      const ownerId = cardInNewState.ownerId
      if (revealTarget === 'all') {
        cardInNewState.revealedTo = 'all'
        if (ownerId !== undefined) {
          if (!cardInNewState.statuses) {
            cardInNewState.statuses = []
          }
          if (!cardInNewState.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === ownerId)) {
            cardInNewState.statuses.push({ type: 'Revealed', addedByPlayerId: ownerId })
          }
        }
      } else {
        if (!cardInNewState.revealedTo || cardInNewState.revealedTo === 'all' || !Array.isArray(cardInNewState.revealedTo)) {
          cardInNewState.revealedTo = []
        }
        const newRevealedIds = revealTarget.filter(id => !(cardInNewState.revealedTo as number[]).includes(id));
        (cardInNewState.revealedTo).push(...newRevealedIds)
      }
      return newState
    })
  }, [updateState])

  const requestCardReveal = useCallback((cardIdentifier: CardIdentifier, requestingPlayerId: number) => {
    updateState(currentState => {
      const ownerId = cardIdentifier.boardCoords
        ? currentState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card?.ownerId
        : cardIdentifier.ownerId
      if (!ownerId) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const existingRequest = newState.revealRequests.find(
        (req: RevealRequest) => req.fromPlayerId === requestingPlayerId && req.toPlayerId === ownerId,
      )
      if (existingRequest) {
        const cardAlreadyRequested = existingRequest.cardIdentifiers.some(ci =>
          JSON.stringify(ci) === JSON.stringify(cardIdentifier),
        )
        if (!cardAlreadyRequested) {
          existingRequest.cardIdentifiers.push(cardIdentifier)
        }
      } else {
        newState.revealRequests.push({
          fromPlayerId: requestingPlayerId,
          toPlayerId: ownerId,
          cardIdentifiers: [cardIdentifier],
        })
      }
      return newState
    })
  }, [updateState])

  const respondToRevealRequest = useCallback((fromPlayerId: number, accepted: boolean) => {
    updateState(currentState => {
      const requestIndex = currentState.revealRequests.findIndex(
        (req: RevealRequest) => req.toPlayerId === localPlayerIdRef.current && req.fromPlayerId === fromPlayerId,
      )
      if (requestIndex === -1) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const request = newState.revealRequests[requestIndex]
      if (accepted) {
        const { cardIdentifiers } = request
        for (const cardIdentifier of cardIdentifiers) {
          let cardToUpdate: Card | null = null
          if (cardIdentifier.source === 'board' && cardIdentifier.boardCoords) {
            cardToUpdate = newState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card
          } else if (cardIdentifier.source === 'hand' && cardIdentifier.ownerId && cardIdentifier.cardIndex !== undefined) {
            const owner = newState.players.find(p => p.id === cardIdentifier.ownerId)
            if (owner) {
              cardToUpdate = owner.hand[cardIdentifier.cardIndex]
            }
          }
          if (cardToUpdate) {
            if (!cardToUpdate.statuses) {
              cardToUpdate.statuses = []
            }
            if (!cardToUpdate.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === fromPlayerId)) {
              cardToUpdate.statuses.push({ type: 'Revealed', addedByPlayerId: fromPlayerId })
            }
          }
        }
      }
      newState.revealRequests.splice(requestIndex, 1)
      return newState
    })
  }, [updateState])

  const removeRevealedStatus = useCallback((cardIdentifier: { source: 'hand' | 'board'; playerId?: number; cardIndex?: number; boardCoords?: { row: number, col: number }}) => {
    updateState(currentState => {
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      let cardToUpdate: Card | null = null
      if (cardIdentifier.source === 'board' && cardIdentifier.boardCoords) {
        cardToUpdate = newState.board[cardIdentifier.boardCoords.row][cardIdentifier.boardCoords.col].card
      } else if (cardIdentifier.source === 'hand' && cardIdentifier.playerId && cardIdentifier.cardIndex !== undefined) {
        const owner = newState.players.find(p => p.id === cardIdentifier.playerId)
        if (owner) {
          cardToUpdate = owner.hand[cardIdentifier.cardIndex]
        }
      }
      if (cardToUpdate) {
        if (cardToUpdate.statuses) {
          cardToUpdate.statuses = cardToUpdate.statuses.filter(s => s.type !== 'Revealed')
        }
        delete cardToUpdate.revealedTo
      }
      return newState
    })
  }, [updateState])


  const updatePlayerName = useCallback((playerId: number, name:string) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p => p.id === playerId ? { ...p, name } : p),
      }
    })
  }, [updateState])

  const changePlayerColor = useCallback((playerId: number, color: PlayerColor) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const isColorTaken = currentState.players.some(p => p.id !== playerId && !p.isDummy && p.color === color)
      if (isColorTaken) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p => p.id === playerId ? { ...p, color } : p),
      }
    })
  }, [updateState])

  const updatePlayerScore = useCallback((playerId: number, delta: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }

      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)

      if (player) {
        player.score += delta
      }
      return newState
    })
  }, [updateState])

  const changePlayerDeck = useCallback((playerId: number, deckType: DeckType) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: createDeck(deckType, playerId, p.name), selectedDeck: deckType, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })
  }, [updateState, createDeck])

  const loadCustomDeck = useCallback((playerId: number, deckFile: CustomDeckFile) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player) {
        return currentState
      }
      const newDeck: Card[] = []
      const cardInstanceCounter = new Map<string, number>()
      for (const { cardId, quantity } of deckFile.cards) {
        const cardDef = getCardDefinition(cardId)
        if (!cardDef) {
          continue
        }
        const isCommandCard = commandCardIds.has(cardId)
        const deckType = isCommandCard ? DeckType.Command : DeckType.Custom
        const prefix = isCommandCard ? 'CMD' : 'CUS'
        for (let i = 0; i < quantity; i++) {
          const instanceNum = (cardInstanceCounter.get(cardId) || 0) + 1
          cardInstanceCounter.set(cardId, instanceNum)
          newDeck.push({
            ...cardDef,
            id: `${prefix}_${cardId.toUpperCase()}_${instanceNum}`,
            baseId: cardId, // Ensure baseId is set for localization and display
            deck: deckType,
            ownerId: playerId,
            ownerName: player.name,
          })
        }
      }
      return {
        ...currentState,
        players: currentState.players.map(p =>
          p.id === playerId
            ? { ...p, deck: shuffleDeck(newDeck), selectedDeck: DeckType.Custom, hand: [], discard: [], announcedCard: null, boardHistory: [] }
            : p,
        ),
      }
    })
  }, [updateState])

  const drawCard = useCallback((playerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player || player.deck.length === 0) {
        return currentState
      }
      const newState = JSON.parse(JSON.stringify(currentState))
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      const cardDrawn = playerToUpdate.deck.shift()
      if (cardDrawn) {
        playerToUpdate.hand.push(cardDrawn)
      }
      return newState
    })
  }, [updateState])

  const shufflePlayerDeck = useCallback((playerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player) {
        return currentState
      }
      const newState = JSON.parse(JSON.stringify(currentState))
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      playerToUpdate.deck = shuffleDeck(playerToUpdate.deck)
      return newState
    })
  }, [updateState])

  const toggleActivePlayer = useCallback((playerId: number) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'TOGGLE_ACTIVE_PLAYER',
        gameId: gameStateRef.current.gameId,
        playerId
      }))
    }
  }, [])

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

  const setPhase = useCallback((phaseIndex: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      return {
        ...currentState,
        currentPhase: Math.max(0, Math.min(phaseIndex, TURN_PHASES.length - 1)),
      }
    })
  }, [updateState])

  const nextPhase = useCallback(() => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))

      if (newState.isScoringStep) {
        // IMPORTANT: Set currentPhase to 0 IMMEDIATELY after clearing isScoringStep
        // to prevent visual glitch showing the previous phase
        newState.isScoringStep = false
        newState.currentPhase = 0
        const finishingPlayerId = currentState.activePlayerId
        if (finishingPlayerId !== undefined) {
          newState.board.forEach(row => {
            row.forEach(cell => {
              if (cell.card?.ownerId === finishingPlayerId && cell.card.statuses) {
                const stunIndex = cell.card.statuses.findIndex(s => s.type === 'Stun')
                if (stunIndex !== -1) {
                  cell.card.statuses.splice(stunIndex, 1)
                }
              }
            })
          })
          // Recalculate statuses after Stun removal to ensure Support/Threat are updated
          newState.board = recalculateBoardStatuses(newState)
        }

        let nextPlayerId = finishingPlayerId
        if (nextPlayerId !== undefined) {
          const sortedPlayers = [...newState.players].sort((a, b) => a.id - b.id)
          const currentIndex = sortedPlayers.findIndex(p => p.id === nextPlayerId)
          if (currentIndex !== -1) {
            const nextIndex = (currentIndex + 1) % sortedPlayers.length
            nextPlayerId = sortedPlayers[nextIndex].id
          }
        }

        newState.activePlayerId = nextPlayerId

        // Auto-draw for the new active player
        // For dummy players: check if host (Player 1) has auto-draw enabled
        // For real players: check their own auto-draw setting
        if (nextPlayerId !== undefined && nextPlayerId !== finishingPlayerId) {
          const newActivePlayer = newState.players.find(p => p.id === nextPlayerId)
          if (newActivePlayer && newActivePlayer.deck.length > 0) {
            let shouldDraw = false

            if (newActivePlayer.isDummy) {
              // Dummy players draw if host (Player 1) has auto-draw enabled
              const hostPlayer = newState.players.find(p => p.id === 1)
              shouldDraw = hostPlayer?.autoDrawEnabled === true
            } else {
              // Real players draw if they have auto-draw enabled
              shouldDraw = newActivePlayer.autoDrawEnabled === true
            }

            if (shouldDraw) {
              // Draw 1 card from deck to hand
              const drawnCard = newActivePlayer.deck[0]
              newActivePlayer.deck.splice(0, 1)
              newActivePlayer.hand.push(drawnCard)
            }
          }
        }

        // Reset phase-specific ready statuses for the new active player (readySetup, readyCommit)
        // Only for abilities that the card actually has
        if (nextPlayerId !== undefined) {
          newState.board.forEach(row => {
            row.forEach(cell => {
              const card = cell.card
              if (card && card.ownerId === nextPlayerId) {
                resetPhaseReadyStatuses(card, nextPlayerId)
              }
            })
          })
        }

        if (newState.startingPlayerId !== undefined && nextPlayerId === newState.startingPlayerId) {
          const currentThreshold = (newState.currentRound * 10) + 10
          const isFinalRoundLimit = newState.currentRound === 5 && newState.turnNumber >= 10
          let maxScore = -Infinity
          newState.players.forEach(p => {
            if (p.score > maxScore) {
              maxScore = p.score
            }
          })
          const thresholdMet = maxScore >= currentThreshold

          if (thresholdMet || isFinalRoundLimit) {
            const winners = newState.players.filter(p => p.score === maxScore).map(p => p.id)
            newState.roundWinners[newState.currentRound] = winners
            const allWins = Object.values(newState.roundWinners).flat()
            const winCounts = allWins.reduce((acc, id) => {
              acc[id] = (acc[id] || 0) + 1; return acc
            }, {} as Record<number, number>)
            const gameWinners = Object.keys(winCounts).filter(id => winCounts[Number(id)] >= 2).map(id => Number(id))
            if (gameWinners.length > 0) {
              newState.gameWinner = gameWinners[0]
            }
            newState.isRoundEndModalOpen = true
          } else {
            newState.turnNumber += 1
          }
        }

        newState.board.forEach(row => {
          row.forEach(cell => {
            if (cell.card) {
              delete cell.card.enteredThisTurn
            }
          })
        })

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

        // Recalculate again as Resurrected removal/Stun addition changes auras
        newState.board = recalculateBoardStatuses(newState)

        return newState
      }

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

      if (nextPhaseIndex >= TURN_PHASES.length) {
        newState.isScoringStep = true
        return newState
      } else {
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
      }
    })
  }, [updateState])

  const prevPhase = useCallback(() => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      // IMPORTANT: When exiting scoring step, immediately return to Commit phase (phase 3)
      // to prevent visual glitch showing an incorrect phase
      if (currentState.isScoringStep) {
        return { ...currentState, isScoringStep: false, currentPhase: 3 }
      }
      return {
        ...currentState,
        currentPhase: Math.max(0, currentState.currentPhase - 1),
      }
    })
  }, [updateState])

  const confirmRoundEnd = useCallback(() => {
    updateState(currentState => {
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      newState.isRoundEndModalOpen = false
      newState.players.forEach(p => p.score = 0)
      newState.currentRound += 1
      newState.roundEndTriggered = false
      newState.turnNumber = 1
      newState.gameWinner = null
      return newState
    })
  }, [updateState])

  /**
   * moveItem - Move a dragged item to a target location
   *
   * Ready-Status Lifecycle:
   * - Reads auto_abilities_enabled from localStorage to drive auto-transition to Main phase
   * - Preserves card state for board-to-board moves via actualCardState (deep copy)
   * - Blocks moving stunned allied/teammate cards unless item.isManual is true
   * - Initializes ready statuses (readyDeploy/readySetup/readyCommit) on cards entering the board
   * - Cleans up ready statuses with removeAllReadyStatuses when cards leave the board
   *
   * These behaviors ensure proper auto-ability tracking while respecting game rules.
   */
  const moveItem = useCallback((item: DragItem, target: DropTarget) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }

      if (target.target === 'board' && target.boardCoords) {
        const targetCell = currentState.board[target.boardCoords.row][target.boardCoords.col]
        if (targetCell.card !== null && item.source !== 'counter_panel') {
          return currentState
        }
      }

      // Auto-phase transition: Setup -> Main when playing a unit or command card from hand
      // Only if auto-abilities is enabled (check localStorage for client-side setting)
      let autoAbilitiesEnabled = false
      try {
        const saved = localStorage.getItem('auto_abilities_enabled')
        autoAbilitiesEnabled = saved === null ? true : saved === 'true'
      } catch {
        autoAbilitiesEnabled = true
      }

      const shouldAutoTransitionToMain = autoAbilitiesEnabled &&
        currentState.currentPhase === 0 && // Setup phase
        item.source === 'hand' &&
        target.target === 'board' &&
        (item.card.types?.includes('Unit') || item.card.types?.includes('Command'))

      const newState: GameState = JSON.parse(JSON.stringify(currentState))

      if (item.source === 'board' && ['hand', 'deck', 'discard'].includes(target.target) && !item.bypassOwnershipCheck) {
        const cardOwnerId = item.card.ownerId
        const cardOwner = newState.players.find(p => p.id === cardOwnerId)
        const isOwner = cardOwnerId === localPlayerIdRef.current
        const isDummyCard = !!cardOwner?.isDummy

        if (!isOwner && !isDummyCard) {
          return currentState
        }
      }

      if (newState.startingPlayerId === undefined && target.target === 'board' && item.source !== 'board') {
        const dropperId = item.playerId || localPlayerIdRef.current
        if (dropperId !== null) {
          newState.startingPlayerId = dropperId
        }
      }

      // Store the actual current card state for board-to-board moves
      // This ensures we preserve all statuses (including ready statuses) when moving
      let actualCardState: Card | null = null
      if (item.source === 'board' && target.target === 'board' && item.boardCoords) {
        // Get the actual card state from newState (after cloning)
        // This must be done AFTER newState is created
        const cell = newState.board[item.boardCoords.row][item.boardCoords.col]
        if (cell.card) {
          actualCardState = cell.card
        }

        // Also check stun status from currentState for the early return
        const currentCell = currentState.board[item.boardCoords.row][item.boardCoords.col]
        const currentCardState = currentCell.card || actualCardState
        if (currentCardState) {
          const isStunned = currentCardState.statuses?.some(s => s.type === 'Stun')

          if (isStunned) {
            const moverId = localPlayerIdRef.current
            const ownerId = currentCardState.ownerId
            const moverPlayer = currentState.players.find(p => p.id === moverId)
            const ownerPlayer = currentState.players.find(p => p.id === ownerId)
            const isOwner = moverId === ownerId
            const isTeammate = moverPlayer?.teamId !== undefined && ownerPlayer?.teamId !== undefined && moverPlayer.teamId === ownerPlayer.teamId

            if ((isOwner || isTeammate) && !item.isManual) {
              return currentState
            }
          }
        }
      }

      if (item.source === 'counter_panel' && item.statusType) {
        const counterDef = countersDatabase[item.statusType]
        const allowedTargets = counterDef?.allowedTargets || ['board', 'hand']
        if (!allowedTargets.includes(target.target)) {
          return currentState
        }
        let targetCard: Card | null = null
        if (target.target === 'board' && target.boardCoords) {
          targetCard = newState.board[target.boardCoords.row][target.boardCoords.col].card
        } else if (target.playerId !== undefined) {
          const targetPlayer = newState.players.find(p => p.id === target.playerId)
          if (targetPlayer) {
            if (target.target === 'hand' && target.cardIndex !== undefined) {
              targetCard = targetPlayer.hand[target.cardIndex]
            }
            if (target.target === 'announced') {
              targetCard = targetPlayer.announcedCard || null
            }
            if (target.target === 'deck' && targetPlayer.deck.length > 0) {
              if (target.deckPosition === 'top' || !target.deckPosition) {
                targetCard = targetPlayer.deck[0]
              } else {
                targetCard = targetPlayer.deck[targetPlayer.deck.length - 1]
              }
            } else if (target.target === 'discard' && targetPlayer.discard.length > 0) {
              targetCard = targetPlayer.discard[targetPlayer.discard.length - 1]
            }
          }
        }
        if (targetCard) {
          // Lucius Immunity Logic
          if (item.statusType === 'Stun') {
            if (targetCard.baseId === 'luciusTheImmortal') {
              return newState
            }
            if (targetCard.name.includes('Lucius') && targetCard.types?.includes('Hero')) {
              return newState
            }
          }

          const count = item.count || 1
          const activePlayer = newState.players.find(p => p.id === newState.activePlayerId)
          const effectiveActorId = (activePlayer?.isDummy) ? activePlayer.id : (localPlayerIdRef.current !== null ? localPlayerIdRef.current : 0)
          if (item.statusType === 'Power+') {
            if (targetCard.powerModifier === undefined) {
              targetCard.powerModifier = 0
            }
            targetCard.powerModifier += (1 * count)
          } else if (item.statusType === 'Power-') {
            if (targetCard.powerModifier === undefined) {
              targetCard.powerModifier = 0
            }
            targetCard.powerModifier -= (1 * count)
          } else {
            if (!targetCard.statuses) {
              targetCard.statuses = []
            }
            for (let i = 0; i < count; i++) {
              if (['Support', 'Threat', 'Revealed'].includes(item.statusType)) {
                const exists = targetCard.statuses.some(s => s.type === item.statusType && s.addedByPlayerId === effectiveActorId)
                if (!exists) {
                  targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
                }
              } else {
                targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
              }
            }
          }
          if (target.target === 'board') {
            newState.board = recalculateBoardStatuses(newState)
          }
          return newState
        }
        return currentState
      }

      const cardToMove: Card = actualCardState ? { ...actualCardState } : { ...item.card }

      if (item.source === 'hand' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          player.hand.splice(item.cardIndex, 1)
        }
      } else if (item.source === 'board' && item.boardCoords) {
        newState.board[item.boardCoords.row][item.boardCoords.col].card = null
      } else if (item.source === 'discard' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          player.discard.splice(item.cardIndex, 1)
        }
      } else if (item.source === 'deck' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          player.deck.splice(item.cardIndex, 1)
        }
      } else if (item.source === 'announced' && item.playerId !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          player.announcedCard = null
        }
      }

      const isReturningToStorage = ['hand', 'deck', 'discard'].includes(target.target)

      if (isReturningToStorage) {
        if (cardToMove.statuses) {
          // Keep Revealed status, remove all others (including ready statuses)
          cardToMove.statuses = cardToMove.statuses.filter(status => status.type === 'Revealed')
        }
        cardToMove.isFaceDown = false
        delete cardToMove.powerModifier
        delete cardToMove.bonusPower // Clear passive buffs
        delete cardToMove.enteredThisTurn
      } else if (target.target === 'board') {
        if (!cardToMove.statuses) {
          cardToMove.statuses = []
        }
        if (item.source !== 'board' && cardToMove.isFaceDown === undefined) {
          cardToMove.isFaceDown = false
        }
        if (item.source !== 'board') {
          cardToMove.enteredThisTurn = true
          // Note: Ready statuses are initialized below, no need to delete legacy flags

          // Initialize ready statuses for the new card (only for abilities it actually has)
          // Ready statuses belong to the card owner (even if it's a dummy player)
          // Token ownership rules:
          // - Tokens from token_panel: owned by active player (even if it's a dummy)
          // - Tokens from abilities (spawnToken): already have ownerId set correctly
          // - Other cards: owned by local player who played them
          let ownerId = cardToMove.ownerId
          if (ownerId === undefined) {
            if (item.source === 'token_panel') {
              // Token from token panel gets active player as owner
              ownerId = newState.activePlayerId ?? localPlayerIdRef.current ?? 0
            } else {
              // Other cards get local player as owner
              ownerId = localPlayerIdRef.current ?? 0
            }
            cardToMove.ownerId = ownerId
          }
          initializeReadyStatuses(cardToMove, ownerId)

          // Lucius, The Immortal: Bonus if entered from discard
          if (item.source === 'discard' && (cardToMove.baseId === 'luciusTheImmortal' || cardToMove.name.includes('Lucius'))) {
            if (cardToMove.powerModifier === undefined) {
              cardToMove.powerModifier = 0
            }
            cardToMove.powerModifier += 2
          }
        }
      }

      if (target.target === 'hand' && target.playerId !== undefined) {
        if (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') {
          return newState
        }
        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        const player = newState.players.find(p => p.id === target.playerId)
        if (player) {
          player.hand.push(cardToMove)
          // Automatic Shuffle if moving from Deck to Hand
          if (item.source === 'deck') {
            player.deck = shuffleDeck(player.deck)
          }
        }
      } else if (target.target === 'board' && target.boardCoords) {
        if (newState.board[target.boardCoords.row][target.boardCoords.col].card === null) {
          if (cardToMove.ownerId === undefined && localPlayerIdRef.current !== null) {
            const currentPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
            if (currentPlayer) {
              cardToMove.ownerId = currentPlayer.id
              cardToMove.ownerName = currentPlayer.name
            }
          }

          // --- HISTORY TRACKING: Entering Board ---
          // Manually played cards get tracked in history for fallback 'LastPlayed' status
          if (item.source !== 'board' && item.isManual && cardToMove.ownerId !== undefined) {
            const player = newState.players.find(p => p.id === cardToMove.ownerId)
            if (player) {
              // FIX: Added initialization check for boardHistory to prevent crash if undefined.
              if (!player.boardHistory) {
                player.boardHistory = []
              }
              player.boardHistory.push(cardToMove.id)
            }
          }

          newState.board[target.boardCoords.row][target.boardCoords.col].card = cardToMove
        }
      } else if (target.target === 'discard' && target.playerId !== undefined) {
        if (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') {} else {
          // Remove ready statuses when card leaves the battlefield
          removeAllReadyStatuses(cardToMove)
          const player = newState.players.find(p => p.id === target.playerId)
          if (player) {
            if (cardToMove.ownerId === undefined) {
              cardToMove.ownerId = target.playerId
              cardToMove.ownerName = player.name
            }
            player.discard.push(cardToMove)
          }
        }
      } else if (target.target === 'deck' && target.playerId !== undefined) {
        if (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') {
          return newState
        }
        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        const player = newState.players.find(p => p.id === target.playerId)
        if (player) {
          if (cardToMove.ownerId === undefined) {
            cardToMove.ownerId = target.playerId
            cardToMove.ownerName = player.name
          }
          if (target.deckPosition === 'top' || !target.deckPosition) {
            player.deck.unshift(cardToMove)
          } else {
            player.deck.push(cardToMove)
          }
        }
      } else if (target.target === 'announced' && target.playerId !== undefined) {
        const player = newState.players.find(p => p.id === target.playerId)
        if (player) {
          if (player.announcedCard) {
            if (player.announcedCard.statuses) {
              player.announcedCard.statuses = player.announcedCard.statuses.filter(s => s.type === 'Revealed')
            }
            delete player.announcedCard.enteredThisTurn
            delete player.announcedCard.powerModifier
            delete player.announcedCard.bonusPower
            player.hand.push(player.announcedCard)
          }
          player.announcedCard = cardToMove
        }
      }

      // --- HISTORY TRACKING: Leaving Board ---
      if (item.source === 'board' && target.target !== 'board' && cardToMove.ownerId !== undefined) {
        const player = newState.players.find(p => p.id === cardToMove.ownerId)
        if (player) {
          // FIX: Added initialization check for boardHistory to prevent crash if undefined.
          if (!player.boardHistory) {
            player.boardHistory = []
          }
          player.boardHistory = player.boardHistory.filter(id => id !== cardToMove.id)
        }
      }

      // --- Post-Move: Sync LastPlayed Status ---
      if ((item.source === 'board' || target.target === 'board') && cardToMove.ownerId !== undefined) {
        const player = newState.players.find(p => p.id === cardToMove.ownerId)
        if (player) {
          syncLastPlayed(newState.board, player)
        }
      }

      if (item.source === 'hand' && target.target === 'board') {
        const movingCard = cardToMove
        const isRevealed = movingCard.revealedTo === 'all' || movingCard.statuses?.some(s => s.type === 'Revealed')
        if (isRevealed) {
          const gridSize = newState.board.length
          for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
              const spotter = newState.board[r][c].card
              if (spotter && spotter.name.toLowerCase().includes('vigilant spotter')) {
                if (spotter.ownerId !== movingCard.ownerId) {
                  newState.board = recalculateBoardStatuses(newState)
                  const updatedSpotter = newState.board[r][c].card!
                  if (updatedSpotter.statuses?.some(s => s.type === 'Support')) {
                    const spotterOwner = newState.players.find(p => p.id === spotter.ownerId)
                    if (spotterOwner) {
                      spotterOwner.score += 2
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (item.source === 'board' || target.target === 'board') {
        newState.board = recalculateBoardStatuses(newState)
      }

      // Apply auto-phase transition: Setup -> Main when playing a unit or command card from hand
      if (shouldAutoTransitionToMain) {
        newState.currentPhase = 1 // Main phase
      }

      return newState
    })
  }, [updateState])

  const resurrectDiscardedCard = useCallback((playerId: number, cardIndex: number, boardCoords: {row: number, col: number}, statuses?: {type: string}[]) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      if (currentState.board[boardCoords.row][boardCoords.col].card !== null) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player && player.discard.length > cardIndex) {
        const [card] = player.discard.splice(cardIndex, 1)
        card.enteredThisTurn = true

        // Initialize ready statuses for the resurrected card
        // This allows abilities to be used when card returns from discard
        initializeReadyStatuses(card, playerId)

        // Lucius Bonus if resurrected
        if (card.baseId === 'luciusTheImmortal' || card.name.includes('Lucius')) {
          if (card.powerModifier === undefined) {
            card.powerModifier = 0
          }
          card.powerModifier += 2
        }

        if (!card.statuses) {
          card.statuses = []
        }
        card.statuses.push({ type: 'Resurrected', addedByPlayerId: playerId })
        if (statuses) {
          statuses.forEach(s => {
            if (s.type !== 'Resurrected') {
              card.statuses?.push({ type: s.type, addedByPlayerId: playerId })
            }
          })
        }

        // Add to history
        // FIX: Ensure boardHistory exists before pushing
        if (!player.boardHistory) {
          player.boardHistory = []
        }
        player.boardHistory.push(card.id)

        newState.board[boardCoords.row][boardCoords.col].card = card

        syncLastPlayed(newState.board, player)

        newState.board = recalculateBoardStatuses(newState)
      }
      return newState
    })
  }, [updateState])

  const reorderTopDeck = useCallback((playerId: number, newTopOrder: Card[]) => {
    updateState(currentState => {
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)

      if (player && newTopOrder.length > 0) {
        // 1. Identify which cards are being reordered (by ID)
        const topIds = new Set(newTopOrder.map(c => c.id))

        // 2. Separate deck into [Cards to be moved] and [Rest of deck]
        // Filter out the cards that are in the new top order from the current deck
        const remainingDeck = player.deck.filter(c => !topIds.has(c.id))

        // 3. Prepend the new top order
        // This effectively moves the selected cards to the top in the specified order
        // and keeps the rest of the deck in its original relative order.
        player.deck = [...newTopOrder, ...remainingDeck]
      }

      return newState
    })
  }, [updateState])

  /**
   * reorderCards - Low-level API to reorder cards in a player's deck or discard pile
   *
   * This is a low-level API that should only be used from orchestrating components.
   * Use this when you need to change the order of cards in a deck or discard pile.
   *
   * @param playerId - The ID of the player whose cards are being reordered
   * @param newCards - The new ordered array of cards
   * @param source - Either 'deck' or 'discard' indicating which pile to reorder
   */
  const reorderCards = useCallback((playerId: number, newCards: Card[], source: 'deck' | 'discard') => {
    updateState(currentState => {
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)

      if (player) {
        if (source === 'deck') {
          player.deck = newCards
        } else if (source === 'discard') {
          player.discard = newCards
        }
      }

      return newState
    })
  }, [updateState])

  const triggerHighlight = useCallback((highlightData: Omit<HighlightData, 'timestamp'>) => {
    const fullHighlightData: HighlightData = { ...highlightData, timestamp: Date.now() }

    // Immediately update local state so the acting player sees the effect without waiting for round-trip
    setLatestHighlight(fullHighlightData)

    // Also broadcast to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'TRIGGER_HIGHLIGHT', gameId: gameStateRef.current.gameId, highlightData: fullHighlightData }))
    }
  }, [])

  const triggerFloatingText = useCallback((data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => {
    const items = Array.isArray(data) ? data : [data]
    const timestamp = Date.now()
    const batch = items.map((item, i) => ({ ...item, timestamp: timestamp + i }))

    // Immediately update local state so the acting player sees the effect without waiting for round-trip
    setLatestFloatingTexts(batch)

    // Also broadcast to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_FLOATING_TEXT_BATCH',
        gameId: gameStateRef.current.gameId,
        batch,
      }))
    }
  }, [])

  const triggerNoTarget = useCallback((coords: { row: number, col: number }) => {
    const timestamp = Date.now()
    // Immediately update local state so the acting player sees the effect without waiting for round-trip
    setLatestNoTarget({ coords, timestamp })

    // Also broadcast to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'TRIGGER_NO_TARGET',
        gameId: gameStateRef.current.gameId,
        coords,
        timestamp,
      }))
    }
  }, [])

  const markAbilityUsed = useCallback((boardCoords: { row: number, col: number }, _isDeployAbility?: boolean, _setDeployAttempted?: boolean, readyStatusToRemove?: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        // Remove the ready status if specified (new ready status system)
        if (readyStatusToRemove && card.statuses) {
          card.statuses = card.statuses.filter(s => s.type !== readyStatusToRemove)
        }
      }
      return newState
    })
  }, [updateState])

  const resetDeployStatus = useCallback((boardCoords: { row: number, col: number }) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        // New system: Add readyDeploy status back (for Command cards that restore deploy ability)
        if (!card.statuses) {
          card.statuses = []
        }
        const abilityText = card.ability || ''
        // Only add if the card actually has a deploy: ability (case-insensitive)
        if (abilityText.toLowerCase().includes('deploy:')) {
          if (!card.statuses.some(s => s.type === 'readyDeploy')) {
            // Require valid ownerId (player IDs start at 1, so 0 is invalid)
            const ownerId = card.ownerId
            if (ownerId === undefined || ownerId === null || ownerId === 0) {
              console.warn('[resetDeployStatus] Card missing or invalid ownerId:', card.id)
              return currentState
            }
            card.statuses.push({ type: 'readyDeploy', addedByPlayerId: ownerId })
          }
        }
      }
      return newState
    })
  }, [updateState])

  const removeStatusByType = useCallback((boardCoords: { row: number, col: number }, type: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card?.statuses) {
        card.statuses = card.statuses.filter(s => s.type !== type)
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const applyGlobalEffect = useCallback((
    _sourceCoords: { row: number, col: number },
    targetCoords: { row: number, col: number }[],
    tokenType: string,
    addedByPlayerId: number,
    _isDeployAbility: boolean,
  ) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      targetCoords.forEach(({ row, col }) => {
        const card = newState.board[row][col].card
        if (card) {
          // Lucius Immunity
          if (tokenType === 'Stun') {
            if (card.baseId === 'luciusTheImmortal') {
              return
            }
            if (card.name.includes('Lucius') && card.types?.includes('Hero')) {
              return
            }
          }

          if (!card.statuses) {
            card.statuses = []
          }
          if (['Support', 'Threat', 'Revealed'].includes(tokenType)) {
            const exists = card.statuses.some(s => s.type === tokenType && s.addedByPlayerId === addedByPlayerId)
            if (!exists) {
              card.statuses.push({ type: tokenType, addedByPlayerId })
            }
          } else {
            card.statuses.push({ type: tokenType, addedByPlayerId })
          }
        }
      })
      // Note: Ready status is removed by markAbilityUsed before calling applyGlobalEffect
      return newState
    })
  }, [updateState])

  // ... (swapCards, transferStatus, transferAllCounters, recoverDiscardedCard, spawnToken, scoreLine, scoreDiagonal kept as is) ...
  const swapCards = useCallback((coords1: {row: number, col: number}, coords2: {row: number, col: number}) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const card1 = newState.board[coords1.row][coords1.col].card
      const card2 = newState.board[coords2.row][coords2.col].card
      newState.board[coords1.row][coords1.col].card = card2
      newState.board[coords2.row][coords2.col].card = card1
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const transferStatus = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      if (fromCard && toCard && fromCard.statuses) {
        const statusIndex = fromCard.statuses.findIndex(s => s.type === statusType)
        if (statusIndex > -1) {
          const [status] = fromCard.statuses.splice(statusIndex, 1)
          if (!toCard.statuses) {
            toCard.statuses = []
          }
          toCard.statuses.push(status)
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const transferAllCounters = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      const excludedTypes = ['Support', 'Threat']
      if (fromCard && toCard && fromCard.statuses) {
        const statusesToMove = fromCard.statuses.filter(s => !excludedTypes.includes(s.type))
        const statusesToKeep = fromCard.statuses.filter(s => excludedTypes.includes(s.type))
        if (statusesToMove.length > 0) {
          if (!toCard.statuses) {
            toCard.statuses = []
          }
          toCard.statuses.push(...statusesToMove)
          fromCard.statuses = statusesToKeep
        }
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const recoverDiscardedCard = useCallback((playerId: number, cardIndex: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      const player = newState.players.find(p => p.id === playerId)
      if (player && player.discard.length > cardIndex) {
        const [card] = player.discard.splice(cardIndex, 1)
        player.hand.push(card)
      }
      return newState
    })
  }, [updateState])

  const spawnToken = useCallback((coords: {row: number, col: number}, tokenName: string, ownerId: number) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = JSON.parse(JSON.stringify(currentState))
      if (!rawJsonData) {
        return currentState
      }
      const tokenDatabase = rawJsonData.tokenDatabase
      const tokenDefKey = Object.keys(tokenDatabase).find(key => tokenDatabase[key as keyof typeof tokenDatabase].name === tokenName)
      if (!tokenDefKey) {
        return currentState
      }
      const tokenDef = tokenDatabase[tokenDefKey as keyof typeof tokenDatabase]
      const owner = newState.players.find(p => p.id === ownerId)
      if (tokenDef && newState.board[coords.row][coords.col].card === null) {
        const tokenCard: Card = {
          id: `TKN_${tokenName.toUpperCase().replace(/\s/g, '_')}_${Date.now()}`,
          deck: DeckType.Tokens,
          name: tokenName,
          baseId: tokenDef.baseId || tokenDefKey,
          imageUrl: tokenDef.imageUrl,
          fallbackImage: tokenDef.fallbackImage,
          power: tokenDef.power,
          ability: tokenDef.ability,
          flavorText: tokenDef.flavorText,
          color: tokenDef.color,
          types: tokenDef.types || ['Unit'],
          faction: 'Tokens',
          ownerId: ownerId,
          ownerName: owner?.name,
          enteredThisTurn: true,
          statuses: [],
        }
        // Initialize ready statuses based on token's actual abilities
        // Ready statuses belong to the token owner (even if it's a dummy player)
        // Control is handled by canActivateAbility checking dummy ownership
        initializeReadyStatuses(tokenCard, ownerId)
        newState.board[coords.row][coords.col].card = tokenCard
      }
      newState.board = recalculateBoardStatuses(newState)
      return newState
    })
  }, [updateState])

  const scoreLine = useCallback((row1: number, col1: number, row2: number, col2: number, playerId: number) => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      return
    }

    const hasActiveLiberator = currentState.board.some(row =>
      row.some(cell =>
        cell.card?.ownerId === playerId &&
              cell.card.name.toLowerCase().includes('data liberator') &&
              cell.card.statuses?.some(s => s.type === 'Support'),
      ),
    )

    const gridSize = currentState.board.length
    let rStart = row1, rEnd = row1, cStart = col1, cEnd = col1
    if (row1 === row2) {
      rStart = row1; rEnd = row1
      cStart = 0; cEnd = gridSize - 1
    } else if (col1 === col2) {
      cStart = col1; cEnd = col1
      rStart = 0; rEnd = gridSize - 1
    } else {
      return
    }

    let totalScore = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let r = rStart; r <= rEnd; r++) {
      for (let c = cStart; c <= cEnd; c++) {
        const cell = currentState.board[r][c]
        const card = cell.card

        if (card && !card.statuses?.some(s => s.type === 'Stun')) {
          const isOwner = card.ownerId === playerId
          const hasExploit = card.statuses?.some(s => s.type === 'Exploit' && s.addedByPlayerId === playerId)

          if (isOwner || (hasActiveLiberator && hasExploit && card.ownerId !== playerId)) {
            const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            if (points > 0) {
              totalScore += points
              scoreEvents.push({
                row: r,
                col: c,
                text: `+${points}`,
                playerId: playerId,
              })
            }
          }
        }
      }
    }

    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    updateState(prevState => {
      const newState: GameState = JSON.parse(JSON.stringify(prevState))
      const player = newState.players.find(p => p.id === playerId)
      if (player) {
        player.score += totalScore
      }
      return newState
    })
  }, [updateState, triggerFloatingText])

  const scoreDiagonal = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      return
    }

    const dRow = r2 > r1 ? 1 : -1
    const dCol = c2 > c1 ? 1 : -1
    const steps = Math.abs(r1 - r2)

    let totalScore = 0
    let totalBonus = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let i = 0; i <= steps; i++) {
      const r = r1 + (i * dRow)
      const c = c1 + (i * dCol)

      if (r < 0 || r >= currentState.board.length || c < 0 || c >= currentState.board.length) {
        continue
      }

      const cell = currentState.board[r][c]
      const card = cell.card

      if (card && !card.statuses?.some(s => s.type === 'Stun')) {
        const isOwner = card.ownerId === playerId

        if (isOwner) {
          const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
          if (points > 0) {
            totalScore += points
            scoreEvents.push({
              row: r,
              col: c,
              text: `+${points}`,
              playerId: playerId,
            })
          }

          if (bonusType && card.statuses?.some(s => s.type === 'Support' && s.addedByPlayerId === playerId)) {
            totalBonus += 1
          }
        }
      }
    }

    if (bonusType === 'point_per_support' && totalBonus > 0) {
      totalScore += totalBonus
    }

    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    updateState(prevState => {
      const newState: GameState = JSON.parse(JSON.stringify(prevState))
      const player = newState.players.find(p => p.id === playerId)
      if (player) {
        player.score += totalScore

        if (bonusType === 'draw_per_support' && totalBonus > 0 && player.deck.length > 0) {
          for (let i = 0; i < totalBonus; i++) {
            if (player.deck.length > 0) {
              player.hand.push(player.deck.shift()!)
            }
          }
        }
      }
      return newState
    })
  }, [updateState, triggerFloatingText])

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
    createGame,
    joinGame,
    requestGamesList,
    exitGame,
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
    shufflePlayerDeck,
    moveItem,
    handleDrop: moveItem,
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
    resetGame,
    toggleActivePlayer,
    toggleAutoDraw,
    forceReconnect,
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    nextPhase,
    prevPhase,
    setPhase,
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    recoverDiscardedCard,
    resurrectDiscardedCard,
    spawnToken,
    scoreLine,
    confirmRoundEnd,
    resetDeployStatus,
    scoreDiagonal,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    updateState,
  }
}
