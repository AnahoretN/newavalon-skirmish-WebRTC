/**
 * Common types used across hooks
 */

import type { HostManager } from '../../host/HostManager'
import type { GuestConnectionManager } from '../../host/GuestConnection'

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

// Unified WebRTC manager type - can be either HostManager or GuestConnectionManager
export type WebRTCManager = HostManager | GuestConnectionManager

/**
 * Props for useGameState hook
 */
export interface UseGameStateProps {
  abilityMode?: any
  setAbilityMode?: React.Dispatch<React.SetStateAction<any>>
}
