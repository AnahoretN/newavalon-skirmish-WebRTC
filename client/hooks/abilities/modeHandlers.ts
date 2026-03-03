/**
 * Mode Handlers
 *
 * Handles all ability modes during targeting
 * Extracted from useAppAbilities.ts
 */

// @ts-ignore - Suppress unused variable warnings for destructured variables that may be used in future
import type { Card, AbilityAction, CommandContext, DragItem, CursorStackState, CounterSelectionData, GameState, FloatingTextData, DropTarget } from '@/types'
import { TIMING } from '@/utils/common'
import { createTokenCursorStack } from '@/utils/tokenTargeting'
import { handleLineSelection as handleLineSelectionModule } from './lineSelectionHandlers.js'

// Track cards that are transitioning from AUTO_STEPS to actual mode
// Prevents infinite re-processing due to asynchronous React state updates
const transitioningCards = new Set<string>()

/**
 * Clear a card from transitioning set (call after state updates)
 */
function clearTransitioning(cardId: string, delay: number = 100) {
  setTimeout(() => {
    transitioningCards.delete(cardId)
  }, delay)
}

/**
 * Step definition from contentDatabase.json AUTO_STEPS abilities
 */
export interface AutoStep {
  action: string
  mode: string | null
  details: Record<string, any>
}

/**
 * Result of executing an instant step
 */
export interface InstantStepResult {
  success: boolean
  shouldAdvance: boolean
  message?: string
}

/**
 * Minimal props required for instant step execution
 * Shared between actionExecutionHandler and modeHandlers
 */
export interface InstantStepProps {
  gameState: GameState
  localPlayerId: number | null
  commandContext: CommandContext
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
}

/**
 * Execute an instant AUTO_STEPS action (mode: null)
 * This is the universal handler for all instant step types.
 *
 * @param step - The step to execute
 * @param sourceCoords - Coordinates of the source card
 * @param ownerId - Owner ID of the source card
 * @param props - Props needed for execution
 * @returns Result indicating success and whether to advance to next step
 */
export function executeInstantAutoStep(
  step: AutoStep,
  sourceCoords: { row: number; col: number } | undefined,
  ownerId: number,
  props: InstantStepProps,
  stepContext?: { lastMovedCardCoords?: { row: number; col: number }; sourceOwnerId?: number; lastMovedCardId?: string }
): InstantStepResult {
  const { gameState, commandContext, addBoardCardStatus, modifyBoardCardPower } = props

  // Use stepContext if provided (from AUTO_STEPS), otherwise fall back to commandContext
  const context = stepContext || commandContext

  switch (step.action) {
    case 'CREATE_STACK_SELF': {
      // Add token to self
      const tokenType = step.details?.tokenType
      const count = step.details?.count || 1
      if (!tokenType) {
        console.warn('[executeInstantAutoStep] CREATE_STACK_SELF: missing tokenType')
        return { success: false, shouldAdvance: true }
      }
      if (!sourceCoords) {
        console.warn('[executeInstantAutoStep] CREATE_STACK_SELF: missing sourceCoords')
        return { success: false, shouldAdvance: true }
      }
      for (let i = 0; i < count; i++) {
        addBoardCardStatus(sourceCoords, tokenType, ownerId)
      }
      return { success: true, shouldAdvance: true }
    }

    case 'BUFF_LINES_FROM_CONTEXT': {
      // Buff all allies in the lines of a card from context
      // Used by Centurion's multi-step ability
      console.log('[executeInstantAutoStep] BUFF_LINES_FROM_CONTEXT executing')
      const amount = step.details?.amount || 1
      const buffOriginCoords = context?.lastMovedCardCoords

      if (!buffOriginCoords) {
        console.warn('[executeInstantAutoStep] BUFF_LINES_FROM_CONTEXT: No coordinates in context')
        return { success: false, shouldAdvance: true }
      }

      // Use sourceOwnerId (Centurion's owner) - this determines whose allies get buffed
      // If not set, fall back to lastMovedCardId (sacrificed card's owner)
      const buffOwnerId = context?.sourceOwnerId ?? parseInt(context?.lastMovedCardId || '0')
      const gridSize = gameState.board.length
      const { row: r1, col: c1 } = buffOriginCoords
      let buffedCount = 0

      console.log('[executeInstantAutoStep] BUFF_LINES_FROM_CONTEXT:', { buffOwnerId, origin: buffOriginCoords, amount })

      // Buff all cards in the same row
      for (let c = 0; c < gridSize; c++) {
        const cell = gameState.board[r1]?.[c]
        const targetCard = cell?.card
        if (targetCard && targetCard.ownerId === buffOwnerId) {
          console.log('[executeInstantAutoStep] Buffing row card:', targetCard.baseId, 'at', { row: r1, col: c })
          modifyBoardCardPower({ row: r1, col: c }, amount)
          buffedCount++
        }
      }

      // Buff all cards in the same column (excluding the already-processed row)
      for (let r = 0; r < gridSize; r++) {
        if (r === r1) continue
        const cell = gameState.board[r]?.[c1]
        const targetCard = cell?.card
        if (targetCard && targetCard.ownerId === buffOwnerId) {
          console.log('[executeInstantAutoStep] Buffing col card:', targetCard.baseId, 'at', { row: r, col: c1 })
          modifyBoardCardPower({ row: r, col: c1 }, amount)
          buffedCount++
        }
      }

      console.log('[executeInstantAutoStep] BUFF_LINES_FROM_CONTEXT complete, buffed', buffedCount, 'cards')
      return { success: true, shouldAdvance: true }
    }

    default:
      console.warn('[executeInstantAutoStep] Unknown instant action:', step.action)
      // Unknown actions still advance to avoid getting stuck
      return { success: false, shouldAdvance: true, message: 'Unknown action: ' + step.action }
  }
}

/**
 * Minimal props for AUTO_STEPS continuation (used by CONTINUE_AUTO_STEPS action)
 * Only includes the props actually used by advanceToNextStepWithCoords
 */
export interface ContinueAutoStepsProps {
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  gameState: GameState
  commandContext: CommandContext
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  calculateValidTargets?: (action: AbilityAction, gameState: GameState, ownerId: number, commandContext?: CommandContext) => {row: number, col: number}[]
  localPlayerId: number | null
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
}

export interface ModeHandlersProps {
  gameState: GameState
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null
  setPlayMode: React.Dispatch<React.SetStateAction<{ card: Card; sourceItem: DragItem; faceDown?: boolean } | null>>
  draggedItem: DragItem | null
  setDraggedItem: React.Dispatch<React.SetStateAction<DragItem | null>>
  openContextMenu: (e: React.MouseEvent, type: string, data: unknown) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  triggerNoTarget: (coords: { row: number; col: number }) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => void
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: DropTarget) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  transferAllStatusesWithoutException: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  destroyCard: (card: Card, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: {row: number, col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number; col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number; col: number}, status: string, pid: number) => void
  removeBoardCardStatus: (coords: {row: number; col: number }, status: string) => void
  removeBoardCardStatusByOwner: (coords: {row: number; col: number}, status: string, pid: number) => void
  removeStatusByType: (coords: {row: number; col: number}, type: string) => void
  resetDeployStatus: (coords: {row: number; col: number }) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>
  setViewingDiscard: React.Dispatch<React.SetStateAction<boolean>>
  clearValidTargets: () => void
  validTargets?: {row: number, col: number}[]
  handleLineSelection: (coords: {row: number; col: number }) => void
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode: () => void
  calculateValidTargets?: (action: AbilityAction, gameState: GameState, ownerId: number, commandContext?: CommandContext) => {row: number, col: number}[]
  updateState?: (stateOrFn: any) => void
  nextPhase?: (forceTurnPass?: boolean) => void
  scoreLine?: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal?: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  isWebRTCMode?: boolean
}

/**
 * Handle click on board card during ability mode
 * Returns true if handled, false otherwise
 */
export function handleModeCardClick(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const {
    gameState,
    localPlayerId: _localPlayerId,
    abilityMode,
    interactionLock,
    handleLineSelection: _handleLineSelection,
  } = props

  console.log('[handleModeCardClick] Called for', card.baseId, 'mode:', abilityMode?.mode, 'type:', abilityMode?.type)

  if (!abilityMode || abilityMode.type !== 'ENTER_MODE') {
    console.log('[handleModeCardClick] Returning false - no ENTER_MODE')
    return false
  }

  if (interactionLock.current) {
    console.log('[handleModeCardClick] Returning false - interaction locked')
    return false
  }

  // Prevent clicking self unless specific modes allow it
  if (abilityMode.sourceCard && abilityMode.sourceCard.id === card.id &&
      abilityMode.mode !== 'SELECT_LINE_START' &&
      abilityMode.mode !== 'INTEGRATOR_LINE_SELECT' &&
      abilityMode.mode !== 'ZIUS_LINE_SELECT' &&
      abilityMode.mode !== 'IP_AGENT_THREAT_SCORING' &&
      abilityMode.mode !== 'SELECT_UNIT_FOR_MOVE' &&
      abilityMode.mode !== 'SELECT_TARGET' &&
      abilityMode.mode !== 'RIOT_PUSH' &&
      abilityMode.mode !== 'RIOT_MOVE' &&
      abilityMode.mode !== 'REVEREND_DOUBLE_EXPLOIT' &&
      abilityMode.mode !== 'SHIELD_SELF_THEN_RIOT_PUSH'
  ) {
    return false
  }

  const { mode, payload, sourceCard: _sourceCard } = abilityMode

  // Line selection modes
  if (mode === 'SELECT_LINE_START' || mode === 'SELECT_LINE_END') {
    const {
      gameState,
      localPlayerId,
      abilityMode,
      interactionLock,
      setAbilityMode,
      markAbilityUsed,
      updatePlayerScore,
      triggerFloatingText,
      nextPhase,
      modifyBoardCardPower,
      scoreLine,
      scoreDiagonal,
      commandContext,
      isWebRTCMode,
    } = props

    handleLineSelectionModule(boardCoords, {
      gameState,
      localPlayerId,
      abilityMode,
      interactionLock,
      setAbilityMode,
      markAbilityUsed,
      updatePlayerScore,
      triggerFloatingText,
      nextPhase: nextPhase || (() => {}),
      modifyBoardCardPower: modifyBoardCardPower || (() => {}),
      scoreLine: scoreLine || (() => {}),
      scoreDiagonal: scoreDiagonal || (() => {}),
      commandContext,
      isWebRTCMode,
    })
    return true
  }

  // SELECT_TARGET with tokenType (CREATE_STACK)
  if (mode === 'SELECT_TARGET' && payload.tokenType) {
    return handleSelectTargetWithToken(card, boardCoords, props)
  }

  // Other SELECT_TARGET actionTypes
  if (mode === 'SELECT_TARGET') {
    return handleSelectTargetActionType(card, boardCoords, props)
  }

  // RIOT_PUSH
  if (mode === 'RIOT_PUSH') {
    return handleRiotPush(card, boardCoords, props)
  }

  // SHIELD_SELF_THEN_RIOT_PUSH (Reclaimed Gawain Deploy)
  if (mode === 'SHIELD_SELF_THEN_RIOT_PUSH') {
    return handleShieldSelfThenRiotPush(card, boardCoords, props)
  }

  // RIOT_MOVE
  if (mode === 'RIOT_MOVE') {
    return handleRiotMove(card, boardCoords, props)
  }

  // SWAP_POSITIONS
  if (mode === 'SWAP_POSITIONS') {
    return handleSwapPositions(card, boardCoords, props)
  }

  // SWAP_ADJACENT (Swap with adjacent card)
  if (mode === 'SWAP_ADJACENT') {
    return handleSwapAdjacent(card, boardCoords, props)
  }

  // TRANSFER_STATUS_SELECT and TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
  if (mode === 'TRANSFER_STATUS_SELECT' || mode === 'TRANSFER_ALL_STATUSES') {
    return handleTransferStatus(card, boardCoords, props)
  }

  // ZEALOUS_WEAKEN
  if (mode === 'ZEALOUS_WEAKEN') {
    return handleZealousWeaken(card, boardCoords, props)
  }

  // REVEREND_DOUBLE_EXPLOIT
  if (mode === 'REVEREND_DOUBLE_EXPLOIT') {
    return handleReverendDoubleExploit(card, boardCoords, props)
  }

  // SELECT_UNIT_FOR_MOVE
  if (mode === 'SELECT_UNIT_FOR_MOVE') {
    return handleSelectUnitForMove(card, boardCoords, props)
  }

  // PATROL_MOVE
  if (mode === 'PATROL_MOVE') {
    return handlePatrolMove(card, boardCoords, props)
  }

  // SPAWN_TOKEN
  if (mode === 'SPAWN_TOKEN') {
    return handleSpawnToken(card, boardCoords, props)
  }

  // PLACE_TOKEN
  if (mode === 'PLACE_TOKEN') {
    return handlePlaceToken(card, boardCoords, props)
  }

  // REVEAL_ENEMY
  if (mode === 'REVEAL_ENEMY') {
    return handleRevealEnemy(card, boardCoords, props)
  }

  // SELECT_CELL
  if (mode === 'SELECT_CELL') {
    return handleSelectCell(card, boardCoords, props)
  }

  // IMMUNIS_RETRIEVE
  if (mode === 'IMMUNIS_RETRIEVE') {
    return handleImmunisRetrieve(card, boardCoords, props)
  }

  // INTEGRATOR_LINE_SELECT
  if (mode === 'INTEGRATOR_LINE_SELECT') {
    return handleIntegratorLineSelect(card, boardCoords, props)
  }

  // IP_AGENT_THREAT_SCORING
  if (mode === 'IP_AGENT_THREAT_SCORING') {
    return handleIpAgentThreatScoring(card, boardCoords, props)
  }

  // ZIUS_LINE_SELECT
  if (mode === 'ZIUS_LINE_SELECT') {
    return handleZiusLineSelect(card, boardCoords, props)
  }

  // SELECT_DIAGONAL
  if (mode === 'SELECT_DIAGONAL') {
    return handleSelectDiagonal(card, boardCoords, props)
  }

  // SCORE_LAST_PLAYED_LINE
  if (mode === 'SCORE_LAST_PLAYED_LINE') {
    return handleScoreLastPlayedLine(card, boardCoords, props)
  }

  // SEARCH_DECK
  if (mode === 'SEARCH_DECK') {
    return handleSearchDeck(card, boardCoords, props)
  }

  // LINES_WITH_THREAT (Signal Prophet)
  if (mode === 'LINES_WITH_THREAT') {
    return handleLinesWithThreat(card, boardCoords, props)
  }

  // LINES_WITH_SUPPORT (Signal Prophet)
  if (mode === 'LINES_WITH_SUPPORT') {
    return handleLinesWithSupport(card, boardCoords, props)
  }

  // RETRIEVE_DEVICE
  if (mode === 'RETRIEVE_DEVICE') {
    return handleRetrieveDevice(card, boardCoords, props)
  }

  // SELECT_DECK
  if (mode === 'SELECT_DECK') {
    return handleSelectDeck(card, boardCoords, props)
  }

  // RECON_DRONE_COMMIT (2-step: select adjacent opponent card, then reveal their hand card)
  if (mode === 'RECON_DRONE_COMMIT') {
    return handleReconDroneCommit(card, boardCoords, props)
  }

  // AUTO_STEPS (Generic multi-step ability system)
  if (mode === 'AUTO_STEPS') {
    // Check if this ability is transitioning to a new mode
    const transitionKey = `${abilityMode?.sourceCard?.id}-${abilityMode?.sourceCoords?.row}-${abilityMode?.sourceCoords?.col}`
    if (transitioningCards.has(transitionKey)) {
      // Skip AUTO_STEPS processing, but check if there's a targeting mode to use instead
      const targetingMode = gameState.targetingMode
      if (targetingMode && targetingMode.action.mode !== 'AUTO_STEPS') {
        // Use the targeting mode action to process this click
        const mode = targetingMode.action.mode
        const payload = targetingMode.action.payload

        // CRITICAL: Create a modified props with the targeting mode's action
        // The handlers expect abilityMode to match the current mode, not AUTO_STEPS
        const modifiedProps = {
          ...props,
          abilityMode: targetingMode.action
        }

        // Handle SELECT_TARGET with tokenType
        if (mode === 'SELECT_TARGET' && payload.tokenType) {
          return handleSelectTargetWithToken(card, boardCoords, modifiedProps)
        }
        // Handle other SELECT_TARGET actionTypes
        if (mode === 'SELECT_TARGET') {
          return handleSelectTargetActionType(card, boardCoords, modifiedProps)
        }
      }
      // If no targeting mode or can't handle, return false
      return false
    } else {
      return handleAutoSteps(card, boardCoords, props)
    }
  }

  return false
}

/**
 * Handle SELECT_TARGET with tokenType (CREATE_STACK)
 */
function handleSelectTargetWithToken(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, triggerClickWave, moveItem, markAbilityUsed, setAbilityMode, setCommandContext, handleActionExecution, clearValidTargets } = props
  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode!

  if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
    return false
  }

  moveItem({
    card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
    source: 'counter_panel',
    statusType: payload.tokenType,
    count: payload.count || 1,
  }, { target: 'board', boardCoords })

  triggerClickWave('board', boardCoords)

  if (payload.recordContext) {
    setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: card.id })
  }

  if (payload.chainedAction) {
    const nextAction: AbilityAction = {
      ...payload.chainedAction,
      sourceCard: payload.chainedAction.sourceCard ?? card,
      sourceCoords: payload.chainedAction.sourceCoords ?? boardCoords,
      isDeployAbility,
      recordContext: true,
    }
    handleActionExecution(nextAction, boardCoords)
    // Immediate wave for chained action - no delay needed
    triggerClickWave('board', boardCoords)
    if (nextAction.type !== 'ENTER_MODE') {
      setAbilityMode(null)
      clearValidTargets()
    }
  } else {
    // Check if this is part of AUTO_STEPS
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      // Continue to next step instead of clearing mode
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex)
    } else {
      // Normal completion
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
      setTimeout(() => {
        setAbilityMode(null)
        clearValidTargets()
      }, TIMING.MODE_CLEAR_DELAY)
    }
  }

  return true
}

/**
 * Continue AUTO_STEPS after a mode completes
 * @param stepContext - Optional context data from previous step (e.g., lastMovedCardCoords, sourceOwnerId)
 */
export function advanceToNextStepWithCoords(
  props: ModeHandlersProps,
  completedCoords: { row: number; col: number },
  nextStepIndex: number,
  stepContext?: { lastMovedCardCoords?: { row: number; col: number }; sourceOwnerId?: number }
): void {
  const { abilityMode, setAbilityMode, markAbilityUsed, gameState, commandContext, setTargetingMode, calculateValidTargets } = props

  if (!abilityMode) return

  const payload = abilityMode.payload
  if (!payload || !payload._autoStepsContext) return

  const autoStepsContext = payload._autoStepsContext
  const steps = autoStepsContext.steps
  const sourceCard = abilityMode.sourceCard
  // CRITICAL: Always use abilityMode.sourceCoords (original card position), NOT completedCoords
  // completedCoords is where the action completed (e.g., destroyed card location), not the source card
  const sourceCoords = abilityMode.sourceCoords

  // Use readyStatusToRemove from autoStepsContext if not set at action level
  const readyStatusToRemove = abilityMode.readyStatusToRemove ?? autoStepsContext.readyStatusToRemove

  // Debug logging
  console.log('[advanceToNextStepWithCoords] Entry:', {
    nextStepIndex,
    stepsLength: steps?.length,
    steps: steps?.map((s: AutoStep) => ({ action: s.action, mode: s.mode })),
    abilityModeReadyStatus: abilityMode.readyStatusToRemove,
    autoStepsContextReadyStatus: autoStepsContext.readyStatusToRemove,
    finalReadyStatus: readyStatusToRemove,
    sourceCoords
  })

  // Debug logging for Centurion Commit
  if (autoStepsContext.originalType === 'commit') {
    console.log('[advanceToNextStepWithCoords] COMMIT ability:', {
      stepIndex: nextStepIndex,
      totalSteps: steps.length,
      readyStatusToRemove,
      abilityModeReadyStatus: abilityMode.readyStatusToRemove,
      autoStepsContextReadyStatus: autoStepsContext.readyStatusToRemove,
      sourceCoords: completedCoords || abilityMode.sourceCoords
    })
  }

  // Check if there are more steps
  if (nextStepIndex >= steps.length) {
    // All steps complete!
    console.log('[advanceToNextStepWithCoords] All steps complete, calling markAbilityUsed with readyStatusToRemove:', readyStatusToRemove)
    markAbilityUsed(sourceCoords || { row: 0, col: 0 }, abilityMode.isDeployAbility, false, readyStatusToRemove)
    setAbilityMode(null)
    return
  }

  const nextStep = steps[nextStepIndex]

  // If next step has no mode, execute instantly
  if (!nextStep.mode) {
    console.log('[advanceToNextStepWithCoords] Executing instant step:', nextStep.action, 'index:', nextStepIndex)

    // Execute instant step directly
    const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0
    const result = executeInstantAutoStep(
      nextStep,
      sourceCoords,
      ownerId,
      {
        gameState,
        localPlayerId: props.localPlayerId,
        commandContext: props.commandContext,
        addBoardCardStatus: props.addBoardCardStatus,
        modifyBoardCardPower: props.modifyBoardCardPower,
      },
      stepContext  // Pass stepContext to instant step (for BUFF_LINES_FROM_CONTEXT)
    )

    if (!result.success) {
      console.warn('[advanceToNextStepWithCoords] Instant step failed:', result.message)
    }

    // Check if there are more steps after this instant step
    const followingStepIndex = nextStepIndex + 1
    console.log('[advanceToNextStepWithCoords] After instant step:', {
      followingStepIndex,
      stepsLength: steps.length,
      isComplete: followingStepIndex >= steps.length,
      readyStatusToRemove
    })
    if (followingStepIndex >= steps.length) {
      // All steps complete!
      console.log('[advanceToNextStepWithCoords] All steps complete! Calling markAbilityUsed:', readyStatusToRemove)
      markAbilityUsed(sourceCoords || { row: 0, col: 0 }, abilityMode.isDeployAbility, false, readyStatusToRemove)
      setAbilityMode(null)
      return
    }

    // Continue to the step after this instant step
    console.log('[advanceToNextStepWithCoords] Continuing to following step:', followingStepIndex)
    advanceToNextStepWithCoords(props, sourceCoords || { row: 0, col: 0 }, followingStepIndex)
    return
  } else {
    // Enter next interactive mode
    const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0

    // Handle special action types
    let stepAction: AbilityAction

    // Handle CREATE_STACK - keep as CREATE_STACK to trigger handleCreateStack (cursor stack)
    if (nextStep.action === "CREATE_STACK") {
      const details = nextStep.details || {}
      stepAction = {
        type: "CREATE_STACK",
        mode: "SELECT_TARGET",
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        tokenType: details.tokenType,
        count: details.count || 1,
        targetOwnerId: sourceCard?.ownerId,
        mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
        mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
        payload: {
          ...nextStep.details,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    } else if (nextStep.action === "CREATE_TOKEN") {
      // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
      stepAction = {
        type: "OPEN_MODAL",
        mode: "PLACE_TOKEN",
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        payload: {
          ...nextStep.details,
          tokenId: nextStep.details?.tokenId,
          range: nextStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    } else {
      // Default interactive step handling (SACRIFICE_TARGET, etc.)
      // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
      // These are targeting constraints, not separate modes. The constraint is stored in payload.
      const normalizedMode = (nextStep.mode === "LINE_TARGET" || nextStep.mode === "ADJACENT_TARGET")
        ? "SELECT_TARGET"
        : (nextStep.mode || "SELECT_TARGET")

      stepAction = {
        type: 'ENTER_MODE',
        mode: normalizedMode,
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        payload: {
          ...nextStep.details,
          tokenType: nextStep.details?.tokenType,
          count: nextStep.details?.count,
          mustBeInLineWithSource: nextStep.mode === 'LINE_TARGET' ? true : undefined,
          mustBeAdjacentToSource: nextStep.mode === 'ADJACENT_TARGET' ? true : undefined,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    }

    setAbilityMode(stepAction)

    // Mark source card as transitioning to prevent infinite re-processing
    if (sourceCard && sourceCoords) {
      const transitionKey = `${sourceCard.id}-${sourceCoords.row}-${sourceCoords.col}`
      transitioningCards.add(transitionKey)
      clearTransitioning(transitionKey, 200)
    }

    // Update targeting mode to show valid targets for the new mode
    if (setTargetingMode && calculateValidTargets) {
      const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)
      setTargetingMode(stepAction, ownerId, sourceCoords, validTargets, commandContext)
    }
  }
}

/**
 * Handle SELECT_TARGET with various actionTypes
 */
function handleSelectTargetActionType(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, markAbilityUsed, setAbilityMode, moveItem, modifyBoardCardPower, addBoardCardStatus, removeBoardCardStatus, removeBoardCardStatusByOwner, removeStatusByType, resetDeployStatus, setCounterSelectionData, handleActionExecution, gameState, destroyCard, setCommandContext } = props
  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode!

  console.log('[handleSelectTargetActionType] Called with actionType:', payload?.actionType, 'card:', card.baseId, 'coords:', boardCoords)

  const actorId = abilityMode!.sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : props.localPlayerId || gameState.activePlayerId)

  // OPEN_COUNTER_MODAL
  if (payload.actionType === 'OPEN_COUNTER_MODAL') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    setCounterSelectionData({
      card: card,
      callbackAction: payload.rewardType,
    })
    setAbilityMode(null)
    return true
  }

  // SACRIFICE_TARGET (Step 1 of Centurion's multi-step ability)
  // Sacrifices a card and stores its coordinates for the next step
  if (payload.actionType === 'SACRIFICE_TARGET') {
    console.log('[handleSelectTargetActionType] SACRIFICE_TARGET processing for', card.baseId)

    // CRITICAL: payload.filter may be a string (e.g., "isOwner") instead of a function
    // Skip local filter check if filter is not a function - calculateValidTargets will handle it
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      console.log('[handleSelectTargetActionType] Filter failed for', card.baseId)
      return false
    }

    // Get the owner of the card being sacrificed
    const sacrificedOwnerId = card.ownerId
    // Get the source card owner (Centurion's owner) - this is whose allies get buffed
    const sourceOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId ?? 0

    console.log('[handleSelectTargetActionType] Sacrificing', card.baseId, 'owner:', sacrificedOwnerId, 'sourceOwnerId:', sourceOwnerId)

    // Check for Shield - protect from sacrifice
    const hasShield = card.statuses?.some(s => s.type === 'Shield')
    if (hasShield) {
      console.log('[handleSelectTargetActionType] Card has Shield, removing instead')
      // Remove Shield and stop - card is not sacrificed
      removeBoardCardStatus(boardCoords, 'Shield')
      // Mark ability as used since we consumed it
      markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Store the sacrificed card's coordinates AND the source owner BEFORE destroying
    // This will be used to buff lines in the BUFF_LINES_FROM_CONTEXT step
    const stepContext = {
      lastMovedCardCoords: boardCoords,
      sourceOwnerId: sourceOwnerId  // Owner of Centurion (whose allies get buffed)
    }
    setCommandContext({
      lastMovedCardCoords: boardCoords,
      lastMovedCardId: (sacrificedOwnerId ?? 0).toString(),
      sourceOwnerId: sourceOwnerId ?? undefined
    })

    // Destroy the card - sends to owner's discard and handles cleanup
    destroyCard(card, boardCoords)

    // Continue to next step in AUTO_STEPS
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      console.log('[handleSelectTargetActionType] Continuing to next step, index:', autoStepsContext.currentStepIndex)
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex, stepContext)
      return true
    }

    // Fallback: if not part of AUTO_STEPS, end the ability
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SACRIFICE_AND_BUFF_LINES (Centurion) - Legacy single-step version
  if (payload.actionType === 'SACRIFICE_AND_BUFF_LINES') {

    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the owner of Centurion (the card performing the ability)
    const centurionOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId

    // Sacrifice - send selected card to its owner's discard
    // IMPORTANT: playerId must be in item (first param) for MOVE_CARD_TO_DISCARD action
    moveItem({
      card,
      source: 'board',
      boardCoords,
      bypassOwnershipCheck: true,
      playerId: card.ownerId,
    }, {
      target: 'discard',
      playerId: card.ownerId,
    })

    // Buff allies in Centurion's row and column (not the sacrificed card's position)
    // "Allied" here means cards owned by the same player as Centurion
    const gridSize = gameState.board.length
    // Use Centurion's coordinates (sourceCoords), not the sacrificed card's coordinates
    const { row: r1, col: c1 } = sourceCoords || boardCoords

    let buffedCount = 0

    // Buff all cards in the same row (except Centurion itself)
    for (let c = 0; c < gridSize; c++) {
      const cell = gameState.board[r1][c]
      const targetCard = cell.card
      if (targetCard) {
        if (targetCard.ownerId === centurionOwnerId) {
          modifyBoardCardPower({ row: r1, col: c }, 1)
          buffedCount++
        }
      }
    }

    // Buff all cards in the same column (except Centurion itself which was already buffed)
    for (let r = 0; r < gridSize; r++) {
      if (r === r1) {continue} // Skip the row we already processed
      const cell = gameState.board[r][c1]
      const targetCard = cell.card
      if (targetCard) {
        if (targetCard.ownerId === centurionOwnerId) {
          modifyBoardCardPower({ row: r, col: c1 }, 1)
          buffedCount++
        }
      }
    }


    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SHIELD_AND_REMOVE_AIM (Temporary Shelter)
  if (payload.actionType === 'SHIELD_AND_REMOVE_AIM') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    addBoardCardStatus(boardCoords, 'Shield', actorId!)
    removeStatusByType(boardCoords, 'Aim')
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // RESET_DEPLOY (Experimental Stimulants)
  if (payload.actionType === 'RESET_DEPLOY') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    resetDeployStatus(boardCoords)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // DESTROY
  if (payload.actionType === 'DESTROY') {
    // Check filter - may be a string (e.g., "isOwner") or function
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Check for Shield - unless ignored by ability (e.g., Centurion Commit)
    if (!payload.ignoreShield) {
      const hasShield = card.statuses?.some(s => s.type === 'Shield')
      if (hasShield) {
        // Shield protects the card - remove Shield and stop
        removeBoardCardStatus(boardCoords, 'Shield')
        markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return true
      }
    }

    // Store coordinates for potential AUTO_STEPS continuation (Centurion Commit)
    let stepContext: { lastMovedCardCoords: { row: number; col: number }; sourceOwnerId: number } | undefined
    if (payload.recordContext) {
      const sourceOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId ?? 0
      stepContext = {
        lastMovedCardCoords: boardCoords,
        sourceOwnerId: sourceOwnerId
      }
      setCommandContext({
        lastMovedCardCoords: boardCoords,
        lastMovedCardId: (card.ownerId ?? 0).toString(),
        sourceOwnerId: sourceOwnerId ?? undefined
      })
    }

    // No Shield - destroy the card (send to discard)
    // destroyCard removes Aim token (consumed by ability) and sends card to owner's discard in one atomic operation
    destroyCard(card, boardCoords)

    // Check for AUTO_STEPS continuation
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      console.log('[handleSelectTargetActionType] DESTROY continuing to next step, index:', autoStepsContext.currentStepIndex)
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex, stepContext)
      return true
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // MODIFY_POWER (Walking Turret Setup, etc.)
  if (payload.actionType === 'MODIFY_POWER') {
    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Apply power modification
    modifyBoardCardPower(boardCoords, payload.amount || 0)

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // LUCIUS_SETUP
  if (payload.actionType === 'LUCIUS_SETUP') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    moveItem({
      card,
      source: 'board',
      boardCoords,
    }, {
      target: 'discard',
      playerId: card.ownerId,
    })
    if (payload.chainedAction) {
      handleActionExecution(payload.chainedAction, boardCoords)
    }
    return true
  }

  // CENSOR_SWAP (Censor Commit)
  if (payload.actionType === 'CENSOR_SWAP') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }

    // Remove 1 Exploit, add 2 Stun
    const exploitCount = card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
    if (exploitCount > 0) {
      // Remove exactly 1 Exploit token
      removeBoardCardStatusByOwner(boardCoords, 'Exploit', actorId!)
      // Add exactly 2 Stun tokens
      addBoardCardStatus(boardCoords, 'Stun', actorId!)
      addBoardCardStatus(boardCoords, 'Stun', actorId!)
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // REVEAL_ENEMY_CHAINED (Recon Drone Commit)
  if (payload.actionType === 'REVEAL_ENEMY_CHAINED') {
    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the target opponent's ID from the selected card
    const targetOpponentId = card.ownerId

    // Execute the chained action (CREATE_STACK for Revealed token)
    // with targetOwnerId set to the selected card's owner
    // IMPORTANT: Pass sourceCard to ensure correct token ownership
    if (abilityMode?.chainedAction) {
      const chainedAction: AbilityAction = {
        type: abilityMode.chainedAction.type || 'CREATE_STACK',
        tokenType: abilityMode.chainedAction.tokenType || 'Revealed',
        count: abilityMode.chainedAction.count || 1,
        targetOwnerId: targetOpponentId,
        sourceCoords: sourceCoords || boardCoords,
        sourceCard: abilityMode.sourceCard, // Pass the source card (Recon Drone) for token ownership
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
      }
      handleActionExecution(chainedAction, boardCoords)
      // Chained action will set up the token placement mode and handle completion
      // Don't clear mode here - let the chained action's flow complete
      return true
    }

    console.warn('[REVEAL_ENEMY_CHAINED] No chainedAction found in abilityMode!')
    // No chained action - mark ability as used and clear mode
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  return false
}

/**
 * Handle RIOT_PUSH mode
 */
function handleRiotPush(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, moveItem, markAbilityUsed, interactionLock } = props

  if (interactionLock.current) {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode!

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  // Allow self-click to skip/finish
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
  const actorPlayer = gameState.players.find(p => p.id === sourceCard?.ownerId)
  const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined && targetPlayer.teamId === actorPlayer.teamId

  if (!isAdj || card.ownerId === sourceCard?.ownerId || isTeammate) {
    return false
  }

  const dRow = boardCoords.row - sourceCoords.row
  const dCol = boardCoords.col - sourceCoords.col
  const targetRow = boardCoords.row + dRow
  const targetCol = boardCoords.col + dCol

  // Calculate visible grid boundaries
  const gridSize = gameState.board.length
  const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + gameState.activeGridSize - 1

  if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
    return false
  }

  if (gameState.board[targetRow][targetCol].card !== null) {
    return false
  }

  moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'RIOT_MOVE',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    payload: { vacatedCoords: boardCoords }
  })
  return true
}

/**
 * Handle RIOT_MOVE mode (after push)
 */
function handleRiotMove(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'RIOT_MOVE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || !sourceCard || !payload?.vacatedCoords) {
    return false
  }

  if (boardCoords.row === payload.vacatedCoords.row && boardCoords.col === payload.vacatedCoords.col) {
    // Move to vacated cell
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
    markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // If clicked elsewhere, cancel
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle SHIELD_SELF_THEN_RIOT_PUSH (Reclaimed Gawain Deploy)
 * 1. Add Shield status to self (if not already added)
 * 2. Transition to RIOT_PUSH mode or perform push directly
 *
 * IMPORTANT: If shieldApplied is true in payload, Shield was already added.
 * In that case:
 * - Self-click → cancel mode and mark ability as used (skip push)
 * - Adjacent opponent click → do push directly
 */
function handleShieldSelfThenRiotPush(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, addBoardCardStatus, markAbilityUsed, interactionLock, setTargetingMode, commandContext, moveItem } = props

  if (interactionLock.current) {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard, payload } = abilityMode!

  if (!sourceCoords || sourceCoords.row < 0 || !sourceCard) {
    return false
  }

  const ownerId = sourceCard.ownerId!
  const shieldAlreadyApplied = payload?.shieldApplied === true

  // Check if clicking on self
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    if (shieldAlreadyApplied) {
      // Shield already applied - self-click cancels the mode (skip push)
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setAbilityMode(null)
      return true
    } else {
      // Old behavior: add Shield and transition to RIOT_PUSH
      addBoardCardStatus(sourceCoords, 'Shield', ownerId)

      const riotPushAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'RIOT_PUSH',
        sourceCard,
        sourceCoords,
        isDeployAbility,
        readyStatusToRemove,
        payload: {}
      }

      setAbilityMode(riotPushAction)

      // Recalculate valid targets for RIOT_PUSH
      const dRow = sourceCoords.row
      const dCol = sourceCoords.col
      const preCalculatedTargets: {row: number, col: number}[] = []

      // Check all adjacent cells
      const adjacentOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      const gridSize = gameState.board.length
      const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
      const minBound = offset
      const maxBound = offset + gameState.activeGridSize - 1

      for (const [dr, dc] of adjacentOffsets) {
        const r = dRow + dr
        const c = dCol + dc
        if (r >= minBound && r <= maxBound && c >= minBound && c <= maxBound) {
          const targetCell = gameState.board[r][c]
          const targetCard = targetCell?.card
          if (targetCard) {
            const targetPlayer = gameState.players.find(p => p.id === targetCard.ownerId)
            const actorPlayer = gameState.players.find(p => p.id === ownerId)
            const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined &&
                              targetPlayer.teamId === actorPlayer.teamId

            if (targetCard.ownerId !== ownerId && !isTeammate) {
              preCalculatedTargets.push({row: r, col: c})
            }
          }
        }
      }

      setTargetingMode(riotPushAction, ownerId, sourceCoords, preCalculatedTargets, commandContext)
      return true
    }
  }

  // Handle push logic for adjacent opponent cards
  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
  const actorPlayer = gameState.players.find(p => p.id === ownerId)
  const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined && targetPlayer.teamId === actorPlayer.teamId

  if (isAdj && card.ownerId !== ownerId && !isTeammate) {
    // IMPORTANT: Apply Shield first if not already applied
    // This handles the case where player clicks directly on adjacent card
    if (!shieldAlreadyApplied) {
      addBoardCardStatus(sourceCoords, 'Shield', ownerId)
    }

    const dRow = boardCoords.row - sourceCoords.row
    const dCol = boardCoords.col - sourceCoords.col
    const targetRow = boardCoords.row + dRow
    const targetCol = boardCoords.col + dCol

    // Calculate visible grid boundaries
    const gridSize = gameState.board.length
    const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
    const minBound = offset
    const maxBound = offset + gameState.activeGridSize - 1

    if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
      return false
    }

    if (gameState.board[targetRow][targetCol].card !== null) {
      return false
    }

    // Perform the push
    moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })

    // Transition to RIOT_MOVE mode (move into vacated cell)
    setAbilityMode({
      type: 'ENTER_MODE',
      mode: 'RIOT_MOVE',
      sourceCard,
      sourceCoords,
      isDeployAbility,
      readyStatusToRemove,
      payload: { vacatedCoords: boardCoords }
    })
    return true
  }

  return false
}

/**
 * Handle SWAP_POSITIONS (Reckless Provocateur Deploy)
 */
function handleSwapPositions(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, swapCards, markAbilityUsed, setAbilityMode, validTargets } = props

  if (!abilityMode || abilityMode.mode !== 'SWAP_POSITIONS') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  const actualSourceCard = gameState.board[sourceCoords.row][sourceCoords.col].card
  if (!actualSourceCard || actualSourceCard.id !== sourceCard?.id) {
    setAbilityMode(null)
    return false
  }

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
    return false
  }

  if (!payload.filter && validTargets) {
    const isValidTarget = validTargets.some(t => t.row === boardCoords.row && t.col === boardCoords.col)
    if (!isValidTarget) {
      return false
    }
  }

  // IMPORTANT: Mark the SOURCE card's ability as used BEFORE swapping
  // boardCoords is the target, sourceCoords is where Reckless Provocateur (or whichever card has the ability) is
  // We MUST do this BEFORE swapCards because after the swap, sourceCoords will point to a different card!
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  // Swap positions using the dedicated swap function
  swapCards(sourceCoords, boardCoords)

  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle TRANSFER_STATUS_SELECT (Reckless Provocateur Commit)
 */
function handleTransferStatus(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, transferAllStatusesWithoutException, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || (abilityMode.mode !== 'TRANSFER_STATUS_SELECT' && abilityMode.mode !== 'TRANSFER_ALL_STATUSES')) {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  // Check filter if provided (for TRANSFER_ALL_STATUSES - only owner's cards with specific tokens)
  if (payload?.filter && !payload.filter(card)) {
    return false
  }

  // For TRANSFER_ALL_STATUSES, card must have at least one of the specific tokens
  if (abilityMode.mode === 'TRANSFER_ALL_STATUSES') {
    if (!card.statuses || card.statuses.length === 0) {
      return false
    }
    const validTokens = ['Aim', 'Exploit', 'Rule', 'Shield', 'Stun', 'Revealed']
    if (!card.statuses.some(s => validTokens.includes(s.type))) {
      return false
    }
  }

  // Transfer ALL statuses from source card to target card (for TRANSFER_ALL_STATUSES)
  // Reckless Provocateur Commit: Move tokens FROM chosen allied card TO Reckless Provocateur
  // Note: transferAllStatusesWithoutException(fromCoords, toCoords) - from source to target
  if (abilityMode.mode === 'TRANSFER_ALL_STATUSES') {
    // boardCoords = chosen allied card (source of tokens), sourceCoords = Reckless Provocateur (destination)
    transferAllStatusesWithoutException(boardCoords, sourceCoords)
  } else {
    // For TRANSFER_STATUS_SELECT, legacy behavior - transfer one status
    // This is handled elsewhere
  }

  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle ZEALOUS_WEAKEN (Zealous Missionary Commit)
 */
function handleZealousWeaken(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, modifyBoardCardPower, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'ZEALOUS_WEAKEN') {
    return false
  }

  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  if (payload.filter && !payload.filter(card)) {
    return false
  }

  modifyBoardCardPower(boardCoords, -1)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle REVEREND_DOUBLE_EXPLOIT
 */
function handleReverendDoubleExploit(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, addBoardCardStatus, markAbilityUsed, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'REVEREND_DOUBLE_EXPLOIT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0
  const exploitCount = (card.statuses || []).filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length

  if (exploitCount > 0) {
    for (let i = 0; i < exploitCount; i++) {
      addBoardCardStatus(boardCoords, 'Exploit', ownerId)
    }
    triggerFloatingText({
      row: boardCoords.row,
      col: boardCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SELECT_UNIT_FOR_MOVE (Code Keeper/Signal Prophet Commit, Finn Setup)
 */
function handleSelectUnitForMove(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_UNIT_FOR_MOVE') {
    return false
  }

  const { sourceCard, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
    return false
  }

  // Transition to SELECT_CELL mode
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'SELECT_CELL',
    sourceCard: card,
    sourceCoords: boardCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      range: payload.range || 2,
      moveFromHand: payload.moveFromHand || false,
      selectedCard: card,
      allowSelf: false,
    },
  })
  return true
}

/**
 * Handle PATROL_MOVE (Patrol Agent Setup, Edith Byron Setup)
 */
function handlePatrolMove(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'PATROL_MOVE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords || !sourceCard) {
    return false
  }

  // Same cell = cancel
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Check if in same row or column
  const sameRow = boardCoords.row === sourceCoords.row
  const sameCol = boardCoords.col === sourceCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Check if cell is empty
  if (gameState.board[boardCoords.row][boardCoords.col].card !== null) {
    return false
  }

  moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
  markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SPAWN_TOKEN (Inventive Maker Deploy, Edith Byron Deploy)
 */
function handleSpawnToken(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, spawnToken, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SPAWN_TOKEN') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

  if (!sourceCoords || !payload?.tokenName) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
  spawnToken(boardCoords, payload.tokenName, tokenOwnerId!)
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SWAP_ADJACENT (Swap positions with adjacent card)
 */
function handleSwapAdjacent(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, swapCards, setAbilityMode } = props


  if (!abilityMode || abilityMode.mode !== 'SWAP_ADJACENT') {
    return false
  }

  const { sourceCoords, sourceCard } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  const actualSourceCard = gameState.board[sourceCoords.row][sourceCoords.col].card
  if (!actualSourceCard || actualSourceCard.id !== sourceCard?.id) {
    setAbilityMode(null)
    return false
  }

  // Don't swap with self
  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  // Check if target is adjacent
  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  // Check if target is valid (has a card)
  if (!card || !gameState.board[boardCoords.row][boardCoords.col].card) {
    return false
  }

  // Use gameState.targetingMode.boardTargets for validation (not validTargets prop)
  const targetingModeTargets = gameState.targetingMode?.boardTargets
  if (targetingModeTargets && targetingModeTargets.length > 0) {
    const isValidTarget = targetingModeTargets.some(t => t.row === boardCoords.row && t.col === boardCoords.col)
    if (!isValidTarget) {
      return false
    }
  }


  // Swap positions
  swapCards(sourceCoords, boardCoords)

  // NOTE: markAbilityUsed is already called in activateAbility when entering this mode
  // We don't call it again here because after swapCards, sourceCoords points to a different card!
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle PLACE_TOKEN (Modal token placement from CREATE_TOKEN action)
 */
function handlePlaceToken(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, spawnToken, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'PLACE_TOKEN') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

  if (!sourceCoords || !payload?.tokenId) {
    return false
  }

  const range = payload.range || 'global'

  // Check if placement is valid based on range
  if (range === 'adjacent') {
    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {
      return false
    }
  }

  const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
  spawnToken(boardCoords, payload.tokenId, tokenOwnerId!)

  // Check if this is part of AUTO_STEPS
  const autoStepsContext = payload._autoStepsContext
  if (autoStepsContext && autoStepsContext.steps) {
    // Continue to next step instead of marking ability as used
    advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex)
  } else {
    // Normal completion
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  }
  return true
}

/**
 * Handle REVEAL_ENEMY (Recon Drone Commit)
 */
function handleRevealEnemy(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setAbilityMode, setCursorStack, markAbilityUsed, gameState, localPlayerId, setTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'REVEAL_ENEMY') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords || !sourceCard) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  // RECON DRONE FIX: Check if target is a token (tokens cannot be targeted by Recon Drone)
  // Tokens have deck === 'Tokens' or types include 'Token'
  const isToken = card.deck === 'Tokens' || card.types?.includes('Token')
  if (isToken) {
    return false
  }

  const ownerId = card.ownerId

  // Validate ownerId - card must have an owner
  if (ownerId === undefined || ownerId === null) {
    return false
  }

  // Use universal token targeting system to create cursorStack
  // Modifications: targetOwnerId restricts to selected card's owner's hand
  // onlyFaceDown: only target unrevealed cards
  // onlyOpponents: implicit (targetOwnerId is opponent)
  // tokenOwnerId: the player who activated Recon Drone (will own the Revealed status)
  const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
  const tokenOwnerId = (activePlayer?.isDummy && gameState.activePlayerId !== null)
    ? gameState.activePlayerId
    : (localPlayerId ?? 0)

  const modifications: Partial<CursorStackState> = {
    targetOwnerId: ownerId,  // Only reveal cards from the targeted opponent's hand
    onlyFaceDown: true,       // Only unrevealed cards
    sourceCoords: boardCoords,
    sourceCard: card,
    isDeployAbility,
    readyStatusToRemove,
  }

  setCursorStack(createTokenCursorStack('Revealed', tokenOwnerId, null, modifications))

  // Calculate hand targets for the targeted opponent's hand
  // Revealed can be placed on cards that don't already have Revealed from this player
  const handTargets: {playerId: number, cardIndex: number}[] = []
  const targetPlayer = gameState.players.find(p => p.id === ownerId)
  if (targetPlayer?.hand) {
    targetPlayer.hand.forEach((handCard, index) => {
      // Card is valid if it doesn't already have Revealed from this player
      const alreadyHasRevealed = handCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId)
      if (!alreadyHasRevealed) {
        handTargets.push({ playerId: ownerId, cardIndex: index })
      }
    })
  }

  // Create a dummy action for setTargetingMode (required parameter)
  const dummyAction: AbilityAction = {
    type: 'CREATE_STACK',
    mode: 'SELECT_TARGET',
    payload: {
      tokenType: 'Revealed',
      filter: () => true,
    },
    sourceCoords: boardCoords,
    sourceCard,
  }

  // Activate targeting mode so all players see the valid hand targets highlighted
  setTargetingMode(dummyAction, tokenOwnerId, boardCoords, undefined, undefined, handTargets)

  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  // CRITICAL FIX: Clear abilityMode after creating cursorStack
  // This prevents the targeting mode from persisting and allows the token placement to complete
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

  return true
}

/**
 * Handle SELECT_CELL (Recon Drone Setup, Finn Setup, etc.)
 */
function handleSelectCell(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_CELL') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (payload?.filter && !payload.filter(null, boardCoords.row, boardCoords.col)) {
    return false
  }

  if (payload?.moveFromHand && payload?.selectedCard) {
    moveItem({
      card: payload.selectedCard,
      source: 'hand',
    }, { target: 'board', boardCoords })
  } else if (sourceCoords && sourceCoords.row >= 0 && sourceCard) {
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle IMMUNIS_RETRIEVE (Immunis Deploy)
 */
function handleImmunisRetrieve(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'IMMUNIS_RETRIEVE') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  if (payload?.selectedCard) {
    moveItem({
      card: payload.selectedCard,
      source: 'discard',
    }, { target: 'board', boardCoords })
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  return false
}

/**
 * Handle RECON_DRONE_COMMIT (2-step: select adjacent opponent card, then reveal their hand card)
 */
function handleReconDroneCommit(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, setCursorStack, triggerClickWave, triggerNoTarget, setTargetingMode, markAbilityUsed } = props

  if (!abilityMode || abilityMode.mode !== 'RECON_DRONE_COMMIT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords) {
    return false
  }

  // Step 1: Select adjacent opponent card
  if (!payload._step2TargetOwnerId) {
    // Check if target is adjacent
    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {
      return false
    }

    // Check if target is opponent
    const ownerId = sourceCard?.ownerId || 0
    if (card.ownerId === ownerId) {
      return false // Can't select own cards
    }

    // Step 1 complete - transition to step 2
    triggerClickWave('board', boardCoords)

    // Get token owner ID (the player who owns Recon Drone)
    const tokenOwnerId = sourceCard?.ownerId || gameState.activePlayerId || props.localPlayerId || 1
    const targetOwnerId = card.ownerId ?? 1 // Ensure targetOwnerId is defined

    // Calculate hand targets for the targeted opponent's hand
    // Revealed can be placed on cards that don't already have Revealed from this player
    const handTargets: {playerId: number, cardIndex: number}[] = []
    const targetPlayer = gameState.players.find(p => p.id === targetOwnerId)
    if (targetPlayer?.hand) {
      targetPlayer.hand.forEach((handCard, index) => {
        // Card is valid if it doesn't already have Revealed from this player
        const alreadyHasRevealed = handCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId)
        if (!alreadyHasRevealed) {
          handTargets.push({ playerId: targetOwnerId, cardIndex: index })
        }
      })
    }

    // Check if there are any valid hand targets
    if (handTargets.length === 0) {
      // No valid targets - show "no target" effect and don't proceed
      triggerNoTarget(boardCoords)
      // Clear ability mode and preserve ready status
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Update ability mode to step 2
    setAbilityMode({
      ...abilityMode,
      payload: {
        ...payload,
        _step2TargetOwnerId: targetOwnerId, // Save for step 2
        _step1TargetCardId: card.id
      }
    })

    // Create cursor stack for Revealed tokens
    // Set targetOwnerId to the selected opponent's ID so only their hand cards can be targeted
    // NOTE: We do NOT pass chainedAction here - the ability is completed by clicking a hand card
    // The chainedAction from payload would cause unwanted "no target" effects after completion
    setCursorStack({
      type: 'Revealed',
      count: payload.count || 1,
      targetOwnerId,
      isDragging: false,
      sourceCoords,
      sourceCard,
      isDeployAbility,
      readyStatusToRemove
      // No chainedAction - ability completes when hand card is clicked
    })

    // Create a dummy action for setTargetingMode (required parameter)
    const dummyAction: AbilityAction = {
      type: 'CREATE_STACK',
      mode: 'SELECT_TARGET',
      payload: {
        tokenType: 'Revealed',
        filter: () => true,
      },
      sourceCoords,
      sourceCard,
    }

    // Activate targeting mode so all players see the valid hand targets highlighted
    setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, undefined, undefined, handTargets)

    // Mark ability as used after creating cursorStack (Recon Drone ability is now complete)
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

    // Clear abilityMode after creating cursorStack
    // This allows the token placement to complete without interference
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

    return true
  }

  // Step 2: Target should be hand card (handled elsewhere via handCardHandlers)
  // This handler is only for board card selection (step 1)
  return false
}

/**
 * Handle INTEGRATOR_LINE_SELECT (Unwavering Integrator Setup)
 */
function handleIntegratorLineSelect(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, updatePlayerScore, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'INTEGRATOR_LINE_SELECT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Check if selected same row or column as source
  const sameRow = sourceCoords !== undefined && boardCoords.row === sourceCoords.row
  const sameCol = sourceCoords !== undefined && boardCoords.col === sourceCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Exploit in selected line
  let exploitCount = 0

  if (sameRow && sourceCoords) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
      }
    }
  } else if (sourceCoords) {
    for (let r = 0; r < gameState.board.length; r++) {
      const card = gameState.board[r][boardCoords.col].card
      if (r === sourceCoords.row) {continue}
      if (card?.statuses) {
        exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)
    triggerFloatingText({
      row: sourceCoords.row,
      col: sourceCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle IP_AGENT_THREAT_SCORING (IP Dept Agent Setup)
 */
function handleIpAgentThreatScoring(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, updatePlayerScore, triggerFloatingText, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'IP_AGENT_THREAT_SCORING') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  if (!sourceCoords) {
    return false
  }

  // Check if selected same row or column
  const sameRow = boardCoords.row === sourceCoords.row
  const sameCol = boardCoords.col === sourceCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Threat in selected line
  let threatCount = 0

  if (sameRow) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
      }
    }
  } else {
    for (let r = 0; r < gameState.board.length; r++) {
      const card = gameState.board[r][boardCoords.col].card
      if (r === sourceCoords.row) {continue}
      if (card?.statuses) {
        threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
      }
    }
  }

  const points = threatCount * 2
  if (points > 0) {
    updatePlayerScore(ownerId, points)
    triggerFloatingText({
      row: sourceCoords.row,
      col: sourceCoords.col,
      text: `+${points}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle ZIUS_LINE_SELECT (Zius Setup - after placing Exploit)
 */
function handleZiusLineSelect(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, commandContext, updatePlayerScore, triggerFloatingText, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'ZIUS_LINE_SELECT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Use the card that just got Exploit from commandContext
  const contextCoords = commandContext.lastMovedCardCoords || sourceCoords

  if (!contextCoords) {
    return false
  }

  // Check if selected same row or column as context card
  const sameRow = boardCoords.row === contextCoords.row
  const sameCol = boardCoords.col === contextCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Exploit in selected line
  let exploitCount = 0
  const cardsWithExploit: {row: number, col: number}[] = []

  if (sameRow) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        const exploits = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
        exploitCount += exploits.length
        if (exploits.length > 0) {
          cardsWithExploit.push({ row: boardCoords.row, col: c })
        }
      }
    }
  } else {
    for (let r = 0; r < gameState.board.length; r++) {
      const card = gameState.board[r][boardCoords.col].card
      if (r === contextCoords.row) {continue}
      if (card?.statuses) {
        const exploits = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
        exploitCount += exploits.length
        if (exploits.length > 0) {
          cardsWithExploit.push({ row: r, col: boardCoords.col })
        }
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)

    // Show floating text for each card with Exploit
    cardsWithExploit.forEach(coords => {
      triggerFloatingText({
        row: coords.row,
        col: coords.col,
        text: '+1',
        playerId: ownerId,
      })
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SELECT_DIAGONAL (Logistics Chain)
 */
function handleSelectDiagonal(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, updatePlayerScore, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_DIAGONAL') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Check if selected on diagonal
  const { row: r1, col: c1 } = boardCoords
  const { row: r2, col: c2 } = sourceCoords || { row: 0, col: 0 }

  // Main diagonal
  const onMainDiagonal = (r1 - c1) === (r2 - c2)
  // Anti-diagonal
  const onAntiDiagonal = (r1 + c1) === (r2 + c2)

  if (!onMainDiagonal && !onAntiDiagonal) {
    return false
  }

  // Select the card for move
  if (payload?.selectForMove && card) {
    // Move card to diagonal position
    // This would be handled by a chained action
    if (payload.chainedAction) {
      props.handleActionExecution(payload.chainedAction, boardCoords)
    }
    return true
  }

  // Score diagonal
  let exploitCount = 0
  const gridSize = gameState.board.length

  // Main diagonal
  if (onMainDiagonal) {
    const diff = r2 - c2
    for (let i = 0; i < gridSize; i++) {
      const r = diff + i
      const c = i
      if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        const cell = gameState.board[r][c].card
        if (cell?.statuses) {
          exploitCount += cell.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        }
      }
    }
  }

  // Anti-diagonal
  if (onAntiDiagonal) {
    const sum = r2 + c2
    for (let i = 0; i < gridSize; i++) {
      const r = i
      const c = sum - r
      if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
        const cell = gameState.board[r][c].card
        if (cell?.statuses) {
          exploitCount += cell.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        }
      }
    }
  }

  // Bonus for Support
  if (payload?.bonusForSupport && sourceCard?.statuses?.some((s: any) => s.type === 'Support')) {
    exploitCount += payload.bonusForSupport
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)
    triggerFloatingText({
      row: sourceCoords?.row || boardCoords.row,
      col: sourceCoords?.col || boardCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SCORE_LAST_PLAYED_LINE
 */
function handleScoreLastPlayedLine(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, commandContext, markAbilityUsed, updatePlayerScore, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SCORE_LAST_PLAYED_LINE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Get the last played card coords from commandContext
  const lastPlayedCoords = commandContext.lastMovedCardCoords
  if (!lastPlayedCoords) {
    return false
  }

  const lastPlayedCard = gameState.board[lastPlayedCoords.row][lastPlayedCoords.col].card
  if (!lastPlayedCard) {
    return false
  }

  // Check if same row or column
  const sameRow = boardCoords.row === lastPlayedCoords.row
  const sameCol = boardCoords.col === lastPlayedCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Calculate power
  const power = Math.max(0, lastPlayedCard.power + (lastPlayedCard.powerModifier || 0))

  // Handle different reward types
  if (payload?.rewardType === 'SCORE') {
    updatePlayerScore(ownerId, power)
    triggerFloatingText({
      row: lastPlayedCoords.row,
      col: lastPlayedCoords.col,
      text: `+${power}`,
      playerId: ownerId,
    })
  } else if (payload?.rewardType === 'DRAW') {
    // Draw cards equal to power
    // This would need drawCard function
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SEARCH_DECK (Mr. Pearl, Falk PD)
 */
function handleSearchDeck(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setViewingDiscard, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SEARCH_DECK') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  // Open deck search modal
  setViewingDiscard(true)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle RETRIEVE_DEVICE (Inventive Maker Setup)
 */
function handleRetrieveDevice(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setViewingDiscard, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'RETRIEVE_DEVICE') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  // Open discard retrieve modal
  setViewingDiscard(true)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle SELECT_DECK (Secret Informant)
 */
function handleSelectDeck(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, triggerDeckSelection, markAbilityUsed, setAbilityMode, clearTargetingMode, localPlayerId } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_DECK') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  triggerDeckSelection(card.ownerId ?? 0, localPlayerId ?? 0)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  clearTargetingMode() // Clear targeting mode immediately after selection
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle LINES_WITH_SUPPORT (Signal Prophet Deploy)
 * Places 1 Exploit token on each of your cards with Support in lines
 */
function handleLinesWithSupport(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, setTargetingMode, commandContext } = props

  if (!abilityMode || abilityMode.mode !== 'LINES_WITH_SUPPORT') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  // Find all cards with Support in lines (horizontal and vertical) from source card
  const { row, col } = sourceCoords || { row: boardCoords.row, col: boardCoords.col }
  const gridSize = gameState.board.length
  const validTargets: { row: number; col: number }[] = []

  // Check horizontal line (same row)
  for (let c = 0; c < gridSize; c++) {
    if (c === col) continue // Skip source card itself
    const cell = gameState.board[row][c]
    if (cell.card?.ownerId === ownerId && cell.card.statuses?.some((s: any) => s.type === 'Support')) {
      validTargets.push({ row, col: c })
    }
  }

  // Check vertical line (same column)
  for (let r = 0; r < gridSize; r++) {
    if (r === row) continue // Skip source card itself
    const cell = gameState.board[r][col]
    if (cell.card?.ownerId === ownerId && cell.card.statuses?.some((s: any) => s.type === 'Support')) {
      validTargets.push({ row: r, col })
    }
  }

  if (validTargets.length === 0) {
    // No valid targets - mark as used and clear mode
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Set targeting mode with pre-calculated targets
  setTargetingMode(abilityMode, ownerId ?? 0, sourceCoords, validTargets, commandContext)

  // Enter CREATE_STACK mode for placing tokens
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'CREATE_STACK',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      tokenType: payload?.tokenType || 'Exploit',
      count: 1,
      remainingTargets: validTargets.length,
      targets: validTargets,
      targetIndex: 0
    }
  })

  return true
}

/**
 * Handle LINES_WITH_THREAT
 * Places tokens on each of your cards with Threat in lines
 */
function handleLinesWithThreat(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, setTargetingMode, commandContext } = props

  if (!abilityMode || abilityMode.mode !== 'LINES_WITH_THREAT') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  // Find all cards with Threat in lines (horizontal and vertical) from source card
  const { row, col } = sourceCoords || { row: boardCoords.row, col: boardCoords.col }
  const gridSize = gameState.board.length
  const validTargets: { row: number; col: number }[] = []

  // Check horizontal line (same row)
  for (let c = 0; c < gridSize; c++) {
    if (c === col) continue
    const cell = gameState.board[row][c]
    if (cell.card?.ownerId === ownerId && cell.card?.statuses?.some((s: any) => s.type === 'Threat')) {
      validTargets.push({ row, col: c })
    }
  }

  // Check vertical line (same column)
  for (let r = 0; r < gridSize; r++) {
    if (r === row) continue
    const cell = gameState.board[r][col]
    if (cell.card?.ownerId === ownerId && cell.card?.statuses?.some((s: any) => s.type === 'Threat')) {
      validTargets.push({ row: r, col })
    }
  }

  if (validTargets.length === 0) {
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Set targeting mode with pre-calculated targets
  setTargetingMode(abilityMode, ownerId ?? 0, sourceCoords, validTargets, commandContext)

  // Enter CREATE_STACK mode for placing tokens
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'CREATE_STACK',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      tokenType: payload?.tokenType || 'Exploit',
      count: 1,
      remainingTargets: validTargets.length,
      targets: validTargets,
      targetIndex: 0
    }
  })

  return true
}

/**
 * Handle AUTO_STEPS (Generic multi-step ability system)
 * Processes steps dynamically from database - no more hardcoded patterns!
 */
function handleAutoSteps(
  _card: Card,
  _boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, addBoardCardStatus, setAbilityMode, commandContext, modifyBoardCardPower, setTargetingMode, calculateValidTargets } = props

  if (!abilityMode || abilityMode.mode !== "AUTO_STEPS") {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  if (!payload || !payload.steps || payload.steps.length === 0) {
    console.warn("[AUTO_STEPS] No steps defined")
    return false
  }

  const currentStepIndex = payload.currentStepIndex || 0
  const currentStep = payload.steps[currentStepIndex]


  // Get the owner ID for this ability
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0


  // INSTANT STEPS (no mode) - execute automatically and move to next step
  if (!currentStep.mode) {

    // Use the universal instant step handler
    const instantStepProps: InstantStepProps = {
      gameState,
      localPlayerId: props.localPlayerId,
      commandContext,
      addBoardCardStatus,
      modifyBoardCardPower,
    }

    const result = executeInstantAutoStep(currentStep, sourceCoords, ownerId, instantStepProps)

    if (result.shouldAdvance) {
      advanceToNextStep(props, currentStepIndex)
    }
    return result.success
  }

  // INTERACTIVE STEPS (with mode) - enter the mode and wait for player input
  // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
  // These are targeting constraints, not separate modes. The constraint is stored in payload.
  const normalizedMode = (currentStep.mode === "LINE_TARGET" || currentStep.mode === "ADJACENT_TARGET")
    ? "SELECT_TARGET"
    : (currentStep.mode || "SELECT_TARGET")

  const stepAction: AbilityAction = {
    type: "ENTER_MODE",
    mode: normalizedMode,
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      ...currentStep.details,
      _autoStepsContext: {
        steps: payload.steps,
        currentStepIndex: currentStepIndex + 1,
        originalType: abilityMode.payload?.originalType,
        supportRequired: abilityMode.payload?.supportRequired,
        readyStatusToRemove: readyStatusToRemove
      }
    }
  }

  // Handle CREATE_STACK - keep as CREATE_STACK, add targeting constraints
  // This will trigger handleCreateStack which creates the cursor stack
  if (currentStep.action === "CREATE_STACK" && currentStep.mode) {
    const details = currentStep.details || {}
    // Change type to CREATE_STACK (not OPEN_MODAL) so handleCreateStack is called
    stepAction.type = "CREATE_STACK"
    stepAction.count = details.count || 1  // handleCreateStack reads action.count
    stepAction.tokenType = details.tokenType  // handleCreateStack reads action.tokenType
    stepAction.sourceCard = sourceCard  // handleCreateStack needs this
    stepAction.sourceCoords = sourceCoords  // handleCreateStack needs this
    stepAction.isDeployAbility = isDeployAbility
    stepAction.readyStatusToRemove = readyStatusToRemove
    if (currentStep.mode === "LINE_TARGET") {
      stepAction.mustBeInLineWithSource = true
    } else if (currentStep.mode === "ADJACENT_TARGET") {
      stepAction.mustBeAdjacentToSource = true
    }
  }

  // Handle CREATE_TOKEN - also transform to OPEN_MODAL/PLACE_TOKEN
  if (currentStep.action === "CREATE_TOKEN") {
    stepAction.type = "OPEN_MODAL"
    stepAction.mode = "PLACE_TOKEN"
    // Preserve _autoStepsContext for continuation after token placement
    stepAction.payload = {
      ...currentStep.details,
      tokenId: currentStep.details?.tokenId,
      range: currentStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
      _autoStepsContext: {
        steps: payload.steps,
        currentStepIndex: currentStepIndex + 1,
        originalType: abilityMode.payload?.originalType,
        supportRequired: abilityMode.payload?.supportRequired,
        readyStatusToRemove: readyStatusToRemove
      }
    }
  }

  setAbilityMode(stepAction)

  // Mark source card as transitioning to prevent infinite re-processing
  // CRITICAL: Add this BEFORE setTargetingMode so it's active immediately
  if (sourceCard && sourceCoords) {
    const transitionKey = `${sourceCard.id}-${sourceCoords.row}-${sourceCoords.col}`
    transitioningCards.add(transitionKey)
    clearTransitioning(transitionKey, 200)
  }

  // Update targeting mode to show valid targets for the new mode
  if (setTargetingMode && calculateValidTargets) {
    const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)
    setTargetingMode(stepAction, ownerId, sourceCoords, validTargets, commandContext)
  }

  // CRITICAL: Return false for interactive steps!
  // This allows the click to be processed by the actual mode handler (e.g., handleSelectTargetActionType)
  // The targeting mode and abilityMode will be updated by the next click
  return false
}

/**
 * Advance to the next step in AUTO_STEPS
 */
function advanceToNextStep(
  props: ModeHandlersProps,
  completedStepIndex: number
): void {
  const { abilityMode, setAbilityMode, markAbilityUsed, gameState, commandContext, setTargetingMode, calculateValidTargets } = props

  if (!abilityMode || abilityMode.mode !== "AUTO_STEPS") {
    return
  }

  const payload = abilityMode.payload
  if (!payload || !payload.steps) {
    return
  }

  // Use readyStatusToRemove from _autoStepsContext if not set at action level
  const readyStatusToRemove = abilityMode.readyStatusToRemove ?? payload._autoStepsContext?.readyStatusToRemove

  const nextStepIndex = completedStepIndex + 1

  if (nextStepIndex >= payload.steps.length) {
    // All steps complete!
    const { sourceCoords, isDeployAbility } = abilityMode
    markAbilityUsed(sourceCoords || { row: 0, col: 0 }, isDeployAbility, false, readyStatusToRemove)
    setAbilityMode(null)
    return
  }

  const nextStep = payload.steps[nextStepIndex]

  // If next step has no mode, execute it instantly
  if (!nextStep.mode) {
    // Execute instant step immediately without setTimeout
    const sourceCard = abilityMode.sourceCard
    const sourceCoords = abilityMode.sourceCoords
    const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0

    const instantStepProps = {
      gameState,
      localPlayerId: props.localPlayerId,
      commandContext,
      addBoardCardStatus: props.addBoardCardStatus,
      modifyBoardCardPower: props.modifyBoardCardPower,
    }

    const result = executeInstantAutoStep(nextStep, sourceCoords, ownerId, instantStepProps)

    if (result.shouldAdvance) {
      // Recursively advance to next step (might be another instant step or an interactive step)
      advanceToNextStep(props, nextStepIndex)
    }
    return
  } else {
    // Next step requires player interaction

    // Handle special action types
    let stepAction: AbilityAction

    // Handle CREATE_STACK - keep as CREATE_STACK to trigger handleCreateStack (cursor stack)
    if (nextStep.action === "CREATE_STACK") {
      const details = nextStep.details || {}
      stepAction = {
        type: "CREATE_STACK",
        mode: "SELECT_TARGET",
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        tokenType: details.tokenType,
        count: details.count || 1,
        targetOwnerId: abilityMode.sourceCard?.ownerId,
        mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
        mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
        payload: {
          ...nextStep.details,
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    } else if (nextStep.action === "CREATE_TOKEN") {
      // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
      stepAction = {
        type: "OPEN_MODAL",
        mode: "PLACE_TOKEN",
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        payload: {
          ...nextStep.details,
          tokenId: nextStep.details?.tokenId,
          range: nextStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired
          }
        }
      }
    } else {
      // Default interactive step handling
      stepAction = {
        type: "ENTER_MODE",
        mode: nextStep.mode || "SELECT_TARGET",
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        payload: {
          ...nextStep.details,
          tokenType: nextStep.details?.tokenType,
          count: nextStep.details?.count,
          mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
          mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired
          }
        }
      }
    }

    setAbilityMode(stepAction)

    // Mark source card as transitioning to prevent infinite re-processing
    if (abilityMode.sourceCard && abilityMode.sourceCoords) {
      const transitionKey = `${abilityMode.sourceCard.id}-${abilityMode.sourceCoords.row}-${abilityMode.sourceCoords.col}`
      transitioningCards.add(transitionKey)
      clearTransitioning(transitionKey, 200)
    }

    // Update targeting mode to show valid targets for the new mode
    const ownerId = abilityMode.sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0
    if (setTargetingMode && calculateValidTargets) {
      const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)
      setTargetingMode(stepAction, ownerId, abilityMode.sourceCoords, validTargets, commandContext)
    }
  }
}




