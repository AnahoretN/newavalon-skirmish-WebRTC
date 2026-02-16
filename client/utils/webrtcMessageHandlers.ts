/**
 * WebRTC Message Handlers for New Codec System
 * Handles incoming CARD_STATE, ABILITY_EFFECT, and SESSION_EVENT messages
 */

import type { GameState } from '../types'
import { logger } from '../utils/logger'
import {
  deserializeGameState
} from '../utils/webrtcSerialization'
import {
  decodeAbilityEffect
} from '../utils/abilityMessages'
import {
  decodeSessionEvent
} from '../utils/sessionMessages'

/**
 * Handle CARD_STATE message
 * Receives full or partial game state update
 */
export function handleCardStateMessage(
  data: Uint8Array,
  currentState: GameState,
  localPlayerId: number | null
): GameState {
  try {
    const decodedState = deserializeGameState(data, localPlayerId)
    logger.info(`[WebRTCCodec] Received card state: ${decodedState.board?.length}x${decodedState.board?.[0]?.length || 0}, ${decodedState.players?.length || 0} players`)

    // Merge decoded state into current state
    const result = { ...currentState }

    if (decodedState.players) {
      result.players = decodedState.players.map(player => {
        const existing = currentState.players.find(p => p.id === player.id)
        if (existing) {
          // For local player, preserve their actual hand from existing state
          const isLocalPlayer = player.id === localPlayerId
          return {
            ...existing,
            ...player,
            hand: isLocalPlayer ? existing.hand : player.hand
          }
        }
        return player
      })
    }

    if (decodedState.board) {
      result.board = decodedState.board
    }

    if (decodedState.currentPhase !== undefined) {
      result.currentPhase = decodedState.currentPhase
    }

    if (decodedState.activePlayerId !== undefined) {
      result.activePlayerId = decodedState.activePlayerId
    }

    if (decodedState.currentRound !== undefined) {
      result.currentRound = decodedState.currentRound
    }

    return result
  } catch (e) {
    logger.error('[WebRTCCodec] Failed to deserialize card state:', e)
    return currentState
  }
}

/**
 * Handle ABILITY_EFFECT message
 * Visual effects like highlights, floating text, etc.
 */
export function handleAbilityEffectMessage(
  data: Uint8Array,
  currentState: GameState
): {
  gameState: GameState
  effectData: any
} {
  try {
    const { effectType, timestamp, data: effectData } = decodeAbilityEffect(data)
    logger.debug(`[WebRTCCodec] Received ability effect: ${effectType}`)

    let updatedState = currentState

    switch (effectType) {
      case 0x01: // HIGHLIGHT_CELL
        return {
          gameState: updatedState,
          effectData: { type: 'highlight', ...effectData, timestamp }
        }

      case 0x02: // FLOATING_TEXT
        return {
          gameState: updatedState,
          effectData: { type: 'floatingText', ...effectData, timestamp }
        }

      case 0x03: // NO_TARGET
        return {
          gameState: updatedState,
          effectData: { type: 'noTarget', ...effectData }
        }

      case 0x08: // TARGETING_MODE
        return {
          gameState: updatedState,
          effectData: { type: 'targetingMode', ...effectData }
        }

      case 0x09: // CLEAR_TARGETING
        return {
          gameState: updatedState,
          effectData: { type: 'clearTargeting' }
        }

      default:
        logger.warn(`[WebRTCCodec] Unknown ability effect type: ${effectType}`)
        return {
          gameState: updatedState,
          effectData: null
        }
    }
  } catch (e) {
    logger.error('[WebRTCCodec] Failed to handle ability effect:', e)
    return {
      gameState: currentState,
      effectData: null
    }
  }
}

/**
 * Handle SESSION_EVENT message
 * Game session events like phase changes, round end, etc.
 */
export function handleSessionEventMessage(
  data: Uint8Array,
  currentState: GameState
): GameState {
  try {
    const { eventType, data: eventData } = decodeSessionEvent(data)
    logger.info(`[WebRTCCodec] Received session event: ${eventType}`)

    const updatedState = { ...currentState }

    switch (eventType) {
      case 0x01: // PLAYER_CONNECTED
        logger.info(`[WebRTCCodec] Player connected: ${eventData.playerName} (ID: ${eventData.playerId})`)
        // Player will be added via regular state update
        break

      case 0x02: // PLAYER_DISCONNECTED
        logger.info(`[WebRTCCodec] Player disconnected: ID: ${eventData.playerId}`)
        // Mark player as disconnected
        updatedState.players = updatedState.players.map(p =>
          p.id === eventData.playerId ? { ...p, isDisconnected: true } : p
        )
        break

      case 0x03: // GAME_START
        logger.info(`[WebRTCCodec] Game starting, first player: ${eventData.startingPlayerId}`)
        updatedState.isGameStarted = true
        if (eventData.startingPlayerId !== undefined) {
          updatedState.activePlayerId = eventData.startingPlayerId
          updatedState.startingPlayerId = eventData.startingPlayerId
        }
        break

      case 0x04: // ROUND_START
        logger.info(`[WebRTCCodec] Round ${eventData.roundNumber} starting`)
        updatedState.currentRound = (eventData.roundNumber ?? 1)
        break

      case 0x05: // ROUND_END
        logger.info(`[WebRTCCodec] Round ${eventData.roundNumber} ended, winners: ${eventData.winners?.join(', ')}`)
        updatedState.isRoundEndModalOpen = true
        if (eventData.winners && eventData.roundNumber !== undefined) {
          const existingWinners = updatedState.roundWinners || {}
          existingWinners[eventData.roundNumber] = eventData.winners
          updatedState.roundWinners = existingWinners
        }
        break

      case 0x06: // PHASE_CHANGE
        logger.info(`[WebRTCCodec] Phase change: ${eventData.newPhase}`)
        if (eventData.newPhase !== undefined) {
          updatedState.currentPhase = eventData.newPhase
        }
        if (eventData.newActivePlayerId !== undefined) {
          updatedState.activePlayerId = eventData.newActivePlayerId
        }
        break

      case 0x07: // TURN_CHANGE
        logger.info(`[WebRTCCodec] Turn change: player ${eventData.newActivePlayerId}`)
        if (eventData.newActivePlayerId !== undefined) {
          updatedState.activePlayerId = eventData.newActivePlayerId
        }
        break

      case 0x08: // GAME_END
        logger.info(`[WebRTCCodec] Game ended, winner: ${eventData.gameWinner}`)
        if (eventData.gameWinner !== undefined) {
          updatedState.gameWinner = (eventData.gameWinner === 255) ? null : eventData.gameWinner
        }
        break

      default:
        logger.warn(`[WebRTCCodec] Unknown session event type: ${eventType}`)
    }

    return updatedState
  } catch (e) {
    logger.error('[WebRTCCodec] Failed to handle session event:', e)
    return currentState
  }
}

/**
 * Main handler for new codec messages
 * Routes to appropriate handler based on message type
 */
export function handleCodecMessage(
  messageType: number,
  data: Uint8Array,
  currentState: GameState,
  localPlayerId: number | null
): {
  gameState: GameState
  effectData?: any
} {
  if (messageType === 0x02) { // CARD_STATE
    const newGameState = handleCardStateMessage(data, currentState, localPlayerId)
    return { gameState: newGameState }
  }

  if (messageType === 0x03) { // ABILITY_EFFECT
    return handleAbilityEffectMessage(data, currentState)
  }

  if (messageType === 0x04) { // SESSION_EVENT
    const newGameState = handleSessionEventMessage(data, currentState)
    return { gameState: newGameState }
  }

  logger.warn(`[WebRTCCodec] Unknown codec message type: ${messageType}`)
  return { gameState: currentState }
}
