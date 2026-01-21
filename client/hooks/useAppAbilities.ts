import { useCallback, useEffect } from 'react'
import type { Card, GameState, AbilityAction, CommandContext, DragItem, Player, CounterSelectionData, CursorStackState, FloatingTextData } from '@/types'
import { getCardAbilityAction, canActivateAbility } from '@server/utils/autoAbilities'
import { checkActionHasTargets, validateTarget } from '@server/utils/targeting'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'
import { recalculateBoardStatuses } from '@server/utils/boardUtils'
import { deepCloneState, TIMING } from '@/utils/common'
import { logger } from '@/utils/logger'

interface UseAppAbilitiesProps {
    gameState: GameState;
    localPlayerId: number | null;
    abilityMode: AbilityAction | null;
    setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>;
    cursorStack: CursorStackState | null;
    setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>;
    commandContext: CommandContext;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    setViewingDiscard: React.Dispatch<React.SetStateAction<any>>;
    triggerNoTarget: (coords: { row: number, col: number }) => void;
    setPlayMode: React.Dispatch<React.SetStateAction<any>>;
    setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>;
    interactionLock: React.MutableRefObject<boolean>;
    onAbilityComplete?: () => void; // Callback when ability completes

    // Actions from useGameState
    updateState: (stateOrFn: GameState | ((prevState: GameState) => GameState)) => void;
    moveItem: (item: DragItem, target: any) => void;
    drawCard: (playerId: number) => void;
    updatePlayerScore: (playerId: number, delta: number) => void;
    markAbilityUsed: (coords: { row: number, col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void;
    applyGlobalEffect: (source: any, targets: any[], type: string, pid: number, isDeploy: boolean) => void;
    swapCards: (c1: any, c2: any, removeReadyStatusFromCoords?: any) => void;
    transferStatus: (from: any, to: any, type: string) => void;
    transferAllCounters: (from: any, to: any) => void;
    resurrectDiscardedCard: (pid: number, idx: number, coords: any) => void;
    spawnToken: (coords: any, name: string, ownerId: number) => void;
    scoreLine: (r1: number, c1: number, r2: number, c2: number, pid: number) => void;
    nextPhase: () => void;
    modifyBoardCardPower: (coords: any, delta: number) => void;
    addBoardCardStatus: (coords: any, status: string, pid: number) => void;
    removeBoardCardStatus: (coords: any, status: string) => void;
    removeBoardCardStatusByOwner: (coords: any, status: string, pid: number) => void;
    resetDeployStatus: (coords: { row: number, col: number }) => void;
    scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void;
    removeStatusByType: (coords: { row: number, col: number }, type: string) => void;
    triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void;
    triggerHandCardSelection: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void;
    clearValidTargets: () => void;
}

export const useAppAbilities = ({
  gameState,
  localPlayerId,
  abilityMode,
  setAbilityMode,
  cursorStack,
  setCursorStack,
  commandContext,
  setCommandContext,
  setViewingDiscard,
  triggerNoTarget,
  setPlayMode,
  setCounterSelectionData,
  interactionLock,
  onAbilityComplete,
  updateState,
  moveItem,
  drawCard,
  updatePlayerScore,
  markAbilityUsed,
  applyGlobalEffect,
  swapCards,
  transferStatus,
  transferAllCounters,
  resurrectDiscardedCard,
  spawnToken,
  scoreLine,
  nextPhase,
  modifyBoardCardPower,
  addBoardCardStatus,
  removeBoardCardStatus,
  removeBoardCardStatusByOwner,
  resetDeployStatus,
  scoreDiagonal,
  removeStatusByType,
  triggerFloatingText,
  triggerHandCardSelection,
  clearValidTargets,
}: UseAppAbilitiesProps) => {

  const handleActionExecution = useCallback((action: AbilityAction, sourceCoords: { row: number, col: number }) => {
    // Handle ABILITY_COMPLETE - trigger readiness recheck
    if (action.type === 'ABILITY_COMPLETE') {
      onAbilityComplete?.()
      return
    }

    // Handle REVEREND_SETUP_SCORE - immediate scoring based on Exploit count
    if (action.type === 'REVEREND_SETUP_SCORE') {
      const ownerId = action.sourceCard?.ownerId ?? 0
      let exploitCount = 0
      for (let r = 0; r < gameState.board.length; r++) {
        for (let c = 0; c < gameState.board[r].length; c++) {
          const card = gameState.board[r][c]?.card
          // Counters are stored in statuses, not a counters property
          if (card?.statuses) {
            const exploitCounters = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
            exploitCount += exploitCounters.length
          }
        }
      }
      if (exploitCount > 0) {
        updatePlayerScore(ownerId, exploitCount)
        triggerFloatingText([{
          row: sourceCoords.row,
          col: sourceCoords.col,
          text: `+${exploitCount}`,
          playerId: ownerId,
        }])
      } else {
        // Show 0 even if no exploits (for feedback)
        triggerFloatingText([{
          row: sourceCoords.row,
          col: sourceCoords.col,
          text: `+0`,
          playerId: ownerId,
        }])
      }
      // Mark ability as used
      markAbilityUsed(sourceCoords, !!action.isDeployAbility)
      return
    }

    // 1. Global Auto Apply
    if (action.type === 'GLOBAL_AUTO_APPLY') {
      if (action.payload?.customAction === 'FINN_SCORING') {
        let revealedCount = 0
        const finnOwnerId = action.sourceCard?.ownerId

        // Defensive check: if source card has no owner, this scoring is invalid
        if (finnOwnerId === undefined) {
          console.warn('[FINN_SCORING] Source card missing ownerId, skipping scoring')
          markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility)
          return
        }

        // Count Revealed cards in opponents' hands
        gameState.players.forEach(p => {
          if (p.id !== finnOwnerId) {
            p.hand.forEach(c => {
              if (c.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId)) {
                revealedCount++
              }
            })
          }
        })

        // Count Revealed cards on the battlefield owned by opponents
        gameState.board.forEach(row => {
          row.forEach(cell => {
            const card = cell.card
            if (card && card.ownerId !== finnOwnerId) {
              // Only count if revealed by Finn's owner
              const revealedByFinn = card.statuses?.filter(s => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId).length || 0
              revealedCount += revealedByFinn
            }
          })
        })

        if (revealedCount > 0) {
          // Use action.sourceCoords for correct position of Finn card
          const coords = action.sourceCoords || sourceCoords
          triggerFloatingText({
            row: coords.row,
            col: coords.col,
            text: `+${revealedCount}`,
            playerId: finnOwnerId,
          })
          updatePlayerScore(finnOwnerId, revealedCount)
        }
        markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility)
        return
      }

      // Handle Removing Aim from Context (Temporary Shelter)
      if (action.payload?.customAction === 'REMOVE_ALL_AIM_FROM_CONTEXT') {
        // Priority: Injected sourceCoords (Immediate) > Context (Stored) > Argument sourceCoords (Fallback)
        if (action.sourceCoords && action.sourceCoords.row >= 0) {
          removeStatusByType(action.sourceCoords, 'Aim')
        } else if (commandContext.lastMovedCardCoords) {
          removeStatusByType(commandContext.lastMovedCardCoords, 'Aim')
        } else if (sourceCoords && sourceCoords.row >= 0) {
          // Fallback to sourceCoords if context is stale (immediate chain)
          removeStatusByType(sourceCoords, 'Aim')
        }
        return
      }

      if (action.payload && !action.payload.cleanupCommand) {
        const { tokenType, filter } = action.payload
        const targets: { row: number, col: number }[] = []
        const gridSize = gameState.board.length

        // Handle Context Rewards (Tactical Maneuver)
        if (action.payload.contextReward && action.sourceCard) {
          let amount = 0

          // Priority: Passed sourceCoords (immediate from chain) > Context (async/stored)
          // Note: sourceCoords arg is the destination of the move in chained calls.
          const coords = (sourceCoords && sourceCoords.row >= 0) ? sourceCoords : commandContext.lastMovedCardCoords

          if (coords) {
            const { row, col } = coords

            // Try getting card at new location (might fail if state is stale)
            let card = gameState.board[row][col].card

            // FIX: STALE STATE HANDLING
            // If board is stale (card not moved yet in this render cycle), looking at destination might yield null.
            // We use the ID to find where the card *currently* is (which is the OLD position in stale state)
            // so we can at least read its Power correctly.

            // Priority: _tempContextId (injected) > lastMovedCardId (context)
            const searchId = action.payload._tempContextId || commandContext.lastMovedCardId

            if ((!card || (searchId && card.id !== searchId)) && searchId) {
              for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
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

            if (card) {
              amount = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            }
          }

          if (amount > 0) {
            const playerId = action.sourceCard.ownerId
            if (playerId === undefined) {
              console.error('Cannot apply reward: sourceCard has no ownerId')
              return
            }
            const rewardType = action.payload.contextReward
            if (rewardType === 'DRAW_MOVED_POWER' || rewardType === 'DRAW_EQUAL_POWER') {
              for (let i = 0; i < amount; i++) {
                drawCard(playerId)
              }
            } else if (rewardType === 'SCORE_MOVED_POWER') {
              triggerFloatingText({
                row: sourceCoords.row,
                col: sourceCoords.col,
                text: `+${amount}`,
                playerId: playerId,
              })
              updatePlayerScore(playerId, amount)
            }
          }

          if (action.payload.contextReward === 'STUN_MOVED_UNIT' && coords) {
            const playerId = action.sourceCard.ownerId
            if (playerId !== undefined) {
              addBoardCardStatus(coords, 'Stun', playerId)
            } else {
              console.error('Cannot apply stun: sourceCard has no ownerId')
            }
          }
          return
        }

        if (filter) {
          // Standard filtering
          for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
              const targetCard = gameState.board[r][c].card
              if (targetCard && filter(targetCard)) {
                targets.push({ row: r, col: c })
              }
            }
          }
        } else {
          // Context / Single Target (No Filter)
          // Prefer immediate action.sourceCoords if available (chain injected)
          if (action.sourceCoords && action.sourceCoords.row >= 0) {
            targets.push(action.sourceCoords)
          } else if (sourceCoords && sourceCoords.row >= 0) {
            targets.push(sourceCoords)
          } else if (commandContext.lastMovedCardCoords) {
            targets.push(commandContext.lastMovedCardCoords)
          }
        }

        if (targets.length > 0) {
          // For Global Apply of Stun/etc., standard applyGlobalEffect uses 1 token
          if (tokenType) {
            // Special handling for multiple tokens in Global Apply (e.g. False Orders Stun x2)
            // applyGlobalEffect is singular. We loop if needed or just call it.
            const count = action.payload.count || 1
            // Allow payload to override ownerId (for False Orders Mode 2)
            // Use localPlayerId as safe fallback if sourceCard is undefined
            const addedBy = action.payload.ownerId !== undefined
              ? action.payload.ownerId
              : (action.sourceCard?.ownerId ?? localPlayerId)

            for (let i = 0; i < count; i++) {
              applyGlobalEffect(sourceCoords, targets, tokenType, addedBy, !!action.isDeployAbility)
            }
          }
        } else {
          triggerNoTarget(sourceCoords)
          markAbilityUsed(sourceCoords, !!action.isDeployAbility)
        }
        return
      }
    }

    // 2. Check Valid Targets (Perform this BEFORE Dynamic calculation to fail fast if needed, but for stacks we check inside)
    const hasTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

    if (!hasTargets) {
      // Rule 4: Show "No Target"
      triggerNoTarget(sourceCoords)

      // Rule 5: If part of a chain has no targets, execute the rest (chainedAction).
      if (action.chainedAction) {
        setTimeout(() => {
          handleActionExecution(action.chainedAction!, sourceCoords)
        }, 500)
      }
      // NOTE: markAbilityUsed is already called BEFORE target check in activateAbility
      // So we don't need to call it here anymore - status is already removed
      return
    }

    // 3. Execution (Targets Exist)
    if (action.type === 'CREATE_STACK' && action.tokenType) {
      let count = action.count || 0

      // Handle Dynamic Count (e.g. Count Exploits on board to determine Reveals)
      if (action.dynamicCount) {
        const { factor, ownerId } = action.dynamicCount
        let dynamic = 0
        gameState.board.forEach(r => r.forEach(c => {
          // Count matching tokens, not just cards.
          if (c.card?.statuses) {
            const matchingTokens = c.card.statuses.filter(s => s.type === factor && s.addedByPlayerId === ownerId)
            dynamic += matchingTokens.length
          }
        }))
        count = dynamic
      }

      if (count > 0) {
        // When setting cursorStack from CREATE_STACK action (not manual drag), clear abilityMode
        // This prevents stale highlights from previous mode (e.g., False Orders move phase)
        setAbilityMode(null)
        setCursorStack({
          type: action.tokenType,
          count: count,
          isDragging: false,
          sourceCoords: sourceCoords,
          sourceCard: action.sourceCard, // Important for determining actorId
          originalOwnerId: action.originalOwnerId, // Preserve command owner for highlight colors
          excludeOwnerId: action.excludeOwnerId,
          onlyOpponents: action.onlyOpponents,
          onlyFaceDown: action.onlyFaceDown,
          targetType: action.targetType, // New prop
          isDeployAbility: action.isDeployAbility,
          requiredTargetStatus: action.requiredTargetStatus,
          requireStatusFromSourceOwner: action.requireStatusFromSourceOwner, // New prop
          mustBeAdjacentToSource: action.mustBeAdjacentToSource,
          mustBeInLineWithSource: action.mustBeInLineWithSource,
          maxDistanceFromSource: action.maxDistanceFromSource, // New prop for distance-based targeting
          maxOrthogonalDistance: action.maxOrthogonalDistance, // New prop for orthogonal distance targeting
          placeAllAtOnce: action.placeAllAtOnce,
          chainedAction: action.chainedAction,
          // Only set targetOwnerId if explicitly specified in action (not for Censor which targets any card with own exploit)
          ...(action.targetOwnerId !== undefined && { targetOwnerId: action.targetOwnerId }),
          recordContext: action.recordContext, // New prop
          replaceStatus: action.replaceStatus, // New prop for status replacement (e.g., Censor)
        })
      } else {
        // If dynamic count resulted in 0, we treat it as "No Targets/No Action"
        triggerNoTarget(sourceCoords)
        // NOTE: markAbilityUsed is already called BEFORE target check in activateAbility
        // If there's a chain, we might want to continue, but usually 0 tokens means stop.
      }

    } else if (action.type === 'ENTER_MODE') {
      // Special Immediate Modes (Compound atomic actions)
      if (action.mode === 'SHIELD_SELF_THEN_SPAWN') {
        addBoardCardStatus(sourceCoords, 'Shield', action.sourceCard!.ownerId!)
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SPAWN_TOKEN',
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
          payload: action.payload,
        })
        return
      }
      if (action.mode === 'SHIELD_SELF_THEN_RIOT_PUSH') {
        // 1. Shield Self automatically
        const actorId = action.sourceCard!.ownerId!
        addBoardCardStatus(sourceCoords, 'Shield', actorId)

        // 2. Check if there are valid adjacent cards to push
        const gridSize = gameState.board.length
        const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
        const minBound = offset
        const maxBound = offset + gameState.activeGridSize - 1

        let hasValidPushTarget = false
        const { row, col } = sourceCoords
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] // up, down, left, right

        for (const [dRow, dCol] of directions) {
          const adjRow = row + dRow
          const adjCol = col + dCol

          // Check bounds
          if (adjRow < minBound || adjRow > maxBound || adjCol < minBound || adjCol > maxBound) {
            continue
          }

          const adjCell = gameState.board[adjRow][adjCol]
          if (!adjCell.card) {
            continue
          }

          // Check if not owned by actor and not teammate
          const targetPlayer = gameState.players.find(p => p.id === adjCell.card!.ownerId)
          const actorPlayer = gameState.players.find(p => p.id === actorId)
          const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined && targetPlayer.teamId === actorPlayer.teamId

          if (adjCell.card!.ownerId === actorId || isTeammate) {
            continue
          }

          // Check if push destination is valid
          const targetRow = adjRow + dRow
          const targetCol = adjCol + dCol

          if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
            continue
          }

          const targetCell = gameState.board[targetRow][targetCol]
          if (targetCell.card === null) {
            hasValidPushTarget = true
            break
          }
        }

        // 3. Set mode or show no target
        if (hasValidPushTarget) {
          setAbilityMode({
            type: 'ENTER_MODE',
            mode: 'RIOT_PUSH',
            sourceCard: action.sourceCard,
            sourceCoords: sourceCoords,
            isDeployAbility: action.isDeployAbility,
            payload: action.payload,
          })
        } else {
          triggerNoTarget(sourceCoords)
        }
        return
      }
      if (action.mode === 'PRINCEPS_SHIELD_THEN_AIM') {
        // 1. Shield Self automatically
        const actorId = action.sourceCard!.ownerId!
        addBoardCardStatus(sourceCoords, 'Shield', actorId)

        // 2. Define the Aim Stack action (no restrictions - can target ANY card in line)
        const aimStackAction: AbilityAction = {
          type: 'CREATE_STACK',
          tokenType: 'Aim',
          count: 1,
          mustBeInLineWithSource: true, // Target must be in line with Princeps
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
        }

        // 3. Check Valid Targets -> Stack Mode or No Target
        const hasTargets = checkActionHasTargets(aimStackAction, gameState, actorId, commandContext)

        if (hasTargets) {
          setCursorStack({
            type: 'Aim',
            count: 1,
            isDragging: false,
            sourceCoords: sourceCoords,
            sourceCard: action.sourceCard,
            originalOwnerId: action.originalOwnerId, // Preserve command owner for highlight colors
            mustBeInLineWithSource: true, // Target must be in line with Princeps
            isDeployAbility: action.isDeployAbility,
          })
        } else {
          triggerNoTarget(sourceCoords)
        }
        return
      }
      if (action.mode === 'GAWAIN_DEPLOY_SHIELD_AIM') {
        // 1. Shield Self automatically
        const actorId = action.sourceCard!.ownerId!
        addBoardCardStatus(sourceCoords, 'Shield', actorId)

        // 2. Define the Aim Stack action (no restrictions - can target any card in line)
        const aimStackAction: AbilityAction = {
          type: 'CREATE_STACK',
          tokenType: 'Aim',
          count: 1,
          mustBeInLineWithSource: true, // Target must be in line with Gawain
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
        }

        // Debug: log what we're looking for
        logger.debug('[GAWAIN] Looking for targets in line with', sourceCoords, 'actorId:', actorId)
        const hasTargets = checkActionHasTargets(aimStackAction, gameState, actorId, commandContext)
        logger.debug('[GAWAIN] Has targets:', hasTargets)

        // 3. Check Valid Targets -> Stack Mode or No Target
        if (hasTargets) {
          setCursorStack({
            type: 'Aim',
            count: 1,
            isDragging: false,
            sourceCoords: sourceCoords,
            sourceCard: action.sourceCard,
            originalOwnerId: action.originalOwnerId, // Preserve command owner for highlight colors
            mustBeInLineWithSource: true, // Target must be in line with Gawain
            isDeployAbility: action.isDeployAbility,
          })
        } else {
          triggerNoTarget(sourceCoords)
          // NOTE: markAbilityUsed already called in activateAbility for the initial readyDeploy
        }
        return
      }
      if (action.mode === 'ABR_DEPLOY_SHIELD_AIM') {
        // 1. Shield Self automatically
        const actorId = action.sourceCard!.ownerId!
        addBoardCardStatus(sourceCoords, 'Shield', actorId)

        // 2. Define the Aim Stack action
        const aimStackAction: AbilityAction = {
          type: 'CREATE_STACK',
          tokenType: 'Aim',
          count: 1,
          requiredTargetStatus: 'Threat',
          requireStatusFromSourceOwner: true, // Only own threat
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
        }

        // 3. Check Valid Targets -> Stack Mode or No Target
        if (checkActionHasTargets(aimStackAction, gameState, actorId, commandContext)) {
          setCursorStack({
            type: 'Aim',
            count: 1,
            isDragging: false,
            sourceCoords: sourceCoords,
            sourceCard: action.sourceCard,
            originalOwnerId: action.originalOwnerId, // Preserve command owner for highlight colors
            targetOwnerId: actorId,
            requiredTargetStatus: 'Threat',
            requireStatusFromSourceOwner: true, // Pass to cursor state
            isDeployAbility: action.isDeployAbility,
          })
        } else {
          triggerNoTarget(sourceCoords)
          // NOTE: markAbilityUsed already called in activateAbility for the initial readyDeploy
        }
        return
      }

      // Check RIOT_PUSH targets for riotAgent, devoutSynthetic, etc.
      if (action.mode === 'RIOT_PUSH' && action.sourceCoords) {
        const gridSize = gameState.board.length
        const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
        const minBound = offset
        const maxBound = offset + gameState.activeGridSize - 1

        let hasValidPushTarget = false
        const { row, col } = action.sourceCoords
        const actorId = action.sourceCard?.ownerId
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] // up, down, left, right

        for (const [dRow, dCol] of directions) {
          const adjRow = row + dRow
          const adjCol = col + dCol

          // Check bounds
          if (adjRow < minBound || adjRow > maxBound || adjCol < minBound || adjCol > maxBound) {
            continue
          }

          const adjCell = gameState.board[adjRow][adjCol]
          if (!adjCell.card || actorId === undefined) {
            continue
          }

          // Check if not owned by actor and not teammate
          const targetPlayer = gameState.players.find(p => p.id === adjCell.card!.ownerId)
          const actorPlayer = gameState.players.find(p => p.id === actorId)
          const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined && targetPlayer.teamId === actorPlayer.teamId

          if (adjCell.card!.ownerId === actorId || isTeammate) {
            continue
          }

          // Check if push destination is valid
          const targetRow = adjRow + dRow
          const targetCol = adjCol + dCol

          if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
            continue
          }

          const targetCell = gameState.board[targetRow][targetCol]
          if (targetCell.card === null) {
            hasValidPushTarget = true
            break
          }
        }

        if (!hasValidPushTarget) {
          triggerNoTarget(action.sourceCoords)
          return
        }
        // Fall through to Standard Mode Entry if targets exist
      }

      // Check SELECT_HAND_FOR_DISCARD_THEN_SPAWN targets (Faber) - must have at least 1 card in hand
      if (action.mode === 'SELECT_TARGET' && action.payload?.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' && action.sourceCard) {
        const ownerId = action.sourceCard.ownerId
        const player = gameState.players.find(p => p.id === ownerId)

        // Only show no target if player exists AND has no cards
        if (player && player.hand.length < 1) {
          // No cards to discard - show no target
          triggerNoTarget(action.sourceCoords || sourceCoords)
          return
        }
        // If player not found in gameState, fall through (shouldn't happen in normal play)
        // Fall through to Standard Mode Entry if player has cards
      }

      // Check LUCIUS_SETUP targets - must have at least 1 card in hand
      if (action.mode === 'SELECT_TARGET' && action.payload?.actionType === 'LUCIUS_SETUP' && action.sourceCard) {
        const ownerId = action.sourceCard.ownerId
        const player = gameState.players.find(p => p.id === ownerId)

        // Only show no target if player exists AND has no cards
        if (player && player.hand.length < 1) {
          // No cards to discard - show no target
          triggerNoTarget(action.sourceCoords || sourceCoords)
          return
        }
        // If player not found in gameState, fall through (shouldn't happen in normal play)
        // Fall through to Standard Mode Entry if player has cards
      }

      // Standard Mode Entry

      let effectiveSourceCard = action.sourceCard
      let effectiveSourceCoords = sourceCoords

      // Prioritize action.sourceCoords if explicitly set (e.g. from chained injections in useAppCounters)
      if (action.sourceCoords && action.sourceCoords.row >= 0) {
        effectiveSourceCoords = action.sourceCoords
      }

      // If this is a SELECT_CELL mode (Move), check if we should use the card from context (False Orders case)
      // Only apply if the action explicitly requests context usage via useContextCard flag
      if (action.mode === 'SELECT_CELL' && commandContext.lastMovedCardCoords && commandContext.lastMovedCardId && action.payload?.useContextCard) {
        const { row, col } = commandContext.lastMovedCardCoords
        const contextCard = gameState.board[row][col].card
        if (contextCard) {
          effectiveSourceCard = contextCard
          effectiveSourceCoords = commandContext.lastMovedCardCoords
        }
      }

      setAbilityMode({
        ...action,
        sourceCard: effectiveSourceCard,
        sourceCoords: effectiveSourceCoords,
      })

    } else if (action.type === 'OPEN_MODAL') {
      // Modal logic (unchanged essentially, but wrapped)
      if (action.mode === 'RETRIEVE_DEVICE') {
        const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
        if (player) {
          setViewingDiscard({
            player,
            pickConfig: { filterType: 'Device', action: 'recover' },
          })
          if (sourceCoords.row >= 0) {
            markAbilityUsed(sourceCoords, !!action.isDeployAbility)
          }
        }
      } else if (action.mode === 'IMMUNIS_RETRIEVE') {
        const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
        if (player) {
          setViewingDiscard({
            player,
            pickConfig: { filterType: 'Optimates', action: 'resurrect' },
          })
          setAbilityMode({
            type: 'ENTER_MODE',
            mode: 'IMMUNIS_RETRIEVE',
            sourceCard: action.sourceCard,
            sourceCoords: sourceCoords,
            isDeployAbility: action.isDeployAbility,
            payload: action.payload,
          })
        }
      } else if (action.mode === 'SEARCH_DECK') {
        const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
        if (player) {
          setViewingDiscard({
            player,
            pickConfig: {
              filterType: action.payload.filterType || 'Unit',
              action: 'recover',
              isDeck: true,
            },
          })
          if (sourceCoords.row >= 0) {
            markAbilityUsed(sourceCoords, !!action.isDeployAbility)
          }
        }
      } else if (action.mode === 'ZIUS_LINE_SELECT') {
        // ZIUS_SCORING: Works like INTEGRATOR_LINE_SELECT but uses the target card coords (where Exploit was placed)
        // The target card coords are stored in commandContext.lastMovedCardCoords
        if (commandContext.lastMovedCardCoords) {
          setAbilityMode({
            type: 'ENTER_MODE',
            mode: 'ZIUS_LINE_SELECT',
            sourceCard: action.sourceCard,
            sourceCoords: commandContext.lastMovedCardCoords, // Use target card coords as anchor point
            isDeployAbility: action.isDeployAbility,
            payload: action.payload,
            chainedAction: action.chainedAction, // Pass chainedAction (Exploit placement after scoring)
          })
        } else {
          // Fallback: use Zius's own coords if context not available
          setAbilityMode({
            type: 'ENTER_MODE',
            mode: 'ZIUS_LINE_SELECT',
            sourceCard: action.sourceCard,
            sourceCoords: sourceCoords,
            isDeployAbility: action.isDeployAbility,
            payload: action.payload,
            chainedAction: action.chainedAction,
          })
        }
      } else if (action.mode === 'SELECT_DECK') {
        // Secret Informant: Set mode to select a deck to view top 3 cards
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SELECT_DECK',
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
          payload: action.payload,
        })
      } else if (action.mode === 'ZIUS_EXPLOIT_AND_SCORE') {
        // Zius Setup: Enter mode to place Exploit, then immediately switch to line selection
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'ZIUS_EXPLOIT_AND_SCORE',
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
          payload: action.payload,
        })
      } else if (action.mode === 'REVEREND_DOUBLE_EXPLOIT') {
        // Reverend Deploy: Select a card with your Exploit to double the counters
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'REVEREND_DOUBLE_EXPLOIT',
          sourceCard: action.sourceCard,
          sourceCoords: sourceCoords,
          isDeployAbility: action.isDeployAbility,
          payload: action.payload,
        })
      }
    }
  }, [gameState, localPlayerId, commandContext, markAbilityUsed, setAbilityMode, setCursorStack, triggerNoTarget, applyGlobalEffect, setViewingDiscard, addBoardCardStatus, updatePlayerScore, drawCard, removeStatusByType, onAbilityComplete, triggerFloatingText])

  // Auto-Execute GLOBAL_AUTO_APPLY actions when they appear in abilityMode
  useEffect(() => {
    if (abilityMode?.type === 'GLOBAL_AUTO_APPLY') {
      handleActionExecution(abilityMode, abilityMode.sourceCoords || { row: -1, col: -1 })
      setAbilityMode(null)
    }
  }, [abilityMode, handleActionExecution, setAbilityMode])

  const activateAbility = useCallback((card: Card, boardCoords: { row: number, col: number }) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (!gameState.isGameStarted || localPlayerId === null) {
      return
    }

    const owner = gameState.players.find(p => p.id === card.ownerId)
    // Only the host (player 1) can control dummy players' cards
    const canControl = localPlayerId === card.ownerId || (owner?.isDummy && localPlayerId === 1)

    if (gameState.activePlayerId !== card.ownerId) {
      return
    }
    if (!canControl) {
      return
    }

    // NEW: Only activate if card has visual ready effect
    // This ensures abilities only activate when the player can see the visual indicator
    if (!hasReadyAbilityInCurrentPhase(card, gameState)) {
      return
    }

    if (!canActivateAbility(card, gameState.currentPhase, gameState.activePlayerId, gameState)) {
      return
    }

    const action = getCardAbilityAction(card, gameState, card.ownerId!, boardCoords)
    if (action) {
      // NEW FLOW: Remove ready status FIRST, then execute
      // This ensures the visual highlight disappears immediately on click
      if (action.readyStatusToRemove) {
        markAbilityUsed(boardCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      }

      // Add ABILITY_COMPLETE at the end of the action chain to trigger readiness recheck
      const actionWithComplete: AbilityAction = {
        ...action,
        chainedAction: action.chainedAction
          ? { ...action.chainedAction, chainedAction: { type: 'ABILITY_COMPLETE' } }
          : { type: 'ABILITY_COMPLETE' }
      }

      // Execute the action (which will check targets and show no-target if needed)
      handleActionExecution(actionWithComplete, boardCoords)
    }
  }, [abilityMode, cursorStack, gameState, localPlayerId, handleActionExecution, markAbilityUsed])

  const handleLineSelection = useCallback((coords: { row: number, col: number }) => {
    if (!abilityMode) {
      return
    }
    const { mode, sourceCard, sourceCoords, payload, isDeployAbility } = abilityMode

    if (mode === 'SCORE_LAST_PLAYED_LINE' && abilityMode.sourceCoords) {
      const { row: r1, col: c1 } = abilityMode.sourceCoords
      const { row: r2, col: c2 } = coords
      if (r1 !== r2 && c1 !== c2) {
        return
      }

      // Calculate score locally first
      const playerId = gameState.activePlayerId!
      const gridSize = gameState.board.length
      let rStart = r1, rEnd = r1, cStart = c1, cEnd = c1
      if (r1 === r2) {
        rStart = r1; rEnd = r1
        cStart = 0; cEnd = gridSize - 1
      } else if (c1 === c2) {
        cStart = c2; cEnd = c2
        rStart = 0; rEnd = gridSize - 1
      } else {
        return
      }

      const hasActiveLiberator = gameState.board.some(row =>
        row.some(cell =>
          cell.card?.ownerId === playerId &&
          cell.card.name.toLowerCase().includes('data liberator') &&
          cell.card.statuses?.some(s => s.type === 'Support'),
        ),
      )

      let totalScore = 0
      const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

      for (let r = rStart; r <= rEnd; r++) {
        for (let c = cStart; c <= cEnd; c++) {
          const cell = gameState.board[r][c]
          const card = cell.card
          if (card && !card.statuses?.some(s => s.type === 'Stun')) {
            const isOwner = card.ownerId === playerId
            const hasExploit = card.statuses?.some(s => s.type === 'Exploit' && s.addedByPlayerId === playerId)
            if (isOwner || (hasActiveLiberator && hasExploit && card.ownerId !== playerId)) {
              const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
              if (points > 0) {
                totalScore += points
                scoreEvents.push({ row: r, col: c, text: `+${points}`, playerId })
              }
            }
          }
        }
      }

      // Send floating texts for all players to see
      if (scoreEvents.length > 0) {
        triggerFloatingText(scoreEvents)
      }

      // Use updateState directly to ensure atomic update of score + phase
      updateState((prevState: GameState) => {
        const newState: GameState = deepCloneState(prevState)
        const player = newState.players.find(p => p.id === playerId)
        if (player) {
          player.score += totalScore
        }
        // Exit scoring step and move to next player
        // Set phase to -1 (Draw Phase) so server will auto-draw and transition to Setup (0)
        newState.isScoringStep = false
        newState.currentPhase = -1
        const finishingPlayerId = playerId
        newState.board.forEach(row => {
          row.forEach(cell => {
            if (cell.card?.ownerId === finishingPlayerId && cell.card.statuses) {
              const stunIndex = cell.card.statuses.findIndex(s => s.type === 'Stun')
              if (stunIndex !== -1) {
                cell.card.statuses.splice(stunIndex, 1)
              }
            }
          })
        })
        // Recalculate statuses after Stun removal
        newState.board = recalculateBoardStatuses(newState)

        let nextPlayerId = finishingPlayerId
        const sortedPlayers = [...newState.players].sort((a, b) => a.id - b.id)
        const currentIndex = sortedPlayers.findIndex(p => p.id === nextPlayerId)
        if (currentIndex !== -1) {
          const nextIndex = (currentIndex + 1) % sortedPlayers.length
          nextPlayerId = sortedPlayers[nextIndex].id
        }
        newState.activePlayerId = nextPlayerId

        return newState
      })
      setAbilityMode(null)
      return
    }

    if (mode === 'SELECT_LINE_START') {
      setAbilityMode({
        type: 'ENTER_MODE',
        mode: 'SELECT_LINE_END',
        sourceCard,
        sourceCoords,
        isDeployAbility,
        payload: { ...payload, firstCoords: coords },
      })
      return
    }
    if (mode === 'SELECT_LINE_END' && payload?.firstCoords) {
      const { row: r1, col: c1 } = payload.firstCoords
      const { row: r2, col: c2 } = coords
      if (r1 !== r2 && c1 !== c2) {
        return
      }
      const actionType = payload.actionType

      const actorId = sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))

      if (actionType === 'ZIUS_SCORING') {
        // Validate that the selected line passes through the target card (where Exploit was placed)
        const targetCoords = commandContext.lastMovedCardCoords

        if (targetCoords) {
          // Check if targetCoords is on the selected line
          const isOnRow = r1 === r2 && targetCoords.row === r1
          const isOnCol = c1 === c2 && targetCoords.col === c1

          if (!isOnRow && !isOnCol) {
            // Selected line does NOT pass through the target card - invalid selection
            return
          }
        }

        const gridSize = gameState.board.length
        let startR = 0, endR = gridSize - 1
        let startC = 0, endC = gridSize - 1

        if (r1 === r2) {
          startR = endR = r1
        } else if (c1 === c2) {
          startC = endC = c1
        } else {
          return
        }

        let exploitCount = 0
        for (let r = startR; r <= endR; r++) {
          for (let c = startC; c <= endC; c++) {
            const cell = gameState.board[r][c]
            if (cell.card) {
              exploitCount += cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
            }
          }
        }

        if (exploitCount > 0 && actorId) {
          if (sourceCoords) {
            triggerFloatingText({
              row: sourceCoords.row,
              col: sourceCoords.col,
              text: `+${exploitCount}`,
              playerId: actorId,
            })
          }
          updatePlayerScore(actorId, exploitCount)
        }
        if (sourceCoords && sourceCoords.row >= 0) {
          markAbilityUsed(sourceCoords, isDeployAbility)
        }
      } else if (actionType === 'CENTURION_BUFF' && sourceCard && sourceCoords && actorId) {
        const gridSize = gameState.board.length
        let startR = 0, endR = gridSize - 1
        let startC = 0, endC = gridSize - 1
        if (r1 === r2) {
          startR = endR = r1
        } else {
          startC = endC = c1
        }
        for (let r = startR; r <= endR; r++) {
          for (let c = startC; c <= endC; c++) {
            const targetCard = gameState.board[r][c].card
            if (targetCard) {
              const isSelf = targetCard.id === sourceCard.id
              const isOwner = targetCard.ownerId === actorId
              const activePlayer = gameState.players.find(p => p.id === actorId)
              const targetPlayer = gameState.players.find(p => p.id === targetCard.ownerId)
              const isTeammate = activePlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined && activePlayer.teamId === targetPlayer.teamId
              if (!isSelf && (isOwner || isTeammate)) {
                modifyBoardCardPower({ row: r, col: c }, 1)
              }
            }
          }
        }
        markAbilityUsed(sourceCoords, isDeployAbility)
      } else if (actionType === 'SCORE_LINE' || !actionType) {
        scoreLine(r1, c1, r2, c2, actorId!)
        // Advance phase after scoring, unless skipNextPhase is set (e.g., Logistics Chain)
        if (!payload.skipNextPhase) {
          nextPhase()
        }
      }
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    }
    if (mode === 'SELECT_DIAGONAL' && payload.actionType === 'SCORE_DIAGONAL') {
      const actorId = sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))
      if (!payload.firstCoords) {
        setAbilityMode({ ...abilityMode, payload: { ...payload, firstCoords: coords } })
        return
      } else {
        const { row: r1, col: c1 } = payload.firstCoords
        const { row: r2, col: c2 } = coords

        if (Math.abs(r1 - r2) !== Math.abs(c1 - c2)) {
          setAbilityMode(null)
          return
        }

        scoreDiagonal(r1, c1, r2, c2, actorId!, payload.bonusType)
        // Advance phase after scoring, unless skipNextPhase is set (e.g., Logistics Chain)
        if (!payload.skipNextPhase) {
          nextPhase()
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      }
    }
  }, [abilityMode, gameState, localPlayerId, scoreLine, nextPhase, setAbilityMode, modifyBoardCardPower, markAbilityUsed, scoreDiagonal, updatePlayerScore, triggerFloatingText, commandContext, updateState])

  const handleBoardCardClick = useCallback((card: Card, boardCoords: { row: number, col: number }) => {
    logger.debug('[handleBoardCardClick] Called - card:', card.name, 'coords:', boardCoords, 'abilityMode:', abilityMode?.mode)

    if (setPlayMode !== null && setPlayMode !== undefined && cursorStack) {
      logger.debug('[handleBoardCardClick] Blocked by cursorStack')
      return
    }
    if (interactionLock.current) {
      logger.debug('[handleBoardCardClick] Blocked by interactionLock')
      return
    }

    if (abilityMode && (abilityMode.mode === 'SCORE_LAST_PLAYED_LINE' || abilityMode.mode === 'SELECT_LINE_END' || abilityMode.mode === 'SELECT_DIAGONAL')) {
      handleLineSelection(boardCoords)
      return
    }

    if (abilityMode?.type === 'ENTER_MODE') {
      // Prevent clicking self unless specific modes allow it
      if (abilityMode.sourceCard && abilityMode.sourceCard.id === card.id &&
                abilityMode.mode !== 'SELECT_LINE_START' &&
                abilityMode.mode !== 'INTEGRATOR_LINE_SELECT' &&
                abilityMode.mode !== 'ZIUS_LINE_SELECT' &&
                abilityMode.mode !== 'SELECT_UNIT_FOR_MOVE' &&
                abilityMode.mode !== 'SELECT_TARGET' &&
                abilityMode.mode !== 'RIOT_PUSH' &&
                abilityMode.mode !== 'RIOT_MOVE' &&
                abilityMode.mode !== 'REVEREND_DOUBLE_EXPLOIT'
      ) {
        return
      }

      const { mode, payload, sourceCard, sourceCoords, isDeployAbility } = abilityMode
      if (mode === 'SELECT_LINE_START' || mode === 'SELECT_LINE_END') {
        handleLineSelection(boardCoords); return
      }

      const actorId = sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))

      if (mode === 'SELECT_TARGET' && payload.tokenType) {
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }

        moveItem({
          card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
          source: 'counter_panel',
          statusType: payload.tokenType,
          count: payload.count || 1,
        }, { target: 'board', boardCoords })

        if (abilityMode.recordContext) {
          setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: card.id })
        }

        if (payload.chainedAction) {
          const nextAction: AbilityAction = {
            ...payload.chainedAction,
            sourceCard: card,
            sourceCoords: boardCoords,
            isDeployAbility: isDeployAbility,
            recordContext: true,
          }
          handleActionExecution(nextAction, boardCoords)
          if (nextAction.type !== 'ENTER_MODE') {
            setAbilityMode(null)
          }
        } else {
          if (sourceCoords && sourceCoords.row >= 0) {
            markAbilityUsed(sourceCoords, isDeployAbility)
          }
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'OPEN_COUNTER_MODAL') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        setCounterSelectionData({
          card: card,
          callbackAction: payload.rewardType,
        })
        setAbilityMode(null)
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'SACRIFICE_AND_BUFF_LINES') {
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }

        // 1. Sacrifice (Send to discard bypass shield)
        moveItem({
          card,
          source: 'board',
          boardCoords,
          bypassOwnershipCheck: true,
        }, {
          target: 'discard',
          playerId: card.ownerId,
        })

        // 2. Buff lines
        const gridSize = gameState.board.length
        const { row: r1, col: c1 } = boardCoords

        // Row
        for (let c = 0; c < gridSize; c++) {
          // Skip the cell we just sacrificed (even though it's moving, check coords to be safe)
          if (c === c1) {
            continue
          }

          const cell = gameState.board[r1][c]
          const targetCard = cell.card
          // Check if Ally
          if (targetCard && (targetCard.ownerId === actorId || (gameState.players.find(p => p.id === actorId)?.teamId !== undefined && gameState.players.find(p => p.id === targetCard.ownerId)?.teamId === gameState.players.find(p => p.id === actorId)?.teamId))) {
            modifyBoardCardPower({ row: r1, col: c }, 1)
          }
        }

        // Col
        for (let r = 0; r < gridSize; r++) {
          if (r === r1) {
            continue
          }

          const cell = gameState.board[r][c1]
          const targetCard = cell.card
          if (targetCard && (targetCard.ownerId === actorId || (gameState.players.find(p => p.id === actorId)?.teamId !== undefined && gameState.players.find(p => p.id === targetCard.ownerId)?.teamId === gameState.players.find(p => p.id === actorId)?.teamId))) {
            modifyBoardCardPower({ row: r, col: c1 }, 1)
          }
        }

        if (sourceCoords && sourceCoords.row >= 0) {
          markAbilityUsed(sourceCoords, isDeployAbility)
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'REVEREND_DOUBLE_EXPLOIT') {
        // Reverend Deploy: Double the Exploit counters on the selected card (any card, even with 0 exploits)
        if (!actorId) { return }
        const ownerId = actorId
        // Counters are stored in statuses, not a counters property
        const currentExploits = (card.statuses || []).filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length

        // Add the same number of Exploits (effectively doubling) - if 0, adds 0
        for (let i = 0; i < currentExploits; i++) {
          moveItem({
            card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
            source: 'counter_panel',
            statusType: 'Exploit',
            count: 1,
          }, { target: 'board', boardCoords })
        }

        if (sourceCoords && sourceCoords.row >= 0) {
          markAbilityUsed(sourceCoords, isDeployAbility)
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'DESTROY') {
        // handOnly actions (like IP Dept Agent Commit) should NOT work on board cards
        if (payload.handOnly) {
          return
        }
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }
        const hasShield = card.statuses?.some(s => s.type === 'Shield')
        if (hasShield) {
          removeBoardCardStatus(boardCoords, 'Shield')
        } else {
          moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'discard', playerId: card.ownerId })
        }

        if (payload.chainedAction) {
          const nextAction = { ...payload.chainedAction, sourceCard, sourceCoords, isDeployAbility }
          handleActionExecution(nextAction, sourceCoords!)
          if (nextAction.type !== 'ENTER_MODE') {
            setAbilityMode(null)
          }
        } else {
          if (sourceCoords && sourceCoords.row >= 0) {
            markAbilityUsed(sourceCoords, isDeployAbility)
          }
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'DRAW_EQUAL_POWER') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        const count = Math.max(0, card.power + (card.powerModifier || 0))
        for (let i = 0; i < count; i++) {
          drawCard(actorId!)
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'SELECT_TARGET' && payload.actionType === 'SCORE_EQUAL_POWER') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        const points = Math.max(0, card.power + (card.powerModifier || 0))
        if (sourceCoords) {
          triggerFloatingText({
            row: sourceCoords.row,
            col: sourceCoords.col,
            text: `+${points}`,
            playerId: actorId!,
          })
        }
        updatePlayerScore(actorId!, points)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'RESET_DEPLOY') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        resetDeployStatus(boardCoords)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'SHIELD_AND_REMOVE_AIM') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        addBoardCardStatus(boardCoords, 'Shield', actorId!)
        removeStatusByType(boardCoords, 'Aim')
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'SELECT_TARGET' && payload.actionType === 'MODIFY_POWER') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        if (payload.amount) {
          modifyBoardCardPower(boardCoords, payload.amount)
        }
        if (sourceCoords && sourceCoords.row >= 0) {
          markAbilityUsed(sourceCoords, isDeployAbility)
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }

      if (mode === 'RIOT_PUSH' && sourceCoords && sourceCoords.row >= 0) {
        // Allow self-click to skip/finish
        if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
          markAbilityUsed(sourceCoords, isDeployAbility)
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
          return
        }

        const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
        const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
        const actorPlayer = gameState.players.find(p => p.id === actorId)
        const isTeammate = targetPlayer?.teamId !== undefined && actorPlayer?.teamId !== undefined && targetPlayer.teamId === actorPlayer.teamId

        if (!isAdj || card.ownerId === actorId || isTeammate) {
          return
        }

        const dRow = boardCoords.row - sourceCoords.row
        const dCol = boardCoords.col - sourceCoords.col
        const targetRow = boardCoords.row + dRow
        const targetCol = boardCoords.col + dCol

        // Calculate visible grid boundaries to prevent out-of-bounds pushes
        const gridSize = gameState.board.length
        const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
        const minBound = offset
        const maxBound = offset + gameState.activeGridSize - 1

        if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
          return
        }

        if (gameState.board[targetRow][targetCol].card !== null) {
          return
        }
        moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })
        setAbilityMode({ type: 'ENTER_MODE', mode: 'RIOT_MOVE', sourceCard: abilityMode.sourceCard, sourceCoords: abilityMode.sourceCoords, isDeployAbility: isDeployAbility, payload: { vacatedCoords: boardCoords } })
        return
      }
      if (mode === 'RIOT_MOVE' && sourceCoords && sourceCoords.row >= 0) {
        if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
          markAbilityUsed(sourceCoords, isDeployAbility)
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }
      if (mode === 'SWAP_POSITIONS' && sourceCoords && sourceCoords.row >= 0) {
        logger.debug('[SWAP_POSITIONS] Checking swap - sourceCard:', sourceCard?.name, 'targetCard:', card.name, 'sourceCoords:', sourceCoords, 'boardCoords:', boardCoords)
        // Verify the card at sourceCoords is still the expected sourceCard
        const actualSourceCard = gameState.board[sourceCoords.row][sourceCoords.col].card
        if (!actualSourceCard || actualSourceCard.id !== sourceCard?.id) {
          logger.debug('[SWAP_POSITIONS] Blocked - source card moved, aborting swap')
          setAbilityMode(null) // Clear the mode since source moved
          return
        }
        if (sourceCard && sourceCard.id === card.id) {
          logger.debug('[SWAP_POSITIONS] Blocked - same card')
          return
        }
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          logger.debug('[SWAP_POSITIONS] Blocked - filter failed')
          return
        }
        logger.debug('[SWAP_POSITIONS] Executing swap!')
        // Swap cards and remove ready status from where Reckless Provocateur ends up (boardCoords)
        swapCards(sourceCoords, boardCoords, boardCoords)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'TRANSFER_STATUS_SELECT' && sourceCoords && sourceCoords.row >= 0) {
        if (sourceCard && sourceCard.id === card.id) {
          return
        }
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }
        if (card.statuses && card.statuses.length > 0) {
          transferStatus(boardCoords, sourceCoords, card.statuses[0].type)
          markAbilityUsed(sourceCoords, isDeployAbility)
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }
      if (mode === 'TRANSFER_ALL_STATUSES' && sourceCoords && sourceCoords.row >= 0) {
        if (sourceCard && sourceCard.id === card.id) {
          return
        }
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }
        transferAllCounters(boardCoords, sourceCoords)
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'REVEAL_ENEMY') {
        if (sourceCard && sourceCard.id === card.id) {
          return
        }
        if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
          return
        }
        setCursorStack({ type: 'Revealed', count: 1, isDragging: false, sourceCoords: sourceCoords, sourceCard: sourceCard, originalOwnerId: abilityMode.originalOwnerId, targetOwnerId: card.ownerId, onlyFaceDown: true, onlyOpponents: true, isDeployAbility: isDeployAbility })
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'CENSOR_SWAP' && sourceCoords && sourceCoords.row >= 0) {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        removeBoardCardStatusByOwner(boardCoords, 'Exploit', actorId!)
        addBoardCardStatus(boardCoords, 'Stun', actorId!)
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'ZEALOUS_WEAKEN' && sourceCoords && sourceCoords.row >= 0) {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        modifyBoardCardPower(boardCoords, -1)
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'CENTURION_BUFF' && sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'SELECT_UNIT_FOR_MOVE' && sourceCoords && sourceCoords.row >= 0) {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SELECT_CELL',
          sourceCard: card,
          sourceCoords: boardCoords,
          isDeployAbility: isDeployAbility,
          recordContext: abilityMode.recordContext,
          payload: {
            allowSelf: false,
            abilitySourceCoords: sourceCoords,
            range: payload.range,
            chainedAction: payload.chainedAction,
            originalActorId: actorId,
          },
        })
        return
      }
      if (mode === 'SELECT_UNIT_FOR_MOVE' && !sourceCoords) {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SELECT_CELL',
          sourceCard: card,
          sourceCoords: boardCoords,
          recordContext: abilityMode.recordContext,
          payload: {
            allowSelf: false,
            range: payload.range,
            chainedAction: payload.chainedAction,
            originalActorId: actorId,
          },
        })
        return
      }
      if (mode === 'INTEGRATOR_LINE_SELECT' && sourceCoords && sourceCoords.row >= 0) {
        if (boardCoords.row !== sourceCoords.row && boardCoords.col !== sourceCoords.col) {
          return
        }

        const gridSize = gameState.board.length
        let exploits = 0
        if (boardCoords.row === sourceCoords.row) {
          for (let c = 0; c < gridSize; c++) {
            const cell = gameState.board[boardCoords.row][c]
            if (cell.card) {
              exploits += cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
            }
          }
        } else {
          for (let r = 0; r < gridSize; r++) {
            const cell = gameState.board[r][boardCoords.col]
            if (cell.card) {
              exploits += cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
            }
          }
        }

        if (exploits > 0) {
          triggerFloatingText({
            row: sourceCoords.row,
            col: sourceCoords.col,
            text: `+${exploits}`,
            playerId: actorId!,
          })
          updatePlayerScore(actorId!, exploits)
        }
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (mode === 'ZIUS_LINE_SELECT' && sourceCoords && sourceCoords.row >= 0) {
        // Same logic as INTEGRATOR_LINE_SELECT, but sourceCoords points to the target card (where Exploit was placed)
        if (boardCoords.row !== sourceCoords.row && boardCoords.col !== sourceCoords.col) {
          return
        }

        const gridSize = gameState.board.length
        let totalExploits = 0
        const floatingTextBatch: Array<{ row: number, col: number, text: string, playerId: number, timestamp: number }> = []

        if (boardCoords.row === sourceCoords.row) {
          // Horizontal line
          for (let c = 0; c < gridSize; c++) {
            const cell = gameState.board[boardCoords.row][c]
            if (cell.card) {
              const cardExploits = cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
              if (cardExploits > 0) {
                totalExploits += cardExploits
                // Show floating text over each card with exploits
                floatingTextBatch.push({
                  row: boardCoords.row,
                  col: c,
                  text: `+${cardExploits}`,
                  playerId: actorId!,
                  timestamp: Date.now(),
                })
              }
            }
          }
        } else {
          // Vertical line
          for (let r = 0; r < gridSize; r++) {
            const cell = gameState.board[r][boardCoords.col]
            if (cell.card) {
              const cardExploits = cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
              if (cardExploits > 0) {
                totalExploits += cardExploits
                floatingTextBatch.push({
                  row: r,
                  col: boardCoords.col,
                  text: `+${cardExploits}`,
                  playerId: actorId!,
                  timestamp: Date.now(),
                })
              }
            }
          }
        }

        if (totalExploits > 0) {
          // Send all floating texts as a batch
          triggerFloatingText(floatingTextBatch)
          updatePlayerScore(actorId!, totalExploits)
        }
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      return
    }
    if (!abilityMode && !cursorStack) {
      activateAbility(card, boardCoords)
    }
  }, [abilityMode, cursorStack, gameState, localPlayerId, interactionLock, handleLineSelection, moveItem, markAbilityUsed, setAbilityMode, setCursorStack, setPlayMode, removeBoardCardStatus, removeBoardCardStatusByOwner, addBoardCardStatus, modifyBoardCardPower, swapCards, transferStatus, transferAllCounters, updatePlayerScore, drawCard, activateAbility, setCounterSelectionData, resetDeployStatus, removeStatusByType, handleActionExecution, setCommandContext, triggerFloatingText])

  const handleEmptyCellClick = useCallback((boardCoords: { row: number, col: number }) => {
    if (interactionLock.current) {
      return
    }
    if (abilityMode?.type !== 'ENTER_MODE') {
      return
    }
    const { mode, sourceCoords, sourceCard, payload, isDeployAbility } = abilityMode

    if (mode === 'SCORE_LAST_PLAYED_LINE' || mode === 'SELECT_LINE_END' || mode === 'SELECT_DIAGONAL') {
      handleLineSelection(boardCoords)
      return
    }

    if (mode === 'SELECT_LINE_START') {
      handleLineSelection(boardCoords); return
    }

    const actorId = sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))

    if (mode === 'PATROL_MOVE' && sourceCoords && sourceCard && sourceCoords.row >= 0) {
      const isRow = boardCoords.row === sourceCoords.row
      const isCol = boardCoords.col === sourceCoords.col
      if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
        // Cancel - mark ability used at current position
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY); return
      }
      if (isRow || isCol) {
        // Mark ability used BEFORE moving (at old position)
        markAbilityUsed(sourceCoords, isDeployAbility)
        moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      }
      return
    }
    if (mode === 'RIOT_MOVE' && sourceCoords && sourceCard && payload.vacatedCoords) {
      if (boardCoords.row === payload.vacatedCoords.row && boardCoords.col === payload.vacatedCoords.col) {
        moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
        markAbilityUsed(boardCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      }
      return
    }
    if (mode === 'SPAWN_TOKEN' && sourceCoords && payload.tokenName && sourceCoords.row >= 0) {
      const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
      if (isAdj) {
        // Token owner is the source card's owner (could be dummy)
        const tokenOwnerId = sourceCard?.ownerId ?? actorId!
        spawnToken(boardCoords, payload.tokenName, tokenOwnerId)
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      }
      return
    }
    if (mode === 'SELECT_CELL' && sourceCard) {
      const currentCardCoords = (() => {
        if (payload.moveFromHand) {
          return null
        }
        // If sourceCoords is provided via ENTER_MODE, trust it first
        if (sourceCoords && sourceCoords.row >= 0) {
          return sourceCoords
        }

        // Fallback: search board
        for (let r = 0; r < gameState.board.length; r++) {
          for (let c = 0; c < gameState.board.length; c++) {
            if (gameState.board[r][c].card?.id === sourceCard.id) {
              return { row: r, col: c }
            }
          }
        }
        return null
      })()

      if (payload.moveFromHand && commandContext.selectedHandCard) {
        const { playerId, cardIndex } = commandContext.selectedHandCard
        const player = gameState.players.find(p => p.id === playerId)
        const handCard = player?.hand[cardIndex]

        if (handCard) {
          moveItem({ card: handCard, source: 'hand', playerId, cardIndex, isManual: true }, { target: 'board', boardCoords })
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }

      let isValidMove = false
      if (currentCardCoords) {
        if (payload.range === 'line') {
          isValidMove = (boardCoords.row === currentCardCoords.row || boardCoords.col === currentCardCoords.col)
        } else if (payload.range === 'global') {
          isValidMove = true
        } else if (payload.range === 2) {
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

              // Bounds check
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
        } else {
          isValidMove = Math.abs(boardCoords.row - currentCardCoords.row) + Math.abs(boardCoords.col - currentCardCoords.col) === 1
        }
      }

      if (isValidMove && currentCardCoords) {
        const isSelfMove = payload.allowSelf && boardCoords.row === currentCardCoords.row && boardCoords.col === currentCardCoords.col
        if (!isSelfMove) {
          const liveCard = gameState.board[currentCardCoords.row][currentCardCoords.col].card
          if (liveCard) {
            moveItem({ card: liveCard, source: 'board', boardCoords: currentCardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords })
          }
        }

        if (abilityMode.recordContext) {
          setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: sourceCard.id })
        }

        if (payload.chainedAction) {
          // Execute Chained Action properly
          const nextAction = { ...payload.chainedAction }
          // Resolve special dynamic target IDs
          if (nextAction.targetOwnerId === -2) {
            nextAction.targetOwnerId = sourceCard.ownerId
          }

          // CRITICAL FIX for Tactical Maneuver:
          // Inject the moved card's ID into the payload of the next action.
          // This allows handleActionExecution to find the card even if the React state hasn't updated the board yet.
          if (abilityMode.recordContext) {
            if (!nextAction.payload) {
              nextAction.payload = {}
            }
            nextAction.payload._tempContextId = sourceCard.id
          }

          // Clear abilityMode BEFORE executing chained action to remove board highlights immediately
          // This ensures the move phase highlights disappear before the Reveal token phase starts
          setAbilityMode(null)
          clearValidTargets()
          // Small delay to allow React to re-render before showing the cursorStack
          setTimeout(() => {
            handleActionExecution(nextAction, boardCoords)
          }, 1)
        } else {
          // CRITICAL FIX: Mark ability used at the NEW location (boardCoords) after move, not the old sourceCoords
          // After moveItem updates gameStateRef.current, the card is at boardCoords, not sourceCoords
          if (payload.abilitySourceCoords) {
            markAbilityUsed(payload.abilitySourceCoords, isDeployAbility)
          } else {
            // For self-move (stay in place), use the current card location
            const markCoords = isSelfMove ? sourceCoords : boardCoords
            if (markCoords && markCoords.row >= 0) {
              if (payload.originalActorId === undefined || sourceCard.ownerId === payload.originalActorId) {
                markAbilityUsed(markCoords, isDeployAbility)
              }
            }
          }
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        }
        return
      }
      return
    }
    if (mode === 'IMMUNIS_RETRIEVE' && sourceCoords && sourceCoords.row >= 0) {
      if (payload.selectedCardIndex !== undefined && payload.filter?.(boardCoords.row, boardCoords.col)) {
        resurrectDiscardedCard(actorId!, payload.selectedCardIndex, boardCoords)
        markAbilityUsed(sourceCoords, isDeployAbility)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return
      }
      if (payload.selectedCardIndex === undefined) {
        return
      }
    }
    if (mode === 'INTEGRATOR_LINE_SELECT' && sourceCoords && sourceCoords.row >= 0) {
      if (boardCoords.row !== sourceCoords.row && boardCoords.col !== sourceCoords.col) {
        return
      }

      const gridSize = gameState.board.length
      let exploits = 0
      if (boardCoords.row === sourceCoords.row) {
        for (let c = 0; c < gridSize; c++) {
          const cell = gameState.board[boardCoords.row][c]
          if (cell.card) {
            exploits += cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
          }
        }
      } else {
        for (let r = 0; r < gridSize; r++) {
          const cell = gameState.board[r][boardCoords.col]
          if (cell.card) {
            exploits += cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
          }
        }
      }

      if (exploits > 0) {
        triggerFloatingText({
          row: sourceCoords.row,
          col: sourceCoords.col,
          text: `+${exploits}`,
          playerId: actorId!,
        })
        updatePlayerScore(actorId!, exploits)
      }
      markAbilityUsed(sourceCoords, isDeployAbility)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return
    }
    if (mode === 'ZIUS_LINE_SELECT' && sourceCoords && sourceCoords.row >= 0) {
      // Same logic as INTEGRATOR_LINE_SELECT, but sourceCoords points to the target card (where Exploit was placed)
      if (boardCoords.row !== sourceCoords.row && boardCoords.col !== sourceCoords.col) {
        return
      }

      const gridSize = gameState.board.length
      let totalExploits = 0
      const floatingTextBatch: Array<{ row: number, col: number, text: string, playerId: number, timestamp: number }> = []

      if (boardCoords.row === sourceCoords.row) {
        // Horizontal line
        for (let c = 0; c < gridSize; c++) {
          const cell = gameState.board[boardCoords.row][c]
          if (cell.card) {
            const cardExploits = cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
            if (cardExploits > 0) {
              totalExploits += cardExploits
              floatingTextBatch.push({
                row: boardCoords.row,
                col: c,
                text: `+${cardExploits}`,
                playerId: actorId!,
                timestamp: Date.now(),
              })
            }
          }
        }
      } else {
        // Vertical line
        for (let r = 0; r < gridSize; r++) {
          const cell = gameState.board[r][boardCoords.col]
          if (cell.card) {
            const cardExploits = cell.card.statuses?.filter(s => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
            if (cardExploits > 0) {
              totalExploits += cardExploits
              floatingTextBatch.push({
                row: r,
                col: boardCoords.col,
                text: `+${cardExploits}`,
                playerId: actorId!,
                timestamp: Date.now(),
              })
            }
          }
        }
      }

      if (totalExploits > 0) {
        // Send all floating texts as a batch
        triggerFloatingText(floatingTextBatch)
        updatePlayerScore(actorId!, totalExploits)
      }
      markAbilityUsed(sourceCoords, isDeployAbility)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return
    }
  }, [interactionLock, abilityMode, gameState, localPlayerId, handleLineSelection, moveItem, markAbilityUsed, setAbilityMode, spawnToken, setCommandContext, resurrectDiscardedCard, updatePlayerScore, commandContext, handleActionExecution, triggerFloatingText, clearValidTargets])

  const handleHandCardClick = useCallback((player: Player, card: Card, cardIndex: number) => {
    logger.debug('[handleHandCardClick] CALLED - player:', player.name, 'card:', card.name, 'cardIndex:', cardIndex, 'cursorStack:', cursorStack?.type)
    if (interactionLock.current) {
      logger.debug('[handleHandCardClick] Blocked by interactionLock')
      return
    }

    // NEW: Handle cursorStack for hand cards (e.g., Revealed tokens from Threat Analyst)
    if (cursorStack && setPlayMode !== null && setPlayMode !== undefined) {
      logger.debug('[handleHandCardClick] Processing cursorStack for hand card:', card.name, 'stack:', cursorStack.type)

      // Check if this card is a valid target for the cursorStack
      const constraints = {
        targetOwnerId: cursorStack.targetOwnerId,
        excludeOwnerId: cursorStack.excludeOwnerId,
        onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
        onlyFaceDown: cursorStack.onlyFaceDown,
        targetType: cursorStack.targetType,
        requiredTargetStatus: cursorStack.requiredTargetStatus,
        tokenType: cursorStack.type,
      }

      const isValid = validateTarget(
        { card, ownerId: player.id, location: 'hand' },
        constraints,
        gameState.activePlayerId,
        gameState.players,
      )

      logger.debug('[handleHandCardClick] Valid target for cursorStack?', isValid)

      if (isValid) {
        // Apply the token/status to the card
        if (cursorStack.type === 'Revealed') {
          // For Revealed, we need to request reveal or add status
          const effectiveActorId = cursorStack.sourceCard?.ownerId ?? gameState.activePlayerId ?? localPlayerId ?? 1
          if (!card.statuses) {
            card.statuses = []
          }
          // Check if already has Revealed from this player
          const hasRevealed = card.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)
          if (!hasRevealed) {
            card.statuses.push({ type: 'Revealed', addedByPlayerId: effectiveActorId })
            // Update state via moveItem to properly sync
            moveItem({
              card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
              source: 'counter_panel',
              statusType: 'Revealed',
              count: 1,
            }, { target: 'hand', playerId: player.id, cardIndex })

            if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
              markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
            }
            if (cursorStack.count > 1) {
              setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
            } else {
              if (cursorStack.chainedAction) {
                handleActionExecution(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
              }
              setCursorStack(null)
            }
          }
        }
      }
      return
    }

    // Add visual selection effect when card is clicked during selection mode
    if (abilityMode?.type === 'ENTER_MODE' && abilityMode.mode === 'SELECT_TARGET') {
      const { payload, sourceCoords, isDeployAbility, sourceCard } = abilityMode

      // Trigger hand card selection effect visible to all players via WebSocket (before any filtering)
      triggerHandCardSelection(player.id, cardIndex, gameState.activePlayerId ?? localPlayerId ?? 1)

      // SELECT_HAND_FOR_DEPLOY (Quick Response Team)
      if (payload.actionType === 'SELECT_HAND_FOR_DEPLOY') {
        if (payload.filter && !payload.filter(card)) {
          return
        }

        setCommandContext(prev => ({ ...prev, selectedHandCard: { playerId: player.id, cardIndex } }))

        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SELECT_CELL',
          sourceCard: card,
          payload: { range: 'global', moveFromHand: true },
        })
        return
      }

      // SELECT_HAND_FOR_DISCARD_THEN_SPAWN (Faber)
      if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN') {
        if (player.id !== sourceCard?.ownerId) {
          return
        } // Only discard own cards

        // 1. Discard the selected card
        moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

        // 2. Chain to SPAWN_TOKEN mode
        setAbilityMode({
          type: 'ENTER_MODE',
          mode: 'SPAWN_TOKEN',
          sourceCard: abilityMode.sourceCard,
          sourceCoords: abilityMode.sourceCoords,
          isDeployAbility: abilityMode.isDeployAbility,
          payload: { tokenName: payload.tokenName },
        })
        return
      }

      // LUCIUS SETUP: Discard 1 -> Search Command
      if (payload.actionType === 'LUCIUS_SETUP') {
        if (player.id !== sourceCard?.ownerId) {
          return
        } // Only discard own cards

        // 1. Discard the selected card
        moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

        // 2. Open Search Modal via Execution
        const openModalAction: AbilityAction = {
          type: 'OPEN_MODAL',
          mode: 'SEARCH_DECK',
          sourceCard: abilityMode.sourceCard,
          sourceCoords: abilityMode.sourceCoords, // This ensures ability gets marked used when modal closes
          isDeployAbility: abilityMode.isDeployAbility,
          payload: { filterType: 'Command' },
        }

        handleActionExecution(openModalAction, abilityMode.sourceCoords || { row: -1, col: -1 })
        setAbilityMode(null)
        return
      }

      // DESTROY Hand Card
      if (payload.actionType === 'DESTROY') {
        if (payload.filter && !payload.filter(card)) {
          return
        }
        moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })
        if (sourceCoords && sourceCoords.row >= 0) {
          markAbilityUsed(sourceCoords, isDeployAbility)
        }
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      }
    }
  }, [interactionLock, abilityMode, moveItem, markAbilityUsed, setAbilityMode, setCommandContext, handleActionExecution, gameState, localPlayerId, triggerHandCardSelection, cursorStack, setCursorStack, setPlayMode])

  const handleAnnouncedCardDoubleClick = useCallback((player: Player, card: Card) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    if (!gameState.isGameStarted) {
      return
    }
    if (gameState.activePlayerId !== player.id) {
      return
    }
    if (!canActivateAbility(card, gameState.currentPhase, gameState.activePlayerId, gameState)) {
      return
    }
    activateAbility(card, { row: -1, col: -1 })
  }, [abilityMode, cursorStack, interactionLock, gameState, activateAbility])

  return {
    activateAbility,
    executeAction: handleActionExecution,
    handleLineSelection,
    handleBoardCardClick,
    handleEmptyCellClick,
    handleHandCardClick,
    handleAnnouncedCardDoubleClick,
  }
}
