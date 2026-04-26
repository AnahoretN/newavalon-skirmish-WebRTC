/**
 * AI Module Index
 *
 * Exports all AI-related functionality.
 */

// Types
export * from './types'

// AI Skills - Knowledge/Memory System
export { AI_SKILLS, getApplicableSkills, getSkillsByActionType, getSkillsByPriority, sortSkillsByValue } from './AISKills'

// AI Decision Engine
export {
  analyzeBoardSituation,
  evaluateCard,
  findBestPlacement,
  evaluateTargets,
  makeDecision,
  evaluateHandCards
} from './AIDecisionEngine'

// AI Action Executor
export { AIActionExecutor } from './AIActionExecutor'

// AI Controller
export {
  AIController,
  AIManager,
  globalAIManager,
  initializeAI,
  setAIEnabled,
  isAIEnabled,
  getAIStatus
} from './AIController'

// AI Phase Controller - New phase-based AI system
export { AIPhaseController } from './AIPhaseController'

// AI Target Selector - Intelligent target selection
export { AITargetSelector } from './AITargetSelector'

// AI Card Picker - Card selection for playing
export { AICardPicker } from './AICardPicker'
export type { CardPlayDecision } from './AICardPicker'

// AI Integration Adapter - Bridge to existing game code
export { AIIntegrationAdapter, createAIAdapter } from './AIIntegrationAdapter'
