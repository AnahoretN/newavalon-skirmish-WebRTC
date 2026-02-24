/**
 * Phase Management System
 *
 * Complete phase and turn management system for WebRTC P2P mode.
 * The host controls all phase transitions and broadcasts updates to guests.
 *
 * @module client/host/phase
 */

// Types and enums
export type {
  GamePhase,
  PhaseTransitionReason,
  RoundEndInfo,
  ScoringSelectionMode,
  ScoringLine,
  PhaseState,
  PhaseUpdateMessage,
  PhaseAction,
  PhaseTransitionResult,
  PhaseSystemConfig,
} from './PhaseTypes'

export {
  getPhaseName,
  isPreparationPhase,
  isVisiblePhase,
  getVictoryThreshold,
  checkVictoryThreshold,
  getNextPlayer,
  getActivePlayerIds,
  shouldRoundEnd,
  determineRoundWinners,
  checkMatchOver,
  DEFAULT_PHASE_CONFIG,
} from './PhaseTypes'

// Phase Manager (host-side)
export type { PhaseActionRequest, PhaseSystemCallbacks } from './PhaseManager'
export { PhaseManager } from './PhaseManager'
export { default as PhaseManagerDefault } from './PhaseManager'

// Phase Message Codec (binary encoding)
export type {
  EncodedPhaseState,
  EncodedScoringLine,
} from './PhaseMessageCodec'

export {
  PhaseMessageType,
  PhaseStateFlags,
  PhaseActionType,
  encodePhaseState,
  decodePhaseState,
  encodePhaseTransition,
  decodePhaseTransition,
  encodeTurnChange,
  decodeTurnChange,
  encodeRoundEnd,
  decodeRoundEnd,
  encodeScoringModeStart,
  decodeScoringModeStart,
  encodeScoringModeComplete,
  decodeScoringModeComplete,
  encodePhaseAction,
  decodePhaseAction,
  createPhaseMessage,
  parsePhaseMessage,
  getPhaseActionName,
} from './PhaseMessageCodec'

// Phase Sync Manager (host-side broadcasting)
export type { PhaseSyncManagerConfig } from './PhaseSyncManager'
export {
  PhaseSyncManager,
  gameStateToPhaseState,
  applyPhaseStateToGameState as applyPhaseStateToGameStateSync,
} from './PhaseSyncManager'
export { default as PhaseSyncManagerDefault } from './PhaseSyncManager'

// Guest Phase Handler (guest-side receiving)
export type { GuestPhaseCallbacks } from './GuestPhaseHandler'
export {
  GuestPhaseHandler,
  applyPhaseStateToGameState as applyPhaseStateToGameStateGuest,
  initializePhaseStateFromGameState,
} from './GuestPhaseHandler'
export { default as GuestPhaseHandlerDefault } from './GuestPhaseHandler'
