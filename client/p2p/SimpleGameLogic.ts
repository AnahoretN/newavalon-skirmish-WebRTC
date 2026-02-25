/**
 * Simple Game Logic
 *
 * Вся логика игры в одном месте.
 * Функция applyAction принимает текущее состояние и действие,
 * возвращает новое состояние.
 */

import type { GameState, Card, Player, DeckType, ScoringLineData } from '../types'
import type { ActionType } from './SimpleP2PTypes'
import { getCardDefinition } from '../content'
import { shuffleDeck } from '../../shared/utils/array'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'
import { initializeReadyStatuses, recalculateAllReadyStatuses } from '../utils/autoAbilities'
import { createDeck } from '../hooks/core/gameCreators'

/**
 * Проверить является ли карта токеном
 */
function isToken(card: Card): boolean {
  return card.deck === 'counter'
}

/**
 * Очистить все статусы карты кроме Revealed
 * Вызывается при перемещении карты с поля боя
 */
function clearAllStatusesExceptRevealed(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
    return
  }
  // Сохраняем только статусы Revealed, удаляем все остальные
  card.statuses = card.statuses.filter(s => s.type === 'Revealed')
}

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

    case 'PLAY_CARD_FROM_DECK':
      newState = handlePlayCardFromDeck(newState, playerId, data)
      break

    case 'PLAY_CARD_FROM_DISCARD':
      newState = handlePlayCardFromDiscard(newState, playerId, data)
      break

    case 'MOVE_CARD_ON_BOARD':
      newState = handleMoveCardOnBoard(newState, playerId, data)
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

    // Перемещение между зонами
    case 'MOVE_CARD_TO_HAND':
      newState = handleMoveCardToHand(newState, playerId, data)
      break

    case 'MOVE_CARD_TO_DECK':
      newState = handleMoveCardToDeck(newState, playerId, data)
      break

    case 'MOVE_CARD_TO_DISCARD':
      newState = handleMoveCardToDiscard(newState, playerId, data)
      break

    case 'MOVE_HAND_CARD_TO_DECK':
      newState = handleMoveHandCardToDeck(newState, playerId, data)
      break

    case 'MOVE_HAND_CARD_TO_DISCARD':
      newState = handleMoveHandCardToDiscard(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_HAND':
      newState = handleMoveAnnouncedToHand(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_DECK':
      newState = handleMoveAnnouncedToDeck(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_DISCARD':
      newState = handleMoveAnnouncedToDiscard(newState, playerId, data)
      break

    case 'PLAY_ANNOUNCED_TO_BOARD':
      newState = handlePlayAnnouncedToBoard(newState, playerId, data)
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

    case 'RESET_GAME':
      newState = handleResetGame(newState)
      break

    case 'MARK_ABILITY_USED':
      newState = handleMarkAbilityUsed(newState, data)
      break

    case 'REMOVE_STATUS_BY_TYPE':
      newState = handleRemoveStatusByType(newState, data)
      break

    case 'ADD_STATUS_TO_BOARD_CARD':
      newState = handleAddStatusToBoardCard(newState, playerId, data)
      break

    case 'PLAY_TOKEN_CARD':
      newState = handlePlayTokenCard(newState, playerId, data)
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
  if (player?.isDummy) {return true}

  // Все остальные действия могут выполнять любые игроки
  // (карты можно перемещать в любой ход, фазы может переключать любой игрок)
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
    const newState = { ...state, currentPhase: 1 }
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Setup (1) → Main (2) - происходит при игре карты
  if (phase === 1) {
    const newState = { ...state, currentPhase: 2 }
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Main (2) → Commit (3)
  if (phase === 2) {
    const newState = { ...state, currentPhase: 3 }
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Commit (3) → Scoring (4) или PassTurn
  if (phase === 3) {
    // Проверяем есть ли у игрока карты со статусом "LastPlayed" на доске
    // Статус LastPlayed добавляется когда карта сыграна из руки
    const hasLastPlayedCards = state.board.some(row =>
      row.some(cell =>
        cell.card?.ownerId === playerId &&
        cell.card?.statuses?.some(s => s.type === 'LastPlayed' && s.addedByPlayerId === playerId)
      )
    )

    if (hasLastPlayedCards) {
      // Есть карты со статусом LastPlayed - переходим к Scoring и вычисляем линии
      return enterScoringPhase(state, playerId)
    } else {
      // Нет карт со статусом LastPlayed - передаём ход следующему игроку
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
 * Войти в фазу Scoring - вычислить линии для подсветки
 */
function enterScoringPhase(state: GameState, playerId: number): GameState {
  // Находим линии, содержащие карты игрока
  const lines = findScoringLinesWithPlayerCard(state, playerId)

  // Вычисляем очки для каждой линии
  const scoringLines: ScoringLineData[] = lines.map(line => ({
    playerId,
    lineType: line.type as any,
    lineIndex: line.index,
    score: calculateLineScore(state, playerId, line.type, line.index)
  }))

  console.log('[enterScoringPhase] Player', playerId, 'scoring lines:', scoringLines)

  return {
    ...state,
    currentPhase: 4,
    isScoringStep: true,
    scoringLines
  }
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
  if (activePlayerIds.length === 0) {return state}

  const currentIndex = activePlayerIds.indexOf(state.activePlayerId || 1)
  const nextIndex = (currentIndex + 1) % activePlayerIds.length
  const nextPlayerId = activePlayerIds[nextIndex]

  console.log('[handlePassTurn] Turn passed from', playerId, 'to', nextPlayerId, 'reason:', reason)

  // Сбрасываем enteredThisTurn у всех карт на доске при передаче хода
  // Также очищаем setupUsedThisTurn и commitUsedThisTurn (но не deployUsedThisTurn!)
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card) {
        const newStatuses = cell.card.statuses?.filter((s: any) => {
          // Сохраняем все статусы кроме setupUsedThisTurn и commitUsedThisTurn
          if (s.type === 'setupUsedThisTurn') return false
          if (s.type === 'commitUsedThisTurn') return false
          return true
        }) || []

        return {
          card: {
            ...cell.card,
            enteredThisTurn: false,
            statuses: newStatuses
          }
        }
      }
      return cell
    })
  )

  // Очищаем lastPlayedCardId у всех игроков при передаче хода
  const newPlayers = state.players.map(p => ({
    ...p,
    lastPlayedCardId: null
  }))

  let newState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    activePlayerId: nextPlayerId,
    currentPhase: 0,  // Preparation
    scoringLines: []  // Очищаем линии скоринга при передаче хода
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
  let newState = { ...state, currentPhase: clamped }

  // When entering Preparation phase (0), clear setup/commit usage markers
  // This allows abilities to be used again in the new turn
  if (clamped === 0) {
    newState.board = newState.board.map(row =>
      row.map(cell => {
        if (cell.card) {
          const newStatuses = cell.card.statuses?.filter((s: any) => {
            // Remove only setupUsedThisTurn and commitUsedThisTurn
            // Keep deployUsedThisTurn (only clears when card leaves battlefield)
            if (s.type === 'setupUsedThisTurn') return false
            if (s.type === 'commitUsedThisTurn') return false
            return true
          }) || []

          return {
            ...cell,
            card: { ...cell.card, statuses: newStatuses }
          }
        }
        return cell
      })
    )
  }

  recalculateAllReadyStatuses(newState)
  return newState
}

/**
 * Preparation phase - auto-draw и проверка окончания раунда
 */
function executePreparationPhase(state: GameState, activePlayerId: number): GameState {
  let newState = { ...state }
  const player = newState.players.find(p => p.id === activePlayerId)

  if (!player) {return state}

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

  // Recalculate ready statuses for new active player in Setup phase
  recalculateAllReadyStatuses(newState)

  return newState
}

// ============================================================================
// Карточные действия
// ============================================================================

/**
 * PLAY_CARD - сыграть карту из руки на доску
 * Also supports direct card parameter for playing from deck/discard
 */
function handlePlayCard(state: GameState, playerId: number, data: any): GameState {
  const { card, cardIndex, boardCoords, faceDown = false } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || !boardCoords) {return state}

  let cardToPlay: Card | null = null
  let newHand = player.hand
  let newHandSize = player.hand.length

  // If card is passed directly (from deck/discard), use it
  if (card) {
    cardToPlay = card
    // Hand remains unchanged when playing from deck/discard
  } else {
    // Otherwise, get card from hand
    const cardIndexNum = cardIndex ?? player.hand.length - 1
    cardToPlay = player.hand[cardIndexNum]

    if (!cardToPlay) {return state}

    // Убираем карту из руки
    newHand = [...player.hand]
    newHand.splice(cardIndexNum, 1)
    newHandSize = newHand.length
  }

  if (!cardToPlay) {return state}

  // Сначала убираем LastPlayed статус со ВСЕХ карт игрока на доске
  // (только одна карта может иметь LastPlayed статус одновременно)
  const boardWithoutLastPlayed = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (cell.card?.ownerId === playerId && cell.card?.statuses) {
        const filteredStatuses = cell.card.statuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === playerId))
        if (filteredStatuses.length !== cell.card.statuses.length) {
          return {
            card: {
              ...cell.card,
              statuses: filteredStatuses
            }
          }
        }
      }
      return cell
    })
  )

  // Теперь добавляем карту на доску с LastPlayed статусом
  const newBoard = boardWithoutLastPlayed.map((row, r) =>
    row.map((cell, c) => {
      if (r === boardCoords.row && c === boardCoords.col) {
        // Add LastPlayed status to the card when played from hand
        // This status is used to determine if player can enter scoring phase
        const lastPlayedStatus = { type: 'LastPlayed', addedByPlayerId: playerId }
        const existingStatuses = cardToPlay.statuses || []
        // Remove any existing LastPlayed status from this card (to avoid duplicates)
        const filteredStatuses = existingStatuses.filter((s: any) => !(s.type === 'LastPlayed' && s.addedByPlayerId === playerId))

        const boardCard = {
          ...cardToPlay,
          ownerId: playerId,
          isFaceDown: faceDown,
          enteredThisTurn: true,
          statuses: [...filteredStatuses, lastPlayedStatus]
        }

        // Initialize ready statuses for this card (readyDeploy, readySetup, readyCommit)
        initializeReadyStatuses(boardCard, playerId, state.currentPhase)

        return {
          card: boardCard
        }
      }
      return cell
    })
  )

  // Добавляем в boardHistory
  const newBoardHistory = [...player.boardHistory, cardToPlay.id]

  // Обновляем игрока - устанавливаем lastPlayedCardId
  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? {
          ...p,
          hand: newHand,
          handSize: newHandSize,
          boardHistory: newBoardHistory,
          lastPlayedCardId: cardToPlay.id
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
 * MOVE_CARD_ON_BOARD - переместить карту с одной клетки на другую
 */
function handleMoveCardOnBoard(state: GameState, playerId: number, data: any): GameState {
  const { cardId, fromCoords, toCoords, faceDown } = data || {}

  if (!fromCoords || !toCoords) {return state}

  const fromRow = fromCoords.row
  const fromCol = fromCoords.col
  const toRow = toCoords.row
  const toCol = toCoords.col

  // Проверяем границы
  const gridSize = state.activeGridSize
  if (fromRow < 0 || fromRow >= gridSize || fromCol < 0 || fromCol >= gridSize) {return state}
  if (toRow < 0 || toRow >= gridSize || toCol < 0 || toCol >= gridSize) {return state}

  // Проверяем что исходная клетка содержит карту
  const sourceCard = state.board[fromRow]?.[fromCol]?.card
  if (!sourceCard) {return state}

  // Проверяем что целевая клетка пуста
  const targetCell = state.board[toRow]?.[toCol]
  if (!targetCell || targetCell.card) {return state}

  // Перемещаем карту
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      // Очищаем исходную клетку
      if (r === fromRow && c === fromCol) {
        return { card: null }
      }
      // Размещаем карту в новой клетке
      if (r === toRow && c === toCol) {
        const movedCard = {
          ...sourceCard,
          isFaceDown: faceDown !== undefined ? faceDown : sourceCard.isFaceDown
        }
        return { card: movedCard }
      }
      return cell
    })
  )

  console.log('[handleMoveCardOnBoard] Moved card from', fromCoords, 'to', toCoords)

  return { ...state, board: newBoard }
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
  if (!cardId) {return state}

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

  if (!cardToReturn || !sourceCoords) {return state}

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
 * MOVE_CARD_TO_HAND - переместить карту с доски/сброса в руку
 */
function handleMoveCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  let targetPlayerId = playerId
  let newBoard = state.board
  let newDiscard: Card[] | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, r) =>
      row.map((cell, c) => {
        if (cell.card?.id === cardId) {
          cardToMove = cell.card
          targetPlayerId = cardToMove.ownerId || playerId
          // Clear all statuses except Revealed when card leaves battlefield
          clearAllStatusesExceptRevealed(cardToMove!)
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'discard') {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {return state}
    const cardIndex = player.discard?.findIndex(c => c.id === cardId)
    if (cardIndex === undefined || cardIndex === -1) {return state}
    cardToMove = player.discard[cardIndex]
    targetPlayerId = playerId
    newDiscard = [...player.discard]
    newDiscard.splice(cardIndex, 1)
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to hand
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    return { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === playerId && newDiscard !== null) {
        return { ...p, discard: newDiscard, discardSize: newDiscard.length }
      }
      return p
    })}
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const newHand = [...p.hand, cardToMove]
      return { ...p, hand: newHand, handSize: newHand.length }
    }
    if (p.id === playerId && newDiscard !== null) {
      return { ...p, discard: newDiscard, discardSize: newDiscard.length }
    }
    return p
  })

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * MOVE_CARD_TO_DECK - переместить карту с доски/руки/сброса в колоду
 */
function handleMoveCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  let targetPlayerId = playerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDiscard: Card[] | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, r) =>
      row.map((cell, c) => {
        if (cell.card?.id === cardId) {
          cardToMove = cell.card
          targetPlayerId = cardToMove.ownerId || playerId
          // Clear all statuses except Revealed when card leaves battlefield
          clearAllStatusesExceptRevealed(cardToMove!)
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {return state}
    const cardIndex = player.hand?.findIndex(c => c.id === cardId)
    if (cardIndex === undefined || cardIndex === -1) {return state}
    cardToMove = player.hand[cardIndex]
    targetPlayerId = playerId
    newHand = [...player.hand]
    newHand.splice(cardIndex, 1)
  } else if (source === 'discard') {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {return state}
    const cardIndex = player.discard?.findIndex(c => c.id === cardId)
    if (cardIndex === undefined || cardIndex === -1) {return state}
    cardToMove = player.discard[cardIndex]
    targetPlayerId = playerId
    newDiscard = [...player.discard]
    newDiscard.splice(cardIndex, 1)
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    return { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === playerId) {
        const updates: any = {}
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDiscard !== null) {
          updates.discard = newDiscard
          updates.discardSize = newDiscard.length
        }
        return { ...p, ...updates }
      }
      return p
    })}
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const newDeck = [cardToMove, ...(p.deck || [])]
      return { ...p, deck: newDeck, deckSize: newDeck.length }
    }
    if (p.id === playerId) {
      const updates: any = {}
      if (newHand !== null) {
        updates.hand = newHand
        updates.handSize = newHand.length
      }
      if (newDiscard !== null) {
        updates.discard = newDiscard
        updates.discardSize = newDiscard.length
      }
      return { ...p, ...updates }
    }
    return p
  })

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * MOVE_CARD_TO_DISCARD - переместить карту с доски/руки/колоды в сброс
 */
function handleMoveCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  let targetPlayerId = playerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDeck: Card[] | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, r) =>
      row.map((cell, c) => {
        if (cell.card?.id === cardId) {
          cardToMove = cell.card
          targetPlayerId = cardToMove.ownerId || playerId
          // Clear all statuses except Revealed when card leaves battlefield
          clearAllStatusesExceptRevealed(cardToMove!)
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {return state}
    const cardIndex = player.hand?.findIndex(c => c.id === cardId)
    if (cardIndex === undefined || cardIndex === -1) {return state}
    cardToMove = player.hand[cardIndex]
    targetPlayerId = playerId
    newHand = [...player.hand]
    newHand.splice(cardIndex, 1)
  } else if (source === 'deck') {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {return state}
    const cardIndex = player.deck?.findIndex(c => c.id === cardId)
    if (cardIndex === undefined || cardIndex === -1) {return state}
    cardToMove = player.deck[cardIndex]
    targetPlayerId = playerId
    newDeck = [...player.deck]
    newDeck.splice(cardIndex, 1)
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    return { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === playerId) {
        const updates: any = {}
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDeck !== null) {
          updates.deck = newDeck
          updates.deckSize = newDeck.length
        }
        return { ...p, ...updates }
      }
      return p
    })}
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const newDiscard = [...(p.discard || []), cardToMove]
      return { ...p, discard: newDiscard, discardSize: newDiscard.length }
    }
    if (p.id === playerId) {
      const updates: any = {}
      if (newHand !== null) {
        updates.hand = newHand
        updates.handSize = newHand.length
      }
      if (newDeck !== null) {
        updates.deck = newDeck
        updates.deckSize = newDeck.length
      }
      return { ...p, ...updates }
    }
    return p
  })

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * MOVE_HAND_CARD_TO_DECK - переместить карту из руки в колоду
 */
function handleMoveHandCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)
  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, hand: newHand, handSize: newHand.length, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_HAND_CARD_TO_DISCARD - переместить карту из руки в сброс
 */
function handleMoveHandCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)
  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, hand: newHand, handSize: newHand.length, discard: newDiscard, discardSize: newDiscard.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_HAND - переместить карту из витрины в руку
 */
function handleMoveAnnouncedToHand(state: GameState, playerId: number, data: any): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard
  const newHand = [...player.hand, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, hand: newHand, handSize: newHand.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DECK - переместить карту из витрины в колоду
 */
function handleMoveAnnouncedToDeck(state: GameState, playerId: number, data: any): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard
  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, deck: newDeck, deckSize: newDeck.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DISCARD - переместить карту из витрины в сброс
 */
function handleMoveAnnouncedToDiscard(state: GameState, playerId: number, data: any): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard
  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, discard: newDiscard, discardSize: newDiscard.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * PLAY_ANNOUNCED_TO_BOARD - сыграть карту из витрины на поле боя
 */
function handlePlayAnnouncedToBoard(state: GameState, playerId: number, data: any): GameState {
  const { row, col, faceDown = false } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || !player.announcedCard) {return state}
  if (row === undefined || col === undefined) {return state}
  if (row < 0 || row >= state.activeGridSize || col < 0 || col >= state.activeGridSize) {return state}

  // Проверяем, что клетка пуста
  if (state.board[row]?.[col]?.card) {return state}

  const cardToPlay = { ...player.announcedCard, isFaceDown: faceDown }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        // Initialize ready statuses for this card
        initializeReadyStatuses(cardToPlay, playerId, state.currentPhase)
        return { card: cardToPlay }
      }
      return cell
    })
  )

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, announcedCard: null }
      : p
  )

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * ANNOUNCE_CARD - объявить карту
 */
function handleAnnounceCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || cardIndex === undefined) {return state}

  const card = player.hand[cardIndex]
  if (!card) {return state}

  // Сначала убираем LastPlayed статус со ВСЕХ карт игрока на доске
  // (только одна карта может иметь LastPlayed статус одновременно)
  const boardWithoutLastPlayed = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (cell.card?.ownerId === playerId && cell.card?.statuses) {
        const filteredStatuses = cell.card.statuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === playerId))
        if (filteredStatuses.length !== cell.card.statuses.length) {
          return {
            card: {
              ...cell.card,
              statuses: filteredStatuses
            }
          }
        }
      }
      return cell
    })
  )

  // Add LastPlayed status to the announced card (it was played from hand)
  const lastPlayedStatus = { type: 'LastPlayed', addedByPlayerId: playerId }
  const existingStatuses = card.statuses || []
  // Remove any existing LastPlayed status from this card (to avoid duplicates)
  const filteredStatuses = existingStatuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === playerId))
  const announcedCardWithStatus = {
    ...card,
    statuses: [...filteredStatuses, lastPlayedStatus]
  }

  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      const newHand = [...p.hand]
      newHand.splice(cardIndex, 1)
      return {
        ...p,
        hand: newHand,
        handSize: newHand.length,
        announcedCard: announcedCardWithStatus,
        // Update boardHistory and lastPlayedCardId for scoring phase
        boardHistory: [...player.boardHistory, card.id],
        lastPlayedCardId: card.id
      }
    }
    return p
  })

  return { ...state, board: boardWithoutLastPlayed, players: newPlayers }
}

/**
 * DESTROY_CARD - уничтожить карту
 */
function handleDestroyCard(state: GameState, playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) {return state}

  let destroyedCard: Card | null = null
  let ownerId: number | null = null
  let destroyedCoords: { row: number; col: number } | null = null

  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (cell.card?.id === cardId) {
        destroyedCard = cell.card
        ownerId = cell.card.ownerId || null
        destroyedCoords = { row: r, col: c }
        return { card: null }
      }
      return cell
    })
  )

  if (!destroyedCard || !ownerId) {return state}

  // Clear all statuses except Revealed when card is destroyed and goes to discard
  // This allows deploy ability to be used again when card returns to battlefield
  clearAllStatusesExceptRevealed(destroyedCard)

  // Проверяем, была ли это последняя сыгранная карта владельца
  const owner = state.players.find(p => p.id === ownerId)
  let updatedBoard = newBoard
  let newLastPlayedCardId: string | null = null

  if (owner && owner.lastPlayedCardId === cardId) {
    // Эта карта была последней сыгранной - нужно восстановить статус предыдущей
    // Ищем предыдущую карту в boardHistory (кроме уничтоженной)
    const historyWithoutDestroyed = owner.boardHistory.filter(id => id !== cardId)

    if (historyWithoutDestroyed.length > 0) {
      const prevCardId = historyWithoutDestroyed[historyWithoutDestroyed.length - 1]
      newLastPlayedCardId = prevCardId

      // Находим эту карту на доске и восстанавливаем LastPlayed статус
      updatedBoard = newBoard.map(row =>
        row.map(cell => {
          if (cell.card?.id === prevCardId) {
            // Add LastPlayed status to the previous card
            const lastPlayedStatus = { type: 'LastPlayed', addedByPlayerId: ownerId }
            const existingStatuses = cell.card.statuses || []
            // Remove any existing LastPlayed status from this player
            const filteredStatuses = existingStatuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === ownerId))

            return {
              card: {
                ...cell.card,
                enteredThisTurn: true,
                statuses: [...filteredStatuses, lastPlayedStatus]
              }
            }
          }
          return cell
        })
      )

      console.log('[handleDestroyCard] Restored LastPlayed status for previous card:', prevCardId)
    }
  }

  // Добавляем в discard владельцу
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      // Обновляем boardHistory (убираем уничтоженную карту)
      const newBoardHistory = p.boardHistory.filter(id => id !== cardId)
      return {
        ...p,
        discard: [...p.discard, destroyedCard],
        discardSize: p.discard.length + 1,
        boardHistory: newBoardHistory,
        lastPlayedCardId: p.id === ownerId ? newLastPlayedCardId : p.lastPlayedCardId
      }
    }
    return p
  })

  return {
    ...state,
    board: updatedBoard,
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
  if (!player || !player.deck || player.deck.length === 0) {return state}

  const newDeck = [...player.deck]
  const card = newDeck.shift()

  if (!card) {return state}

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
  if (!player) {return state}

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
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return state}

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
  if (state.currentPhase !== 3) {return state}

  // Используем enterScoringPhase для правильного расчёта линий
  return enterScoringPhase(state, playerId)
}

/**
 * SELECT_SCORING_LINE - выбрать линию для скоринга
 */
function handleSelectScoringLine(state: GameState, playerId: number, data: any): GameState {
  if (!state.isScoringStep || state.activePlayerId !== playerId) {return state}

  const { lineType, lineIndex } = data || {}
  if (!lineType) {return state}

  // Вычисляем очки на основе карт в линии
  const points = calculateLineScore(state, playerId, lineType, lineIndex)

  console.log('[handleSelectScoringLine] Player', playerId, 'selected', lineType, lineIndex, 'score:', points)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, score: p.score + points }
      : p
  )

  // Передаём ход
  const newState = {
    ...state,
    players: newPlayers,
    isScoringStep: false,
    scoringLines: []  // Очищаем линии скоринга
  }

  return handlePassTurn(newState, playerId, 'scoring_complete')
}

/**
 * Вычислить очки для линии
 * lineType: 'row' | 'col' | 'diagonal' | 'anti-diagonal'
 * lineIndex: номер строки/колонки (0-based), или undefined для диагоналей
 */
function calculateLineScore(state: GameState, playerId: number, lineType: string, lineIndex?: number): number {
  const gridSize = state.activeGridSize
  const cellsToCheck: { row: number; col: number }[] = []

  if (lineType === 'row' && lineIndex !== undefined) {
    // Горизонтальная линия
    for (let c = 0; c < gridSize; c++) {
      cellsToCheck.push({ row: lineIndex, col: c })
    }
  } else if (lineType === 'col' && lineIndex !== undefined) {
    // Вертикальная линия
    for (let r = 0; r < gridSize; r++) {
      cellsToCheck.push({ row: r, col: lineIndex })
    }
  } else if (lineType === 'diagonal') {
    // Главная диагональ (top-left to bottom-right)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: i })
    }
  } else if (lineType === 'anti-diagonal') {
    // Побочная диагональ (top-right to bottom-left)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: gridSize - 1 - i })
    }
  }

  // Считаем сумму сил всех карт игрока в этой линии
  let score = 0
  for (const { row, col } of cellsToCheck) {
    const cell = state.board[row]?.[col]
    if (cell.card?.ownerId === playerId) {
      const power = cell.card.power || 0
      const powerModifier = cell.card.powerModifier || 0
      score += power + powerModifier
    }
  }

  return score
}

/**
 * Найти все линии, содержащие карту игрока
 * Возвращает массив линий, которые можно подсветить для скоринга
 */
export function findScoringLinesWithPlayerCard(
  state: GameState,
  playerId: number
): Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return []}

  // Ищем координаты последней сыгранной карты
  let lastPlayedCoords: { row: number; col: number } | null = null

  if (player.lastPlayedCardId) {
    // Ищем по lastPlayedCardId
    for (let r = 0; r < state.activeGridSize; r++) {
      for (let c = 0; c < state.activeGridSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.id === player.lastPlayedCardId) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // Если не нашли последнюю сыгранную, ищем любую карту с enteredThisTurn
  if (!lastPlayedCoords) {
    for (let r = 0; r < state.activeGridSize; r++) {
      for (let c = 0; c < state.activeGridSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.ownerId === playerId && cell.card.enteredThisTurn) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // Если не нашли ни одной карты - нет линий для скоринга
  if (!lastPlayedCoords) {return []}

  const { row, col } = lastPlayedCoords
  const lines: Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> = []

  // Горизонтальная линия (row)
  const rowCells: { row: number; col: number }[] = []
  for (let c = 0; c < state.activeGridSize; c++) {
    rowCells.push({ row, col: c })
  }
  lines.push({ type: 'row', index: row, cells: rowCells })

  // Вертикальная линия (col)
  const colCells: { row: number; col: number }[] = []
  for (let r = 0; r < state.activeGridSize; r++) {
    colCells.push({ row: r, col })
  }
  lines.push({ type: 'col', index: col, cells: colCells })

  // Диагональные линии пока не используются в фазе скоринга
  // (могут использоваться в способностях карт)

  return lines
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
 * RESET_GAME - сбросить игру в начальное состояние (лобби)
 * Сохраняет игроков и их выбор колод, но сбрасывает всё остальное
 */
function handleResetGame(state: GameState): GameState {
  console.log('[handleResetGame] Resetting game to lobby state')

  // Сохраняем данные игроков для восстановления
  const playersToKeep = state.players.map(p => {
    const deckType = p.selectedDeck || 'SynchroTech'
    return {
      ...p,
      // Сбрасываем игровые данные
      hand: [],
      deck: createDeck(deckType, p.id, p.name),
      discard: [],
      discardSize: 0,
      handSize: 0,
      deckSize: createDeck(deckType, p.id, p.name).length,
      score: 0,
      isReady: false,  // Сбрасываем готовность
      announcedCard: null,
      boardHistory: [],
      lastPlayedCardId: null,
      // Сохраняем настройки
      autoDrawEnabled: p.autoDrawEnabled !== false,
    }
  })

  // Создаём пустую доску с сохранённым размером
  const gridSize = state.activeGridSize || 8
  const newBoard: Array<Array<{ card: Card | null }>> = []
  for (let i = 0; i < gridSize; i++) {
    const row: Array<{ card: Card | null }> = []
    for (let j = 0; j < gridSize; j++) {
      row.push({ card: null })
    }
    newBoard.push(row)
  }

  return {
    ...state,
    // Сброс игровых флагов
    isGameStarted: false,
    isReadyCheckActive: false,
    currentPhase: 0,
    currentRound: 1,
    turnNumber: 1,
    activePlayerId: null,
    startingPlayerId: null,
    // Сброс раунда и матча
    roundWinners: {},
    gameWinner: null,
    roundEndTriggered: false,
    isRoundEndModalOpen: false,
    scoringLines: [],
    isScoringStep: false,
    // Очистка визуальных эффектов
    floatingTexts: [],
    highlights: [],
    deckSelections: [],
    handCardSelections: [],
    targetingMode: null,
    clickWaves: [],
    visualEffects: new Map(),
    // Новая доска и игроки
    board: newBoard,
    players: playersToKeep,
  }
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
    if (p.isDummy || p.isSpectator || p.isDisconnected) {return p}

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
    if (count >= 2) {return parseInt(id)}
  }

  return null
}

/**
 * MARK_ABILITY_USED - пометить способность как использованную
 * Удаляет готовый статус и добавляет маркер использования
 */
function handleMarkAbilityUsed(state: GameState, data: any): GameState {
  const { coords, isDeploy, readyStatusToRemove } = data || {}
  if (!coords) return state

  const { row, col } = coords
  if (row === undefined || col === undefined) return state

  console.log('[handleMarkAbilityUsed] coords:', coords, 'isDeploy:', isDeploy, 'readyStatusToRemove:', readyStatusToRemove)

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newCard = { ...cell.card }
        if (!newCard.statuses) newCard.statuses = []

        // Remove the ready status
        if (readyStatusToRemove) {
          newCard.statuses = newCard.statuses.filter(s => s.type !== readyStatusToRemove)
        }

        // Mark ability as used based on type
        if (isDeploy) {
          // Deploy: mark as used (persists until card leaves battlefield)
          const deployUsedStatus = 'deployUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === deployUsedStatus)) {
            newCard.statuses.push({ type: deployUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added deployUsedThisTurn to card:', newCard.baseId)
          }
        } else if (readyStatusToRemove === 'readySetup') {
          // Setup: mark as used this turn
          const setupUsedStatus = 'setupUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === setupUsedStatus)) {
            newCard.statuses.push({ type: setupUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added setupUsedThisTurn to card:', newCard.baseId)
          }
        } else if (readyStatusToRemove === 'readyCommit') {
          // Commit: mark as used this turn
          const commitUsedStatus = 'commitUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === commitUsedStatus)) {
            newCard.statuses.push({ type: commitUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added commitUsedThisTurn to card:', newCard.baseId)
          }
        }

        return { ...cell, card: newCard }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * REMOVE_STATUS_BY_TYPE - удалить статус определённого типа с карты
 */
function handleRemoveStatusByType(state: GameState, data: any): GameState {
  const { coords, type } = data || {}
  if (!coords || !type) return state

  const { row, col } = coords
  if (row === undefined || col === undefined) return state

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newStatuses = cell.card.statuses?.filter(s => s.type !== type) || []
        const newCard = { ...cell.card, statuses: newStatuses }
        return { ...cell, card: newCard }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_CARD_FROM_DECK - сыграть верхнюю карту колоды на поле боя
 */
function handlePlayCardFromDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown } = data || {}
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.deck || player.deck.length === 0) return state

  // Get the card to play (top card from deck by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : 0
  const cardToPlay = player.deck[indexToPlay]
  if (!cardToPlay) return state

  // Remove card from deck
  const newDeck = [...player.deck]
  newDeck.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    deck: newDeck,
    deckSize: newDeck.length
  }

  const newPlayers = state.players.map(p => p.id === playerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, playerId, { card: cardToPlay, boardCoords, faceDown })
}

/**
 * PLAY_CARD_FROM_DISCARD - сыграть карту из сброса на поле боя
 */
function handlePlayCardFromDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown } = data || {}
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.discard || player.discard.length === 0) return state

  // Get the card to play (top card from discard by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : player.discard.length - 1
  const cardToPlay = player.discard[indexToPlay]
  if (!cardToPlay) return state

  // Remove card from discard
  const newDiscard = [...player.discard]
  newDiscard.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    discard: newDiscard,
    discardSize: newDiscard.length
  }

  const newPlayers = state.players.map(p => p.id === playerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, playerId, { card: cardToPlay, boardCoords, faceDown })
}

/**
 * ADD_STATUS_TO_BOARD_CARD - добавить статус (жетон) на карту на поле боя
 */
function handleAddStatusToBoardCard(state: GameState, playerId: number, data: any): GameState {
  const { boardCoords, statusType, ownerId, replaceStatusType } = data || {}
  if (!boardCoords || !statusType || ownerId === undefined) {
    return state
  }

  const { row, col } = boardCoords
  if (row === undefined || col === undefined) {
    return state
  }

  // Validate bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[row]?.length) {
    return state
  }

  const cell = state.board[row][col]
  if (!cell || !cell.card) {
    return state
  }

  // Create new card with added status
  const targetCard = cell.card
  const existingStatuses = targetCard.statuses || []

  // If replaceStatusType is specified, remove that status type first
  let filteredStatuses = existingStatuses
  if (replaceStatusType) {
    filteredStatuses = existingStatuses.filter(s => s.type !== replaceStatusType)
  }

  // Check if status already exists (avoid duplicates)
  const alreadyHasStatus = filteredStatuses.some(s => s.type === statusType && s.addedByPlayerId === ownerId)
  if (alreadyHasStatus) {
    return state
  }

  // Add the new status
  const newStatuses = [...filteredStatuses, { type: statusType, addedByPlayerId: ownerId }]

  const newCard = {
    ...targetCard,
    statuses: newStatuses
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: newCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_TOKEN_CARD - разместить карту-токен на поле боя
 * Токен НЕ удаляется из панели (может использоваться многократно)
 * Владелец = игрок который разместил (или dummy если активен)
 */
function handlePlayTokenCard(state: GameState, playerId: number, data: any): GameState {
  const { card, boardCoords, ownerId } = data || {}
  if (!card || !boardCoords) {
    return state
  }

  const { row, col } = boardCoords
  if (row === undefined || col === undefined) {
    return state
  }

  // Validate bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[row]?.length) {
    return state
  }

  const cell = state.board[row][col]
  // Can only place token on empty cells
  if (cell.card) {
    return state
  }

  // Create token card with proper owner
  const tokenCard: Card = {
    ...card,
    id: `token_${Date.now()}_${row}_${col}_${Math.random().toString(36).substr(2, 9)}`,
    ownerId: ownerId ?? playerId,
    enteredThisTurn: true,
    statuses: []
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: tokenCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}
