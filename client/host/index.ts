/**
 * Host Module
 * Exports all host-related functionality
 *
 * Architecture:
 * - WebrtcPeer: Low-level PeerJS wrapper
 * - StatePersonalization: Utilities for personalized game states
 * - GuestConnection: Guest connection manager
 * - HostConnectionManager: Manages WebRTC connections for host
 * - HostStateManager: Centralized state management for host
 * - GuestStateSync: Sends state changes from guest to host
 * - HostManager: Combines everything for easy use
 * - PhaseManagement: Phase transitions, round management
 * - VisualEffects: Broadcasts visual effects to guests
 * - TimerSystem: Handles disconnect/inactivity timers
 * - GameLogger: Logs game actions
 */

// Types
export type {
  WebrtcMessageType,
  WebrtcMessage,
  WebrtcConnectionInfo,
  WebrtcEventType,
  WebrtcEvent,
  WebrtcEventHandler,
  HostConfig,
  GuestConnection,
  MessageHandler,
  BroadcastOptions
} from './types'

export type { StateUpdateOptions } from './HostStateManager'
export type { GameLogEntry, GameLoggerConfig } from './GameLogger'
export type { TimerEvents } from './TimerSystem'

// WebrtcPeer - Low-level PeerJS wrapper
export { WebrtcPeer } from './WebrtcPeer'
export type { WebrtcPeerEventHandler, WebrtcPeerEvent, WebrtcPeerEventType } from './WebrtcPeer'

// StatePersonalization - Utilities for personalized game states
export {
  optimizeCard,
  createCardBack,
  toCompactCardData,
  createPersonalizedGameState,
  createCompactStateForHost
} from './StatePersonalization'
export type { CompactCardData } from './StatePersonalization'

// GuestConnection - Guest connection manager
export { GuestConnectionManager } from './GuestConnection'
export type { GuestConnectionManagerConfig } from './GuestConnection'

// Classes
export { HostConnectionManager } from './HostConnectionManager'
export { HostStateManager } from './HostStateManager'
export { GuestStateSync } from './GuestStateSync'
export { VisualEffectsManager } from './VisualEffects'
export { TimerSystem, TIMER_CONFIG } from './TimerSystem'
export { GameLogger } from './GameLogger'
export { HostManager } from './HostManager'
export type { HostManagerConfig } from './HostManager'

// Phase Management (utility functions)
export {
  PHASES,
  getPhaseName,
  performPreparationPhase,
  setPhase,
  nextPhase,
  prevPhase,
  toggleActivePlayer,
  toggleAutoDraw,
  resetDeployStatus,
  getNextPlayerId,
  playerHasCardsOnBoard,
  passTurnToNextPlayer
} from './PhaseManagement'

// Unified WebRTC Manager (NEW - replaces old WebrtcManager)
export { WebrtcManagerNew, getWebrtcManagerNew, cleanupWebrtcManagerNew } from './WebrtcManager'
