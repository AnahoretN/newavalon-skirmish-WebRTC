/**
 * useWebRTCEnabled - Хук для проверки режима WebRTC
 *
 * Кэширует результат localStorage.getItem('webrtc_enabled')
 * чтобы избежать множественных обращений к localStorage
 */

import { useMemo } from 'react'

/**
 * Returns whether WebRTC P2P mode is enabled
 * This is cached to avoid repeated localStorage access
 */
export function useWebRTCEnabled(): boolean {
  return useMemo(() => {
    return localStorage.getItem('webrtc_enabled') === 'true'
  }, [])
}

/**
 * Get the current WebRTC enabled state without React hook
 * Useful for non-React contexts
 */
export function getWebRTCEnabled(): boolean {
  return localStorage.getItem('webrtc_enabled') === 'true'
}

/**
 * Set WebRTC enabled state
 */
export function setWebRTCEnabled(enabled: boolean): void {
  localStorage.setItem('webrtc_enabled', enabled ? 'true' : 'false')
}
