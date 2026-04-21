/**
 * Action Execution Handler
 *
 * Centralized execution of all ability actions
 * Extracted from useAppAbilities.ts
 */

import type { AbilityAction, GameState, CommandContext, DragItem } from '@/types'
import { checkActionHasTargets, calculateValidTargets } from '@shared/utils/targeting'
import { TIMING } from '@/utils/common'
import { createTokenCursorStack } from '@/utils/tokenTargeting'
import { executeInstantAutoStep, advanceToNextStepWithCoords, type AutoStep } from './modeHandlers.js'

export interface ActionHandlerProps {
  gameState: GameState
  getFreshGameState: () => GameState // Функция для получения свежего состояния
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: any
  setCursorStack: React.Dispatch<React.SetStateAction<any>>
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: any
  setPlayMode: React.Dispatch<React.SetStateAction<any>>
  draggedItem: DragItem | null
  setDraggedItem: React.Dispatch<React.SetStateAction<DragItem | null>>
  openContextMenu: (e: React.MouseEvent, type: string, data: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  triggerNoTarget: (coords: { row: number; col: number }) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: any) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  transferAllStatusesWithoutException: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  destroyCard: (card: any, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: {row: number, col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number, count?: number) => void
  removeBoardCardStatus: (coords: {row: number, col: number}, status: string) => void
  removeBoardCardStatusByOwner: (coords: {row: number, col: number}, status: string, pid: number) => void
  removeStatusByType: (coords: {row: number; col: number}, type: string) => void
  resetDeployStatus: (coords: {row: number; col: number}) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: any) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<any>>
  setViewingDiscard: React.Dispatch<React.SetStateAction<any>>
  validTargets?: {row: number, col: number}[]
  handleLineSelection: (coords: {row: number, col: number}) => void
  onAbilityComplete?: () => void
  applyGlobalEffect: (source: any, targets: any[], type: string, pid: number, isDeploy: boolean) => void
  drawCardsBatch: (playerId: number, count: number) => void
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode?: () => void
  // P2P: sendAction for GLOBAL_AUTO_APPLY with contextCardId (False Orders Stun x2)
  sendAction?: (action: string, data?: any) => void
}

/**
 * Safely extract playerId from action, with fallbacks
 * Ensures we always return a number
 */
function getSafePlayerId(
  action: AbilityAction,
  localPlayerId: number | null
): number {
  const sourceCardOwnerId = action.sourceCard?.ownerId
  if (typeof sourceCardOwnerId === 'number') {
    return sourceCardOwnerId
  }
  if (typeof localPlayerId === 'number') {
    return localPlayerId
  }
  return 0
}

/**
 * Main action execution handler
 */
export function handleActionExecution(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const {
    gameState,
    getFreshGameState, // Функция для получения свежего состояния
    localPlayerId,
    commandContext,
    triggerNoTarget,
    onAbilityComplete,
    handleActionExecution: execAction,
  } = props

  // Handle ABILITY_COMPLETE
  if (action.type === 'ABILITY_COMPLETE') {
    onAbilityComplete?.()
    return
  }

  // Handle REVEREND_SETUP_SCORE
  if (action.type === 'REVEREND_SETUP_SCORE') {
    handleReverendSetupScore(action, sourceCoords, props)
    return
  }

  // Handle CONTINUE_AUTO_STEPS - Continues AUTO_STEPS after cursorStack completion
  if (action.type === 'CONTINUE_AUTO_STEPS') {
    handleContinueAutoSteps(action, sourceCoords, props)
    return
  }

  // 1. GLOBAL_AUTO_APPLY
  if (action.type === 'GLOBAL_AUTO_APPLY') {
    handleGlobalAutoApply(action, sourceCoords, props)
    return
  }

  // 2. Check Valid Targets (before CREATE_STACK)
  // Skip check for line selection modes - they always have valid targets (the lines through source card)
  const shouldSkipTargetCheck = action.type === 'ENTER_MODE' && (
    action.mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS' ||
    action.mode === 'SELECT_LINE_FOR_THREAT_COUNTERS' ||
    action.mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING'
  )

  if (!shouldSkipTargetCheck) {
    const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

    if (!hasTargets) {
      triggerNoTarget(sourceCoords)
      // Only execute chained action if skipChainedActionOnNoTargets is not set
      // This prevents abilities like Recon Drone Commit from creating token stacks when no valid targets exist
      if (action.chainedAction && !action.skipChainedActionOnNoTargets) {
        setTimeout(() => {
          execAction(action.chainedAction!, sourceCoords)
        }, 500)
      }
      return
    }
  }

  // 3. CREATE_STACK
  if (action.type === 'CREATE_STACK') {
    handleCreateStack(action, sourceCoords, props)
    return
  }

  // 4. OPEN_MODAL
  if (action.type === 'OPEN_MODAL') {
    handleOpenModal(action, sourceCoords, props)
    return
  }

  // 5. ENTER_MODE
  if (action.type === 'ENTER_MODE') {
    handleEnterMode(action, sourceCoords, props)
    return
  }
}

/**
 * Handle REVEREND_SETUP_SCORE action
 */
function handleReverendSetupScore(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, updatePlayerScore, triggerFloatingText, markAbilityUsed } = props
  const ownerId = action.sourceCard?.ownerId ?? 0
  let exploitCount = 0

  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const card = gameState.board[r][c]?.card
      if (card?.statuses) {
        const exploitCounters = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
        exploitCount += exploitCounters.length
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)
  }

  triggerFloatingText([{
    row: sourceCoords.row,
    col: sourceCoords.col,
    text: `+${exploitCount}`,
    playerId: ownerId,
  }])

  markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
}

/**
 * Handle CONTINUE_AUTO_STEPS action
 * Continues AUTO_STEPS sequence after cursorStack completion
 * This enables abilities like Centurion Commit to continue after CREATE_STACK step
 */
function handleContinueAutoSteps(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, setAbilityMode, setTargetingMode, commandContext, localPlayerId, markAbilityUsed, addBoardCardStatus, modifyBoardCardPower } = props

  const autoStepsContext = action.payload?._autoStepsContext
  if (!autoStepsContext || !autoStepsContext.steps) {
    markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  }

  const steps = autoStepsContext.steps
  const currentStepIndex = autoStepsContext.currentStepIndex
  const stepContext = action.payload?.stepContext


  // Check if there are more steps
  if (currentStepIndex >= steps.length) {
    // All steps complete!
    markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    setAbilityMode(null)
    return
  }

  // Create a temporary abilityMode for advanceToNextStepWithCoords
  const tempAbilityMode: AbilityAction = {
    type: 'ENTER_MODE',
    mode: 'AUTO_STEPS',
    sourceCard: action.sourceCard,
    sourceCoords: action.sourceCoords,
    isDeployAbility: action.isDeployAbility,
    readyStatusToRemove: action.readyStatusToRemove,
    payload: {
      steps: steps,
      currentStepIndex: currentStepIndex,
      _autoStepsContext: autoStepsContext,
    },
  }

  // Call advanceToNextStepWithCoords with the necessary props
  // Type assertion: we pass a subset of ModeHandlersProps
  advanceToNextStepWithCoords(
    {
      abilityMode: tempAbilityMode,
      setAbilityMode,
      markAbilityUsed,
      gameState,
      commandContext,
      setTargetingMode,
      calculateValidTargets,
      localPlayerId,
      addBoardCardStatus,
      modifyBoardCardPower,
    } as any,
    sourceCoords,
    currentStepIndex,
    stepContext
  )
}

/**
 * Handle GLOBAL_AUTO_APPLY action
 */
function handleGlobalAutoApply(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, localPlayerId, commandContext, markAbilityUsed, triggerNoTarget, triggerFloatingText, updatePlayerScore, applyGlobalEffect, addBoardCardStatus, removeStatusByType, handleActionExecution: execAction, sendAction } = props
  // P2P: Token placement on moved card (False Orders Option 1: Stun x2)
  // Send to host for processing since client can't directly modify shared state
  if (action.payload?.contextCardId && action.payload?.tokenType && action.payload?.count && sendAction) {
    // Send action to host with full payload
    sendAction('GLOBAL_AUTO_APPLY', {
      payload: action.payload,
      sourceCard: action.sourceCard,
    })
    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  } else {
    // Debug log to help diagnose issues
    if (action.payload?.tokenType && action.payload?.count) {
    }
  }

  // FINN_SCORING
  if (action.payload?.customAction === 'FINN_SCORING') {
    const finnOwnerId = action.sourceCard?.ownerId
    if (finnOwnerId === undefined) {
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }

    let revealedCount = 0

    // Count in opponents' hands
    gameState.players.forEach((p: any) => {
      if (p.id !== finnOwnerId) {
        p.hand.forEach((c: any) => {
          if (c.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId)) {
            revealedCount++
          }
        })
      }
    })

    // Count on battlefield
    gameState.board.forEach((row: any[]) => {
      row.forEach((cell: any) => {
        const card = cell.card
        if (card && card.ownerId !== finnOwnerId) {
          const revealedByFinn = card.statuses?.filter((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId).length || 0
          revealedCount += revealedByFinn
        }
      })
    })

    if (revealedCount > 0) {
      const coords = action.sourceCoords || sourceCoords
      triggerFloatingText({
        row: coords.row,
        col: coords.col,
        text: `+${revealedCount}`,
        playerId: finnOwnerId,
      })
      updatePlayerScore(finnOwnerId, revealedCount)
    }

    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  }

  // REMOVE_ALL_AIM_FROM_CONTEXT
  if (action.payload?.customAction === 'REMOVE_ALL_AIM_FROM_CONTEXT') {
    if (action.sourceCoords && action.sourceCoords.row >= 0) {
      removeStatusByType(action.sourceCoords, 'Aim')
    } else if (commandContext.lastMovedCardCoords) {
      removeStatusByType(commandContext.lastMovedCardCoords, 'Aim')
    }
    return
  }

  // Token filtering with filter function
  if (action.payload?.tokenType && action.payload.filter) {
    const { tokenType, filter } = action.payload
    const targets: { row: number; col: number }[] = []
    const gridSize = gameState.board.length

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const card = gameState.board[r][c].card
        if (card && filter(card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }

    if (targets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      if (action.chainedAction) {
        setTimeout(() => execAction(action.chainedAction!, sourceCoords), 500)
      }
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }

    // Apply to all targets
    targets.forEach(target => {
      addBoardCardStatus(target, tokenType, action.sourceCard?.ownerId || 0)
    })

    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)

    if (action.chainedAction) {
      setTimeout(() => execAction(action.chainedAction!, sourceCoords), TIMING.MODE_CLEAR_DELAY)
    }
    return
  }

  // Context reward (DRAW_MOVED_POWER, SCORE_MOVED_POWER)
  if (action.payload?.contextReward) {
    handleContextReward(action, sourceCoords, props)
    return
  }

  // Note: SACRIFICE_AND_BUFF_LINES (Centurion Commit) and CENSOR_SWAP (Censor Commit)
  // are now handled in modeHandlers.ts, not here

  // Standard global apply with targets
  if (action.payload && !action.payload.cleanupCommand) {
    const { tokenType, filter } = action.payload
    const targets: { row: number; col: number }[] = []
    const gridSize = gameState.board.length

    // Handle Context Rewards (Tactical Maneuver)
    if (action.payload.contextReward && action.sourceCard) {
      handleContextReward(action, sourceCoords, props)
      return
    }

    if (filter) {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const targetCard = gameState.board[r][c].card
          if (targetCard && filter(targetCard)) {
            targets.push({ row: r, col: c })
          }
        }
      }
    } else {
      if (action.sourceCoords && action.sourceCoords.row >= 0) {
        targets.push(action.sourceCoords)
      } else if (sourceCoords && sourceCoords.row >= 0) {
        targets.push(sourceCoords)
      } else if (commandContext.lastMovedCardCoords) {
        targets.push(commandContext.lastMovedCardCoords)
      }
    }

    if (targets.length > 0) {
      if (tokenType) {
        const count = action.payload.count || 1
        const addedBy = action.payload.ownerId !== undefined
          ? action.payload.ownerId
          : (action.sourceCard?.ownerId ?? localPlayerId ?? 0)

        for (let i = 0; i < count; i++) {
          applyGlobalEffect(sourceCoords, targets, tokenType, addedBy, !!action.isDeployAbility)
        }
      }
    } else {
      triggerNoTarget(sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
    }
    return
  }
}

/**
 * Handle CREATE_STACK action
 * Uses universal token targeting system via createTokenCursorStack
 */
function handleCreateStack(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, setAbilityMode, setCursorStack, triggerNoTarget, localPlayerId, setTargetingMode, addBoardCardStatus, markAbilityUsed, handleActionExecution: execAction, commandContext } = props

  let count = action.count || 0

  // Special Case: Abilities with requiredTargetStatus (Riot Agent Commit, etc.) - check valid targets at application time
  // CRITICAL: Mark ability as used FIRST (remove ready status, add "used this turn")
  // This happens regardless of whether there are valid targets or not
  if (action.requiredTargetStatus) {
    if (action.readyStatusToRemove) {
      markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState
    const validTargets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (validTargets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // Ready status already removed, ability marked as used
      return
    }
    // Continue to create cursorStack...
  }

  // Handle Dynamic Count
  if (action.dynamicCount) {
    const { factor, ownerId } = action.dynamicCount
    let dynamic = 0
    gameState.board.forEach((r: any[]) => {
      r.forEach((c: any) => {
        if (c.card?.statuses) {
          const matchingTokens = c.card.statuses.filter((s: any) => s.type === factor && s.addedByPlayerId === ownerId)
          dynamic += matchingTokens.length
        }
      })
    })
    count = dynamic
  }

  // CREATE_STACK_SELF: Add token directly to source card, then continue AUTO_STEPS
  if ((action as any).onlySelf && action.sourceCoords) {
    if (count > 0) {
      const tokenType = action.tokenType || 'Aim'
      let tokenOwnerId = action.sourceCard?.ownerId ?? localPlayerId ?? 0
      if (!action.sourceCard?.ownerId && localPlayerId !== null) {
        tokenOwnerId = localPlayerId
      }

      // Add token directly to source card
      addBoardCardStatus(action.sourceCoords, tokenType, tokenOwnerId)
      setAbilityMode(null)

      // Mark ability as used (first step of AUTO_STEPS)
      markAbilityUsed(action.sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)

      // Continue to next AUTO_STEPS step
      const autoStepsContext = action.payload?._autoStepsContext
      if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
        const nextStepIndex = autoStepsContext.currentStepIndex + 1
        if (nextStepIndex < autoStepsContext.steps.length) {
          // Execute next step
          const nextStep = autoStepsContext.steps[nextStepIndex]
          setTimeout(() => {
            execAction({
              type: 'ENTER_MODE',
              mode: 'AUTO_STEPS',
              payload: {
                ...nextStep,
                _autoStepsContext: {
                  steps: autoStepsContext.steps,
                  currentStepIndex: nextStepIndex,
                  sourceCard: action.sourceCard,
                }
              },
              sourceCard: action.sourceCard,
              sourceCoords: action.sourceCoords,
              isDeployAbility: action.isDeployAbility,
            }, action.sourceCoords || { row: -1, col: -1 })
          }, 100)
        }
      }
    } else {
      triggerNoTarget(sourceCoords)
    }
    return
  }

  if (count > 0) {
    // Determine token owner: tokens always belong to the card owner (even if it's a dummy player)
    // This ensures dummy player's tokens belong to the dummy, not the controlling player
    let tokenOwnerId = action.sourceCard?.ownerId ?? localPlayerId ?? 0

    // Only fall back to localPlayerId if sourceCard.ownerId is not defined
    // DO NOT override tokenOwnerId when sourceCard belongs to a dummy player
    if (!action.sourceCard?.ownerId && localPlayerId !== null) {
      tokenOwnerId = localPlayerId
    }

    // Use universal token targeting system to create cursorStack
    const modifications: Partial<any> = {
      count: count,
      sourceCoords: action.sourceCoords || sourceCoords,
      sourceCard: action.sourceCard,
      isDeployAbility: action.isDeployAbility,
      readyStatusToRemove: action.readyStatusToRemove,
      targetOwnerId: action.targetOwnerId,
      excludeOwnerId: action.excludeOwnerId,
      onlyOpponents: action.onlyOpponents,
      onlyFaceDown: action.onlyFaceDown,
      targetType: action.targetType,
      requiredTargetStatus: action.requiredTargetStatus,
      requireStatusFromSourceOwner: action.requireStatusFromSourceOwner,
      mustBeAdjacentToSource: action.mustBeAdjacentToSource,
      mustBeInLineWithSource: action.mustBeInLineWithSource,
      maxDistanceFromSource: action.maxDistanceFromSource,
      maxOrthogonalDistance: action.maxOrthogonalDistance,
      placeAllAtOnce: action.placeAllAtOnce,
      replaceStatus: action.replaceStatus,
      chainedAction: action.chainedAction,
      recordContext: action.recordContext,
      // CRITICAL: Pass _autoStepsContext for AUTO_STEPS continuation after cursorStack completes
      // This enables abilities like Centurion Commit to continue after CREATE_STACK step
      _autoStepsContext: action.payload?._autoStepsContext,
      // CRITICAL: Store the original readyStatusToRemove explicitly for token placement completion
      _originalReadyStatusToRemove: action.readyStatusToRemove,
    }

    const tokenType = action.tokenType || 'Aim'
    // Special handling for Revealed token - include hand targets for opponents
    // Case 1: Specific target owner (e.g., "reveal cards from player X's hand")
    if (tokenType === 'Revealed' && action.targetOwnerId) {
      // Collect hand targets for the specific opponent
      const handTargets: {playerId: number, cardIndex: number}[] = []
      const targetPlayer = gameState.players.find(p => p.id === action.targetOwnerId)

      if (targetPlayer && targetPlayer.hand) {
        for (let i = 0; i < targetPlayer.hand.length; i++) {
          const card = targetPlayer.hand[i]
          // Check if card doesn't already have our Revealed token
          const hasOurRevealed = card.statuses?.some(s =>
            s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
          )
          // ENHANCED INTERROGATION: Check onlyFaceDown - only target face-down cards
          const isFaceDown = card.isFaceDown === true
          const passesFaceDownCheck = !action.onlyFaceDown || isFaceDown

          if (!hasOurRevealed && passesFaceDownCheck) {
            handTargets.push({ playerId: targetPlayer.id, cardIndex: i })
          }
        }
      }

      console.log('[ACTION EXECUTION] Case 1 - Setting up targeting for Revealed token', {
        tokenType,
        targetOwnerId: action.targetOwnerId,
        handTargetsCount: handTargets.length,
      })

      // Create a dummy action for setTargetingMode (required parameter)
      const dummyAction: AbilityAction = {
        type: 'CREATE_STACK',
        mode: 'SELECT_TARGET',
        payload: {
          tokenType,
          filter: () => true,
          targetOwnerId: action.targetOwnerId,
        },
        sourceCoords: action.sourceCoords || sourceCoords,
        sourceCard: action.sourceCard,
      }

      // CRITICAL: Set targeting mode BEFORE cursorStack to prevent premature clearing
      // If cursorStack is set first, it triggers useEffect which clears targeting mode
      // Activate targeting mode so all players see the valid hand targets highlighted
      setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, undefined, undefined, handTargets)

      console.log('[ACTION EXECUTION] Called setTargetingMode for hand targets')

      // CRITICAL: Set abilityMode to prevent useEffect from clearing targeting mode
      // We use a minimal abilityMode just to keep hasActiveMode = true
      setAbilityMode(dummyAction)

      console.log('[ACTION EXECUTION] Set abilityMode to prevent premature clearing')

      // Create cursorStack AFTER targeting mode and abilityMode are set
      const newCursorStack = createTokenCursorStack(tokenType, tokenOwnerId, null, modifications)
      setCursorStack(newCursorStack)

      console.log('[ACTION EXECUTION] Set cursorStack')
      // The ability will complete when the player clicks on a hand card (in handCardHandlers.ts)
    }
    // Case 2: Revealed with onlyOpponents (e.g., False Orders Option 0 - reveal any opponent's cards)
    else if (tokenType === 'Revealed' && (action.onlyOpponents || action.excludeOwnerId)) {
      // Collect hand targets for ALL opponents (excluding excluded owner)
      const handTargets: {playerId: number, cardIndex: number}[] = []
      const excludedId = action.excludeOwnerId ?? tokenOwnerId

      for (const player of gameState.players) {
        // Skip excluded player (token owner's own hand)
        if (player.id === excludedId) {
          continue
        }
        // Skip teammates if onlyOpponents is set
        if (action.onlyOpponents) {
          const tokenOwner = gameState.players.find(p => p.id === tokenOwnerId)
          if (tokenOwner && tokenOwner.teamId !== undefined && tokenOwner.teamId === player.teamId) {
            continue
          }
        }
        // Add this player's hand cards
        if (player.hand) {
          for (let i = 0; i < player.hand.length; i++) {
            const card = player.hand[i]
            // Check if card doesn't already have our Revealed token
            const hasOurRevealed = card.statuses?.some(s =>
              s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
            )
            // ENHANCED INTERROGATION: Check onlyFaceDown - only target face-down cards
            const isFaceDown = card.isFaceDown === true
            const passesFaceDownCheck = !action.onlyFaceDown || isFaceDown

            if (!hasOurRevealed && passesFaceDownCheck) {
              handTargets.push({ playerId: player.id, cardIndex: i })
            }
          }
        }
      }

      console.log('[ACTION EXECUTION] Case 2 - Setting up targeting for Revealed token', {
        tokenType,
        onlyOpponents: action.onlyOpponents,
        excludeOwnerId: action.excludeOwnerId,
        handTargetsCount: handTargets.length,
      })

      // Create a dummy action for setTargetingMode (required parameter)
      const dummyAction: AbilityAction = {
        type: 'CREATE_STACK',
        mode: 'SELECT_TARGET',
        payload: {
          tokenType,
          filter: () => true,
          excludeOwnerId: action.excludeOwnerId,
          onlyOpponents: action.onlyOpponents,
        },
        sourceCoords: action.sourceCoords || sourceCoords,
        sourceCard: action.sourceCard,
      }

      // CRITICAL: Set targeting mode BEFORE cursorStack to prevent premature clearing
      // If cursorStack is set first, it triggers useEffect which clears targeting mode
      // Activate targeting mode so all players see the valid hand targets highlighted
      setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, undefined, undefined, handTargets)

      console.log('[ACTION EXECUTION] Called setTargetingMode for hand targets (Case 2)')

      // CRITICAL: Set abilityMode to prevent useEffect from clearing targeting mode
      // We use a minimal abilityMode just to keep hasActiveMode = true
      setAbilityMode(dummyAction)

      console.log('[ACTION EXECUTION] Set abilityMode to prevent premature clearing (Case 2)')

      // Create cursorStack AFTER targeting mode and abilityMode are set
      setCursorStack(createTokenCursorStack(tokenType, tokenOwnerId, null, modifications))

      console.log('[ACTION EXECUTION] Set cursorStack (Case 2)')
      // The ability will complete when the player clicks on a hand card (in handCardHandlers.ts)
    } else {
      // Normal token placement (board only)
      setCursorStack(createTokenCursorStack(tokenType, tokenOwnerId, null, modifications))
      // Don't clear abilityMode here - it will be cleared when cursorStack is depleted (in useAppAbilities.ts)
    }
  } else {
    triggerNoTarget(sourceCoords)
  }
}

/**
 * Handle OPEN_MODAL action
 */
function handleOpenModal(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, localPlayerId, commandContext, setViewingDiscard, markAbilityUsed, triggerNoTarget, setAbilityMode, setTargetingMode } = props

  const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

  if (!hasTargets) {
    triggerNoTarget(action.sourceCoords || sourceCoords)
    // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
    return
  }

  // PLACE_TOKEN - Token placement on board (from CREATE_TOKEN action)
  if (action.mode === 'PLACE_TOKEN') {
    const targets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
    return
  }

  if (action.mode === 'RETRIEVE_DEVICE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Device', action: 'recover' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'IMMUNIS_RETRIEVE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Optimates', action: 'resurrect' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'SEARCH_DECK') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: {
          filterType: action.payload?.filterType || 'Unit',
          action: 'recover',
          isDeck: true,
        },
        // Pass ability-related fields for modal close handling
        sourceCard: action.sourceCard,
        isDeployAbility: action.isDeployAbility,
        sourceCoords,
        shuffleOnClose: action.payload?.shuffleOnClose,
      })
      // Don't mark ability used here - it will be marked when modal closes
    }
  } else if (action.mode === 'RETURN_FROM_DISCARD_TO_HAND') {
    // Return card from discard to hand (e.g., Finn EG Setup)
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      // Extract filter type from filter string (e.g., "hasType_Device" → "Device")
      let filterType = 'Unit'
      const filterString = action.payload?.filter
      if (filterString) {
        if (typeof filterString === 'string') {
          if (filterString.startsWith('hasType_')) {
            filterType = filterString.replace('hasType_', '')
          } else if (filterString.startsWith('hasFaction_')) {
            filterType = filterString.replace('hasFaction_', '')
          }
        } else if (typeof filterString === 'function') {
          // Filter is a function - can't extract type, use default
        }
      }

      setViewingDiscard({
        player,
        pickConfig: { filterType, action: 'recover' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'RETURN_FROM_DISCARD_TO_BOARD') {
    // Return card from discard to adjacent empty cell with token (e.g., Finn MW Deploy, Immunis Deploy)
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      // Extract filter type from filter string or function
      let filterType = 'Unit'
      const filterString = action.payload?.filter
      if (filterString) {
        if (typeof filterString === 'string') {
          if (filterString.startsWith('hasType_')) {
            filterType = filterString.replace('hasType_', '')
          } else if (filterString.startsWith('hasFaction_')) {
            filterType = filterString.replace('hasFaction_', '')
          }
        } else if (typeof filterString === 'function') {
          // Filter is a function - can't extract type, use default
        }
      }

      // Set ability mode for the second step (placing the card)
      const resurrectAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'RESURRECT_FROM_DISCARD',
        sourceCard: action.sourceCard,
        sourceCoords: action.sourceCoords,
        payload: {
          withToken: action.payload?.withToken || 'Resurrection',
          selectedCardIndex: -1, // Will be set after card selection
        },
        isDeployAbility: action.isDeployAbility,
      }

      setAbilityMode(resurrectAction)

      setViewingDiscard({
        player,
        pickConfig: {
          filterType,
          action: 'resurrect',
          targetCoords: action.sourceCoords,
        },
      })
      // Don't mark ability as used yet - will mark after card is placed
    }
  }
}

/**
 * Handle ENTER_MODE action
 */
function handleEnterMode(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, localPlayerId, commandContext, triggerNoTarget, setAbilityMode, addBoardCardStatus, setTargetingMode, handleActionExecution: execAction, markAbilityUsed } = props

  const mode = action.mode
  const payload = action.payload || {}

  // SHIELD_SELF_THEN_PUSH (Reclaimed Gawain)
  // Add Shield immediately, then let user select adjacent opponent to push
  if (mode === 'SHIELD_SELF_THEN_PUSH') {
    const actorId = getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const pushAction: AbilityAction = {
      ...action,
      payload: { ...action.payload, shieldApplied: true }
    }
    const targets = calculateValidTargets(pushAction, gameState, actorId, commandContext)

    setAbilityMode(pushAction)
    setTargetingMode(pushAction, actorId, sourceCoords, targets, commandContext)
    return
  }

  // SHIELD_SELF_THEN_SPAWN (Edith Byron)
  if (mode === 'SHIELD_SELF_THEN_SPAWN') {
    const actorId = getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const spawnAction: AbilityAction = {
      ...action,
      payload: { ...action.payload, shieldApplied: true }
    }
    const targets = calculateValidTargets(spawnAction, gameState, actorId, commandContext)

    setAbilityMode(spawnAction)
    setTargetingMode(spawnAction, actorId, sourceCoords, targets, commandContext)
    return
  }

  // PUSH within AUTO_STEPS (Reclaimed Gawain Deploy - step 2)
  // Only use this handler when PUSH is part of AUTO_STEPS
  // Direct PUSH abilities (Riot Agent) use the handler below which preserves ready status
  if (mode === 'PUSH' && action.payload?._autoStepsContext) {
    const actorId = getSafePlayerId(action, localPlayerId)
    const targets = calculateValidTargets(action, gameState, actorId, commandContext)

    // If no valid targets, complete the AUTO_STEPS ability
    if (targets.length === 0) {
      triggerNoTarget(sourceCoords)
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      setAbilityMode(null)
      return
    }

    setAbilityMode(action)
    setTargetingMode(action, actorId, sourceCoords, targets, commandContext)
    return
  }

  // PRINCEPS_SHIELD_THEN_AIM
  if (mode === 'PRINCEPS_SHIELD_THEN_AIM') {
    const actorId = getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      mustBeInLineWithSource: true,
      sourceCard: action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // GAWAIN_DEPLOY_SHIELD_AIM
  if (mode === 'GAWAIN_DEPLOY_SHIELD_AIM') {
    const actorId = action.sourceCard!.ownerId!
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      mustBeInLineWithSource: true,
      sourceCard: action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // ABR_DEPLOY_SHIELD_AIM
  if (mode === 'ABR_DEPLOY_SHIELD_AIM') {
    const actorId = action.sourceCard!.ownerId!
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      requiredTargetStatus: 'Threat',
      requireStatusFromSourceOwner: true,
      sourceCard: action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // PUSH
  if (mode === 'PUSH') {
    // CRITICAL: Mark ability as used FIRST (remove ready status, add "used this turn")
    // This happens regardless of whether there are valid targets or not
    if (action.readyStatusToRemove) {
      markAbilityUsed(sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // Calculate valid targets - checked at application time
    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    // This fixes the issue where React state hasn't updated yet after card movement
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState
    console.log('[PUSH DEBUG] action.sourceCoords:', action.sourceCoords, 'sourceCoords param:', sourceCoords, 'actorId:', action.sourceCard?.ownerId || localPlayerId)
    const pushTargets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    console.log('[PUSH DEBUG] pushTargets:', pushTargets)
    if (pushTargets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // Ready status already removed, ability marked as used
      return
    }
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, pushTargets)
    return
  }

  // SWAP_POSITIONS (Reckless Provocateur Deploy)
  if (mode === 'SWAP_POSITIONS') {
    // Check targets BEFORE activating targeting mode
    const hasSwapTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSwapTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const swapTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, swapTargets)
    return
  }

  // SWAP_ADJACENT (Swap with adjacent card)
  if (mode === 'SWAP_ADJACENT') {
    // Check targets BEFORE activating targeting mode
    const hasSwapTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSwapTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const swapTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, swapTargets)
    return
  }

  // PATROL_MOVE
  if (mode === 'PATROL_MOVE') {
    // Check targets BEFORE activating targeting mode
    const hasPatrolTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasPatrolTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    // Calculate valid targets for highlighting
    const patrolTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, patrolTargets)
    return
  }

  // SPAWN_TOKEN (Inventive Maker Deploy, Recon Drone Deploy, etc.)
  if (mode === 'SPAWN_TOKEN') {
    // Check targets BEFORE activating targeting mode
    const hasSpawnTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSpawnTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    // Calculate valid targets for highlighting
    const spawnTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, spawnTargets)
    return
  }

  // SELECT_UNIT_FOR_MOVE (Finn Setup)
  if (mode === 'SELECT_UNIT_FOR_MOVE') {
    // Check if there are valid targets (allied cards on board)
    const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const targets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
    return
  }

  // SELECT_TARGET with hand-only actionTypes (discard abilities)
  if (mode === 'SELECT_TARGET' && payload.actionType) {
    const actionType = payload.actionType

    // Hand-only discard actions
    if (actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
        actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN' ||
        actionType === 'LUCIUS_SETUP' ||
        actionType === 'SELECT_HAND_FOR_DEPLOY') {

      const ownerId = action.sourceCard?.ownerId || localPlayerId
      const player = gameState.players.find(p => p.id === ownerId)

      if (!player || player.hand.length === 0) {
        triggerNoTarget(action.sourceCoords || sourceCoords)
        return
      }

      // Calculate hand targets - all cards in owner's hand are valid
      const handTargets: {playerId: number, cardIndex: number}[] = []
      for (let i = 0; i < player.hand.length; i++) {
        // Apply filter if present (e.g., Faber only discards SynchroTech cards)
        if (payload.filter && !payload.filter(player.hand[i])) {
          continue
        }
        handTargets.push({ playerId: player.id, cardIndex: i })
      }

      if (handTargets.length === 0) {
        triggerNoTarget(action.sourceCoords || sourceCoords)
        return
      }

      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, [], commandContext, handTargets)
      return
    }
  }

  // SELECT_TARGET
  if (mode === 'SELECT_TARGET') {
    // For Deploy abilities, don't check targets immediately - let player activate anytime
    if (action.isDeployAbility) {
      const targets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
      return
    }
    // For Setup/Commit abilities, check targets
    const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const targets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
    return
  }

  // IP_AGENT_THREAT_SCORING - IP Dept Agent Setup
  // Select a line (row or column) to score Threats
  if (mode === 'IP_AGENT_THREAT_SCORING') {
    const ownerId = action.sourceCard?.ownerId ?? 0
    const { row, col } = sourceCoords
    const gridSize = gameState.activeGridSize

    // Check for adjacent Support
    const hasSupport = (r: number, c: number): boolean => {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) { return false }
      const cell = gameState.board[r]?.[c]
      if (!cell?.card) { return false }
      return cell.card.statuses?.some((s: any) => s.type === 'Support' && s.addedByPlayerId === ownerId) ?? false
    }

    const hasAdjacentSupport =
      hasSupport(row - 1, col) ||
      hasSupport(row + 1, col) ||
      hasSupport(row, col - 1) ||
      hasSupport(row, col + 1)

    if (!hasAdjacentSupport) {
      triggerNoTarget(sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when Support appears
      return
    }

    // Generate valid targets: all cells in the same row or column
    const boardTargets: { row: number; col: number }[] = []
    for (let i = 0; i < gridSize; i++) {
      boardTargets.push({ row: row, col: i }) // Entire row
      boardTargets.push({ row: i, col: col }) // Entire column
    }

    // Set up targeting mode with custom payload for line selection
    const targetingAction: AbilityAction = {
      ...action,
      payload: {
        ...action.payload,
        sourceRow: row,
        sourceCol: col,
        boardTargets
      }
    }

    setAbilityMode(targetingAction)
    setTargetingMode(targetingAction, getSafePlayerId(action, localPlayerId), sourceCoords, boardTargets, commandContext)
    return
  }

  // AUTO_STEPS (Generic multi-step ability system)
  // Handles Edith Byron Deploy, Centurion Commit, Princeps Deploy, and other multi-step abilities
  if (mode === 'AUTO_STEPS') {

    const steps = action.payload?.steps as AutoStep[] | undefined
    if (steps && steps.length > 0) {
      const firstStep = steps[0]

      // If first step is instant (no mode), execute it immediately
      if (!firstStep.mode) {
        // Use the universal instant step handler
        const ownerId = getSafePlayerId(action, localPlayerId)
        const result = executeInstantAutoStep(
          firstStep,
          action.sourceCoords,
          ownerId,
          {
            gameState,
            localPlayerId,
            commandContext,
            addBoardCardStatus,
            modifyBoardCardPower: props.modifyBoardCardPower,
          }
        )

        if (!result.success) {
        }

        // Now process the next step
        const nextStepIndex = 1

        // If there are no more steps, mark ability as used
        if (nextStepIndex >= steps.length) {
          markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
          return
        }

        const nextStep = steps[nextStepIndex]

        // If next step is also instant, execute it recursively
        if (!nextStep.mode) {
          const updatedAction = {
            ...action,
            payload: {
              ...action.payload,
              currentStepIndex: nextStepIndex
            }
          }
          setTimeout(() => {
            handleEnterMode(updatedAction, sourceCoords, props)
          }, 50)
          return
        }

        // Next step requires interaction - set up ability mode with context
        const updatedAction = {
          ...action,
          payload: {
            ...action.payload,
            currentStepIndex: nextStepIndex
          }
        }
        setAbilityMode(updatedAction)

        // Enter the appropriate mode for the next step
        if (nextStep.action === 'CREATE_TOKEN') {
          // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
          const tokenAction: AbilityAction = {
            type: 'OPEN_MODAL',
            mode: 'PLACE_TOKEN',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              tokenId: nextStep.details?.tokenId,
              range: nextStep.mode === 'ADJACENT_EMPTY' ? 'adjacent' : 'global',
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          handleOpenModal(tokenAction, sourceCoords, props)
          return
        }

        if (nextStep.action === 'CREATE_STACK') {
          // CREATE_STACK needs special handling to create token cursor stack
          // Properties must be at action level (not in payload) for handleCreateStack to read them
          const mustBeInLineWithSource = nextStep.mode === 'LINE_TARGET' ? true : undefined
          const mustBeAdjacentToSource = nextStep.mode === 'ADJACENT_TARGET' ? true : undefined

          const stackAction: AbilityAction = {
            type: 'CREATE_STACK',
            tokenType: nextStep.details?.tokenType,
            count: nextStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          handleCreateStack(stackAction, sourceCoords, props)

          // Also set abilityMode to SELECT_TARGET so handleSelectTargetWithToken
          // is called when target is clicked, which handles AUTO_STEPS continuation
          const selectTargetAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              actionType: nextStep.action,  // Set actionType so handlers know how to process this
              tokenType: nextStep.details?.tokenType,
              count: nextStep.details?.count || 1,
              mustBeInLineWithSource,
              mustBeAdjacentToSource,
              filter: nextStep.details?.filter,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

          // If no valid targets for CREATE_STACK, skip this step
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // If this was the last step, mark ability as used and clear ability mode
            if (nextStepIndex + 1 >= steps.length) {
              markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
              setAbilityMode(null)  // CRITICAL: Clear ability mode
            }
            return
          }

          setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // PUSH action
        if (nextStep.action === 'PUSH') {
          // Create PUSH mode action to check for valid targets
          const pushAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'PUSH',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }

          // Calculate valid targets for PUSH
          const targets = calculateValidTargets(pushAction, gameState, ownerId, commandContext)

          // If no valid targets, skip this step and complete the ability
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // This was the last step, mark ability as used and clear ability mode
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode so App.tsx doesn't try to calculate targets
            return
          }

          // Set ability mode and targeting mode for PUSH
          setAbilityMode(pushAction)
          setTargetingMode(pushAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // Default interactive step handling
        // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
        // These are targeting constraints, not separate modes. The constraint is stored in payload.
        const normalizedMode = (nextStep.mode === "LINE_TARGET" || nextStep.mode === "ADJACENT_TARGET")
          ? "SELECT_TARGET"
          : (nextStep.mode || "SELECT_TARGET")

        const stepAction: AbilityAction = {
          type: 'ENTER_MODE',
          mode: normalizedMode,
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          payload: {
            ...nextStep.details,
            // Only set actionType from nextStep.action if not already in details
            // This preserves actionType: 'DESTROY' from details for multi-step abilities
            ...(nextStep.details?.actionType ? {} : { actionType: nextStep.action }),
            tokenType: nextStep.details?.tokenType,
            count: nextStep.details?.count,
            mustBeInLineWithSource: nextStep.mode === 'LINE_TARGET' ? true : undefined,
            mustBeAdjacentToSource: nextStep.mode === 'ADJACENT_TARGET' ? true : undefined,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: nextStepIndex + 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove
            }
          }
        }

        // Calculate targets for the interactive mode
        const targets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

        // If no valid targets, skip this step and continue to the next one
        if (targets.length === 0) {
          // Clear targeting mode if set
          props.clearTargetingMode?.()

          // Check if there are more steps after this one
          const followingStepIndex = nextStepIndex + 1
          if (followingStepIndex >= steps.length) {
            // No more steps - mark ability as used and clear ability mode
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode so App.tsx doesn't try to calculate targets
            return
          }

          // Continue to the following step
          const updatedAction = {
            ...action,
            payload: {
              ...action.payload,
              currentStepIndex: followingStepIndex
            }
          }
          setTimeout(() => {
            handleEnterMode(updatedAction, sourceCoords, props)
          }, 50)
          return
        }

        setTargetingMode(stepAction, ownerId, sourceCoords, targets, commandContext)
        return
      } else {
        // First step is interactive - create proper action with the step's mode
        const ownerId = getSafePlayerId(action, localPlayerId)

        // Special handling for CREATE_STACK as first step
        if (firstStep.action === 'CREATE_STACK' && firstStep.mode) {
          const mustBeInLineWithSource = firstStep.mode === 'LINE_TARGET' ? true : undefined
          const mustBeAdjacentToSource = firstStep.mode === 'ADJACENT_TARGET' ? true : undefined

          const stackAction: AbilityAction = {
            type: 'CREATE_STACK',
            tokenType: firstStep.details?.tokenType,
            count: firstStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...firstStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }

          // Call handleCreateStack to create cursor stack
          handleCreateStack(stackAction, sourceCoords, props)

          // Also set abilityMode to SELECT_TARGET for AUTO_STEPS continuation
          const selectTargetAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...firstStep.details,
              actionType: firstStep.action,  // Set actionType so handlers know how to process this
              tokenType: firstStep.details?.tokenType,
              count: firstStep.details?.count || 1,
              mustBeInLineWithSource,
              mustBeAdjacentToSource,
              filter: firstStep.details?.filter,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

          // If no valid targets for CREATE_STACK, skip this step
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // If this was the only step, mark ability as used and clear ability mode
            if (steps.length === 1) {
              markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
              setAbilityMode(null)  // CRITICAL: Clear ability mode
            }
            return
          }

          setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // Default handling for other interactive first steps
        // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
        const normalizedMode = (firstStep.mode === "LINE_TARGET" || firstStep.mode === "ADJACENT_TARGET")
          ? "SELECT_TARGET"
          : (firstStep.mode || "SELECT_TARGET")

        const stepAction: AbilityAction = {
          type: 'ENTER_MODE',
          mode: normalizedMode,
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          payload: {
            ...firstStep.details,
            // Only set actionType from firstStep.action if not already in details
            // This preserves actionType: 'DESTROY' from details for Centurion Commit
            ...(firstStep.details?.actionType ? {} : { actionType: firstStep.action }),
            tokenType: firstStep.details?.tokenType,
            count: firstStep.details?.count,
            mustBeInLineWithSource: firstStep.mode === 'LINE_TARGET' ? true : undefined,
            mustBeAdjacentToSource: firstStep.mode === 'ADJACENT_TARGET' ? true : undefined,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove
            }
          }
        }
        setAbilityMode(stepAction)

        // Calculate targets for the interactive mode
        const targets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

        // If no valid targets, skip this step and check if there are more steps
        if (targets.length === 0) {
          props.clearTargetingMode?.()
          // If this was the only step, mark ability as used and clear ability mode
          if (steps.length === 1) {
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode
          }
          return
        }

        setTargetingMode(stepAction, ownerId, sourceCoords, targets, commandContext)
      }
    } else {
      setAbilityMode(action)
    }
    return
  }

  // SELECT_LINE_FOR_SUPPORT_COUNTERS (Signal Prophet Deploy)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS') {
    setAbilityMode(action)
    return
  }

  // SELECT_LINE_FOR_THREAT_COUNTERS (Code Keeper Deploy)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_THREAT_COUNTERS') {
    setAbilityMode(action)
    return
  }

  // SELECT_LINE_FOR_EXPLOIT_SCORING (Zius Setup, Unwavering Integrator Setup)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING') {
    // CRITICAL: Add sourceRow and sourceCol to payload for line selection handler
    // This fixes Unwavering Integrator line selection not working when clicking empty cells
    const targetingAction: AbilityAction = {
      ...action,
      payload: {
        ...action.payload,
        sourceRow: sourceCoords.row,
        sourceCol: sourceCoords.col,
      }
    }
    setAbilityMode(targetingAction)
    return
  }

  // SELECT_CELL (False Orders, Data Interception, etc.)
  // CRITICAL: Only board targets (empty cells), NO hand targets
  if (mode === 'SELECT_CELL') {
    setAbilityMode(action)
    // SELECT_CELL is for selecting empty cells on the board, not cards in hand
    // Do NOT set targeting mode with hand targets
    // Empty cell highlighting is handled by GameBoard based on abilityMode
    return
  }

  // Default mode activation
  // Calculate valid targets if mode supports targeting
  const defaultTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
  setAbilityMode(action)
  setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, defaultTargets, commandContext)
}

/**
 * Handle context reward actions
 */
function handleContextReward(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, commandContext, updatePlayerScore, triggerFloatingText, drawCardsBatch, removeBoardCardStatus, addBoardCardStatus, modifyBoardCardPower, markAbilityUsed } = props

  const rewardType = action.payload?.contextReward
  // CRITICAL: Use _sourceCoordsBeforeMove first (where card IS now), not destination
  // This fixes timing issue where moveItem is async and card hasn't moved yet
  const sourceBeforeMove = action.payload?._sourceCoordsBeforeMove
  const coords = sourceBeforeMove || commandContext.lastMovedCardCoords || sourceCoords
  if (!coords || coords.row < 0) {
    return
  }

  // Find the card at coords
  let card = gameState.board[coords.row][coords.col].card

  // Handle stale state - search by ID if card not at expected coords
  const searchId = action.payload?._tempContextId || commandContext.lastMovedCardId
  if ((!card || (searchId && card.id !== searchId)) && searchId) {
    for (let r = 0; r < gameState.board.length; r++) {
      for (let c = 0; c < gameState.board[r].length; c++) {
        if (gameState.board[r][c].card?.id === searchId) {
          card = gameState.board[r][c].card
          break
        }
      }
      if (card) {
        break
      }
    }
  }

  if (!card) {
    return
  }

  const amount = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
  if (rewardType === 'DRAW_MOVED_POWER' || rewardType === 'DRAW_EQUAL_POWER') {
    drawCardsBatch(action.sourceCard?.ownerId || 0, amount)
  } else if (rewardType === 'SCORE_MOVED_POWER') {
    triggerFloatingText({
      row: coords.row,
      col: coords.col,
      text: `+${amount}`,
      playerId: action.sourceCard?.ownerId || 0,
    })
    updatePlayerScore(action.sourceCard?.ownerId || 0, amount)
  } else if (rewardType === 'STUN_MOVED_UNIT') {
    addBoardCardStatus(coords, 'Stun', action.sourceCard?.ownerId || 0)
  } else if (rewardType === 'REMOVE_AIM') {
    removeBoardCardStatus(coords, 'Aim')
  } else if (rewardType === 'WEAKEN') {
    modifyBoardCardPower(coords, -1)
  }

  markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
}
