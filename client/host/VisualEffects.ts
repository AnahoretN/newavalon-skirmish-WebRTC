/**
 * Visual Effects System for Host P2P
 * Handles broadcasting visual effects to all guests
 * Ported from server/handlers/visualEffects.ts
 */

import type { GameState } from '../types'
import type { HostConnectionManager } from './HostConnectionManager'
import type { HighlightData, FloatingTextData, TargetingModeData } from '../types'
import { logger } from '../utils/logger'

/**
 * Visual Effects Manager
 */
export class VisualEffectsManager {
  private connectionManager: HostConnectionManager

  constructor(connectionManager: HostConnectionManager) {
    this.connectionManager = connectionManager
  }

  /**
   * Broadcast highlight to all guests
   */
  broadcastHighlight(highlightData: HighlightData): void {
    this.connectionManager.broadcast({
      type: 'HIGHLIGHT_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { highlightData },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Highlight triggered: row=${highlightData.row}, col=${highlightData.col}`)
  }

  /**
   * Broadcast floating text to all guests
   */
  broadcastFloatingText(textData: FloatingTextData): void {
    this.connectionManager.broadcast({
      type: 'FLOATING_TEXT_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { textData },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Floating text: "${textData.text}" at (${textData.x}, ${textData.y})`)
  }

  /**
   * Broadcast batch of floating texts
   */
  broadcastFloatingTextBatch(batch: FloatingTextData[]): void {
    this.connectionManager.broadcast({
      type: 'FLOATING_TEXT_BATCH_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { batch },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Floating text batch: ${batch.length} texts`)
  }

  /**
   * Broadcast no-target overlay
   */
  broadcastNoTarget(coords: { row: number; col: number }): void {
    this.connectionManager.broadcast({
      type: 'NO_TARGET_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { coords, timestamp: Date.now() },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] No target overlay at (${coords.row}, ${coords.col})`)
  }

  /**
   * Set targeting mode for all guests
   */
  setTargetingMode(targetingMode: TargetingModeData): void {
    this.connectionManager.broadcast({
      type: 'TARGETING_MODE_SET',
      senderId: this.connectionManager.getPeerId(),
      data: { targetingMode },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Targeting mode set by player ${targetingMode.playerId}`)
  }

  /**
   * Clear targeting mode for all guests
   */
  clearTargetingMode(): void {
    this.connectionManager.broadcast({
      type: 'TARGETING_MODE_CLEARED',
      senderId: this.connectionManager.getPeerId(),
      data: { timestamp: Date.now() },
      timestamp: Date.now()
    })
    logger.info('[VisualEffects] Targeting mode cleared')
  }

  /**
   * Broadcast valid targets to all guests
   */
  broadcastValidTargets(targets: { row: number; col: number }[]): void {
    this.connectionManager.broadcast({
      type: 'VALID_TARGETS_SYNC',
      senderId: this.connectionManager.getPeerId(),
      data: { targets },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Valid targets synced: ${targets.length} cells`)
  }

  /**
   * Trigger deck selection visual
   */
  triggerDeckSelection(playerId: number): void {
    this.connectionManager.broadcast({
      type: 'DECK_SELECTION_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { playerId },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Deck selection triggered for player ${playerId}`)
  }

  /**
   * Trigger hand card selection visual
   */
  triggerHandCardSelection(playerId: number, cardIndex: number): void {
    this.connectionManager.broadcast({
      type: 'HAND_CARD_SELECTION_TRIGGERED',
      senderId: this.connectionManager.getPeerId(),
      data: { playerId, cardIndex },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Hand card selection: player ${playerId}, card ${cardIndex}`)
  }

  /**
   * Sync highlights to all guests
   */
  syncHighlights(highlights: HighlightData[]): void {
    this.connectionManager.broadcast({
      type: 'HIGHLIGHTS_SYNC',
      senderId: this.connectionManager.getPeerId(),
      data: { highlights },
      timestamp: Date.now()
    })
    logger.info(`[VisualEffects] Highlights synced: ${highlights.length} highlights`)
  }

  /**
   * Clear all visual effects for all guests
   */
  clearAllEffects(): void {
    this.clearTargetingMode()
    this.connectionManager.broadcast({
      type: 'CLEAR_ALL_EFFECTS',
      senderId: this.connectionManager.getPeerId(),
      data: { timestamp: Date.now() },
      timestamp: Date.now()
    })
    logger.info('[VisualEffects] All effects cleared')
  }
}
