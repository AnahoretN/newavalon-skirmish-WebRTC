import { useCallback } from 'react'
import type { Card, GameState, AbilityAction, CommandContext, DragItem, CounterSelectionData } from '@/types'
import { getCommandAction } from '@server/utils/commandLogic'
import { deepCloneState } from '@/utils/common'
import { recalculateBoardStatuses } from '@shared/utils/boardUtils'

interface UseAppCommandProps {
    gameState: GameState;
    localPlayerId: number | null;
    setActionQueue: React.Dispatch<React.SetStateAction<AbilityAction[]>>;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    setCommandModalCard: React.Dispatch<React.SetStateAction<Card | null>>;
    setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>;
    moveItem: (item: DragItem, target: any) => void;
    drawCard: (playerId: number) => void;
    drawCardsBatch: (playerId: number, count: number) => void;
    updatePlayerScore: (playerId: number, delta: number) => void;
    updateState: (stateOrFn: GameState | ((prevState: GameState) => GameState)) => void;
    removeBoardCardStatus: (coords: any, status: string) => void;
}

export const useAppCommand = ({
  gameState,
  localPlayerId,
  setActionQueue,
  setCommandContext,
  setCommandModalCard,
  setCounterSelectionData,
  moveItem,
  // drawCard,
  // drawCardsBatch,
  updatePlayerScore,
  updateState,
  // removeBoardCardStatus,
}: UseAppCommandProps) => {

  const playCommandCard = useCallback((card: Card, source: DragItem) => {
    if (localPlayerId === null) {
      return
    }
    const owner = gameState.players.find(p => p.id === source.playerId)
    const canControl = source.playerId === localPlayerId || (owner?.isDummy)

    if (!canControl) {
      return
    }

    // 1. Move to Showcase (Announced)
    moveItem(source, { target: 'announced', playerId: source.playerId! })

    // Reset context
    setCommandContext({})

    const baseId = (card.baseId || card.id.split('_')[1] || card.id).toLowerCase()
    const complexCommands = [
      'overwatch',
      'tacticalmaneuver',
      'repositioning',
      'inspiration',
      'datainterception',
      'falseorders',
      'experimentalstimulants',
      'logisticschain',
      'quickresponseteam',
      'temporaryshelter',
      'enhancedinterrogation',
    ]

    // 2. Check type
    // If it's one of the complex commands, ALWAYS open the modal.
    if (complexCommands.some(id => baseId.includes(id))) {
      setCommandModalCard(card)
    } else {
      // Simple Command (e.g. Mobilization)
      // Just execute Main Logic
      const actions = getCommandAction(card.id, -1, card, gameState, source.playerId!)

      // Queue actions + Cleanup
      if (actions.length > 0) {
        // If the first action has targets, queue it. If not, maybe skip?
        // For safety, we queue it and let the processor handle "No Target".
        setActionQueue([
          ...actions,
          { type: 'GLOBAL_AUTO_APPLY', payload: { cleanupCommand: true, card: card, ownerId: source.playerId! }, sourceCard: card },
        ])
      } else {
        // No actions defined (unlikely if in DB), just cleanup
        setActionQueue([
          { type: 'GLOBAL_AUTO_APPLY', payload: { cleanupCommand: true, card: card, ownerId: source.playerId! }, sourceCard: card },
        ])
      }
    }
  }, [gameState, localPlayerId, moveItem, setActionQueue, setCommandContext, setCommandModalCard])

  const handleCommandConfirm = useCallback((optionIndex: number, commandModalCard: Card) => {
    if (!commandModalCard || localPlayerId === null) {
      return
    }

    const ownerId = commandModalCard.ownerId || localPlayerId
    const queue: AbilityAction[] = []

    // 1. Get ALL actions for this choice (actions may include main parts and selected option parts)
    // We call -1 (main) and then the option index.
    const mainActions = getCommandAction(commandModalCard.id, -1, commandModalCard, gameState, ownerId)

    let rewardType: 'DRAW_REMOVED' | 'SCORE_REMOVED' | undefined

    // Special Case: Inspiration (Main Action opens Counter Modal)
    if (commandModalCard.baseId?.toLowerCase().includes('inspiration')) {
      rewardType = optionIndex === 0 ? 'DRAW_REMOVED' : 'SCORE_REMOVED'
      if (mainActions.length > 0 && mainActions[0].type === 'ENTER_MODE') {
        // Pass the reward type to the next step (immutable update)
        mainActions[0] = {
          ...mainActions[0],
          payload: { ...mainActions[0].payload, rewardType }
        }
      }
    }

    // Add main actions to queue if they have targets
    mainActions.forEach(action => {
      // Basic target check validation could happen here, but queue processor handles it.
      // Special case: self-buffs or global applies always valid.
      queue.push(action)
    })

    // 2. Option Actions
    const optActions = getCommandAction(commandModalCard.id, optionIndex, commandModalCard, gameState, ownerId)
    optActions.forEach(action => {
      queue.push(action)
    })

    // 3. Cleanup (Discard Card) - Inspiration handles this after modal
    if (!commandModalCard.baseId?.toLowerCase().includes('inspiration')) {
      queue.push({
        type: 'GLOBAL_AUTO_APPLY',
        payload: { cleanupCommand: true, card: commandModalCard, ownerId },
        sourceCard: commandModalCard,
      })
    }

    setActionQueue(queue)
    setCommandModalCard(null)
  }, [gameState, localPlayerId, setActionQueue, setCommandModalCard])

  const handleCounterSelectionConfirm = useCallback((countsToRemove: Record<string, number>, data: CounterSelectionData) => {
    if (localPlayerId === null) {
      return
    }
    const ownerId = data.card.ownerId || localPlayerId

    // 1. Identify Board Coords of the card
    let boardCoords: { row: number, col: number } | null = null
    for (let r = 0; r < gameState.board.length; r++) {
      for (let c = 0; c < gameState.board[r].length; c++) {
        if (gameState.board[r][c].card?.id === data.card.id) {
          boardCoords = { row: r, col: c }
          break
        }
      }
      if (boardCoords) {
        break
      }
    }

    // If card was not found on board, log and cleanup only
    if (!boardCoords) {
      console.warn(`Card ${data.card.id} not found on board during counter removal`)
      setCounterSelectionData(null)
      return
    }

    // 2. Batch update: Remove counters AND apply reward in a single state update
    // This prevents race conditions with server sync
    updateState((currentState) => {
      if (!currentState.isGameStarted) {
        return currentState
      }
      const newState: GameState = deepCloneState(currentState)
      const card = newState.board[boardCoords.row][boardCoords.col].card

      // Calculate total removed and remove counters
      let totalRemoved = 0
      const cardStatuses = card?.statuses ?? []
      Object.entries(countsToRemove).forEach(([type, count]) => {
        for (let i = 0; i < count; i++) {
          const lastIndex = cardStatuses.map(s => s.type).lastIndexOf(type)
          if (lastIndex > -1 && card?.statuses) {
            card.statuses.splice(lastIndex, 1)
            totalRemoved++
          }
        }
      })
      if (!card?.statuses && card) {
        // Initialize statuses array if it doesn't exist
        card.statuses = []
      }

      // Recalculate board statuses after removing counters
      newState.board = recalculateBoardStatuses(newState)

      // Apply reward: Draw cards from deck
      if (totalRemoved > 0 && data.callbackAction === 'DRAW_REMOVED') {
        const playerToUpdate = newState.players.find((p: any) => p.id === ownerId)
        if (playerToUpdate) {
          const cardsToDraw = Math.min(totalRemoved, playerToUpdate.deck.length)
          for (let i = 0; i < cardsToDraw; i++) {
            const cardDrawn = playerToUpdate.deck.shift()
            if (cardDrawn) {
              playerToUpdate.hand.push(cardDrawn)
            }
          }
        }
      }

      return newState
    })

    // Apply score reward separately (it's not in gameState.board, so can be done separately)
    if (data.callbackAction === 'SCORE_REMOVED') {
      const totalRemoved = Object.values(countsToRemove).reduce((sum, count) => sum + count, 0)
      if (totalRemoved > 0) {
        updatePlayerScore(ownerId, totalRemoved)
      }
    }

    // Cleanup Command (Inspiration)
    const player = gameState.players.find(p => p.id === ownerId)
    if (player?.announcedCard) {
      setActionQueue([{
        type: 'GLOBAL_AUTO_APPLY',
        payload: { cleanupCommand: true, card: player.announcedCard, ownerId },
        sourceCard: player.announcedCard,
      }])
    }

    setCounterSelectionData(null)
  }, [localPlayerId, updatePlayerScore, setActionQueue, setCounterSelectionData, gameState, updateState])

  return {
    playCommandCard,
    handleCommandConfirm,
    handleCounterSelectionConfirm,
  }
}
