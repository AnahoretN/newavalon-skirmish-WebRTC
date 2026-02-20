/**
 * gameCreators - Модуль для создания игровых сущностей
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - generateGameId - генерация уникального ID игры
 * - createDeck - создание колоды для игрока
 * - createNewPlayer - создание нового игрока
 * - createInitialState - создание начального состояния игры
 */

import { DeckType, GameMode as GameModeEnum } from '../../types'
import type { Card, Player, GameState } from '../../types'
import { PLAYER_COLOR_NAMES } from '../../constants'
import { getDecksData } from '../../content'
import { shuffleDeck } from '@shared/utils/array'
import { createInitialBoard } from '@shared/utils/boardUtils'
import { logger } from '../../utils/logger'

/**
 * Generate a random game ID
 */
export function generateGameId(): string {
  return Math.random().toString(36).substring(2, 18).toUpperCase()
}

/**
 * Create a shuffled deck for a player
 */
export function createDeck(deckType: DeckType, playerId: number, playerName: string): Card[] {
  // Use getDecksData() to always get fresh data instead of cached import
  const currentDecksData = getDecksData()

  // Handle "Random" deck type - use first available deck
  let actualDeckType = deckType
  if (deckType === 'Random' || !currentDecksData[deckType]) {
    const deckKeys = Object.keys(currentDecksData)
    if (deckKeys.length === 0) {
      logger.error('[createDeck] No decks loaded yet!')
      return []
    }
    actualDeckType = deckKeys[0] as DeckType
    if (deckType === 'Random') {
      logger.info(`[createDeck] Random deck selected, using ${actualDeckType} instead`)
    } else {
      logger.warn(`[createDeck] Deck ${deckType} not found, using ${actualDeckType} instead`)
    }
  }

  const deck = currentDecksData[actualDeckType]
  if (!deck) {
    logger.error(`Deck data for ${actualDeckType} not loaded! Returning empty deck. Available decks:`, Object.keys(currentDecksData))
    return []
  }

  // Debug: log deck contents for Optimates to help track down card duplication issues
  if (actualDeckType === 'Optimates') {
    const cardCounts: Record<string, number> = {}
    deck.forEach(card => {
      const baseId = card.baseId || card.id
      cardCounts[baseId] = (cardCounts[baseId] || 0) + 1
    })
    logger.info(`[createDeck] Optimates deck for player ${playerName} (${playerId}):`, cardCounts)
  }

  const deckWithOwner = [...deck].map(card => ({ ...card, ownerId: playerId, ownerName: playerName }))
  return shuffleDeck(deckWithOwner)
}

/**
 * Create a new player object
 */
export function createNewPlayer(id: number, isDummy = false): Player {
  // Use getDecksData() to always get fresh data instead of cached import
  const currentDecksData = getDecksData()
  const deckKeys = Object.keys(currentDecksData)
  if (deckKeys.length === 0) {
    logger.error('[createNewPlayer] No decks loaded yet!')
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
      isReady: isDummy, // Dummy players are always ready
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
    isReady: isDummy, // Dummy players are always ready
    boardHistory: [],
    autoDrawEnabled: true, // Auto-draw is enabled by default for all players
  }
  player.deck = createDeck(initialDeckType, id, player.name)
  return player
}

/**
 * Create initial game state
 */
export function createInitialState(): GameState {
  return {
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
  }
}
