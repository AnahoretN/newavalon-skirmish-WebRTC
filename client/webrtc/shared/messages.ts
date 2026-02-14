/**
 * WebRTC Message Types
 *
 * Type definitions and utilities for WebRTC messages
 */

import type { WebrtcMessage } from '../types'

/**
 * Message builder utilities
 */
export const messageBuilder = {
  joinRequest(): WebrtcMessage {
    return {
      type: 'JOIN_REQUEST',
      timestamp: Date.now()
    }
  },

  joinAccept(playerId: number, gameState: any, senderId: string): WebrtcMessage {
    return {
      type: 'JOIN_ACCEPT',
      senderId,
      playerId,
      data: { gameState },
      timestamp: Date.now()
    }
  },

  joinAcceptMinimal(playerId: number, minimalInfo: any, senderId: string): WebrtcMessage {
    return {
      type: 'JOIN_ACCEPT_MINIMAL',
      senderId,
      playerId,
      data: minimalInfo,
      timestamp: Date.now()
    }
  },

  playerReconnect(playerId: number, senderId: string): WebrtcMessage {
    return {
      type: 'PLAYER_RECONNECT',
      senderId,
      playerId,
      timestamp: Date.now()
    }
  },

  playerLeave(): WebrtcMessage {
    return {
      type: 'PLAYER_LEAVE',
      timestamp: Date.now()
    }
  },

  stateUpdate(gameState: any, senderId: string): WebrtcMessage {
    return {
      type: 'STATE_UPDATE',
      senderId,
      data: { gameState },
      timestamp: Date.now()
    }
  },

  stateDelta(delta: any, senderId: string): WebrtcMessage {
    return {
      type: 'STATE_DELTA',
      senderId,
      data: { delta },
      timestamp: Date.now()
    }
  },

  action(actionType: string, actionData: any, playerId: number, senderId?: string): WebrtcMessage {
    const msg: WebrtcMessage = {
      type: 'ACTION',
      senderId: senderId || null,
      playerId,
      data: { actionType, actionData },
      timestamp: Date.now()
    }
    return msg
  },

  syncDeckSelections(deckSelections: any[], senderId: string): WebrtcMessage {
    return {
      type: 'SYNC_DECK_SELECTIONS',
      senderId,
      data: { deckSelections },
      timestamp: Date.now()
    }
  },

  changePlayerDeck(playerId: number, deckType: string, senderId?: string): WebrtcMessage {
    const msg: WebrtcMessage = {
      type: 'CHANGE_PLAYER_DECK',
      senderId: senderId || null,
      playerId,
      data: { playerId, deckType },
      timestamp: Date.now()
    }
    return msg
  },

  error(error: string): WebrtcMessage {
    return {
      type: 'ERROR',
      data: { error },
      timestamp: Date.now()
    }
  }
}
