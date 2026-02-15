/**
 * State Delta System for WebRTC
 * Compact state synchronization - only sends changes, not full state
 */

import type { GameState, StateDelta, PlayerDelta, BoardCellDelta, Card, DeckType, GridSize } from '../types'
import { getDecksData } from '../content'
import { shuffleDeck } from '../../shared/utils/array'
import { logger } from '../utils/logger'

/**
 * Helper function to create a deck locally (for dummy player card generation)
 * Guests use this to generate dummy player decks when not provided in delta
 */
function createDeckLocally(deckType: DeckType, playerId: number, playerName: string): Card[] {
  const currentDecksData = getDecksData()

  // Handle "Random" deck type - use first available deck
  let actualDeckType = deckType
  if (deckType === 'Random' || !currentDecksData[deckType]) {
    const deckKeys = Object.keys(currentDecksData)
    if (deckKeys.length === 0) {
      logger.error('[createDeckLocally] No decks loaded yet!')
      return []
    }
    actualDeckType = deckKeys[0] as DeckType
  }

  const deck = currentDecksData[actualDeckType]
  if (!deck) {
    logger.error(`[createDeckLocally] Deck data for ${actualDeckType} not found!`)
    return []
  }

  const deckWithOwner = [...deck].map(card => ({ ...card, ownerId: playerId, ownerName: playerName }))
  return shuffleDeck(deckWithOwner)
}

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
 * Create a delta for ability mode changes (for P2P visual sync)
 */
export function createAbilityModeDelta(
  abilityMode: any,
  sourcePlayerId: number
): StateDelta {
  return {
    timestamp: Date.now(),
    sourcePlayerId,
    abilityModeDelta: abilityMode
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
  logger.debug(`[applyStateDelta] Applying delta: sourcePlayerId=${delta.sourcePlayerId}, boardCells=${delta.boardCells?.length || 0}, playerDeltas=${Object.keys(delta.playerDeltas || {}).length}, phase=${!!delta.phaseDelta}`)
  const newState = { ...currentState }

  // Apply player deltas
  if (delta.playerDeltas) {
    const updatedPlayers: any[] = []
    const processedPlayerIds = new Set<number>()

    logger.debug(`[applyStateDelta] Processing player deltas for ${Object.keys(delta.playerDeltas).length} players`)

    // First, update existing players and skip removed ones
    for (const player of currentState.players) {
      const playerDelta = delta.playerDeltas![player.id]

      // Player was removed - skip them
      if (playerDelta?.removed) {
        logger.debug(`[applyStateDelta] Player ${player.id} removed, filtering out`)
        continue
      }

      processedPlayerIds.add(player.id)

      if (playerDelta) {
        // Update existing player with delta
        const updatedPlayer = { ...player }
        const isLocalPlayer = player.id === localPlayerId

        // Apply full card arrays for dummy players (from delta)
        // Check each array individually - don't require all three to be present
        const isDummyPlayer = updatedPlayer.isDummy || player.isDummy
        if (isDummyPlayer) {
          if (playerDelta.hand) {
            logger.debug(`[applyStateDelta] Dummy player ${player.id}: using full hand from delta (${playerDelta.hand.length} cards)`)
            updatedPlayer.hand = playerDelta.hand
          }
          if (playerDelta.deck) {
            logger.debug(`[applyStateDelta] Dummy player ${player.id}: using full deck from delta (${playerDelta.deck.length} cards)`)
            updatedPlayer.deck = playerDelta.deck
          }
          if (playerDelta.discard) {
            logger.debug(`[applyStateDelta] Dummy player ${player.id}: using full discard from delta (${playerDelta.discard.length} cards)`)
            updatedPlayer.discard = playerDelta.discard
          }
        }

        // For non-dummy players or when full arrays not provided, apply size deltas
        if (!isDummyPlayer || (!playerDelta.hand && !playerDelta.deck && !playerDelta.discard)) {
          if (playerDelta.handSizeDelta !== undefined) {
            if (isLocalPlayer) {
              // Local player: keep their actual hand (privacy)
              // Size delta is informational only
              logger.debug(`[applyStateDelta] Local player ${player.id}: handSizeDelta=${playerDelta.handSizeDelta} (informational, skipping)`)
            } else {
              // Other players: adjust hand array size for UI display
              const newSize = player.hand.length + playerDelta.handSizeDelta
              logger.debug(`[applyStateDelta] Player ${player.id}: hand ${player.hand.length} -> ${newSize} (delta: ${playerDelta.handSizeDelta})`)
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
                logger.debug(`[applyStateDelta] Added ${placeholders.length} placeholder cards to player ${player.id} hand`)
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
              logger.debug(`[applyStateDelta] Player ${player.id}: deck ${player.deck.length} -> ${newSize} (delta: ${playerDelta.deckSizeDelta})`)
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

          // Apply discard changes
          if (playerDelta.discardAdd) {
            // Cards added to discard - append them for local player
            updatedPlayer.discard = [...updatedPlayer.discard, ...playerDelta.discardAdd]
          }
          if (playerDelta.discardClear) {
            updatedPlayer.discard = []
          }
          if (playerDelta.discardSizeDelta !== undefined && !playerDelta.discardAdd) {
            // Only adjust size if we don't have exact cards (for other players' discards)
            if (!isLocalPlayer) {
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
        if (playerDelta.isDummy !== undefined) {
          updatedPlayer.isDummy = playerDelta.isDummy
        }

        // Apply announcedCard changes
        if (playerDelta.announcedCard !== undefined) {
          logger.debug(`[applyStateDelta] Player ${player.id} announcedCard updated:`, playerDelta.announcedCard?.id || 'null')
          updatedPlayer.announcedCard = playerDelta.announcedCard
        }

        // Apply boardHistory changes
        if (playerDelta.boardHistory !== undefined) {
          updatedPlayer.boardHistory = [...playerDelta.boardHistory]
        }

        // Apply other property changes
        if (playerDelta.teamId !== undefined) {
          updatedPlayer.teamId = playerDelta.teamId
        }
        if (playerDelta.autoDrawEnabled !== undefined) {
          updatedPlayer.autoDrawEnabled = playerDelta.autoDrawEnabled
        }

        updatedPlayers.push(updatedPlayer)
      } else {
        // No delta, keep player as-is
        updatedPlayers.push(player)
      }
    }

    // Then, add new players that weren't in current state
    for (const [playerIdStr, playerDelta] of Object.entries(delta.playerDeltas)) {
      const playerId = Number(playerIdStr)
      if (!processedPlayerIds.has(playerId) && !playerDelta.removed) {
        logger.debug(`[applyStateDelta] Adding new player ${playerId} (${playerDelta.name || 'Unknown'}), isDummy=${playerDelta.isDummy}`)

        const newPlayer: any = {
          id: playerId,
          name: playerDelta.name || `Player ${playerId}`,
          color: playerDelta.color || 'blue',
          isDummy: playerDelta.isDummy || false,
          isReady: playerDelta.isReady || false,
          score: 0,
          selectedDeck: playerDelta.selectedDeck || 'Random',
          boardHistory: playerDelta.boardHistory || [],
          isDisconnected: playerDelta.isDisconnected || false,
          autoDrawEnabled: playerDelta.autoDrawEnabled !== undefined ? playerDelta.autoDrawEnabled : true,
        }

        // Helper to create placeholder card with proper ownership
        const createPlaceholderCard = (index: number, location: string): any => ({
          id: `placeholder_${playerId}_${location}_${index}`,
          name: '?',
          isPlaceholder: true,
          ownerId: playerId,
          color: newPlayer.color,
          deck: newPlayer.selectedDeck,
        })

        // For dummy players: if delta has full card arrays, use them; otherwise create placeholders
        // For real players: always create placeholders (privacy)
        // Check each array individually - don't require all three to be present
        if (playerDelta.isDummy) {
          // For dummy players, use provided arrays and fill in the rest with placeholders
          if (playerDelta.hand) {
            newPlayer.hand = playerDelta.hand
            logger.debug(`[applyStateDelta] New dummy player ${playerId}: using full hand from delta (${newPlayer.hand.length} cards)`)
          } else {
            const handSize = playerDelta.handSizeDelta || 0
            newPlayer.hand = []
            for (let i = 0; i < handSize; i++) {
              newPlayer.hand.push(createPlaceholderCard(i, 'hand'))
            }
          }
          if (playerDelta.deck) {
            newPlayer.deck = playerDelta.deck
            logger.debug(`[applyStateDelta] New dummy player ${playerId}: using full deck from delta (${newPlayer.deck.length} cards)`)
          } else {
            // For dummy players, generate the actual deck locally using selectedDeck
            // This allows guests to see real dummy cards without needing full deck in delta
            const deckType = newPlayer.selectedDeck || 'Random'
            const generatedDeck = createDeckLocally(deckType as DeckType, playerId, newPlayer.name)

            // The generated deck is full (30 cards), but we may need to match the expected size
            // If dummy has already drawn cards, the deck size will be smaller
            const expectedDeckSize = playerDelta.deckSizeDelta || generatedDeck.length
            if (generatedDeck.length > expectedDeckSize) {
              // Cards have been drawn - trim from the end (cards are drawn from front)
              // Actually, in our system, cards are drawn from index 0, so we need to simulate that
              const drawnCount = generatedDeck.length - expectedDeckSize
              newPlayer.deck = generatedDeck.slice(drawnCount)
            } else {
              newPlayer.deck = generatedDeck
            }
            logger.debug(`[applyStateDelta] New dummy player ${playerId}: generated deck locally (${newPlayer.deck.length} cards, deckType=${deckType})`)
          }
          if (playerDelta.discard) {
            newPlayer.discard = playerDelta.discard
            logger.debug(`[applyStateDelta] New dummy player ${playerId}: using full discard from delta (${newPlayer.discard.length} cards)`)
          } else {
            const discardSize = playerDelta.discardSizeDelta || 0
            newPlayer.discard = []
            for (let i = 0; i < discardSize; i++) {
              newPlayer.discard.push(createPlaceholderCard(i, 'discard'))
            }
          }
          logger.debug(`[applyStateDelta] New dummy player ${playerId}: hand=${newPlayer.hand.length}, deck=${newPlayer.deck.length}, discard=${newPlayer.discard.length}`)
        } else {
          // Real player - always create placeholders (privacy)
          const handSize = playerDelta.handSizeDelta || 0
          const deckSize = playerDelta.deckSizeDelta || 0
          const discardSize = playerDelta.discardSizeDelta || 0

          newPlayer.hand = []
          for (let i = 0; i < handSize; i++) {
            newPlayer.hand.push(createPlaceholderCard(i, 'hand'))
          }
          newPlayer.deck = []
          for (let i = 0; i < deckSize; i++) {
            newPlayer.deck.push(createPlaceholderCard(i, 'deck'))
          }
          newPlayer.discard = []
          for (let i = 0; i < discardSize; i++) {
            newPlayer.discard.push(createPlaceholderCard(i, 'discard'))
          }
          logger.debug(`[applyStateDelta] New real player ${playerId}: created placeholders, hand=${handSize}, deck=${deckSize}, discard=${discardSize}`)
        }

        // Apply announced card if provided
        if (playerDelta.announcedCard !== undefined) {
          newPlayer.announcedCard = playerDelta.announcedCard
        } else {
          newPlayer.announcedCard = null
        }

        updatedPlayers.push(newPlayer)
      }
    }

    logger.debug(`[applyStateDelta] Player count: ${currentState.players.length} -> ${updatedPlayers.length}`)
    newState.players = updatedPlayers
  }

  // Apply board cell changes
  if (delta.boardCells && delta.boardCells.length > 0) {
    logger.debug(`[applyStateDelta] Applying ${delta.boardCells.length} board cell changes`)
    newState.board = currentState.board.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        // Find delta for this cell using row/col indices (not cell.coords which doesn't exist)
        const cellDelta = delta.boardCells!.find(d => d.row === rowIndex && d.col === colIndex)
        if (!cellDelta) {return cell}

        const updatedCell = { ...cell }

        // Apply card placement/removal (full card replacement)
        if (cellDelta.card !== undefined) {
          const statusCount = cellDelta.card?.statuses?.length || 0
          const statusTypes = cellDelta.card?.statuses?.map(s => s.type).join(',') || 'none'
          logger.debug(`[applyStateDelta] Cell [${rowIndex},${colIndex}]: card ${cellDelta.card ? 'added' : 'removed'}, name: ${cellDelta.card?.name || 'N/A'}, statuses: [${statusTypes}] (count: ${statusCount})`)
          updatedCell.card = cellDelta.card
        }

        // Apply status changes to existing card (after potential card replacement)
        if (cellDelta.cardStatuses && updatedCell.card) {
          logger.debug(`[applyStateDelta] Cell [${rowIndex},${colIndex}]: applying cardStatuses, remove=${cellDelta.cardStatuses.remove?.join(',')}, add count=${cellDelta.cardStatuses.add?.length || 0}`)

          const updatedCard = { ...updatedCell.card }
          if (!updatedCard.statuses) {
            updatedCard.statuses = []
          }

          if (cellDelta.cardStatuses.clear) {
            updatedCard.statuses = []
          } else {
            // Remove statuses by type (first, before adding new ones)
            if (cellDelta.cardStatuses.remove && cellDelta.cardStatuses.remove.length > 0) {
              const removeTypes = cellDelta.cardStatuses.remove
              const beforeLength = updatedCard.statuses.length
              updatedCard.statuses = updatedCard.statuses.filter(
                s => !removeTypes.includes(s.type)
              )
              const afterLength = updatedCard.statuses.length
              if (beforeLength !== afterLength) {
                logger.debug(`[applyStateDelta] Cell [${rowIndex},${colIndex}]: removed ${beforeLength - afterLength} statuses with types: ${removeTypes.join(',')}`)
              }
            }
            // Add new statuses
            if (cellDelta.cardStatuses.add && cellDelta.cardStatuses.add.length > 0) {
              updatedCard.statuses = [...updatedCard.statuses, ...cellDelta.cardStatuses.add]
              logger.debug(`[applyStateDelta] Cell [${rowIndex},${colIndex}]: added ${cellDelta.cardStatuses.add.length} statuses`)
            }
          }

          updatedCell.card = updatedCard
        }

        // Apply power changes
        if (cellDelta.cardPowerDelta !== undefined && updatedCell.card) {
          const cardWithPowerDelta: Card = { ...updatedCell.card }
          cardWithPowerDelta.power = Number(cardWithPowerDelta.power ?? 0) + cellDelta.cardPowerDelta
          updatedCell.card = cardWithPowerDelta
        }

        if (cellDelta.cardPowerModifier !== undefined && updatedCell.card) {
          logger.debug(`[applyStateDelta] Applying powerModifier at [${rowIndex},${colIndex}]: ${updatedCell.card.powerModifier} -> ${cellDelta.cardPowerModifier}`)
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

  // Apply settings changes
  if (delta.settingsDelta) {
    if (delta.settingsDelta.activeGridSize !== undefined) {
      newState.activeGridSize = delta.settingsDelta.activeGridSize
      // Recreate board if size changed
      if (currentState.board.length !== delta.settingsDelta.activeGridSize) {
        const size: GridSize = delta.settingsDelta.activeGridSize
        newState.board = []
        for (let i = 0; i < size; i++) {
          const row: any[] = []
          for (let j = 0; j < size; j++) {
            row.push({ card: null })
          }
          newState.board.push(row)
        }
        logger.debug(`[applyStateDelta] Board recreated with size ${size}x${size}`)
      }
    }
    if (delta.settingsDelta.gameMode !== undefined) {
      newState.gameMode = delta.settingsDelta.gameMode
      logger.debug(`[applyStateDelta] Game mode changed to ${delta.settingsDelta.gameMode}`)
    }
    if (delta.settingsDelta.isPrivate !== undefined) {
      newState.isPrivate = delta.settingsDelta.isPrivate
      logger.debug(`[applyStateDelta] Game privacy changed to ${delta.settingsDelta.isPrivate}`)
    }
    if (delta.settingsDelta.dummyPlayerCount !== undefined) {
      newState.dummyPlayerCount = delta.settingsDelta.dummyPlayerCount
      logger.debug(`[applyStateDelta] Dummy player count changed to ${delta.settingsDelta.dummyPlayerCount}`)
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

  // Apply ability mode changes (for P2P visual sync)
  if (delta.abilityModeDelta) {
    newState.abilityMode = delta.abilityModeDelta
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

  // Detect settings changes
  if (oldState.activeGridSize !== newState.activeGridSize ||
      oldState.gameMode !== newState.gameMode ||
      oldState.isPrivate !== newState.isPrivate ||
      oldState.dummyPlayerCount !== newState.dummyPlayerCount) {
    delta.settingsDelta = {
      ...(oldState.activeGridSize !== newState.activeGridSize && { activeGridSize: newState.activeGridSize }),
      ...(oldState.gameMode !== newState.gameMode && { gameMode: newState.gameMode }),
      ...(oldState.isPrivate !== newState.isPrivate && { isPrivate: newState.isPrivate }),
      ...(oldState.dummyPlayerCount !== newState.dummyPlayerCount && { dummyPlayerCount: newState.dummyPlayerCount })
    }
    logger.debug(`[createDeltaFromStates] Settings changed:`, delta.settingsDelta)
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
      if (!oldCell && !newCell) {continue}

      // Check if card changed (handle undefined cells)
      const oldCardId = oldCell?.card?.id
      const newCardId = newCell?.card?.id

      if (oldCardId !== newCardId) {
        const statusCount = newCell?.card?.statuses?.length || 0
        const statusTypes = newCell?.card?.statuses?.map(s => s.type).join(',') || 'none'
        logger.debug(`[createDeltaFromStates] Cell [${r},${c}]: card changed, new card: ${newCell?.card?.name || 'null'}, statuses: [${statusTypes}] (count: ${statusCount})`)
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

        // Log status arrays for debugging (only when they exist)
        if (oldStatuses.length > 0 || newStatuses.length > 0) {
          const oldStatusTypes = oldStatuses.map(s => s.type).join(',')
          const newStatusTypes = newStatuses.map(s => s.type).join(',')
          if (oldStatusTypes !== newStatusTypes) {
            logger.debug(`[createDeltaFromStates] Cell [${r},${c}] (${newCell.card.name}): statuses differ - old: [${oldStatusTypes}], new: [${newStatusTypes}]`)
          }
        }

        // Collect added/removed/replaced statuses
        const addedStatuses: any[] = []
        const removedStatusTypes: string[] = []

        if (oldStatuses.length !== newStatuses.length) {
          // Length changed - use comprehensive comparison to find actual differences
          // This handles the case where statuses are removed from the middle using filter()
          // Create Maps for comparison (keyed by type+addedByPlayerId to handle duplicates)
          const oldStatusMap = new Map<string, any[]>()
          const newStatusMap = new Map<string, any[]>()

          for (const s of oldStatuses) {
            const key = `${s.type}_${s.addedByPlayerId}`
            if (!oldStatusMap.has(key)) {oldStatusMap.set(key, [])}
            oldStatusMap.get(key)!.push(s)
          }

          for (const s of newStatuses) {
            const key = `${s.type}_${s.addedByPlayerId}`
            if (!newStatusMap.has(key)) {newStatusMap.set(key, [])}
            newStatusMap.get(key)!.push(s)
          }

          // Find removed statuses (in old but not in new, or count decreased)
          for (const [key, oldList] of oldStatusMap) {
            const newList = newStatusMap.get(key)
            const oldCount = oldList.length
            const newCount = newList ? newList.length : 0

            if (newCount < oldCount) {
              // Some of these statuses were removed
              const removeCount = oldCount - newCount
              for (let i = 0; i < removeCount; i++) {
                removedStatusTypes.push(oldList[i].type)
              }
            }
          }

          // Find added statuses (in new but not in old, or count increased)
          for (const [key, newList] of newStatusMap) {
            const oldList = oldStatusMap.get(key)
            const newCount = newList.length
            const oldCount = oldList ? oldList.length : 0

            if (newCount > oldCount) {
              // Some of these statuses were added
              for (let i = oldCount; i < newCount; i++) {
                addedStatuses.push(newList[i])
              }
            }
          }

          logger.debug(`[createDeltaFromStates] Cell [${r},${c}]: status length changed ${oldStatuses.length} -> ${newStatuses.length}, added: ${addedStatuses.length}, removed: ${removedStatusTypes.join(',')}`)
        } else {
          // Same length - check for status replacements (e.g., ready → anotherStatus)
          for (let i = 0; i < oldStatuses.length; i++) {
            const oldStatus = oldStatuses[i]
            const newStatus = newStatuses[i]
            // Compare by type and addedByPlayerId to detect replacements
            if (oldStatus.type !== newStatus.type ||
                oldStatus.addedByPlayerId !== newStatus.addedByPlayerId) {
              // Status was replaced - remove old, add new
              removedStatusTypes.push(oldStatus.type)
              addedStatuses.push(newStatus)
              logger.debug(`[createDeltaFromStates] Cell [${r},${c}]: status replaced at index ${i}: ${oldStatus.type} -> ${newStatus.type}`)
            }
          }
        }

        if (addedStatuses.length > 0 || removedStatusTypes.length > 0) {
          cellDelta.cardStatuses = {
            ...(addedStatuses.length > 0 && { add: addedStatuses }),
            ...(removedStatusTypes.length > 0 && { remove: removedStatusTypes })
          }
          logger.debug(`[createDeltaFromStates] Cell [${r},${c}]: cardStatuses delta created, remove: [${removedStatusTypes.join(',')}], add: ${addedStatuses.map(s => s.type).join(',')}`)
        }

        // Check power changes (explicit number comparison)
        const oldPower = Number(oldCell?.card?.power ?? 0)
        const newPower = Number(newCell?.card?.power ?? 0)
        if (oldPower !== newPower) {
          cellDelta.cardPowerDelta = newPower - oldPower
        }

        // Check powerModifier changes (used for abilities like Walking Turret)
        const oldPowerModifier = oldCell?.card?.powerModifier
        const newPowerModifier = newCell?.card?.powerModifier
        if (oldPowerModifier !== newPowerModifier) {
          cellDelta.cardPowerModifier = newPowerModifier
          logger.debug(`[createDeltaFromStates] Power modifier changed at [${r},${c}]: ${oldPowerModifier} -> ${newPowerModifier}`)
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

    // NEW PLAYER ADDED (e.g., dummy player added)
    if (!oldPlayer) {
      logger.debug(`[createDeltaFromStates] New player added: ${newPlayer.id} (${newPlayer.name}), isDummy=${newPlayer.isDummy}`)

      const playerDelta: PlayerDelta = {
        id: newPlayer.id,
        // Send all initial data for new player
        name: newPlayer.name,
        color: newPlayer.color,
        isDummy: newPlayer.isDummy,
        isReady: newPlayer.isReady,
        selectedDeck: newPlayer.selectedDeck,
        isDisconnected: newPlayer.isDisconnected,
        // Send hand/deck/discard sizes only (to avoid WebRTC size limit)
        // Guests will generate dummy cards locally using createDeck()
        handSizeDelta: newPlayer.hand.length,
        deckSizeDelta: newPlayer.deck.length,
        discardSizeDelta: newPlayer.discard.length,
        announcedCard: newPlayer.announcedCard
      }
      playerDeltas[newPlayer.id] = playerDelta
      logger.debug(`[createDeltaFromStates] New player delta: sizes hand=${newPlayer.hand.length}, deck=${newPlayer.deck.length}, discard=${newPlayer.discard.length}`)
      continue
    }

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
    // For dummy players: send FULL hand only during game start (when hand goes from 0 to cards)
    // NEVER send full deck - too large for WebRTC! Guests will generate deck locally using createDeck()
    // For real players: always send ONLY size deltas (privacy - don't reveal their cards)
    if (newPlayer.isDummy) {
      // Mark this delta as for a dummy player
      playerDelta.isDummy = true

      // Only send full hand for dummy players during game start (initial draw)
      // When hand size goes from 0 to >0, that's the initial draw
      const isInitialDraw = oldPlayer.hand.length === 0 && newPlayer.hand.length > 0

      if (isInitialDraw) {
        // Game start - send full hand for dummy player so guests can see their cards
        if (newPlayer.hand.length > 0) {
          playerDelta.hand = [...newPlayer.hand]
          logger.debug(`[createDeltaFromStates] Dummy player ${newPlayer.id}: game start, sending full hand (${newPlayer.hand.length} cards)`)
        }
        // IMPORTANT: Never send full deck! Guests will generate it locally using createDeck()
      }

      // Check for hand size changes (send size deltas after initial draw too)
      if (oldPlayer.hand.length !== newPlayer.hand.length) {
        playerDelta.handSizeDelta = newPlayer.hand.length - oldPlayer.hand.length
        logger.debug(`[createDeltaFromStates] Dummy player ${newPlayer.id}: hand size delta: ${playerDelta.handSizeDelta}`)
      }
      // For deck, ALWAYS send only size delta (never full deck - too large)
      if (oldPlayer.deck.length !== newPlayer.deck.length) {
        playerDelta.deckSizeDelta = newPlayer.deck.length - oldPlayer.deck.length
        logger.debug(`[createDeltaFromStates] Dummy player ${newPlayer.id}: deck size delta: ${playerDelta.deckSizeDelta}`)
      }
      if (oldPlayer.discard.length !== newPlayer.discard.length) {
        playerDelta.discardSizeDelta = newPlayer.discard.length - oldPlayer.discard.length
        logger.debug(`[createDeltaFromStates] Dummy player ${newPlayer.id}: discard size delta: ${playerDelta.discardSizeDelta}`)
      }
    } else {
      // Real player - only send size changes (privacy)
      if (oldPlayer.hand.length !== newPlayer.hand.length) {
        playerDelta.handSizeDelta = newPlayer.hand.length - oldPlayer.hand.length
      }
      if (oldPlayer.deck.length !== newPlayer.deck.length) {
        playerDelta.deckSizeDelta = newPlayer.deck.length - oldPlayer.deck.length
      }
      if (oldPlayer.discard.length !== newPlayer.discard.length) {
        playerDelta.discardSizeDelta = newPlayer.discard.length - oldPlayer.discard.length
        // Track actual cards added to discard (for local player to see their own discarded cards)
        if (newPlayer.discard.length > oldPlayer.discard.length) {
          playerDelta.discardAdd = newPlayer.discard.slice(oldPlayer.discard.length)
        }
      }
    }

    // Check announcedCard (showcase) changes
    const oldAnnounced = oldPlayer.announcedCard
    const newAnnounced = newPlayer.announcedCard
    // Compare announced cards (deep comparison of relevant fields)
    const announcedChanged = !oldAnnounced !== !newAnnounced ||
      (oldAnnounced && newAnnounced && (
        oldAnnounced.id !== newAnnounced.id ||
        oldAnnounced.power !== newAnnounced.power ||
        oldAnnounced.powerModifier !== newAnnounced.powerModifier ||
        (oldAnnounced.statuses?.length ?? 0) !== (newAnnounced.statuses?.length ?? 0) ||
        JSON.stringify(oldAnnounced.statuses) !== JSON.stringify(newAnnounced.statuses)
      ))
    if (announcedChanged) {
      playerDelta.announcedCard = newAnnounced ? { ...newAnnounced } : null
      logger.debug(`[createDeltaFromStates] Player ${newPlayer.id} announcedCard changed:`, oldAnnounced?.id, '->', newAnnounced?.id)
    }

    // Check boardHistory changes (for LastPlayed status)
    if (JSON.stringify(oldPlayer.boardHistory) !== JSON.stringify(newPlayer.boardHistory)) {
      playerDelta.boardHistory = [...newPlayer.boardHistory]
    }

    // Check other property changes
    if (oldPlayer.teamId !== newPlayer.teamId) {
      playerDelta.teamId = newPlayer.teamId
    }
    if (oldPlayer.autoDrawEnabled !== newPlayer.autoDrawEnabled) {
      playerDelta.autoDrawEnabled = newPlayer.autoDrawEnabled
    }
    if (oldPlayer.selectedDeck !== newPlayer.selectedDeck) {
      playerDelta.selectedDeck = newPlayer.selectedDeck
      logger.debug(`[createDeltaFromStates] Player ${newPlayer.id} selectedDeck changed: ${oldPlayer.selectedDeck} -> ${newPlayer.selectedDeck}`)
    }

    if (Object.keys(playerDelta).length > 1) { // More than just id
      playerDeltas[newPlayer.id] = playerDelta
    }
  }

  // Check for removed players
  for (const oldPlayer of oldState.players) {
    const newPlayer = newState.players.find(p => p.id === oldPlayer.id)
    if (!newPlayer) {
      // Player was removed - send removal delta
      logger.debug(`[createDeltaFromStates] Player removed: ${oldPlayer.id} (${oldPlayer.name})`)
      playerDeltas[oldPlayer.id] = {
        id: oldPlayer.id,
        removed: true  // Flag to indicate player removal
      }
    }
  }

  if (Object.keys(playerDeltas).length > 0) {
    delta.playerDeltas = playerDeltas
  }

  // Detect ability mode changes (for P2P visual sync)
  if (JSON.stringify(oldState.abilityMode) !== JSON.stringify(newState.abilityMode)) {
    delta.abilityModeDelta = newState.abilityMode
    logger.debug(`[createDeltaFromStates] abilityMode changed:`, oldState.abilityMode?.mode, '->', newState.abilityMode?.mode)
  }

  // Detect targeting mode changes (for P2P visual sync)
  if (JSON.stringify(oldState.targetingMode) !== JSON.stringify(newState.targetingMode)) {
    if (newState.targetingMode === null) {
      delta.targetingModeDelta = { clear: true }
    } else {
      delta.targetingModeDelta = { set: newState.targetingMode }
    }
    logger.debug(`[createDeltaFromStates] targetingMode changed`)
  }

  return delta
}

/**
 * Check if a delta is empty (no actual changes)
 */
export function isDeltaEmpty(delta: StateDelta): boolean {
  return !delta.phaseDelta &&
         !delta.roundDelta &&
         !delta.settingsDelta &&
         !delta.boardCells?.length &&
         !delta.playerDeltas &&
         !delta.highlightsDelta &&
         !delta.floatingTextsDelta &&
         !delta.targetingModeDelta &&
         !delta.abilityModeDelta
}

/**
 * Create a compact reconnection state snapshot
 * This is sent to reconnecting guests to restore their game state
 * WITHOUT sending full card arrays (which are too large for WebRTC JSON channel)
 *
 * Guests will rebuild their state using:
 * - Player metadata (names, colors, ready status, etc.)
 * - Deck/hand/discard sizes only (not full cards)
 * - Board state (full board with cards - needed for game continuity)
 * - Phase/round info
 */
export function createReconnectSnapshot(gameState: GameState, _localPlayerId?: number | null): {
  type: 'RECONNECT_SNAPSHOT'
  data: {
    gameId: string
    gameMode: string
    isPrivate: boolean
    isGameStarted: boolean
    isReadyCheckActive: boolean
    activeGridSize: number
    currentPhase: number
    isScoringStep: boolean
    activePlayerId: number | null
    startingPlayerId: number | null
    currentRound: number
    turnNumber: number
    roundWinners: Record<number, number[]>
    gameWinner: number | null
    isRoundEndModalOpen: boolean
    dummyPlayerCount: number
    players: Array<{
      id: number
      name: string
      color: string
      isDummy: boolean
      isReady: boolean
      isDisconnected: boolean
      score: number
      selectedDeck: DeckType
      autoDrawEnabled: boolean
      teamId?: number
      // Sizes only (not full arrays) - except for board which we need full
      handSize: number
      deckSize: number
      discardSize: number
      announcedCard: any
      boardHistory: any[]
    }>
    board: any[][] // Full board state - needed for game continuity
  }
} {
  return {
    type: 'RECONNECT_SNAPSHOT',
    data: {
      gameId: gameState.gameId ?? '',
      gameMode: gameState.gameMode,
      isPrivate: gameState.isPrivate,
      isGameStarted: gameState.isGameStarted,
      isReadyCheckActive: gameState.isReadyCheckActive,
      activeGridSize: gameState.activeGridSize,
      currentPhase: gameState.currentPhase,
      isScoringStep: gameState.isScoringStep,
      activePlayerId: gameState.activePlayerId,
      startingPlayerId: gameState.startingPlayerId,
      currentRound: gameState.currentRound,
      turnNumber: gameState.turnNumber,
      roundWinners: gameState.roundWinners,
      gameWinner: gameState.gameWinner,
      isRoundEndModalOpen: gameState.isRoundEndModalOpen,
      dummyPlayerCount: gameState.dummyPlayerCount,
      players: gameState.players.map(p => ({
        id: p.id,
        name: p.name,
        color: typeof p.color === 'string' ? p.color : 'blue',
        isDummy: p.isDummy ?? false,
        isReady: p.isReady ?? false,
        isDisconnected: p.isDisconnected ?? false,
        score: p.score,
        selectedDeck: p.selectedDeck,
        autoDrawEnabled: p.autoDrawEnabled ?? false,
        teamId: p.teamId,
        handSize: p.hand.length,
        deckSize: p.deck.length,
        discardSize: p.discard.length,
        announcedCard: p.announcedCard,
        boardHistory: p.boardHistory ?? []
      })),
      board: gameState.board
    }
  }
}
