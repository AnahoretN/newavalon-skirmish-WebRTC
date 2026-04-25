/**
 * Simple P2P - Simplified P2P system with automatic fallback
 *
 * Connection flow:
 * 1. PeerJS Cloud (0.peerjs.com)
 * 2. Community PeerJS servers
 * 3. Trystero (BitTorrent trackers)
 *
 * Two message types:
 * - ACTION: from client to host
 * - STATE: from host to all clients
 *
 * Exports main classes and types
 */

// Original PeerJS-based implementation
export { SimpleHost } from './SimpleHost'
export { SimpleGuest } from './SimpleGuest'
export { SimpleVisualEffects } from './SimpleVisualEffects'
export { applyAction } from './SimpleGameLogic'
export { createHostFromSavedSession } from './SimpleHost'

// Trystero-based implementation (BitTorrent tracker signaling)
export { TrysteroHost, createHostFromSavedSession as createTrysteroHostFromSavedSession } from './TrysteroHost'
export { TrysteroGuest } from './TrysteroGuest'

// Connection manager with automatic fallback
export { HostConnectionManager, GuestConnectionManager } from './ConnectionManager'
export type { ConnectionStrategy, ConnectionStatus, ConnectionManagerConfig } from './ConnectionManager'

// RTC configuration
export { getPeerJSOptions, tryNextPeerJSServer, resetPeerJSServer } from './rtcConfig'

// Types
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
