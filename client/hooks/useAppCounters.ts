import { useRef, useEffect, useLayoutEffect } from 'react'
import type { CursorStackState, GameState, AbilityAction, DragItem, DropTarget, CommandContext } from '@/types'
import { validateTarget } from '@shared/utils/targeting'
import { createTokenCursorStack, getTokenTargetingRules } from '@/utils/tokenTargeting'

interface UseAppCountersProps {
    gameState: GameState;
    localPlayerId: number | null;
    handleDrop: (item: DragItem, target: DropTarget) => void;
    markAbilityUsed: (coords: { row: number, col: number }, isDeployAbility?: boolean, setDeployAttempted?: boolean) => void;
    requestCardReveal: (data: any, playerId: number) => void;
    interactionLock: React.MutableRefObject<boolean>;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    onAction: (action: AbilityAction, sourceCoords: { row: number, col: number }) => void;
    cursorStack: CursorStackState | null;
    setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>;
    setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>;
    triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => void;
  clearTargetingMode: () => void;
}

export const useAppCounters = ({
  gameState,
  localPlayerId,
  handleDrop,
  markAbilityUsed,
  requestCardReveal,
  interactionLock,
  setCommandContext,
  onAction,
  cursorStack,
  setCursorStack,
  setAbilityMode,
  triggerClickWave,
  clearTargetingMode,
}: UseAppCountersProps) => {
  const cursorFollowerRef = useRef<HTMLDivElement>(null)
  const mousePos = useRef({ x: 0, y: 0 })

  // Initial positioning layout effect
  useLayoutEffect(() => {
    if (cursorStack && cursorFollowerRef.current) {
      const { x, y } = mousePos.current
      // Center the 48x48 (w-12 h-12) element on the cursor
      cursorFollowerRef.current.style.transform = `translate(${x - 24}px, ${y - 24}px)`
    }
  }, [cursorStack])

  // Mouse movement tracking for custom cursor
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
      if (cursorFollowerRef.current) {
        // Center the 48x48 (w-12 h-12) element on the cursor
        cursorFollowerRef.current.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Handle dropping counters (global mouse up)
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) {
        return
      } // Prevent action on right-click
      if (!cursorStack) {
        return
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)

      // Determine who is performing the action (Effective Actor)
      let effectiveActorId = localPlayerId
      // First, try to get actor from originalOwnerId (preserves command card ownership)
      if (cursorStack.originalOwnerId !== undefined) {
        effectiveActorId = cursorStack.originalOwnerId
      } else if (cursorStack.sourceCard?.ownerId) {
        effectiveActorId = cursorStack.sourceCard.ownerId
      } else if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
        const { row, col } = cursorStack.sourceCoords
        // Validate bounds before accessing board
        if (
          row >= 0 &&
          row < gameState.board.length &&
          col >= 0 &&
          col < gameState.board[row]?.length
        ) {
          const sourceCard = gameState.board[row][col].card
          if (sourceCard) {
            effectiveActorId = sourceCard.ownerId || localPlayerId
          }
        }
      } else if (gameState.activePlayerId) {
        const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
        if (activePlayer?.isDummy) {
          effectiveActorId = activePlayer.id
        }
      }

      // Check if target itself has data-hand-card attribute OR if it's a parent of an element with data-hand-card
      let handCard = target?.closest('[data-hand-card]')

      // If closest didn't find it, the target might be a parent container wrapping elements with data-hand-card
      // We need to find which hand card element is actually under the cursor
      if (!handCard && target) {
        // Check if the target itself or any of its descendants has data-hand-card attribute
        // First check target itself
        if (target.getAttribute('data-hand-card')) {
          handCard = target as HTMLElement
        } else {
          // Check all descendants of target (not just first-level children)
          const allWithAttr = target.querySelectorAll('[data-hand-card]')
          if (allWithAttr.length > 0) {
            // Find the closest one to the cursor position by checking bounding boxes
            let closestDist = Infinity
            let closestElem: HTMLElement | null = null
            const cursorX = e.clientX
            const cursorY = e.clientY

            for (const elem of Array.from(allWithAttr) as HTMLElement[]) {
              const rect = elem.getBoundingClientRect()
              // Check if cursor is inside the element's bounding box
              if (cursorX >= rect.left && cursorX <= rect.right && cursorY >= rect.top && cursorY <= rect.bottom) {
                // Calculate distance to center of element
                const centerX = rect.left + rect.width / 2
                const centerY = rect.top + rect.height / 2
                const dist = Math.hypot(cursorX - centerX, cursorY - centerY)
                if (dist < closestDist) {
                  closestDist = dist
                  closestElem = elem
                }
              }
            }
            handCard = closestElem
          }
        }
      }

      if (handCard) {
        const attr = handCard.getAttribute('data-hand-card')
        if (attr) {
          const [playerIdStr, cardIndexStr] = attr.split(',')
          const playerId = parseInt(playerIdStr, 10)
          const cardIndex = parseInt(cardIndexStr, 10)
          const targetPlayer = gameState.players.find(p => p.id === playerId)
          const targetCard = targetPlayer?.hand[cardIndex]

          if (targetPlayer && targetCard) {
            // Special handling for Revealed tokens on ANY hand cards (not just opponents)
            // Revealed can be placed on any player's hand cards as long as they don't already have your Revealed
            const isRevealedToken = cursorStack.type === 'Revealed' && !targetPlayer.isDummy

            if (isRevealedToken) {
              // Check if card already has Revealed from this player (unique constraint)
              const alreadyHasRevealed = targetCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)
              if (alreadyHasRevealed) {
                // Card already revealed to this player - keep cursor stack active
                return
              }

              // CRITICAL: Clear targeting mode BEFORE handleDrop to ensure
              // the state update doesn't include the stale targetingMode
              // This fixes the issue where other players see persistent targeting highlights
              if (cursorStack.count === 1) {
                if (cursorStack.chainedAction) {
                  onAction(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
                }
                clearTargetingMode()
              }

              // Allow placing Revealed token on any player's hand card
              handleDrop({
                card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
                source: 'counter_panel',
                ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId ?? effectiveActorId ?? undefined,
                statusType: cursorStack.type,
                count: 1,
              }, { target: 'hand', playerId, cardIndex, boardCoords: undefined })
              if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
                markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
              }
              if (cursorStack.count > 1) {
                setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
              } else {
                setCursorStack(null)
              }
              interactionLock.current = true
              setTimeout(() => {
                interactionLock.current = false
              }, 300)
              return
            }

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
              { card: targetCard, ownerId: playerId, location: 'hand' },
              constraints,
              effectiveActorId,
              gameState.players,
            )

            if (!isValid) {
              // Invalid target - keep cursor stack active to allow retry
              // Don't close selection mode on invalid target
              return
            }

            // NOTE: Previous 'Request Reveal' check removed to allow immediate token drop.
            // Dropping the token via handleDrop will add the status, revealing the card.

            if (cursorStack.count === 1) {
              // CRITICAL: Clear targeting mode BEFORE handleDrop to ensure
              // the state update doesn't include the stale targetingMode
              // This fixes the issue where other players see persistent targeting highlights
              if (cursorStack.chainedAction) {
                onAction(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
              }
              clearTargetingMode()
            }

            handleDrop({
              card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
              source: 'counter_panel',
              ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId, // Use originalOwnerId (command card owner) for status ownership
              statusType: cursorStack.type,
              replaceStatusType: cursorStack.replaceStatus ? cursorStack.requiredTargetStatus : undefined, // For status replacement
              count: 1,
            }, { target: 'hand', playerId, cardIndex, boardCoords: undefined })
            if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
              markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
            }
            if (cursorStack.count > 1) {
              setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
            } else {
              setCursorStack(null)
            }
            interactionLock.current = true
            setTimeout(() => {
              interactionLock.current = false
            }, 300)
            return
          }
        }
      }

      if (!handCard) {
        // Not a hand card - check if it's a board cell
        const boardCell = target?.closest('[data-board-coords]')
        if (boardCell) {
          const coords = boardCell.getAttribute('data-board-coords')
          if (coords) {
            const [rowStr, colStr] = coords.split(',')
            const row = parseInt(rowStr, 10)
            const col = parseInt(colStr, 10)
            // Add bounds check before accessing board
            if (
              !isNaN(row) && !isNaN(col) &&
              row >= 0 && row < gameState.board.length &&
              gameState.board[row] &&
              col >= 0 && col < gameState.board[row].length &&
              gameState.board[row][col]
            ) {
              const targetCard = gameState.board[row][col].card

              if (targetCard?.ownerId !== undefined) {
                const constraints = {
                  targetOwnerId: cursorStack.targetOwnerId,
                  excludeOwnerId: cursorStack.excludeOwnerId,
                  onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
                  onlyFaceDown: cursorStack.onlyFaceDown,
                  targetType: cursorStack.targetType,
                  requiredTargetStatus: cursorStack.requiredTargetStatus,
                  mustBeAdjacentToSource: cursorStack.mustBeAdjacentToSource,
                  mustBeInLineWithSource: cursorStack.mustBeInLineWithSource,
                  sourceCoords: cursorStack.sourceCoords,
                  tokenType: cursorStack.type,
                }

                const isValid = validateTarget(
                  { card: targetCard, ownerId: targetCard.ownerId, location: 'board', boardCoords: { row, col } },
                  constraints,
                  effectiveActorId,
                  gameState.players,
                )
                if (!isValid) {
                  // Invalid target - keep cursor stack active to allow retry
                  // Don't close selection mode on invalid target
                  return
                }

                const targetPlayer = gameState.players.find(p => p.id === targetCard.ownerId)

                // For Revealed tokens on opponent's face-down board cards:
                // Skip the old requestCardReveal system - use unified handleDrop instead
                // The status will be added and card will be revealed to token owner
              }

              if (targetCard) {
                const amountToDrop = cursorStack.placeAllAtOnce ? cursorStack.count : 1

                handleDrop({
                  card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
                  source: 'counter_panel',
                  ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId, // Use originalOwnerId (command card owner) for status ownership
                  statusType: cursorStack.type,
                  replaceStatusType: cursorStack.replaceStatus ? cursorStack.requiredTargetStatus : undefined, // For Censor: Exploit -> Stun
                  count: amountToDrop,
                }, { target: 'board', boardCoords: { row, col } })
                // Trigger target selection effect
                triggerClickWave('board', { row, col })

                if (cursorStack.recordContext) {
                  setCommandContext(prev => ({
                    ...prev,
                    lastMovedCardCoords: { row, col },
                    lastMovedCardId: targetCard.id,
                  }))
                }

                if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
                  markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
                }
                // Calculate remaining count AFTER this drop
                const remainingCount = cursorStack.count - amountToDrop

                if (remainingCount > 0) {
                  setCursorStack(prev => prev ? ({ ...prev, count: remainingCount }) : null)
                } else {
                  // Stack is now empty - clear it and execute chained action
                  if (cursorStack.chainedAction) {
                    const chained = { ...cursorStack.chainedAction }
                    if (cursorStack.recordContext) {
                      if (chained.mode === 'SELECT_CELL') {
                        chained.sourceCard = targetCard
                        chained.sourceCoords = { row, col }
                        chained.recordContext = true
                      }
                      // For GLOBAL_AUTO_APPLY (e.g., False Orders Stun), update sourceCoords to moved card location
                      if (chained.type === 'GLOBAL_AUTO_APPLY') {
                        chained.sourceCoords = { row, col }
                      }
                      // For CREATE_STACK (e.g., False Orders Reveal), update sourceCoords but NOT sourceCard
                      // The sourceCard should remain the command card (False Orders), not the moved card
                      if (chained.type === 'CREATE_STACK') {
                        chained.sourceCoords = { row, col }
                        // Only update sourceCard if originalOwnerId is not set (preserve command card ownership)
                        if (!chained.originalOwnerId) {
                          chained.sourceCard = targetCard
                        }
                      }
                      // ZIUS_LINE_SELECT: use target card coords as anchor point (where Exploit was placed)
                      if (chained.mode === 'ZIUS_LINE_SELECT') {
                        chained.sourceCoords = { row, col }
                      }
                    }
                    // For CREATE_STACK chained actions (e.g., False Orders Reveal), clear abilityMode to remove board highlights
                    if (chained.type === 'CREATE_STACK') {
                      setAbilityMode(null)
                    }
                    // Use the new { row, col } as sourceCoords for chained action, not cursorStack.sourceCoords
                    onAction(chained, { row, col })
                  }
                  // Clear targeting mode when cursor stack is fully consumed
                  // This handles cases like GAWAIN_DEPLOY_SHIELD_AIM where no chained action exists
                  clearTargetingMode()
                  setCursorStack(null)
                }
                interactionLock.current = true
                setTimeout(() => {
                  interactionLock.current = false
                }, 300)
              }
            }
          }
        } else {
          const isOverModal = target?.closest('.counter-modal-content')
          const isOverGameBoard = target?.closest('[data-board-coords]') !== null
          const isOverHandCard = target?.closest('[data-hand-card]') !== null

          if (cursorStack.isDragging) {
            if (isOverModal) {
              setCursorStack(prev => prev ? { ...prev, isDragging: false } : null)
            } else {
              // Only close if not clicking on game board or hand cards
              // This allows retrying token placement on valid targets
              if (!isOverGameBoard && !isOverHandCard) {
                clearTargetingMode()
                setCursorStack(null)
              }
            }
          } else {
            // Only close if clicking outside modal and outside game areas
            if (!isOverModal && !isOverGameBoard && !isOverHandCard) {
              clearTargetingMode()
              setCursorStack(null)
            }
          }
        }
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [cursorStack, handleDrop, gameState, localPlayerId, requestCardReveal, markAbilityUsed, interactionLock, setCommandContext, onAction, setCursorStack, setAbilityMode, triggerClickWave])

  // Handle right-click to cancel token placement mode
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      if (!cursorStack) {
        return
      }
      // Right-click cancels token placement mode
      e.preventDefault()
      clearTargetingMode()
      setCursorStack(null)
    }
    window.addEventListener('contextmenu', handleGlobalContextMenu)
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu)
    }
  }, [cursorStack, setCursorStack, clearTargetingMode])

  const handleCounterMouseDown = (type: string, e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY }

    // Determine token owner: if active player is dummy, tokens belong to dummy
    // Otherwise, tokens belong to local player
    const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
    const tokenOwnerId = (activePlayer?.isDummy && gameState.activePlayerId !== null)
      ? gameState.activePlayerId
      : localPlayerId ?? 0

    // Use universal token targeting system to create cursorStack
    setCursorStack(prev => {
      return createTokenCursorStack(type, tokenOwnerId, prev)
    })
  }

  return {
    cursorFollowerRef,
    handleCounterMouseDown,
  }
}
