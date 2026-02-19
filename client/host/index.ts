/**
 * Host Module
 * Exports all host-related functionality
 *
 * Architecture:
 * - HostConnectionManager: Manages WebRTC connections
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

// Classes
export { HostConnectionManager, getHostConnectionManager, cleanupHostConnectionManager } from './HostConnectionManager'
// export { HostMessageHandler } from './HostMessageHandler' // TODO: Not currently used, functionality integrated into HostManager
export { HostStateManager } from './HostStateManager'
export { GuestStateSync } from './GuestStateSync'
export { VisualEffectsManager } from './VisualEffects'
export { TimerSystem, TIMER_CONFIG } from './TimerSystem'
export { GameLogger } from './GameLogger'
export { HostManager, getHostManager, cleanupHostManager } from './HostManager'
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
