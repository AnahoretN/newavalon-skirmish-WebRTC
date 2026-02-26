/**
 * Game Settings handlers for SimpleGameLogic
 *
 * Contains all game settings management logic:
 * - Game mode, grid size, privacy
 * - Team assignment
 * - Dummy player management
 * - Player ready state
 * - Game reset
 */

import type { GameState, Card, Player, PlayerColor } from '../../types'
import { DeckType } from '../../types'
import { shuffleDeck } from '../../../shared/utils/array'
import { createDeck } from '../../hooks/core/gameCreators'
import { getDecksData } from '../../content'

/**
 * SET_GAME_MODE - set game mode (FFA, 2v2, etc)
 */
export function handleSetGameMode(state: GameState, mode: any): GameState {
  return { ...state, gameMode: mode }
}

/**
 * SET_GRID_SIZE - set active grid size
 */
export function handleSetGridSize(state: GameState, size: any): GameState {
  return { ...state, activeGridSize: size }
}

/**
 * SET_PRIVACY - set game privacy (public/private)
 */
export function handleSetPrivacy(state: GameState, isPrivate: boolean): GameState {
  return { ...state, isPrivate }
}

/**
 * ASSIGN_TEAMS - assign players to teams
 */
export function handleAssignTeams(state: GameState, teams: any): GameState {
  const newPlayers = state.players.map(p => ({
    ...p,
    teamId: teams[p.id]
  }))

  return { ...state, players: newPlayers }
}

/**
 * SET_DUMMY_PLAYER_COUNT - add/remove dummy players
 */
export function handleSetDummyPlayerCount(state: GameState, count: number): GameState {
  // Cannot change dummy players after game has started
  if (state.isGameStarted) {
    return state
  }

  // Validate count (0-3)
  const numericCount = Number(count)
  if (!Number.isFinite(numericCount) || numericCount < 0 || numericCount > 3) {
    return state
  }

  // Get current real players (non-dummy)
  const realPlayers = state.players.filter(p => !p.isDummy)
  const currentDummies = state.players.filter(p => p.isDummy)

  // If count matches current number of dummies, no change needed
  if (currentDummies.length === numericCount) {
    return { ...state, dummyPlayerCount: numericCount }
  }

  // Remove all existing dummy players
  let newPlayers = [...realPlayers]

  // Add new dummy players
  let nextPlayerId = Math.max(...realPlayers.map(p => p.id), 0)
  for (let i = 0; i < numericCount; i++) {
    nextPlayerId++
    const dummyName = `Dummy ${i + 1}`

    // Get random deck type for dummy player
    const decksData = getDecksData()
    const deckKeys = Object.keys(decksData).filter(key =>
      key !== 'Tokens' && key !== 'Commands' && key !== 'Custom'
    ) as DeckType[]
    const randomDeckType = deckKeys[Math.floor(Math.random() * deckKeys.length)] || DeckType.SynchroTech

    const dummyDeck = shuffleDeck(createDeck(randomDeckType, nextPlayerId, dummyName))

    const dummyPlayer: Player = {
      id: nextPlayerId,
      name: dummyName,
      score: 0,
      hand: [],
      deck: dummyDeck,
      discard: [],
      announcedCard: null,
      selectedDeck: randomDeckType,
      color: (['blue', 'purple', 'red', 'green'] as PlayerColor[])[nextPlayerId - 1] || 'blue',
      isDummy: true,
      isReady: true,
      boardHistory: [],
      autoDrawEnabled: true,
    }
    newPlayers.push(dummyPlayer)
  }

  return {
    ...state,
    players: newPlayers,
    dummyPlayerCount: numericCount
  }
}

/**
 * PLAYER_READY - player is ready
 * When all players are ready, the game starts
 */
export function handlePlayerReady(state: GameState, playerId: number, startGameFn: (state: GameState) => GameState): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, isReady: true } : p
  )

  // Check if everyone is ready
  const allReady = newPlayers.every(p => p.isReady || p.isDummy || p.isSpectator)

  // If all ready - start game
  if (allReady) {
    return startGameFn({ ...state, players: newPlayers })
  }

  return { ...state, players: newPlayers }
}

/**
 * RESET_GAME - reset game to initial state (lobby)
 * Preserves players and their deck choices, but resets everything else
 */
export function handleResetGame(state: GameState): GameState {
  console.log('[handleResetGame] Resetting game to lobby state')

  // Preserve player data for restoration
  const playersToKeep = state.players.map(p => {
    const deckType = p.selectedDeck || 'SynchroTech'
    return {
      ...p,
      // Reset game data
      hand: [],
      deck: createDeck(deckType, p.id, p.name),
      discard: [],
      discardSize: 0,
      handSize: 0,
      deckSize: createDeck(deckType, p.id, p.name).length,
      score: 0,
      isReady: false,  // Reset ready status
      announcedCard: null,
      boardHistory: [],
      lastPlayedCardId: null,
      // Preserve settings
      autoDrawEnabled: p.autoDrawEnabled !== false,
    }
  })

  // Create empty board with preserved size
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
    // Reset game flags
    isGameStarted: false,
    isReadyCheckActive: false,
    currentPhase: 0,
    currentRound: 1,
    turnNumber: 1,
    activePlayerId: null,
    startingPlayerId: null,
    // Reset round and match
    roundWinners: {},
    gameWinner: null,
    roundEndTriggered: false,
    isRoundEndModalOpen: false,
    scoringLines: [],
    isScoringStep: false,
    // Clear visual effects
    floatingTexts: [],
    highlights: [],
    deckSelections: [],
    handCardSelections: [],
    targetingMode: null,
    clickWaves: [],
    visualEffects: new Map(),
    // New board and players
    board: newBoard,
    players: playersToKeep,
  }
}

/**
 * Start game - deals initial hands and selects random starting player
 * Called when all players are ready
 */
export function startGame(state: GameState): GameState {
  // Select random starting player
  const activePlayers = state.players.filter(p => !p.isDisconnected && !p.isSpectator)
  const startingPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)]

  console.log('[startGame] Starting player:', startingPlayer.id, startingPlayer.name)

  // Deal initial hands (6 cards to each player)
  const newPlayers = state.players.map(p => {
    if (p.isSpectator || p.isDisconnected) {return p}

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

  // Starting player gets 7th card (first turn advantage)
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
    currentPhase: 1,  // Setup - can play cards immediately
    turnNumber: 1
  }
}
