/**
 * Common types used across hooks
 */

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

/**
 * Props for useGameState hook
 */
export interface UseGameStateProps {
  abilityMode?: any
  setAbilityMode?: React.Dispatch<React.SetStateAction<any>>
}
