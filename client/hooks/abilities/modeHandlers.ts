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
  triggerDeckSelection: (playerId: number) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: DropTarget) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  spawnToken: (coords: {row: number; col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number; col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number; col: number}, status: string, pid: number) => void
  removeBoardCardStatus: (coords: {row: number; col: number }, status: string) => void
  removeBoardCardStatusByOwner: (coords: {row: number; col: number}, status: string, pid: number) => void
  removeStatusByType: (coords: {row: number; col: number}, type: string) => void
  resetDeployStatus: (coords: {row: number; col: number }) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: FloatingTextData) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>
  setViewingDiscard: React.Dispatch<React.SetStateAction<boolean>>
  clearValidTargets: () => void
  validTargets?: {row: number, col: number}[]
  handleLineSelection: (coords: {row: number; col: number }) => void
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
    gameState: _gameState,
    localPlayerId: _localPlayerId,
    abilityMode,
    interactionLock,
    handleLineSelection,
  } = props

  if (!abilityMode || abilityMode.type !== 'ENTER_MODE') {
    return false
  }

  if (interactionLock.current) {
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
    handleLineSelection(boardCoords)
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

  // TRANSFER_STATUS_SELECT
  if (mode === 'TRANSFER_STATUS_SELECT') {
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

  // RETRIEVE_DEVICE
  if (mode === 'RETRIEVE_DEVICE') {
    return handleRetrieveDevice(card, boardCoords, props)
  }

  // SELECT_DECK
  if (mode === 'SELECT_DECK') {
    return handleSelectDeck(card, boardCoords, props)
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
    card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
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
    setTimeout(() => triggerClickWave('board', boardCoords), 100)
    if (nextAction.type !== 'ENTER_MODE') {
      setAbilityMode(null)
      clearValidTargets()
    }
  } else {
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }
    setTimeout(() => {
      setAbilityMode(null)
      clearValidTargets()
    }, TIMING.MODE_CLEAR_DELAY)
  }

  return true
}

/**
 * Handle SELECT_TARGET with various actionTypes
 */
function handleSelectTargetActionType(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, markAbilityUsed, setAbilityMode, moveItem, modifyBoardCardPower, addBoardCardStatus, removeBoardCardStatus, removeBoardCardStatusByOwner, removeStatusByType, resetDeployStatus, setCounterSelectionData, handleActionExecution, gameState } = props
  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode!

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

  // SACRIFICE_AND_BUFF_LINES (Centurion)
  if (payload.actionType === 'SACRIFICE_AND_BUFF_LINES') {
    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the owner of Centurion (the card performing the ability)
    const centurionOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId

    // Sacrifice
    moveItem({
      card,
      source: 'board',
      boardCoords,
      bypassOwnershipCheck: true,
    }, {
      target: 'discard',
      playerId: card.ownerId,
    })

    // Buff allies in row and column
    // "Allied" here means cards owned by the same player as Centurion
    const gridSize = gameState.board.length
    const { row: r1, col: c1 } = boardCoords

    // Buff all cards in the same row (except the sacrificed card)
    for (let c = 0; c < gridSize; c++) {
      if (c === c1) {continue}
      const cell = gameState.board[r1][c]
      const targetCard = cell.card
      if (targetCard && targetCard.ownerId === centurionOwnerId) {
        modifyBoardCardPower({ row: r1, col: c }, 1)
      }
    }

    // Buff all cards in the same column (except the sacrificed card)
    for (let r = 0; r < gridSize; r++) {
      if (r === r1) {continue}
      const cell = gameState.board[r][c1]
      const targetCard = cell.card
      if (targetCard && targetCard.ownerId === centurionOwnerId) {
        modifyBoardCardPower({ row: r, col: c1 }, 1)
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

  // MODIFIER_POWER (Walking Turret Setup)
  if (payload.actionType === 'MODIFY_POWER') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    if (payload.amount) {
      modifyBoardCardPower(boardCoords, payload.amount)
    }
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // DESTROY
  if (payload.actionType === 'DESTROY') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }

    const hasShield = card.statuses?.some(s => s.type === 'Shield')
    if (hasShield) {
      removeBoardCardStatus(boardCoords, 'Shield')
    } else {
      // Find Aim token on the card - if present, remove it after destruction
      const aimToken = card.statuses?.find(s => s.type === 'Aim')
      if (aimToken) {
        removeStatusByType(boardCoords, 'Aim')
      }

      moveItem({
        card,
        source: 'board',
        boardCoords,
      }, {
        target: 'discard',
        playerId: card.ownerId,  // Card goes to its owner's discard pile
      })
    }

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

    // Remove Exploit, add Stun
    const exploitCount = card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
    if (exploitCount > 0) {
      removeBoardCardStatusByOwner(boardCoords, 'Exploit', actorId!)
      // Add Stun for each removed Exploit
      for (let i = 0; i < exploitCount; i++) {
        addBoardCardStatus(boardCoords, 'Stun', actorId!)
      }
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
    if (abilityMode!.chainedAction) {
      const chainedAction = {
        ...abilityMode!.chainedAction,
        targetOwnerId: targetOpponentId,
        sourceCoords: sourceCoords || boardCoords,
        sourceCard: abilityMode!.sourceCard, // Pass the source card (Recon Drone) for token ownership
      }
      handleActionExecution(chainedAction, boardCoords)
    }

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
 * 1. Add Shield status to self
 * 2. Transition to RIOT_PUSH mode
 *
 * IMPORTANT: This ability ALWAYS transitions to RIOT_PUSH mode after adding Shield.
 * Self-click activates the ability, then allows pushing an adjacent opponent card.
 */
function handleShieldSelfThenRiotPush(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, addBoardCardStatus, markAbilityUsed, interactionLock, setTargetingMode, commandContext } = props

  if (interactionLock.current) {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode!

  if (!sourceCoords || sourceCoords.row < 0 || !sourceCard) {
    return false
  }

  const ownerId = sourceCard.ownerId!

  // Clicking on source card (self) activates the ability
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    // Add Shield to self
    addBoardCardStatus(sourceCoords, 'Shield', ownerId)

    // Mark ability as used
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

    // Transition to RIOT_PUSH mode
    const riotPushAction: AbilityAction = {
      type: 'ENTER_MODE',
      mode: 'RIOT_PUSH',
      sourceCard,
      sourceCoords,
      isDeployAbility: false, // Deploy already used
      payload: {}
    }

    setAbilityMode(riotPushAction)
    setTargetingMode(riotPushAction, ownerId, sourceCoords, undefined, commandContext)
    return true
  }

  // If clicked elsewhere, don't handle - RIOT_PUSH will handle it
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

  // Swap positions using the dedicated swap function
  swapCards(sourceCoords, boardCoords)

  markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
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
  const { abilityMode, transferStatus, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'TRANSFER_STATUS_SELECT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  if (!card.statuses || card.statuses.length === 0) {
    return false
  }

  transferStatus(boardCoords, sourceCoords, card.statuses[0].type)
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
      timestamp: Date.now(),
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
 * Handle REVEAL_ENEMY (Recon Drone Commit)
 */
function handleRevealEnemy(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setAbilityMode, setCursorStack, markAbilityUsed, gameState, localPlayerId } = props

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
      timestamp: Date.now(),
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
      timestamp: Date.now(),
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
        timestamp: Date.now(),
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
      timestamp: Date.now(),
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
      timestamp: Date.now(),
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
  const { abilityMode, triggerDeckSelection, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_DECK') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  triggerDeckSelection(card.ownerId ?? 0)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}
