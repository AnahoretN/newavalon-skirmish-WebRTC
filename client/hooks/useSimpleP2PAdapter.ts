/**
 * useSimpleP2PAdapter
 *
 * Адаптер для новой упрощённой P2P системы.
 * Совместим с существующим useGameState интерфейсом.
 */

import { useCallback, useRef, useEffect } from 'react'
import { useSimpleP2P } from './useSimpleP2P'
import type { GameState, Player, Card, DragItem, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData, AbilityAction, CursorStackState, CommandContext, CounterSelectionData } from '../../types'
import { createInitialBoard } from '@shared/utils/boardUtils'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'
import { logger } from '../../utils/logger'
import { createInitialState } from './gameCreators'

/**
 * Адаптер который преобразует PersonalizedState в GameState
 * и предоставляет совместимый с useGameState интерфейс
 */
export function useSimpleP2PAdapter() {
  const simpleP2P = useSimpleP2P()

  // Refs для состояния
  const gameStateRef = useRef<GameState>(createInitialState())
  const localPlayerIdRef = useRef<number>(1)

  // Обновляем ref при изменении состояния
  useEffect(() => {
    if (simpleP2P.gameState) {
      // Конвертируем PersonalizedState в GameState
      // PersonalizedState.players имеет PersonalizedPlayer[]
      // Нам нужно преобразовать в Player[] с полными данными

      const players: Player[] = simpleP2P.gameState.players.map(p => {
        // Если есть hand - значит это полные данные (локальный игрок или dummy)
        if (p.hand) {
          return {
            ...p,
            hand: p.hand || [],
            deck: p.deck || [],
            discard: p.discard || [],
            boardHistory: p.boardHistory || [],
            announcedCard: p.announcedCard || null
          }
        } else {
          // Для других игроков - только размеры
          return {
            ...p,
            hand: [],
            deck: [],
            discard: [],
            handSize: p.handSize || 0,
            deckSize: p.deckSize || 0,
            discardSize: p.discardSize || 0,
            boardHistory: [],
            announcedCard: null
          }
        }
      })

      const fullState: GameState = {
        ...simpleP2P.gameState,
        players,
        // Убираем тип, который несовместим
      } as GameState

      gameStateRef.current = fullState
      localPlayerIdRef.current = simpleP2P.localPlayerId
    }
  }, [simpleP2P.gameState, simpleP2P.localPlayerId])

  // ============================================================================
  // Создание и подключение к игре
  // ============================================================================

  const createGame = useCallback(async () => {
    const peerId = await simpleP2P.initializeHost()
    logger.info('[useSimpleP2PAdapter] Host created:', peerId)
    return peerId
  }, [simpleP2P])

  const joinGameViaModal = useCallback(async (gameCode: string) => {
    const playerId = await simpleP2P.connectAsGuest(gameCode)
    logger.info('[useSimpleP2PAdapter] Joined as player:', playerId)
    return playerId
  }, [simpleP2P])

  const joinAsInvite = useCallback(async (hostPeerId: string) => {
    return await joinGameViaModal(hostPeerId)
  }, [joinGameViaModal])

  // ============================================================================
  // Игровые действия - отправляем через sendAction
  // ============================================================================

  const updatePlayerName = useCallback((name: string) => {
    simpleP2P.sendAction('CHANGE_PLAYER_NAME', { name })
    // Локальное обновление для отклика
    const state = gameStateRef.current
    const players = state.players.map(p =>
      p.id === localPlayerIdRef.current ? { ...p, name } : p
    )
    gameStateRef.current = { ...state, players }
  }, [simpleP2P])

  const changePlayerColor = useCallback((color: any) => {
    simpleP2P.sendAction('CHANGE_PLAYER_COLOR', { color })
  }, [simpleP2P])

  const updatePlayerScore = useCallback((delta: number) => {
    simpleP2P.sendAction('UPDATE_SCORE', { delta })
  }, [simpleP2P])

  const changePlayerDeck = useCallback((deckType: any) => {
    simpleP2P.sendAction('CHANGE_PLAYER_DECK', { deck: deckType })
  }, [simpleP2P])

  const drawCard = useCallback((playerId?: number) => {
    const pid = playerId || localPlayerIdRef.current
    simpleP2P.sendAction('DRAW_CARD')
  }, [simpleP2P])

  const handleDrop = useCallback((item: DragItem, target: any) => {
    if (target.target === 'board') {
      simpleP2P.sendAction('PLAY_CARD', {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown
      })
    }
    // TODO: другие типы drop
  }, [simpleP2P])

  const nextPhase = useCallback(() => {
    simpleP2P.sendAction('NEXT_PHASE')
  }, [simpleP2P])

  const prevPhase = useCallback(() => {
    simpleP2P.sendAction('PREVIOUS_PHASE')
  }, [simpleP2P])

  const setPhase = useCallback((phaseNumber: number) => {
    simpleP2P.sendAction('SET_PHASE', { phase: phaseNumber })
  }, [simpleP2P])

  const passTurn = useCallback(() => {
    simpleP2P.sendAction('PASS_TURN', { reason: 'manual' })
  }, [simpleP2P])

  const playerReady = useCallback(() => {
    simpleP2P.sendAction('PLAYER_READY')
  }, [simpleP2P])

  const assignTeams = useCallback((teams: any) => {
    simpleP2P.sendAction('ASSIGN_TEAMS', { teams })
  }, [simpleP2P])

  const setGameMode = useCallback((mode: any) => {
    simpleP2P.sendAction('SET_GAME_MODE', { mode })
  }, [simpleP2P])

  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    simpleP2P.sendAction('SET_PRIVACY', { isPrivate })
  }, [simpleP2P])

  const setActiveGridSize = useCallback((size: any) => {
    simpleP2P.sendAction('SET_GRID_SIZE', { size })
  }, [simpleP2P])

  // ============================================================================
  // Вспомогательные функции (заглушки для совместимости)
  // ============================================================================

  const updateState = useCallback((updater: any) => {
    // Для хоста - применить локально
    if (simpleP2P.isHost()) {
      // TODO: реализовать
    }
  }, [simpleP2P])

  const destroyCard = useCallback((cardId: string) => {
    simpleP2P.sendAction('DESTROY_CARD', { cardId })
  }, [simpleP2P])

  const moveItem = useCallback((item: any, target: any) => {
    // TODO
  }, [simpleP2P])

  const shufflePlayerDeck = useCallback(() => {
    simpleP2P.sendAction('SHUFFLE_DECK')
  }, [simpleP2P])

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
  const syncGame = useCallback(() => {}, [])
  const toggleActivePlayer = useCallback(() => {}, [])
  const toggleAutoDraw = useCallback(() => {}, [])
  const forceReconnect = useCallback(() => {}, Promise.resolve())
  const triggerHighlight = useCallback(() => {}, [])
  const triggerNoTarget = useCallback(() => {}, [])
  const triggerDeckSelection = useCallback(() => {}, [])
  const triggerHandCardSelection = useCallback(() => {}, [])
  const triggerClickWave = useCallback(() => {}, [])
  const syncValidTargets = useCallback(() => {}, [])
  const setTargetingMode = useCallback(() => {}, [])
  const clearTargetingMode = useCallback(() => {}, [])
  const markAbilityUsed = useCallback(() => {}, [])
  const applyGlobalEffect = useCallback(() => {}, [])
  const swapCards = useCallback(() => {}, [])
  const transferStatus = useCallback(() => {}, [])
  const transferAllCounters = useCallback(() => {}, [])
  const transferAllStatusesWithoutException = useCallback(() => {}, [])
  const recoverDiscardedCard = useCallback(() => {}, [])
  const resurrectDiscardedCard = useCallback(() => {}, [])
  const spawnToken = useCallback(() => {}, [])
  const scoreLine = useCallback(() => {}, [])
  const closeRoundEndModal = useCallback(() => {
    simpleP2P.sendAction('COMPLETE_ROUND')
  }, [simpleP2P])
  const closeRoundEndModalOnly = useCallback(() => {}, [])
  const resetGame = useCallback(() => {}, [])
  const resetDeployStatus = useCallback(() => {}, [])
  const scoreDiagonal = useCallback(() => {}, [])
  const removeStatusByType = useCallback(() => {}, [])
  const reorderTopDeck = useCallback(() => {}, [])
  const reorderCards = useCallback(() => {}, [])
  const triggerFloatingText = useCallback(() => {}, [])

  const setLocalPlayerId = useCallback((id: number) => {
    localPlayerIdRef.current = id
  }, [])

  const setDraggedItem = useCallback((item: DragItem | null) => {
    // TODO
  }, [])

  const requestGamesList = useCallback(() => {}, [])
  const exitGame = useCallback(() => {
    simpleP2P.host?.destroy()
    simpleP2P.guest?.destroy()
  }, [simpleP2P])

  const loadCustomDeck = useCallback(() => {}, [])
  const drawCardsBatch = useCallback(() => {}, [])

  // ============================================================================
  // WebRTC свойства
  // ============================================================================

  const webrtcHostId = simpleP2P.host?.getPeerId() || null
  const webrtcIsHost = simpleP2P.isHost()

  // ============================================================================
  // Возвращаем совместимый интерфейс
  // ============================================================================

  return {
    // Состояние
    gameState: gameStateRef.current,
    localPlayerId: localPlayerIdRef.current,
    setLocalPlayerId,
    draggedItem: null,
    setDraggedItem,

    // Соединение
    connectionStatus: simpleP2P.connectionStatus(),
    gamesList: [],

    // Действия
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
    latestHighlight: null,
    latestFloatingTexts: [],
    latestNoTarget: null,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    clickWaves: [],
    syncValidTargets,
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
    transferAllStatusesWithoutException,
    destroyCard,
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
    triggerFloatingText,
    latestDeckSelections: [],
    latestHandCardSelections: [],

    // WebRTC
    webrtcHostId,
    webrtcIsHost,

    // Пустые функции для совместимости
    moveItem,
    requestGamesList,
    exitGame,
  }
}

export default useSimpleP2PAdapter
