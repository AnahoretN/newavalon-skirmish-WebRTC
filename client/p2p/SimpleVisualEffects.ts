/**
 * Visual Effects for SimpleP2P
 *
 * Simple broadcast system for visual effects in P2P mode
 * Works with SimpleHost to broadcast effects to all guests
 */

import type { SimpleHost } from './SimpleHost'
import type { HighlightData, FloatingTextData, TargetingModeData } from '../types'
import { logger } from '../utils/logger'

/**
 * Visual effects broadcaster for P2P mode
 * Works with SimpleHost to broadcast effects to all guests
 */
export class SimpleVisualEffects {
  private host: SimpleHost

  constructor(host: SimpleHost) {
    this.host = host
  }

  /**
   * Broadcast highlight to all guests
   */
  broadcastHighlight(highlightData: HighlightData): void {
    this.host.broadcast({
      type: 'HIGHLIGHT',
      data: highlightData
    })
    logger.debug(`[SimpleVisualEffects] Highlight: row=${highlightData.row}, col=${highlightData.col}`)
  }

  /**
   * Broadcast floating text to all guests
   */
  broadcastFloatingText(textData: FloatingTextData | FloatingTextData[]): void {
    const batch = Array.isArray(textData) ? textData : [textData]

    this.host.broadcast({
      type: 'FLOATING_TEXT',
      data: { batch }
    })
    logger.debug(`[SimpleVisualEffects] Floating text: ${batch.length} texts`)
  }

  /**
   * Broadcast "no target" overlay
   */
  broadcastNoTarget(coords: { row: number; col: number }): void {
    this.host.broadcast({
      type: 'NO_TARGET',
      data: { coords, timestamp: Date.now() }
    })
    logger.debug(`[SimpleVisualEffects] No target: (${coords.row}, ${coords.col})`)
  }

  /**
   * Set targeting mode for all guests
   */
  setTargetingMode(mode: TargetingModeData): void {
    this.host.broadcast({
      type: 'TARGETING_MODE',
      data: { targetingMode: mode }
    })
    logger.debug(`[SimpleVisualEffects] Targeting mode by player ${mode.playerId}`)
  }

  /**
   * Clear targeting mode
   */
  clearTargetingMode(): void {
    this.host.broadcast({
      type: 'CLEAR_TARGETING_MODE',
      data: { timestamp: Date.now() }
    })
    logger.debug('[SimpleVisualEffects] Targeting mode cleared')
  }

  /**
   * Broadcast deck selection
   */
  broadcastDeckSelection(playerId: number, selectedByPlayerId: number): void {
    this.host.broadcast({
      type: 'DECK_SELECTION',
      data: { playerId, selectedByPlayerId, timestamp: Date.now() }
    })
    logger.debug(`[SimpleVisualEffects] Deck selection: player ${playerId}`)
  }

  /**
   * Broadcast hand card selection
   */
  broadcastHandCardSelection(playerId: number, cardIndex: number, selectedByPlayerId: number): void {
    this.host.broadcast({
      type: 'HAND_CARD_SELECTION',
      data: { playerId, cardIndex, selectedByPlayerId, timestamp: Date.now() }
    })
    logger.debug(`[SimpleVisualEffects] Hand card selection: player ${playerId}, card ${cardIndex}`)
  }

  /**
   * Broadcast click wave
   */
  broadcastClickWave(wave: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }): void {
    this.host.broadcast({
      type: 'CLICK_WAVE',
      data: wave
    })
    logger.debug(`[SimpleVisualEffects] Click wave: ${wave.location}`)
  }
}
