/**
 * useGameState - Unified game state hook with Simple P2P
 *
 * Заменяет всю сложную систему WebRTC на упрощённую:
 * - 2 типа сообщений (ACTION, STATE)
 * - Один источник правды (хост)
 * - Фазовые переходы управляются хостом
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { GameState, Player, Card, DragItem, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData, AbilityAction } from '../types'
import { createInitialState } from './core/gameCreators'
import { logger } from '../utils/logger'
import type { PersonalizedState } from '../p2p/SimpleP2PTypes'
import { SimpleHost, SimpleGuest } from '../p2p'

// Тип для совместимости с существующим кодом
interface UseGameStateResult {
  gameState: GameState
  localPlayerId: number
  setLocalPlayerId: (id: number) => void
  draggedItem: DragItem | null
  setDraggedItem: (item: DragItem | null) => void
  connectionStatus: 'Connecting' | 'Connected' | 'Disconnected'
  gamesList: any[]

  // Game creation
  createGame: () => Promise<string>
  joinGameViaModal: (gameCode: string) => Promise<number>
  joinAsInvite: (hostPeerId: string) => Promise<number>
  exitGame: () => void

  // Ready check
  playerReady: () => void

  // Settings
  setGameMode: (mode: any) => void
  setGamePrivacy: (isPrivate: boolean) => void
  setActiveGridSize: (size: any) => void
  assignTeams: (teams: any) => void

  // Player actions
  updatePlayerName: (name: string) => void
  changePlayerColor: (color: any) => void
  updatePlayerScore: (delta: number) => void
  changePlayerDeck: (deck: any) => void
  loadCustomDeck: (deckFile: any) => void

  // Card actions
  drawCard: (playerId?: number) => void
  drawCardsBatch: (count: number, playerId?: number) => void
  handleDrop: (item: DragItem, target: any) => void
  moveItem: (item: any, target: any) => void
  updateState: (stateOrFn: any) => void
  shufflePlayerDeck: () => void

  // Status effects
  addBoardCardStatus: (coords: any, status: any) => void
  removeBoardCardStatus: (coords: any, status: any) => void
  removeBoardCardStatusByOwner: (ownerId: number) => void
  modifyBoardCardPower: (coords: any, delta: number) => void
  addAnnouncedCardStatus: (status: any) => void
  removeAnnouncedCardStatus: (status: any) => void
  modifyAnnouncedCardPower: (delta: number) => void
  addHandCardStatus: (playerId: number, cardIndex: number, status: any) => void
  removeHandCardStatus: (playerId: number, cardIndex: number, status: any) => void
  flipBoardCard: (coords: any) => void
  flipBoardCardFaceDown: (coords: any) => void
  revealHandCard: (playerId: number, cardIndex: number) => void
  revealBoardCard: (coords: any) => void
  requestCardReveal: (request: any) => void
  respondToRevealRequest: (accept: boolean) => void

  // Game lifecycle
  syncGame: () => void
  toggleActivePlayer: () => void
  toggleAutoDraw: () => void
  forceReconnect: () => Promise<void>

  // Visual effects
  triggerHighlight: (highlight: HighlightData) => void
  latestHighlight: HighlightData | null
  triggerNoTarget: (coords: any) => void
  latestNoTarget: { coords: any; timestamp: number } | null
  triggerDeckSelection: (data: DeckSelectionData) => void
  triggerHandCardSelection: (data: HandCardSelectionData) => void
  triggerClickWave: (data: any) => void
  clickWaves: any[]
  triggerFloatingText: (data: FloatingTextData) => void
  latestFloatingTexts: FloatingTextData[]
  latestDeckSelections: DeckSelectionData[]
  latestHandCardSelections: HandCardSelectionData[]
  syncValidTargets: (validTargets: any[]) => void

  // Targeting
  setTargetingMode: (mode: any) => void
  clearTargetingMode: () => void

  // Phase management
  nextPhase: () => void
  prevPhase: () => void
  setPhase: (phase: number) => void
  passTurn: () => void
  markAbilityUsed: () => void

  // Scoring
  scoreLine: (line: any) => void
  scoreDiagonal: (playerId: number) => void
  closeRoundEndModal: () => void
  closeRoundEndModalOnly: () => void

  // Card manipulation
  destroyCard: (cardId: string) => void
  applyGlobalEffect: (effect: any) => void
  swapCards: (card1: any, card2: any) => void
  transferStatus: (cardId: string, status: any) => void
  transferAllCounters: (cardId: string, toCardId: string) => void
  transferAllStatusesWithoutException: (cardId: string, exception: string) => void
  recoverDiscardedCard: (playerId: number) => void
  resurrectDiscardedCard: (playerId: number) => void
  spawnToken: (token: any) => void

  // Game reset
  resetGame: () => void
  resetDeployStatus: () => void
  removeStatusByType: (type: string) => void
  reorderTopDeck: (playerId: number) => void
  reorderCards: (playerId: number, newOrder: Card[]) => void

  // WebRTC
  webrtcHostId: string | null
  webrtcIsHost: boolean

  // Legacy
  requestGamesList: () => void
}

/**
 * Конвертирует PersonalizedState в GameState
 * Локальный игрок получает полные данные, остальные - только размеры
 */
function personalToGameState(personal: PersonalizedState, localPlayerId: number): GameState {
  // Конвертируем visualEffects из объекта обратно в Map
  const visualEffectsMap = personal.visualEffects instanceof Map
    ? personal.visualEffects
    : new Map(Object.entries(personal.visualEffects || {}))

  const result = {
    ...personal,
    visualEffects: visualEffectsMap,
    players: personal.players.map(p => {
      // Если есть hand - это полные данные (локальный игрок или dummy)
      if (p.hand) {
        return {
          ...p,
          hand: p.hand,
          deck: p.deck || [],
          discard: p.discard || [],
          boardHistory: p.boardHistory || [],
          announcedCard: p.announcedCard || null,
          handSize: p.hand.length,
          deckSize: p.deck?.length || 0,
          discardSize: p.discard?.length || 0
        }
      } else {
        // Для других игроков - только размеры + announcedCard (витрина видна всем)
        return {
          ...p,
          hand: [],
          deck: [],
          discard: [],
          boardHistory: [],
          announcedCard: p.announcedCard || null,  // Витрина видна всем игрокам
          handSize: p.handSize || 0,
          deckSize: p.deckSize || 0,
          discardSize: p.discardSize || 0
        }
      }
    }),
    localPlayerId
  } as GameState

  return result
}

export function useGameState(props: any = {}): UseGameStateResult {
  // Состояние игры
  const [gameState, setGameState] = useState<GameState>(createInitialState())
  const [localPlayerId, setLocalPlayerId] = useState<number>(1)
  const [connectionStatus, setConnectionStatus] = useState<'Connecting' | 'Connected' | 'Disconnected'>('Disconnected')

  // P2P менеджеры
  const hostRef = useRef<SimpleHost | null>(null)
  const guestRef = useRef<SimpleGuest | null>(null)
  const isHostRef = useRef<boolean>(false)

  // State for draggedItem (useState вместо useRef для реактивности)
  const [draggedItem, setDraggedItemState] = useState<DragItem | null>(null)

  // Refs для совместимости (остальные)
  const latestHighlightRef = useRef<HighlightData | null>(null)
  const latestNoTargetRef = useRef<{ coords: any; timestamp: number } | null>(null)
  const clickWavesRef = useRef<any[]>([])
  const latestFloatingTextsRef = useRef<FloatingTextData[]>([])
  const latestDeckSelectionsRef = useRef<DeckSelectionData[]>([])
  const latestHandCardSelectionsRef = useRef<HandCardSelectionData[]>([])

  // ============================================================================
  // Инициализация хоста
  // ============================================================================
  const createGame = useCallback(async () => {
    try {
      setConnectionStatus('Connecting')
      logger.info('[useGameState] Creating host...')

      const host = new SimpleHost(createInitialState(), {
        onStateUpdate: (personalState) => {
          const fullState = personalToGameState(personalState, 1)
          setGameState(fullState)
          setLocalPlayerId(1)
        },
        onPlayerJoin: (playerId) => {
          logger.info('[useGameState] Player joined:', playerId)
        },
        onPlayerLeave: (playerId) => {
          logger.info('[useGameState] Player left:', playerId)
        }
      })

      const peerId = await host.initialize()
      hostRef.current = host
      isHostRef.current = true
      setConnectionStatus('Connected')

      logger.info('[useGameState] Host created with peerId:', peerId)
      return peerId
    } catch (e) {
      logger.error('[useGameState] Failed to create host:', e)
      setConnectionStatus('Disconnected')
      throw e
    }
  }, [])

  // ============================================================================
  // Подключение как гость
  // ============================================================================
  const joinGameViaModal = useCallback(async (hostPeerId: string) => {
    try {
      setConnectionStatus('Connecting')
      logger.info('[useGameState] Connecting to host:', hostPeerId)

      // Сохраняем имя для поиска
      const myName = localStorage.getItem('player_name')

      const guest = new SimpleGuest({
        localPlayerId: 0,
        onStateUpdate: (personalState) => {
          logger.info('[useGameState] onStateUpdate, personalState.gameId:', personalState.gameId, 'players:', personalState.players?.length)

          // Определяем localPlayerId из состояния или токена
          const token = localStorage.getItem('player_token')
          let myId = 0

          logger.info('[useGameState] Looking for token:', token?.substring(0, 8) + '...')

          if (token) {
            const player = personalState.players.find((p: any) => p.playerToken === token)
            if (player) {
              myId = player.id
              logger.info('[useGameState] Found myId by token:', myId)
            } else {
              logger.warn('[useGameState] Token not found in state players')
            }
          }

          if (myId === 0) {
            // Пытаемся найти игрока с именем из localStorage
            logger.info('[useGameState] Trying to find by name:', myName)
            const playerByName = personalState.players.find((p: any) => p.name === myName)
            if (playerByName) {
              myId = playerByName.id
              logger.info('[useGameState] Found myId by name:', myId, 'name:', myName)
            }
          }

          // Логируем всех игроков для отладки
          personalState.players?.forEach((p: any) => {
            logger.info('[useGameState] Player in state:', p.id, p.name, 'hasHand:', !!p.hand, 'hasToken:', !!p.playerToken)
          })

          const fullState = personalToGameState(personalState, myId)
          setGameState(fullState)
          setLocalPlayerId(myId)

          logger.info('[useGameState] Set localPlayerId to:', myId, 'gameState.gameId:', fullState.gameId)
        },
        onConnected: () => {
          setConnectionStatus('Connected')
          logger.info('[useGameState] Connected to host')
        },
        onDisconnected: () => {
          setConnectionStatus('Disconnected')
          logger.warn('[useGameState] Disconnected from host')
        },
        onError: (error) => {
          logger.error('[useGameState] Guest error:', error)
        }
      })

      await guest.connect(hostPeerId)
      guestRef.current = guest
      isHostRef.current = false

      return guest.getLocalPlayerId()
    } catch (e) {
      logger.error('[useGameState] Failed to connect:', e)
      setConnectionStatus('Disconnected')
      throw e
    }
  }, [])

  const joinAsInvite = useCallback((hostPeerId: string) => {
    return joinGameViaModal(hostPeerId)
  }, [joinGameViaModal])

  // ============================================================================
  // Отправка действий
  // ============================================================================
  const sendAction = useCallback((action: string, data?: any) => {
    if (isHostRef.current && hostRef.current) {
      hostRef.current.hostAction(action, data)
    } else if (guestRef.current) {
      guestRef.current.sendAction(action, data)
    } else {
      logger.warn('[useGameState] No connection, cannot send action:', action)
    }
  }, [])

  // ============================================================================
  // Ready check
  // ============================================================================
  const playerReady = useCallback(() => {
    sendAction('PLAYER_READY')
  }, [sendAction])

  // ============================================================================
  // Настройки игры
  // ============================================================================
  const setGameMode = useCallback((mode: any) => {
    sendAction('SET_GAME_MODE', { mode })
  }, [sendAction])

  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    sendAction('SET_PRIVACY', { isPrivate })
  }, [sendAction])

  const setActiveGridSize = useCallback((size: any) => {
    sendAction('SET_GRID_SIZE', { size })
  }, [sendAction])

  const assignTeams = useCallback((teams: any) => {
    sendAction('ASSIGN_TEAMS', { teams })
  }, [sendAction])

  // ============================================================================
  // Игровые действия
  // ============================================================================
  const updatePlayerName = useCallback((name: string) => {
    sendAction('CHANGE_PLAYER_NAME', { name })
    // Локальное обновление для мгновенного отклика
    setGameState((prev: GameState) => ({
      ...prev,
      players: prev.players.map(p =>
        p.id === localPlayerId ? { ...p, name } : p
      )
    }))
  }, [sendAction, localPlayerId])

  const changePlayerColor = useCallback((color: any) => {
    sendAction('CHANGE_PLAYER_COLOR', { color })
  }, [sendAction])

  const updatePlayerScore = useCallback((delta: number) => {
    sendAction('UPDATE_SCORE', { delta })
  }, [sendAction])

  const changePlayerDeck = useCallback((deck: any) => {
    sendAction('CHANGE_PLAYER_DECK', { deck })
  }, [sendAction])

  const loadCustomDeck = useCallback((deckFile: any) => {
    // TODO
  }, [])

  const drawCard = useCallback((playerId?: number) => {
    sendAction('DRAW_CARD')
  }, [sendAction])

  const drawCardsBatch = useCallback((count: number, playerId?: number) => {
    // TODO
  }, [])

  const handleDrop = useCallback((item: DragItem, target: any) => {
    if (target.target === 'board') {
      // Определяем действие по источнику карты
      let action = 'PLAY_CARD'
      let actionData: any = {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown
      }

      if (item.source === 'deck') {
        action = 'PLAY_CARD_FROM_DECK'
        actionData.cardIndex = item.cardIndex ?? 0
      } else if (item.source === 'discard') {
        action = 'PLAY_CARD_FROM_DISCARD'
        actionData.cardIndex = item.cardIndex
      } else if (item.source === 'announced') {
        // Перетаскивание из витрины на поле боя
        action = 'PLAY_ANNOUNCED_TO_BOARD'
        actionData = {
          row: target.boardCoords.row,
          col: target.boardCoords.col,
          faceDown: item.card?.isFaceDown
        }
      }

      sendAction(action, actionData)
    } else if (target.target === 'hand') {
      // Перемещение в руку
      if (item.source === 'announced') {
        // Из витрины в руку
        sendAction('MOVE_ANNOUNCED_TO_HAND', {})
      } else {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_HAND', {
            cardId,
            source: item.source
          })
        }
      }
    } else if (target.target === 'deck') {
      // Перемещение в колоду
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DECK', {
          cardIndex: item.cardIndex
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DECK', {
            cardId,
            source: 'board'
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в колоду
        sendAction('MOVE_ANNOUNCED_TO_DECK', {})
      }
    } else if (target.target === 'discard') {
      // Перемещение в сброс
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DISCARD', {
            cardId,
            source: 'board'
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в сброс
        sendAction('MOVE_ANNOUNCED_TO_DISCARD', {})
      }
    } else if (target.target === 'announced') {
      // Перемещение в витрину (announce)
      sendAction('ANNOUNCE_CARD', {
        cardId: item.card?.id,
        source: item.source,
        cardIndex: item.cardIndex
      })
    }
  }, [sendAction])

  const moveItem = useCallback(() => {
    // TODO
  }, [])

  const updateState = useCallback((stateOrFn: any) => {
    if (isHostRef.current) {
      // Хост может обновлять состояние напрямую
      // TODO: интегрировать с applyAction
    }
  }, [])

  const shufflePlayerDeck = useCallback(() => {
    sendAction('SHUFFLE_DECK')
  }, [sendAction])

  // ============================================================================
  // Фазовые действия
  // ============================================================================
  const nextPhase = useCallback(() => {
    sendAction('NEXT_PHASE')
  }, [sendAction])

  const prevPhase = useCallback(() => {
    sendAction('PREVIOUS_PHASE')
  }, [sendAction])

  const setPhase = useCallback((phase: number) => {
    sendAction('SET_PHASE', { phase })
  }, [sendAction])

  const passTurn = useCallback(() => {
    sendAction('PASS_TURN', { reason: 'manual' })
  }, [sendAction])

  // ============================================================================
  // Счёт
  // ============================================================================
  const scoreLine = useCallback((line: any) => {
    sendAction('SELECT_SCORING_LINE', { line })
  }, [sendAction])

  const scoreDiagonal = useCallback((playerId: number) => {
    // TODO
  }, [])

  const closeRoundEndModal = useCallback(() => {
    sendAction('COMPLETE_ROUND')
  }, [sendAction])

  const closeRoundEndModalOnly = useCallback(() => {
    // TODO
  }, [])

  // ============================================================================
  // Visual effects (заглушки)
  // ============================================================================
  const triggerHighlight = useCallback((highlight: HighlightData) => {
    latestHighlightRef.current = highlight
  }, [])

  const triggerNoTarget = useCallback((coords: any) => {
    latestNoTargetRef.current = { coords, timestamp: Date.now() }
  }, [])

  const triggerDeckSelection = useCallback((data: DeckSelectionData) => {
    latestDeckSelectionsRef.current.push(data)
  }, [])

  const triggerHandCardSelection = useCallback((data: HandCardSelectionData) => {
    latestHandCardSelectionsRef.current.push(data)
  }, [])

  const triggerClickWave = useCallback((data: any) => {
    clickWavesRef.current.push(data)
  }, [])

  const triggerFloatingText = useCallback((data: FloatingTextData) => {
    latestFloatingTextsRef.current.push(data)
  }, [])

  const syncValidTargets = useCallback((validTargets: any[]) => {
    // TODO
  }, [])

  const setTargetingMode = useCallback(() => {
    // TODO
  }, [])

  const clearTargetingMode = useCallback(() => {
    // TODO
  }, [])

  // ============================================================================
  // Status effects (заглушки)
  // ============================================================================
  const addBoardCardStatus = useCallback(() => {}, [])
  const removeBoardCardStatus = useCallback(() => {}, [])
  const removeBoardCardStatusByOwner = useCallback(() => {}, [])
  const modifyBoardCardPower = useCallback(() => {}, [])
  const addAnnouncedCardStatus = useCallback(() => {}, [])
  const removeAnnouncedCardStatus = useCallback(() => {}, [])
  const modifyAnnouncedCardPower = useCallback(() => {}, [])
  const addHandCardStatus = useCallback(() => {}, [])
  const removeHandCardStatus = useCallback(() => {}, [])
  const flipBoardCard = useCallback(() => {}, [])
  const flipBoardCardFaceDown = useCallback(() => {}, [])
  const revealHandCard = useCallback(() => {}, [])
  const revealBoardCard = useCallback(() => {}, [])
  const requestCardReveal = useCallback(() => {}, [])
  const respondToRevealRequest = useCallback(() => {}, [])

  // ============================================================================
  // Game lifecycle
  // ============================================================================
  const syncGame = useCallback(() => {}, [])
  const toggleActivePlayer = useCallback(() => {}, [])
  const toggleAutoDraw = useCallback(() => {}, [])
  const forceReconnect = useCallback(async () => {
    if (guestRef.current) {
      await guestRef.current.reconnect()
    }
  }, [])

  // ============================================================================
  // Card manipulation
  // ============================================================================
  const destroyCard = useCallback((cardId: string) => {
    sendAction('DESTROY_CARD', { cardId })
  }, [sendAction])

  const applyGlobalEffect = useCallback(() => {}, [])
  const swapCards = useCallback(() => {}, [])
  const transferStatus = useCallback(() => {}, [])
  const transferAllCounters = useCallback(() => {}, [])
  const transferAllStatusesWithoutException = useCallback(() => {}, [])
  const recoverDiscardedCard = useCallback(() => {}, [])
  const resurrectDiscardedCard = useCallback(() => {}, [])
  const spawnToken = useCallback(() => {}, [])

  // ============================================================================
  // Game reset
  // ============================================================================
  const resetGame = useCallback(() => {}, [])
  const resetDeployStatus = useCallback(() => {}, [])
  const removeStatusByType = useCallback(() => {}, [])
  const reorderTopDeck = useCallback(() => {}, [])
  const reorderCards = useCallback(() => {}, [])

  // ============================================================================
  // Legacy
  // ============================================================================
  const requestGamesList = useCallback(() => {}, [])

  const exitGame = useCallback(() => {
    hostRef.current?.destroy()
    guestRef.current?.destroy()
    hostRef.current = null
    guestRef.current = null
    isHostRef.current = false
    setGameState(createInitialState())
    setConnectionStatus('Disconnected')
  }, [])

  // ============================================================================
  // Вспомогательные
  // ============================================================================
  const setDraggedItem = useCallback((item: DragItem | null) => {
    setDraggedItemState(item)
  }, [])

  // ============================================================================
  // WebRTC свойства
  // ============================================================================
  const webrtcHostId = hostRef.current?.getPeerId() || null
  const webrtcIsHost = isHostRef.current

  // ============================================================================
  // Очистка при размонтировании
  // ============================================================================
  useEffect(() => {
    return () => {
      hostRef.current?.destroy()
      guestRef.current?.destroy()
    }
  }, [])

  // ============================================================================
  // Результат
  // ============================================================================
  return {
    gameState,
    localPlayerId,
    setLocalPlayerId,
    draggedItem,
    setDraggedItem,
    connectionStatus,
    gamesList: [],

    createGame,
    joinGameViaModal,
    joinAsInvite,
    playerReady,
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    updatePlayerName,
    changePlayerColor,
    updatePlayerScore,
    changePlayerDeck,
    loadCustomDeck,
    drawCard,
    drawCardsBatch,
    handleDrop,
    updateState,
    shufflePlayerDeck,
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
    toggleActivePlayer,
    toggleAutoDraw,
    forceReconnect,
    triggerHighlight,
    latestHighlight: latestHighlightRef.current,
    triggerNoTarget,
    latestNoTarget: latestNoTargetRef.current,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    clickWaves: clickWavesRef.current,
    syncValidTargets,
    setTargetingMode,
    clearTargetingMode,
    nextPhase,
    prevPhase,
    setPhase,
    markAbilityUsed: () => {}, // TODO
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    transferAllStatusesWithoutException,
    destroyCard,
    recoverDiscardedCard,
    resurrectDiscardedCard,
    spawnToken,
    scoreLine,
    scoreDiagonal,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
    resetDeployStatus,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    triggerFloatingText,
    latestFloatingTexts: latestFloatingTextsRef.current,
    latestDeckSelections: latestDeckSelectionsRef.current,
    latestHandCardSelections: latestHandCardSelectionsRef.current,
    moveItem,
    requestGamesList,
    exitGame,

    // WebRTC
    webrtcHostId,
    webrtcIsHost,

    // Compatibility aliases
    initializeWebrtcHost: createGame,
    connectAsGuest: async (hostId: string) => {
      try {
        await joinGameViaModal(hostId)
        return true
      } catch {
        return false
      }
    },

    // Additional WebRTC compatibility props (stubs for now)
    requestDeckView: () => {},
    sendFullDeckToHost: () => {},
    shareHostDeckWithGuests: () => {},
    isReconnecting: false,
    reconnectProgress: null,
  }
}

export default useGameState
