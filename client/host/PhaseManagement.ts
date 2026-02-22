/**
 * Phase Management for Host P2P
 * Handles phase transitions, auto-draw, turn management
 * Ported from server/handlers/phaseManagement.ts
 */

import type { GameState } from '../types'
import { logger } from '../utils/logger'
import { checkRoundEnd, endRound } from './RoundManagement'
import { resetReadyStatusesForTurn, clearTurnLimitedAbilitiesForPlayer } from '../utils/autoAbilities'

/**
 * Phase indices
 */
export const PHASES = {
  PREPARATION: 0,  // Draw card before Setup
  SETUP: 1,        // Place units
  MAIN: 2,          // Activate units
  COMMIT: 3,        // Add counters
  SCORING: 4        // Count scores
}

/**
 * Get phase name for display
 */
export function getPhaseName(phase: number): string {
  const names = ['Preparation', 'Setup', 'Main', 'Commit', 'Scoring']
  return names[phase] || 'Unknown'
}

/**
 * Perform Preparation phase - draw card and transition to Setup
 */
export function performPreparationPhase(gameState: GameState, activePlayerId: number): GameState {
  if (gameState.currentPhase !== 0) {
    logger.warn(`[performPreparationPhase] Not in Preparation phase (current: ${gameState.currentPhase})`)
    return gameState
  }

  logger.info(`[performPreparationPhase] Active player ${activePlayerId} draws a card`)

  // Find the active player
  const activePlayer = gameState.players.find(p => p.id === activePlayerId)
  if (!activePlayer) {
    logger.error(`[performPreparationPhase] Active player ${activePlayerId} not found!`)
    return gameState
  }

  logger.info(`[performPreparationPhase] Player ${activePlayerId} has deck size: ${activePlayer.deck.length}, hand size: ${activePlayer.hand.length}`)

  // Find the active player and draw a card
  const newPlayers = gameState.players.map(player => {
    if (player.id === activePlayerId && player.deck.length > 0) {
      const drawnCard = player.deck[0]
      const newDeck = [...player.deck.slice(1)]
      const newHand = [...player.hand, drawnCard]

      logger.info(`[performPreparationPhase] Player ${activePlayerId} drew card ${drawnCard?.id || 'unknown'}, deck now: ${newDeck.length}, hand: ${newHand.length}`)

      // Reset status ready flags for next cycle
      return {
        ...player,
        deck: newDeck,
        hand: newHand,
        readySetup: false,
        readyCommit: false
      }
    }
    return player
  })

  // Transition to Setup phase
  const newState: GameState = {
    ...gameState,
    players: newPlayers,
    currentPhase: 1  // Setup
  }

  // Reset phase-specific ready statuses (readySetup, readyCommit) for the active player
  // This happens during Preparation phase, before entering Setup phase
  // IMPORTANT: This must be done AFTER creating newState so we can modify it
  resetReadyStatusesForTurn(newState, activePlayerId)

  // Check for round end after entering Setup phase
  // This check happens after every preparation phase, so when first player's turn comes around
  // and they enter Setup phase with phase=1, we check if round should end
  if (checkRoundEnd(newState).shouldEnd) {
    logger.info(`[performPreparationPhase] Round end detected for activePlayerId=${activePlayerId}`)
    return endRound(newState)
  }

  logger.info(`[performPreparationPhase] Transitioned to Setup phase, activePlayerId=${newState.activePlayerId}`)
  return newState
}

/**
 * Set phase and optionally perform phase-specific actions
 */
export function setPhase(gameState: GameState, phaseIndex: number): GameState {
  const oldPhase = gameState.currentPhase

  // If going to Preparation phase, perform it and auto-advance to Setup
  if (phaseIndex === 0) {
    return performPreparationPhase(gameState, gameState.activePlayerId!)
  }

  // Validate phase index
  if (phaseIndex < 0 || phaseIndex > 4) {
    logger.warn(`[setPhase] Invalid phase index: ${phaseIndex}`)
    return gameState
  }

  // Create new state with updated phase
  const newState: GameState = {
    ...gameState,
    currentPhase: phaseIndex
  }

  // NOTE: We NO LONGER clear readyDeploy status on phase change
  // readyDeploy persists until:
  // 1. The Deploy ability is used (markAbilityUsed)
  // 2. The Deploy ability is skipped via right-click
  // This allows cards to use their Deploy ability even if they entered in a different phase

  logger.info(`[setPhase] Phase changed from ${oldPhase} (${getPhaseName(oldPhase)}) to ${phaseIndex} (${getPhaseName(phaseIndex)})`)
  return newState
}

/**
 * Go to next phase
 */
export function nextPhase(gameState: GameState): GameState {
  let nextPhase = gameState.currentPhase + 1

  // Special handling: Scoring (4) -> Preparation (0) -> Setup (1)
  if (gameState.currentPhase === 4) {
    nextPhase = 0
    logger.info(`[nextPhase] End of round ${gameState.currentRound || 1}, going to Preparation phase`)
  }

  // If going to Preparation, it will auto-advance to Setup
  return setPhase(gameState, nextPhase)
}

/**
 * Go to previous phase
 */
export function prevPhase(gameState: GameState): GameState {
  let prevPhase = gameState.currentPhase - 1

  // Special handling: Preparation (0) -> Scoring (4)
  if (gameState.currentPhase === 0) {
    prevPhase = 4
  }

  // Validate
  if (prevPhase < 0 || prevPhase > 4) {
    return gameState
  }

  // Create new state with updated phase
  const newState: GameState = {
    ...gameState,
    currentPhase: prevPhase
  }

  // NOTE: We NO LONGER clear readyDeploy status on phase change
  // readyDeploy persists until Deploy ability is used/skipped

  return newState
}

/**
 * Toggle active player (with auto-draw if enabled)
 * Matches server logic exactly
 * - If clicking same player: deselect (set to null) and check round end
 * - If clicking different player: select as active and enter Preparation phase
 * - Dummy players ARE included in the turn cycle
 */
export function toggleActivePlayer(gameState: GameState, targetPlayerId: number): GameState {
  const previousActivePlayerId = gameState.activePlayerId

  // Toggle: if same player clicked, deselect; otherwise select new player
  if (previousActivePlayerId === targetPlayerId) {
    // Deselect active player
    const newState: GameState = {
      ...gameState,
      activePlayerId: null
    }

    logger.info(`[toggleActivePlayer] Deselecting player ${targetPlayerId}`)

    // Check for round end when deselecting the starting player during Setup phase
    if (targetPlayerId === gameState.startingPlayerId && gameState.currentPhase === 1) {
      if (checkRoundEnd(newState).shouldEnd) {
        logger.info(`[toggleActivePlayer] Round end detected`)
        return endRound(newState)
      }
    }

    return newState
  }

  // Select new active player
  const allPlayers = gameState.players.filter(p => !p.isDisconnected)
  const targetPlayer = allPlayers.find(p => p.id === targetPlayerId)
  if (!targetPlayer) {
    logger.warn(`[toggleActivePlayer] Player ${targetPlayerId} not found or disconnected`)
    return gameState
  }

  logger.info(`[toggleActivePlayer] Selecting player ${targetPlayerId} (was ${previousActivePlayerId})`)

  // Increment turn number when cycling back to starting player (completes a full orbit)
  let newTurnNumber = gameState.turnNumber || 1
  if (targetPlayerId === gameState.startingPlayerId && previousActivePlayerId !== null) {
    newTurnNumber++
    logger.info(`[toggleActivePlayer] Turn ${newTurnNumber} begins`)
  }

  const newState: GameState = {
    ...gameState,
    activePlayerId: targetPlayerId,
    turnNumber: newTurnNumber,
    currentPhase: 0  // Enter Preparation phase
  }

  // Perform Preparation phase (draw card and transition to Setup)
  return performPreparationPhase(newState, targetPlayerId)
}

/**
 * Toggle auto-draw for a player
 */
export function toggleAutoDraw(gameState: GameState, playerId: number): GameState {
  const player = gameState.players.find(p => p.id === playerId)
  if (!player) {return gameState}

  const newAutoDraw = !player.autoDrawEnabled
  logger.info(`[toggleAutoDraw] Player ${playerId} auto-draw: ${newAutoDraw}`)

  return {
    ...gameState,
    players: gameState.players.map(p =>
      p.id === playerId ? { ...p, autoDrawEnabled: newAutoDraw } : p
    )
  }
}

/**
 * Reset deploy status for all cards
 */
export function resetDeployStatus(gameState: GameState): GameState {
  return {
    ...gameState,
    board: gameState.board.map(row =>
      row.map(cell => {
        if (cell.card && cell.card.statuses) {
          return {
            ...cell,
            card: {
              ...cell.card,
              statuses: cell.card.statuses.filter(s => s.type !== 'justDeployed')
            }
          }
        }
        return cell
      })
    )
  }
}

/**
 * Get the next player in the turn cycle
 * Includes dummy players, excludes disconnected players
 * Players are sorted by ID to maintain consistent order
 */
export function getNextPlayerId(gameState: GameState, currentActivePlayerId: number | null): number | null {
  // Get all non-disconnected players (including dummies)
  const allPlayers = gameState.players
    .filter(p => !p.isDisconnected)
    .sort((a, b) => a.id - b.id)

  if (allPlayers.length === 0) {
    return null
  }

  // If no current player, return first player
  if (currentActivePlayerId === null) {
    return allPlayers[0].id
  }

  // Find current player index
  const currentIndex = allPlayers.findIndex(p => p.id === currentActivePlayerId)
  if (currentIndex === -1) {
    return allPlayers[0].id
  }

  // Get next player (wrap around)
  const nextIndex = (currentIndex + 1) % allPlayers.length
  return allPlayers[nextIndex].id
}

/**
 * Check if a player has any cards on the board
 */
export function playerHasCardsOnBoard(gameState: GameState, playerId: number): boolean {
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card?.ownerId === playerId) {
        return true
      }
    }
  }
  return false
}

/**
 * Pass turn to next player and enter Preparation phase
 * This is used for automatic turn passing in Scoring and Commit phases
 */
export function passTurnToNextPlayer(gameState: GameState): GameState {
  const nextPlayerId = getNextPlayerId(gameState, gameState.activePlayerId)

  if (nextPlayerId === null) {
    logger.warn('[passTurnToNextPlayer] No next player found')
    return gameState
  }

  logger.info(`[passTurnToNextPlayer] Passing turn from ${gameState.activePlayerId} to ${nextPlayerId}`)

  // Remove Stun status from current player's cards before passing turn
  let newState: GameState = {
    ...gameState,
    board: gameState.board.map(row =>
      row.map(cell => {
        if (cell.card?.ownerId === gameState.activePlayerId && cell.card.statuses) {
          return {
            ...cell,
            card: {
              ...cell.card,
              statuses: cell.card.statuses.filter(s => s.type !== 'Stun')
            }
          }
        }
        return cell
      })
    )
  }

  // Clear turn-limited ability usage (setupUsedThisTurn, commitUsedThisTurn) from current player's cards
  // This allows them to use Setup/Commit abilities again in their next turn
  if (gameState.activePlayerId !== null) {
    clearTurnLimitedAbilitiesForPlayer(newState, gameState.activePlayerId)
  }

  // Clear enteredThisTurn flags from all cards
  newState = {
    ...newState,
    board: newState.board.map(row =>
      row.map(cell => {
        if (cell.card && cell.card.statuses) {
          return {
            ...cell,
            card: {
              ...cell.card,
              statuses: cell.card.statuses.filter(s => s.type !== 'enteredThisTurn')
            }
          }
        }
        return cell
      })
    )
  }

  // Set new active player and enter Preparation phase
  newState = {
    ...newState,
    activePlayerId: nextPlayerId,
    currentPhase: 0,  // Preparation phase
    isScoringStep: false,
    targetingMode: null  // Clear targeting mode when passing turn
  }

  // Perform Preparation phase (draw card and transition to Setup)
  return performPreparationPhase(newState, nextPlayerId)
}
