import { useCallback, useEffect, useRef } from 'react'
import type { Card, GameState, AbilityAction, CommandContext, DragItem, Player, CounterSelectionData, CursorStackState, FloatingTextData } from '@/types'
import { validateTarget } from '@shared/utils/targeting'
import { TIMING } from '@/utils/common'
import { logger } from '@/utils/logger'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'

// Import extracted handler modules
import {
  activateAbility as activateAbilityModule,
  handleLineSelection as handleLineSelectionModule,
  handleHandCardClick,
  handleAnnouncedCardDoubleClick,
  handleActionExecution as handleActionExecutionModule,
  handleModeCardClick as handleModeCardClickModule,
  handleEmptyCellClick as handleEmptyCellClickModule,
} from './abilities/index.js'

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
    triggerNoTarget: (coords: { row: number; col: number }) => void;
    triggerTargetSelection: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
    playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null;
    setPlayMode: React.Dispatch<React.SetStateAction<any>>;
    setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>;
    interactionLock: React.MutableRefObject<boolean>;
    onAbilityComplete?: () => void;

    // Actions from useGameState
    updateState: (stateOrFn: GameState | ((prevState: GameState) => GameState)) => void;
    moveItem: (item: DragItem, target: any) => void;
    drawCard: (playerId: number) => void;
    drawCardsBatch: (playerId: number, count: number) => void;
    updatePlayerScore: (playerId: number, delta: number) => void;
    markAbilityUsed: (coords: { row: number, col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void;
    applyGlobalEffect: (source: any, targets: any[], type: string, pid: number, isDeploy: boolean) => void;
    swapCards: (c1: any, c2: any) => void;
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
    resetDeployStatus: (coords: { row: number; col: number }) => void;
    scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void;
    removeStatusByType: (coords: { row: number; col: number }, type: string) => void;
    triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void;
    triggerHandCardSelection: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void;
    clearValidTargets: () => void;
    setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext) => void;
    clearTargetingMode: () => void;
    validTargets?: {row: number, col: number}[];
}

/**
 * Main hook for handling card abilities
 *
 * This hook provides functions for:
 * - Activating abilities on cards
 * - Executing ability actions
 * - Handling clicks on board cards, empty cells, and hand cards
 * - Managing line selection for scoring abilities
 */
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
  triggerTargetSelection,
  playMode,
  setPlayMode,
  setCounterSelectionData,
  interactionLock,
  onAbilityComplete,
  updateState,
  moveItem,
  drawCard,
  drawCardsBatch,
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
  setTargetingMode,
  clearTargetingMode,
  validTargets,
}: UseAppAbilitiesProps) => {

  // Store handleLineSelection ref to avoid circular dependency
  const lineSelectionRef = useRef<(coords: { row: number; col: number }) => void>(() => {})

  /**
   * Handle line selection for scoring abilities
   * Defined BEFORE handleActionExecution to avoid circular dependency
   */
  const handleLineSelection = useCallback((coords: { row: number; col: number }) => {
    handleLineSelectionModule(coords, {
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
    })
  }, [abilityMode, gameState, localPlayerId, interactionLock, setAbilityMode, markAbilityUsed, updatePlayerScore, triggerFloatingText, nextPhase, modifyBoardCardPower, scoreLine, scoreDiagonal, commandContext])

  // Update ref whenever handleLineSelection changes
  lineSelectionRef.current = handleLineSelection

  /**
   * Execute ability actions using modular handler
   */
  const handleActionExecution = useCallback((action: AbilityAction, sourceCoords: { row: number, col: number }) => {
    handleActionExecutionModule(action, sourceCoords, {
      gameState,
      localPlayerId,
      abilityMode,
      setAbilityMode,
      cursorStack,
      setCursorStack,
      commandContext,
      setCommandContext,
      playMode: null,
      setPlayMode,
      draggedItem: null,
      setDraggedItem: () => {},
      openContextMenu: () => {},
      markAbilityUsed,
      triggerNoTarget,
      triggerTargetSelection,
      handleActionExecution,
      interactionLock,
      moveItem,
      swapCards,
      transferStatus,
      transferAllCounters,
      spawnToken,
      modifyBoardCardPower,
      addBoardCardStatus,
      removeBoardCardStatus,
      removeBoardCardStatusByOwner,
      removeStatusByType,
      resetDeployStatus,
      updatePlayerScore,
      triggerFloatingText,
      setCounterSelectionData,
      setViewingDiscard,
      validTargets,
      handleLineSelection: lineSelectionRef.current,
      onAbilityComplete,
      applyGlobalEffect,
      drawCardsBatch,
      setTargetingMode,
    })
  }, [
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    setCursorStack,
    commandContext,
    setCommandContext,
    setPlayMode,
    markAbilityUsed,
    triggerNoTarget,
    // Note: handleActionExecution is intentionally excluded from deps to avoid circular dependency
    // It's stable due to useCallback and will have the correct reference when called recursively
    interactionLock,
    moveItem,
    swapCards,
    transferStatus,
    transferAllCounters,
    spawnToken,
    modifyBoardCardPower,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    removeStatusByType,
    resetDeployStatus,
    updatePlayerScore,
    triggerFloatingText,
    setCounterSelectionData,
    setViewingDiscard,
    validTargets,
    // handleLineSelection intentionally excluded - defined after this callback
    onAbilityComplete,
    applyGlobalEffect,
    drawCardsBatch,
    setTargetingMode,
  ])

  // Auto-Execute GLOBAL_AUTO_APPLY actions when they appear in abilityMode
  useEffect(() => {
    if (abilityMode?.type === 'GLOBAL_AUTO_APPLY') {
      handleActionExecution(abilityMode, abilityMode.sourceCoords || { row: -1, col: -1 })
      setAbilityMode(null)
    }
  }, [abilityMode, handleActionExecution, setAbilityMode])

  // Sync targeting mode with abilityMode for P2P visual effects
  // When abilityMode is cleared, also clear targetingMode
  useEffect(() => {
    if (!abilityMode) {
      clearTargetingMode()
    }
  }, [abilityMode, clearTargetingMode])

  /**
   * Activate a card's ability
   */
  const activateAbility = useCallback((card: Card, boardCoords: { row: number, col: number }) => {
    activateAbilityModule(card, boardCoords, {
      gameState,
      localPlayerId,
      abilityMode,
      cursorStack,
      handleActionExecution,
      markAbilityUsed,
    })
  }, [gameState, localPlayerId, abilityMode, cursorStack, handleActionExecution, markAbilityUsed])
  /**
   * Handle click on board card
   */
  const handleBoardCardClick = useCallback((card: Card, boardCoords: { row: number; col: number }) => {
    // 1. Handle cursorStack (token placement from Aim, Revealed, etc.)
    if (cursorStack && setPlayMode !== null && setPlayMode !== undefined) {
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
        { card, ownerId: card.ownerId ?? 0, location: 'board' },
        constraints,
        gameState.activePlayerId,
        gameState.players,
      )

      if (isValid) {
        // Handle Revealed token with duplicate check
        if (cursorStack.type === 'Revealed') {
          const effectiveActorId = cursorStack.sourceCard?.ownerId ?? gameState.activePlayerId ?? localPlayerId ?? 1
          const hasRevealed = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)

          if (hasRevealed) {
            // Already has Revealed from this player, silently ignore
            return
          }
        }

        // Place the token/status on the card
        moveItem({
          card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
          source: 'counter_panel',
          statusType: cursorStack.type,
          count: 1,
        }, { target: 'board', boardCoords })

        if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
          markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility, false, cursorStack.readyStatusToRemove)
        }

        if (cursorStack.count > 1) {
          setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
        } else {
          // Clear targeting mode and valid targets when last token is placed
          clearTargetingMode()
          clearValidTargets()
          if (cursorStack.chainedAction) {
            handleActionExecution(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
          }
          setCursorStack(null)
        }
      }
      return
    }

    if (interactionLock.current) {
      return
    }

    // 2. Activate ability on click if card has ready ability and no mode is active
    if (!abilityMode && !cursorStack && gameState.isGameStarted) {
      const canActivate = hasReadyAbilityInCurrentPhase(card, gameState)
      if (canActivate) {
        activateAbility(card, boardCoords)
        return
      }
    }

    // 3. Handle line selection modes
    if (abilityMode && (abilityMode.mode === 'SCORE_LAST_PLAYED_LINE' || abilityMode.mode === 'SELECT_LINE_END')) {
      handleLineSelection(boardCoords)
      return
    }

    // 4. Handle ability modes with modular handler
    if (abilityMode?.type === 'ENTER_MODE') {
      const handled = handleModeCardClickModule(card, boardCoords, {
        gameState,
        localPlayerId,
        abilityMode,
        setAbilityMode,
        cursorStack,
        setCursorStack,
        commandContext,
        setCommandContext,
        playMode: null,
        setPlayMode,
        draggedItem: null,
        setDraggedItem: () => {},
        openContextMenu: () => {},
        markAbilityUsed,
        triggerNoTarget,
        triggerTargetSelection,
        handleActionExecution,
        interactionLock,
        moveItem,
        swapCards,
        transferStatus,
        transferAllCounters,
        spawnToken,
        modifyBoardCardPower,
        addBoardCardStatus,
        removeBoardCardStatus,
        removeBoardCardStatusByOwner,
        removeStatusByType,
        resetDeployStatus,
        updatePlayerScore,
        triggerFloatingText,
        setCounterSelectionData,
        setViewingDiscard,
        clearValidTargets,
        validTargets,
        handleLineSelection,
      })
      if (handled) return
    }

    // 5. Default: activate ability if no mode
    if (!abilityMode && !cursorStack) {
      activateAbility(card, boardCoords)
    }
  }, [
    cursorStack,
    setPlayMode,
    gameState,
    localPlayerId,
    interactionLock,
    abilityMode,
    handleLineSelection,
    moveItem,
    markAbilityUsed,
    setCursorStack,
    handleActionExecution,
    setAbilityMode,
    setCommandContext,
    setCounterSelectionData,
    setViewingDiscard,
    spawnToken,
    swapCards,
    transferStatus,
    transferAllCounters,
    modifyBoardCardPower,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    removeStatusByType,
    resetDeployStatus,
    updatePlayerScore,
    triggerFloatingText,
    triggerNoTarget,
    triggerTargetSelection,
    validTargets,
    clearTargetingMode,
    activateAbility,
  ])

  /**
   * Handle click on empty cell
   */
  const handleEmptyCellClick = useCallback((boardCoords: { row: number; col: number }) => {
    // Use modular handler
    const handled = handleEmptyCellClickModule(boardCoords, {
      gameState,
      localPlayerId,
      abilityMode,
      setAbilityMode,
      cursorStack,
      commandContext,
      setCommandContext,
      playMode,
      draggedItem: null,
      interactionLock,
      handleActionExecution,
      handleDrop: moveItem,
      moveItem,
      setCursorStack,
      triggerNoTarget,
      markAbilityUsed,
      spawnToken,
      resurrectDiscardedCard,
      updatePlayerScore,
      triggerFloatingText,
      handleLineSelection,
      openContextMenu: () => {},
      triggerDeckSelection: () => {},
    })

    // All empty cell handling is now done in the modular handler
  }, [
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    commandContext,
    setCommandContext,
    playMode,
    interactionLock,
    handleActionExecution,
    moveItem,
    setCursorStack,
    triggerNoTarget,
    markAbilityUsed,
    spawnToken,
    resurrectDiscardedCard,
    updatePlayerScore,
    triggerFloatingText,
    handleLineSelection,
  ])

  /**
   * Handle click on hand card
   */
  const handleHandCardClickCallback = useCallback((player: Player, card: Card, cardIndex: number) => {
    handleHandCardClick(player, card, cardIndex, {
      gameState,
      localPlayerId,
      abilityMode,
      cursorStack,
      interactionLock,
      setCommandContext,
      setAbilityMode,
      moveItem,
      markAbilityUsed,
      handleActionExecution,
      triggerHandCardSelection,
      setCursorStack,
      clearTargetingMode,
      clearValidTargets,
      activateAbility: (c, coords) => activateAbilityModule(c, coords, {
        gameState,
        localPlayerId,
        abilityMode,
        cursorStack,
        handleActionExecution,
        markAbilityUsed,
      }),
    })
  }, [abilityMode, cursorStack, gameState, localPlayerId, handleActionExecution, markAbilityUsed, setAbilityMode, setCommandContext, triggerHandCardSelection, moveItem, setCursorStack, clearTargetingMode, clearValidTargets, interactionLock])

  /**
   * Handle double click on announced card
   */
  const handleAnnouncedCardDoubleClickCallback = useCallback((player: Player, card: Card) => {
    handleAnnouncedCardDoubleClick(player, card, {
      abilityMode,
      cursorStack,
      gameState,
      activateAbility: (c, coords) => activateAbilityModule(c, coords, {
        gameState,
        localPlayerId,
        abilityMode,
        cursorStack,
        handleActionExecution,
        markAbilityUsed,
      }),
    })
  }, [abilityMode, cursorStack, gameState, localPlayerId, handleActionExecution, markAbilityUsed])

  return {
    activateAbility,
    executeAction: handleActionExecution,
    handleLineSelection,
    handleBoardCardClick,
    handleEmptyCellClick,
    handleHandCardClick: handleHandCardClickCallback,
    handleAnnouncedCardDoubleClick: handleAnnouncedCardDoubleClickCallback,
  }
}
