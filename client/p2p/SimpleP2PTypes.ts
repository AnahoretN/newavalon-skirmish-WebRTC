/**
 * Simple P2P Types
 *
 * Упрощённая система P2P с 2 типами сообщений:
 * 1. ACTION - от клиента к хосту (запрос на изменение)
 * 2. STATE - от хоста всем клиентам (полное состояние)
 */

import type { GameState, ScoringLineData } from '../types'

/**
 * Действие которое может выполнить игрок
 */
export type ActionType =
  // Фазовые действия
  | 'NEXT_PHASE'
  | 'PREVIOUS_PHASE'
  | 'PASS_TURN'
  | 'SET_PHASE'

  // Карточные действия
  | 'PLAY_CARD'
  | 'PLAY_CARD_FROM_DECK'
  | 'PLAY_CARD_FROM_DISCARD'
  | 'MOVE_CARD'
  | 'MOVE_CARD_ON_BOARD'
  | 'RETURN_CARD_TO_HAND'
  | 'ANNOUNCE_CARD'
  | 'DESTROY_CARD'

  // Перемещение между зонами
  | 'MOVE_CARD_TO_HAND'
  | 'MOVE_CARD_TO_DECK'
  | 'MOVE_CARD_TO_DISCARD'
  | 'MOVE_CARD_TO_BOARD'
  | 'MOVE_HAND_CARD_TO_DECK'
  | 'MOVE_HAND_CARD_TO_DISCARD'

  // Перемещение из витрины (showcase)
  | 'MOVE_ANNOUNCED_TO_HAND'
  | 'MOVE_ANNOUNCED_TO_DECK'
  | 'MOVE_ANNOUNCED_TO_DISCARD'
  | 'PLAY_ANNOUNCED_TO_BOARD'

  // Управление колодой
  | 'DRAW_CARD'
  | 'SHUFFLE_DECK'

  // Счёт и статус
  | 'UPDATE_SCORE'
  | 'CHANGE_PLAYER_NAME'
  | 'CHANGE_PLAYER_COLOR'
  | 'CHANGE_PLAYER_DECK'

  // Скоринг
  | 'START_SCORING'
  | 'SELECT_SCORING_LINE'

  // Раунд и матч
  | 'COMPLETE_ROUND'
  | 'START_NEXT_ROUND'
  | 'START_NEW_MATCH'

  // Ready check
  | 'PLAYER_READY'

  // Game reset
  | 'RESET_GAME'

  // Игровые настройки
  | 'SET_GAME_MODE'
  | 'SET_GRID_SIZE'
  | 'SET_PRIVACY'
  | 'ASSIGN_TEAMS'

  // Ability tracking
  | 'MARK_ABILITY_USED'
  | 'REMOVE_STATUS_BY_TYPE'

  // Status effects
  | 'ADD_STATUS_TO_BOARD_CARD'

  // Token cards
  | 'PLAY_TOKEN_CARD'

/**
 * Сообщение от клиента к хосту - запрос на действие
 */
export interface ActionMessage {
  type: 'ACTION'
  playerId: number
  action: ActionType
  data?: any
  timestamp: number
}

/**
 * Сообщение от хоста всем клиентам - полное состояние
 */
export interface StateMessage {
  type: 'STATE'
  version: number  // monotonic counter для порядка сообщений
  state: PersonalizedState
  timestamp: number
}

/**
 * Персонализированное состояние для конкретного игрока
 * - Для локального игрока: полные hand/deck/discard
 * - Для других: только размеры (handSize, deckSize, discardSize)
 */
export interface PersonalizedState {
  // Общие данные (одинаковые для всех)
  board: GameState['board']
  activeGridSize: GameState['activeGridSize']
  gameId: GameState['gameId']
  hostId: GameState['hostId']
  dummyPlayerCount: GameState['dummyPlayerCount']
  isGameStarted: GameState['isGameStarted']
  gameMode: GameState['gameMode']
  isPrivate: GameState['isPrivate']
  isReadyCheckActive: GameState['isReadyCheckActive']
  activePlayerId: GameState['activePlayerId']
  startingPlayerId: GameState['startingPlayerId']
  currentPhase: GameState['currentPhase']
  isScoringStep: GameState['isScoringStep']
  scoringLines: ScoringLineData[]  // Lines available for scoring
  preserveDeployAbilities: GameState['preserveDeployAbilities']
  autoAbilitiesEnabled: GameState['autoAbilitiesEnabled']
  autoDrawEnabled: GameState['autoDrawEnabled']
  currentRound: GameState['currentRound']
  turnNumber: GameState['turnNumber']
  roundEndTriggered: GameState['roundEndTriggered']
  roundWinners: GameState['roundWinners']
  gameWinner: GameState['gameWinner']
  isRoundEndModalOpen: GameState['isRoundEndModalOpen']
  floatingTexts: GameState['floatingTexts']
  highlights: GameState['highlights']
  deckSelections: GameState['deckSelections']
  handCardSelections: GameState['handCardSelections']
  targetingMode: GameState['targetingMode']
  abilityMode: GameState['abilityMode']
  clickWaves: GameState['clickWaves']
  visualEffects: GameState['visualEffects']
  autoDrawnPlayers: GameState['autoDrawnPlayers']

  // Персонализированные данные игроков
  players: PersonalizedPlayer[]
  spectators: GameState['spectators']
}

/**
 * Персонализированные данные игрока
 */
export interface PersonalizedPlayer {
  id: number
  name: string
  score: number
  color: GameState['players'][0]['color']
  isDummy: GameState['players'][0]['isDummy']
  isDisconnected: GameState['players'][0]['isDisconnected']
  isReady: GameState['players'][0]['isReady']
  teamId: GameState['players'][0]['teamId']
  autoDrawEnabled: GameState['players'][0]['autoDrawEnabled']
  isSpectator: GameState['players'][0]['isSpectator']
  position: GameState['players'][0]['position']
  selectedDeck: GameState['players'][0]['selectedDeck']
  announcedCard?: GameState['players'][0]['announcedCard']  // Витрина видна всем
  lastPlayedCardId?: string | null  // Последняя сыгранная карта (для скоринга)

  // Для локального игрока: полные данные
  hand?: GameState['players'][0]['hand']
  deck?: GameState['players'][0]['deck']
  discard?: GameState['players'][0]['discard']
  boardHistory?: GameState['players'][0]['boardHistory']

  // Для других игроков: только размеры
  handSize?: number
  deckSize?: number
  discardSize?: number
}

/**
 * Визуальный эффект (подсветка ячейки)
 */
export interface HighlightMessage {
  type: 'HIGHLIGHT'
  data: {
    row: number
    col: number
    color: string
    duration?: number
    timestamp: number
  }
}

/**
 * Плавающий текст
 */
export interface FloatingTextMessage {
  type: 'FLOATING_TEXT'
  data: {
    batch: Array<{
      text: string
      coords?: { row: number; col: number }
      color: string
      timestamp: number
    }>
  }
}

/**
 * Targeting mode
 */
export interface TargetingModeMessage {
  type: 'TARGETING_MODE'
  data: {
    targetingMode: any
  }
}

/**
 * Clear targeting mode
 */
export interface ClearTargetingModeMessage {
  type: 'CLEAR_TARGETING_MODE'
  data: {
    timestamp: number
  }
}

/**
 * No target overlay
 */
export interface NoTargetMessage {
  type: 'NO_TARGET'
  data: {
    coords: { row: number; col: number }
    timestamp: number
  }
}

/**
 * Deck selection
 */
export interface DeckSelectionMessage {
  type: 'DECK_SELECTION'
  data: {
    playerId: number
    selectedByPlayerId: number
    timestamp: number
  }
}

/**
 * Hand card selection
 */
export interface HandCardSelectionMessage {
  type: 'HAND_CARD_SELECTION'
  data: {
    playerId: number
    cardIndex: number
    selectedByPlayerId: number
    timestamp: number
  }
}

/**
 * Click wave
 */
export interface ClickWaveMessage {
  type: 'CLICK_WAVE'
  data: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }
}

/**
 * Тип входящего P2P сообщения
 */
export type P2PMessage =
  | ActionMessage
  | StateMessage
  | HighlightMessage
  | FloatingTextMessage
  | TargetingModeMessage
  | ClearTargetingModeMessage
  | NoTargetMessage
  | DeckSelectionMessage
  | HandCardSelectionMessage
  | ClickWaveMessage

/**
 * Конфигурация SimpleHost
 */
export interface SimpleHostConfig {
  onStateUpdate?: (state: PersonalizedState) => void
  onPlayerJoin?: (playerId: number) => void
  onPlayerLeave?: (playerId: number) => void
  onError?: (error: string) => void
}

/**
 * Конфигурация SimpleGuest
 */
export interface SimpleGuestConfig {
  localPlayerId: number
  onStateUpdate?: (state: PersonalizedState) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: string) => void
  // Visual effect callbacks
  onHighlight?: (data: { row: number; col: number; color: string; duration?: number }) => void
  onFloatingText?: (batch: Array<{ text: string; coords?: { row: number; col: number }; color: string }>) => void
  onTargetingMode?: (targetingMode: any) => void
  onClearTargetingMode?: () => void
  onNoTarget?: (coords: { row: number; col: number }) => void
  onDeckSelection?: (playerId: number, selectedByPlayerId: number) => void
  onHandCardSelection?: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void
  onClickWave?: (wave: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }) => void
}
