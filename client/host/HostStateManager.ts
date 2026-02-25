/**
 * Host State Manager
 * Centralized state management for the host
 *
 * Key principle: Host is the "source of truth" for all game state
 * - When host's state changes, broadcast to all guests
 * - When guest sends state change, apply to host state, then broadcast to all guests
 * - Host is also a player, so their actions go through the same pipeline
 */

import type { GameState, StateDelta, Card, DeckType } from '../types'
import type { HostConnectionManager } from './HostConnectionManager'
import type { UltraCompactCardData, UltraCompactCardRef, CompactStatus } from './StatePersonalization'
import { createDeltaFromStates, isDeltaEmpty, applyStateDelta } from '../utils/stateDelta'
import { logger } from '../utils/logger'
import { getCardDefinition } from '../content'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'

/**
 * Reconstruct a full card from ultra-compact data using contentDatabase
 * Uses baseId to get card definition from contentDatabase
 */
function reconstructCardFromUltraCompact(
  ultraCompact: UltraCompactCardData,
  playerDeck: DeckType
): Card {
  const baseId = ultraCompact.baseId || ultraCompact.id
  const cardDef = getCardDefinition(baseId)

  if (!cardDef) {
    logger.warn(`[reconstructCardFromUltraCompact] Card ${baseId} not found in contentDatabase`)
    return {
      id: ultraCompact.id,
      baseId: baseId,
      deck: playerDeck,
      name: 'Unknown',
      imageUrl: '',
      power: 0,
      ability: '',
      types: [],
      isFaceDown: ultraCompact.isFaceDown,
      statuses: ultraCompact.statuses.map((s: CompactStatus) => ({
        type: s.type,
        addedByPlayerId: 0
      }))
    }
  }

  return {
    ...cardDef,
    id: ultraCompact.id,
    baseId: baseId,
    deck: playerDeck,
    isFaceDown: ultraCompact.isFaceDown,
    statuses: ultraCompact.statuses.map((s: CompactStatus) => ({
      type: s.type,
      addedByPlayerId: 0
    }))
  }
}

/**
 * Reconstruct deck from ultra-compact card references (index + baseId)
 * Uses contentDatabase to reconstruct full cards from baseId
 * IMPORTANT: baseId is used instead of id because id is unique per client
 * but baseId is shared across all clients (from contentDatabase)
 */
function reconstructDeckFromRefs(
  deckCardRefs: UltraCompactCardRef[],
  playerDeck: DeckType,
  existingDeck: Card[]
): Card[] {
  if (!deckCardRefs || deckCardRefs.length === 0) {
    return existingDeck
  }

  // Create a map of baseId to card definition from existing deck (to preserve IDs if possible)
  const cardMap = new Map<string, Card>()
  for (const card of existingDeck) {
    const baseId = card.baseId || card.id
    cardMap.set(baseId, card)
  }

  // Reconstruct deck in the order specified by refs
  const reconstructed: Card[] = []
  for (const ref of deckCardRefs) {
    // Use baseId directly from ref (it's now baseId, not id)
    const baseId = ref.baseId
    const existingCard = cardMap.get(baseId)

    if (existingCard) {
      // Card exists in existing deck, preserve its ID
      const cardDef = getCardDefinition(baseId)
      if (cardDef) {
        reconstructed.push({
          ...cardDef,
          id: existingCard.id,  // Preserve existing ID
          baseId: baseId,
          deck: playerDeck,
          isFaceDown: true,
          statuses: []
        })
      } else {
        logger.warn(`[reconstructDeckFromRefs] Card ${baseId} not found in contentDatabase`)
        // Fallback to existing card
        reconstructed.push(existingCard)
      }
    } else {
      // Card not in existing deck, create new from contentDatabase
      const cardDef = getCardDefinition(baseId)
      if (cardDef) {
        // Generate a unique ID for new card
        const uniqueId = `${baseId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        reconstructed.push({
          ...cardDef,
          id: uniqueId,
          baseId: baseId,
          deck: playerDeck,
          isFaceDown: true,
          statuses: []
        })
      } else {
        logger.warn(`[reconstructDeckFromRefs] Card ${baseId} not found in contentDatabase and not in existing deck`)
      }
    }
  }

  return reconstructed
}

export interface StateUpdateOptions {
  excludeSender?: boolean  // Don't send back to the player who made the change
  sourcePlayerId?: number   // Which player made the change
}

export class HostStateManager {
  private connectionManager: HostConnectionManager
  private currentState: GameState | null = null
  private localPlayerId: number | null = null
  // Track last broadcast state hash to prevent echo loops
  private lastBroadcastStateHash: string = ''
  private lastBroadcastTimestamp: number = 0
  // Track game start timestamp to ignore stale guest updates
  private gameStartTimestamp: number = 0

  constructor(connectionManager: HostConnectionManager) {
    this.connectionManager = connectionManager
  }

  /**
   * Set the initial game state
   * IMPORTANT: If game has already started, only update deck/selectedDeck properties to avoid losing game progress
   */
  setInitialState(state: GameState): GameState | null {
    // Validate state before setting
    logger.info(`[HostStateManager] setInitialState called: state=${!!state}, players=${state?.players?.length || 0}, gameId=${state?.gameId}, localPlayerId=${this.localPlayerId}`)
    if (!state || !state.players || state.players.length === 0) {
      logger.error('[HostStateManager] Invalid initial state - no players, rejecting')
      return null
    }

    // If game has already started, don't overwrite the entire state
    // Only update deck/selectedDeck/hand/discard properties for each player
    // BUT also update abilityMode and targetingMode (needed for scoring mode)
    // CRITICAL: Also update handSize, deckSize, discardSize for proper UI sync
    if (this.currentState?.isGameStarted) {
      logger.info('[HostStateManager] Game already started, merging deck data and mode properties instead of overwriting state')
      logger.info('[HostStateManager] Incoming abilityMode:', state.abilityMode)
      logger.info('[HostStateManager] Incoming targetingMode:', state.targetingMode)

      // Merge deck data from incoming state into current state
      const updatedPlayers = this.currentState.players.map(currentPlayer => {
        const incomingPlayer = state.players.find(p => p.id === currentPlayer.id)
        if (incomingPlayer) {
          const oldHandSize = currentPlayer.handSize ?? currentPlayer.hand?.length ?? 0
          const oldDeckSize = currentPlayer.deckSize ?? currentPlayer.deck?.length ?? 0
          const newHandSize = incomingPlayer.handSize ?? incomingPlayer.hand?.length ?? 0
          const newDeckSize = incomingPlayer.deckSize ?? incomingPlayer.deck?.length ?? 0

          // Log if sizes changed (e.g., auto-draw happened)
          if (oldHandSize !== newHandSize || oldDeckSize !== newDeckSize) {
            logger.info(`[HostStateManager] Player ${currentPlayer.id} size changed: hand ${oldHandSize}->${newHandSize}, deck ${oldDeckSize}->${newDeckSize}`)
          }

          // Check if incoming player has ultra-compact data (means this player sent their own cards)
          const hasUltraCompactData = (incomingPlayer as any).handCards?.length > 0 ||
                                       (incomingPlayer as any).deckCardRefs?.length > 0 ||
                                       (incomingPlayer as any).discardCards?.length > 0

          // Check if incoming state has actual card data (not just empty arrays)
          const hasIncomingHandData = incomingPlayer.hand && incomingPlayer.hand.length > 0
          const hasIncomingDeckData = incomingPlayer.deck && incomingPlayer.deck.length > 0
          const hasIncomingDiscardData = incomingPlayer.discard && incomingPlayer.discard.length > 0

          return {
            ...currentPlayer,
            // CRITICAL: Update hand, deck, discard from incoming state
            // Only update if incoming state has actual data (array with items) OR ultra-compact data
            // NEVER replace existing data with empty arrays from other players' states
            hand: (hasIncomingHandData || hasUltraCompactData) ? incomingPlayer.hand : currentPlayer.hand,
            deck: (hasIncomingDeckData || hasUltraCompactData) ? incomingPlayer.deck : currentPlayer.deck,
            discard: (hasIncomingDiscardData || hasUltraCompactData) ? incomingPlayer.discard : currentPlayer.discard,
            selectedDeck: incomingPlayer.selectedDeck || currentPlayer.selectedDeck,
            // CRITICAL: Update size properties - ONLY if incoming has valid data
            // Don't let empty states (0 sizes) overwrite existing valid sizes
            handSize: (hasIncomingHandData || hasUltraCompactData)
              ? (incomingPlayer.handSize ?? incomingPlayer.hand?.length ?? currentPlayer.handSize)
              : (currentPlayer.handSize ?? currentPlayer.hand?.length),
            deckSize: (hasIncomingDeckData || hasUltraCompactData)
              ? (incomingPlayer.deckSize ?? incomingPlayer.deck?.length ?? currentPlayer.deckSize)
              : (currentPlayer.deckSize ?? currentPlayer.deck?.length),
            discardSize: (hasIncomingDiscardData || hasUltraCompactData)
              ? (incomingPlayer.discardSize ?? incomingPlayer.discard?.length ?? currentPlayer.discardSize)
              : (currentPlayer.discardSize ?? currentPlayer.discard?.length)
          }
        }
        return currentPlayer
      })
      this.currentState = {
        ...this.currentState,
        players: updatedPlayers,
        // CRITICAL: Also update abilityMode and targetingMode for scoring mode
        abilityMode: state.abilityMode,
        targetingMode: state.targetingMode,
      }
      logger.info('[HostStateManager] After merge - abilityMode:', this.currentState.abilityMode)
      logger.info('[HostStateManager] After merge - targetingMode:', this.currentState.targetingMode)
      return this.currentState  // Return updated state so caller can use it
    }

    this.currentState = state

    // If localPlayerId is not set yet, default to player 1 (host is always player 1)
    if (!this.localPlayerId && state.players.length > 0) {
      this.localPlayerId = state.players[0].id
      logger.info(`[HostStateManager] Auto-set localPlayerId to ${this.localPlayerId} (first player)`)
    }

    logger.info('[HostStateManager] Initial state set with ' + state.players.length + ' players')
    return this.currentState
  }

  /**
   * Set the local player (host's player) ID
   */
  setLocalPlayerId(playerId: number): void {
    this.localPlayerId = playerId
    logger.info(`[HostStateManager] Local player ID set to ${playerId}`)
  }

  /**
   * Get the current game state
   */
  getState(): GameState | null {
    return this.currentState
  }

  /**
   * Get the local player (host's player) ID
   */
  getLocalPlayerId(): number | null {
    return this.localPlayerId
  }

  /**
   * Update state from local (host) action
   * Called when host (as a player) makes an action
   */
  updateFromLocal(newState: GameState, excludePeerId?: string): void {
    // Validate new state
    if (!newState || !newState.players || newState.players.length === 0) {
      logger.error('[HostStateManager] Invalid newState - no players, rejecting update')
      return
    }

    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, setting as initial')
      this.currentState = newState
      return
    }

    const oldState = this.currentState

    // CRITICAL: Preserve abilityMode and targetingMode from current state
    // These are set by abilities/scoring mode and should persist across local updates
    const mergedState: GameState = {
      ...newState,
      abilityMode: newState.abilityMode ?? oldState.abilityMode,
      targetingMode: newState.targetingMode ?? oldState.targetingMode,
    }

    const delta = createDeltaFromStates(oldState, mergedState, this.localPlayerId || 0)
    this.currentState = mergedState

    // Broadcast to all guests
    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta, excludePeerId)
    } else {
      this.connectionManager.broadcastGameState(mergedState, excludePeerId)
    }
  }

  /**
   * Update state from guest action
   * Called when a guest sends a state update or delta
   *
   * ULTRA-COMPACT FORMAT SUPPORT:
   * - handCards: [{ id, baseId, isFaceDown, statuses: [{type}] }]
   * - deckCardRefs: [{ index, id }] - reconstruct using contentDatabase
   * - discardCards: [{ id, baseId, isFaceDown, statuses: [{type}] }]
   *
   * @returns The final state after all updates
   */
  updateFromGuest(guestPlayerId: number, guestState: GameState, excludePeerId?: string): GameState | null {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, ignoring guest update')
      return null
    }

    // ANTI-ECHO: Check if this guest is echoing back the state we just broadcast
    // Compare key state properties to detect if guest is just reflecting our own broadcast
    const guestHash = this.quickHashState(guestState)
    if (guestHash === this.lastBroadcastStateHash && Date.now() - this.lastBroadcastTimestamp < 1000) {
      logger.debug(`[HostStateManager] Ignoring echo from guest ${guestPlayerId} (state matches last broadcast)`)
      return null
    }

    // Merge guest state with host state
    const mergedPlayers = this.currentState.players.map(hostPlayer => {
      const guestPlayer = guestState.players.find(p => p.id === hostPlayer.id)

      if (!guestPlayer) {
        // Guest doesn't have this player in their state (shouldn't happen)
        return hostPlayer
      }

      if (guestPlayer.id === guestPlayerId) {
        // This is the guest who sent the update
        // Check if guest sent ultra-compact data
        const hasUltraCompactData = (guestPlayer as any).handCards?.length > 0 ||
                                     (guestPlayer as any).deckCardRefs?.length > 0 ||
                                     (guestPlayer as any).discardCards?.length > 0

        // CRITICAL: Ignore stale STATE_UPDATE_COMPACT with empty hand after game has started
        // Guests send empty state when clicking "Ready" (before GAME_STARTING)
        // After GAME_STARTING, they send actual cards - ignore stale empty hand messages
        const isGameStarted = this.currentState?.isGameStarted ?? false
        const guestHandIsEmpty = !guestPlayer.hand || guestPlayer.hand.length === 0

        if (isGameStarted && !hasUltraCompactData && guestHandIsEmpty) {
          logger.info(`[HostStateManager] Ignoring stale STATE_UPDATE_COMPACT from guest ${guestPlayerId} (game started, hand empty, no ultra-compact data)`)
          return hostPlayer // Keep host state for this player
        }

        if (hasUltraCompactData) {
          // Reconstruct hand from ultra-compact handCards
          let reconstructedHand = hostPlayer.hand
          if ((guestPlayer as any).handCards) {
            const handCards = (guestPlayer as any).handCards as UltraCompactCardData[]
            logger.info(`[HostStateManager] Guest ${guestPlayerId} reconstructing hand: ${handCards.length} cards`)
            reconstructedHand = handCards.map(hc => reconstructCardFromUltraCompact(hc, hostPlayer.selectedDeck))
          }

          // CRITICAL: Always trust guest's deck data for their own deck
          // Each player is authoritative for their own deck/hand/discard in WebRTC P2P mode
          // When guest draws a card (manually or auto-draw), they send the updated state
          // and host must apply it to stay in sync
          let reconstructedDeck = hostPlayer.deck
          if ((guestPlayer as any).deckCardRefs) {
            // Reconstruct deck from guest's refs - guest has authoritative data
            const deckCardRefs = (guestPlayer as any).deckCardRefs as UltraCompactCardRef[]
            reconstructedDeck = reconstructDeckFromRefs(deckCardRefs, hostPlayer.selectedDeck, hostPlayer.deck)
            logger.info(`[HostStateManager] Guest ${guestPlayerId} reconstructed deck from ${deckCardRefs.length} refs (authoritative)`)
          }

          // Reconstruct discard from ultra-compact discardCards
          let reconstructedDiscard = hostPlayer.discard
          if ((guestPlayer as any).discardCards) {
            const discardCards = (guestPlayer as any).discardCards as UltraCompactCardData[]
            reconstructedDiscard = discardCards.map(dc => reconstructCardFromUltraCompact(dc, hostPlayer.selectedDeck))
          }

          const merged = {
            ...guestPlayer,
            hand: reconstructedHand,
            deck: reconstructedDeck,
            discard: reconstructedDiscard,
            // CRITICAL: Update size metadata to match reconstructed arrays
            handSize: reconstructedHand.length,
            deckSize: reconstructedDeck.length,
            discardSize: reconstructedDiscard.length,
            // Remove temporary properties
            handCards: undefined,
            deckCardRefs: undefined,
            discardCards: undefined,
          }
          logger.info(`[HostStateManager] Guest ${guestPlayerId} merged: hand=${merged.handSize}, deck=${merged.deckSize}, discard=${merged.discardSize}, score=${merged.score}`)
          return merged
        }

        // No ultra-compact data, use guest state but preserve host's deck/discard
        const merged = {
          ...guestPlayer,
          deck: hostPlayer.deck,
          discard: hostPlayer.discard,
          hand: hostPlayer.hand,  // Also preserve hand from host
          // CRITICAL: Override sizes to match actual arrays (guest sizes may be stale)
          handSize: hostPlayer.hand.length,
          deckSize: hostPlayer.deck.length,
          discardSize: hostPlayer.discard.length,
        }
        logger.info(`[HostStateManager] Guest ${guestPlayerId} merged: hand=${merged.handSize}, deck=${merged.deckSize}, score=${merged.score}`)
        return merged
      }

      // For other players, prefer host state but take non-sensitive updates
      const merged = {
        ...hostPlayer,
        // Take safe updates from guest state
        isReady: guestPlayer.isReady,
        score: guestPlayer.score,
        // Don't take hand/deck/discard (privacy and host authority)
        hand: hostPlayer.hand,
        deck: hostPlayer.deck,
        discard: hostPlayer.discard,
      }
      // Debug log to verify hand/deck sizes are preserved
      if (hostPlayer.id !== guestPlayerId && (hostPlayer.handSize !== merged.handSize || hostPlayer.deckSize !== merged.deckSize)) {
        logger.warn(`[HostStateManager] Player ${hostPlayer.id} size mismatch after merge: host hand=${hostPlayer.handSize}/${hostPlayer.deck?.length}, merged hand=${merged.handSize}/${merged.deckSize}`)
      }
      return merged
    })

    // Simple merge - take guest state but preserve host's authoritative fields
    const oldState = this.currentState
    let newState: GameState = {
      ...guestState,
      players: mergedPlayers,
      // Use guest's board - it contains the latest changes
      board: guestState.board,
      // CRITICAL: Preserve phase info from current state (guest state may not have it)
      // These are managed by host's PhaseManager and should not be overwritten by guest state
      currentPhase: oldState.currentPhase,
      activePlayerId: oldState.activePlayerId,
      startingPlayerId: oldState.startingPlayerId,
      currentRound: oldState.currentRound,
      turnNumber: oldState.turnNumber,
      isGameStarted: oldState.isGameStarted,
      isReadyCheckActive: oldState.isReadyCheckActive,
      isScoringStep: oldState.isScoringStep,
      roundWinners: oldState.roundWinners,
      gameWinner: oldState.gameWinner,
      isRoundEndModalOpen: oldState.isRoundEndModalOpen,
      // CRITICAL: Preserve abilityMode and targetingMode from current state
      // Guest doesn't send these in STATE_UPDATE_COMPACT, so we must preserve them
      abilityMode: oldState.abilityMode,
      targetingMode: oldState.targetingMode,
    }

    // CRITICAL: Recalculate board statuses after any guest update
    // This ensures Support/Threat tokens are correctly updated after card movements
    newState = { ...newState, board: recalculateBoardStatuses(newState) }

    // Create delta and broadcast
    const delta = createDeltaFromStates(oldState, newState, guestPlayerId)
    this.currentState = newState

    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta, excludePeerId)
      logger.info(`[HostStateManager] Guest ${guestPlayerId} update broadcast`)
    } else {
      // Pass guestPlayerId as authorPlayerId so guests can ignore their own updates (echo prevention)
      this.connectionManager.broadcastGameState(newState, excludePeerId, guestPlayerId)
      // Update broadcast hash to prevent echo loops
      this.lastBroadcastStateHash = this.quickHashState(newState)
      this.lastBroadcastTimestamp = Date.now()
    }

    return this.currentState
  }

  /**
   * Update state from guest delta (more efficient)
   */
  applyDeltaFromGuest(guestPlayerId: number, delta: StateDelta, senderPeerId: string): void {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, ignoring guest delta')
      return
    }

    const oldState = this.currentState
    let newState = applyStateDelta(oldState, delta, guestPlayerId)

    // CRITICAL: Preserve authoritative fields from current state (host-managed)
    // Guest deltas don't include these phase/game management fields, so we must preserve them
    // These are managed by host's PhaseManager and should not be overwritten by guest updates
    newState = {
      ...newState,
      // Phase management fields (managed by PhaseManager)
      currentPhase: oldState.currentPhase,
      activePlayerId: oldState.activePlayerId,
      startingPlayerId: oldState.startingPlayerId,
      currentRound: oldState.currentRound,
      turnNumber: oldState.turnNumber,
      // Game state flags
      isGameStarted: oldState.isGameStarted,
      isReadyCheckActive: oldState.isReadyCheckActive,
      isScoringStep: oldState.isScoringStep,
      roundWinners: oldState.roundWinners,
      gameWinner: oldState.gameWinner,
      isRoundEndModalOpen: oldState.isRoundEndModalOpen,
      // Visual interaction modes
      abilityMode: oldState.abilityMode,
      targetingMode: oldState.targetingMode,
    }

    // CRITICAL: Recalculate board statuses after any guest delta
    // This ensures Support/Threat tokens are correctly updated after card movements
    newState = { ...newState, board: recalculateBoardStatuses(newState) }

    const newDelta = createDeltaFromStates(oldState, newState, guestPlayerId)
    this.currentState = newState

    if (!isDeltaEmpty(newDelta)) {
      this.broadcastDelta(newDelta, senderPeerId)
    } else {
      // Pass guestPlayerId as authorPlayerId so guests can ignore their own updates (echo prevention)
      this.connectionManager.broadcastGameState(newState, senderPeerId, guestPlayerId)
    }
  }

  /**
   * Broadcast delta to all guests
   */
  private broadcastDelta(delta: StateDelta, excludePeerId?: string): void {
    this.connectionManager.broadcastStateDelta(delta, excludePeerId)
    // Update broadcast hash to prevent echo loops
    if (this.currentState) {
      this.lastBroadcastStateHash = this.quickHashState(this.currentState)
      this.lastBroadcastTimestamp = Date.now()
    }
  }

  /**
   * Broadcast full state to all guests (use sparingly)
   */
  broadcastFullState(excludePeerId?: string): void {
    if (!this.currentState) {return}
    this.connectionManager.broadcastGameState(this.currentState, excludePeerId)
    // Update broadcast hash to prevent echo loops
    this.lastBroadcastStateHash = this.quickHashState(this.currentState)
    this.lastBroadcastTimestamp = Date.now()
  }

  /**
   * Create a quick hash of state for comparison
   * Used to detect echo loops where guests reflect back our own broadcasts
   */
  private quickHashState(state: GameState): string {
    // Hash only the most important fields that change frequently
    return `${state.currentPhase}-${state.activePlayerId}-${state.players.map(p => `${p.id}:${p.handSize}:${p.deckSize}:${p.score}`).join('|')}`
  }

  /**
   * Start ready check
   */
  startReadyCheck(): void {
    if (!this.currentState) {return}

    const updatedState: GameState = {
      ...this.currentState,
      isReadyCheckActive: true
    }

    const delta = createDeltaFromStates(this.currentState, updatedState, this.localPlayerId || 0)
    this.currentState = updatedState

    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta)
    } else {
      // Delta system is stub, broadcast full state
      this.connectionManager.broadcastGameState(updatedState)
    }
  }

  /**
   * Cancel ready check
   */
  cancelReadyCheck(): void {
    if (!this.currentState) {return}

    const updatedState: GameState = {
      ...this.currentState,
      isReadyCheckActive: false
    }

    const delta = createDeltaFromStates(this.currentState, updatedState, this.localPlayerId || 0)
    this.currentState = updatedState

    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta)
    } else {
      // Delta system is stub, broadcast full state
      this.connectionManager.broadcastGameState(updatedState)
    }
  }

  /**
   * Update player property (name, color, deck, etc.)
   * @param skipBroadcast - if true, don't broadcast (used when game start will broadcast immediately after)
   */
  updatePlayerProperty(playerId: number, properties: Partial<GameState['players'][0]>, skipBroadcast: boolean = false): void {
    if (!this.currentState) {return}

    const updatedPlayers = this.currentState.players.map(p =>
      p.id === playerId ? { ...p, ...properties } : p
    )

    const updatedState: GameState = {
      ...this.currentState,
      players: updatedPlayers
    }

    const delta = createDeltaFromStates(this.currentState, updatedState, this.localPlayerId || 0)
    this.currentState = updatedState

    // Skip broadcast if requested (e.g., when game start will broadcast immediately)
    if (skipBroadcast) {
      logger.info(`[HostStateManager] Skipped broadcast for player ${playerId} property update (skipBroadcast=true)`)
      return
    }

    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta)
    } else {
      // Delta system is stub, broadcast full state
      this.connectionManager.broadcastGameState(updatedState)
    }
  }

  /**
   * Mark player as ready
   * IMPORTANT: If this makes all players ready, we skip the intermediate broadcast
   * and only broadcast the final game-started state to avoid race conditions
   */
  setPlayerReady(playerId: number, isReady: boolean): void {
    logger.info(`[HostStateManager] setPlayerReady called: playerId=${playerId}, isReady=${isReady}, hasState=${!!this.currentState}`)

    // Check if marking this player ready will start the game
    // We need to check BEFORE calling updatePlayerProperty
    let willStartGame = false
    if (isReady && this.currentState) {
      const realPlayers = this.currentState.players.filter(p => !p.isDummy && !p.isDisconnected)
      // Check if all OTHER players are already ready (or if this is the only real player)
      const otherPlayers = realPlayers.filter(p => p.id !== playerId)
      const otherPlayersReady = otherPlayers.length === 0 || otherPlayers.every(p => p.isReady)
      willStartGame = otherPlayersReady
      logger.info(`[HostStateManager] Will start game after marking player ${playerId} ready: ${willStartGame} (otherPlayers=${otherPlayers.length}, allReady=${otherPlayersReady})`)
    }

    // Update player ready status
    // Skip broadcast if game will start immediately after (prevents race condition)
    this.updatePlayerProperty(playerId, { isReady }, willStartGame)

    // Check if all real players are ready
    if (isReady && this.currentState) {
      const realPlayers = this.currentState.players.filter(p => !p.isDummy && !p.isDisconnected)
      const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady)

      logger.info(`[HostStateManager] Ready check: realPlayers=${realPlayers.length}, allReady=${allReady}, gameStarted=${this.currentState.isGameStarted}`)

      if (allReady && !this.currentState.isGameStarted) {
        this.startGame()
      }
    } else if (!this.currentState) {
      logger.warn('[HostStateManager] No current state - cannot check ready status')
    }
  }

  /**
   * Start the game
   * NOTE: This method is OVERRIDDEN by HostPhaseIntegration.initializePhaseSystem
   * to use PhaseManager for proper phase management including auto-draw.
   * The override handles drawing initial 6 cards, then calls PhaseManager.startGame
   * which draws the 7th card for the starting player in Preparation phase.
   */
  startGame(): void {
    // This is a stub - the actual implementation is provided by HostPhaseIntegration
    // which overrides this method after PhaseManager is initialized
    logger.warn('[HostStateManager] startGame called but PhaseManager is not initialized yet. This should not happen after initialization.')
  }

  /**
   * Get state for new guest (minimal, privacy-preserving)
   */
  getStateForGuest(): any {
    if (!this.currentState) {return null}

    return {
      gameId: this.currentState.gameId,
      isGameStarted: this.currentState.isGameStarted,
      isPrivate: this.currentState.isPrivate,
      activeGridSize: this.currentState.activeGridSize,
      gameMode: this.currentState.gameMode,
      dummyPlayerCount: this.currentState.dummyPlayerCount,
      players: this.currentState.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isDummy: p.isDummy,
        isReady: p.isReady,
        isDisconnected: p.isDisconnected,
        score: p.score,
        selectedDeck: p.selectedDeck,
        deckSize: p.deck.length,
        handSize: p.hand.length,
        discardSize: p.discard.length,
        autoDrawEnabled: p.autoDrawEnabled,
      })),
      deckSelections: this.currentState.players.map(p => ({ id: p.id, selectedDeck: p.selectedDeck })),
      currentRound: this.currentState.currentRound,
      currentPhase: this.currentState.currentPhase,
      activePlayerId: this.currentState.activePlayerId,
      startingPlayerId: this.currentState.startingPlayerId,
    }
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.currentState = null
    this.localPlayerId = null
  }

  /**
   * Set targeting mode (from guest action)
   * Updates internal state and broadcasts to all guests
   */
  setTargetingMode(targetingMode: any, excludePeerId?: string): void {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, ignoring targeting mode')
      return
    }

    const oldState = this.currentState
    const newState: GameState = {
      ...oldState,
      targetingMode
    }

    this.currentState = newState

    // Broadcast targeting mode via dedicated message (not via CARD_STATE)
    // This ensures targetingMode is properly synchronized even though it's not in the binary codec
    this.connectionManager.broadcast({
      type: 'SET_TARGETING_MODE',
      senderId: this.connectionManager.getPeerId(),
      data: { targetingMode },
      timestamp: Date.now()
    }, excludePeerId)

    logger.info(`[HostStateManager] Targeting mode set by player ${targetingMode.playerId}, broadcasting SET_TARGETING_MODE to all guests`)
  }

  /**
   * Clear targeting mode
   */
  clearTargetingMode(excludePeerId?: string): void {
    if (!this.currentState) {
      return
    }

    const oldState = this.currentState
    const newState: GameState = {
      ...oldState,
      targetingMode: null
    }

    this.currentState = newState

    // Broadcast targeting mode clear via dedicated message
    this.connectionManager.broadcast({
      type: 'CLEAR_TARGETING_MODE',
      senderId: this.connectionManager.getPeerId(),
      data: { timestamp: Date.now() },
      timestamp: Date.now()
    }, excludePeerId)

    logger.info('[HostStateManager] Targeting mode cleared, broadcasting CLEAR_TARGETING_MODE to all guests')
  }
}
