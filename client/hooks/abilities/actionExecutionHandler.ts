/**
 * Action Execution Handler
 *
 * Centralized execution of all ability actions
 * Extracted from useAppAbilities.ts
 */

import type { AbilityAction, GameState, CommandContext, DragItem } from '@/types'
import { checkActionHasTargets } from '@shared/utils/targeting'
import { logger } from '@/utils/logger'
import { TIMING } from '@/utils/common'

/* eslint-disable @typescript-eslint/no-unused-vars -- props passed to functions but not all used in every function */

export interface ActionHandlerProps {
  gameState: GameState
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
  triggerClickWave: (target: string, coords?: { row: number; col: number }) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: any) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  spawnToken: (coords: {row: number, col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number) => void
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

  // 1. GLOBAL_AUTO_APPLY
  if (action.type === 'GLOBAL_AUTO_APPLY') {
    handleGlobalAutoApply(action, sourceCoords, props)
    return
  }

  // 2. Check Valid Targets (before CREATE_STACK)
  const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

  if (!hasTargets) {
    triggerNoTarget(sourceCoords)
    if (action.chainedAction) {
      setTimeout(() => {
        execAction(action.chainedAction!, sourceCoords)
      }, 500)
    }
    return
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

  logger.warn('[handleActionExecution] Unknown action type:', action.type)
}

/**
 * Handle REVEREND_SETUP_SCORE action
 */
function handleReverendSetupScore(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, updatePlayerScore, triggerFloatingText, markAbilityUsed } = props
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
 * Handle GLOBAL_AUTO_APPLY action
 */
function handleGlobalAutoApply(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, localPlayerId, commandContext, markAbilityUsed, triggerNoTarget, triggerFloatingText, updatePlayerScore, applyGlobalEffect, addBoardCardStatus, removeStatusByType, handleActionExecution: execAction } = props

  // FINN_SCORING
  if (action.payload?.customAction === 'FINN_SCORING') {
    const finnOwnerId = action.sourceCard?.ownerId
    if (finnOwnerId === undefined) {
      logger.warn('[FINN_SCORING] Source card missing ownerId')
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
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
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
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
    return
  }
}

/**
 * Handle CREATE_STACK action
 */
function handleCreateStack(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, setAbilityMode, setCursorStack, triggerNoTarget } = props

  let count = action.count || 0

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

  if (count > 0) {
    setAbilityMode(null)
    setCursorStack({
      type: action.tokenType || 'Aim',
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
    })
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
  const { gameState, localPlayerId, commandContext, setViewingDiscard, markAbilityUsed } = props

  const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

  if (!hasTargets) {
    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  }

  if (action.mode === 'RETRIEVE_DEVICE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Device', action: 'recover' },
      })
      if (sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      }
    }
  } else if (action.mode === 'IMMUNIS_RETRIEVE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Optimates', action: 'resurrect' },
      })
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
      })
      if (sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      }
    }
  }

  markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
}

/**
 * Handle ENTER_MODE action
 */
function handleEnterMode(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, localPlayerId, commandContext, triggerNoTarget, setAbilityMode, markAbilityUsed, addBoardCardStatus, setTargetingMode, handleActionExecution: execAction } = props

  const mode = action.mode

  // SHIELD_SELF_THEN_RIOT_PUSH (Reclaimed Gawain)
  if (mode === 'SHIELD_SELF_THEN_RIOT_PUSH') {
    const actorId = action.sourceCard!.ownerId!
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const hasPushTargets = checkActionHasTargets(action, gameState, actorId, commandContext)
    if (!hasPushTargets) {
      triggerNoTarget(sourceCoords)
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }

    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, undefined, commandContext)
    return
  }

  // SHIELD_SELF_THEN_SPAWN (Edith Byron)
  if (mode === 'SHIELD_SELF_THEN_SPAWN') {
    const actorId = getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    setAbilityMode({
      ...action,
      payload: { ...action.payload, shieldApplied: true }
    })
    setTargetingMode(action, actorId, sourceCoords)
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

  // RIOT_PUSH
  if (mode === 'RIOT_PUSH') {
    // For Deploy abilities, don't check targets immediately - let player activate anytime
    // Target validation happens when they click on a target (in modeHandlers)
    if (action.isDeployAbility) {
      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords)
      return
    }
    // For non-deploy (shouldn't happen with RIOT_PUSH, but kept for safety)
    const hasPushTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasPushTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords)
    return
  }

  // PATROL_MOVE
  if (mode === 'PATROL_MOVE') {
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords)
    return
  }
  // SELECT_TARGET
  if (mode === 'SELECT_TARGET') {
    // For Deploy abilities, don't check targets immediately - let player activate anytime
    if (action.isDeployAbility) {
      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, undefined, commandContext)
      return
    }
    // For Setup/Commit abilities, check targets
    const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, undefined, commandContext)
    return
  }

  // Default mode activation
  setAbilityMode(action)
  setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords)
}

/**
 * Handle context reward actions
 */
function handleContextReward(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, commandContext, updatePlayerScore, triggerFloatingText, drawCardsBatch, removeBoardCardStatus, addBoardCardStatus, modifyBoardCardPower, markAbilityUsed } = props

  const rewardType = action.payload?.contextReward
  const coords = commandContext.lastMovedCardCoords || sourceCoords

  if (!coords || coords.row < 0) return

  // Find the card at coords
  let card = gameState.board[coords.row][coords.col].card

  // Handle stale state
  const searchId = action.payload?._tempContextId || commandContext.lastMovedCardId
  if ((!card || (searchId && card.id !== searchId)) && searchId) {
    for (let r = 0; r < gameState.board.length; r++) {
      for (let c = 0; c < gameState.board[r].length; c++) {
        if (gameState.board[r][c].card?.id === searchId) {
          card = gameState.board[r][c].card
          break
        }
      }
      if (card) break
    }
  }

  if (!card) {
    logger.warn('[ContextReward] No card at coords')
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
