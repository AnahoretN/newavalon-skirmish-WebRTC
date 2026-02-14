/**
 * @file Targeting utilities for game actions
 * Shared between client and server (no Node.js/browser dependencies)
 */

import type { GameState, Card, CommandContext, AbilityAction } from '../../client/types.js'

// Constants for target validation
const TARGET_OPPONENTS = -1
const TARGET_MOVED_OWNER = -2
const ADJACENT_DISTANCE = 1
const RANGE_TWO_DISTANCE = 2

/**
 * Validates if a specific target meets constraints.
 */
export const validateTarget = (
  target: { card: Card; ownerId: number; location: 'hand' | 'board'; boardCoords?: { row: number, col: number } },
  constraints: {
        targetOwnerId?: number;
        excludeOwnerId?: number;
        onlyOpponents?: boolean;
        onlyFaceDown?: boolean;
        targetType?: string;
        requiredTargetStatus?: string;
        requireStatusFromSourceOwner?: boolean;
        mustBeAdjacentToSource?: boolean;
        mustBeInLineWithSource?: boolean;
        maxDistanceFromSource?: number; // Maximum Chebyshev distance (King's move) from source
        maxOrthogonalDistance?: number; // Maximum Manhattan/orthogonal distance from source (walking distance)
        sourceCoords?: { row: number, col: number };
        tokenType?: string; // Passed to check for uniqueness
    },
  userPlayerId: number | null,
  players: GameState['players'],
): boolean => {
  const { card, ownerId, location } = target

  // 1. Target Owner (Inclusive)
  if (constraints.targetOwnerId !== undefined && constraints.targetOwnerId !== TARGET_OPPONENTS && constraints.targetOwnerId !== TARGET_MOVED_OWNER && constraints.targetOwnerId !== ownerId) {
    return false
  }

  // 2. Excluded Owner (Exclusive)
  if (constraints.excludeOwnerId !== undefined && constraints.excludeOwnerId === ownerId) {
    return false
  }

  // 3. Only Opponents
  // TARGET_OPPONENTS in targetOwnerId also implies Only Opponents
  if (constraints.onlyOpponents || constraints.targetOwnerId === TARGET_OPPONENTS) {
    // Cannot be self
    if (ownerId === userPlayerId) {
      return false
    }

    // Cannot be teammate
    const userPlayer = players.find(p => p.id === userPlayerId)
    const targetPlayer = players.find(p => p.id === ownerId)
    if (userPlayer && targetPlayer && userPlayer.teamId !== undefined && userPlayer.teamId === targetPlayer.teamId) {
      return false
    }
  }

  // 4. Target Type
  if (constraints.targetType) {
    if (!card.types?.includes(constraints.targetType)) {
      return false
    }
  }

  // 5. Only Face Down (Strict Interpretation of user rules)
  if (constraints.onlyFaceDown) {
    // Rule 1: No 'Revealed' Token allowed FROM THIS PLAYER (Universal)
    if (card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === userPlayerId)) {
      return false
    }

    // Rule 2: If on board, must be physically face down OR revealed only to others
    if (location === 'board') {
      if (!card.isFaceDown) {
        return false
      }
    }
  }

  // 5.1 Unique Token Check (If adding 'Revealed', target must not already have 'Revealed' from this player)
  if (constraints.tokenType === 'Revealed') {
    if (card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === userPlayerId)) {
      return false
    }
  }

  // 6. Required Status
  if (constraints.requiredTargetStatus) {
    if (!card.statuses?.some(s => s.type === constraints.requiredTargetStatus)) {
      return false
    }

    // 6.1 Check if specific status was added by source owner (Actor)
    if (constraints.requireStatusFromSourceOwner && userPlayerId !== null) {
      const hasStatusFromActor = card.statuses?.some(s => s.type === constraints.requiredTargetStatus && s.addedByPlayerId === userPlayerId)
      if (!hasStatusFromActor) {
        return false
      }
    }
  }

  // 7. Adjacency
  if (constraints.mustBeAdjacentToSource && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== ADJACENT_DISTANCE) {
      return false
    }
  }

  // 8. Line Check
  if (constraints.mustBeInLineWithSource && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    if (r1 !== r2 && c1 !== c2) {
      return false
    }
  }

  // 9. Max Distance Check (Chebyshev distance - max of row/col difference)
  if (constraints.maxDistanceFromSource !== undefined && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    const distance = Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2))
    if (distance > constraints.maxDistanceFromSource) {
      return false
    }
  }

  // 10. Max Orthogonal Distance Check (Manhattan distance - row diff + col diff, for orthogonal movement)
  if (constraints.maxOrthogonalDistance !== undefined && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    const distance = Math.abs(r1 - r2) + Math.abs(c1 - c2)
    if (distance > constraints.maxOrthogonalDistance) {
      return false
    }
  }

  return true
}

/**
 * Helper to calculate valid targets for an ability action on board.
 * Optimized to iterate only over active grid bounds.
 */
export const calculateValidTargets = (
  action: AbilityAction | null,
  currentGameState: GameState,
  actorId: number | null, // Renamed from playerId to clarify intent (source card owner)
  commandContext?: CommandContext,
): {row: number, col: number}[] => {
  if (!action || (action.type !== 'ENTER_MODE' && action.type !== 'CREATE_STACK')) {
    return []
  }

  const targets: {row: number, col: number}[] = []
  const board = currentGameState.board
  const gridSize = board.length

  // Calculate visible boundaries - iterate ONLY over active grid area
  const activeSize = currentGameState.activeGridSize
  const offset = Math.floor((gridSize - activeSize) / 2)
  const minBound = offset
  const maxBound = offset + activeSize - 1

  // If action is CREATE_STACK, iterate only active grid area
  if (action.type === 'CREATE_STACK') {
    const constraints = {
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
      sourceCoords: action.sourceCoords,
      tokenType: action.tokenType,
    }

    // Iterate ONLY over active grid bounds (not entire 7x7 board)
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && cell.card.ownerId !== undefined) { // Tokens generally apply to existing cards
          const isValid = validateTarget(
            { card: cell.card, ownerId: cell.card.ownerId, location: 'board', boardCoords: { row: r, col: c } },
            constraints,
            actorId,
            currentGameState.players,
          )
          if (isValid) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }

    return targets
  }

  const { mode, payload, sourceCoords, contextCheck } = action

  // Special case: REVEREND_DOUBLE_EXPLOIT - can target ANY card on battlefield
  if (mode === 'REVEREND_DOUBLE_EXPLOIT') {
    // Iterate ONLY over active grid bounds - all cards with any unit are valid targets
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card) {
          targets.push({ row: r, col: c })
        }
      }
    }
    return targets
  }

  // 1. Generic TARGET selection
  if ((mode === 'SELECT_TARGET' || mode === 'CENSOR_SWAP' || mode === 'ZEALOUS_WEAKEN' || mode === 'CENTURION_BUFF' || mode === 'SELECT_UNIT_FOR_MOVE') && payload.filter && typeof payload.filter === 'function') {

    // Strict Hand-Only actions check - return empty for board targets
    if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
             payload.actionType === 'LUCIUS_SETUP' ||
             payload.actionType === 'SELECT_HAND_FOR_DEPLOY' ||
             payload.handOnly) {
      return []
    }

    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]

        // Check basic filter
        let isValid = cell.card && payload.filter(cell.card, r, c)

        // Check context requirements (e.g., Adjacent to last move)
        if (isValid && contextCheck === 'ADJACENT_TO_LAST_MOVE' && commandContext?.lastMovedCardCoords) {
          const { row: lr, col: lc } = commandContext.lastMovedCardCoords
          const isAdj = Math.abs(r - lr) + Math.abs(c - lc) === 1
          if (!isAdj) {
            isValid = false
          }
        }

        if (isValid) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 1.1 Enhanced Interrogation Generic Targeting (Any Unit)
  else if (mode === 'SELECT_TARGET' && (payload.actionType === 'ENHANCED_INT_REVEAL' || payload.actionType === 'ENHANCED_INT_MOVE')) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 2. Patrol Move (Empty cell in same row/col)
  // Note: Patrol needs to check full rows/cols, but limited to active bounds
  else if (mode === 'PATROL_MOVE' && sourceCoords) {
    // Iterate ONLY over active grid bounds (patrol can move within active area)
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        // Must be same row OR same col
        const isLine = (r === sourceCoords.row || c === sourceCoords.col)
        const isSame = (r === sourceCoords.row && c === sourceCoords.col)
        const isEmpty = !board[r][c].card

        // Allow moving to empty cell OR cancelling by clicking same cell
        if (isLine && (isEmpty || isSame)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 3. Riot Push (Adjacent opponent who can be pushed into empty space)
  else if (mode === 'RIOT_PUSH' && sourceCoords) {
    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    // Helper to check if coords are in active bounds
    const isInActiveBounds = (r: number, c: number) => r >= minBound && r <= maxBound && c >= minBound && c <= maxBound

    neighbors.forEach(nb => {
      // Check bounds (using visible grid bounds)
      if (isInActiveBounds(nb.r, nb.c)) {
        const targetCard = board[nb.r][nb.c].card

        // Check if opponent (Not Self AND Not Teammate)
        if (targetCard && targetCard.ownerId !== actorId) {
          const actorPlayer = currentGameState.players.find(p => p.id === actorId)
          const targetPlayer = currentGameState.players.find(p => p.id === targetCard.ownerId)
          const isTeammate = actorPlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined && actorPlayer.teamId === targetPlayer.teamId

          if (!isTeammate) {
            // Calculate push destination
            const dRow = nb.r - sourceCoords.row
            const dCol = nb.c - sourceCoords.col
            const pushRow = nb.r + dRow
            const pushCol = nb.c + dCol

            // Check dest bounds and emptiness against VISIBLE grid
            if (isInActiveBounds(pushRow, pushCol)) {
              if (!board[pushRow][pushCol].card) {
                targets.push({ row: nb.r, col: nb.c })
              }
            }
          }
        }
      }
    })
  }
  // 4. Riot Move (Specifically vacated cell)
  else if (mode === 'RIOT_MOVE' && payload.vacatedCoords) {
    targets.push(payload.vacatedCoords)
    // Also highlight self to indicate "stay" option
    if (sourceCoords) {
      targets.push(sourceCoords)
    }
  }
  // 5. Swap Positions (Reckless Provocateur)
  else if (mode === 'SWAP_POSITIONS' && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 6. Transfer Status (Reckless Provocateur Commit)
  // Update to handle both single and ALL transfers
  else if ((mode === 'TRANSFER_STATUS_SELECT' || mode === 'TRANSFER_ALL_STATUSES') && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 7. Spawn Token / Select Cell
  else if ((mode === 'SPAWN_TOKEN' || mode === 'SELECT_CELL' || mode === 'IMMUNIS_RETRIEVE')) {
    // Note: IMMUNIS_RETRIEVE behaves like select cell when picking the destination
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const isEmpty = !board[r][c].card

        // If Immunis logic, we check filter (adjacency)
        if (mode === 'IMMUNIS_RETRIEVE' && payload.filter) {
          if (isEmpty && payload.filter(r, c)) {
            targets.push({ row: r, col: c })
          }
          continue
        }

        // For Generic Select Cell (e.g., Recon Drone move, Fusion moves)
        // Payload allowSelf controls "Stay"
        if (mode === 'SELECT_CELL') {
          // Check Move From Hand first
          if (payload.moveFromHand) {
            if (isEmpty) {
              targets.push({ row: r, col: c })
            }
            continue
          }

          if (!sourceCoords) {
            continue
          }

          const isSame = r === sourceCoords.row && c === sourceCoords.col
          const isGlobal = payload.range === 'global'

          let isValidLoc = false

          if (isGlobal) {
            isValidLoc = true
          } else if (payload.range === 'line') {
            isValidLoc = r === sourceCoords.row || c === sourceCoords.col
          } else if (payload.range === RANGE_TWO_DISTANCE) {
            // Range RANGE_TWO_DISTANCE: ADJACENT_DISTANCE or RANGE_TWO_DISTANCE cells away.
            const dRow = Math.abs(r - sourceCoords.row)
            const dCol = Math.abs(c - sourceCoords.col)
            const dist = dRow + dCol

            if (dist === ADJACENT_DISTANCE) {
              isValidLoc = true
            } else if (dist === RANGE_TWO_DISTANCE) {
              // Logic for RANGE_TWO_DISTANCE cells: must be reachable via an empty cell (or straight line RANGE_TWO_DISTANCE).
              // BFS Depth RANGE_TWO_DISTANCE check.
              // Candidates for intermediate step:
              const inters = []
              if (dRow === RANGE_TWO_DISTANCE && dCol === 0) {
                inters.push({ r: (r + sourceCoords.row) / 2, c: c })
              } // Straight vertical
              else if (dRow === 0 && dCol === RANGE_TWO_DISTANCE) {
                inters.push({ r: r, c: (c + sourceCoords.col) / 2 })
              } // Straight horizontal
              else if (dRow === ADJACENT_DISTANCE && dCol === ADJACENT_DISTANCE) { // Diagonal (L-shape)
                inters.push({ r: r, c: sourceCoords.col })
                inters.push({ r: sourceCoords.row, c: c })
              }

              // If ANY intermediate cell is empty, move is valid.
              // BOUNDS CHECK to prevent crash
              isValidLoc = inters.some(i => {
                if (i.r < 0 || i.r >= gridSize || i.c < 0 || i.c >= gridSize) {
                  return false
                }
                return !board[i.r][i.c].card
              })
            }
          } else {
            // Default to Adjacent
            isValidLoc = Math.abs(r - sourceCoords.row) + Math.abs(c - sourceCoords.col) === ADJACENT_DISTANCE
          }

          if ((isEmpty && isValidLoc) || (payload.allowSelf && isSame)) {
            targets.push({ row: r, col: c })
          }
        } else if (mode === 'SPAWN_TOKEN' && sourceCoords) {
          // For Inventive Maker Spawn (Adj)
          const isAdj = Math.abs(r - sourceCoords.row) + Math.abs(c - sourceCoords.col) === 1
          if (isEmpty && isAdj) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
  }
  // 8. Reveal Enemy (Recon Drone)
  else if (mode === 'REVEAL_ENEMY' && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 9. Select Line Start (Any cell in active grid)
  else if (mode === 'SELECT_LINE_START') {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        targets.push({ row: r, col: c })
      }
    }
  }
  // 10. Select Line End (Cells in same row/col)
  else if (mode === 'SELECT_LINE_END' && payload.firstCoords) {
    // Check row and col of firstCoords - iterate only those within active bounds
    const { row: firstRow, col: firstCol } = payload.firstCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: firstRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: firstCol })
    }
  }
  // 11. Integrator Line Select (Cells in same row/col as source)
  else if (mode === 'INTEGRATOR_LINE_SELECT' && sourceCoords) {
    const { row: sourceRow, col: sourceCol } = sourceCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: sourceRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: sourceCol })
    }
  }
  // 11.5. Zius Line Select (same as Integrator, but uses different coords)
  else if (mode === 'ZIUS_LINE_SELECT' && sourceCoords) {
    const { row: sourceRow, col: sourceCol } = sourceCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: sourceRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: sourceCol })
    }
  }
  // 11.6. IP Agent Threat Scoring (same as Integrator - select any cell in same row or col)
  else if (mode === 'IP_AGENT_THREAT_SCORING' && sourceCoords) {
    const { row: sourceRow, col: sourceCol } = sourceCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: sourceRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: sourceCol })
    }
  }
  // 12. Select Diagonal
  else if (mode === 'SELECT_DIAGONAL') {
    if (!payload.firstCoords) {
      // Step 1: Can start anywhere in active grid
      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          targets.push({ row: r, col: c })
        }
      }
    } else {
      // Step 2: Highlight only diagonals from firstCoords (within active bounds)
      const { row: r1, col: c1 } = payload.firstCoords
      // Calculate max diagonal distance from firstCoords to active bounds
      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          if (Math.abs(r - r1) === Math.abs(c - c1)) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
  }

  return targets
}

/**
 * Checks if an action has ANY valid targets (Board or Hand).
 */
export const checkActionHasTargets = (action: AbilityAction, currentGameState: GameState, playerId: number | null, commandContext?: CommandContext): boolean => {
  // If modal open, valid.
  if (action.type === 'OPEN_MODAL') {
    return true
  }

  // Special Case: Select Deck has global targets (all decks)
  if (action.mode === 'SELECT_DECK') {
    return true
  }

  // Special Case: REVEREND_DOUBLE_EXPLOIT can target any card on battlefield
  if (action.mode === 'REVEREND_DOUBLE_EXPLOIT') {
    // Check if there's at least one card on battlefield
    for (let r = 0; r < currentGameState.board.length; r++) {
      for (let c = 0; c < currentGameState.board[r].length; c++) {
        if (currentGameState.board[r][c].card) {
          return true
        }
      }
    }
    return false
  }

  // Special Case: Compound abilities that start with an immediate self-effect are always valid.
  // Even if there are no targets for secondary part (e.g., Aim), first part (Shield) still happens.
  if (action.mode === 'PRINCEPS_SHIELD_THEN_AIM' ||
         action.mode === 'SHIELD_SELF_THEN_SPAWN' ||
         action.mode === 'SHIELD_SELF_THEN_RIOT_PUSH' ||
         action.mode === 'ABR_DEPLOY_SHIELD_AIM' ||
         action.mode === 'GAWAIN_DEPLOY_SHIELD_AIM') {
    return true
  }

  // Special Case: Hand-only actions that require discarding (Faber, Lucius)
  // These actions target cards in hand, so we need to check if player has cards to discard
  if (action.mode === 'SELECT_TARGET' && action.payload?.actionType) {
    const actionType = action.payload.actionType
    if (actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
        actionType === 'LUCIUS_SETUP' ||
        actionType === 'SELECT_HAND_FOR_DEPLOY') {
      // Check if source card's owner has cards in hand
      const ownerId = action.sourceCard?.ownerId || playerId
      if (ownerId !== null) {
        const player = currentGameState.players.find(p => p.id === ownerId)
        if (player && player.hand.length > 0) {
          return true // Player has cards to discard
        }
      }
      return false // No cards in hand
    }
  }

  // Note: CREATE_STACK is now checked via calculateValidTargets as well
  if (action.type === 'CREATE_STACK') {
    const boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)

    if (boardTargets.length > 0) {
      return true
    }

    // Check Hand targets if stack type is compatible
    // Check if 'Revealed' or simple buffs/debuffs
    if (action.tokenType === 'Revealed' || action.tokenType?.startsWith('Power')) {
      // We need to check if ANY hand card is valid
      for (const p of currentGameState.players) {
        for (let i = 0; i < p.hand.length; i++) {
          const constraints = {
            targetOwnerId: action.targetOwnerId,
            excludeOwnerId: action.excludeOwnerId,
            onlyOpponents: action.onlyOpponents,
            onlyFaceDown: action.onlyFaceDown,
            targetType: action.targetType,
            tokenType: action.tokenType,
          }
          const isValid = validateTarget(
            { card: p.hand[i], ownerId: p.id, location: 'hand' },
            constraints,
            playerId,
            currentGameState.players,
          )
          if (isValid) {
            return true
          }
        }
      }
    }

    return false
  }

  // 1. Check Hand Targets first (for handOnly actions like IP Dept Agent)
  if (action.mode === 'SELECT_TARGET' && action.payload?.filter) {
    if (action.payload.handOnly || action.payload.allowHandTargets || action.payload.actionType === 'DESTROY') {
      // Iterate all players hands
      for (const p of currentGameState.players) {
        if (p.hand.some((card) => action.payload.filter!(card))) {
          // For handOnly actions, this is sufficient - don't check board
          if (action.payload.handOnly) {
            return true
          }
        }
      }
    }
    // For handOnly actions, we've already checked and should not continue to board
    if (action.payload.handOnly) {
      return false
    }
  }

  // 2. Check Board Targets
  const boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)
  if (boardTargets.length > 0) {
    return true
  }

  // 3. Check modes with filters that only work on board (CENSOR_SWAP, etc.)
  if ((action.mode === 'CENSOR_SWAP' || action.mode === 'ZEALOUS_WEAKEN' || action.mode === 'CENTURION_BUFF' || action.mode === 'SELECT_UNIT_FOR_MOVE') && action.payload?.filter) {
    // Board targets are already checked in step 1
    // Return false since no valid board targets were found
    return false
  }

  return false
}
