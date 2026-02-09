/**
 * Host State Manager
 * Centralized state management for the host
 *
 * Key principle: Host is the "source of truth" for all game state
 * - When host's state changes, broadcast to all guests
 * - When guest sends state change, apply to host state, then broadcast to all guests
 * - Host is also a player, so their actions go through the same pipeline
 */

import type { GameState, StateDelta } from '../types'
import type { HostConnectionManager } from './HostConnectionManager'
import { createDeltaFromStates, isDeltaEmpty } from '../utils/stateDelta'
import { logger } from '../utils/logger'

export interface StateUpdateOptions {
  excludeSender?: boolean  // Don't send back to the player who made the change
  sourcePlayerId?: number   // Which player made the change
}

export class HostStateManager {
  private connectionManager: HostConnectionManager
  private currentState: GameState | null = null
  private localPlayerId: number | null = null

  constructor(connectionManager: HostConnectionManager) {
    this.connectionManager = connectionManager
  }

  /**
   * Set the initial game state
   */
  setInitialState(state: GameState): void {
    this.currentState = state
    logger.info('[HostStateManager] Initial state set')
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
   * Update state from local (host) action
   * Called when host (as a player) makes an action
   */
  updateFromLocal(newState: GameState): void {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, setting as initial')
      this.currentState = newState
      return
    }

    // Create delta from old state to new state
    const delta = createDeltaFromStates(this.currentState, newState, this.localPlayerId || 0)

    // Update internal state
    this.currentState = newState

    // Broadcast delta to all guests
    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta)
      logger.info(`[HostStateManager] Local change broadcast: phase=${!!delta.phaseDelta}, players=${Object.keys(delta.playerDeltas || {}).length}`)
    }
  }

  /**
   * Update state from guest action
   * Called when a guest sends a state update or delta
   */
  updateFromGuest(guestPlayerId: number, guestState: GameState, excludePeerId?: string): void {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, ignoring guest update')
      return
    }

    // Merge guest state with host state
    // Preserve deck/discard for players that aren't the guest
    const mergedPlayers = this.currentState.players.map(hostPlayer => {
      const guestPlayer = guestState.players.find(p => p.id === hostPlayer.id)

      if (!guestPlayer) {
        // Guest doesn't have this player in their state (shouldn't happen)
        return hostPlayer
      }

      if (guestPlayer.id === guestPlayerId) {
        // This is the guest who sent the update - use their state
        return {
          ...guestPlayer,
          // But preserve deck/discard from host (for card privacy)
          deck: hostPlayer.deck,
          discard: hostPlayer.discard,
        }
      }

      // For other players, prefer host state but take non-sensitive updates
      return {
        ...hostPlayer,
        // Take safe updates from guest state
        isReady: guestPlayer.isReady,
        score: guestPlayer.score,
        // Don't take hand/deck/discard (privacy and host authority)
      }
    })

    // Create new merged state
    const oldState = this.currentState
    const newState: GameState = {
      ...guestState,
      players: mergedPlayers,
      // Preserve host's authoritative values
      board: oldState.board,
      currentPhase: guestState.currentPhase ?? oldState.currentPhase,
      activePlayerId: guestState.activePlayerId ?? oldState.activePlayerId,
    }

    // Create delta and broadcast
    const delta = createDeltaFromStates(oldState, newState, guestPlayerId)

    this.currentState = newState

    if (!isDeltaEmpty(delta)) {
      // Broadcast to all guests (excluding the sender if needed)
      this.broadcastDelta(delta, excludePeerId)
      logger.info(`[HostStateManager] Guest ${guestPlayerId} update broadcast: phase=${!!delta.phaseDelta}, players=${Object.keys(delta.playerDeltas || {}).length}`)
    }
  }

  /**
   * Update state from guest delta (more efficient)
   */
  applyDeltaFromGuest(guestPlayerId: number, delta: StateDelta, senderPeerId: string): void {
    if (!this.currentState) {
      logger.warn('[HostStateManager] No current state, ignoring guest delta')
      return
    }

    // Apply delta to current state
    const { applyStateDelta } = require('../utils/stateDelta')
    const oldState = this.currentState
    const newState = applyStateDelta(oldState, delta, guestPlayerId)

    // Create new delta from the change (this ensures sourcePlayerId is set correctly)
    const newDelta = createDeltaFromStates(oldState, newState, guestPlayerId)

    this.currentState = newState

    if (!isDeltaEmpty(newDelta)) {
      // Broadcast to all guests except the sender
      this.broadcastDelta(newDelta, senderPeerId)
      logger.info(`[HostStateManager] Guest ${guestPlayerId} delta broadcast: phase=${!!newDelta.phaseDelta}, players=${Object.keys(newDelta.playerDeltas || {}).length}`)
    }
  }

  /**
   * Broadcast delta to all guests
   */
  private broadcastDelta(delta: StateDelta, excludePeerId?: string): void {
    this.connectionManager.broadcastStateDelta(delta, excludePeerId)
  }

  /**
   * Broadcast full state to all guests (use sparingly)
   */
  broadcastFullState(excludePeerId?: string): void {
    if (!this.currentState) {return}
    this.connectionManager.broadcastGameState(this.currentState, excludePeerId)
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
    }
  }

  /**
   * Update player property (name, color, deck, etc.)
   */
  updatePlayerProperty(playerId: number, properties: Partial<GameState['players'][0]>): void {
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

    if (!isDeltaEmpty(delta)) {
      this.broadcastDelta(delta)
    }
  }

  /**
   * Mark player as ready
   */
  setPlayerReady(playerId: number, isReady: boolean): void {
    this.updatePlayerProperty(playerId, { isReady })

    // Check if all real players are ready
    if (isReady && this.currentState) {
      const realPlayers = this.currentState.players.filter(p => !p.isDummy && !p.isDisconnected)
      const allReady = realPlayers.length > 0 && realPlayers.every(p => p.isReady)

      if (allReady && this.currentState.isReadyCheckActive && !this.currentState.isGameStarted) {
        this.startGame()
      }
    }
  }

  /**
   * Start the game
   */
  startGame(): void {
    if (!this.currentState || !this.localPlayerId) {
      logger.error('[HostStateManager] Cannot start game: no state or local player ID')
      return
    }

    logger.info('[HostStateManager] All players ready! Starting game...')

    const allPlayers = this.currentState.players.filter(p => !p.isDisconnected)
    const randomIndex = Math.floor(Math.random() * allPlayers.length)
    const startingPlayerId = allPlayers[randomIndex].id

    // Create new state with game started
    const oldState = this.currentState
    let newState: GameState = {
      ...oldState,
      isReadyCheckActive: false,
      isGameStarted: true,
      startingPlayerId: startingPlayerId,
      activePlayerId: startingPlayerId,
      currentPhase: 0  // Start at Preparation phase
    }

    // Draw initial hands (6 cards) for ALL players
    newState.players = newState.players.map(player => {
      logger.info(`[HostStateManager] Player ${player.id}: hand=${player.hand.length}, deck=${player.deck.length}, isDummy=${player.isDummy}`)
      if (player.hand.length === 0 && player.deck.length > 0) {
        const cardsToDraw = 6
        const newHand = [...player.hand]
        const newDeck = [...player.deck]

        for (let i = 0; i < cardsToDraw && i < newDeck.length; i++) {
          const drawnCard = newDeck[0]
          newDeck.splice(0, 1)
          newHand.push(drawnCard)
        }

        logger.info(`[HostStateManager] Drew initial ${newHand.length} cards for player ${player.id}, deck now has ${newDeck.length} cards`)
        return { ...player, hand: newHand, deck: newDeck }
      }
      return player
    })

    // Perform Preparation phase for starting player (draws 7th card and transitions to Setup)
    const { performPreparationPhase } = require('./PhaseManagement')
    newState = performPreparationPhase(newState, startingPlayerId)

    logger.info(`[HostStateManager] Preparation phase completed, now in phase ${newState.currentPhase} (Setup)`)

    // Create delta
    const delta = createDeltaFromStates(oldState, newState, this.localPlayerId)
    this.currentState = newState

    // Broadcast GAME_START first (for immediate feedback)
    this.connectionManager.broadcast({
      type: 'GAME_START',
      senderId: this.connectionManager.getPeerId(),
      data: {
        startingPlayerId,
        activePlayerId: startingPlayerId,
        isGameStarted: true,
        isReadyCheckActive: false
      },
      timestamp: Date.now()
    })

    // Then broadcast the delta
    if (!isDeltaEmpty(delta)) {
      setTimeout(() => {
        this.broadcastDelta(delta)
        logger.info('[HostStateManager] Broadcasted initial draw delta with Preparation phase')
      }, 50)
    }
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
}
