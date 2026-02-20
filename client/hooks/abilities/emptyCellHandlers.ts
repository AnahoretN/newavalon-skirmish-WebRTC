/**
 * Empty Cell Click Handlers
 *
 * Handles clicks on empty cells on the game board
 */

import type { AbilityAction, CursorStackState, CommandContext, Card } from '@/types'
import { validateTarget } from '@shared/utils/targeting'
import { TIMING } from '@/utils/common'

export interface EmptyCellClickProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: any
  draggedItem: any
  interactionLock: React.MutableRefObject<boolean>
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  handleDrop: (item: any, target: any) => void
  moveItem: (item: any, target: any) => void
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  triggerNoTarget: (coords: { row: number; col: number }) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  spawnToken: (coords: {row: number; col: number}, name: string, ownerId: number) => void
  resurrectDiscardedCard: (playerId: number, cardIndex: number, targetCoords: {row: number, col: number}) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: any) => void
  handleLineSelection: (coords: {row: number, col: number}) => void
  openContextMenu: (e: React.MouseEvent, type: string, data: any) => void
  triggerDeckSelection: (playerId: number) => void
}

/**
 * Handle click on empty board cell
 */
export function handleEmptyCellClick(
  boardCoords: { row: number; col: number },
  props: EmptyCellClickProps
): boolean {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    commandContext,
    setCommandContext,
    playMode,
    draggedItem,
    interactionLock,
    handleActionExecution,
    handleDrop,
    moveItem,
    markAbilityUsed,
    spawnToken,
    resurrectDiscardedCard,
    updatePlayerScore,
    triggerFloatingText,
    handleLineSelection,
  } = props

  // Ignore if interaction is locked
  if (interactionLock.current) {
    return false
  }

  const gridSize = gameState.board.length

  // === DRAG & DROP ===
  if (draggedItem) {
    // Check if dragging to valid empty cell
    if (boardCoords.row >= 0 && boardCoords.row < gridSize && boardCoords.col >= 0 && boardCoords.col < gameState.board[boardCoords.row].length) {
      handleDrop(draggedItem, { location: 'board', row: boardCoords.row, col: boardCoords.col } as any)
      return true
    }
    return false
  }

  // === CURSOR STACK (Token placement) ===
  if (cursorStack && cursorStack.isDragging) {
    // Validate the target
    const isValid = validateTarget(
      { location: 'board', row: boardCoords.row, col: boardCoords.col } as any,
      {
        ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
        ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
        onlyOpponents: cursorStack.onlyOpponents,
        onlyFaceDown: cursorStack.onlyFaceDown,
        ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
        ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
        ...(cursorStack.requireStatusFromSourceOwner !== undefined && { requireStatusFromSourceOwner: cursorStack.requireStatusFromSourceOwner }),
        ...(cursorStack.mustBeAdjacentToSource && cursorStack.sourceCoords && { mustBeAdjacentTo: cursorStack.sourceCoords }),
        ...(cursorStack.mustBeInLineWithSource && cursorStack.sourceCoords && { mustBeInLineWith: cursorStack.sourceCoords }),
        ...(cursorStack.maxDistanceFromSource !== undefined && { maxDistance: cursorStack.maxDistanceFromSource }),
        ...(cursorStack.range && { range: cursorStack.range }),
      },
      localPlayerId ?? 0,
      gameState.players
    )

    if (isValid) {
      // Token is valid, but we need the card that owns this token
      // Check if there's a card at sourceCoords
      let sourceCard: Card | null = null
      if (cursorStack.sourceCoords) {
        const { row, col } = cursorStack.sourceCoords
        if (row >= 0 && row < gridSize && col >= 0 && col < gameState.board[row].length) {
          sourceCard = gameState.board[row][col].card
        }
      }

      if (sourceCard) {
        // Token belongs to a card - use the card's action
        // This is handled by the token stacking system
        // For now, just place the token
        handleActionExecution({
          type: 'GLOBAL_AUTO_APPLY',
          payload: {
            tokenType: cursorStack.type,
            count: cursorStack.count,
            targetOwnerId: cursorStack.targetOwnerId,
            onlyOpponents: cursorStack.onlyOpponents,
            onlyFaceDown: cursorStack.onlyFaceDown,
            ...(cursorStack.range && { range: cursorStack.range }),
            ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
            cleanupCommand: true,
          },
          sourceCard,
          sourceCoords: cursorStack.sourceCoords,
        }, boardCoords)
        return true
      }
    }

    // Invalid target - do NOT clear cursor stack, tokens should remain
    return false
  }

  // === ABILITY MODE - SPAWN_TOKEN ===
  if (abilityMode && abilityMode.mode === 'SPAWN_TOKEN') {
    const { sourceCoords, payload, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

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

  // === ABILITY MODE - SELECT_CELL ===
  if (abilityMode && abilityMode.mode === 'SELECT_CELL') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

    // Find current card coordinates
    const currentCardCoords = (() => {
      if (sourceCoords && sourceCoords.row >= 0) {
        return sourceCoords
      }
      if (!sourceCard) {
        return null
      }
      for (let r = 0; r < gameState.board.length; r++) {
        for (let c = 0; c < gameState.board.length; c++) {
          if (gameState.board[r][c].card?.id === sourceCard.id) {
            return { row: r, col: c }
          }
        }
      }
      return null
    })()

    if (!currentCardCoords || !sourceCard) {
      return false
    }

    let isValidMove = false

    // Check range constraints
    if (payload?.range === 'line') {
      isValidMove = (boardCoords.row === currentCardCoords.row || boardCoords.col === currentCardCoords.col)
    } else if (payload?.range === 'global') {
      isValidMove = true
    } else if (payload?.range === 2) {
      const dist = Math.abs(boardCoords.row - currentCardCoords.row) + Math.abs(boardCoords.col - currentCardCoords.col)
      if (dist === 1) {
        isValidMove = true
      } else if (dist === 2) {
        const r1 = currentCardCoords.row, c1 = currentCardCoords.col
        const r2 = boardCoords.row, c2 = boardCoords.col
        const inters = [
          { r: r2, c: c1 },
          { r: r1, c: c2 },
          { r: (r1 + r2) / 2, c: (c1 + c2) / 2 },
        ]
        isValidMove = inters.some(i => {
          if (!Number.isInteger(i.r) || !Number.isInteger(i.c)) {
            return false
          }
          const offset = Math.floor((gameState.board.length - gameState.activeGridSize) / 2)
          const minBound = offset
          const maxBound = offset + gameState.activeGridSize - 1
          if (i.r < minBound || i.r > maxBound || i.c < minBound || i.c > maxBound) {
            return false
          }
          if (Math.abs(i.r - r1) + Math.abs(i.c - c1) !== 1) {
            return false
          }
          return !gameState.board[i.r][i.c].card
        })
      }
    } else if (payload?.filter) {
      // Use filter function
      isValidMove = payload.filter(null, boardCoords.row, boardCoords.col)
    } else {
      // Default: adjacent only
      isValidMove = Math.abs(boardCoords.row - currentCardCoords.row) + Math.abs(boardCoords.col - currentCardCoords.col) === 1
    }

    if (!isValidMove) {
      return false
    }

    // Handle moveFromHand case
    if (payload?.moveFromHand && commandContext.selectedHandCard) {
      const { playerId, cardIndex } = commandContext.selectedHandCard
      const player = gameState.players.find((p: any) => p.id === playerId)
      const handCard = player?.hand[cardIndex]

      if (handCard) {
        moveItem({ card: handCard, source: 'hand', playerId, cardIndex, isManual: true }, { target: 'board', boardCoords })
        markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return true
      }
    }

    // Check if allowSelf and clicking on same position
    const isSelfMove = payload?.allowSelf && boardCoords.row === currentCardCoords.row && boardCoords.col === currentCardCoords.col

    if (!isSelfMove) {
      const liveCard = gameState.board[currentCardCoords.row][currentCardCoords.col].card
      if (liveCard) {
        moveItem({ card: liveCard, source: 'board', boardCoords: currentCardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords })
      }
    }

    if (payload?.recordContext) {
      setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: sourceCard.id })
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)

    if (payload?.chainedAction) {
      const nextAction = { ...payload.chainedAction }
      if (nextAction.targetOwnerId === -2) {
        nextAction.targetOwnerId = sourceCard.ownerId
      }
      if (payload.recordContext) {
        if (!nextAction.payload) {
          nextAction.payload = {}
        }
        nextAction.payload._tempContextId = sourceCard.id
      }
      setAbilityMode(null)
      setTimeout(() => {
        handleActionExecution(nextAction, boardCoords)
      }, TIMING.MODE_CLEAR_DELAY)
    } else {
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    }

    return true
  }

  // === ABILITY MODE - PATROL_MOVE ===
  if (abilityMode && abilityMode.mode === 'PATROL_MOVE') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || !sourceCard) {return false}

    // Same cell = cancel
    if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Check if in same row or column
    const sameRow = boardCoords.row === sourceCoords.row
    const sameCol = boardCoords.col === sourceCoords.col

    if (!sameRow && !sameCol) {return false}

    // Check if cell is empty
    if (gameState.board[boardCoords.row][boardCoords.col].card !== null) {return false}

    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
    markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - RIOT_MOVE ===
  if (abilityMode && abilityMode.mode === 'RIOT_MOVE') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

    if (!sourceCoords || !sourceCard || !payload?.vacatedCoords) {return false}

    if (boardCoords.row === payload.vacatedCoords.row && boardCoords.col === payload.vacatedCoords.col) {
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

  // === ABILITY MODE - IMMUNIS_RETRIEVE ===
  if (abilityMode && abilityMode.mode === 'IMMUNIS_RETRIEVE') {
    const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

    if (!sourceCoords) {return false}

    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {return false}

    if (payload?.selectedCardIndex !== undefined) {
      const ownerId = sourceCard?.ownerId || 0
      resurrectDiscardedCard(ownerId, payload.selectedCardIndex, boardCoords)
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    return false
  }

  // === ABILITY MODE - INTEGRATOR_LINE_SELECT ===
  if (abilityMode && abilityMode.mode === 'INTEGRATOR_LINE_SELECT') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || sourceCoords.row < 0) {return false}

    const sameRow = boardCoords.row === sourceCoords.row
    const sameCol = boardCoords.col === sourceCoords.col

    if (!sameRow && !sameCol) {return false}

    const ownerId = sourceCard?.ownerId || 0
    let exploitCount = 0

    if (sameRow) {
      for (let c = 0; c < gridSize; c++) {
        const card = gameState.board[boardCoords.row][c].card
        if (card?.statuses) {
          exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        }
      }
    } else {
      for (let r = 0; r < gridSize; r++) {
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

    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - IP_AGENT_THREAT_SCORING ===
  if (abilityMode && abilityMode.mode === 'IP_AGENT_THREAT_SCORING') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords) {return false}

    const sameRow = boardCoords.row === sourceCoords.row
    const sameCol = boardCoords.col === sourceCoords.col

    if (!sameRow && !sameCol) {return false}

    const ownerId = sourceCard?.ownerId || 0
    let threatCount = 0

    if (sameRow) {
      for (let c = 0; c < gridSize; c++) {
        const card = gameState.board[boardCoords.row][c].card
        if (card?.statuses) {
          threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
        }
      }
    } else {
      for (let r = 0; r < gridSize; r++) {
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

    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - ZIUS_LINE_SELECT ===
  if (abilityMode && abilityMode.mode === 'ZIUS_LINE_SELECT') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    const contextCoords = commandContext.lastMovedCardCoords || sourceCoords
    if (!contextCoords) {return false}

    const sameRow = boardCoords.row === contextCoords.row
    const sameCol = boardCoords.col === contextCoords.col

    if (!sameRow && !sameCol) {return false}

    const ownerId = sourceCard?.ownerId || 0
    let exploitCount = 0
    const cardsWithExploit: {row: number, col: number}[] = []

    if (sameRow) {
      for (let c = 0; c < gridSize; c++) {
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
      for (let r = 0; r < gridSize; r++) {
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

      cardsWithExploit.forEach(coords => {
        triggerFloatingText({
          row: coords.row,
          col: coords.col,
          text: '+1',
          playerId: ownerId,
        })
      })
    }

    markAbilityUsed(sourceCoords || contextCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - LINE SELECTION MODES ===
  if (abilityMode?.mode && ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'SELECT_LINE_START', 'SELECT_DIAGONAL'].includes(abilityMode.mode)) {
    handleLineSelection(boardCoords)
    return true
  }

  // === PLAY MODE ===
  if (playMode?.card && playMode.sourceCoords) {
    // Drop the card from hand to board
    handleDrop({
      card: playMode.card,
      source: 'hand',
      playerId: playMode.playerId,
      cardIndex: playMode.cardIndex,
    }, { location: 'board', row: boardCoords.row, col: boardCoords.col } as any)
    return true
  }

  return false
}

/**
 * Handle right-click context menu on empty cell
 */
export function handleEmptyCellContextMenu(
  e: React.MouseEvent,
  boardCoords: { row: number; col: number },
  props: EmptyCellClickProps
): void {
  const { gameState, abilityMode, openContextMenu } = props

  // Don't show context menu if in targeting mode
  if (abilityMode) {
    return
  }

  // Check if there's a card at this location (shouldn't happen for empty cell, but just in case)
  const cell = gameState.board[boardCoords.row]?.[boardCoords.col]
  if (cell?.card) {
    // There's a card here - let the card's context menu handle it
    openContextMenu(e, 'boardItem', { card: cell.card, coords: boardCoords })
    return
  }

  // Empty cell context menu (could have future features)
  openContextMenu(e, 'emptyBoardCell', { coords: boardCoords })
}
