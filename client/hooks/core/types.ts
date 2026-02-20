/**
 * Common types used across hooks
 */

import type { WebrtcManagerNew } from '../../host/WebrtcManager'

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

// Re-export WebRTC manager type for use in hooks
export type WebRTCManager = WebrtcManagerNew

/**
 * Props for useGameState hook
 */
export interface UseGameStateProps {
  abilityMode?: any
  setAbilityMode?: React.Dispatch<React.SetStateAction<any>>
}
