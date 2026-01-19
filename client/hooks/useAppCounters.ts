import React, { useRef, useEffect, useLayoutEffect } from 'react'
import type { CursorStackState, GameState, AbilityAction, DragItem, DropTarget, CommandContext } from '@/types'
import { validateTarget } from '@server/utils/targeting'

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
      if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
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

            handleDrop({
              card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
              source: 'counter_panel',
              ownerId: cursorStack.sourceCard?.ownerId, // Use source card owner for status ownership
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
              if (cursorStack.chainedAction) {
                onAction(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
              }
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

                if (cursorStack.type === 'Revealed' && targetCard.ownerId !== effectiveActorId && !targetPlayer?.isDummy) {
                  if (targetCard.isFaceDown) {
                    if (localPlayerId !== null) {
                      requestCardReveal({ source: 'board', ownerId: targetCard.ownerId, boardCoords: { row, col } }, localPlayerId)
                    }
                  } else {
                    handleDrop({
                      card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
                      source: 'counter_panel',
                      ownerId: cursorStack.sourceCard?.ownerId, // Use source card owner for status ownership
                      statusType: cursorStack.type,
                      count: 1,
                    }, { target: 'board', boardCoords: { row, col } })
                  }

                  if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
                    markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
                  }
                  if (cursorStack.count > 1) {
                    setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
                  } else {
                    if (cursorStack.chainedAction) {
                      onAction(cursorStack.chainedAction, cursorStack.sourceCoords || { row: -1, col: -1 })
                    }
                    setCursorStack(null)
                  }
                  interactionLock.current = true
                  setTimeout(() => {
                    interactionLock.current = false
                  }, 300)
                  return
                }
              }

              if (targetCard) {
                const amountToDrop = cursorStack.placeAllAtOnce ? cursorStack.count : 1

                handleDrop({
                  card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, ability: '', types: [] },
                  source: 'counter_panel',
                  ownerId: cursorStack.sourceCard?.ownerId, // Use source card owner for status ownership
                  statusType: cursorStack.type,
                  replaceStatusType: cursorStack.replaceStatus ? cursorStack.requiredTargetStatus : undefined, // For Censor: Exploit -> Stun
                  count: amountToDrop,
                }, { target: 'board', boardCoords: { row, col } })

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
                if (cursorStack.count > amountToDrop) {
                  setCursorStack(prev => prev ? ({ ...prev, count: prev.count - amountToDrop }) : null)
                } else {
                  if (cursorStack.chainedAction) {
                    const chained = { ...cursorStack.chainedAction }
                    if (cursorStack.recordContext) {
                      if (chained.mode === 'SELECT_CELL') {
                        chained.sourceCard = targetCard
                        chained.sourceCoords = { row, col }
                        chained.recordContext = true
                      }
                      if (chained.type === 'GLOBAL_AUTO_APPLY') {
                        chained.sourceCoords = { row, col }
                      }
                      // ZIUS_LINE_SELECT: use target card coords as anchor point (where Exploit was placed)
                      if (chained.mode === 'ZIUS_LINE_SELECT') {
                        chained.sourceCoords = { row, col }
                      }
                    }
                    onAction(chained, cursorStack.sourceCoords || { row: -1, col: -1 })
                  }
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
                setCursorStack(null)
              }
            }
          } else {
            // Only close if clicking outside modal and outside game areas
            if (!isOverModal && !isOverGameBoard && !isOverHandCard) {
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
  }, [cursorStack, handleDrop, gameState, localPlayerId, requestCardReveal, markAbilityUsed, interactionLock, setCommandContext, onAction, setCursorStack])

  // Handle right-click to cancel token placement mode
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      if (!cursorStack) {
        return
      }
      // Right-click cancels token placement mode
      e.preventDefault()
      setCursorStack(null)
    }
    window.addEventListener('contextmenu', handleGlobalContextMenu)
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu)
    }
  }, [cursorStack, setCursorStack])

  const handleCounterMouseDown = (type: string, e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY }
    setCursorStack(prev => {
      if (prev?.type === type) {
        return { type, count: prev.count + 1, isDragging: true, sourceCoords: prev.sourceCoords }
      }
      return { type, count: 1, isDragging: true }
    })
  }

  return {
    cursorFollowerRef,
    handleCounterMouseDown,
  }
}
