/**
 * useGameState - Unified game state hook with Simple P2P
 *
 * Заменяет всю сложную систему WebRTC на упрощённую:
 * - 2 типа сообщений (ACTION, STATE)
 * - Один источник правды (хост)
 * - Фазовые переходы управляются хостом
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { flushSync } from 'react-dom'
import type { GameState, Card, DragItem, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData } from '../types'
import { createInitialState } from './core/gameCreators'
import { logger } from '../utils/logger'
import type { PersonalizedState } from '../p2p/SimpleP2PTypes'
import { SimpleHost, SimpleGuest } from '../p2p'
import { useVisualEffects } from './useVisualEffects'
import { triggerDirectClickWave } from './useDirectClickWave'
import { tokenDatabase } from '../content'

// Export type for use in other files
export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

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
  joinAsInvite: (gameId: string, playerName?: string) => Promise<number>
  exitGame: () => void
  // Additional WebRTC compatibility props (stubs)
  initializeWebrtcHost: () => Promise<string>
  connectAsGuest: (hostId: string) => Promise<boolean>
  sendFullDeckToHost: (playerId: number, deck: any[], deckLength: number) => void
  shareHostDeckWithGuests: (deck: any[], deckLength: number) => void
  isReconnecting: boolean
  reconnectProgress: { attempt: number; maxAttempts: number; timeRemaining: number } | null
  setDummyPlayerCount: (count: number) => void

  // Ready check
  playerReady: () => void

  // Settings
  setGameMode: (mode: any) => void
  setGamePrivacy: (isPrivate: boolean) => void
  setActiveGridSize: (size: any) => void
  assignTeams: (teams: any) => void

  // Player actions
  updatePlayerName: (playerId: number, name: string) => void
  changePlayerColor: (playerId: number, color: any) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  changePlayerDeck: (playerId: number, deck: any) => void
  loadCustomDeck: (playerId: number, deckFile: any) => void

  // Card actions
  drawCard: (playerId?: number) => void
  drawCardsBatch: (count: number, playerId?: number) => void
  handleDrop: (item: DragItem, target: any) => void
  moveItem: (item: any, target: any) => void
  updateState: (stateOrFn: any) => void
  shufflePlayerDeck: (playerId?: number) => void

  // Status effects
  addBoardCardStatus: (coords: any, status: any, playerId?: number) => void
  removeBoardCardStatus: (coords: any, status: any) => void
  removeBoardCardStatusByOwner: (coords: any, status: any, ownerId: number) => void
  modifyBoardCardPower: (coords: any, delta: number) => void
  addAnnouncedCardStatus: (playerId: number, status: any, addedByPlayerId?: number) => void
  removeAnnouncedCardStatus: (playerId: number, status: any) => void
  modifyAnnouncedCardPower: (playerId: number, delta: number) => void
  addHandCardStatus: (playerId: number, cardIndex: number, status: any, addedByPlayerId?: number) => void
  removeHandCardStatus: (playerId: number, cardIndex: number, status: any) => void
  flipBoardCard: (coords: any) => void
  flipBoardCardFaceDown: (coords: any) => void
  revealHandCard: (playerId: number, cardIndex: number, to?: 'all' | number) => void
  revealBoardCard: (coords: any, to?: 'all' | number) => void
  requestCardReveal: (request: any, requesterPlayerId?: number) => void
  respondToRevealRequest: (requesterPlayerId: number, accept: boolean) => void

  // Game lifecycle
  syncGame: () => void
  toggleActivePlayer: () => void
  toggleAutoDraw: (playerId: number, enabled: boolean) => void
  forceReconnect: () => Promise<void>

  // Visual effects (accept union types for P2P compatibility)
  triggerHighlight: (highlight: Omit<HighlightData, 'timestamp'>) => void
  latestHighlight: HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null
  triggerNoTarget: (coords: { row: number; col: number }) => void
  latestNoTarget: { coords: { row: number; col: number }; timestamp: number } | null
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  triggerHandCardSelection: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void
  clickWaves: Array<{ timestamp: number; location: 'board' | 'hand' | 'deck'; boardCoords?: { row: number; col: number }; handTarget?: { playerId: number, cardIndex: number }; clickedByPlayerId: number; playerColor: string }>
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  latestFloatingTexts: FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[]
  latestDeckSelections: Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>
  latestHandCardSelections: Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>
  syncValidTargets: (options: { validHandTargets?: {playerId: number, cardIndex: number}[]; isDeckSelectable?: boolean }) => void

  // Targeting
  setTargetingMode: (action: any, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: any, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode: () => void

  // Phase management
  nextPhase: (forceTurnPass?: boolean) => void
  prevPhase: () => void
  setPhase: (phase: number) => void
  passTurn: () => void
  markAbilityUsed: (coords: any, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void

  // Scoring
  scoreLine: (r1: number, c1: number, r2: number, c2: number, playerId: number) => void
  scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  selectScoringLine: (lineType: string, lineIndex?: number) => void
  closeRoundEndModal: () => void
  closeRoundEndModalOnly: () => void

  // Card manipulation
  destroyCard: (card: Card, boardCoords: { row: number; col: number }) => void
  applyGlobalEffect: (source: any, targets: any[], type: string, playerId: number, isDeploy: boolean) => void
  swapCards: (c1: any, c2: any) => void
  transferStatus: (from: any, to: any, type: string) => void
  transferAllCounters: (from: any, to: any) => void
  transferAllStatusesWithoutException: (from: any, to: any) => void
  recoverDiscardedCard: (playerId: number, cardIndex: number) => void
  resurrectDiscardedCard: (playerId: number, cardIndex: number, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: { row: number; col: number }, name: string, ownerId: number) => void

  // Game reset
  resetGame: () => void
  resetDeployStatus: () => void
  removeStatusByType: (coords: { row: number; col: number }, type: string) => void
  reorderTopDeck: (playerId: number, newTopCards: any[]) => void
  reorderCards: (playerId: number, newOrder: any[], source?: string) => void
  requestDeckView: (targetPlayerId: number) => void

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
      // Если есть deck с картами - это полные данные (локальный игрок или dummy)
      // Remote игроки имеют placeholder hand но не имеют deck массива
      if (p.deck && p.deck.length > 0) {
        return {
          ...p,
          hand: p.hand || [],
          deck: p.deck,
          discard: p.discard || [],
          boardHistory: p.boardHistory || [],
          announcedCard: p.announcedCard || null,
          handSize: (p.hand || []).length,
          deckSize: p.deck.length,
          discardSize: p.discard?.length || 0
        }
      } else if (p.deckSize && p.deckSize > 0) {
        // Deck view target - есть deckSize но нет deck массива
        // Сохраняем deckSize для корректного отображения
        console.log('[personalToGameState] Deck view target', p.id, 'deckSize:', p.deckSize)
        return {
          ...p,
          hand: p.hand || [],
          deck: [],
          discard: [],
          boardHistory: [],
          announcedCard: p.announcedCard || null,
          handSize: p.handSize || 0,
          deckSize: p.deckSize,
          discardSize: p.discardSize || 0
        }
      } else {
        // Для других игроков - только размеры + announcedCard (витрина видна всем)
        // Используем deckSize из персонализированного состояния
        console.log('[personalToGameState] Remote player', p.id, 'deckSize:', p.deckSize, 'handSize:', p.handSize, 'color:', p.color, 'colorType:', typeof p.color)
        return {
          ...p,
          hand: p.hand || [],
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

export function useGameState(_props: any = {}): UseGameStateResult {
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

  // Refs для useVisualEffects
  const gameStateRef = useRef(gameState)
  const localPlayerIdRef = useRef(localPlayerId)

  // Update refs when state changes
  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])
  useEffect(() => {
    localPlayerIdRef.current = localPlayerId
  }, [localPlayerId])

  // States for visual effects
  // Note: latestHighlight can be HighlightData (client) or P2P highlight format
  const [latestHighlight, setLatestHighlight] = useState<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>(null)
  // Note: latestFloatingTexts can be FloatingTextData[] (client) or P2P batch format
  const [latestFloatingTexts, setLatestFloatingTexts] = useState<FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[] | null>(null)
  const [latestNoTarget, setLatestNoTarget] = useState<{ coords: { row: number; col: number }; timestamp: number } | null>(null)
  const [_latestDeckSelections, setLatestDeckSelections] = useState<Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>>([])
  const [_latestHandCardSelections, setLatestHandCardSelections] = useState<Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>>([])
  const [clickWaves, setClickWaves] = useState<Array<any>>([])

  // Refs для совместимости (остальные)
  const latestHighlightRef = useRef<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>(null)
  const latestNoTargetRef = useRef<{ coords: any; timestamp: number } | null>(null)
  const clickWavesRef = useRef<any[]>([])
  const latestFloatingTextsRef = useRef<FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[]>([])
  const latestDeckSelectionsRef = useRef<DeckSelectionData[]>([])
  const latestHandCardSelectionsRef = useRef<HandCardSelectionData[]>([])

  // Update refs when state changes
  useEffect(() => {
    latestHighlightRef.current = latestHighlight
  }, [latestHighlight])
  useEffect(() => {
    latestFloatingTextsRef.current = latestFloatingTexts || []
  }, [latestFloatingTexts])
  useEffect(() => {
    latestNoTargetRef.current = latestNoTarget
  }, [latestNoTarget])
  useEffect(() => {
    clickWavesRef.current = clickWaves
  }, [clickWaves])

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
        },
        onClickWave: (wave) => {
          // INSTANT: Show wave via direct DOM manipulation
          triggerDirectClickWave(wave as any)
          // Also update React state for debugging/compatibility
          flushSync(() => {
            setClickWaves(prev => [...prev, wave])
          })
          // Auto-remove after animation completes (700ms to match ClickWave totalDuration)
          setTimeout(() => {
            setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
          }, 700)
        },
        onFloatingTextBatch: (events) => {
          const timestamp = Date.now()
          const batch = events.map((item, i) => ({
            row: item.row,
            col: item.col,
            text: item.text,
            playerId: item.playerId,
            timestamp: timestamp + i
          }))
          flushSync(() => {
            setLatestFloatingTexts(batch)
          })
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
  }, [setClickWaves])

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
        },
        // Visual effect callbacks
        onHighlight: (data) => {
          setLatestHighlight({ ...data, timestamp: Date.now() })
        },
        onFloatingText: (batch) => {
          const timestamp = Date.now()
          const withTimestamp = batch.map((item, i) => ({ ...item, timestamp: timestamp + i }))
          setLatestFloatingTexts(withTimestamp)
        },
        onTargetingMode: (targetingMode) => {
          setGameState((prev: any) => ({
            ...prev,
            targetingMode
          }))
        },
        onClearTargetingMode: () => {
          setGameState((prev: any) => ({
            ...prev,
            targetingMode: null
          }))
        },
        onNoTarget: (coords) => {
          setLatestNoTarget({ coords, timestamp: Date.now() })
        },
        onDeckSelection: (playerId, selectedByPlayerId) => {
          const selection = { playerId, selectedByPlayerId, timestamp: Date.now() }
          setLatestDeckSelections(prev => [...prev, selection])
          setTimeout(() => {
            setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== selection.timestamp))
          }, 1000)
        },
        onHandCardSelection: (playerId, cardIndex, selectedByPlayerId) => {
          const selection = { playerId, cardIndex, selectedByPlayerId, timestamp: Date.now() }
          setLatestHandCardSelections(prev => [...prev, selection])
          setTimeout(() => {
            setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== selection.timestamp))
          }, 1000)
        },
        onClickWave: (wave) => {
          // INSTANT: Show wave via direct DOM manipulation
          triggerDirectClickWave(wave as any)
          // Also update React state for debugging/compatibility
          flushSync(() => {
            setClickWaves(prev => [...prev, wave])
          })
          // Auto-remove after animation completes (700ms to match ClickWave totalDuration)
          setTimeout(() => {
            setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
          }, 700)
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

  const joinAsInvite = useCallback((gameId: string, _playerName?: string) => {
    // For invite join, we treat gameId as hostPeerId for now
    return joinGameViaModal(gameId)
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

  const setDummyPlayerCount = useCallback((count: number) => {
    sendAction('SET_DUMMY_PLAYER_COUNT', { count })
  }, [sendAction])

  const assignTeams = useCallback((teams: any) => {
    sendAction('ASSIGN_TEAMS', { teams })
  }, [sendAction])

  // ============================================================================
  // Игровые действия
  // ============================================================================
  const updatePlayerName = useCallback((playerId: number, name: string) => {
    sendAction('CHANGE_PLAYER_NAME', { playerId, name })
    // Локальное обновление для мгновенного отклика
    setGameState((prev: GameState) => ({
      ...prev,
      players: prev.players.map(p =>
        p.id === playerId ? { ...p, name } : p
      )
    }))
  }, [sendAction])

  const changePlayerColor = useCallback((playerId: number, color: any) => {
    sendAction('CHANGE_PLAYER_COLOR', { playerId, color })
  }, [sendAction])

  const updatePlayerScore = useCallback((playerId: number, delta: number) => {
    sendAction('UPDATE_SCORE', { playerId, delta })
  }, [sendAction])

  const changePlayerDeck = useCallback((playerId: number, deck: any) => {
    sendAction('CHANGE_PLAYER_DECK', { playerId, deck })
  }, [sendAction])

  const loadCustomDeck = useCallback((playerId: number, deckFile: any) => {
    sendAction('LOAD_CUSTOM_DECK', { playerId, deckFile })
  }, [sendAction])

  const drawCard = useCallback((playerId?: number) => {
    sendAction('DRAW_CARD', { targetPlayerId: playerId })
  }, [sendAction])

  const drawCardsBatch = useCallback((_count: number, _playerId?: number) => {
    // TODO
  }, [])

  const handleDrop = useCallback((item: DragItem, target: any) => {
    if (target.target === 'board') {
      // Определяем действие по источнику карты
      let action = 'PLAY_CARD'
      let actionData: any = {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown,
        playerId: item.playerId // Owner of the card being played
      }

      if (item.source === 'counter_panel') {
        // Размещение жетона/статуса на карту с поля боя
        action = 'ADD_STATUS_TO_BOARD_CARD'
        actionData = {
          boardCoords: target.boardCoords,
          statusType: item.statusType,
          ownerId: item.ownerId,
          replaceStatusType: item.replaceStatusType,
          count: item.count || 1
        }
        console.log('[useGameState] Sending ADD_STATUS_TO_BOARD_CARD:', actionData)
      } else if (item.source === 'token_panel') {
        // Размещение карты-токена на пустую клетку поля боя
        // Токен НЕ удаляется из панели (может использоваться многократно)
        action = 'PLAY_TOKEN_CARD'
        actionData = {
          card: item.card,
          boardCoords: target.boardCoords,
          ownerId: item.ownerId // Владелец = разместивший или dummy
        }
      } else if (item.source === 'deck') {
        action = 'PLAY_CARD_FROM_DECK'
        actionData.cardIndex = item.cardIndex ?? 0
        actionData.playerId = item.playerId
      } else if (item.source === 'discard') {
        action = 'PLAY_CARD_FROM_DISCARD'
        actionData.cardIndex = item.cardIndex
        actionData.playerId = item.playerId
      } else if (item.source === 'announced') {
        // Перетаскивание из витрины на поле боя
        action = 'PLAY_ANNOUNCED_TO_BOARD'
        actionData = {
          row: target.boardCoords.row,
          col: target.boardCoords.col,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      } else if (item.source === 'board') {
        // Перемещение карты с одной клетки поля боя на другую
        action = 'MOVE_CARD_ON_BOARD'
        actionData = {
          cardId: item.card?.id,
          fromCoords: item.boardCoords,
          toCoords: target.boardCoords,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      }

      sendAction(action, actionData)
    } else if (target.target === 'hand') {
      // Перемещение в руку
      if (item.source === 'announced') {
        // Из витрины в руку
        sendAction('MOVE_ANNOUNCED_TO_HAND', {
          playerId: item.playerId
        })
      } else if (item.source === 'counter_panel') {
        // Размещение жетона/статуса на карту в руке (например, Revealed)
        sendAction('ADD_STATUS_TO_HAND_CARD', {
          playerId: target.playerId,
          cardIndex: target.cardIndex,
          statusType: item.statusType,
          ownerId: item.ownerId,
          count: item.count || 1
        })
      } else {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_HAND', {
            cardId,
            cardIndex: item.cardIndex, // Pass cardIndex for deck/discard sources
            source: item.source,
            playerId: item.playerId
          })
        }
      }
    } else if (target.target === 'deck') {
      // Перемещение в колоду
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DECK', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в колоду
        sendAction('MOVE_ANNOUNCED_TO_DECK', {
          playerId: item.playerId
        })
      } else if (item.source === 'discard') {
        // Из сброса в колоду
        sendAction('MOVE_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          source: 'discard',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'discard') {
      // Перемещение в сброс
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DISCARD', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в сброс
        sendAction('MOVE_ANNOUNCED_TO_DISCARD', {
          playerId: item.playerId
        })
      } else if (item.source === 'deck') {
        // Из колоды в сброс
        sendAction('MOVE_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          source: 'deck',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'announced') {
      // Перемещение в витрину (announce)
      sendAction('ANNOUNCE_CARD', {
        cardId: item.card?.id,
        source: item.source,
        cardIndex: item.cardIndex,
        playerId: item.playerId
      })
    }
  }, [sendAction])

  const moveItem = useCallback((item: DragItem, target: any) => {
    // Reuse handleDrop logic for moveItem
    if (target.target === 'board') {
      let action = 'PLAY_CARD'
      let actionData: any = {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown,
        playerId: item.playerId
      }

      if (item.source === 'counter_panel') {
        action = 'ADD_STATUS_TO_BOARD_CARD'
        actionData = {
          boardCoords: target.boardCoords,
          statusType: item.statusType,
          ownerId: item.ownerId,
          replaceStatusType: item.replaceStatusType,
          count: item.count || 1
        }
      } else if (item.source === 'token_panel') {
        action = 'PLAY_TOKEN_CARD'
        actionData = {
          card: item.card,
          boardCoords: target.boardCoords,
          ownerId: item.ownerId
        }
      } else if (item.source === 'deck') {
        action = 'PLAY_CARD_FROM_DECK'
        actionData.cardIndex = item.cardIndex ?? 0
        actionData.playerId = item.playerId
      } else if (item.source === 'discard') {
        action = 'PLAY_CARD_FROM_DISCARD'
        actionData.cardIndex = item.cardIndex
        actionData.playerId = item.playerId
      } else if (item.source === 'announced') {
        action = 'PLAY_ANNOUNCED_TO_BOARD'
        actionData = {
          row: target.boardCoords.row,
          col: target.boardCoords.col,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      } else if (item.source === 'board') {
        action = 'MOVE_CARD_ON_BOARD'
        actionData = {
          cardId: item.card?.id,
          fromCoords: item.boardCoords,
          toCoords: target.boardCoords,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      }

      sendAction(action, actionData)
    } else if (target.target === 'hand') {
      if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_HAND', {
          playerId: item.playerId
        })
      } else {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_HAND', {
            cardId,
            cardIndex: item.cardIndex,
            source: item.source,
            playerId: item.playerId
          })
        }
      }
    } else if (target.target === 'deck') {
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DECK', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_DECK', {
          playerId: item.playerId
        })
      } else if (item.source === 'discard') {
        // Из сброса в колоду
        sendAction('MOVE_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          source: 'discard',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'discard') {
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DISCARD', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_DISCARD', {
          playerId: item.playerId
        })
      } else if (item.source === 'deck') {
        // Из колоды в сброс
        sendAction('MOVE_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          source: 'deck',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'announced') {
      sendAction('ANNOUNCE_CARD', {
        cardId: item.card?.id,
        source: item.source,
        cardIndex: item.cardIndex,
        playerId: item.playerId
      })
    }
  }, [sendAction])


  const updateState = useCallback((_stateOrFn: any) => {
    if (isHostRef.current) {
      // Хост может обновлять состояние напрямую
      // TODO: интегрировать с applyAction
    }
  }, [])

  const shufflePlayerDeck = useCallback((playerId?: number) => {
    sendAction('SHUFFLE_DECK', { playerId })
  }, [sendAction])

  // ============================================================================
  // Фазовые действия
  // ============================================================================
  const nextPhase = useCallback((forceTurnPass?: boolean) => {
    sendAction('NEXT_PHASE', { forceTurnPass })
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
  const scoreLine = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number) => {
    sendAction('SELECT_SCORING_LINE', { r1, c1, r2, c2, playerId })
  }, [sendAction])

  const selectScoringLine = useCallback((lineType: string, lineIndex?: number) => {
    sendAction('SELECT_SCORING_LINE', { lineType, lineIndex })
  }, [sendAction])

  const scoreDiagonal = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => {
    sendAction('SCORE_DIAGONAL', { r1, c1, r2, c2, playerId, bonusType })
  }, [sendAction])

  const closeRoundEndModal = useCallback(() => {
    sendAction('START_NEXT_ROUND')
  }, [sendAction])

  const closeRoundEndModalOnly = useCallback(() => {
    // TODO
  }, [])

  // ============================================================================
  // Visual effects - using useVisualEffects hook
  // ============================================================================

  // Initialize visual effects with simpleHost if available
  const visualEffects = useVisualEffects({
    simpleHost: hostRef.current,
    simpleGuest: guestRef.current,
    gameStateRef,
    localPlayerIdRef,
    setLatestHighlight,
    setLatestFloatingTexts,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setGameState,
  })

  const {
    triggerHighlight,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    triggerFloatingText,
    setTargetingMode,
    clearTargetingMode,
  } = visualEffects

  const syncValidTargets = useCallback((_options: { validHandTargets?: {playerId: number, cardIndex: number}[]; isDeckSelectable?: boolean }) => {
    // Handled via targeting mode in P2P
  }, [])

  // ============================================================================
  // Status effects
  // ============================================================================
  const addBoardCardStatus = useCallback((coords: any, status: any, playerId?: number) => {
    // Map to P2P action format
    sendAction('ADD_STATUS_TO_BOARD_CARD', {
      boardCoords: coords,
      statusType: status,
      ownerId: playerId ?? localPlayerId ?? 0
    })
  }, [sendAction, localPlayerId])
  const removeBoardCardStatus = useCallback((coords: any, status: any) => {
    // Map to P2P action format
    sendAction('REMOVE_ALL_COUNTERS_BY_TYPE', { coords, type: status })
  }, [sendAction])
  const removeBoardCardStatusByOwner = useCallback((coords: any, status: any, ownerId: number) => {
    // Remove status by type and owner (for removing counters added by specific player)
    sendAction('REMOVE_COUNTER_BY_TYPE', { coords, type: status, ownerId })
  }, [sendAction])
  const modifyBoardCardPower = useCallback((coords: any, delta: number) => {
    sendAction('MODIFY_CARD_POWER', { coords, delta })
  }, [sendAction])
  const addAnnouncedCardStatus = useCallback((playerId: number, status: any, addedByPlayerId?: number) => {
    sendAction('ADD_ANNOUNCED_STATUS', { playerId, status, addedByPlayerId })
  }, [sendAction])
  const removeAnnouncedCardStatus = useCallback((playerId: number, status: any) => {
    sendAction('REMOVE_ANNOUNCED_STATUS', { playerId, status })
  }, [sendAction])
  const modifyAnnouncedCardPower = useCallback(() => {}, [])
  const addHandCardStatus = useCallback(() => {}, [])
  const removeHandCardStatus = useCallback(() => {}, [])
  const flipBoardCard = useCallback((coords: any) => {
    if (!coords) { return }
    sendAction('FLIP_CARD', { boardCoords: coords, faceDown: false })
    console.log('[useGameState] flipBoardCard: Flipping card face-up at', coords)
  }, [sendAction])

  const flipBoardCardFaceDown = useCallback((coords: any) => {
    if (!coords) { return }
    sendAction('FLIP_CARD', { boardCoords: coords, faceDown: true })
    console.log('[useGameState] flipBoardCardFaceDown: Flipping card face-down at', coords)
  }, [sendAction])
  const revealHandCard = useCallback(() => {}, [])
  const revealBoardCard = useCallback(() => {}, [])
  const requestCardReveal = useCallback((request: any, requesterPlayerId?: number) => {
    sendAction('REQUEST_CARD_REVEAL', { request, requesterPlayerId })
  }, [sendAction])
  const respondToRevealRequest = useCallback((requesterPlayerId: number, accept: boolean) => {
    sendAction('RESPOND_REVEAL_REQUEST', { requesterPlayerId, accept })
  }, [sendAction])

  // ============================================================================
  // Game lifecycle
  // ============================================================================
  const syncGame = useCallback(() => {}, [])
  const toggleActivePlayer = useCallback(() => {}, [])
  const toggleAutoDraw = useCallback((playerId: number, enabled: boolean) => {
    sendAction('TOGGLE_AUTO_DRAW', { playerId, enabled })
  }, [sendAction])
  const forceReconnect = useCallback(async () => {
    if (guestRef.current) {
      await guestRef.current.reconnect()
    }
  }, [])

  // ============================================================================
  // Card manipulation
  // ============================================================================
  const destroyCard = useCallback((card: Card, boardCoords: { row: number; col: number }) => {
    sendAction('DESTROY_CARD', { cardId: card.id, boardCoords })
  }, [sendAction])

  const applyGlobalEffect = useCallback(() => {}, [])
  const swapCards = useCallback((coords1: {row: number, col: number}, coords2: {row: number, col: number}) => {
    sendAction('SWAP_CARDS', { coords1, coords2 })
  }, [sendAction])
  const transferStatus = useCallback(() => {}, [])
  const transferAllCounters = useCallback(() => {}, [])
  const transferAllStatusesWithoutException = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => {
    sendAction('TRANSFER_ALL_STATUSES', { fromCoords, toCoords })
  }, [sendAction])
  const recoverDiscardedCard = useCallback((playerId: number, cardIndex: number) => {
    sendAction('RECOVER_DISCARDED', { playerId, cardIndex })
  }, [sendAction])
  const resurrectDiscardedCard = useCallback((playerId: number, cardIndex: number, boardCoords: {row: number, col: number}) => {
    sendAction('RESURRECT_DISCARDED', { cardOwnerId: playerId, cardIndex, boardCoords })
  }, [sendAction])
  const spawnToken = useCallback((coords: {row: number, col: number}, name: string, ownerId: number) => {
    // Get token data from tokenDatabase
    const tokenDef = tokenDatabase.get(name)
    const tokenData = tokenDef ? {
      baseId: name,
      name: tokenDef.name,
      imageUrl: tokenDef.imageUrl,
      fallbackImage: tokenDef.fallbackImage,
      power: tokenDef.power,
      abilityText: tokenDef.abilityText,
      types: tokenDef.types || []
    } : null

    sendAction('SPAWN_TOKEN', { coords, tokenName: name, ownerId, tokenData })
  }, [sendAction])

  // ============================================================================
  // Game reset
  // ============================================================================
  const resetGame = useCallback(() => {
    sendAction('RESET_GAME')
  }, [sendAction])
  const resetDeployStatus = useCallback(() => {}, [])
  const removeStatusByType = useCallback((coords: { row: number; col: number }, type: string) => {
    sendAction('REMOVE_ALL_COUNTERS_BY_TYPE', { coords, type })
  }, [sendAction])
  const reorderTopDeck = useCallback((playerId: number, newTopCards: any[]) => {
    sendAction('REORDER_TOP_DECK', { playerId, newTopCards })
  }, [sendAction])
  const reorderCards = useCallback((playerId: number, newOrder: any[]) => {
    sendAction('REORDER_CARDS', { playerId, newOrder })
  }, [sendAction])
  const requestDeckView = useCallback((targetPlayerId: number) => {
    sendAction('REQUEST_DECK_VIEW', { targetPlayerId })
  }, [sendAction])

  const markAbilityUsed = useCallback((coords: any, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => {
    sendAction('MARK_ABILITY_USED', { coords, isDeploy, setDeployAttempted, readyStatusToRemove })
  }, [sendAction])

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
    // Dispatch custom event to hide tooltips when drag starts
    if (item !== null) {
      window.dispatchEvent(new CustomEvent('cardDragStart'))
    } else {
      window.dispatchEvent(new CustomEvent('cardDragEnd'))
    }
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
    setDummyPlayerCount,
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
    passTurn,
    markAbilityUsed,
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
    selectScoringLine,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    resetGame,
    resetDeployStatus,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    requestDeckView,
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
    connectAsGuest: useCallback(async (hostId: string) => {
      try {
        await joinGameViaModal(hostId)
        return true
      } catch {
        return false
      }
    }, [joinGameViaModal]),

    // Additional WebRTC compatibility props (stubs for now)
    sendFullDeckToHost: (_playerId: number, _deck: any[], _deckLength: number) => {},
    shareHostDeckWithGuests: (_deck: any[], _deckLength: number) => {},
    isReconnecting: false,
    reconnectProgress: null,
  }
}

export default useGameState
