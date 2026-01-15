/**
 * Board utility functions for client-side operations
 * These are complementary to server-side boardUtils and provide
 * convenient iteration patterns for the game board.
 */

import type { Board, Card } from '../types'

export interface CardLocation {
  card: Card
  row: number
  col: number
}

export type BoardIterationCallback = (card: Card | null, row: number, col: number) => void
export type BoardCardCallback = (location: CardLocation) => void
export type BoardCardFilter = (card: Card, row: number, col: number) => boolean

/**
 * Iterate over all cells in the board
 */
export function forEachCell(board: Board, callback: BoardIterationCallback): void {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      callback(board[row][col].card || null, row, col)
    }
  }
}

/**
 * Iterate over all cells that contain a card
 */
export function forEachCard(board: Board, callback: BoardCardCallback): void {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const card = board[row][col].card
      if (card) {
        callback({ card, row, col })
      }
    }
  }
}

/**
 * Find a card by its ID on the board
 */
export function findCardById(board: Board, cardId: string): CardLocation | null {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const card = board[row][col].card
      if (card && card.id === cardId) {
        return { card, row, col }
      }
    }
  }
  return null
}

/**
 * Filter cards on the board based on a predicate
 */
export function filterCards(board: Board, predicate: BoardCardFilter): CardLocation[] {
  const results: CardLocation[] = []
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const card = board[row][col].card
      if (card && predicate(card, row, col)) {
        results.push({ card, row, col })
      }
    }
  }
  return results
}

/**
 * Get all cards owned by a specific player
 */
export function getPlayerCards(board: Board, playerId: number): CardLocation[] {
  return filterCards(board, (card) => card.ownerPlayerId === playerId)
}

/**
 * Get all cards in a specific row
 */
export function getRowCards(board: Board, row: number): CardLocation[] {
  const results: CardLocation[] = []
  if (row >= 0 && row < board.length) {
    for (let col = 0; col < board[row].length; col++) {
      const card = board[row][col].card
      if (card) {
        results.push({ card, row, col })
      }
    }
  }
  return results
}

/**
 * Get all cards in a specific column
 */
export function getColumnCards(board: Board, col: number): CardLocation[] {
  const results: CardLocation[] = []
  for (let row = 0; row < board.length; row++) {
    if (col >= 0 && col < board[row].length) {
      const card = board[row][col].card
      if (card) {
        results.push({ card, row, col })
      }
    }
  }
  return results
}

/**
 * Get all cards in a line (row or column) through a specific point
 */
export function getLineCards(board: Board, row: number, col: number, isRow: boolean): CardLocation[] {
  return isRow ? getRowCards(board, row) : getColumnCards(board, col)
}

/**
 * Check if a cell is within board bounds
 */
export function isCellInBounds(board: Board, row: number, col: number): boolean {
  return row >= 0 && row < board.length && col >= 0 && col < board[0].length
}

/**
 * Check if a cell is empty (no card)
 */
export function isCellEmpty(board: Board, row: number, col: number): boolean {
  return isCellInBounds(board, row, col) && !board[row][col].card
}
