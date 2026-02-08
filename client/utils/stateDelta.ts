/**
 * State Delta System for WebRTC
 * Compact state synchronization - only sends changes, not full state
 */

import type { GameState, StateDelta, PlayerDelta, BoardCellDelta, Card, DeckType } from '../types'

/**
 * Create a delta representing a card moving from source to destination
 */
export function createCardMoveDelta(
  playerId: number,
  from: 'hand' | 'deck' | 'discard' | 'board',
  to: 'hand' | 'deck' | 'discard' | 'board',
  cardCount?: number,
  sourcePlayerId?: number
): StateDelta {
  const delta: StateDelta = {
    timestamp: Date.now(),
    sourcePlayerId: sourcePlayerId || playerId,
    playerDeltas: {}
  }

  delta.playerDeltas = {
    [playerId]: {
      id: playerId
    }
  }

  const playerDelta = delta.playerDeltas[playerId]!

  // Handle source changes (removal)
  if (from === 'hand') {
    playerDelta.handRemove = cardCount || 1
  } else if (from === 'deck') {
    playerDelta.deckRemove = cardCount || 1
  } else if (from === 'discard') {
    // For discard, we typically clear after drawing
    playerDelta.discardClear = true
  }

  // Handle destination changes (addition)
  if (to === 'hand') {
    // For hand, we only track size change (privacy)
    playerDelta.handSizeDelta = cardCount || 1
  } else if (to === 'deck') {
    playerDelta.deckSizeDelta = cardCount || 1
  } else if (to === 'discard') {
    playerDelta.discardSizeDelta = cardCount || 1
  }

  return delta
}

/**
 * Create a delta for board cell changes
 */
export function createBoardCellDelta(
  row: number,
  col: number,
  card: Card | null,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    boardCells: [{
      row,
      col,
      card // null = card removed
    }]
  }
}

/**
 * Create a delta for card status changes on board
 */
export function createCardStatusDelta(
  row: number,
  col: number,
  sourcePlayerId: number,
  addStatuses?: { type: string; addedByPlayerId: number }[],
  removeStatusTypes?: string[]
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    boardCells: [{
      row,
      col,
      cardStatuses: {
        ...(addStatuses && addStatuses.length > 0 && { add: addStatuses }),
        ...(removeStatusTypes && removeStatusTypes.length > 0 && { remove: removeStatusTypes })
      }
    }]
  }
}

/**
 * Create a delta for phase/game state changes
 */
export function createPhaseDelta(
  changes: {
    currentPhase?: number
    isScoringStep?: boolean
    activePlayerId?: number | null
    startingPlayerId?: number | null
  },
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    phaseDelta: changes
  }
}

/**
 * Create a delta for round state changes
 */
export function createRoundDelta(
  changes: {
    currentRound?: number
    turnNumber?: number
    roundEndTriggered?: boolean
    roundWinners?: Record<number, number[]>
    gameWinner?: number | null
    isRoundEndModalOpen?: boolean
  },
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    roundDelta: changes
  }
}

/**
 * Create a delta for player score changes
 */
export function createScoreDelta(
  playerId: number,
  scoreDelta: number,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    playerDeltas: {
      [playerId]: {
        id: playerId,
        scoreDelta
      }
    }
  }
}

/**
 * Create a delta for player property changes (ready, color, etc.)
 */
export function createPlayerPropertyDelta(
  playerId: number,
  properties: {
    isReady?: boolean
    selectedDeck?: DeckType
    name?: string
    color?: string
    isDisconnected?: boolean
  },
  sourcePlayerId: number
): StateDelta {
  const playerDelta: PlayerDelta = {
    id: playerId,
    ...(properties.isReady !== undefined && { isReady: properties.isReady }),
    ...(properties.selectedDeck !== undefined && { selectedDeck: properties.selectedDeck }),
    ...(properties.name !== undefined && { name: properties.name }),
    ...(properties.color !== undefined && { color: properties.color as any }),
    ...(properties.isDisconnected !== undefined && { isDisconnected: properties.isDisconnected }),
  }
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    playerDeltas: {
      [playerId]: playerDelta
    }
  }
}

/**
 * Apply a state delta to the current game state
 * This is called by guests when they receive a delta from host
 *
 * IMPORTANT: This function needs the localPlayerId to properly handle privacy.
 * For local player: preserve full hand/deck/discard arrays
 * For other players: adjust array sizes to match delta (placeholder cards)
 */
export function applyStateDelta(currentState: GameState, delta: StateDelta, localPlayerId?: number | null): GameState {
  const newState = { ...currentState }

  // Apply player deltas
  if (delta.playerDeltas) {
    newState.players = currentState.players.map(player => {
      const playerDelta = delta.playerDeltas![player.id]
      if (!playerDelta) return player

      const updatedPlayer = { ...player }
      const isLocalPlayer = player.id === localPlayerId

      // Apply hand size changes
      if (playerDelta.handSizeDelta !== undefined) {
        if (isLocalPlayer) {
          // Local player: keep their actual hand (privacy)
          // Size delta is informational only
          console.log(`[applyStateDelta] Local player ${player.id}: handSizeDelta=${playerDelta.handSizeDelta} (informational, skipping)`)
        } else {
          // Other players: adjust hand array size for UI display
          const newSize = player.hand.length + playerDelta.handSizeDelta
          console.log(`[applyStateDelta] Player ${player.id}: hand ${player.hand.length} -> ${newSize} (delta: ${playerDelta.handSizeDelta})`)
          if (newSize < player.hand.length) {
            // Cards removed: shrink array
            updatedPlayer.hand = player.hand.slice(0, newSize)
          } else if (newSize > player.hand.length) {
            // Cards added: add placeholder cards
            const placeholders: any[] = []
            for (let i = player.hand.length; i < newSize; i++) {
              placeholders.push({ id: `placeholder_${player.id}_${i}`, name: '?', isPlaceholder: true })
            }
            updatedPlayer.hand = [...player.hand, ...placeholders]
            console.log(`[applyStateDelta] Added ${placeholders.length} placeholder cards to player ${player.id} hand`)
          }
        }
      }

      // Apply deck size changes
      if (playerDelta.deckSizeDelta !== undefined) {
        if (isLocalPlayer) {
          // Local player: keep their actual deck
        } else {
          // Other players: adjust deck array size for UI display
          const newSize = player.deck.length + playerDelta.deckSizeDelta
          console.log(`[applyStateDelta] Player ${player.id}: deck ${player.deck.length} -> ${newSize} (delta: ${playerDelta.deckSizeDelta})`)
          if (newSize < player.deck.length) {
            // Cards removed: shrink array
            updatedPlayer.deck = player.deck.slice(0, newSize)
          } else if (newSize > player.deck.length) {
            // Cards added: add placeholder cards
            const placeholders: any[] = []
            for (let i = player.deck.length; i < newSize; i++) {
              placeholders.push({ id: `placeholder_${player.id}_deck_${i}`, name: '?', isPlaceholder: true })
            }
            updatedPlayer.deck = [...player.deck, ...placeholders]
          }
        }
      }

      // Apply discard size changes
      if (playerDelta.discardSizeDelta !== undefined) {
        if (isLocalPlayer) {
          // Local player: keep their actual discard
        } else {
          // Other players: adjust discard array size for UI display
          const newSize = player.discard.length + playerDelta.discardSizeDelta
          if (newSize < player.discard.length) {
            // Cards removed: shrink array
            updatedPlayer.discard = player.discard.slice(0, newSize)
          } else if (newSize > player.discard.length) {
            // Cards added: add placeholder cards
            const placeholders: any[] = []
            for (let i = player.discard.length; i < newSize; i++) {
              placeholders.push({ id: `placeholder_${player.id}_discard_${i}`, name: '?', isPlaceholder: true })
            }
            updatedPlayer.discard = [...player.discard, ...placeholders]
          }
        }
      }

      // Apply score changes
      if (playerDelta.scoreDelta !== undefined) {
        updatedPlayer.score = Math.max(0, player.score + playerDelta.scoreDelta)
      }

      // Apply property changes
      if (playerDelta.isReady !== undefined) {
        updatedPlayer.isReady = playerDelta.isReady
      }
      if (playerDelta.selectedDeck !== undefined) {
        updatedPlayer.selectedDeck = playerDelta.selectedDeck
      }
      if (playerDelta.name !== undefined) {
        updatedPlayer.name = playerDelta.name
      }
      if (playerDelta.color !== undefined) {
        updatedPlayer.color = playerDelta.color
      }
      if (playerDelta.isDisconnected !== undefined) {
        updatedPlayer.isDisconnected = playerDelta.isDisconnected
      }

      return updatedPlayer
    })
  }

  // Apply board cell changes
  if (delta.boardCells && delta.boardCells.length > 0) {
    newState.board = currentState.board.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        // Find delta for this cell using row/col indices (not cell.coords which doesn't exist)
        const cellDelta = delta.boardCells!.find(d => d.row === rowIndex && d.col === colIndex)
        if (!cellDelta) return cell

        const updatedCell = { ...cell }

        // Apply card placement/removal
        if (cellDelta.card !== undefined) {
          updatedCell.card = cellDelta.card
        }

        // Apply status changes to existing card
        if (cellDelta.cardStatuses && updatedCell.card) {
          const updatedCard = { ...updatedCell.card }
          if (!updatedCard.statuses) {
            updatedCard.statuses = []
          }

          if (cellDelta.cardStatuses.clear) {
            updatedCard.statuses = []
          } else {
            // Remove statuses
            if (cellDelta.cardStatuses.remove) {
              const removeTypes = cellDelta.cardStatuses.remove
              updatedCard.statuses = updatedCard.statuses.filter(
                s => !removeTypes.includes(s.type)
              )
            }
            // Add statuses
            if (cellDelta.cardStatuses.add) {
              updatedCard.statuses = [...updatedCard.statuses, ...cellDelta.cardStatuses.add]
            }
          }

          updatedCell.card = updatedCard
        }

        // Apply power changes
        if (cellDelta.cardPowerDelta !== undefined && updatedCell.card) {
          const cardWithPowerDelta: Card = { ...updatedCell.card }
          cardWithPowerDelta.power = cardWithPowerDelta.power + (cellDelta.cardPowerDelta || 0)
          updatedCell.card = cardWithPowerDelta
        }

        if (cellDelta.cardPowerModifier !== undefined && updatedCell.card) {
          const cardWithPowerModifier: Card = { ...updatedCell.card }
          cardWithPowerModifier.powerModifier = cellDelta.cardPowerModifier
          updatedCell.card = cardWithPowerModifier
        }

        return updatedCell
      })
    )
  }

  // Apply phase changes
  if (delta.phaseDelta) {
    if (delta.phaseDelta.currentPhase !== undefined) {
      newState.currentPhase = delta.phaseDelta.currentPhase
    }
    if (delta.phaseDelta.isScoringStep !== undefined) {
      newState.isScoringStep = delta.phaseDelta.isScoringStep
    }
    if (delta.phaseDelta.activePlayerId !== undefined) {
      newState.activePlayerId = delta.phaseDelta.activePlayerId
    }
    if (delta.phaseDelta.startingPlayerId !== undefined) {
      newState.startingPlayerId = delta.phaseDelta.startingPlayerId
    }
  }

  // Apply round changes
  if (delta.roundDelta) {
    if (delta.roundDelta.currentRound !== undefined) {
      newState.currentRound = delta.roundDelta.currentRound
    }
    if (delta.roundDelta.turnNumber !== undefined) {
      newState.turnNumber = delta.roundDelta.turnNumber
    }
    if (delta.roundDelta.roundEndTriggered !== undefined) {
      newState.roundEndTriggered = delta.roundDelta.roundEndTriggered
    }
    if (delta.roundDelta.roundWinners !== undefined) {
      newState.roundWinners = { ...delta.roundDelta.roundWinners }
    }
    if (delta.roundDelta.gameWinner !== undefined) {
      newState.gameWinner = delta.roundDelta.gameWinner
    }
    if (delta.roundDelta.isRoundEndModalOpen !== undefined) {
      newState.isRoundEndModalOpen = delta.roundDelta.isRoundEndModalOpen
    }
  }

  // Apply highlight changes
  if (delta.highlightsDelta) {
    if (delta.highlightsDelta.clear) {
      newState.highlights = []
    } else {
      let newHighlights = [...currentState.highlights]
      if (delta.highlightsDelta.remove) {
        newHighlights = newHighlights.filter(h => !delta.highlightsDelta!.remove!.includes(h.timestamp))
      }
      if (delta.highlightsDelta.add) {
        newHighlights = [...newHighlights, ...delta.highlightsDelta.add]
      }
      newState.highlights = newHighlights
    }
  }

  // Apply floating text changes
  if (delta.floatingTextsDelta) {
    if (delta.floatingTextsDelta.clear) {
      newState.floatingTexts = []
    } else if (delta.floatingTextsDelta.add) {
      newState.floatingTexts = [...currentState.floatingTexts, ...delta.floatingTextsDelta.add]
    }
  }

  // Apply targeting mode changes
  if (delta.targetingModeDelta) {
    if (delta.targetingModeDelta.clear) {
      newState.targetingMode = null
    } else if (delta.targetingModeDelta.set) {
      newState.targetingMode = delta.targetingModeDelta.set
    }
  }

  return newState
}

/**
 * Detect and create delta from two game states
 * Compares oldState and newState to create minimal delta
 * Used by host to broadcast changes after processing an action
 */
export function createDeltaFromStates(oldState: GameState, newState: GameState, sourcePlayerId: number): StateDelta {
  const delta: StateDelta = {
    timestamp: Date.now(),
    sourcePlayerId
  }

  // Detect phase changes
  if (oldState.currentPhase !== newState.currentPhase ||
      oldState.isScoringStep !== newState.isScoringStep ||
      oldState.activePlayerId !== newState.activePlayerId ||
      oldState.startingPlayerId !== newState.startingPlayerId) {
    delta.phaseDelta = {
      ...(oldState.currentPhase !== newState.currentPhase && { currentPhase: newState.currentPhase }),
      ...(oldState.isScoringStep !== newState.isScoringStep && { isScoringStep: newState.isScoringStep }),
      ...(oldState.activePlayerId !== newState.activePlayerId && { activePlayerId: newState.activePlayerId }),
      ...(oldState.startingPlayerId !== newState.startingPlayerId && { startingPlayerId: newState.startingPlayerId })
    }
  }

  // Detect round changes
  if (oldState.currentRound !== newState.currentRound ||
      oldState.turnNumber !== newState.turnNumber ||
      oldState.roundEndTriggered !== newState.roundEndTriggered ||
      oldState.gameWinner !== newState.gameWinner ||
      oldState.isRoundEndModalOpen !== newState.isRoundEndModalOpen) {
    delta.roundDelta = {
      ...(oldState.currentRound !== newState.currentRound && { currentRound: newState.currentRound }),
      ...(oldState.turnNumber !== newState.turnNumber && { turnNumber: newState.turnNumber }),
      ...(oldState.roundEndTriggered !== newState.roundEndTriggered && { roundEndTriggered: newState.roundEndTriggered }),
      ...(oldState.gameWinner !== newState.gameWinner && { gameWinner: newState.gameWinner }),
      ...(oldState.isRoundEndModalOpen !== newState.isRoundEndModalOpen && { isRoundEndModalOpen: newState.isRoundEndModalOpen })
    }
  }

  // Detect board cell changes
  const boardCellDeltas: BoardCellDelta[] = []
  const maxRows = Math.max(oldState.board.length, newState.board.length)
  for (let r = 0; r < maxRows; r++) {
    const maxCols = Math.max(
      oldState.board[r]?.length || 0,
      newState.board[r]?.length || 0
    )
    for (let c = 0; c < maxCols; c++) {
      const oldCell = oldState.board[r]?.[c]
      const newCell = newState.board[r]?.[c]

      // Skip if both cells are undefined
      if (!oldCell && !newCell) continue

      // Check if card changed (handle undefined cells)
      const oldCardId = oldCell?.card?.id
      const newCardId = newCell?.card?.id

      if (oldCardId !== newCardId) {
        boardCellDeltas.push({
          row: r,
          col: c,
          card: newCell?.card || null
        })
      } else if (oldCell?.card && newCell?.card) {
        // Card same, check for status/power changes
        const cellDelta: BoardCellDelta = { row: r, col: c }

        // Check status changes
        const oldStatuses = oldCell?.card?.statuses || []
        const newStatuses = newCell?.card?.statuses || []

        if (oldStatuses.length !== newStatuses.length) {
          const addedStatuses = newStatuses.filter(ns =>
            !oldStatuses.find(os => os.type === ns.type && os.addedByPlayerId === ns.addedByPlayerId)
          )
          const removedStatusTypes = oldStatuses
            .filter(os =>
              !newStatuses.find(ns => ns.type === os.type && ns.addedByPlayerId === os.addedByPlayerId)
            )
            .map(s => s.type)

          if (addedStatuses.length > 0 || removedStatusTypes.length > 0) {
            cellDelta.cardStatuses = {
              ...(addedStatuses.length > 0 && { add: addedStatuses }),
              ...(removedStatusTypes.length > 0 && { remove: removedStatusTypes })
            }
          }
        }

        // Check power changes
        if (oldCell?.card?.power !== newCell?.card?.power) {
          cellDelta.cardPowerDelta = (newCell?.card?.power || 0) - (oldCell?.card?.power || 0)
        }

        if (Object.keys(cellDelta).length > 2) { // More than just row/col
          boardCellDeltas.push(cellDelta)
        }
      }
    }
  }

  if (boardCellDeltas.length > 0) {
    delta.boardCells = boardCellDeltas
  }

  // Detect player changes
  const playerDeltas: Record<number, PlayerDelta> = {}

  for (const newPlayer of newState.players) {
    const oldPlayer = oldState.players.find(p => p.id === newPlayer.id)
    if (!oldPlayer) continue

    const playerDelta: PlayerDelta = { id: newPlayer.id }

    // Check score change
    if (oldPlayer.score !== newPlayer.score) {
      playerDelta.scoreDelta = newPlayer.score - oldPlayer.score
    }

    // Check property changes
    if (oldPlayer.isReady !== newPlayer.isReady) {
      playerDelta.isReady = newPlayer.isReady
    }
    if (oldPlayer.selectedDeck !== newPlayer.selectedDeck) {
      playerDelta.selectedDeck = newPlayer.selectedDeck
    }
    if (oldPlayer.name !== newPlayer.name) {
      playerDelta.name = newPlayer.name
    }
    if (oldPlayer.color !== newPlayer.color) {
      playerDelta.color = newPlayer.color
    }
    if (oldPlayer.isDisconnected !== newPlayer.isDisconnected) {
      playerDelta.isDisconnected = newPlayer.isDisconnected
    }

    // Check hand/deck/discard size changes
    if (oldPlayer.hand.length !== newPlayer.hand.length) {
      playerDelta.handSizeDelta = newPlayer.hand.length - oldPlayer.hand.length
    }
    if (oldPlayer.deck.length !== newPlayer.deck.length) {
      playerDelta.deckSizeDelta = newPlayer.deck.length - oldPlayer.deck.length
    }
    if (oldPlayer.discard.length !== newPlayer.discard.length) {
      playerDelta.discardSizeDelta = newPlayer.discard.length - oldPlayer.discard.length
    }

    if (Object.keys(playerDelta).length > 1) { // More than just id
      playerDeltas[newPlayer.id] = playerDelta
    }
  }

  if (Object.keys(playerDeltas).length > 0) {
    delta.playerDeltas = playerDeltas
  }

  return delta
}

/**
 * Check if a delta is empty (no actual changes)
 */
export function isDeltaEmpty(delta: StateDelta): boolean {
  return !delta.phaseDelta &&
         !delta.roundDelta &&
         !delta.boardCells?.length &&
         !delta.playerDeltas &&
         !delta.highlightsDelta &&
         !delta.floatingTextsDelta &&
         !delta.targetingModeDelta
}
