/**
 * gameStateStorage - Модуль для сохранения и загрузки состояния игры
 *
 * Вынесено из useGameState.ts для разделения ответственности
 *
 * Функции:
 * - syncLastPlayed - синхронизация статуса LastPlayed
 * - syncCardImages - синхронизация изображений карт
 * - syncGameStateImages - синхронизация изображений всего состояния
 * - saveGameState - сохранение состояния в localStorage
 * - loadGameState - загрузка состояния из localStorage
 * - clearGameState - очистка сохраненного состояния
 */

import { rawJsonData } from '@/content'
import type { Board, GameState } from '../../types'
import { DeckType } from '../../types'

// localStorage keys for game state persistence
export const GAME_STATE_KEY = 'avalon_game_state'
export const RECONNECTION_DATA_KEY = 'reconnection_data'

/**
 * Sync LastPlayed status for a player's cards on the board
 * Removes old LastPlayed statuses and adds new one based on boardHistory
 */
export function syncLastPlayed(board: Board, player: any): void {
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

/**
 * Sync card data (imageUrl, fallbackImage) from database
 * This is needed after restoring from localStorage or receiving state from server
 */
export function syncCardImages(card: any): any {
  if (!card || !rawJsonData) { return card }
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
export function syncGameStateImages(gameState: GameState): GameState {
  if (!rawJsonData) { return gameState }

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

/**
 * Save full game state to localStorage (persists across tab close/reopen)
 *
 * Restore logic based on navigation type:
 * - Normal reload (F5) - restore state
 * - Hard reload (Shift+F5, Ctrl+Shift+R) - DON'T restore
 * - Tab close/reopen - restore state
 * - Browser cache clear - DON'T restore (localStorage is cleared)
 */
export function saveGameState(gameState: GameState, localPlayerId: number | null, playerToken?: string): void {
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

/**
 * Load game state from localStorage
 * Returns null if state is too old (>24 hours) or doesn't exist
 */
export function loadGameState(): { gameState: GameState; localPlayerId: number; playerToken?: string } | null {
  try {
    const stored = localStorage.getItem(GAME_STATE_KEY)
    if (!stored) { return null }
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

/**
 * Clear saved game state from localStorage
 */
export function clearGameState(): void {
  localStorage.removeItem(GAME_STATE_KEY)
  localStorage.removeItem(RECONNECTION_DATA_KEY)
}
