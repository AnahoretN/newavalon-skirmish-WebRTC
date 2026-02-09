/**
 * WebRTC State Persistence
 * Handles saving and restoring WebRTC P2P game state across page reloads
 *
 * Features:
 * - Saves game state and connection data to localStorage
 * - Auto-restores host/guest session on page load
 * - 30-minute expiration for saved state
 * - Separate storage for host and guest modes
 */

import type { GameState } from '../types'
import { logger } from '../utils/logger'

// localStorage keys
const WEBRTC_STATE_KEY = 'webrtc_game_state'
const WEBRTC_HOST_KEY = 'webrtc_host_data'
const WEBRTC_GUEST_KEY = 'webrtc_guest_data'

// Maximum age for saved state (30 minutes)
const MAX_STATE_AGE = 30 * 60 * 1000

/**
 * Host connection data saved to localStorage
 */
export interface WebrtcHostData {
  peerId: string
  isHost: true
  timestamp: number
  playerName?: string
}

/**
 * Guest connection data saved to localStorage
 */
export interface WebrtcGuestData {
  hostPeerId: string
  playerId: number | null
  playerName: string | null
  isHost: false
  timestamp: number
}

/**
 * Complete WebRTC state data
 */
export interface WebrtcStateData {
  gameState: GameState
  localPlayerId: number | null
  isHost: boolean
  timestamp: number
}

/**
 * Get current timestamp
 */
function getCurrentTimestamp(): number {
  return Date.now()
}

/**
 * Check if stored data is still valid (not expired)
 */
function isDataValid(timestamp: number): boolean {
  return Date.now() - timestamp < MAX_STATE_AGE
}

/**
 * Save host data to localStorage
 */
export function saveHostData(hostData: Omit<WebrtcHostData, 'timestamp'>): void {
  try {
    const data: WebrtcHostData = {
      ...hostData,
      timestamp: getCurrentTimestamp()
    }
    localStorage.setItem(WEBRTC_HOST_KEY, JSON.stringify(data))
    logger.info('[WebRTC Persistence] Saved host data:', { peerId: data.peerId })
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to save host data:', e)
  }
}

/**
 * Save guest data to localStorage
 */
export function saveGuestData(guestData: Omit<WebrtcGuestData, 'timestamp'>): void {
  try {
    const data: WebrtcGuestData = {
      ...guestData,
      timestamp: getCurrentTimestamp()
    }
    localStorage.setItem(WEBRTC_GUEST_KEY, JSON.stringify(data))
    logger.info('[WebRTC Persistence] Saved guest data:', { hostPeerId: data.hostPeerId, playerId: data.playerId })
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to save guest data:', e)
  }
}

/**
 * Save game state to localStorage
 */
export function saveWebrtcState(stateData: Omit<WebrtcStateData, 'timestamp'>): void {
  try {
    const data: WebrtcStateData = {
      ...stateData,
      timestamp: getCurrentTimestamp()
    }
    localStorage.setItem(WEBRTC_STATE_KEY, JSON.stringify(data))
    logger.info('[WebRTC Persistence] Saved game state, timestamp:', new Date(data.timestamp).toISOString())
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to save game state:', e)
  }
}

/**
 * Load host data from localStorage
 */
export function loadHostData(): WebrtcHostData | null {
  try {
    const stored = localStorage.getItem(WEBRTC_HOST_KEY)
    if (!stored) return null

    const data = JSON.parse(stored) as WebrtcHostData

    if (!isDataValid(data.timestamp)) {
      logger.info('[WebRTC Persistence] Host data expired, removing')
      localStorage.removeItem(WEBRTC_HOST_KEY)
      return null
    }

    logger.info('[WebRTC Persistence] Loaded valid host data:', { peerId: data.peerId })
    return data
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to load host data:', e)
    localStorage.removeItem(WEBRTC_HOST_KEY)
    return null
  }
}

/**
 * Load guest data from localStorage
 */
export function loadGuestData(): WebrtcGuestData | null {
  try {
    const stored = localStorage.getItem(WEBRTC_GUEST_KEY)
    if (!stored) return null

    const data = JSON.parse(stored) as WebrtcGuestData

    if (!isDataValid(data.timestamp)) {
      logger.info('[WebRTC Persistence] Guest data expired, removing')
      localStorage.removeItem(WEBRTC_GUEST_KEY)
      return null
    }

    logger.info('[WebRTC Persistence] Loaded valid guest data:', { hostPeerId: data.hostPeerId, playerId: data.playerId })
    return data
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to load guest data:', e)
    localStorage.removeItem(WEBRTC_GUEST_KEY)
    return null
  }
}

/**
 * Load game state from localStorage
 */
export function loadWebrtcState(): WebrtcStateData | null {
  try {
    const stored = localStorage.getItem(WEBRTC_STATE_KEY)
    if (!stored) return null

    const data = JSON.parse(stored) as WebrtcStateData

    if (!isDataValid(data.timestamp)) {
      logger.info('[WebRTC Persistence] Game state expired, removing')
      localStorage.removeItem(WEBRTC_STATE_KEY)
      return null
    }

    logger.info('[WebRTC Persistence] Loaded valid game state, timestamp:', new Date(data.timestamp).toISOString())
    return data
  } catch (e) {
    logger.error('[WebRTC Persistence] Failed to load game state:', e)
    localStorage.removeItem(WEBRTC_STATE_KEY)
    return null
  }
}

/**
 * Clear all WebRTC persistence data
 */
export function clearWebrtcData(): void {
  logger.info('[WebRTC Persistence] Clearing all WebRTC data')
  localStorage.removeItem(WEBRTC_STATE_KEY)
  localStorage.removeItem(WEBRTC_HOST_KEY)
  localStorage.removeItem(WEBRTC_GUEST_KEY)
}

/**
 * Check if there's restorable WebRTC data
 */
export function hasRestorableWebRTCData(): {
  hasHostData: boolean
  hasGuestData: boolean
  hasGameState: boolean
} {
  const hostData = loadHostData()
  const guestData = loadGuestData()
  const gameState = loadWebrtcState()

  return {
    hasHostData: hostData !== null,
    hasGuestData: guestData !== null,
    hasGameState: gameState !== null
  }
}

/**
 * Get the type of restorable session
 */
export function getRestorableSessionType(): 'host' | 'guest' | 'none' {
  const hostData = loadHostData()
  if (hostData && isDataValid(hostData.timestamp)) {
    return 'host'
  }

  const guestData = loadGuestData()
  if (guestData && isDataValid(guestData.timestamp)) {
    return 'guest'
  }

  return 'none'
}
