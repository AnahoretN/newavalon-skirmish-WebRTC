/**
 * Simple Game Logic
 *
 * Core game logic for WebRTC P2P mode.
 * The applyAction function takes current state and action,
 * returns new state.
 *
 * Some specialized handlers are split into separate modules:
 * - handlers/scoringHandlers.ts - scoring and round management
 * - handlers/gameSettingsHandlers.ts - game configuration
 */

import type { GameState, Card, Player, ScoringLineData, CardStatus } from '../types'
import { DeckType } from '../types'
import type { ActionType } from './SimpleP2PTypes'
import { shuffleDeck } from '../../shared/utils/array'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'
import { recalculateAllReadyStatuses, getCardAbilityInfo, recheckReadyStatuses } from '../utils/autoAbilities'
import { READY_STATUS, checkTriggersOnCardPlaced, type CardPlacedEvent } from '@shared/abilities/index.js'
import { createDeck } from '../hooks/core/gameCreators'
import { logger } from '../utils/logger'
import { getCardDefinition } from '@/content'
import type { CardLookupFn } from '@shared/abilities/triggerSystem.js'
// Import content database directly for trigger lookup
import contentDatabase from '@shared/content/contentDatabase.json'

// Import handlers from separate modules
import * as ScoringHandlers from './handlers/scoringHandlers'
import * as GameSettingsHandlers from './handlers/gameSettingsHandlers'

// Import helper functions used internally
import { findScoringLinesWithPlayerCard, getActivePlayerIds, shouldRoundEnd, endRound, calculateLineScore } from './handlers/scoringHandlers'

// Re-export helper functions that are used externally
export { findScoringLinesWithPlayerCard }
export { getActivePlayerIds, shouldRoundEnd, endRound }
export { startGame } from './handlers/gameSettingsHandlers'

/**
 * Check if card is a token
 * Tokens are identified by deck === 'counter', deck === 'Tokens', or having 'Token' type
 */
function isToken(card: Card): boolean {
  return card.deck === 'counter' ||
         card.deck === 'Tokens' ||
         card.types?.includes('Token') === true
}

/**
 * Clear all card statuses except Revealed
 * Called when moving card from battlefield
 * Also resets power modifiers to base value
 */
function clearAllStatusesExceptRevealed(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
  }
  // Keep only Revealed statuses, remove all others
  card.statuses = card.statuses.filter(s => s.type === 'Revealed')

  // Reset power modifiers to base value when card leaves battlefield
  card.powerModifier = 0
  card.bonusPower = 0
}

/**
 * Clear all card statuses including Revealed
 * Called when moving card to discard/deck
 * Also resets power modifiers to base value
 */
function clearAllStatuses(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
  }
  // Clear ALL statuses including Revealed when card goes to discard/deck
  card.statuses = []

  // Reset power modifiers to base value
  card.powerModifier = 0
  card.bonusPower = 0
}

/**
 * Restore LastPlayed status to previous card when a card with LastPlayed leaves battlefield
 * @param removedCard - The card being removed from battlefield
 * @param ownerId - The owner of the removed card
 * @param state - Current game state
 * @returns Updated game state with LastPlayed restored to previous card
 */
function restoreLastPlayedToPreviousCard(
  state: GameState,
  removedCard: Card,
  ownerId: number
): GameState {
  // Check if the removed card had LastPlayed status
  const hadLastPlayed = removedCard.statuses?.some(
    s => s.type === 'LastPlayed' && s.addedByPlayerId === ownerId
  )

  console.log('[restoreLastPlayedToPreviousCard] Card removed:', removedCard.id, 'hadLastPlayed:', hadLastPlayed, 'ownerId:', ownerId)

  if (!hadLastPlayed) {
    return state // No restoration needed
  }

  const player = state.players.find(p => p.id === ownerId)
  if (!player || !player.boardHistory) {
    console.log('[restoreLastPlayedToPreviousCard] No player or boardHistory found')
    return state
  }

  console.log('[restoreLastPlayedToPreviousCard] boardHistory:', player.boardHistory)

  // Find previous card in boardHistory (excluding the removed card)
  const historyWithoutRemoved = player.boardHistory.filter(id => id !== removedCard.id)

  if (historyWithoutRemoved.length === 0) {
    // No previous cards - just update boardHistory and lastPlayedCardId
    console.log('[restoreLastPlayedToPreviousCard] No previous cards in history')
    const newPlayers = state.players.map(p =>
      p.id === ownerId
        ? { ...p, boardHistory: historyWithoutRemoved, lastPlayedCardId: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Find the most recent card in history that's still on board
  // Search from most recent backwards
  let foundCardId: string | null = null
  for (let i = historyWithoutRemoved.length - 1; i >= 0; i--) {
    const cardId = historyWithoutRemoved[i]
    // Check if this card is still on the board
    for (let r = 0; r < state.board.length; r++) {
      for (let c = 0; c < state.board[r].length; c++) {
        if (state.board[r][c]?.card?.id === cardId) {
          foundCardId = cardId
          break
        }
      }
      if (foundCardId) {break}
    }
    if (foundCardId) {break}
  }

  if (!foundCardId) {
    // No cards from history are still on board - clear LastPlayed
    console.log('[restoreLastPlayedToPreviousCard] No cards from history still on board')
    const newPlayers = state.players.map(p =>
      p.id === ownerId
        ? { ...p, boardHistory: historyWithoutRemoved, lastPlayedCardId: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Remove all cards after the found one from history (they left the board)
  const foundIndex = historyWithoutRemoved.indexOf(foundCardId)
  const trimmedHistory = historyWithoutRemoved.slice(0, foundIndex + 1)

  console.log('[restoreLastPlayedToPreviousCard] Restoring LastPlayed to card:', foundCardId, 'trimmedHistory:', trimmedHistory)

  // Find this card on board and restore LastPlayed status
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card?.id === foundCardId) {
        const lastPlayedStatus = { type: 'LastPlayed' as const, addedByPlayerId: ownerId }
        const existingStatuses = cell.card.statuses || []
        // Remove any existing LastPlayed from this player
        const filteredStatuses = existingStatuses.filter(
          s => !(s.type === 'LastPlayed' && s.addedByPlayerId === ownerId)
        )
        return {
          card: {
            ...cell.card,
            statuses: [...filteredStatuses, lastPlayedStatus]
          }
        }
      }
      return cell
    })
  )

  // Update player's boardHistory and lastPlayedCardId
  const newPlayers = state.players.map(p =>
    p.id === ownerId
      ? { ...p, boardHistory: trimmedHistory, lastPlayedCardId: foundCardId }
      : p
  )

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * Check and apply triggers when a card is placed on the battlefield
 * Used for abilities like Vigilant Spotter: "When your opponent plays a revealed card, gain 2 points."
 *
 * @param state - Current game state
 * @param placedCard - The card that was placed
 * @param coords - Where the card was placed
 * @param playerId - The player who placed the card
 * @param source - Where the card came from ('hand', 'deck', 'discard', 'announced', 'board')
 * @returns Updated game state with trigger effects applied
 */
function checkAndApplyTriggers(
  state: GameState,
  placedCard: Card,
  coords: { row: number; col: number },
  playerId: number,
  source: 'hand' | 'deck' | 'discard' | 'announced' | 'board'
): GameState {
  console.log('[checkAndApplyTriggers] CALLED - placedCard:', placedCard.baseId, 'coords:', coords, 'playerId:', playerId, 'source:', source)
  console.log('[checkAndApplyTriggers] Placed card statuses:', placedCard.statuses)

  // Create the card lookup function - use contentDatabase directly
  const cardLookup: CardLookupFn = (baseId: string) => {
    // Try contentDatabase first (most reliable)
    if ((contentDatabase.cardDatabase as any)[baseId]) {
      const def = (contentDatabase.cardDatabase as any)[baseId]
      console.log('[checkAndApplyTriggers] cardLookup for', baseId, 'found in contentDatabase, abilities:', def.ABILITIES?.length)
      return def
    }
    // Fallback to getCardDefinition
    const def = getCardDefinition(baseId) as { ABILITIES?: any[] } | null
    console.log('[checkAndApplyTriggers] cardLookup for', baseId, 'via getCardDefinition:', def ? 'found' : 'NOT FOUND', 'abilities:', def?.ABILITIES?.length)
    return def
  }

  // Create the card placed event
  const event: CardPlacedEvent = {
    card: placedCard,
    coords,
    playerId,
    source
  }

  // Check for matching triggers
  const triggerResults = checkTriggersOnCardPlaced(state, event, cardLookup)

  console.log('[checkAndApplyTriggers] Trigger results:', triggerResults)

  if (triggerResults.length === 0) {
    return state
  }

  console.log('[checkAndApplyTriggers] Triggers fired:', triggerResults)

  // Apply trigger effects (modify scores, etc.)
  const newState = state
  triggerResults.forEach(result => {
    if (result.points && result.points > 0) {
      const playerToUpdate = newState.players.find(p => p.id === result.triggerOwnerId)
      if (playerToUpdate) {
        playerToUpdate.score = (playerToUpdate.score || 0) + result.points
        console.log('[checkAndApplyTriggers] Awarded', result.points, 'points to player', result.triggerOwnerId)
      }
    }
  })

  return newState
}

/**
 * Apply action to game state
 * This is the only place where game state is modified!
 */
export function applyAction(
  state: GameState,
  playerId: number,
  action: ActionType,
  data?: any
): GameState {
  // Debug logging for ADD_STATUS_TO_BOARD_CARD
  if (action === 'ADD_STATUS_TO_BOARD_CARD') {
    console.log('[SimpleGameLogic] applyAction: ADD_STATUS_TO_BOARD_CARD', { playerId, data })
  }

  // Validation - can this player perform this action
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

    // Movement between zones
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

    case 'SWAP_CARDS':
      newState = handleSwapCards(newState, playerId, data)
      break

    case 'SPAWN_TOKEN':
      newState = handleSpawnToken(newState, playerId, data)
      break

    case 'RESURRECT_DISCARDED':
      newState = handleResurrectDiscarded(newState, playerId, data)
      break

    case 'DRAW_CARD':
      newState = handleDrawCard(newState, playerId, data)
      break

    case 'SHUFFLE_DECK':
      newState = handleShuffleDeck(newState, playerId)
      break

    case 'UPDATE_SCORE':
      newState = handleUpdateScore(newState, data?.playerId ?? playerId, data?.delta || 0)
      break

    case 'CHANGE_PLAYER_NAME':
      newState = handleChangePlayerName(newState, data?.playerId ?? playerId, data?.name)
      break

    case 'CHANGE_PLAYER_COLOR':
      newState = handleChangePlayerColor(newState, data?.playerId ?? playerId, data?.color)
      break

    case 'CHANGE_PLAYER_DECK':
      newState = handleChangePlayerDeck(newState, data?.playerId ?? playerId, data?.deck)
      break

    case 'START_SCORING':
      newState = ScoringHandlers.handleStartScoring(newState, playerId, enterScoringPhase)
      break

    case 'SELECT_SCORING_LINE':
      newState = ScoringHandlers.handleSelectScoringLine(newState, playerId, data)
      break

    case 'COMPLETE_ROUND':
      newState = ScoringHandlers.handleCompleteRound(newState)
      break

    case 'START_NEXT_ROUND':
      newState = ScoringHandlers.handleStartNextRound(newState)
      break

    case 'START_NEW_MATCH':
      newState = ScoringHandlers.handleStartNewMatch(newState)
      break

    case 'PLAYER_READY':
      newState = GameSettingsHandlers.handlePlayerReady(newState, playerId, GameSettingsHandlers.startGame)
      break

    case 'RESET_GAME':
      newState = GameSettingsHandlers.handleResetGame(newState)
      break

    case 'MARK_ABILITY_USED':
      newState = handleMarkAbilityUsed(newState, data)
      break

    case 'REMOVE_ALL_COUNTERS_BY_TYPE':
      newState = handleRemoveAllCountersByType(newState, data)
      break

    case 'REMOVE_COUNTER_BY_TYPE':
      newState = handleRemoveCounterByType(newState, data)
      break

    case 'ADD_STATUS_TO_BOARD_CARD':
      newState = handleAddStatusToBoardCard(newState, playerId, data)
      break

    case 'ADD_STATUS_TO_HAND_CARD':
      newState = handleAddStatusToHandCard(newState, playerId, data)
      break

    case 'TRANSFER_ALL_STATUSES':
      newState = handleTransferAllStatuses(newState, playerId, data)
      break

    case 'PLAY_TOKEN_CARD':
      newState = handlePlayTokenCard(newState, playerId, data)
      break

    case 'FLIP_CARD':
      newState = handleFlipCard(newState, playerId, data)
      break

    case 'SET_GAME_MODE':
      newState = GameSettingsHandlers.handleSetGameMode(newState, data?.mode)
      break

    case 'SET_GRID_SIZE':
      newState = GameSettingsHandlers.handleSetGridSize(newState, data?.size)
      break

    case 'SET_PRIVACY':
      newState = GameSettingsHandlers.handleSetPrivacy(newState, data?.isPrivate)
      break

    case 'ASSIGN_TEAMS':
      newState = GameSettingsHandlers.handleAssignTeams(newState, data?.teams)
      break

    case 'SET_DUMMY_PLAYER_COUNT':
      newState = GameSettingsHandlers.handleSetDummyPlayerCount(newState, data?.count)
      break

    case 'REORDER_CARDS':
      newState = handleReorderCards(newState, playerId, data)
      break

    case 'REORDER_TOP_DECK':
      newState = handleReorderTopDeck(newState, playerId, data)
      break

    case 'REQUEST_DECK_VIEW':
      newState = handleRequestDeckView(newState, playerId, data)
      break

    case 'MODIFY_CARD_POWER':
      newState = handleModifyCardPower(newState, data)
      break

    default:
      console.warn(`[SimpleGameLogic] Unknown action: ${action}`)
  }

  // Always recalculate board card statuses (Support, Threat, etc.)
  newState.board = recalculateBoardStatuses(newState)

  // After board statuses are recalculated, recalculate ready statuses
  // This ensures cards gain/lose readySetup/readyCommit when Support changes
  recalculateAllReadyStatuses(newState)

  return newState
}

/**
 * Check if player can perform this action
 */
function canPlayerAct(
  state: GameState,
  playerId: number,
  action: ActionType,
  _data?: any
): boolean {
  // Any player can do game settings in lobby
  if (!state.isGameStarted) {
    return ['PLAYER_READY', 'CHANGE_PLAYER_NAME', 'CHANGE_PLAYER_COLOR',
            'CHANGE_PLAYER_DECK', 'SET_GAME_MODE', 'SET_GRID_SIZE',
            'SET_PRIVACY', 'ASSIGN_TEAMS', 'SET_DUMMY_PLAYER_COUNT'].includes(action)
  }

  // Players can change their settings
  if (action === 'CHANGE_PLAYER_NAME' || action === 'CHANGE_PLAYER_COLOR') {
    return true
  }

  // Dummy players can control all
  const player = state.players.find(p => p.id === playerId)
  if (player?.isDummy) {return true}

  // All other actions can be performed by any player
  // (cards can be moved any turn, phases can be switched by any player)
  return true
}

// ============================================================================
// Phase actions
// ============================================================================

/**
 * NEXT_PHASE - transition to next phase
 */
function handleNextPhase(state: GameState, playerId: number): GameState {
  const phase = state.currentPhase

  // Preparation (0) → Setup (1) - automatic, handled in passTurn
  if (phase === 0) {
    const newState = { ...state, currentPhase: 1 }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Setup (1) → Main (2) - happens when playing card
  if (phase === 1) {
    const newState = { ...state, currentPhase: 2 }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Main (2) → Commit (3)
  if (phase === 2) {
    const newState = { ...state, currentPhase: 3 }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Commit (3) → Scoring (4) or PassTurn
  if (phase === 3) {
    // Check if ACTIVE player has cards with "LastPlayed" status on board
    // We use state.activePlayerId, not playerId (who clicked the button)
    // This is important when Player A plays cards for Dummy Player B
    const activePlayerId = state.activePlayerId
    console.log('[NEXT_PHASE to Scoring] Active player', activePlayerId, 'checking for LastPlayed cards...')

    const player = state.players.find(p => p.id === activePlayerId)
    const isDummyPlayer = player?.isDummy ?? false

    // Debug: log all player's cards on board
    const playerCardsOnBoard: any[] = []
    state.board.forEach((row, _r) => {
      row.forEach((cell, _c) => {
        if (cell.card?.ownerId === activePlayerId) {
          playerCardsOnBoard.push({
            id: cell.card.id,
            name: cell.card.name,
            statuses: cell.card.statuses,
            hasLastPlayed: cell.card?.statuses?.some(s => s.type === 'LastPlayed')
          })
        }
      })
    })
    console.log('[NEXT_PHASE to Scoring] Player cards on board:', playerCardsOnBoard)

    // For dummy players, check if card belongs to them and has LastPlayed (any player could have added it)
    // For real players, check if card belongs to them AND was added by them this turn
    const hasLastPlayedCards = state.board.some(row =>
      row.some(cell => {
        if (cell.card?.ownerId !== activePlayerId) {return false}

        if (isDummyPlayer) {
          // Dummy player: check for any LastPlayed status (regardless of who added it)
          return cell.card?.statuses?.some(s => s.type === 'LastPlayed')
        } else {
          // Real player: only count cards they played themselves
          return cell.card?.statuses?.some(s => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)
        }
      })
    )

    console.log('[NEXT_PHASE to Scoring] hasLastPlayedCards:', hasLastPlayedCards, 'isDummy:', isDummyPlayer)

    if (hasLastPlayedCards) {
      // Has cards with LastPlayed status - enter Scoring and calculate lines
      console.log('[NEXT_PHASE to Scoring] Entering scoring phase for player', activePlayerId)
      return enterScoringPhase(state, activePlayerId ?? 0)
    } else {
      // No cards with LastPlayed status - pass turn to next player
      console.log('[NEXT_PHASE to Scoring] No LastPlayed cards, passing turn')
      return handlePassTurn(state, activePlayerId ?? 0, 'no_new_cards')
    }
  }

  // Scoring (4) → PassTurn
  if (phase === 4) {
    return handlePassTurn(state, playerId, 'scoring_complete')
  }

  return state
}

/**
 * Enter Scoring phase - calculate lines for highlighting
 */
function enterScoringPhase(state: GameState, playerId: number): GameState {
  // Find lines containing player's cards
  const lines = findScoringLinesWithPlayerCard(state, playerId)

  // Calculate points for each line
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
 * PREVIOUS_PHASE - return to previous phase
 */
function handlePreviousPhase(state: GameState, _playerId: number): GameState {
  const phase = state.currentPhase

  if (phase > 1) {
    return { ...state, currentPhase: phase - 1 as any }
  }

  return state
}

/**
 * PASS_TURN - pass turn to next player
 */
function handlePassTurn(state: GameState, playerId: number, reason: string): GameState {
  const activePlayerIds = getActivePlayerIds(state.players)
  if (activePlayerIds.length === 0) {return state}

  const currentIndex = activePlayerIds.indexOf(state.activePlayerId || 1)
  const nextIndex = (currentIndex + 1) % activePlayerIds.length
  const nextPlayerId = activePlayerIds[nextIndex]

  console.log('[handlePassTurn] Turn passed from', playerId, 'to', nextPlayerId, 'reason:', reason)

  // Check if player just finished scoring phase - remove 1 Stun token from each of their cards
  const scoringComplete = reason === 'scoring_complete'

  // Reset enteredThisTurn on all board cards when passing turn
  // Also clear setupUsedThisTurn and commitUsedThisTurn (but not deployUsedThisTurn!)
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card) {
        let newStatuses = cell.card.statuses?.filter((s: any) => {
          // Keep all statuses except setupUsedThisTurn and commitUsedThisTurn
          if (s.type === 'setupUsedThisTurn') {return false}
          if (s.type === 'commitUsedThisTurn') {return false}
          return true
        }) || []

        // After scoring, remove 1 Stun token from the player's own cards
        if (scoringComplete && cell.card.ownerId === playerId) {
          const stunIndex = newStatuses.findIndex((s: any) => s.type === 'Stun')
          if (stunIndex !== -1) {
            console.log('[handlePassTurn] Removing 1 Stun token from card', cell.card.id, 'owned by player', playerId)
            // Remove only the first Stun token
            newStatuses = newStatuses.filter((_: any, i: number) => i !== stunIndex)
          }
        }

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

  // IMPORTANT: Do NOT reset lastPlayedCardId when passing turn!
  // The lastPlayedCardId should persist as long as the card is on battlefield.
  // It's only cleared when the card leaves battlefield (handled by restoreLastPlayedToPreviousCard)
  const newPlayers = state.players.map(p => ({
    ...p
    // lastPlayedCardId is preserved
  })) as Player[]

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    activePlayerId: nextPlayerId,
    currentPhase: 0,  // Preparation
    scoringLines: []  // Clear scoring lines when passing turn
  }

  // Check full cycle (returned to starting player)
  if (nextPlayerId === state.startingPlayerId) {
    newState.turnNumber = (state.turnNumber || 0) + 1
  }

  // Preparation phase: auto-draw for new active player
  newState = executePreparationPhase(newState, nextPlayerId)

  return newState
}

/**
 * SET_PHASE - set specific phase
 */
function handleSetPhase(state: GameState, phaseNumber: number): GameState {
  const clamped = Math.max(0, Math.min(4, phaseNumber))
  const newState = { ...state, currentPhase: clamped }

  // When entering Preparation phase (0), clear setup/commit usage markers
  // This allows abilities to be used again in the new turn
  if (clamped === 0) {
    newState.board = newState.board.map(row =>
      row.map(cell => {
        if (cell.card) {
          const newStatuses = cell.card.statuses?.filter((s: any) => {
            // Remove only setupUsedThisTurn and commitUsedThisTurn
            // Keep deployUsedThisTurn (only clears when card leaves battlefield)
            if (s.type === 'setupUsedThisTurn') {return false}
            if (s.type === 'commitUsedThisTurn') {return false}
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

  // When entering Scoring phase (4), initialize scoring mode
  if (clamped === 4) {
    // Use activePlayerId for scoring, or default to player 1
    const scoringPlayerId = state.activePlayerId || 1
    return enterScoringPhase(newState, scoringPlayerId)
  }

  // Clear scoring mode when leaving scoring phase (4)
  // If setting any phase other than scoring, close scoring selection
  if (clamped !== 4) {
    newState.isScoringStep = false
    newState.scoringLines = []
  }

  recalculateAllReadyStatuses(newState)
  return newState
}

/**
 * Preparation phase - auto-draw and check round end
 */
function executePreparationPhase(state: GameState, activePlayerId: number): GameState {
  let newState = { ...state }
  const player = newState.players.find(p => p.id === activePlayerId)

  if (!player) {return state}

  console.log('[executePreparationPhase] Player', activePlayerId, 'autoDraw:', state.autoDrawEnabled, 'deckSize:', player.deck?.length || 0)

  // Auto-draw if enabled and deck has cards
  if (state.autoDrawEnabled && player.deck && player.deck.length > 0) {
    const drawnCard = player.deck.shift()
    if (drawnCard) {
      player.hand.push(drawnCard)
      player.handSize = player.hand.length
      player.deckSize = player.deck.length
      console.log('[executePreparationPhase] Player', activePlayerId, 'drew card, hand:', player.hand.length)
    }
  }

  // Check round end
  if (shouldRoundEnd(newState)) {
    newState = endRound(newState)
    return newState
  }

  // Transition to Setup
  newState.currentPhase = 1
  console.log('[executePreparationPhase] Transition to Setup phase for player', activePlayerId)

  // Recalculate ready statuses for new active player in Setup phase
  recalculateAllReadyStatuses(newState)

  return newState
}

// ============================================================================
// Card actions
// ============================================================================

/**
 * PLAY_CARD - play card from hand to board
 * Also supports direct card parameter for playing from deck/discard
 */
function handlePlayCard(state: GameState, playerId: number, data: any): GameState {
  const { card, cardIndex, boardCoords, faceDown = false, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || !boardCoords) {return state}

  // Check if target cell is already occupied - if so, do nothing
  const targetCell = state.board[boardCoords.row]?.[boardCoords.col]
  if (targetCell?.card) {
    // Cell is occupied, return state unchanged
    return state
  }

  let cardToPlay: Card | null = null
  let newHand = player.hand
  let newHandSize = player.hand.length
  let isFromHand = false  // Track if card comes from hand (not deck/discard)

  // If card is passed directly (from deck/discard), use it
  if (card) {
    cardToPlay = card
    // Hand remains unchanged when playing from deck/discard
    isFromHand = false
  } else {
    // Otherwise, get card from hand
    const cardIndexNum = cardIndex ?? player.hand.length - 1
    cardToPlay = player.hand[cardIndexNum]

    if (!cardToPlay) {return state}

    // Remove card from hand
    newHand = [...player.hand]
    newHand.splice(cardIndexNum, 1)
    newHandSize = newHand.length
    isFromHand = true
  }

  if (!cardToPlay) {return state}

  // LastPlayed status transfers to newly played cards (only one card has LastPlayed at a time)
  // This ensures the most recently played card is the one used for scoring
  // The status persists while the card is on the battlefield
  const boardWithoutLastPlayed = isFromHand ? state.board.map((row, _r) =>
    row.map((cell, _c) => {
      if (cell.card?.ownerId === actualPlayerId && cell.card?.statuses) {
        const filteredStatuses = cell.card.statuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))
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
  ) : state.board

  // Add card to board with LastPlayed status (only if from hand)
  const wasSetupPhase = state.currentPhase === 1
  const newBoard = boardWithoutLastPlayed.map((row, r) =>
    row.map((cell, c) => {
      if (r === boardCoords.row && c === boardCoords.col) {
        const existingStatuses = cardToPlay.statuses || []
        // Remove any existing LastPlayed status from this card (to avoid duplicates)
        const filteredStatuses = existingStatuses.filter((s: any) => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))

        // Add LastPlayed status only when card is played from hand
        // This status is used to determine if player can enter scoring phase
        let finalStatuses = isFromHand
          ? [...filteredStatuses, { type: 'LastPlayed', addedByPlayerId: actualPlayerId }]
          : filteredStatuses

        // SPECIAL CASE: If played during Setup phase and card has Setup ability,
        // add readySetup status so it can be used even after phase switches to Main
        // This allows cards like Finn to use their "Move 1 allied card" ability upon entering
        if (wasSetupPhase && !faceDown) {
          const cardDef = getCardDefinition(cardToPlay.baseId ?? '')
          if (cardDef && (cardDef as any).ABILITIES?.some((a: any) => a.type === 'setup')) {
            finalStatuses = [...finalStatuses, { type: 'readySetup', addedByPlayerId: actualPlayerId }]
            console.log('[handlePlayCard] Adding readySetup to Setup ability card played during Setup phase:', cardToPlay.baseId)
          }
        }

        const boardCard = {
          ...cardToPlay,
          ownerId: actualPlayerId,
          isFaceDown: faceDown,
          enteredThisTurn: true,
          statuses: finalStatuses
        }

        return {
          card: boardCard
        }
      }
      return cell
    })
  )

  // Add to boardHistory and update lastPlayedCardId only if from hand
  const newBoardHistory = isFromHand ? [...player.boardHistory, cardToPlay.id] : player.boardHistory
  const newLastPlayedCardId = isFromHand ? cardToPlay.id : player.lastPlayedCardId

  if (isFromHand) {
    console.log('[handlePlayCard] Card played from hand:', cardToPlay.id, 'newBoardHistory:', newBoardHistory, 'newLastPlayedCardId:', newLastPlayedCardId)
  } else {
    console.log('[handlePlayCard] Card NOT from hand (deck/discard):', cardToPlay.id, 'NOT adding to boardHistory')
  }

  // Update player
  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? {
          ...p,
          hand: newHand,
          handSize: newHandSize,
          boardHistory: newBoardHistory,
          lastPlayedCardId: newLastPlayedCardId
        }
      : p
  )

  // Switch to Main phase (2) - this should happen before ready status recalculation
  const newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    currentPhase: 2  // Main phase after playing card
  }

  // Clear scoring mode if somehow active
  newState.isScoringStep = false
  newState.scoringLines = []

  // Recalculate ready statuses AFTER phase switch
  // This ensures cards get correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  // Check and apply triggers when a card with Revealed status is played from hand
  // This handles the drag-and-drop case where ANNOUNCE_CARD is not used
  if (isFromHand && cardToPlay.statuses?.some((s: any) => s.type === 'Revealed')) {
    console.log('[handlePlayCard] Checking triggers for Revealed card played from hand:', cardToPlay.baseId)
    const triggerState = checkAndApplyTriggers(newState, cardToPlay, boardCoords, actualPlayerId, 'hand')
    return triggerState
  }

  return newState
}

/**
 * MOVE_CARD_ON_BOARD - move card from one cell to another
 */
function handleMoveCardOnBoard(state: GameState, _playerId: number, data: any): GameState {
  const { fromCoords, toCoords, faceDown } = data || {}

  if (!fromCoords || !toCoords) {return state}

  const fromRow = fromCoords.row
  const fromCol = fromCoords.col
  const toRow = toCoords.row
  const toCol = toCoords.col

  // Check boundaries
  const gridSize = state.activeGridSize
  if (fromRow < 0 || fromRow >= gridSize || fromCol < 0 || fromCol >= gridSize) {return state}
  if (toRow < 0 || toRow >= gridSize || toCol < 0 || toCol >= gridSize) {return state}

  // Check if source cell contains card
  const sourceCard = state.board[fromRow]?.[fromCol]?.card
  if (!sourceCard) {return state}

  // Check if target cell is empty
  const targetCell = state.board[toRow]?.[toCol]
  if (!targetCell || targetCell.card) {return state}

  // Move card
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      // Clear source cell
      if (r === fromRow && c === fromCol) {
        return { card: null }
      }
      // Place card in new cell
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
 * MOVE_CARD - move card
 */
function handleMoveCard(state: GameState, _playerId: number, _data: any): GameState {
  // TODO: implement card movement
  return state
}

/**
 * RETURN_CARD_TO_HAND - return card to hand
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
        const foundCard = cell.card
        if (foundCard) {
          cardToReturn = foundCard
          sourceCoords = { row: r, col: c }
          // Clear all statuses except Revealed and reset power when card leaves battlefield
          clearAllStatusesExceptRevealed(foundCard)
        }
        return { card: null }
      }
      return cell
    })
  )

  if (!cardToReturn || !sourceCoords) {return state}

  // Add to owner's hand
  // cardToReturn is non-null here due to the check above
  const finalCard: Card = cardToReturn
  const ownerId = finalCard.ownerId ?? playerId
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      return {
        ...p,
        hand: [...p.hand, finalCard],
        handSize: p.hand.length + 1
      }
    }
    return p
  })

  // Restore LastPlayed to previous card if this card had it
  let updatedState = { ...state, board: newBoard, players: newPlayers as Player[] }
  updatedState = restoreLastPlayedToPreviousCard(updatedState, finalCard, ownerId)

  return updatedState
}

/**
 * MOVE_CARD_TO_HAND - move card from board/discard/deck to hand
 */
function handleMoveCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source, cardIndex: dataCardIndex, playerId: dataPlayerId } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  let targetPlayerId = dataPlayerId ?? playerId
  let sourcePlayerId: number | undefined = undefined // Track source player separately
  let newBoard = state.board
  let newDiscard: Card[] | null = null
  let newDeck: Card[] | null = null
  let newState = state
  let cardFromBoard: Card | null = null // Track if card came from board for LastPlayed restoration
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            sourcePlayerId = foundCard.ownerId || playerId
            // Clear ALL statuses including Revealed when card leaves battlefield to hand
            clearAllStatuses(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'discard') {
    // Use data.playerId if provided, otherwise fall back to sender's playerId
    sourcePlayerId = dataPlayerId ?? playerId
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    const idx = player.discard?.findIndex(c => c.id === cardId)
    if (idx === undefined || idx === -1) {return state}
    cardToMove = player.discard[idx]
    targetPlayerId = sourcePlayerId
    newDiscard = [...player.discard]
    newDiscard.splice(idx, 1)
    // Clear ALL statuses including Revealed when card moves from discard to hand
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    // Use data.playerId if provided, otherwise fall back to sender's playerId
    sourcePlayerId = dataPlayerId ?? playerId
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player || !player.deck) {return state}
    // For deck, use cardIndex if provided, otherwise find by cardId
    let idx = dataCardIndex
    if (idx === undefined) {
      idx = player.deck.findIndex(c => c.id === cardId)
    }
    if (idx === undefined || idx === -1) {return state}
    cardToMove = player.deck[idx]
    targetPlayerId = sourcePlayerId
    // Update player deck by removing card
    newDeck = [...player.deck]
    newDeck.splice(idx, 1)
    // Update players array with new deck
    const playersWithUpdatedDeck = newState.players.map(p =>
      p.id === sourcePlayerId ? { ...p, deck: newDeck!, deckSize: newDeck!.length } : p
    )
    newState = { ...newState, players: playersWithUpdatedDeck as Player[] }
    // Clear ALL statuses including Revealed when card moves from deck to hand
    clearAllStatuses(cardToMove)
  }

  if (!cardToMove) {return newState}

  // If card is a token, destroy it instead of adding to hand
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    // Still restore LastPlayed if token had it
    let resultState = { ...newState, board: newBoard, players: newState.players.map(p => {
      // Update discard for the source player
      if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
        return { ...p, discard: newDiscard, discardSize: newDiscard.length }
      }
      return p
    })}
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = newState.players.map(p => {
    // Update hand for the target player
    if (p.id === targetPlayerId) {
      const newHand = [...p.hand, cardToMove]
      const updates: any = { hand: newHand, handSize: newHand.length }
      // Also update discard if source and target are the same player
      if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
        updates.discard = newDiscard
        updates.discardSize = newDiscard.length
      }
      return { ...p, ...updates }
    }
    // Update discard for the source player (different from target player)
    if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
      return { ...p, discard: newDiscard, discardSize: newDiscard.length }
    }
    return p
  })

  let resultState = { ...newState, board: newBoard, players: newPlayers as Player[] }
  // Restore LastPlayed if card came from board
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_CARD_TO_DECK - move card from board/hand/discard to deck
 */
function handleMoveCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardId, cardIndex, source, playerId: dataPlayerId } = data || {}
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  const sourcePlayerId = dataPlayerId ?? playerId
  let cardToMove: Card | null = null
  let targetPlayerId = sourcePlayerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDiscard: Card[] | null = null
  let cardFromBoard: Card | null = null
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    if (!cardId) {return state}
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            // Clear ALL statuses including Revealed when card leaves battlefield to deck/discard
            clearAllStatuses(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.hand?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.hand?.length || 0)) {return state}
    cardToMove = player.hand[idx]
    targetPlayerId = sourcePlayerId
    newHand = [...player.hand]
    newHand.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to deck
    clearAllStatuses(cardToMove)
  } else if (source === 'discard') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.discard?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.discard?.length || 0)) {return state}
    cardToMove = player.discard[idx]
    targetPlayerId = sourcePlayerId
    newDiscard = [...player.discard]
    newDiscard.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to deck
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    // Moving from deck to deck (should be a no-op or reorder, but handle it)
    return state
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    let resultState = { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === sourcePlayerId) {
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
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const updates: any = {}
      // Add card to deck
      const newDeck = [cardToMove, ...(p.deck || [])]
      updates.deck = newDeck
      updates.deckSize = newDeck.length

      // If source and target are the same player, also update source arrays
      if (p.id === sourcePlayerId) {
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDiscard !== null) {
          updates.discard = newDiscard
          updates.discardSize = newDiscard.length
        }
      }
      return { ...p, ...updates }
    }
    if (p.id === sourcePlayerId && p.id !== targetPlayerId) {
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

  let resultState = { ...state, board: newBoard, players: newPlayers as Player[] }
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_CARD_TO_DISCARD - move card from board/hand/deck to discard
 */
function handleMoveCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardId, cardIndex, source, playerId: dataPlayerId } = data || {}
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  const sourcePlayerId = dataPlayerId ?? playerId
  let cardToMove: Card | null = null
  let targetPlayerId = sourcePlayerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDeck: Card[] | null = null
  let cardFromBoard: Card | null = null
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    if (!cardId) {return state}
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            // Clear ALL statuses including Revealed when card leaves battlefield to deck/discard
            clearAllStatuses(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.hand?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.hand?.length || 0)) {return state}
    cardToMove = player.hand[idx]
    targetPlayerId = sourcePlayerId
    newHand = [...player.hand]
    newHand.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to discard
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.deck?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.deck?.length || 0)) {return state}
    cardToMove = player.deck[idx]
    targetPlayerId = sourcePlayerId
    newDeck = [...player.deck]
    newDeck.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to discard
    clearAllStatuses(cardToMove)
  } else if (source === 'discard') {
    // Moving from discard to discard (should be a no-op or reorder, but handle it)
    return state
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    let resultState = { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === sourcePlayerId) {
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
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const updates: any = {}
      // Add card to discard
      const newDiscard = [...(p.discard || []), cardToMove]
      updates.discard = newDiscard
      updates.discardSize = newDiscard.length

      // If source and target are the same player, also update source arrays
      if (p.id === sourcePlayerId) {
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDeck !== null) {
          updates.deck = newDeck
          updates.deckSize = newDeck.length
        }
      }
      return { ...p, ...updates }
    }
    if (p.id === sourcePlayerId && p.id !== targetPlayerId) {
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

  let resultState = { ...state, board: newBoard, players: newPlayers as Player[] }
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_HAND_CARD_TO_DECK - move card from hand to deck
 */
function handleMoveHandCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, hand: newHand, handSize: newHand.length }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to deck
  clearAllStatuses(cardToMove)

  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_HAND_CARD_TO_DISCARD - move card from hand to discard
 */
function handleMoveHandCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, hand: newHand, handSize: newHand.length }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to discard
  clearAllStatuses(cardToMove)

  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, discard: newDiscard, discardSize: newDiscard.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_HAND - move card from showcase to hand
 */
function handleMoveAnnouncedToHand(state: GameState, playerId: number, data: any): GameState {
  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to hand
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  const newHand = [...player.hand, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DECK - move card from showcase to deck
 */
function handleMoveAnnouncedToDeck(state: GameState, playerId: number, data: any): GameState {
  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to deck
  clearAllStatuses(cardToMove)

  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, deck: newDeck, deckSize: newDeck.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DISCARD - move card from showcase to discard
 */
function handleMoveAnnouncedToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to discard
  clearAllStatuses(cardToMove)

  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, discard: newDiscard, discardSize: newDiscard.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * PLAY_ANNOUNCED_TO_BOARD - play card from showcase to battlefield
 */
function handlePlayAnnouncedToBoard(state: GameState, playerId: number, data: any): GameState {
  const { row, col, faceDown = false, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || !player.announcedCard) {return state}
  if (row === undefined || col === undefined) {return state}
  if (row < 0 || row >= state.activeGridSize || col < 0 || col >= state.activeGridSize) {return state}

  // Check if cell is empty
  if (state.board[row]?.[col]?.card) {return state}

  const cardToPlay = { ...player.announcedCard, ownerId: actualPlayerId, isFaceDown: faceDown }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: cardToPlay }
      }
      return cell
    })
  )

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, announcedCard: null }
      : p
  )

  // Switch to Main phase (2) if currently in Setup phase (1)
  // This matches the behavior of playing cards from hand
  const wasSetupPhase = state.currentPhase === 1
  const wasFaceDown = faceDown

  // Check if card has Setup ability before creating final board state
  const cardDef = getCardDefinition(cardToPlay.baseId ?? '')
  const cardHasSetupAbility = cardDef && (cardDef as any).ABILITIES?.some((a: any) => a.type === 'setup')

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers as Player[]
  }

  if (wasSetupPhase) {
    newState.currentPhase = 2
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []

    // If card has Setup ability and is not face-down, add readySetup status
    if (cardHasSetupAbility && !wasFaceDown) {
      newState = {
        ...newState,
        board: newState.board.map((r, rIdx) =>
          r.map((cell, cIdx) => {
            if (rIdx === row && cIdx === col && cell.card) {
              return {
                card: {
                  ...cell.card,
                  statuses: [...(cell.card.statuses || []), { type: 'readySetup', addedByPlayerId: actualPlayerId }]
                }
              }
            }
            return cell
          })
        )
      }
      console.log('[handlePlayAnnouncedToBoard] Adding readySetup to Setup ability card played during Setup phase:', cardToPlay.baseId)
    }
  }

  // Recalculate ready statuses AFTER phase switch
  // This ensures cards get correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  return newState
}

/**
 * ANNOUNCE_CARD - announce card
 * If player already has an announced card, they are swapped:
 * - The existing announced card returns to player's hand
 * - The new card from hand becomes the announced card
 */
function handleAnnounceCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined) {return state}

  // Get the card to announce from the original hand (before any modifications)
  const cardToAnnounce = player.hand[cardIndex]
  if (!cardToAnnounce) {return state}

  // Build new hand array
  // If there's an existing announced card, add it to the end of hand first
  const existingAnnouncedCard = player.announcedCard
  let newHand = [...player.hand]
  if (existingAnnouncedCard) {
    newHand = [...newHand, existingAnnouncedCard]
  }
  // Remove the card being announced from hand
  newHand.splice(cardIndex, 1)

  // Announced card does NOT get LastPlayed status
  // (LastPlayed is only for cards that enter the battlefield, not showcase)
  // Remove any existing LastPlayed status from this card
  const existingStatuses = cardToAnnounce.statuses || []
  const filteredStatuses = existingStatuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))
  const announcedCard = {
    ...cardToAnnounce,
    statuses: filteredStatuses
  }

  const newPlayers = state.players.map(p => {
    if (p.id === actualPlayerId) {
      return {
        ...p,
        hand: newHand,
        handSize: newHand.length,
        announcedCard: announcedCard
        // Do NOT update boardHistory or lastPlayedCardId - card hasn't entered battlefield yet
      }
    }
    return p
  })

  let newState = { ...state, players: newPlayers }

  // Check and apply triggers when a card is announced (played)
  // This is where Vigilant Spotter trigger should fire - when opponent plays a revealed card
  console.log('[handleAnnounceCard] Checking triggers for announced card:', announcedCard.baseId, 'statuses:', announcedCard.statuses)
  newState = checkAndApplyTriggers(newState, announcedCard, { row: -1, col: -1 }, actualPlayerId, 'hand')

  return newState
}

/**
 * DESTROY_CARD - destroy card
 */
function handleDestroyCard(state: GameState, _playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) {return state}

  let destroyedCard: Card | null = null
  let ownerId: number | null = null
  let originalStatuses: CardStatus[] = [] // Save original statuses before clearing

  const newBoard = state.board.map((row, _r) =>
    row.map((cell, _c) => {
      if (cell.card?.id === cardId) {
        const foundCard = cell.card
        if (foundCard) {
          destroyedCard = foundCard
          ownerId = foundCard.ownerId ?? null
          // Save original statuses BEFORE clearing
          originalStatuses = [...(foundCard.statuses || [])]
        }
        return { card: null }
      }
      return cell
    })
  )

  if (!destroyedCard || !ownerId) {return state}

  // Clear all statuses except Revealed when card is destroyed and goes to discard
  // This allows deploy ability to be used again when card returns to battlefield
  clearAllStatusesExceptRevealed(destroyedCard)

  // Add to owner's discard
  let updatedState = {
    ...state,
    board: newBoard,
    players: state.players.map(p => {
      if (p.id === ownerId) {
        return {
          ...p,
          discard: [...p.discard, destroyedCard],
          discardSize: p.discard.length + 1
        }
      }
      return p
    })
  }

  // Restore LastPlayed to previous card if destroyed card had it
  // Use the card with original statuses (before clearing)
  if (destroyedCard) {
    const card: Card = destroyedCard
    const cardWithOriginalStatuses = { ...card, statuses: originalStatuses }
    updatedState = restoreLastPlayedToPreviousCard(updatedState as any, cardWithOriginalStatuses, ownerId ?? 0)
  }

  return updatedState as any
}

/**
 * SWAP_CARDS - swap positions of two cards on board
 */
function handleSwapCards(state: GameState, _playerId: number, data?: any): GameState {
  const { coords1, coords2 } = data || {}

  if (!coords1 || !coords2) { return state }

  const { row: r1, col: c1 } = coords1
  const { row: r2, col: c2 } = coords2

  // Check bounds
  if (r1 < 0 || r1 >= state.board.length || c1 < 0 || c1 >= state.board[0].length ||
      r2 < 0 || r2 >= state.board.length || c2 < 0 || c2 >= state.board[0].length) {
    return state
  }

  const card1 = state.board[r1][c1].card
  const card2 = state.board[r2][c2].card

  // Both cells must have cards
  if (!card1 || !card2) { return state }

  // Create new board with swapped cards
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (r === r1 && c === c1) {
        return { card: card2 }
      }
      if (r === r2 && c === c2) {
        return { card: card1 }
      }
      return cell
    })
  )

  console.log('[handleSwapCards] Swapped cards at', coords1, 'and', coords2)

  return {
    ...state,
    board: newBoard
  }
}

/**
 * SPAWN_TOKEN - spawn a token card on the board
 * Special case: Resurrection is added as a status to existing card (Immunis Deploy)
 */
function handleSpawnToken(state: GameState, _playerId: number, data?: any): GameState {
  const { coords, tokenName, ownerId } = data || {}

  if (!coords || !tokenName || ownerId === undefined) { return state }

  const { row, col } = coords

  // Check bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[0].length) {
    return state
  }

  // Special case: Resurrection is a status, not a token card (for Immunis Deploy)
  if (tokenName === 'Resurrection') {
    const cell = state.board[row][col]
    if (!cell.card) { return state } // Must have a card to add status to

    const newBoard = state.board.map((r, rIdx) =>
      r.map((cell, cIdx) => {
        if (rIdx === row && cIdx === col && cell.card) {
          return {
            card: {
              ...cell.card,
              statuses: [...(cell.card.statuses || []), {
                type: 'Resurrection',
                                        addedByPlayerId: ownerId
                                      }]
            }
          }
        }
        return cell
      })
    )

    console.log('[handleSpawnToken] Added Resurrection status to card at', coords)

    // Recalculate ready statuses
    const newState = { ...state, board: newBoard }
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Check if cell is empty (for regular token cards)
  if (state.board[row][col].card) { return state }

  // Use tokenData if provided, otherwise create basic token
  const tokenData = data?.tokenData
  const tokenCard: Card = {
    id: `token_${Date.now()}_${Math.random()}`,
    baseId: tokenName,
    name: tokenData?.name || tokenName,
    deck: 'Tokens' as DeckType,
    types: tokenData?.types || ['Token'],
    power: tokenData?.power ?? 1,
    abilityText: tokenData?.abilityText || '',
    imageUrl: tokenData?.imageUrl || '',
    fallbackImage: tokenData?.fallbackImage || '',
    ownerId,
    statuses: [],
    enteredThisTurn: false
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: tokenCard } as any
      }
      return cell
    })
  )

  // Switch to Main phase (2) if currently in Setup phase (1)
  // This matches the behavior of playing cards from hand
  const wasSetupPhase = state.currentPhase === 1

  // Check if token has Setup ability before creating final board state
  const tokenDef = getCardDefinition(tokenName)
  const tokenHasSetupAbility = tokenDef && (tokenDef as any).ABILITIES?.some((a: any) => a.type === 'setup')

  let newState: GameState = {
    ...state,
    board: newBoard
  }

  if (wasSetupPhase) {
    newState.currentPhase = 2
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []

    // If token has Setup ability, add readySetup status
    if (tokenHasSetupAbility) {
      newState = {
        ...newState,
        board: newState.board.map((r, rIdx) =>
          r.map((cell, cIdx) => {
            if (rIdx === row && cIdx === col && cell.card) {
              return {
                card: {
                  ...cell.card,
                  statuses: [...(cell.card.statuses || []), { type: 'readySetup', addedByPlayerId: ownerId }]
                }
              }
            }
            return cell
          })
        )
      }
      console.log('[handleSpawnToken] Adding readySetup to Setup ability token spawned during Setup phase:', tokenName)
    }
  }

  console.log('[handleSpawnToken] Spawned', tokenName, 'at', coords, 'for owner', ownerId, 'phase', newState.currentPhase)

  // Recalculate ready statuses for all cards AFTER phase switch
  // This ensures the token gets correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  return newState
}

/**
 * RESURRECT_DISCARDED - return a card from discard pile to board (Immunis Deploy)
 * Takes a card from discard and places it on the board at specified coordinates.
 * The card will then receive a token via SPAWN_TOKEN.
 */
function handleResurrectDiscarded(state: GameState, _playerId: number, data?: any): GameState {
  const { cardOwnerId, cardIndex, boardCoords } = data || {}

  if (cardOwnerId === undefined || cardIndex === undefined || !boardCoords) {
    return state
  }

  const { row, col } = boardCoords

  // Check bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[0].length) {
    return state
  }

  // Check if cell is empty
  if (state.board[row][col].card) {
    return state
  }

  // Find the player and their discard pile
  const player = state.players.find(p => p.id === cardOwnerId)
  if (!player || !player.discard || cardIndex < 0 || cardIndex >= player.discard.length) {
    return state
  }

  // Get the card to resurrect
  const cardToResurrect = player.discard[cardIndex]

  // Create the card for the board
  const boardCard: Card = {
    ...cardToResurrect,
    id: `resurrected_${cardToResurrect.id}_${Date.now()}`, // New ID to avoid conflicts
    ownerId: cardOwnerId,
    enteredThisTurn: false
  }

  // Remove card from discard
  const newDiscard = [...player.discard]
  newDiscard.splice(cardIndex, 1)

  // Place card on board
  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: boardCard }
      }
      return cell
    })
  )

  // Update player's discard
  const newPlayers = state.players.map(p =>
    p.id === cardOwnerId
      ? { ...p, discard: newDiscard, discardSize: newDiscard.length }
      : p
  )

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers
  }

  // Switch to Main phase (2) if currently in Setup phase (1)
  const wasSetupPhase = state.currentPhase === 1
  if (wasSetupPhase) {
    newState = {
      ...newState,
      currentPhase: 2
    }
  }

  console.log('[handleResurrectDiscarded] Resurrected', boardCard.name, 'from discard to', boardCoords)

  // Recalculate ready statuses
  recalculateAllReadyStatuses(newState)

  return newState
}

// ============================================================================
// Deck control
// ============================================================================

/**
 * DRAW_CARD - draw card from deck
 */
function handleDrawCard(state: GameState, playerId: number, data?: any): GameState {
  // Use targetPlayerId if specified (for drawing cards for dummy players)
  // Otherwise use the playerId of who sent the action
  const targetPlayerId = data?.targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player || !player.deck || player.deck.length === 0) {return state}

  const newDeck = [...player.deck]
  const card = newDeck.shift()

  if (!card) {return state}

  const newPlayers = state.players.map(p =>
    p.id === targetPlayerId
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
 * SHUFFLE_DECK - shuffle deck
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
// Score and player status
// ============================================================================

/**
 * UPDATE_SCORE - update player score
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
 * CHANGE_PLAYER_NAME - change player name
 */
function handleChangePlayerName(state: GameState, playerId: number, name: string): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, name } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_COLOR - change player color
 */
function handleChangePlayerColor(state: GameState, playerId: number, color: any): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, color } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_DECK - change player deck
 * Creates new deck of selected type
 */
function handleChangePlayerDeck(state: GameState, playerId: number, deckType: DeckType): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return state}

  // Create new deck
  const newDeck = createDeck(deckType, playerId, player.name)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, selectedDeck: deckType, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  console.log(`[SimpleGameLogic] Player ${playerId} changed deck to ${deckType}, ${newDeck.length} cards`)

  return { ...state, players: newPlayers }
}
/**
 * MARK_ABILITY_USED - mark ability as used
 * Removes ready status, adds usage marker, and updates ready statuses for phase-specific abilities
 */
function handleMarkAbilityUsed(state: GameState, data: any): GameState {
  const { coords, isDeploy, readyStatusToRemove } = data || {}
  if (!coords) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cardBaseId = state.board[row]?.[col]?.card?.baseId
  console.log('[handleMarkAbilityUsed] Processing:', { coords, isDeploy, readyStatusToRemove, cardBaseId })

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newCard = { ...cell.card }
        if (!newCard.statuses) {newCard.statuses = []}

        console.log('[handleMarkAbilityUsed] Current statuses before:', newCard.statuses.map(s => s.type))

        // Remove the ready status
        if (readyStatusToRemove) {
          const beforeCount = newCard.statuses.length
          newCard.statuses = newCard.statuses.filter(s => s.type !== readyStatusToRemove)
          console.log('[handleMarkAbilityUsed] Removed', readyStatusToRemove, 'status count:', beforeCount, '->', newCard.statuses.length)
        }

        // Mark ability as used based on type
        if (isDeploy) {
          // Deploy: mark as used (persists until card leaves battlefield)
          const deployUsedStatus = 'deployUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === deployUsedStatus)) {
            newCard.statuses.push({ type: deployUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added deployUsedThisTurn to card:', newCard.baseId)
          }

          // After Deploy is used, check if card has phase-specific ability for current phase
          // E.g., Walking Turret uses Deploy in Setup phase, then gets Setup status
          const abilityInfo = getCardAbilityInfo(newCard)
          const { hasSetupAbility, hasCommitAbility } = abilityInfo

          if (state.currentPhase === 1 && hasSetupAbility) {
            // Add Setup status after Deploy is used
            newCard.statuses.push({ type: READY_STATUS.SETUP, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added readySetup after Deploy to card:', newCard.baseId)
          } else if (state.currentPhase === 3 && hasCommitAbility) {
            // Add Commit status after Deploy is used
            newCard.statuses.push({ type: READY_STATUS.COMMIT, addedByPlayerId: newCard.ownerId || 0 })
            console.log('[handleMarkAbilityUsed] Added readyCommit after Deploy to card:', newCard.baseId)
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
          } else {
            console.log('[handleMarkAbilityUsed] commitUsedThisTurn already exists on card:', newCard.baseId)
          }
        }

        console.log('[handleMarkAbilityUsed] Final statuses:', newCard.statuses.map(s => s.type))
        return { ...cell, card: newCard }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * REMOVE_ALL_COUNTERS_BY_TYPE - remove all counters/statuses of specific type from card
 */
function handleRemoveAllCountersByType(state: GameState, data: any): GameState {
  const { coords, type } = data || {}
  if (!coords || !type) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const targetCard = cell.card
  const hadSupport = targetCard.statuses?.some(s => s.type === 'Support') ?? false

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newStatuses = cell.card.statuses?.filter(s => s.type !== type) || []
        const newCard = { ...cell.card, statuses: newStatuses }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  const newState = { ...state, board: newBoard }

  // If Support status was removed, recalculate ready statuses for this card
  if (type === 'Support' && hadSupport) {
    const newCard = newBoard[row][col].card
    if (newCard) {
      recheckReadyStatuses(newCard, newState)
    }
  }

  return newState
}

/**
 * REMOVE_COUNTER_BY_TYPE - remove counter/status of specific type added by specific owner from card
 * Used by Censor Commit to remove Exploit counters from specific player
 */
function handleRemoveCounterByType(state: GameState, data: any): GameState {
  const { coords, type, ownerId } = data || {}
  if (!coords || !type || ownerId === undefined) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const targetCard = cell.card
  const hadSupport = targetCard.statuses?.some(s => s.type === 'Support') ?? false

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        // Filter out statuses that match both type AND ownerId
        const newStatuses = cell.card.statuses?.filter(s => !(s.type === type && (s as any).addedByPlayerId === ownerId)) || []
        const newCard = { ...cell.card, statuses: newStatuses }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  const newState = { ...state, board: newBoard }

  // If Support status was removed, recalculate ready statuses for this card
  if (type === 'Support' && hadSupport) {
    const newCard = newBoard[row][col].card
    if (newCard) {
      recheckReadyStatuses(newCard, newState)
    }
  }

  return newState
}

/**
 * MODIFY_CARD_POWER - modify power of a card on the battlefield
 * Used by Walking Turret Setup and other MODIFY_POWER abilities
 */
function handleModifyCardPower(state: GameState, data: any): GameState {
  const { coords, delta } = data || {}
  if (!coords || delta === undefined) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const currentPowerModifier = cell.card.powerModifier || 0
        const newCard = { ...cell.card, powerModifier: currentPowerModifier + delta }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_CARD_FROM_DECK - play top card from deck to battlefield
 */
function handlePlayCardFromDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.deck || player.deck.length === 0) {return state}

  // Get the card to play (top card from deck by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : 0
  const cardToPlay = player.deck[indexToPlay]
  if (!cardToPlay) {return state}

  // Remove card from deck
  const newDeck = [...player.deck]
  newDeck.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    deck: newDeck,
    deckSize: newDeck.length
  }

  const newPlayers = state.players.map(p => p.id === actualPlayerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, actualPlayerId, { card: cardToPlay, boardCoords, faceDown })
}

/**
 * PLAY_CARD_FROM_DISCARD - play card from discard to battlefield
 */
function handlePlayCardFromDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.discard || player.discard.length === 0) {return state}

  // Get the card to play (top card from discard by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : player.discard.length - 1
  const cardToPlay = player.discard[indexToPlay]
  if (!cardToPlay) {return state}

  // Remove card from discard
  const newDiscard = [...player.discard]
  newDiscard.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    discard: newDiscard,
    discardSize: newDiscard.length
  }

  const newPlayers = state.players.map(p => p.id === actualPlayerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, actualPlayerId, { card: cardToPlay, boardCoords, faceDown })
}

/**
 * ADD_STATUS_TO_BOARD_CARD - add status (token) to card on battlefield
 * Supports token stacking: up to 99 tokens of same type can be added
 * Exception: singleton statuses (Threat, Support, Revealed) remain single
 * Supports count parameter for placing multiple tokens at once
 */
function handleAddStatusToBoardCard(state: GameState, _playerId: number, data: any): GameState {
  const { boardCoords, statusType, ownerId, replaceStatusType, count = 1 } = data || {}
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

  // Singleton statuses that cannot stack (only one instance allowed per owner)
  const SINGLETON_STATUSES = ['Threat', 'Support', 'Revealed']

  // Check if this is a singleton status
  const isSingletonStatus = SINGLETON_STATUSES.includes(statusType)

  if (isSingletonStatus) {
    // For singleton statuses, check if this owner already has this status on the card
    const alreadyHasStatus = filteredStatuses.some(s => s.type === statusType && s.addedByPlayerId === ownerId)
    if (alreadyHasStatus) {
      // Card already has this singleton status from this owner - don't add another
      logger.info(`[handleAddStatusToBoardCard] Blocked duplicate ${statusType} from player ${ownerId} on card at [${row},${col}]`)
      return state
    }
  }

  // Add the new status(es) - supports count parameter for placing multiple tokens at once
  let newStatuses = [...filteredStatuses]
  const MAX_TOKENS_PER_TYPE = 99

  for (let i = 0; i < count; i++) {
    if (isSingletonStatus) {
      // For singleton, only add if not already present (checked above)
      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
      break // Only add one for singleton statuses
    } else {
      // For stackable tokens, count existing tokens of this type from this owner
      const existingTokenCount = newStatuses.filter(s => s.type === statusType && s.addedByPlayerId === ownerId).length

      if (existingTokenCount >= MAX_TOKENS_PER_TYPE) {
        // Already at max capacity, don't add more
        logger.info(`[handleAddStatusToBoardCard] Max capacity (${MAX_TOKENS_PER_TYPE}) reached for ${statusType} on card at [${row},${col}]`)
        break
      }

      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
    }
  }

  logger.info(`[handleAddStatusToBoardCard] Adding ${count}x ${statusType} from player ${ownerId} to card at [${row},${col}]. Total statuses: ${newStatuses.length}`)

  // If adding Revealed status, the card becomes visible to the token owner
  let revealedTo = targetCard.revealedTo
  if (statusType === 'Revealed') {
    const currentRevealed = Array.isArray(revealedTo) ? revealedTo : []
    if (!currentRevealed.includes(ownerId)) {
      revealedTo = [...currentRevealed, ownerId]
    }
  }

  const newCard = {
    ...targetCard,
    statuses: newStatuses,
    revealedTo
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: newCard }
      }
      return c
    })
  )

  let newState = { ...state, board: newBoard }

  // If Support status was added/removed, recalculate ready statuses for this card
  // This handles abilities that require Support (like Inventive Maker's Setup)
  if (statusType === 'Support' || replaceStatusType === 'Support') {
    recheckReadyStatuses(newCard, newState)
    // Get the updated card from the board after recheckReadyStatuses modified it
    const updatedCard = newState.board[row][col].card
    if (updatedCard !== newCard) {
      // Card was modified, update the board again
      newState = { ...newState, board: newState.board.map((r, rIdx) =>
        r.map((c, cIdx) => {
          if (rIdx === row && cIdx === col) {
            return c
          }
          return c
        })
      )}
    }
  }

  return newState
}

/**
 * ADD_STATUS_TO_HAND_CARD - add status (token) to card in hand
 * Used for Revealed token placement on opponent/dummy hand cards
 * Supports singleton statuses (Threat, Support, Revealed) - only one per owner
 */
function handleAddStatusToHandCard(state: GameState, _playerId: number, data: any): GameState {
  const { playerId, cardIndex, statusType, ownerId, count = 1 } = data || {}
  if (playerId === undefined || cardIndex === undefined || !statusType || ownerId === undefined) {
    return state
  }

  // Find the target player
  const targetPlayer = state.players.find(p => p.id === playerId)
  if (!targetPlayer) {
    return state
  }

  // Check if card exists at index
  if (cardIndex < 0 || cardIndex >= targetPlayer.hand.length) {
    return state
  }

  const targetCard = targetPlayer.hand[cardIndex]
  if (!targetCard) {
    return state
  }

  const existingStatuses = targetCard.statuses || []

  // Singleton statuses that cannot stack (only one instance allowed per owner)
  const SINGLETON_STATUSES = ['Threat', 'Support', 'Revealed']

  // Check if this is a singleton status
  const isSingletonStatus = SINGLETON_STATUSES.includes(statusType)

  if (isSingletonStatus) {
    // For singleton statuses, check if this owner already has this status on the card
    const alreadyHasStatus = existingStatuses.some(s => s.type === statusType && s.addedByPlayerId === ownerId)
    if (alreadyHasStatus) {
      // Card already has this singleton status from this owner - don't add another
      logger.info(`[handleAddStatusToHandCard] Blocked duplicate ${statusType} from player ${ownerId} on card at index ${cardIndex}`)
      return state
    }
  }

  // Add the new status
  let newStatuses = [...existingStatuses]

  if (isSingletonStatus) {
    // For singleton, only add one
    const newStatus = { type: statusType, addedByPlayerId: ownerId }
    newStatuses = [...newStatuses, newStatus]
  } else {
    // For stackable tokens, add count tokens
    for (let i = 0; i < count; i++) {
      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
    }
  }

  logger.info(`[handleAddStatusToHandCard] Adding ${count}x ${statusType} from player ${ownerId} to player ${playerId} card at index ${cardIndex}`)

  // If adding Revealed status, the card becomes visible to the token owner
  let revealedTo = targetCard.revealedTo
  if (statusType === 'Revealed') {
    const currentRevealed = Array.isArray(revealedTo) ? revealedTo : []
    if (!currentRevealed.includes(ownerId)) {
      revealedTo = [...currentRevealed, ownerId]
      logger.info(`[handleAddStatusToHandCard] Setting revealedTo for card ${targetCard.id}: ${JSON.stringify(revealedTo)}`)
    }
  }

  const newCard = {
    ...targetCard,
    statuses: newStatuses,
    revealedTo
  }

  // Update player's hand
  const newHand = [...targetPlayer.hand]
  newHand[cardIndex] = newCard

  const newPlayers = state.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p)

  return { ...state, players: newPlayers }
}

/**
 * TRANSFER_ALL_STATUSES - transfer all statuses from one card to another
 * Used by Reckless Provocateur Commit
 * fromCoords: source card (has tokens to transfer)
 * toCoords: destination card (receives all tokens)
 */
function handleTransferAllStatuses(state: GameState, _playerId: number, data: any): GameState {
  const { fromCoords, toCoords } = data || {}
  if (!fromCoords || !toCoords) {
    return state
  }

  const { row: fromRow, col: fromCol } = fromCoords
  const { row: toRow, col: toCol } = toCoords

  // Validate bounds
  if (fromRow === undefined || fromCol === undefined || toRow === undefined || toCol === undefined) {
    return state
  }
  if (fromRow < 0 || fromRow >= state.board.length || fromCol < 0 || fromCol >= state.board[fromRow]?.length) {
    return state
  }
  if (toRow < 0 || toRow >= state.board.length || toCol < 0 || toCol >= state.board[toRow]?.length) {
    return state
  }

  const fromCell = state.board[fromRow][fromCol]
  const toCell = state.board[toRow][toCol]

  if (!fromCell.card || !toCell.card) {
    return state
  }

  const fromCard = fromCell.card
  const toCard = toCell.card

  // Get all statuses from source card
  const statusesToTransfer = fromCard.statuses || []

  if (statusesToTransfer.length === 0) {
    logger.info('[handleTransferAllStatuses] No statuses to transfer')
    return state
  }

  logger.info(`[handleTransferAllStatuses] Transferring ${statusesToTransfer.length} statuses from card ${fromCard.id} to ${toCard.id}`)

  // Add all statuses to destination card
  const newToCardStatuses = [...(toCard.statuses || []), ...statusesToTransfer]

  // Clear all statuses from source card
  const newFromCardStatuses: any[] = []

  // Update both cards
  const newBoard = state.board.map((row, rIdx) =>
    row.map((cell, cIdx) => {
      if (rIdx === fromRow && cIdx === fromCol) {
        return {
          ...cell,
          card: {
            ...fromCard,
            statuses: newFromCardStatuses
          }
        }
      }
      if (rIdx === toRow && cIdx === toCol) {
        return {
          ...cell,
          card: {
            ...toCard,
            statuses: newToCardStatuses
          }
        }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_TOKEN_CARD - place token card on battlefield
 * Token is NOT removed from panel (can be used multiple times)
 * Owner = player who placed it (or dummy if active)
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
    id: `token_${Date.now()}_${row}_${col}_${Math.random().toString(36).substring(2, 11)}`,
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

/**
 * FLIP_CARD - flip a card face-up or face-down on the battlefield
 *
 * When flipping face-up:
 * - Card immediately receives readyDeploy status if it has a deploy ability
 * - Card starts receiving ready statuses in future updates
 *
 * When flipping face-down:
 * - Card loses all ready statuses (handled by updateCardReadyStatuses)
 * - Card stops receiving ready statuses until flipped face-up again
 */
function handleFlipCard(state: GameState, _playerId: number, data: any): GameState {
  const { boardCoords, faceDown } = data || {}
  if (!boardCoords || faceDown === undefined) {
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

  // Create new card with flipped isFaceDown value
  const targetCard = cell.card
  let newCard = {
    ...targetCard,
    isFaceDown: faceDown
  }

  // When flipping face-up, immediately add readyDeploy if card has deploy ability
  if (!faceDown && targetCard.ownerId !== undefined) {
    const abilityInfo = getCardAbilityInfo(targetCard)

    if (abilityInfo.hasDeployAbility && targetCard.statuses) {
      // Check if deploy ability hasn't been used yet
      const deployAlreadyUsed = targetCard.statuses.some(
        (s: any) => s.type === 'deployUsedThisTurn'
      )

      if (!deployAlreadyUsed) {
        // Add readyDeploy status
        if (!targetCard.statuses.some((s: any) => s.type === READY_STATUS.DEPLOY)) {
          newCard = {
            ...newCard,
            statuses: [
              ...(newCard.statuses || []),
              { type: READY_STATUS.DEPLOY, addedByPlayerId: targetCard.ownerId }
            ]
          }
          logger.info(`[handleFlipCard] Added readyDeploy to flipped card at [${row},${col}]`)
        }
      }
    }
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: newCard }
      }
      return c
    })
  )

  logger.info(`[handleFlipCard] Flipped card at [${row},${col}] to faceDown=${faceDown}`)
  return { ...state, board: newBoard }
}

/**
 * REORDER_CARDS - Reorder cards in a player's deck or discard
 * Used by DeckViewModal when player drags cards to reorder them
 */
function handleReorderCards(state: GameState, _playerId: number, data: any): GameState {
  const { playerId: targetPlayerId, newOrder } = data || {}
  if (!targetPlayerId || !newOrder || !Array.isArray(newOrder)) {
    return state
  }

  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player) {
    return state
  }

  // Determine if we're updating deck or discard based on card count
  // Deck typically has many cards, discard is usually smaller
  const isDeck = newOrder.length > 10 || (player.deckSize && newOrder.length === player.deckSize)

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      if (isDeck) {
        return { ...p, deck: newOrder, deckSize: newOrder.length }
      } else {
        return { ...p, discard: newOrder, discardSize: newOrder.length }
      }
    }
    return p
  })

  return { ...state, players: newPlayers as Player[] }
}

/**
 * REORDER_TOP_DECK - Reorder top cards of a deck (for TopDeckView)
 * Updates the player's deck with the reordered top cards
 */
function handleReorderTopDeck(state: GameState, _playerId: number, data: any): GameState {
  const { playerId: targetPlayerId, newTopCards } = data || {}
  if (!targetPlayerId || !newTopCards || !Array.isArray(newTopCards)) {
    return state
  }

  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player || !player.deck) {
    return state
  }

  // Reorder: replace top cards with new order, keep rest of deck unchanged
  const topCount = newTopCards.length
  const remainingDeck = player.deck.slice(topCount)
  const newDeck = [...newTopCards, ...remainingDeck]

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      return { ...p, deck: newDeck, deckSize: newDeck.length }
    }
    return p
  })

  return { ...state, players: newPlayers as Player[] }
}

/**
 * REQUEST_DECK_VIEW - Request full deck data for viewing another player's deck
 * This sets a temporary flag that personalizes the state to include full deck data
 * for the requesting player. The flag is cleared by the host after broadcasting.
 *
 * data: { targetPlayerId: number } - the player whose deck we want to view
 */
function handleRequestDeckView(state: GameState, playerId: number, data: any): GameState {
  const { targetPlayerId } = data || {}
  if (targetPlayerId === undefined) {
    logger.warn('[handleRequestDeckView] Missing targetPlayerId')
    return state
  }

  const targetPlayer = state.players.find(p => p.id === targetPlayerId)
  if (!targetPlayer) {
    logger.warn(`[handleRequestDeckView] Target player ${targetPlayerId} not found`)
    return state
  }

  logger.info(`[handleRequestDeckView] Player ${playerId} requesting deck view for player ${targetPlayerId}, deck size: ${targetPlayer.deck?.length || 0}`)

  // Add a temporary flag to the state that tells personalizeForPlayer
  // to include full deck data for this player's deck to the requesting player
  // This flag will be cleared by SimpleHost after broadcasting
  return {
    ...state,
    // @ts-ignore - temporary flag for deck view request
    _deckViewRequest: {
      requestingPlayerId: playerId,
      targetPlayerId
    }
  }
}

