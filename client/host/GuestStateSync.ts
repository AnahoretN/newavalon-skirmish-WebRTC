/**
 * Guest State Sync
 * Handles sending state changes from guest to host
 *
 * Key principle: Guest sends state changes to host, host broadcasts to everyone
 * - When guest's state changes, send delta to host
 * - Host applies delta and broadcasts to all guests (including sender for confirmation)
 */

import type { GameState, StateDelta } from '../types'
import type { WebrtcMessage } from '../host/types'
import { createDeltaFromStates, isDeltaEmpty } from '../utils/stateDelta'
import { logger } from '../utils/logger'

export interface GuestStateSyncConfig {
  sendMessage: (message: WebrtcMessage) => boolean
  onStateUpdate?: (newState: GameState) => void
}

export class GuestStateSync {
  private sendMessage: (message: WebrtcMessage) => boolean
  private localPlayerId: number | null = null
  private onStateUpdateCallback?: (newState: GameState) => void

  constructor(config: GuestStateSyncConfig) {
    this.sendMessage = config.sendMessage
    this.onStateUpdateCallback = config.onStateUpdate
  }

  /**
   * Set the local player ID
   */
  setLocalPlayerId(playerId: number): void {
    this.localPlayerId = playerId
    logger.info(`[GuestStateSync] Local player ID set to ${playerId}`)
  }

  /**
   * Update state and send delta to host
   * Called when guest makes an action
   */
  updateState(oldState: GameState, newState: GameState): void {
    if (this.localPlayerId === null) {
      logger.warn('[GuestStateSync] No local player ID set')
      return
    }

    // Create delta from old state to new state
    const delta = createDeltaFromStates(oldState, newState, this.localPlayerId)

    if (isDeltaEmpty(delta)) {
      logger.debug('[GuestStateSync] Delta empty, skipping send')
      return
    }

    // Send delta to host
    this.sendDelta(delta)
    logger.info(`[GuestStateSync] Sent delta: phase=${!!delta.phaseDelta}, players=${Object.keys(delta.playerDeltas || {}).length}`)
  }

  /**
   * Send delta to host
   */
  sendDelta(delta: StateDelta): boolean {
    const message: WebrtcMessage = {
      type: 'ACTION',
      senderId: undefined, // Will be set by WebRTC manager
      data: {
        actionType: 'STATE_DELTA',
        actionData: { delta }
      },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send full state to host (use sparingly, for initial join or major changes)
   */
  sendFullState(state: GameState): boolean {
    const message: WebrtcMessage = {
      type: 'ACTION',
      senderId: undefined,
      data: {
        actionType: 'STATE_UPDATE',
        actionData: { gameState: state }
      },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send player ready to host
   */
  sendPlayerReady(): boolean {
    if (this.localPlayerId === null) {return false}

    const message: WebrtcMessage = {
      type: 'PLAYER_READY',
      senderId: undefined,
      playerId: this.localPlayerId,
      data: { isReady: true },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send player deck change to host
   */
  sendChangeDeck(deckType: string): boolean {
    if (this.localPlayerId === null) {return false}

    const message: WebrtcMessage = {
      type: 'CHANGE_PLAYER_DECK',
      senderId: undefined,
      playerId: this.localPlayerId,
      data: { deckType },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send player name change to host
   */
  sendUpdateName(name: string): boolean {
    if (this.localPlayerId === null) {return false}

    const message: WebrtcMessage = {
      type: 'UPDATE_PLAYER_NAME',
      senderId: undefined,
      playerId: this.localPlayerId,
      data: { name },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send player color change to host
   */
  sendChangeColor(color: string): boolean {
    if (this.localPlayerId === null) {return false}

    const message: WebrtcMessage = {
      type: 'CHANGE_PLAYER_COLOR',
      senderId: undefined,
      playerId: this.localPlayerId,
      data: { color },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Send score change to host
   */
  sendUpdateScore(delta: number): boolean {
    if (this.localPlayerId === null) {return false}

    const message: WebrtcMessage = {
      type: 'UPDATE_PLAYER_SCORE',
      senderId: undefined,
      playerId: this.localPlayerId,
      data: { delta },
      timestamp: Date.now()
    }

    return this.sendMessage(message)
  }

  /**
   * Handle incoming state delta from host
   */
  applyIncomingDelta(currentState: GameState, delta: StateDelta): GameState {
    if (this.localPlayerId === null) {
      logger.warn('[GuestStateSync] No local player ID, cannot apply delta')
      return currentState
    }

    const { applyStateDelta } = require('../utils/stateDelta')
    const newState = applyStateDelta(currentState, delta, this.localPlayerId)

    if (this.onStateUpdateCallback && newState !== currentState) {
      this.onStateUpdateCallback(newState)
    }

    return newState
  }

  /**
   * Get the local player ID
   */
  getLocalPlayerId(): number | null {
    return this.localPlayerId
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.localPlayerId = null
  }
}
