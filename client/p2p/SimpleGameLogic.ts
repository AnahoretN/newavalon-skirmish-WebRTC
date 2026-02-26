/**
 * Simple Game Logic
 *
 * All game logic in one place.
 * The applyAction function takes current state and action,
 * returns new state.
 */

import type { GameState, Card, Player, DeckType, ScoringLineData } from '../types'
import type { ActionType } from './SimpleP2PTypes'
import { shuffleDeck } from '../../shared/utils/array'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'
import { initializeReadyStatuses, recalculateAllReadyStatuses } from '../utils/autoAbilities'
import { createDeck } from '../hooks/core/gameCreators'

/**
 * Check if card is a token
 */
function isToken(card: Card): boolean {
  return card.deck === 'counter'
}

/**
 * Clear all card statuses except Revealed
 * Called when moving card from battlefield
 */
function clearAllStatusesExceptRevealed(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
    return
  }
  // Keep only Revealed statuses, remove all others
  card.statuses = card.statuses.filter(s => s.type === 'Revealed')
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

  // Always recalculate board card statuses
  newState.board = recalculateBoardStatuses(newState)

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
            'SET_PRIVACY', 'ASSIGN_TEAMS'].includes(action)
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
    // Check if player has cards with "LastPlayed" status on board
    // LastPlayed status is added when card is played from hand
    const hasLastPlayedCards = state.board.some(row =>
      row.some(cell =>
        cell.card?.ownerId === playerId &&
        cell.card?.statuses?.some(s => s.type === 'LastPlayed' && s.addedByPlayerId === playerId)
      )
    )

    if (hasLastPlayedCards) {
      // Has cards with LastPlayed status - enter Scoring and calculate lines
      return enterScoringPhase(state, playerId)
    } else {
      // No cards with LastPlayed status - pass turn to next player
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

  // Reset enteredThisTurn on all board cards when passing turn
  // Also clear setupUsedThisTurn and commitUsedThisTurn (but not deployUsedThisTurn!)
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card) {
        const newStatuses = cell.card.statuses?.filter((s: any) => {
          // Keep all statuses except setupUsedThisTurn and commitUsedThisTurn
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

  // Clear lastPlayedCardId for all players when passing turn
  const newPlayers = state.players.map(p => ({
    ...p,
    lastPlayedCardId: null
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

    // Remove card from hand
    newHand = [...player.hand]
    newHand.splice(cardIndexNum, 1)
    newHandSize = newHand.length
  }

  if (!cardToPlay) {return state}

  // First remove LastPlayed status from ALL player's cards on board
  // (only one card can have LastPlayed status at a time)
  const boardWithoutLastPlayed = state.board.map((row, _r) =>
    row.map((cell, _c) => {
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

  // Now add card to board with LastPlayed status
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

  // Add to boardHistory
  const newBoardHistory = [...player.boardHistory, cardToPlay.id]

  // Update player - set lastPlayedCardId
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
    currentPhase: 2  // Main phase after playing card
  }
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

  return {
    ...state,
    board: newBoard,
    players: newPlayers as Player[]
  }
}

/**
 * MOVE_CARD_TO_HAND - move card from board/discard to hand
 */
function handleMoveCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  let targetPlayerId = playerId
  let newBoard = state.board
  let newDiscard: Card[] | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            targetPlayerId = foundCard.ownerId || playerId
            // Clear all statuses except Revealed when card leaves battlefield
            clearAllStatusesExceptRevealed(foundCard)
          }
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

  return { ...state, board: newBoard, players: newPlayers as Player[] }
}

/**
 * MOVE_CARD_TO_DECK - move card from board/hand/discard to deck
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
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            targetPlayerId = foundCard.ownerId || playerId
            // Clear all statuses except Revealed when card leaves battlefield
            clearAllStatusesExceptRevealed(foundCard)
          }
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

  return { ...state, board: newBoard, players: newPlayers as Player[] }
}

/**
 * MOVE_CARD_TO_DISCARD - move card from board/hand/deck to discard
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
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            targetPlayerId = foundCard.ownerId || playerId
            // Clear all statuses except Revealed when card leaves battlefield
            clearAllStatusesExceptRevealed(foundCard)
          }
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

  return { ...state, board: newBoard, players: newPlayers as Player[] }
}

/**
 * MOVE_HAND_CARD_TO_DECK - move card from hand to deck
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
 * MOVE_HAND_CARD_TO_DISCARD - move card from hand to discard
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
 * MOVE_ANNOUNCED_TO_HAND - move card from showcase to hand
 */
function handleMoveAnnouncedToHand(state: GameState, playerId: number, _data: any): GameState {
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
 * MOVE_ANNOUNCED_TO_DECK - move card from showcase to deck
 */
function handleMoveAnnouncedToDeck(state: GameState, playerId: number, _data: any): GameState {
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
 * MOVE_ANNOUNCED_TO_DISCARD - move card from showcase to discard
 */
function handleMoveAnnouncedToDiscard(state: GameState, playerId: number, _data: any): GameState {
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
 * PLAY_ANNOUNCED_TO_BOARD - play card from showcase to battlefield
 */
function handlePlayAnnouncedToBoard(state: GameState, playerId: number, data: any): GameState {
  const { row, col, faceDown = false } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || !player.announcedCard) {return state}
  if (row === undefined || col === undefined) {return state}
  if (row < 0 || row >= state.activeGridSize || col < 0 || col >= state.activeGridSize) {return state}

  // Check if cell is empty
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

  return { ...state, board: newBoard, players: newPlayers as Player[] }
}

/**
 * ANNOUNCE_CARD - announce card
 */
function handleAnnounceCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex } = data || {}
  const player = state.players.find(p => p.id === playerId)

  if (!player || cardIndex === undefined) {return state}

  const card = player.hand[cardIndex]
  if (!card) {return state}

  // First remove LastPlayed status from ALL player's cards on board
  // (only one card can have LastPlayed status at a time)
  const boardWithoutLastPlayed = state.board.map((row, _r) =>
    row.map((cell, _c) => {
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
 * DESTROY_CARD - destroy card
 */
function handleDestroyCard(state: GameState, _playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) {return state}

  let destroyedCard: Card | null = null
  let ownerId: number | null = null

  const newBoard = state.board.map((row, _r) =>
    row.map((cell, _c) => {
      if (cell.card?.id === cardId) {
        const foundCard = cell.card
        if (foundCard) {
          destroyedCard = foundCard
          ownerId = foundCard.ownerId ?? null
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

  // Check if this was the owner's last played card
  const owner = state.players.find(p => p.id === ownerId)
  let updatedBoard = newBoard
  let newLastPlayedCardId: string | null = null

  if (owner && owner.lastPlayedCardId === cardId) {
    // This card was the last played - need to restore previous card's status
    // Find previous card in boardHistory (except destroyed)
    const historyWithoutDestroyed = owner.boardHistory.filter(id => id !== cardId)

    if (historyWithoutDestroyed.length > 0) {
      const prevCardId = historyWithoutDestroyed[historyWithoutDestroyed.length - 1]
      newLastPlayedCardId = prevCardId

      // Find this card on board and restore LastPlayed status
      updatedBoard = newBoard.map(row =>
        row.map(cell => {
          if (cell.card?.id === prevCardId) {
            // Add LastPlayed status to the previous card
            // ownerId is non-null here because we checked above
            const lastPlayedStatus = { type: 'LastPlayed' as const, addedByPlayerId: ownerId! }
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

  // Add to owner's discard
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      // Update boardHistory (remove destroyed card)
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
    players: newPlayers as Player[]
  }
}

// ============================================================================
// Deck control
// ============================================================================

/**
 * DRAW_CARD - draw card from deck
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

// ============================================================================
// Scoring
// ============================================================================

/**
 * START_SCORING - start scoring phase
 */
function handleStartScoring(state: GameState, playerId: number): GameState {
  if (state.currentPhase !== 3) {return state}

  // Use enterScoringPhase for proper line calculation
  return enterScoringPhase(state, playerId)
}

/**
 * SELECT_SCORING_LINE - select line for scoring
 */
function handleSelectScoringLine(state: GameState, playerId: number, data: any): GameState {
  if (!state.isScoringStep || state.activePlayerId !== playerId) {return state}

  const { lineType, lineIndex } = data || {}
  if (!lineType) {return state}

  // Calculate points based on cards in line
  const points = calculateLineScore(state, playerId, lineType, lineIndex)

  console.log('[handleSelectScoringLine] Player', playerId, 'selected', lineType, lineIndex, 'score:', points)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, score: p.score + points }
      : p
  )

  // Pass turn
  const newState = {
    ...state,
    players: newPlayers,
    isScoringStep: false,
    scoringLines: []  // Clear scoring lines
  }

  return handlePassTurn(newState, playerId, 'scoring_complete')
}

/**
 * Calculate points for line
 * lineType: 'row' | 'col' | 'diagonal' | 'anti-diagonal'
 * lineIndex: row/column number (0-based), or undefined for diagonals
 */
function calculateLineScore(state: GameState, playerId: number, lineType: string, lineIndex?: number): number {
  const gridSize = state.activeGridSize
  const cellsToCheck: { row: number; col: number }[] = []

  if (lineType === 'row' && lineIndex !== undefined) {
    // Horizontal line
    for (let c = 0; c < gridSize; c++) {
      cellsToCheck.push({ row: lineIndex, col: c })
    }
  } else if (lineType === 'col' && lineIndex !== undefined) {
    // Vertical line
    for (let r = 0; r < gridSize; r++) {
      cellsToCheck.push({ row: r, col: lineIndex })
    }
  } else if (lineType === 'diagonal') {
    // Main diagonal (top-left to bottom-right)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: i })
    }
  } else if (lineType === 'anti-diagonal') {
    // Anti-diagonal (top-right to bottom-left)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i, col: gridSize - 1 - i })
    }
  }

  // Count sum of power of all player's cards in this line
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
 * Find all lines containing player's card
 * Returns array of lines that can be highlighted for scoring
 */
export function findScoringLinesWithPlayerCard(
  state: GameState,
  playerId: number
): Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return []}

  // Find coordinates of last played card
  let lastPlayedCoords: { row: number; col: number } | null = null

  if (player.lastPlayedCardId) {
    // Search by lastPlayedCardId
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

  // If last played not found, look for any card with enteredThisTurn
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

  // If no card found - no lines for scoring
  if (!lastPlayedCoords) {return []}

  const { row, col } = lastPlayedCoords
  const lines: Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> = []

  // Horizontal line (row)
  const rowCells: { row: number; col: number }[] = []
  for (let c = 0; c < state.activeGridSize; c++) {
    rowCells.push({ row, col: c })
  }
  lines.push({ type: 'row', index: row, cells: rowCells })

  // Vertical line (col)
  const colCells: { row: number; col: number }[] = []
  for (let r = 0; r < state.activeGridSize; r++) {
    colCells.push({ row: r, col })
  }
  lines.push({ type: 'col', index: col, cells: colCells })

  // Diagonal lines not currently used in scoring phase
  // (may be used in card abilities)

  return lines
}

// ============================================================================
// Round and match
// ============================================================================

/**
 * COMPLETE_ROUND - close round end modal
 */
function handleCompleteRound(state: GameState): GameState {
  return { ...state, isRoundEndModalOpen: false }
}

/**
 * START_NEXT_ROUND - start next round
 */
function handleStartNextRound(state: GameState): GameState {
  const newRound = (state.currentRound || 1) + 1

  const newPlayers = state.players.map(p => ({
    ...p,
    score: 0  // Reset score
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
 * START_NEW_MATCH - start new match
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
 * PLAYER_READY - player is ready
 */
function handlePlayerReady(state: GameState, playerId: number): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, isReady: true } : p
  )

  // Check if everyone is ready
  const allReady = newPlayers.every(p => p.isReady || p.isDummy || p.isSpectator)

  // If all ready - start game
  if (allReady) {
    return startGame({ ...state, players: newPlayers })
  }

  return { ...state, players: newPlayers }
}

/**
 * RESET_GAME - reset game to initial state (lobby)
 * Preserves players and their deck choices, but resets everything else
 */
function handleResetGame(state: GameState): GameState {
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
 * Start game
 */
function startGame(state: GameState): GameState {
  // Select random starting player
  const activePlayers = state.players.filter(p => !p.isDisconnected && !p.isSpectator)
  const startingPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)]

  console.log('[startGame] Starting player:', startingPlayer.id, startingPlayer.name)

  // Deal initial hands (6 cards to each player)
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

// ============================================================================
// Game settings
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
// Helper functions
// ============================================================================

/**
 * Get active player IDs (not disconnected, not spectators)
 */
function getActivePlayerIds(players: Player[]): number[] {
  return players
    .filter(p => !p.isDisconnected && !p.isSpectator)
    .map(p => p.id)
}

/**
 * Check if round should end
 */
function shouldRoundEnd(state: GameState): boolean {
  const threshold = 10 + (state.currentRound * 10)  // 20, 30, 40
  return state.players.some(p => p.score >= threshold)
}

/**
 * End round
 */
function endRound(state: GameState): GameState {
  const maxScore = Math.max(...state.players.map(p => p.score))
  const winners = state.players.filter(p => p.score === maxScore).map(p => p.id)

  // Check match victory (2 rounds)
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
 * Check match winner (2 out of 3 rounds)
 */
function checkMatchWinner(existingWins: Record<number, number[]>, newWinners: number[]): number | null {
  const allWins = { ...existingWins }

  // Count wins for each round
  const winCounts: Record<number, number> = {}
  Object.values(allWins).flat().forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })
  newWinners.forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })

  // Check who won 2 rounds
  for (const [id, count] of Object.entries(winCounts)) {
    if (count >= 2) {return parseInt(id)}
  }

  return null
}

/**
 * MARK_ABILITY_USED - mark ability as used
 * Removes ready status and adds usage marker
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
 * REMOVE_STATUS_BY_TYPE - remove status of specific type from card
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
 * PLAY_CARD_FROM_DECK - play top card from deck to battlefield
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
 * PLAY_CARD_FROM_DISCARD - play card from discard to battlefield
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
 * ADD_STATUS_TO_BOARD_CARD - add status (token) to card on battlefield
 */
function handleAddStatusToBoardCard(state: GameState, _playerId: number, data: any): GameState {
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
