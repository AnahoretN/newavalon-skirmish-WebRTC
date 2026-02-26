/**
 * Simple P2P - Simplified P2P system
 *
 * Two message types:
 * - ACTION: from client to host
 * - STATE: from host to all clients
 *
 * Exports main classes and types
 */

export { SimpleHost } from './SimpleHost'
export { SimpleGuest } from './SimpleGuest'
export { SimpleVisualEffects } from './SimpleVisualEffects'
export { applyAction } from './SimpleGameLogic'

export type {
  ActionMessage,
  StateMessage,
  PersonalizedState,
  PersonalizedPlayer,
  P2PMessage,
  ActionType,
  SimpleHostConfig,
  SimpleGuestConfig
} from './SimpleP2PTypes'

export type { GameState } from '../types'
