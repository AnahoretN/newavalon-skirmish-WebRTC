/**
 * Board Card Click Handlers
 *
 * Handles clicks on cards located on the game board
 */

import type { Card, AbilityAction, CursorStackState, CommandContext, DragItem } from '@/types'
import { calculateValidTargets } from '@shared/utils/targeting'
import type { CounterSelectionData } from '@/types'

/* eslint-disable @typescript-eslint/no-unused-vars -- props passed to functions but not all used in every function */

export interface BoardCardClickProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: any
  setPlayMode: React.Dispatch<React.SetStateAction<any>>
  draggedItem: DragItem | null
  setDraggedItem: React.Dispatch<React.SetStateAction<DragItem | null>>
  openContextMenu: (e: React.MouseEvent, type: string, data: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  triggerNoTarget: (coords: { row: number; col: number }) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  triggerDeckSelection: (playerId: number) => void
  addBoardCardStatus: (coords: { row: number; col: number }, status: string, pid: number) => void
  resetDeployStatus: (coords: { row: number; col: number }) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>
  onAbilityComplete?: () => void
}

/**
 * Handle double click on a board card
 */
export function handleBoardCardDoubleClick(
  card: Card,
  boardCoords: { row: number; col: number },
  props: BoardCardClickProps
): void {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    playMode,
    draggedItem,
    setDraggedItem,
    openContextMenu,
    markAbilityUsed: _markAbilityUsed,
    triggerNoTarget: _triggerNoTarget,
    interactionLock
  } = props

  // Ignore if interaction is locked
  if (interactionLock.current) {
    return
  }

  // Double click on own cards during command selection
  if (draggedItem?.source === 'deck' && card.ownerId === localPlayerId) {
    // Check if card has Command abilities
    const commandCardIds = ['overwatch', 'tacticalManeuver', 'inspiration', 'dataInterception', 'falseOrders', 'experimentalStimulants', 'logisticsChain', 'quickresponseteam', 'temporaryshelter', 'enhancedinterrogation', 'linebreach']
    const isCommandCard = commandCardIds.some(id => card.id?.toLowerCase().includes(id))

    if (isCommandCard) {
      setDraggedItem(null)
      openContextMenu(
        { stopPropagation: () => {}, preventDefault: () => {} } as React.MouseEvent,
        'commandCard',
        { card, coords: boardCoords }
      )
      return
    }
  }

  // Handle Deploy abilities (Princeps, Gawain, etc.)
  if (abilityMode?.type === 'ENTER_MODE' && abilityMode.mode === 'SELECT_UNIT_FOR_MOVE') {
    // Can't select the same card that's moving
    if (abilityMode.sourceCoords?.row === boardCoords.row && abilityMode.sourceCoords?.col === boardCoords.col) {
      return
    }

    // Check if valid target
    const validTargets = calculateValidTargets(abilityMode, gameState, localPlayerId ?? 0, props.commandContext)
    const isValid = validTargets.some(t => t.row === boardCoords.row && t.col === boardCoords.col)

    if (isValid) {
      // Execute move
      props.handleActionExecution({
        type: 'GLOBAL_AUTO_APPLY',
        payload: abilityMode.payload,
        sourceCard: abilityMode.sourceCard,
        sourceCoords: boardCoords,
      }, boardCoords)
      return
    }
  }

  // Handle play mode double click (Quick Response Team - Deploy Unit from Hand)
  if (playMode?.card && playMode.sourceCoords) {
    // Cancel play mode
    props.setPlayMode(null)
    return
  }
}

/**
 * Handle click on a board card during targeting mode
 */
export function handleTargetingModeCardClick(
  card: Card,
  boardCoords: { row: number; col: number },
  props: BoardCardClickProps
): boolean {
  const {
    gameState: _gameState,
    localPlayerId,
    abilityMode,
    commandContext: _commandContext,
    markAbilityUsed: _markAbilityUsed,
    triggerNoTarget: _triggerNoTarget,
    handleActionExecution: _handleActionExecution,
    triggerDeckSelection
  } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_TARGET') {
    return false
  }

  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  // Check if this card matches the filter
  if (payload?.filter && !payload.filter(card)) {
    return false
  }

  // Handle SELECT_HAND_FOR_DISCARD_THEN_SPAWN (Faber)
  if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN') {
    // Only allow selecting own cards
    if (card.ownerId !== localPlayerId) {
      return false
    }

    // Execute discard and spawn
    props.handleActionExecution({
      type: 'GLOBAL_AUTO_APPLY',
      payload: {
        ...payload,
        selectedCard: card,
        selectedCoords: boardCoords,
        cleanupCommand: true,
      },
      sourceCard: abilityMode.sourceCard,
      sourceCoords,
      isDeployAbility,
      readyStatusToRemove,
    }, boardCoords)
    return true
  }

  // Handle OPEN_COUNTER_MODAL
  if (payload.actionType === 'OPEN_COUNTER_MODAL') {
    props.setCounterSelectionData({
      card,
      coords: boardCoords,
      counterTypes: payload.counterTypes || ['Aim', 'Stun', 'Shield'],
      sourceCoords,
      isDeployAbility,
      readyStatusToRemove: typeof readyStatusToRemove === 'string' ? [readyStatusToRemove] : readyStatusToRemove,
      callbackAction: 'SCORE_REMOVED', // Default callback action
    })
    return true
  }

  // Handle RESET_DEPLOY
  if (payload.actionType === 'RESET_DEPLOY') {
    props.resetDeployStatus(boardCoords)
    props.markAbilityUsed(boardCoords, false, false, readyStatusToRemove)
    return true
  }

  // Handle deck selection abilities
  if (payload.actionType === 'SELECT_DECK') {
    if (card.ownerId !== undefined) {
      triggerDeckSelection(card.ownerId)
    }
    props.markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    return true
  }

  return false
}
