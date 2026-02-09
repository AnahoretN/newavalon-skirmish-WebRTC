// ... existing imports
import { useState, useEffect, useCallback, useRef } from 'react'
import { DeckType, GameMode as GameModeEnum } from '../types'
import type { GameState, Player, Board, GridSize, Card, DragItem, DropTarget, PlayerColor, RevealRequest, CardIdentifier, CustomDeckFile, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData, TargetingModeData, AbilityAction, CommandContext, StateDelta, PlayerDelta } from '../types'
import { PLAYER_COLOR_NAMES, MAX_PLAYERS } from '../constants'
import { shuffleDeck } from '@shared/utils/array'
import { getDecksData, decksData, countersDatabase, rawJsonData, getCardDefinition, getCardDefinitionByName, commandCardIds } from '../content'
import { createInitialBoard, recalculateBoardStatuses } from '@server/utils/boardUtils'
import { calculateValidTargets } from '@server/utils/targeting'
import { logger } from '../utils/logger'
import { initializeReadyStatuses, removeAllReadyStatuses } from '../utils/autoAbilities'
import { deepCloneState, TIMING } from '../utils/common'
import { getWebrtcManager, type WebrtcEvent } from '../utils/webrtcManager'
import { toggleActivePlayer as toggleActivePlayerPhase, passTurnToNextPlayer, playerHasCardsOnBoard, performPreparationPhase } from '../host/PhaseManagement'
import {
  createCardMoveDelta,
  createBoardCellDelta,
  createCardStatusDelta,
  createPhaseDelta,
  createRoundDelta,
  createScoreDelta,
  createPlayerPropertyDelta,
  applyStateDelta,
  createDeltaFromStates,
  isDeltaEmpty
} from '../utils/stateDelta'
import { saveGuestData, saveHostData, saveWebrtcState, loadGuestData, loadHostData, loadWebrtcState, getRestorableSessionType, clearWebrtcData, broadcastHostPeerId, getHostPeerIdForGame, clearHostPeerIdBroadcast } from '../host/WebrtcStatePersistence'

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
  // Store the validated URL for link sharing
  localStorage.setItem('websocket_url', url)
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
          // CRITICAL: Only assign LastPlayed status if the card is owned by this player
          // For dummy players, we check the actual card ownership (ownerId)
          if (card.ownerId !== player.id) {
            // Card exists on board but belongs to a different player
            // Skip this card and continue searching
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
 * Accumulates score change deltas for each player.
 * When player score changes rapidly (within 500ms), deltas are accumulated
 * and sent to server as a single message with the total delta.
 */
const scoreDeltaAccumulator = new Map<number, { delta: number, timerId: ReturnType<typeof setTimeout> }>()

/**
 * Sync card data (imageUrl, fallbackImage) from database
 * This is needed after restoring from localStorage or receiving state from server
 */
const syncCardImages = (card: any): any => {
  if (!card || !rawJsonData) {return card}
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
  if (!rawJsonData) {return gameState}

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
    players: syncedPlayers,
    // Ensure visual effects arrays exist (for backwards compatibility)
    floatingTexts: gameState.floatingTexts || [],
    highlights: gameState.highlights || [],
  }
}

// Save full game state to localStorage (persists across tab close/reopen)
// Restore logic based on navigation type:
// - Normal reload (F5) - restore state
// - Hard reload (Shift+F5, Ctrl+Shift+R) - DON'T restore
// - Tab close/reopen - restore state
// - Browser cache clear - DON'T restore (localStorage is cleared)
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
    // Use localStorage to persist across tab close/reopen
    localStorage.setItem(GAME_STATE_KEY, JSON.stringify(data))
    // Also update reconnection_data for backward compatibility
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

// Load game state from localStorage
const loadGameState = (): { gameState: GameState; localPlayerId: number; playerToken?: string } | null => {
  try {
    const stored = localStorage.getItem(GAME_STATE_KEY)
    if (!stored) {return null}
    const data = JSON.parse(stored)
    // Check if state is not too old (24 hours max)
    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - data.timestamp > maxAge) {
      localStorage.removeItem(GAME_STATE_KEY)
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
  localStorage.removeItem(GAME_STATE_KEY)
  localStorage.removeItem(RECONNECTION_DATA_KEY)
}

interface UseGameStateProps {
  abilityMode?: AbilityAction | null;
  setAbilityMode?: React.Dispatch<React.SetStateAction<AbilityAction | null>>;
}

export const useGameState = (props: UseGameStateProps = {}) => {
  const { abilityMode, setAbilityMode } = props;
  const createDeck = useCallback((deckType: DeckType, playerId: number, playerName: string): Card[] => {
    // Use getDecksData() to always get fresh data instead of cached import
    const currentDecksData = getDecksData()

    // Handle "Random" deck type - use first available deck
    let actualDeckType = deckType
    if (deckType === 'Random' || !currentDecksData[deckType]) {
      const deckKeys = Object.keys(currentDecksData)
      if (deckKeys.length === 0) {
        console.error('[createDeck] No decks loaded yet!')
        return []
      }
      actualDeckType = deckKeys[0] as DeckType
      if (deckType === 'Random') {
        console.log(`[createDeck] Random deck selected, using ${actualDeckType} instead`)
      } else {
        console.warn(`[createDeck] Deck ${deckType} not found, using ${actualDeckType} instead`)
      }
    }

    const deck = currentDecksData[actualDeckType]
    if (!deck) {
      console.error(`Deck data for ${actualDeckType} not loaded! Returning empty deck. Available decks:`, Object.keys(currentDecksData))
      return []
    }
    const deckWithOwner = [...deck].map(card => ({ ...card, ownerId: playerId, ownerName: playerName }))
    return shuffleDeck(deckWithOwner)
  }, [])

  const createNewPlayer = useCallback((id: number, isDummy = false): Player => {
    // Use getDecksData() to always get fresh data instead of cached import
    const currentDecksData = getDecksData()
    const deckKeys = Object.keys(currentDecksData)
    if (deckKeys.length === 0) {
      console.error('[createNewPlayer] No decks loaded yet!')
      // Return minimal player without deck
      return {
        id,
        name: isDummy ? `Dummy ${id - 1}` : `Player ${id}`,
        score: 0,
        hand: [],
        deck: [],
        discard: [],
        announcedCard: null,
        selectedDeck: 'Damanaki' as DeckType,
        color: PLAYER_COLOR_NAMES[id - 1] || 'blue',
        isDummy,
        isReady: false,
        boardHistory: [],
        autoDrawEnabled: true,
      }
    }

    const initialDeckType = deckKeys[0] as DeckType
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
    spectators: [],
    board: createInitialBoard(),
    activeGridSize: 7,
    gameId: null,
    hostId: 1, // Default to player 1 as host
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
    floatingTexts: [],
    highlights: [],
    deckSelections: [],
    handCardSelections: [],
    targetingMode: null,
    localPlayerId: null,
    isSpectator: false,
  }), [])

  const [gameState, setGameState] = useState<GameState>(createInitialState)

  // Previous state ref for delta calculation
  const prevStateRef = useRef<GameState>(createInitialState)

  // Wrapper for setGameState that broadcasts delta in WebRTC mode
  const setGameStateWithDelta = useCallback((updater: React.SetStateAction<GameState>, sourcePlayerId?: number) => {
    setGameState(prevState => {
      const newState = typeof updater === 'function' ? (updater as (prev: GameState) => GameState)(prevState) : updater

      // Update previous state ref
      prevStateRef.current = prevState

      // In WebRTC host mode, broadcast delta to guests
      const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'
      if (isWebRTCMode && webrtcIsHostRef.current) {
        // Schedule delta broadcast after state update (use setTimeout to avoid blocking)
        setTimeout(() => {
          const delta = createDeltaFromStates(prevState, newState, sourcePlayerId || localPlayerIdRef.current || 0)
          if (!isDeltaEmpty(delta) && webrtcManagerRef.current) {
            webrtcManagerRef.current.broadcastStateDelta(delta)
            logger.debug(`[setGameStateWithDelta] Broadcast delta: phase=${!!delta.phaseDelta}, round=${!!delta.roundDelta}, board=${delta.boardCells?.length || 0}, players=${Object.keys(delta.playerDeltas || {}).length}`)
          }
        }, 0)
      }

      return newState
    })
  }, [])

  const [localPlayerId, setLocalPlayerId] = useState<number | null>(null)
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting')
  const [gamesList, setGamesList] = useState<{gameId: string, playerCount: number}[]>([])
  const [latestHighlight, setLatestHighlight] = useState<HighlightData | null>(null)
  const [latestFloatingTexts, setLatestFloatingTexts] = useState<FloatingTextData[] | null>(null)
  const [latestNoTarget, setLatestNoTarget] = useState<{coords: {row: number, col: number}, timestamp: number} | null>(null)
  const [latestDeckSelections, setLatestDeckSelections] = useState<DeckSelectionData[]>([])
  const [latestHandCardSelections, setLatestHandCardSelections] = useState<HandCardSelectionData[]>([])
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
  const [reconnectProgress, setReconnectProgress] = useState<{ attempt: number; maxAttempts; timeRemaining: number } | null>(null)
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

    // Check if there's a restorable session
    const sessionType = getRestorableSessionType()
    if (sessionType === 'none') {
      logger.info('[Auto-restore] No restorable session found')
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
          }, 100)

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
              // Don't clear data - let the reconnection system handle it
              isRestoringSessionRef.current = false
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

  const gameStateRef = useRef(gameState)
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  const localPlayerIdRef = useRef(localPlayerId)
  useEffect(() => {
    localPlayerIdRef.current = localPlayerId
  }, [localPlayerId])

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
  const handleWebrtcGuestJoin = useCallback((guestPeerId: string) => {
    logger.info(`[handleWebrtcGuestJoin] Called for guest ${guestPeerId}, isHost: ${webrtcIsHostRef.current}`)
    if (!webrtcIsHostRef.current || !webrtcManagerRef.current) {
      logger.warn('[handleWebrtcGuestJoin] Not a host or manager not initialized')
      return
    }

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

      // Create new player
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
        selectedDeck: 'Random' as DeckType,
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

      // Broadcast deck selection of new player to all existing guests
      webrtcManagerRef.current!.broadcastToGuests({
        type: 'SYNC_DECK_SELECTIONS',
        senderId: webrtcManagerRef.current!.getPeerId(),
        data: {
          playerId: newPlayerId,
          selectedDeck: 'Random',  // Default deck, will be updated by guest
        },
        timestamp: Date.now()
      })

      logger.info(`[handleWebrtcGuestJoin] Added player ${newPlayerId} for guest ${guestPeerId}`)

      return newState
    })
  }, [])

  /**
   * Create optimized state for WebRTC broadcasting
   * Only includes necessary data, not full card arrays for privacy and size
   * CRITICAL: Never send full card arrays - only sizes - to avoid WebRTC message size limit
   */
  const createOptimizedStateForBroadcast = useCallback((fullState: GameState, excludePlayerHand = true): GameState => {
    // Create a lightweight version of the state
    // Only send SIZES, not full card arrays (for privacy and bandwidth)
    const optimizedState: GameState = {
      ...fullState,
      // Optimize players: NEVER send full hands, decks, or discards - only sizes!
      players: fullState.players.map(p => {
        const isDummy = p.isDummy || false

        // For dummy players, we need to send actual card data (or at least correct sizes)
        // because all players see dummy cards
        // For real players, send only sizes (privacy)
        if (isDummy) {
          // Dummy players - send minimal card data but correct sizes
          // Still skip heavy fields like flavorText, fallbackImage
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
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            isDummy: true,
            isReady: p.isReady,
            score: p.score,
            isDisconnected: p.isDisconnected,
            selectedDeck: p.selectedDeck,
            autoDrawEnabled: p.autoDrawEnabled,
            boardHistory: p.boardHistory,
            announcedCard: null,
            // Send actual (but minimized) card data for dummy players
            hand: optimizeCards(p.hand || []),
            deck: optimizeCards(p.deck || []),
            discard: optimizeCards(p.discard || []),
            // Also include size metadata for consistency
            handSize: p.hand.length,
            deckSize: p.deck.length,
            discardSize: p.discard.length,
          }
        }

        // Real players - send only sizes
        const optimizedPlayer: typeof p = {
          id: p.id,
          name: p.name,
          color: p.color,
          isDummy: p.isDummy,
          isReady: p.isReady,
          score: p.score,
          isDisconnected: p.isDisconnected,
          selectedDeck: p.selectedDeck,
          autoDrawEnabled: p.autoDrawEnabled,
          boardHistory: p.boardHistory,
          announcedCard: null, // Never send announced card (privacy)
          // CRITICAL: Empty arrays for all card collections - only sizes matter!
          hand: [], // Never send hand (privacy + size)
          deck: [], // Never send deck (size limit)
          discard: [], // Never send discard (size limit)
          // Size metadata for UI to display card counts
          // Prefer explicit size properties if they exist (for already-optimized states)
          handSize: (p as any).handSize ?? p.hand.length,
          deckSize: (p as any).deckSize ?? p.deck.length,
          discardSize: (p as any).discardSize ?? p.discard.length,
        }

        return optimizedPlayer
      }),
    }

    // Also clear board cards - send only board structure with card IDs, not full card data
    // This is critical for staying under WebRTC message size limit
    optimizedState.board = fullState.board.map(row =>
      row.map(cell => ({
        ...cell,
        // Only send minimal card info - id and owner, not full card data
        card: cell.card ? {
          id: cell.card.id,
          baseId: cell.card.baseId,
          ownerId: cell.card.ownerId,
          name: cell.card.name,
          imageUrl: cell.card.imageUrl,
          power: cell.card.power,
          ability: cell.card.ability,
          isFaceDown: cell.card.isFaceDown,
          // Omit heavy data: fallbackImage, flavorText, types, etc.
        } : null
      }))
    )

    return optimizedState
  }, [])

  /**
   * Broadcast game state via WebRTC (host only)
   * Sends optimized state without private card data
   */
  const broadcastWebrtcState = useCallback((newState: GameState) => {
    const isHost = webrtcIsHostRef.current
    logger.info(`[broadcastWebrtcState] Called: webrtcManagerRef.current=${!!webrtcManagerRef.current}, webrtcIsHostRef.current=${isHost}`)
    if (!webrtcManagerRef.current || !isHost) {
      logger.warn('[broadcastWebrtcState] Skipping broadcast: manager or isHost missing')
      return
    }

    // Create optimized state (don't send full hands for privacy and size)
    const optimizedState = createOptimizedStateForBroadcast(newState, true)

    webrtcManagerRef.current.broadcastGameState(optimizedState)
    logger.info('[broadcastWebrtcState] Broadcasted optimized state')
  }, [createOptimizedStateForBroadcast])

  /**
   * Broadcast state delta via WebRTC (host only)
   * Compares old and new state, broadcasts only changes
   * More efficient than full state broadcasts
   */
  const broadcastWebrtcDelta = useCallback((oldState: GameState, newState: GameState, sourcePlayerId: number) => {
    if (!webrtcManagerRef.current || !webrtcIsHostRef.current) {return}

    const delta = createDeltaFromStates(oldState, newState, sourcePlayerId)

    if (!isDeltaEmpty(delta)) {
      webrtcManagerRef.current.broadcastStateDelta(delta)
      logger.debug(`[broadcastWebrtcDelta] Broadcast delta: phase=${!!delta.phaseDelta}, round=${!!delta.roundDelta}, board=${delta.boardCells?.length || 0}, players=${Object.keys(delta.playerDeltas || {}).length}`)
    }
  }, [])

  /**
   * Send state delta to host (guest only)
   * Guest sends their local changes to host for rebroadcasting
   */
  const sendDeltaToHost = useCallback((oldState: GameState, newState: GameState) => {
    if (!webrtcManagerRef.current || webrtcIsHostRef.current) {return} // Only guests send to host

    const delta = createDeltaFromStates(oldState, newState, localPlayerIdRef.current || 0)

    if (!isDeltaEmpty(delta)) {
      webrtcManagerRef.current.sendStateDelta(delta)
      logger.debug(`[sendDeltaToHost] Sent delta to host`)
    }
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

          // Send deck selection to host
          const localPlayer = minimalState.players.find(p => p.id === message.playerId)
          if (localPlayer && webrtcManagerRef.current) {
            webrtcManagerRef.current.sendAction('CHANGE_PLAYER_DECK', {
              playerId: message.playerId,
              deckType: localPlayer.selectedDeck
            })
            logger.info(`[JOIN_ACCEPT_MINIMAL] Sent deck selection to host: ${localPlayer.selectedDeck}`)
          }

          // Save guest connection data for page reload recovery
          try {
            const hostPeerId = webrtcManagerRef.current?.getHostPeerId()
            if (hostPeerId) {
              saveGuestData({
                hostPeerId,
                playerId: message.playerId,
                playerName: localPlayer?.name || null,
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
              const localPlayer = remoteState.players.find(p => p.id === message.playerId)
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

      case 'STATE_UPDATE':
        // Host broadcasted state update
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
            const mergedPlayers = remoteState.players.map(remotePlayer => {
              const localPlayer = currentState.players.find(p => p.id === remotePlayer.id)

              if (remotePlayer.id === localPlayerIdRef.current && localPlayer) {
                // This is the local player
                // If local player just joined (hand is empty or has only placeholders), use remote hand
                // Otherwise preserve local hand (privacy - host might not have our actual cards)
                const hasOnlyPlaceholders = localPlayer.hand.every(c => c.isPlaceholder) || localPlayer.hand.length === 0

                // Get expected sizes from remote state (host's authoritative sizes)
                const remoteHandSize = remotePlayer.handSize ?? remotePlayer.hand?.length ?? 0
                const remoteDeckSize = remotePlayer.deckSize ?? remotePlayer.deck?.length ?? 0

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

      case 'JOIN_REQUEST':
        // Guest wants to join (host only)
        logger.info(`[handleWebrtcMessage] Received JOIN_REQUEST, senderId: ${message.senderId}, isHost: ${webrtcIsHostRef.current}`)
        if (webrtcIsHostRef.current && message.senderId) {
          logger.info(`Host received JOIN_REQUEST from ${message.senderId}`)
          handleWebrtcGuestJoin(message.senderId)
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
              const mergedPlayers = guestState.players.map(guestPlayer => {
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
            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p => p.id === actionData.playerId ? { ...p, color: actionData.color } : p),
            }))
          } else if (actionType === 'UPDATE_PLAYER_SCORE' && actionData?.playerId !== undefined && actionData?.delta !== undefined) {
            setGameState(prev => ({
              ...prev,
              players: prev.players.map(p =>
                p.id === actionData.playerId ? { ...p, score: Math.max(0, p.score + actionData.delta) } : p
              ),
            }))
          } else if (actionType === 'CHANGE_PLAYER_DECK' && actionData?.playerId !== undefined && actionData?.deckType !== undefined) {
            setGameState(prev => {
              const player = prev.players.find(p => p.id === actionData.playerId)
              if (!player) {return prev}

              // Create the deck for this player based on their deck type selection
              // The guest creates their own deck locally, host needs to create it too for tracking
              const deckData = createDeck(actionData.deckType, actionData.playerId, player.name)
              logger.info(`[CHANGE_PLAYER_DECK] Host created deck for player ${actionData.playerId} with ${deckData.length} cards from ${actionData.deckType}`)

              return {
                ...prev,
                players: prev.players.map(p =>
                  p.id === actionData.playerId
                    ? { ...p, selectedDeck: actionData.deckType, deck: deckData }
                    : p
                ),
              }
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
                // Create delta for the changes
                const delta = createDeltaFromStates(prev, newState, actionData.playerId)
                webrtcManagerRef.current.broadcastStateDelta(delta)
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
          // Send current game state to the reconnecting guest
          const currentState = gameStateRef.current
          logger.info(`[PLAYER_RECONNECT] Current state: hasGameId=${!!currentState?.gameId}, gameId=${currentState?.gameId}, hasPlayers=${currentState?.players?.length || 0}`)
          if (currentState && currentState.gameId) {
            logger.info(`[PLAYER_RECONNECT] Sending current state to reconnecting player ${message.playerId}`)
            webrtcManagerRef.current?.sendToGuest(message.senderId, {
              type: 'STATE_UPDATE',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: { gameState: currentState },
              timestamp: Date.now()
            })
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
        // Player changed deck selection - broadcast to all
        logger.info('[CHANGE_PLAYER_DECK] Received deck change', message.data)
        if (webrtcIsHostRef.current && message.data) {
          // Host: apply and broadcast to all guests
          setGameState(prev => {
            const player = prev.players.find(p => p.id === message.data.playerId)
            if (!player) {return prev}

            // Create the deck for this player based on their deck type selection
            const deckData = createDeck(message.data.deckType, message.data.playerId, player.name)
            logger.info(`[CHANGE_PLAYER_DECK] Host created deck for player ${message.data.playerId} with ${deckData.length} cards from ${message.data.deckType}`)

            return {
              ...prev,
              players: prev.players.map(p =>
                p.id === message.data.playerId
                  ? { ...p, selectedDeck: message.data.deckType, deck: deckData }
                  : p
              ),
            }
          })
          // Broadcast to all guests
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'CHANGE_PLAYER_DECK',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: message.data,
              timestamp: Date.now()
            })
          }
        } else {
          // Guest: just apply locally (already handled by ACTION case above)
          setGameState(prev => ({
            ...prev,
            players: prev.players.map(p =>
              p.id === message.data.playerId ? { ...p, selectedDeck: message.data.deckType } : p
            ),
          }))
        }
        break

      case 'GAME_RESET':
        // Handle game reset message (from host in WebRTC mode)
        logger.info('[GameReset] Received GAME_RESET message via WebRTC')
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
            currentCommand: null,
            validTargets: [],
          }
          gameStateRef.current = resetState
          logger.info('[GameReset] Game reset complete in WebRTC mode')
          return resetState
        })
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

      // Visual effects messages (for P2P mode)
      case 'TRIGGER_HIGHLIGHT':
        if (message.data?.highlightData) {
          setLatestHighlight(message.data.highlightData)
        }
        break

      case 'TRIGGER_FLOATING_TEXT':
        if (message.data?.textData) {
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, message.data.textData].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        }
        break

      case 'TRIGGER_FLOATING_TEXT_BATCH':
        if (message.data?.batch) {
          setGameState(prev => ({
            ...prev,
            floatingTexts: [...prev.floatingTexts, ...message.data.batch].filter(t => Date.now() - t.timestamp < TIMING.FLOATING_TEXT_DURATION)
          }))
        }
        break

      case 'TRIGGER_NO_TARGET':
        if (message.data?.coords) {
          setLatestNoTarget({ coords: message.data.coords, timestamp: message.data.timestamp })
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

      case 'RECONNECT_REJECT':
        // Host rejected our reconnection (timeout or game over)
        const rejectReason = message.data?.reason || 'unknown'
        logger.warn(`[Reconnection] Reconnection rejected: ${rejectReason}`)
        setConnectionStatus('Disconnected')
        // Clear stored data
        try {
          localStorage.removeItem('webrtc_reconnection_data')
        } catch (e) {}
        break

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
        // Timeout expired
        logger.warn('[Reconnection] Reconnection timeout expired')
        setIsReconnecting(false)
        setReconnectProgress(null)
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

  /**
   * Initialize WebRTC as host
   */
  const initializeWebrtcHost = useCallback(async (): Promise<string | null> => {
    if (!webrtcManagerRef.current) {
      logger.error('WebRTC manager not initialized')
      return null
    }

    try {
      setWebrtcIsHost(true)
      setConnectionStatus('Connecting')
      const peerId = await webrtcManagerRef.current.initializeAsHost()
      setWebrtcHostId(peerId)  // Store host peer ID for invite links
      setConnectionStatus('Connected')

      // Broadcast peerId immediately so guests can discover/reconnect
      const currentGameId = gameStateRef.current.gameId
      if (currentGameId) {
        broadcastHostPeerId(peerId, currentGameId)
      }

      // Save host data for auto-restore after F5
      const localPlayer = gameStateRef.current.players?.find(p => p.id === localPlayerIdRef.current)
      saveHostData({
        peerId,
        isHost: true,
        playerName: localPlayer?.name || null
      })
      logger.info('[initializeWebrtcHost] Saved host data for auto-restore')

      return peerId
    } catch (err) {
      logger.error('Failed to initialize WebRTC host:', err)
      setConnectionStatus('Disconnected')
      return null
    }
  }, [])

  /**
   * Connect as guest to host via WebRTC
   */
  const connectAsGuest = useCallback(async (hostId: string): Promise<boolean> => {
    if (!webrtcManagerRef.current) {
      logger.error('WebRTC manager not initialized')
      return false
    }

    try {
      setWebrtcIsHost(false)
      setConnectionStatus('Connecting')
      await webrtcManagerRef.current.initializeAsGuest(hostId)
      return true
    } catch (err) {
      logger.error('Failed to connect as guest:', err)
      setConnectionStatus('Disconnected')
      return false
    }
  }, [])

  /**
   * Send action to host via WebRTC (guest only)
   */
  const sendWebrtcAction = useCallback((actionType: string, actionData: any) => {
    if (!webrtcManagerRef.current || webrtcIsHostRef.current) {return false}
    return webrtcManagerRef.current.sendAction(actionType, actionData)
  }, [])

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
        const delta = createDeltaFromStates(prevState, newState, localPlayerIdRef.current || 0)
        logger.info(`[updateState] WebRTC enabled, isHost=${webrtcIsHostRef.current}, delta: boardCells=${delta.boardCells?.length || 0}, playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, phase=${!!delta.phaseDelta}`)

        if (webrtcIsHostRef.current) {
          // Host broadcasts delta to all guests (efficient)
          if (!isDeltaEmpty(delta)) {
            webrtcManagerRef.current.broadcastStateDelta(delta)
            logger.info(`[updateState] Host broadcast delta: phase=${!!delta.phaseDelta}, board=${delta.boardCells?.length || 0}`)
          }
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
          // Guest sends delta to host (which will then broadcast to all)
          if (!isDeltaEmpty(delta)) {
            const success = webrtcManagerRef.current.sendStateDelta(delta)
            logger.info(`[updateState] Guest sent delta to host: success=${success}, boardCells=${delta.boardCells?.length || 0}`)
          } else {
            logger.debug('[updateState] Delta empty, skipping send')
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
              currentCommand: null,
              validTargets: [],
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
        logger.info(`JoinGame: Sending reconnection with token ${reconnectionData.playerToken.substring(0, 8)}... for player ${reconnectionData.playerId}`)
      } else {
        logger.info(`JoinGame: No reconnection data or gameId mismatch. storedGameId=${reconnectionData?.gameId}, requestedGameId=${gameId}`)
      }
      ws.current.send(JSON.stringify(payload))
    } else {
      connectWebSocket()
      joiningGameIdRef.current = gameId
    }
  }, [connectWebSocket])

  // Join game via Join Game modal - sets flag to show "already started" error if needed
  const joinGameViaModal = useCallback((gameId: string): void => {
    isJoinAttemptRef.current = true
    joinGame(gameId)
  }, [joinGame])

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

    if (hasInviteLink) {
      logger.info('[inviteLinks] Invite link detected, skipping state restoration for fresh join')
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

  const createGame = useCallback(() => {
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
    }, 100)

  }, [createInitialState, connectWebSocket])

  // ... (startReadyCheck, cancelReadyCheck, playerReady, assignTeams, setGameMode, setGamePrivacy, syncGame, setActiveGridSize, setDummyPlayerCount methods kept as is) ...
  const startReadyCheck = useCallback(() => {
    // Check localStorage directly for WebRTC mode (more reliable than state)
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current) {
      logger.info('[startReadyCheck] Starting ready check via WebRTC')
      // Update local state
      setGameState(prev => ({ ...prev, isReadyCheckActive: true, isPrivate: true }))
      // Broadcast only the flags, not full gameState (to avoid size limit)
      webrtcManagerRef.current.broadcastToGuests({
        type: 'START_READY_CHECK',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { isReadyCheckActive: true, isPrivate: true },
        timestamp: Date.now()
      })
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'START_READY_CHECK', gameId: gameStateRef.current.gameId }))
    }
  }, [webrtcIsHostRef])

  const cancelReadyCheck = useCallback(() => {
    // Check localStorage directly for WebRTC mode
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current) {
      logger.info('[cancelReadyCheck] Cancelling ready check via WebRTC')
      // Update local state
      setGameState(prev => ({ ...prev, isReadyCheckActive: false }))
      // Broadcast only the flag (to avoid size limit)
      webrtcManagerRef.current.broadcastToGuests({
        type: 'CANCEL_READY_CHECK',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { isReadyCheckActive: false },
        timestamp: Date.now()
      })
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'CANCEL_READY_CHECK', gameId: gameStateRef.current.gameId }))
    } else {
      // When disconnected, cancel locally only
      setGameState(prev => ({ ...prev, isReadyCheckActive: false }))
    }
  }, [webrtcIsHostRef])

  const playerReady = useCallback(() => {
    // Check localStorage directly for WebRTC mode (more reliable than state)
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode - host
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current && localPlayerIdRef.current !== null) {
      logger.info('[playerReady] Host marking self as ready via WebRTC')
      // Mark self as ready locally and check if all players are ready
      setGameState(prev => {
        const updatedPlayers = prev.players.map(p =>
          p.id === localPlayerIdRef.current ? { ...p, isReady: true } : p
        )
        const newState = { ...prev, players: updatedPlayers }

        // Check if all real players are ready
        const realPlayers = newState.players.filter(p => !p.isDummy && !p.isDisconnected)
        const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady)

        if (allReady && newState.isReadyCheckActive && !newState.isGameStarted) {
          logger.info('[playerReady] All players ready! Starting game...')
          // All players ready - start the game!
          const allPlayers = newState.players.filter(p => !p.isDisconnected)
          const randomIndex = Math.floor(Math.random() * allPlayers.length)
          const startingPlayerId = allPlayers[randomIndex].id

          // Draw initial hands for ALL players (host does this for everyone, guests draw themselves)
          const finalState = { ...newState }
          finalState.isReadyCheckActive = false
          finalState.isGameStarted = true
          finalState.startingPlayerId = startingPlayerId
          finalState.activePlayerId = startingPlayerId
          finalState.currentPhase = 0  // Preparation phase

          // Draw cards for each player (including host)
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

              logger.info(`[playerReady] Drew initial ${newHand.length} cards for player ${player.id}, deck now has ${newDeck.length} cards`)
              return { ...player, hand: newHand, deck: newDeck }
            }
            return player
          })

          // Perform Preparation phase for starting player (draws 7th card and transitions to Setup)
          const startingPlayer = finalState.players.find(p => p.id === startingPlayerId)
          if (startingPlayer && startingPlayer.deck.length > 0) {
            // Draw 7th card for starting player
            const drawnCard = startingPlayer.deck[0]
            const newDeck = [...startingPlayer.deck.slice(1)]
            const newHand = [...startingPlayer.hand, drawnCard]

            finalState.players = finalState.players.map(p =>
              p.id === startingPlayerId
                ? { ...p, deck: newDeck, hand: newHand, readySetup: false, readyCommit: false }
                : p
            )

            // Transition to Setup phase
            finalState.currentPhase = 1
            logger.info(`[playerReady] Preparation phase: Starting player ${startingPlayerId} drew 7th card, now in Setup phase (${finalState.currentPhase})`)
          }

          // Use createDeltaFromStates to automatically detect all changes
          // This is more reliable than manually creating the delta
          const initialDrawDelta = createDeltaFromStates(newState, finalState, localPlayerIdRef.current || 0)
          logger.info(`[playerReady] Created delta with ${Object.keys(initialDrawDelta.playerDeltas || {}).length} player changes, phaseDelta=${!!initialDrawDelta.phaseDelta}, roundDelta=${!!initialDrawDelta.roundDelta}`)
          logger.info(`[playerReady] Delta content:`, JSON.stringify(initialDrawDelta, null, 2))
          logger.info(`[playerReady] isDeltaEmpty result:`, isDeltaEmpty(initialDrawDelta))

          // Broadcast game start notification first (for immediate UI feedback)
          webrtcManagerRef.current!.broadcastToGuests({
            type: 'GAME_START',
            senderId: webrtcManagerRef.current!.getPeerId(),
            data: {
              startingPlayerId,
              activePlayerId: startingPlayerId,
              isGameStarted: true,
              isReadyCheckActive: false
            },
            timestamp: Date.now()
          })

          // Then broadcast the delta (efficient - only size changes, not full hands)
          setTimeout(() => {
            const emptyCheck = isDeltaEmpty(initialDrawDelta)
            logger.info(`[playerReady] Timeout callback - isDeltaEmpty: ${emptyCheck}`)
            if (!emptyCheck) {
              webrtcManagerRef.current!.broadcastStateDelta(initialDrawDelta)
              logger.info('[playerReady] Broadcasted initial draw delta to guests')
            } else {
              logger.warn('[playerReady] Delta is empty, NOT broadcasting!')
            }
          }, 50)

          return finalState
        }

        // Broadcast ready status to guests (if not all ready)
        webrtcManagerRef.current!.broadcastToGuests({
          type: 'HOST_READY',
          senderId: webrtcManagerRef.current!.getPeerId(),
          playerId: localPlayerIdRef.current,
          timestamp: Date.now()
        })

        return newState
      })
      return
    }

    // WebRTC P2P mode - guest
    if (isWebRTCMode && webrtcManagerRef.current && !webrtcIsHostRef.current && localPlayerIdRef.current !== null) {
      logger.info('[playerReady] Guest sending PLAYER_READY via WebRTC')
      webrtcManagerRef.current.sendMessageToHost({
        type: 'PLAYER_READY',
        senderId: webrtcManagerRef.current.getPeerId(),
        playerId: localPlayerIdRef.current,
        timestamp: Date.now()
      })
      // Mark self as ready locally
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p =>
          p.id === localPlayerIdRef.current ? { ...p, isReady: true } : p
        )
      }))
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId && localPlayerIdRef.current !== null) {
      ws.current.send(JSON.stringify({ type: 'PLAYER_READY', gameId: gameStateRef.current.gameId, playerId: localPlayerIdRef.current }))
    }
  }, [webrtcIsHostRef, broadcastWebrtcState])

  const assignTeams = useCallback((teamAssignments: Record<number, number[]>) => {
    // Check localStorage directly for WebRTC mode
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current) {
      logger.info('[assignTeams] Assigning teams via WebRTC')
      // Update player teamIds locally
      setGameState(prev => {
        const updatedPlayers = prev.players.map(p => {
          // Find which team this player is in
          let teamId = 1
          for (const [team, playerIds] of Object.entries(teamAssignments)) {
            if (playerIds.includes(p.id)) {
              teamId = parseInt(team)
              break
            }
          }
          return { ...p, teamId }
        })
        return { ...prev, players: updatedPlayers }
      })
      // Broadcast only assignments (to avoid size limit)
      webrtcManagerRef.current.broadcastToGuests({
        type: 'ASSIGN_TEAMS',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { assignments: teamAssignments },
        timestamp: Date.now()
      })
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'ASSIGN_TEAMS', gameId: gameStateRef.current.gameId, assignments: teamAssignments }))
    }
  }, [webrtcIsHostRef])

  const setGameMode = useCallback((mode: GameModeEnum) => {
    // Check localStorage directly for WebRTC mode
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current) {
      logger.info('[setGameMode] Setting game mode via WebRTC')
      // Update local state
      setGameState(prev => ({ ...prev, gameMode: mode }))
      // Broadcast only mode value (to avoid size limit)
      webrtcManagerRef.current.broadcastToGuests({
        type: 'SET_GAME_MODE',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { mode },
        timestamp: Date.now()
      })
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_MODE', gameId: gameStateRef.current.gameId, mode }))
    }
  }, [webrtcIsHostRef])

  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    // Check localStorage directly for WebRTC mode
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // WebRTC P2P mode
    if (isWebRTCMode && webrtcManagerRef.current && webrtcIsHostRef.current) {
      logger.info('[setGamePrivacy] Setting game privacy via WebRTC')
      // Update local state
      setGameState(prev => ({ ...prev, isPrivate }))
      // Broadcast only flag (to avoid size limit)
      webrtcManagerRef.current.broadcastToGuests({
        type: 'SET_GAME_PRIVACY',
        senderId: webrtcManagerRef.current.getPeerId(),
        data: { isPrivate },
        timestamp: Date.now()
      })
      return
    }
    // WebSocket server mode
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({ type: 'SET_GAME_PRIVACY', gameId: gameStateRef.current.gameId, isPrivate }))
    }
  }, [webrtcIsHostRef])

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

  const setActiveGridSize = useCallback((size: GridSize) => {
    updateState(currentState => {
      if (currentState.isGameStarted) {
        return currentState
      }
      const newState = { ...currentState, activeGridSize: size }

      // Recreate board if size changed to ensure proper dimensions
      const currentSize = currentState.board.length
      if (currentSize !== size) {
        // Create new board with the new size
        newState.board = []
        for (let i = 0; i < size; i++) {
          const row: any[] = []
          for (let j = 0; j < size; j++) {
            row.push({ card: null })
          }
          newState.board.push(row)
        }
      } else {
        newState.board = recalculateBoardStatuses(newState)
      }
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
      // Find the highest player ID and increment from there
      const maxId = Math.max(...realPlayers.map(p => p.id), 0)
      for (let i = 0; i < count; i++) {
        const dummyId = maxId + i + 1
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
      const newState: GameState = deepCloneState(currentState)
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

        if (['Support', 'Threat', 'Revealed', 'Shield'].includes(status)) {
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
      const player = newState.players.find(p => p.id === playerId)
      if (player?.hand[cardIndex]) {
        const card = player.hand[cardIndex]
        // Check for duplicate statuses that should only exist once per player
        if (['Support', 'Threat', 'Revealed', 'Shield', 'Resurrected'].includes(status)) {
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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

  const changePlayerDeck = useCallback((playerId: number, deckType: DeckType) => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

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

    // In WebRTC mode, also send deck change to host for broadcasting
    if (isWebRTCMode && !webrtcIsHostRef.current && sendWebrtcAction) {
      sendWebrtcAction('CHANGE_PLAYER_DECK', { playerId, deckType })
      logger.info(`[changePlayerDeck] Sent deck change to host: player ${playerId}, deck ${deckType}`)
    }
  }, [updateState, createDeck, sendWebrtcAction])

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
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      const cardDrawn = playerToUpdate.deck.shift()
      if (cardDrawn) {
        playerToUpdate.hand.push(cardDrawn)
      }
      return newState
    })
  }, [updateState])

  // Batch version of drawCard - draws multiple cards in a single state update
  // This prevents multiple UPDATE_STATE messages and race conditions with server sync
  const drawCardsBatch = useCallback((playerId: number, count: number) => {
    if (count <= 0) {return}
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const player = currentState.players.find(p => p.id === playerId)
      if (!player || player.deck.length === 0) {
        return currentState
      }
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      // Draw up to 'count' cards (or as many as available)
      const cardsToDraw = Math.min(count, playerToUpdate.deck.length)
      for (let i = 0; i < cardsToDraw; i++) {
        const cardDrawn = playerToUpdate.deck.shift()
        if (cardDrawn) {
          playerToUpdate.hand.push(cardDrawn)
        }
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
      const newState = deepCloneState(currentState)
      const playerToUpdate = newState.players.find((p: Player) => p.id === playerId)!
      playerToUpdate.deck = shuffleDeck(playerToUpdate.deck)
      return newState
    })
  }, [updateState])

  const toggleActivePlayer = useCallback((playerId: number) => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    if (isWebRTCMode && webrtcManagerRef.current) {
      // WebRTC P2P mode
      if (webrtcIsHostRef.current) {
        // Host: process locally using toggleActivePlayer from PhaseManagement
        logger.info(`[toggleActivePlayer] Host toggling active player to ${playerId}`)
        setGameState(prev => {
          // Use the imported toggleActivePlayer function from PhaseManagement
          const newState = toggleActivePlayerPhase(prev, playerId)
          // Broadcast to guests via WebRTC
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.broadcastToGuests({
              type: 'ACTIVE_PLAYER_CHANGED',
              senderId: webrtcManagerRef.current.getPeerId(),
              data: {
                activePlayerId: newState.activePlayerId,
                currentPhase: newState.currentPhase,
                turnNumber: newState.turnNumber
              },
              timestamp: Date.now()
            })
          }
          return newState
        })
      } else {
        // Guest: send to host
        webrtcManagerRef.current.sendMessageToHost({
          type: 'TOGGLE_ACTIVE_PLAYER',
          senderId: undefined,
          data: { playerId },
          timestamp: Date.now()
        })
        logger.info(`[toggleActivePlayer] Sent TOGGLE_ACTIVE_PLAYER for player ${playerId} via WebRTC`)
      }
    } else if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      // Flush any pending score deltas before toggling active player
      // This ensures server has up-to-date scores for round end check
      scoreDeltaAccumulator.forEach((accumulated, pid) => {
        clearTimeout(accumulated.timerId)
        logger.info(`[ScoreFlush] Flushing on toggle: player=${pid}, delta=${accumulated.delta}`)
        ws.current!.send(JSON.stringify({
          type: 'UPDATE_PLAYER_SCORE',
          gameId: gameStateRef.current.gameId,
          playerId: pid,
          delta: accumulated.delta
        }))
      })
      scoreDeltaAccumulator.clear()

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
    // Check if we need to clear line selection mode
    const isClearingLineSelectionMode = abilityMode && setAbilityMode && abilityMode.mode &&
      ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'].includes(abilityMode.mode);

    if (isClearingLineSelectionMode) {
      setAbilityMode(null);
    }

    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }

      // Allow phases 1-4 (Setup, Main, Commit, Scoring), phase 0 (Preparation) is hidden
      const newPhase = Math.max(1, Math.min(phaseIndex, 4))
      const enteringScoringPhase = newPhase === 4

      // When entering Scoring phase from any phase, enable scoring step
      // This matches the behavior of nextPhase
      // If clearing line selection mode, also close isScoringStep to prevent re-triggering
      return {
        ...currentState,
        currentPhase: newPhase,
        ...(enteringScoringPhase && !isClearingLineSelectionMode ? { isScoringStep: true } : {}),
        ...(isClearingLineSelectionMode ? { isScoringStep: false } : {}),
      }
    })
  }, [updateState, abilityMode, setAbilityMode])

  const nextPhase = useCallback(() => {
    // Always clear line selection modes when changing phase
    if (abilityMode && setAbilityMode && abilityMode.mode) {
      const lineSelectionModes = ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'];
      if (lineSelectionModes.includes(abilityMode.mode)) {
        setAbilityMode(null);
      }
    }

    const currentState = gameStateRef.current
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // When at Scoring phase (4) or in scoring step, send NEXT_PHASE to server
    // Server will handle turn passing and Preparation phase for next player
    // CRITICAL: Only send to server if BOTH conditions are aligned - prevent race conditions
    // where isScoringStep might be true but currentPhase has already changed
    // NOTE: In WebRTC mode, we skip server-side turn passing and handle it locally
    if (currentState.isGameStarted && currentState.currentPhase === 4 && currentState.isScoringStep && !isWebRTCMode) {
      // CRITICAL: Flush any pending score deltas BEFORE passing turn
      // This ensures server has up-to-date scores for round end check
      if (ws.current?.readyState === WebSocket.OPEN) {
        // Send all accumulated score deltas immediately
        scoreDeltaAccumulator.forEach((accumulated, playerId) => {
          clearTimeout(accumulated.timerId)
          logger.info(`[ScoreFlush] Flushing pending score: player=${playerId}, delta=${accumulated.delta}`)
          ws.current!.send(JSON.stringify({
            type: 'UPDATE_PLAYER_SCORE',
            gameId: currentState.gameId,
            playerId: playerId,
            delta: accumulated.delta
          }))
        })
        scoreDeltaAccumulator.clear()

        // Now send NEXT_PHASE
        ws.current.send(JSON.stringify({
          type: 'NEXT_PHASE',
          gameId: currentState.gameId
        }))
      }
      return
    }

    // WebRTC mode: Handle turn passing when at Scoring phase and in scoring step
    // Case 1: Auto-pass turn after finishing Scoring phase
    if (isWebRTCMode && currentState.isGameStarted && currentState.currentPhase === 4 && currentState.isScoringStep) {
      updateState(currentState => {
        // Use passTurnToNextPlayer to properly transition to next player
        // This handles: Preparation phase, card drawing, includes dummy players
        return passTurnToNextPlayer(currentState)
      })
      return
    }

    // For normal phase transitions (1->2, 2->3, 3->4), use local updateState
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)

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

      // When transitioning from Commit (phase 3) to Scoring (phase 4), enable scoring step
      // Case 2: If player has no cards on board during Commit phase, auto-pass turn
      if (isWebRTCMode && nextPhaseIndex === 4 && currentState.currentPhase === 3) {
        // Check if active player has any cards on board
        const hasCards = playerHasCardsOnBoard(currentState, currentState.activePlayerId!)

        if (!hasCards) {
          logger.info(`[nextPhase] Player ${currentState.activePlayerId} has no cards on board in Commit phase, auto-passing turn`)
          // Auto-pass to next player - this will put us in their Preparation phase
          return passTurnToNextPlayer(currentState)
        }

        // Entering Scoring phase from Commit - enable scoring
        newState.isScoringStep = true
        newState.currentPhase = 4
        return newState
      }

      // Non-WebRTC mode: normal transition from Commit to Scoring
      if (nextPhaseIndex === 4 && currentState.currentPhase === 3) {
        // Entering Scoring phase from Commit - enable scoring
        newState.isScoringStep = true
        newState.currentPhase = 4
        return newState
      }

      // Handle Resurrected expiration for normal phase transitions
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
    })
  }, [updateState, abilityMode, setAbilityMode])

  const prevPhase = useCallback(() => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      // Always clear line selection modes when changing phase
      if (abilityMode && setAbilityMode && abilityMode.mode) {
        const lineSelectionModes = ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'INTEGRATOR_LINE_SELECT', 'ZIUS_LINE_SELECT'];
        if (lineSelectionModes.includes(abilityMode.mode)) {
          setAbilityMode(null);
        }
      }

      // If in scoring step, exit it AND move to previous phase (Commit or Setup)
      if (currentState.isScoringStep) {
        return { ...currentState, isScoringStep: false, currentPhase: Math.max(1, currentState.currentPhase - 1) }
      }
      // Otherwise just move to previous phase (but not below Setup/1)
      // Preparation (0) is only accessed via turn passing, not manual navigation
      return {
        ...currentState,
        currentPhase: Math.max(1, currentState.currentPhase - 1),
      }
    })
  }, [updateState, abilityMode, setAbilityMode])

  /**
   * closeRoundEndModal - Start the next round
   * Resets player scores and closes the modal
   * Does optimistic updates for immediate UI feedback
   */
  const closeRoundEndModal = useCallback(() => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    if (isWebRTCMode) {
      // WebRTC mode: Update state locally and broadcast via updateState
      updateState(prev => ({
        ...prev,
        isRoundEndModalOpen: false,
        currentRound: (prev.currentRound || 1) + 1,
        players: prev.players.map(p => ({
          ...p,
          score: 0,
        })),
      }))
    } else if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      // Server mode: Optimistic updates + WebSocket message
      setGameState(prev => ({
        ...prev,
        isRoundEndModalOpen: false,
        currentRound: (prev.currentRound || 1) + 1,
        players: prev.players.map(p => ({
          ...p,
          score: 0,
        })),
      }))

      // Send START_NEXT_ROUND to server to sync with all clients
      ws.current.send(JSON.stringify({
        type: 'START_NEXT_ROUND',
        gameId: gameStateRef.current.gameId,
      }))
    }
  }, [setGameState, updateState])

  /**
   * closeRoundEndModalOnly - Just close the modal (for "Continue Game" button after match ends)
   * Does NOT reset scores or start new round - just lets players view the board
   */
  const closeRoundEndModalOnly = useCallback(() => {
    setGameState(prev => ({
      ...prev,
      isRoundEndModalOpen: false,
    }))
  }, [setGameState])

  /**
   * resetGame - Reset game to lobby state while preserving players and deck selections
   * Supports both WebSocket (server) and WebRTC (P2P) modes
   */
  const resetGame = useCallback(() => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    if (isWebRTCMode) {
      // WebRTC P2P mode: Reset locally and broadcast
      const currentState = gameStateRef.current

      // Create fresh decks for all players based on their selectedDeck
      const resetPlayers = currentState.players.map(p => {
        const deckType = p.selectedDeck || 'SynchroTech'
        return {
          ...p,
          hand: [],
          deck: createDeck(deckType as any, p.id, p.name),
          discard: [],
          score: 0,
          isReady: false,
          announcedCard: null,
          boardHistory: [],
        }
      })

      // Create fresh board with correct grid size
      const gridSize: number = (currentState.activeGridSize as unknown as number) || 8
      const newBoard: Board = []
      for (let i = 0; i < gridSize; i++) {
        const row: any[] = []
        for (let j = 0; j < gridSize; j++) {
          row.push({ card: null })
        }
        newBoard.push(row)
      }

      const resetState: GameState = {
        ...currentState,
        players: resetPlayers,
        board: newBoard,
        isGameStarted: false,
        currentPhase: 0,
        currentRound: 1,
        turnNumber: 1,
        activePlayerId: null,
        startingPlayerId: null,
        roundWinners: {},
        gameWinner: null,
        roundEndTriggered: false,
        isRoundEndModalOpen: false,
        isReadyCheckActive: false,
        // Clear other state
        targetingMode: null,
        floatingTexts: [],
        currentCommand: null,
        validTargets: [],
      }

      // Update local state (this will broadcast delta in WebRTC mode)
      setGameState(resetState)
      gameStateRef.current = resetState

      logger.info('[GameReset] Game reset in WebRTC mode')

      // Broadcast GAME_RESET message to all WebRTC peers
      // Send minimal data to avoid WebRTC message size limit
      // Guests will recreate their decks locally using createDeck()
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.broadcastToGuests({
          type: 'GAME_RESET',
          senderId: webrtcManagerRef.current.getPeerId(),
          data: {
            players: resetPlayers.map(p => ({
              id: p.id,
              name: p.name,
              color: p.color,
              selectedDeck: p.selectedDeck,
              isDummy: p.isDummy,
              isDisconnected: p.isDisconnected,
              autoDrawEnabled: p.autoDrawEnabled,
              // Only send sizes, not full card arrays (guests create decks locally)
              handSize: p.hand.length,
              deckSize: p.deck.length,
              discardSize: p.discard.length,
              // For dummy players, send minimized card data so guests can see them
              ...(p.isDummy && {
                hand: p.hand.map(card => ({
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
                })),
                deck: p.deck.map(card => ({
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
                })),
                discard: p.discard.map(card => ({
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
                })),
              }),
              score: p.score,
              isReady: p.isReady,
              announcedCard: p.announcedCard,
            })),
            gameMode: resetState.gameMode,
            isPrivate: resetState.isPrivate,
            activeGridSize: resetState.activeGridSize,
            dummyPlayerCount: resetState.dummyPlayerCount,
            autoAbilitiesEnabled: resetState.autoAbilitiesEnabled,
            isGameStarted: false,
            currentPhase: 0,
            currentRound: 1,
            turnNumber: 1,
            activePlayerId: null,
            startingPlayerId: null,
            roundWinners: {},
            gameWinner: null,
            isRoundEndModalOpen: false,
            isReadyCheckActive: false,
          },
          timestamp: Date.now()
        })
        logger.info('[GameReset] Broadcasted GAME_RESET message to guests')
      }
    } else if (ws.current?.readyState === WebSocket.OPEN) {
      // WebSocket mode: Send RESET_GAME message to server
      ws.current.send(JSON.stringify({
        type: 'RESET_GAME',
        gameId: gameStateRef.current.gameId,
      }))
    }
  }, [])

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
        currentState.currentPhase === 1 && // Setup phase
        item.source === 'hand' &&
        target.target === 'board' &&
        (item.card.types?.includes('Unit') || item.card.types?.includes('Command'))

      const newState: GameState = deepCloneState(currentState)

      if (item.source === 'board' && ['hand', 'deck', 'discard'].includes(target.target) && !item.bypassOwnershipCheck) {
        const cardOwnerId = item.card.ownerId
        const cardOwner = newState.players.find(p => p.id === cardOwnerId)
        const isOwner = cardOwnerId === localPlayerIdRef.current
        const isDummyCard = !!cardOwner?.isDummy

        if (!isOwner && !isDummyCard) {
          return currentState
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
        // Use nullish coalescing (??) instead of logical OR (||) to respect empty arrays
        // Empty array means "no valid targets" (e.g., Resurrected token)
        const allowedTargets = counterDef?.allowedTargets ?? ['board', 'hand']
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

          // Determine effectiveActorId: use item.ownerId if provided (for counter_panel from abilities),
          // otherwise fall back to card owner, active player (if dummy), or local player
          let effectiveActorId: number
          if (item.ownerId !== undefined) {
            // For counter_panel items, ownerId comes from the source card that created the stack
            effectiveActorId = item.ownerId
          } else if (item.card.ownerId !== undefined) {
            // For regular card moves, use the card's owner
            effectiveActorId = item.card.ownerId
          } else {
            const activePlayer = newState.players.find(p => p.id === newState.activePlayerId)
            effectiveActorId = (activePlayer?.isDummy) ? activePlayer.id : (localPlayerIdRef.current !== null ? localPlayerIdRef.current : 0)
          }
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

            // Handle status replacement (e.g., Censor: Exploit -> Stun)
            if (item.replaceStatusType && item.statusType) {
              for (let i = 0; i < count; i++) {
                // Find the status to replace (owned by effectiveActorId)
                const replaceIndex = targetCard.statuses.findIndex(
                  s => s.type === item.replaceStatusType && s.addedByPlayerId === effectiveActorId
                )
                if (replaceIndex !== -1) {
                  // Replace with new status
                  targetCard.statuses[replaceIndex] = { type: item.statusType, addedByPlayerId: effectiveActorId }
                } else {
                  // If no status to replace found, just add the new status
                  targetCard.statuses.push({ type: item.statusType, addedByPlayerId: effectiveActorId })
                }
              }
            } else {
              // Normal status addition
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
          // IMPORTANT: Verify the card at the index matches the expected ID AND ownerId
          // This prevents duplicate removals when multiple players target the same card type
          const cardAtIndex = player.hand[item.cardIndex]
          if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
            player.hand.splice(item.cardIndex, 1)
          } else {
            // Card at index doesn't match expected ID/ownerId - it was likely already removed by another player
            // Try to find and remove the card by ID AND ownerId instead
            const actualIndex = player.hand.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.hand.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'board' && item.boardCoords) {
        // IMPORTANT: Verify the card at the coords matches the expected ID AND ownerId
        // This prevents duplicate removals when multiple players target the same card type
        const cell = newState.board[item.boardCoords.row][item.boardCoords.col]
        if (cell.card && cell.card.id === item.card.id && cell.card.ownerId === item.card.ownerId) {
          newState.board[item.boardCoords.row][item.boardCoords.col].card = null
        } else {
          // Card at coords doesn't match expected ID - it was likely already removed/moved by another player
          // Skip this move entirely to avoid ghost duplications
          return currentState
        }
      } else if (item.source === 'discard' && item.playerId !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          let removed = false
          // If cardIndex is provided, try to remove at that index first
          if (item.cardIndex !== undefined) {
            const cardAtIndex = player.discard[item.cardIndex]
            if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
              player.discard.splice(item.cardIndex, 1)
              removed = true
            }
          }
          // If not removed by index, or cardIndex not provided, find by ID and ownerId
          if (!removed) {
            const actualIndex = player.discard.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.discard.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'deck' && item.playerId !== undefined && item.cardIndex !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          // IMPORTANT: Verify the card at the index matches the expected ID AND ownerId
          // This prevents duplicate removals when multiple players target the same card type
          const cardAtIndex = player.deck[item.cardIndex]
          if (cardAtIndex && cardAtIndex.id === item.card.id && cardAtIndex.ownerId === item.card.ownerId) {
            player.deck.splice(item.cardIndex, 1)
          } else {
            // Card at index doesn't match expected ID/ownerId - it was likely already removed by another player
            // Try to find and remove the card by ID AND ownerId instead
            const actualIndex = player.deck.findIndex(c => c.id === item.card.id && c.ownerId === item.card.ownerId)
            if (actualIndex !== -1) {
              player.deck.splice(actualIndex, 1)
            } else {
              // Card not found - already removed, skip this move entirely
              return currentState
            }
          }
        }
      } else if (item.source === 'announced' && item.playerId !== undefined) {
        const player = newState.players.find(p => p.id === item.playerId)
        if (player) {
          // IMPORTANT: Verify the card ID matches before removing
          // This prevents accidental removal if card was already moved by another action
          if (player.announcedCard && player.announcedCard.id === item.card.id) {
            player.announcedCard = null
          } else {
            // Card doesn't match - it was likely already removed/moved
            // Skip this move entirely to avoid card loss
            return currentState
          }
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
          // - Cards from hand/deck/discard: owned by the player whose hand/deck/discard they came from
          let ownerId = cardToMove.ownerId
          if (ownerId === undefined) {
            if (item.source === 'token_panel') {
              // Token from token panel gets active player as owner
              ownerId = newState.activePlayerId ?? localPlayerIdRef.current ?? 0
            } else if (item.playerId !== undefined) {
              // Card from a player's hand/deck/discard gets that player as owner
              ownerId = item.playerId
            } else {
              // Fallback to local player
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

        // Don't allow moving actual tokens/counters to hand (they stay on board or return to their source)
        // But DO allow moving cards that happen to have 'Tokens' as their origin deck
        // CRITICAL FIX: Only block if it's BOTH from Tokens/counter deck AND has Token type
        const isToken = (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') &&
                        (cardToMove.types?.includes('Token') || cardToMove.types?.includes('Token Unit'))

        if (isToken) {
          return currentState
        }

        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        const player = newState.players.find(p => p.id === target.playerId)

        if (!player) {
          return currentState
        }

        // Determine insert index: use target.cardIndex if provided, otherwise append to end
        let insertIndex = target.cardIndex !== undefined ? target.cardIndex : player.hand.length

        // Special case: reordering within the same hand
        // The source card was already removed from hand earlier (line 1854-1858)
        // We need to adjust insertIndex if we removed from before the insert position
        if (item.source === 'hand' && item.playerId === target.playerId && item.cardIndex !== undefined) {
          // If removing from before insert position, the indices shifted
          if (item.cardIndex < insertIndex) {
            insertIndex -= 1
          }
          // If dragging to same position, no change needed
          if (item.cardIndex === insertIndex) {
            return currentState
          }
        }

        // Insert card at the calculated position
        player.hand.splice(insertIndex, 0, cardToMove)

        // NOTE: Removed automatic shuffle when moving from deck to hand
        // Shuffle should only happen for specific search abilities (Mr. Pearl, Lucius Setup, Quick Response Team, Michael Falk)
        // Those abilities handle their own shuffle in their ability action chains
      } else if (target.target === 'board' && target.boardCoords) {
        if (newState.board[target.boardCoords.row][target.boardCoords.col].card === null) {
          // CRITICAL: Only set ownerId if it's still undefined
          // This preserves the correct owner set earlier (e.g., for dummy players)
          if (cardToMove.ownerId === undefined && localPlayerIdRef.current !== null) {
            const currentPlayer = newState.players.find(p => p.id === localPlayerIdRef.current)
            if (currentPlayer) {
              cardToMove.ownerId = currentPlayer.id
              cardToMove.ownerName = currentPlayer.name
            }
          }

          // --- HISTORY TRACKING: Entering Board ---
          // Cards placed on board get tracked in history for 'LastPlayed' status.
          // This includes: manual plays, deploy abilities, and tokens from counter_panel.
          // Only cards moved within the board (source === 'board') are NOT tracked as new plays.
          if (item.source !== 'board' && cardToMove.ownerId !== undefined) {
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
          // Remove Revealed status when card goes to discard
          if (cardToMove.statuses) {
            cardToMove.statuses = cardToMove.statuses.filter(s => s.type !== 'Revealed')
          }
          const player = newState.players.find(p => p.id === target.playerId)
          if (player) {
            if (cardToMove.ownerId === undefined) {
              cardToMove.ownerId = target.playerId
              cardToMove.ownerName = player.name
            }
            // Check if card already exists in discard to prevent duplicates
            const alreadyInDiscard = player.discard.some(c => c.id === cardToMove.id)
            if (!alreadyInDiscard) {
              player.discard.push(cardToMove)
            }
          }
        }
      } else if (target.target === 'deck' && target.playerId !== undefined) {

        // Don't allow moving actual tokens/counters to deck
        // CRITICAL FIX: Only block if it's BOTH from Tokens/counter deck AND has Token type
        const isToken = (cardToMove.deck === DeckType.Tokens || cardToMove.deck === 'counter') &&
                        (cardToMove.types?.includes('Token') || cardToMove.types?.includes('Token Unit'))

        if (isToken) {
          return currentState
        }

        // Remove ready statuses when card leaves the battlefield
        removeAllReadyStatuses(cardToMove)
        // Remove Revealed status when card goes to deck
        if (cardToMove.statuses) {
          cardToMove.statuses = cardToMove.statuses.filter(s => s.type !== 'Revealed')
        }
        const player = newState.players.find(p => p.id === target.playerId)

        if (!player) {
          return currentState
        }

        if (cardToMove.ownerId === undefined) {
          cardToMove.ownerId = target.playerId
          cardToMove.ownerName = player.name
        }
        if (target.deckPosition === 'top' || !target.deckPosition) {
          player.deck.unshift(cardToMove)
        } else {
          player.deck.push(cardToMove)
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
                      // CRITICAL: Use updatePlayerScore to properly sync with server
                      // Score will be updated when server broadcasts back
                      setTimeout(() => {
                        updatePlayerScore(spotterOwner.id, 2)
                      }, 0)
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
        newState.currentPhase = 2 // Main phase
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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

  const triggerDeckSelection = useCallback((playerId: number, selectedByPlayerId: number) => {
    const deckSelectionData = {
      playerId,
      selectedByPlayerId,
      timestamp: Date.now(),
    }

    // Immediately update local state so the acting player sees the effect without waiting for round-trip
    setLatestDeckSelections(prev => [...prev, deckSelectionData])

    // Also broadcast to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      const message = {
        type: 'TRIGGER_DECK_SELECTION',
        gameId: gameStateRef.current.gameId,
        deckSelectionData,
      }
      ws.current.send(JSON.stringify(message))
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== deckSelectionData.timestamp))
    }, 1000)
  }, [])

  const triggerHandCardSelection = useCallback((playerId: number, cardIndex: number, selectedByPlayerId: number) => {
    const handCardSelectionData = {
      playerId,
      cardIndex,
      selectedByPlayerId,
      timestamp: Date.now(),
    }

    // Immediately update local state so the acting player sees the effect without waiting for round-trip
    setLatestHandCardSelections(prev => [...prev, handCardSelectionData])

    // Also broadcast to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      const message = {
        type: 'TRIGGER_HAND_CARD_SELECTION',
        gameId: gameStateRef.current.gameId,
        handCardSelectionData,
      }
      ws.current.send(JSON.stringify(message))
    }

    // Auto-remove after 1 second
    setTimeout(() => {
      setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== handCardSelectionData.timestamp))
    }, 1000)
  }, [])

  const syncValidTargets = useCallback((validTargetsData: {
    validHandTargets: { playerId: number, cardIndex: number }[]
    isDeckSelectable: boolean
  }) => {
    // Broadcast valid targets to other players via WebSocket
    if (ws.current?.readyState === WebSocket.OPEN && gameStateRef.current.gameId) {
      ws.current.send(JSON.stringify({
        type: 'SYNC_VALID_TARGETS',
        gameId: gameStateRef.current.gameId,
        playerId: localPlayerIdRef.current,
        ...validTargetsData,
      }))
    }
  }, [])

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
    if (webrtcManagerRef.current) {
      if (webrtcIsHostRef.current) {
        // Host broadcasts directly to all guests
        webrtcManagerRef.current.broadcastToGuests({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManagerRef.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
      } else {
        // Guest sends to host for rebroadcasting
        webrtcManagerRef.current.sendMessageToHost({
          type: 'SET_TARGETING_MODE',
          senderId: webrtcManagerRef.current.getPeerId?.() ?? undefined,
          data: { targetingMode: targetingModeData },
          timestamp: Date.now()
        })
      }
    }

    logger.info(`[TargetingMode] Player ${playerId} activated targeting mode`, {
      mode: action.mode,
      boardTargetsCount: boardTargets.length,
    })
  }, [])

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
    if (webrtcManagerRef.current) {
      if (webrtcIsHostRef.current) {
        // Host broadcasts directly to all guests
        webrtcManagerRef.current.broadcastToGuests({
          type: 'CLEAR_TARGETING_MODE',
          senderId: webrtcManagerRef.current.getPeerId?.() ?? undefined,
          data: { timestamp: Date.now() },
          timestamp: Date.now()
        })
      } else {
        // Guest sends to host for rebroadcasting
        webrtcManagerRef.current.sendMessageToHost({
          type: 'CLEAR_TARGETING_MODE',
          senderId: webrtcManagerRef.current.getPeerId?.() ?? undefined,
          data: { timestamp: Date.now() },
          timestamp: Date.now()
        })
      }
    }

    logger.debug('[TargetingMode] Cleared targeting mode')
  }, [])

  const markAbilityUsed = useCallback((boardCoords: { row: number, col: number }, _isDeployAbility?: boolean, _setDeployAttempted?: boolean, readyStatusToRemove?: string) => {
    updateState(currentState => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card
      if (card) {
        const oldStatusesTypes = card.statuses ? card.statuses.map(s => s.type) : []
        // Remove the ready status if specified (new ready status system)
        if (readyStatusToRemove && card.statuses) {
          card.statuses = card.statuses.filter(s => s.type !== readyStatusToRemove)
          const newStatusesTypes = card.statuses.map(s => s.type)
          console.log(`[markAbilityUsed] Removed status '${readyStatusToRemove}' from ${card.name} at [${boardCoords.row},${boardCoords.col}]: [${oldStatusesTypes.join(', ')}] -> [${newStatusesTypes.join(', ')}]`)
        } else {
          console.log(`[markAbilityUsed] Called for ${card.name} at [${boardCoords.row},${boardCoords.col}] but no readyStatusToRemove specified. Current statuses: [${oldStatusesTypes.join(', ')}]`)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
      const card1 = newState.board[coords1.row][coords1.col].card
      const card2 = newState.board[coords2.row][coords2.col].card

      // Perform swap
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
      const fromCard = newState.board[fromCoords.row][fromCoords.col].card
      const toCard = newState.board[toCoords.row][toCoords.col].card
      const excludedTypes = ['Support', 'Threat', 'LastPlayed']
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
      const newState: GameState = deepCloneState(currentState)
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
      const newState: GameState = deepCloneState(currentState)
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
    // Block scoring after round has ended
    if (currentState.isRoundEndModalOpen) {
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

    // Update score
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // Use updateState in WebRTC mode to broadcast delta, use updatePlayerScore in WebSocket mode
    if (isWebRTCMode) {
      updateState(prevState => ({
        ...prevState,
        players: prevState.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + totalScore) }
            : p
        ),
      }))
    } else {
      updatePlayerScore(playerId, totalScore)
    }

    // For WebSocket mode, also send to server
    if (!isWebRTCMode) {
      updatePlayerScore(playerId, totalScore)
    }

    // Case 3: Auto-pass after scoring: if in Scoring phase (4) and points were scored,
    // automatically pass turn to next player after a short delay
    if (totalScore > 0 && currentState.currentPhase === 4 && currentState.activePlayerId === playerId) {
      setTimeout(() => {
        if (isWebRTCMode) {
          // WebRTC mode: Pass turn locally
          updateState(prevState => passTurnToNextPlayer(prevState))
        } else if (ws.current?.readyState === WebSocket.OPEN) {
          // WebSocket mode: Send NEXT_PHASE to server
          ws.current.send(JSON.stringify({
            type: 'NEXT_PHASE',
            gameId: currentState.gameId
          }))
        }
      }, 100) // 100ms delay to show scoring animation
    }
  }, [triggerFloatingText, updatePlayerScore, updateState])

  const scoreDiagonal = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => {
    const currentState = gameStateRef.current
    if (!currentState.isGameStarted) {
      return
    }
    // Block scoring after round has ended
    if (currentState.isRoundEndModalOpen) {
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

    // Update score
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // Use updateState in WebRTC mode to broadcast delta, use updatePlayerScore in WebSocket mode
    if (isWebRTCMode) {
      updateState(prevState => ({
        ...prevState,
        players: prevState.players.map(p =>
          p.id === playerId
            ? { ...p, score: Math.max(0, (p.score || 0) + totalScore) }
            : p
        ),
      }))
    } else {
      updatePlayerScore(playerId, totalScore)
    }

    // For WebSocket mode, also send to server
    if (!isWebRTCMode) {
      updatePlayerScore(playerId, totalScore)
    }

    // Handle draw_per_support bonus - needs local state update for hand/deck
    if (bonusType === 'draw_per_support' && totalBonus > 0) {
      updateState(prevState => {
        const newState: GameState = deepCloneState(prevState)
        const player = newState.players.find(p => p.id === playerId)
        if (player && player.deck.length > 0) {
          for (let i = 0; i < totalBonus; i++) {
            if (player.deck.length > 0) {
              player.hand.push(player.deck.shift()!)
            }
          }
        }
        return newState
      })
    }

    // Case 3: Auto-pass after scoring: if in Scoring phase (4) and points were scored,
    // automatically pass turn to next player after a short delay
    if (totalScore > 0 && currentState.currentPhase === 4 && currentState.activePlayerId === playerId) {
      setTimeout(() => {
        if (isWebRTCMode) {
          // WebRTC mode: Pass turn locally
          updateState(prevState => passTurnToNextPlayer(prevState))
        } else if (ws.current?.readyState === WebSocket.OPEN) {
          // WebSocket mode: Send NEXT_PHASE to server
          ws.current.send(JSON.stringify({
            type: 'NEXT_PHASE',
            gameId: currentState.gameId
          }))
        }
      }, 500) // 500ms delay to show scoring animation
    }
  }, [triggerFloatingText, updatePlayerScore, updateState])

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
    createGame,
    joinGame,
    joinGameViaModal,
    joinAsInvite,
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
    drawCardsBatch,
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
    toggleActivePlayer,
    toggleAutoDraw,
    forceReconnect,
    triggerHighlight,
    triggerFloatingText,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    syncValidTargets,
    remoteValidTargets,
    setTargetingMode,
    clearTargetingMode,
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
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
    resetDeployStatus,
    scoreDiagonal,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    updateState,
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
