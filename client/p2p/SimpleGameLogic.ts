/**
 * Simple Game Logic
 *
 * Вся логика игры в одном месте.
 * Функция applyAction принимает текущее состояние и действие,
 * возвращает новое состояние.
 */

import type { GameState, Card, Player, DeckType } from '../types'
import type { ActionType } from './SimpleP2PTypes'
import { getCardDefinition } from '../content'
import { shuffleDeck } from '../../shared/utils/array'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'

/**
 * Применить действие к состоянию игры
 * Это единственное место где изменяется состояние игры!
 */
export function applyAction(
  state: GameState,
  playerId: number,
  action: ActionType,
  data?: any
): GameState {
  // Валидация - можно ли этому игроку выполнять это действие
  if (!canPlayerAct(state, playerId, action, data)) {
    console.warn(`[SimpleGameLogic] Player ${playerId} cannot ${action}`)
    return state
  }

  let newState = { ...state }

  switch (action) {
    case 'NEXT_PHASE':
      newState = handleNextPhase(newState, playerId)
      break

    case 'PREVIOUS_PHASE':
      newState = handlePreviousPhase(newState, playerId)
      break

    case 'PASS_TURN':
      newState = handlePassTurn(newState, playerId, data?.reason || 'manual')
      break

    case 'SET_PHASE':
      newState = handleSetPhase(newState, data?.phase)
      break

    case 'PLAY_CARD':
      newState = handlePlayCard(newState, playerId, data)
      break

    case 'MOVE_CARD':
      newState = handleMoveCard(newState, playerId, data)
      break

    case 'RETURN_CARD_TO_HAND':
      newState = handleReturnCardToHand(newState, playerId, data)
      break

    case 'ANNOUNCE_CARD':
      newState = handleAnnounceCard(newState, playerId, data)
      break

    case 'DESTROY_CARD':
      newState = handleDestroyCard(newState, playerId, data)
      break

    case 'DRAW_CARD':
      newState = handleDrawCard(newState, playerId)
      break

    case 'SHUFFLE_DECK':
      newState = handleShuffleDeck(newState, playerId)
      break

    case 'UPDATE_SCORE':
      newState = handleUpdateScore(newState, playerId, data?.delta || 0)
      break

    case 'CHANGE_PLAYER_NAME':
      newState = handleChangePlayerName(newState, playerId, data?.name)
      break

    case 'CHANGE_PLAYER_COLOR':
      newState = handleChangePlayerColor(newState, playerId, data?.color)
      break

    case 'CHANGE_PLAYER_DECK':
      newState = handleChangePlayerDeck(newState, playerId, data?.deck)
      break

    case 'START_SCORING':
      newState = handleStartScoring(newState, playerId)
      break

    case 'SELECT_SCORING_LINE':
      newState = handleSelectScoringLine(newState, playerId, data)
      break

    case 'COMPLETE_ROUND':
      newState = handleCompleteRound(newState)
      break

    case 'START_NEXT_ROUND':
      newState = handleStartNextRound(newState)
      break

    case 'START_NEW_MATCH':
      newState = handleStartNewMatch(newState)
      break

    case 'PLAYER_READY':
      newState = handlePlayerReady(newState, playerId)
      break

    case 'SET_GAME_MODE':
      newState = handleSetGameMode(newState, data?.mode)
      break

    case 'SET_GRID_SIZE':
      newState = handleSetGridSize(newState, data?.size)
      break

    case 'SET_PRIVACY':
      newState = handleSetPrivacy(newState, data?.isPrivate)
      break

    case 'ASSIGN_TEAMS':
      newState = handleAssignTeams(newState, data?.teams)
      break

    default:
      console.warn(`[SimpleGameLogic] Unknown action: ${action}`)
  }

  // Всегда пересчитываем статусы карт на доске
  newState.board = recalculateBoardStatuses(newState)

  return newState
}

/**
 * Проверить может ли игрок выполнить это действие
 */
function canPlayerAct(
  state: GameState,
  playerId: number,
  action: ActionType,
  data?: any
): boolean {
  // Настройки игры может делать любой игрок в лобби
  if (!state.isGameStarted) {
    return ['PLAYER_READY', 'CHANGE_PLAYER_NAME', 'CHANGE_PLAYER_COLOR',
            'CHANGE_PLAYER_DECK', 'SET_GAME_MODE', 'SET_GRID_SIZE',
            'SET_PRIVACY', 'ASSIGN_TEAMS'].includes(action)
  }

  // Игроки могут менять свои настройки
  if (action === 'CHANGE_PLAYER_NAME' || action === 'CHANGE_PLAYER_COLOR') {
    return true
  }

  // Dummy игроков могут контролировать все
  const player = state.players.find(p => p.id === playerId)
  if (player?.isDummy) return true

  // Фазовые действия - только активный игрок
  if (['NEXT_PHASE', 'PREVIOUS_PHASE', 'PASS_TURN', 'START_SCORING'].includes(action)) {
    return state.activePlayerId === playerId
  }

  // Игровые действия - только активный игрок или все в зависимости от настроек
  if (['PLAY_CARD', 'MOVE_CARD', 'DRAW_CARD', 'ANNOUNCE_CARD'].includes(action)) {
    return state.activePlayerId === playerId
  }

  return true
}

// ============================================================================
// Фазовые действия
// ============================================================================

/**
 * NEXT_PHASE - переход к следующей фазе
 */
function handleNextPhase(state: GameState, playerId: number): GameState {
  const phase = state.currentPhase

  // Preparation (0) → Setup (1) - автоматический, обрабатывается в passTurn
  if (phase === 0) {
    return { ...state, currentPhase: 1 }
  }

  // Setup (1) → Main (2) - происходит при игре карты
  if (phase === 1) {
    return { ...state, currentPhase: 2 }
  }

  // Main (2) → Commit (3)
  if (phase === 2) {
    return { ...state, currentPhase: 3 }
  }

  // Commit (3) → Scoring (4) или PassTurn
  if (phase === 3) {
    // Проверяем есть ли у игрока карты со статусом "последняя сыгранная" на доске
    const hasLastPlayedCards = state.board.some(row =>
      row.some(cell => cell.card?.ownerId === playerId && cell.card?.enteredThisTurn)
    )

    if (hasLastPlayedCards) {
      // Есть новые карты - переходим к Scoring
      return { ...state, currentPhase: 4, isScoringStep: true }
    } else {
      // Нет новых карт - передаём ход
      return handlePassTurn(state, playerId, 'no_new_cards')
    }
  }

  // Scoring (4) → PassTurn
  if (phase === 4) {
    return handlePassTurn(state, playerId, 'scoring_complete')
  }

  return state
}

/**
 * PREVIOUS_PHASE - возврат к предыдущей фазе
 */
function handlePreviousPhase(state: GameState, playerId: number): GameState {
  const phase = state.currentPhase

  if (phase > 1) {
    return { ...state, currentPhase: phase - 1 as any }
  }

  return state
}

/**
 * PASS_TURN - передать ход следующему игроку
 */
function handlePassTurn(state: GameState, playerId: number, reason: string): GameState {
  const activePlayerIds = getActivePlayerIds(state.players)
  if (activePlayerIds.length === 0) return state

  const currentIndex = activePlayerIds.indexOf(state.activePlayerId || 1)
  const nextIndex = (currentIndex + 1) % activePlayerIds.length
  const nextPlayerId = activePlayerIds[nextIndex]

  console.log('[handlePassTurn] Turn passed from', playerId, 'to', nextPlayerId, 'reason:', reason)

  // Сбрасываем enteredThisTurn у всех карт на доске при передаче хода
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card) {
        return {
          card: {
            ...cell.card,
            enteredThisTurn: false
          }
        }
      }
      return cell
    })
  )

  let newState = {
    ...state,
    board: newBoard,
    activePlayerId: nextPlayerId,
    currentPhase: 0,  // Preparation
  }

  // Проверяем полный круг (вернулись к начавшему игроку)
  if (nextPlayerId === state.startingPlayerId) {
    newState.turnNumber = (state.turnNumber || 0) + 1
  }

  // Preparation phase: auto-draw для нового активного игрока
  newState = executePreparationPhase(newState, nextPlayerId)

  return newState
}

/**
 * SET_PHASE - установить конкретную фазу
 */
function handleSetPhase(state: GameState, phaseNumber: number): GameState {
  const clamped = Math.max(0, Math.min(4, phaseNumber))
  return { ...state, currentPhase: clamped }
}

/**
 * Preparation phase - auto-draw и проверка окончания раунда
 */
function executePreparationPhase(state: GameState, activePlayerId: number): GameState {
  let newState = { ...state }
  const player = newState.players.find(p => p.id === activePlayerId)

  if (!player) return state

  console.log('[executePreparationPhase] Player', activePlayerId, 'autoDraw:', state.autoDrawEnabled, 'deckSize:', player.deck?.length || 0)

  // Auto-draw если включен и есть карты в колоде
  if (state.autoDrawEnabled && player.deck && player.deck.length > 0) {
    const drawnCard = player.deck.shift()
    if (drawnCard) {
      player.hand.push(drawnCard)
      player.handSize = player.hand.length
      player.deckSize = player.deck.length
      console.log('[executePreparationPhase] Player', activePlayerId, 'drew card, hand:', player.hand.length)
    }
  }

  // Проверка окончания раунда
  if (shouldRoundEnd(newState)) {
    newState = endRound(newState)
    return newState
  }

  // Переход к Setup
  newState.currentPhase = 1
  console.log('[executePreparationPhase] Transition to Setup phase for player', activePlayerId)
  return newState
}

// ============================================================================
// Карточные действия
// ============================================================================

/**
 * PLAY_CARD - сыграть карту из руки на доску
 */
function handlePlayCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown = false } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || !boardCoords) return state

  const cardIndexNum = cardIndex ?? player.hand.length - 1
  const card = player.hand[cardIndexNum]

  if (!card) return state

  // Убираем карту из руки
  const newHand = [...player.hand]
  newHand.splice(cardIndexNum, 1)

  // Добавляем на доску
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (r === boardCoords.row && c === boardCoords.col) {
        return {
          card: {
            ...card,
            ownerId: playerId,
            isFaceDown: faceDown,
            enteredThisTurn: true
          }
        }
      }
      return cell
    })
  )

  // Добавляем в boardHistory
  const newBoardHistory = [...player.boardHistory, card.id]

  // Обновляем игрока
  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? {
          ...p,
          hand: newHand,
          handSize: newHand.length,
          boardHistory: newBoardHistory
        }
      : p
  )

  return {
    ...state,
    board: newBoard,
    players: newPlayers,
    currentPhase: 2  // Main phase после игры карты
  }
}

/**
 * MOVE_CARD - переместить карту
 */
function handleMoveCard(state: GameState, playerId: number, data: any): GameState {
  // TODO: реализовать перемещение карт
  return state
}

/**
 * RETURN_CARD_TO_HAND - вернуть карту в руку
 */
function handleReturnCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) return state

  let cardToReturn: Card | null = null
  let sourceCoords: { row: number; col: number } | null = null

  // Находим карту на доске
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (cell.card?.id === cardId) {
        cardToReturn = cell.card
        sourceCoords = { row: r, col: c }
        return { card: null }
      }
      return cell
    })
  )

  if (!cardToReturn || !sourceCoords) return state

  // Добавляем в руку владельцу
  const ownerId = cardToReturn.ownerId || playerId
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      return {
        ...p,
        hand: [...p.hand, cardToReturn],
        handSize: p.hand.length + 1
      }
    }
    return p
  })

  return {
    ...state,
    board: newBoard,
    players: newPlayers
  }
}

/**
 * ANNOUNCE_CARD - объявить карту
 */
function handleAnnounceCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || cardIndex === undefined) return state

  const card = player.hand[cardIndex]
  if (!card) return state

  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      const newHand = [...p.hand]
      newHand.splice(cardIndex, 1)
      return {
        ...p,
        hand: newHand,
        handSize: newHand.length,
        announcedCard: card
      }
    }
    return p
  })

  return { ...state, players: newPlayers }
}

/**
 * DESTROY_CARD - уничтожить карту
 */
function handleDestroyCard(state: GameState, playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) return state

  let destroyedCard: Card | null = null
  let ownerId: number | null = null

  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card?.id === cardId) {
        destroyedCard = cell.card
        ownerId = cell.card.ownerId || null
        return { card: null }
      }
      return cell
    })
  )

  if (!destroyedCard || !ownerId) return state

  // Добавляем в discard владельцу
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      return {
        ...p,
        discard: [...p.discard, destroyedCard],
        discardSize: p.discard.length + 1
      }
    }
    return p
  })

  return {
    ...state,
    board: newBoard,
    players: newPlayers
  }
}

// ============================================================================
// Управление колодой
// ============================================================================

/**
 * DRAW_CARD - взять карту из колоды
 */
function handleDrawCard(state: GameState, playerId: number): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.deck || player.deck.length === 0) return state

  const newDeck = [...player.deck]
  const card = newDeck.shift()

  if (!card) return state

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? {
          ...p,
          deck: newDeck,
          deckSize: newDeck.length,
          hand: [...p.hand, card],
          handSize: p.hand.length + 1
        }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * SHUFFLE_DECK - перемешать колоду
 */
function handleShuffleDeck(state: GameState, playerId: number): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player) return state

  const newDeck = shuffleDeck([...player.deck])

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, deck: newDeck }
      : p
  )

  return { ...state, players: newPlayers }
}

// ============================================================================
// Счёт и статус игрока
// ============================================================================

/**
 * UPDATE_SCORE - обновить счёт игрока
 */
function handleUpdateScore(state: GameState, playerId: number, delta: number): GameState {
  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      return { ...p, score: Math.max(0, p.score + delta) }
    }
    return p
  })

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_NAME - изменить имя игрока
 */
function handleChangePlayerName(state: GameState, playerId: number, name: string): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, name } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_COLOR - изменить цвет игрока
 */
function handleChangePlayerColor(state: GameState, playerId: number, color: any): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, color } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_DECK - изменить колоду игрока
 * Создаёт новую колоду выбранного типа
 */
function handleChangePlayerDeck(state: GameState, playerId: number, deckType: DeckType): GameState {
  // Импортируем здесь, чтобы избежать циклических зависимостей
  const { createDeck } = require('../hooks/core/gameCreators')

  const player = state.players.find(p => p.id === playerId)
  if (!player) return state

  // Создаём новую колоду
  const newDeck = createDeck(deckType, playerId, player.name)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, selectedDeck: deckType, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  console.log(`[SimpleGameLogic] Player ${playerId} changed deck to ${deckType}, ${newDeck.length} cards`)

  return { ...state, players: newPlayers }
}

// ============================================================================
// Скоринг
// ============================================================================

/**
 * START_SCORING - начать фазу скоринга
 */
function handleStartScoring(state: GameState, playerId: number): GameState {
  if (state.currentPhase !== 3) return state

  return { ...state, currentPhase: 4, isScoringStep: true }
}

/**
 * SELECT_SCORING_LINE - выбрать линию для скоринга
 */
function handleSelectScoringLine(state: GameState, playerId: number, data: any): GameState {
  if (!state.isScoringStep || state.activePlayerId !== playerId) return state

  // Добавляем очки (упрощённо)
  const points = data?.points || 0
  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, score: p.score + points }
      : p
  )

  // Передаём ход
  let newState = {
    ...state,
    players: newPlayers,
    isScoringStep: false
  }

  return handlePassTurn(newState, playerId, 'scoring_complete')
}

// ============================================================================
// Раунд и матч
// ============================================================================

/**
 * COMPLETE_ROUND - закрыть модалку окончания раунда
 */
function handleCompleteRound(state: GameState): GameState {
  return { ...state, isRoundEndModalOpen: false }
}

/**
 * START_NEXT_ROUND - начать следующий раунд
 */
function handleStartNextRound(state: GameState): GameState {
  const newRound = (state.currentRound || 1) + 1

  const newPlayers = state.players.map(p => ({
    ...p,
    score: 0  // Сброс счёта
  }))

  return {
    ...state,
    currentRound: newRound,
    players: newPlayers,
    isRoundEndModalOpen: false,
    gameWinner: null
  }
}

/**
 * START_NEW_MATCH - начать новую игру
 */
function handleStartNewMatch(state: GameState): GameState {
  const newPlayers = state.players.map(p => ({
    ...p,
    score: 0
  }))

  return {
    ...state,
    currentRound: 1,
    players: newPlayers,
    roundWinners: {},
    gameWinner: null,
    isRoundEndModalOpen: false
  }
}

// ============================================================================
// Ready check
// ============================================================================

/**
 * PLAYER_READY - игрок готов
 */
function handlePlayerReady(state: GameState, playerId: number): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, isReady: true } : p
  )

  // Проверяем все ли готовы
  const allReady = newPlayers.every(p => p.isReady || p.isDummy || p.isSpectator)

  // Если все готовы - начинаем игру
  if (allReady) {
    return startGame({ ...state, players: newPlayers })
  }

  return { ...state, players: newPlayers }
}

/**
 * Начать игру
 */
function startGame(state: GameState): GameState {
  // Выбираем случайного начального игрока
  const activePlayers = state.players.filter(p => !p.isDisconnected && !p.isSpectator)
  const startingPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)]

  console.log('[startGame] Starting player:', startingPlayer.id, startingPlayer.name)

  // Раздаём начальные руки (6 карт каждому)
  const newPlayers = state.players.map(p => {
    if (p.isDummy || p.isSpectator || p.isDisconnected) return p

    const hand: Card[] = []
    const deck = [...p.deck]

    for (let i = 0; i < 6; i++) {
      if (deck.length > 0) {
        hand.push(deck.shift()!)
      }
    }

    console.log(`[startGame] Player ${p.id} (${p.name}) drew 6 cards`)

    return {
      ...p,
      hand,
      deck,
      handSize: hand.length,
      deckSize: deck.length
    }
  })

  // Начальный игрок получает 7-ю карту (преимущество первого хода)
  const startingPlayerIndex = newPlayers.findIndex(p => p.id === startingPlayer.id)
  if (startingPlayerIndex >= 0 && newPlayers[startingPlayerIndex].deck.length > 0) {
    const sp = newPlayers[startingPlayerIndex]
    const card = sp.deck.shift()
    if (card) {
      sp.hand.push(card)
      sp.handSize = sp.hand.length
      sp.deckSize = sp.deck.length
      console.log(`[startGame] Starting player ${sp.id} drew 7th card`)
    }
  }

  return {
    ...state,
    players: newPlayers,
    isGameStarted: true,
    isReadyCheckActive: false,
    startingPlayerId: startingPlayer.id,
    activePlayerId: startingPlayer.id,
    currentPhase: 1,  // Setup - можно сразу играть карты
    turnNumber: 1
  }
}

// ============================================================================
// Игровые настройки
// ============================================================================

function handleSetGameMode(state: GameState, mode: any): GameState {
  return { ...state, gameMode: mode }
}

function handleSetGridSize(state: GameState, size: any): GameState {
  return { ...state, activeGridSize: size }
}

function handleSetPrivacy(state: GameState, isPrivate: boolean): GameState {
  return { ...state, isPrivate }
}

function handleAssignTeams(state: GameState, teams: any): GameState {
  const newPlayers = state.players.map(p => ({
    ...p,
    teamId: teams[p.id]
  }))

  return { ...state, players: newPlayers }
}

// ============================================================================
// Вспомогательные функции
// ============================================================================

/**
 * Получить ID активных игроков (не отключённые, не зрители)
 */
function getActivePlayerIds(players: Player[]): number[] {
  return players
    .filter(p => !p.isDisconnected && !p.isSpectator)
    .map(p => p.id)
}

/**
 * Проверить должен ли закончиться раунд
 */
function shouldRoundEnd(state: GameState): boolean {
  const threshold = 10 + (state.currentRound * 10)  // 20, 30, 40
  return state.players.some(p => p.score >= threshold)
}

/**
 * Завершить раунд
 */
function endRound(state: GameState): GameState {
  const threshold = 10 + (state.currentRound * 10)
  const maxScore = Math.max(...state.players.map(p => p.score))
  const winners = state.players.filter(p => p.score === maxScore).map(p => p.id)

  // Проверяем победу в матче (2 раунда)
  const roundWins = Object.values(state.roundWinners || {})
  const matchWinner = checkMatchWinner(roundWins, winners)

  const newRoundWinners = {
    ...(state.roundWinners || {}),
    [state.currentRound]: winners
  }

  const newState = {
    ...state,
    roundWinners: newRoundWinners,
    isRoundEndModalOpen: true
  }

  if (matchWinner) {
    newState.gameWinner = matchWinner
  }

  return newState
}

/**
 * Проверить победителя матча (2 раунда из 3)
 */
function checkMatchWinner(existingWins: Record<number, number[]>, newWinners: number[]): number | null {
  const allWins = { ...existingWins }

  // Добавляем текущие победители
  Object.values(allWins).flat().forEach(id => {
    // уже учтены
  })

  // Считаем победы для каждого раунда
  const winCounts: Record<number, number> = {}
  Object.values(allWins).flat().forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })
  newWinners.forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })

  // Проверяем кто выиграл 2 раунда
  for (const [id, count] of Object.entries(winCounts)) {
    if (count >= 2) return parseInt(id)
  }

  return null
}
