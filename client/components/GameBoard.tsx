import React, { memo, useMemo, useCallback, useState } from 'react'
import type { Board, GridSize, DragItem, DropTarget, Card as CardType, PlayerColor, HighlightData, FloatingTextData, TargetingModeData, ClickWave, CursorStackState } from '@/types'
import { ClickWave as ClickWaveComponent } from './ClickWave'
import { Card } from './Card'
import { PLAYER_COLORS, FLOATING_TEXT_COLORS, PLAYER_COLOR_RGB } from '@/constants'
import { hasReadyAbilityInCurrentPhase, hasReadyStatusForPhase } from '@/utils/autoAbilities'
import { calculateGlowColor, rgba, TIMING } from '@/utils/common'

interface GameBoardProps {
  board: Board;
  isGameStarted: boolean;
  activeGridSize: GridSize;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: 'boardItem' | 'emptyBoardCell', data: any) => void;
  playMode: { card: CardType; sourceItem: DragItem; faceDown?: boolean } | null;
  setPlayMode: (mode: null) => void;
  highlight: HighlightData | null;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  onCardDoubleClick: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void;
  imageRefreshVersion?: number;
  cursorStack: { type: string; count: number } | null;
  currentPhase?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  onCardClick?: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void;
  validTargets?: {row: number, col: number}[];
  noTargetOverlay?: {row: number, col: number} | null;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  activeFloatingTexts?: FloatingTextData[];
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
  targetingMode?: TargetingModeData | null; // Shared targeting mode from gameState
  clickWaves?: ClickWave[];
  triggerClickWave?: (location: 'board' | 'hand' | 'emptyCell', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
  // Mode cancellation props (right-click to cancel)
  setCursorStack?: (value: CursorStackState | null) => void;
  onCancelAllModes?: () => void;
}

const GridCell = memo<{
  row: number;
  col: number;
  cell: { card: CardType | null };
  isGameStarted: boolean;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: GameBoardProps['openContextMenu'];
  playMode: GameBoardProps['playMode'];
  setPlayMode: GameBoardProps['setPlayMode'];
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  onCardDoubleClick: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void;
  imageRefreshVersion?: number;
  cursorStack: GameBoardProps['cursorStack'];
  currentPhase?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  onCardClick?: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void;
  isValidTarget?: boolean;
  isTargetingModeValidTarget?: boolean;
  targetingModePlayerId?: number;
  targetingModeOriginalOwnerId?: number; // The command card owner (for correct highlight color)
  showNoTarget?: boolean;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
  setCursorStack?: (value: CursorStackState | null) => void;
  onCancelAllModes?: () => void;
  triggerClickWave?: (location: 'board' | 'hand' | 'emptyCell', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
}>((props) => {
  const {
      row, col, cell, isGameStarted, handleDrop, draggedItem, setDraggedItem,
      openContextMenu, playMode, setPlayMode, playerColorMap, localPlayerId,
      onCardDoubleClick, onEmptyCellDoubleClick, imageRefreshVersion, cursorStack,
      currentPhase, activePlayerId, onCardClick, onEmptyCellClick,
      isValidTarget, isTargetingModeValidTarget, targetingModePlayerId,
      targetingModeOriginalOwnerId,
      showNoTarget, disableActiveHighlights, preserveDeployAbilities,
      abilitySourceCoords, abilityCheckKey, setCursorStack, onCancelAllModes,
      triggerClickWave,
  } = props

  const [isOver, setIsOver] = useState(false)

      const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        if (draggedItem) {
          handleDrop(draggedItem, { target: 'board', boardCoords: { row, col } })
        }
        setIsOver(false)
      }, [draggedItem, handleDrop, row, col])

      const handleClick = useCallback(() => {
        // Trigger click wave for empty cells
        if (!cell.card && triggerClickWave && localPlayerId !== null) {
          triggerClickWave('emptyCell', { row, col })
        }
        if (playMode) {
          const itemToDrop: DragItem = {
            ...playMode.sourceItem,
            card: { ...playMode.sourceItem.card },
          }
          itemToDrop.card.isFaceDown = !!playMode.faceDown
          handleDrop(itemToDrop, { target: 'board', boardCoords: { row, col } })
          setPlayMode(null)
        } else if (cell.card && onCardClick) {
          onCardClick(cell.card, { row, col })
        } else if (!cell.card && onEmptyCellClick) {
          onEmptyCellClick({ row, col })
        }
      }, [playMode, cell.card, onCardClick, onEmptyCellClick, handleDrop, setPlayMode, row, col, triggerClickWave, localPlayerId])

      const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        const isCounter = draggedItem?.source === 'counter_panel'
        if (!cell.card || (cell.card && isCounter)) {
          setIsOver(true)
        }
      }, [draggedItem, cell.card])

      const onDragLeave = useCallback(() => {
        setIsOver(false)
      }, [])

      const handleContextMenu = useCallback((e: React.MouseEvent) => {
        // Right-click cancels all targeting/ability modes for all players
        if (onCancelAllModes) {
          onCancelAllModes()
        }
        if (!cell.card) {
          openContextMenu(e, 'emptyBoardCell', { boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col, onCancelAllModes])

      const handleDoubleClick = useCallback(() => {
        if (!cell.card) {
          onEmptyCellDoubleClick({ row, col })
        }
      }, [cell.card, onEmptyCellDoubleClick, row, col])

      const handleCardDragStart = useCallback(() => {
        // Block dragging when cursorStack is active (has a token)
        if (cursorStack) {
          return
        }
        if (cell.card) {
          setDraggedItem({
            card: cell.card,
            source: 'board',
            boardCoords: { row, col },
            isManual: true,
            bypassOwnershipCheck: true,
          })
        }
      }, [cell.card, setDraggedItem, row, col, cursorStack])

      const handleCardContextMenu = useCallback((e: React.MouseEvent) => {
        // Right-click cancels all targeting/ability modes for all players
        if (onCancelAllModes) {
          onCancelAllModes()
        }
        if (cell.card) {
          openContextMenu(e, 'boardItem', { card: cell.card, boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col, onCancelAllModes])

      const handleCardDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        if (!cursorStack && cell.card) {
          onCardDoubleClick(cell.card, { row, col })
        } else {
          handleClick()
        }
      }, [cursorStack, cell.card, onCardDoubleClick, handleClick, row, col])

      const isInPlayMode = !!playMode
      const isStackMode = !!cursorStack
      const isOccupied = !!cell.card
      const baseClasses = 'w-full h-full rounded-lg transition-colors duration-200 flex items-center justify-center relative'

      const canDrop = !!draggedItem && (!isOccupied || (isOccupied && draggedItem.source === 'counter_panel'))
      const canPlay = isInPlayMode && !isOccupied
      const canStack = isStackMode && isValidTarget
      // Interactive for click handling, but visual highlight comes from shared highlights
      const isInteractive = isValidTarget || canPlay || canStack
      // Check if card has ready ability (for activation) or ready status (for visual display)
      const hasReadyAbility = cell.card && hasReadyAbilityInCurrentPhase(
        cell.card,
        currentPhase ?? 0,
        activePlayerId
      )
      // For visual display on other players' cards
      const hasReadyStatusVisual = cell.card && hasReadyStatusForPhase(
        cell.card,
        currentPhase ?? 0
      )
      const hasActiveEffect = isValidTarget || hasReadyAbility || hasReadyStatusVisual
      // Card has active effects (highlight, selection, or ready ability) - should appear above other cards

      // Only add cursor pointer for interactive cells - visual highlight comes from shared highlights
      const targetClasses = isInteractive ? 'cursor-pointer z-10' : ''
      const cellClasses = `bg-board-cell-active ${isOver && canDrop ? 'bg-indigo-400 opacity-80' : ''} ${isInPlayMode && isOccupied ? 'cursor-not-allowed' : ''} ${targetClasses}`

      const isFaceUp: boolean = useMemo(() => {
        const card = cell.card
        if (!card) {
          return false
        }

        const isRevealedToAll = card.revealedTo === 'all'
        const isRevealedToMeExplicitly = localPlayerId !== null && Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
        const isRevealedByRequest = localPlayerId !== null && card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)

        return !card.isFaceDown || isRevealedToAll || isRevealedToMeExplicitly || isRevealedByRequest || false
      }, [cell.card, localPlayerId])

      return (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          className={`${baseClasses} ${cellClasses}`}
          data-interactive={!cell.card}
          data-board-coords={`${row},${col}`}
        >
          {showNoTarget && (
            <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
              <img
                src="https://res.cloudinary.com/dxxh6meej/image/upload/v1771365317/no_tarket_lndzoc.webp"
                alt="No Target"
                className="w-24 h-24 object-contain animate-fade-out drop-shadow-[0_0_5px_rgba(255,0,0,0.8)]"
              />
            </div>
          )}

          {/* Targeting mode highlight - shows valid targets from another player's targeting mode */}
          {isTargetingModeValidTarget && (targetingModePlayerId || targetingModeOriginalOwnerId) && (() => {
            // Prefer originalOwnerId (command card owner) for highlight color, fallback to playerId
            const highlightOwnerId = targetingModeOriginalOwnerId ?? targetingModePlayerId
            const targetingPlayerColor = highlightOwnerId !== undefined ? playerColorMap.get(highlightOwnerId) : undefined
            const rgb = targetingPlayerColor && PLAYER_COLOR_RGB[targetingPlayerColor]
              ? PLAYER_COLOR_RGB[targetingPlayerColor]
              : { r: 37, g: 99, b: 235 }
            const glowRgb = calculateGlowColor(rgb)
            return (
              <div
                key={`targeting-mode-${highlightOwnerId}`}
                className="absolute inset-0 rounded-md pointer-events-none animate-glow-pulse"
                style={{
                  zIndex: 50,
                  boxShadow: `0 0 12px 2px ${rgba(glowRgb, 0.5)}`,
                  border: '3px solid',
                  borderColor: `rgb(255, 255, 255)`,
                  background: `radial-gradient(circle at center, transparent 20%, ${rgba(rgb, 0.5)} 100%)`,
                }}
              />
            )
          })()}

          {cell.card && (
            <div
              key={cell.card.id}
              draggable={isGameStarted && !cursorStack}
              onDragStart={handleCardDragStart}
              onDragEnd={() => {
                // Don't reset here - let the drop handler do it
                // Fallback: clear after delay if no drop happened
                setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK)
              }}
              onContextMenu={handleCardContextMenu}
              onDoubleClick={handleCardDoubleClick}
              className={`w-full h-full ${isGameStarted && !cursorStack ? 'cursor-grab' : 'cursor-default'} relative ${hasActiveEffect ? 'z-40' : 'z-30'}`}
              data-interactive="true"
            >
              <Card
                card={cell.card}
                isFaceUp={isFaceUp}
                playerColorMap={playerColorMap}
                localPlayerId={localPlayerId}
                imageRefreshVersion={imageRefreshVersion}
                loadPriority="high"
                disableImageTransition={true}
                activePhaseIndex={currentPhase}
                activePlayerId={activePlayerId}
                disableActiveHighlights={disableActiveHighlights}
                preserveDeployAbilities={preserveDeployAbilities}
                activeAbilitySourceCoords={abilitySourceCoords}
                boardCoords={{ row: row, col: col }}
                abilityCheckKey={abilityCheckKey}
                onCardClick={onCardClick}
                targetingMode={!!targetingModePlayerId}
                triggerClickWave={triggerClickWave}
              />
            </div>
          )}
        </div>
      )
    })

GridCell.displayName = 'GridCell'

const gridSizeClasses: { [key in GridSize]: string } = {
  4: 'grid-cols-4 grid-rows-4',
  5: 'grid-cols-5 grid-rows-5',
  6: 'grid-cols-6 grid-rows-6',
  7: 'grid-cols-7 grid-rows-7',
}

const FloatingTextOverlay = memo<{ textData: FloatingTextData; playerColorMap: Map<number, PlayerColor>; }>(({ textData, playerColorMap }) => {
  const colorClass = useMemo(() => {
    const playerColor = playerColorMap.get(textData.playerId)
    return (playerColor && FLOATING_TEXT_COLORS[playerColor]) ? FLOATING_TEXT_COLORS[playerColor] : 'text-white'
  }, [playerColorMap, textData.playerId])

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[60] animate-float-up">
      <span className={`text-4xl font-black ${colorClass}`} style={{ textShadow: '2px 2px 0 #000' }}>
        {textData.text}
      </span>
    </div>
  )
})

FloatingTextOverlay.displayName = 'FloatingTextOverlay'

export const GameBoard = memo<GameBoardProps>(({
  board,
  isGameStarted,
  activeGridSize,
  handleDrop,
  draggedItem,
  setDraggedItem,
  openContextMenu,
  playMode,
  setPlayMode,
  highlight,
  playerColorMap,
  localPlayerId,
  onCardDoubleClick,
  onEmptyCellDoubleClick,
  imageRefreshVersion,
  cursorStack,
  currentPhase,
  activePlayerId,
  onCardClick,
  onEmptyCellClick,
  validTargets,
  noTargetOverlay,
  disableActiveHighlights,
  preserveDeployAbilities = false,
  activeFloatingTexts,
  abilitySourceCoords = null,
  abilityCheckKey,
  targetingMode,
  clickWaves,
}) => {

  const activeBoard = useMemo(() => {
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)

    return board
      .slice(offset, offset + activeGridSize)
      .map(row => row.slice(offset, offset + activeGridSize))
  }, [board, activeGridSize])

  const HighlightContent = useMemo(() => {
    if (!highlight) {
      return null
    }

    const { type, row, col, playerId } = highlight
    const playerColor = playerColorMap.get(playerId)
    const outlineClass = (playerColor && PLAYER_COLORS[playerColor]) ? PLAYER_COLORS[playerColor].outline : 'outline-yellow-400'
    const baseClasses = `outline outline-[8px] ${outlineClass} rounded-lg`
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)

    if (type === 'row' && row !== undefined && row >= offset && row < offset + activeGridSize) {
      const gridRow = row - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `${gridRow} / 1 / ${gridRow + 1} / ${activeGridSize + 1}`,
          }}
        />
      )
    }

    if (type === 'col' && col !== undefined && col >= offset && col < offset + activeGridSize) {
      const gridCol = col - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `1 / ${gridCol} / ${activeGridSize + 1} / ${gridCol + 1}`,
          }}
        />
      )
    }

    if (type === 'cell' && row !== undefined && col !== undefined && row >= offset && row < offset + activeGridSize && col >= offset && col < offset + activeGridSize) {
      const gridRow = row - offset + 1
      const gridCol = col - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `${gridRow} / ${gridCol} / ${gridRow + 1} / ${gridCol + 1}`,
          }}
        />
      )
    }

    return null
  }, [highlight, playerColorMap, activeGridSize, board.length])

  const processedCells = useMemo(() => {
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)
    // Combine local validTargets with shared targetingMode boardTargets
    // Ensure both are arrays before mapping
    const validTargetsArray = Array.isArray(validTargets) ? validTargets : []
    const localTargetsSet = new Set(validTargetsArray.map((t: {row: number, col: number}) => `${t.row}-${t.col}`))
    // Ensure boardTargets is always an array
    const boardTargetsArray = Array.isArray(targetingMode?.boardTargets) ? targetingMode.boardTargets : []
    const targetingModeTargetsSet = new Set(boardTargetsArray.map((t: {row: number, col: number}) => `${t.row}-${t.col}`))

    // A cell is valid if it's in either local targets OR targeting mode targets
    const isValidTargetCell = (row: number, col: number) => {
      return localTargetsSet.has(`${row}-${col}`) || targetingModeTargetsSet.has(`${row}-${col}`)
    }

    return activeBoard.map((rowItems, rowIndex) =>
      rowItems.map((cell, colIndex) => {
        const originalRowIndex = rowIndex + offset
        const originalColIndex = colIndex + offset
        const cellKey = `${originalRowIndex}-${originalColIndex}`

        const isTargetingModeValidTarget = targetingModeTargetsSet.has(cellKey)

        return {
          cellKey,
          originalRowIndex,
          originalColIndex,
          cell,
          isValidTarget: isValidTargetCell(originalRowIndex, originalColIndex),
          isTargetingModeValidTarget,
          isNoTarget: noTargetOverlay?.row === originalRowIndex && noTargetOverlay.col === originalColIndex,
          cellFloatingTexts: activeFloatingTexts?.filter(t => t.row === originalRowIndex && t.col === originalColIndex) || [],
          cellClickWaves: clickWaves?.filter(e => e.location === 'board' && e.boardCoords?.row === originalRowIndex && e.boardCoords?.col === originalColIndex) || [],
        }
      }),
    )
  }, [activeBoard, board.length, activeGridSize, validTargets, targetingMode, noTargetOverlay, activeFloatingTexts, clickWaves])

  // Debug log for click waves
  if (clickWaves && clickWaves.length > 0) {
    console.log('[GameBoard] clickWaves:', clickWaves)
  }

  return (
    <div className="relative p-2 bg-board-bg rounded-xl h-full aspect-square transition-all duration-300">
      <div className={`grid ${gridSizeClasses[activeGridSize]} gap-0.5 h-full w-full`}>
        {processedCells.map((rowCells) =>
          rowCells.map(({
            cellKey, originalRowIndex, originalColIndex, cell, isValidTarget,
            isTargetingModeValidTarget, isNoTarget, cellFloatingTexts,
            cellClickWaves,
          }) => (
            <div key={cellKey} className="relative w-full h-full">
              <GridCell
                row={originalRowIndex}
                col={originalColIndex}
                cell={cell}
                isGameStarted={isGameStarted}
                handleDrop={handleDrop}
                draggedItem={draggedItem}
                setDraggedItem={setDraggedItem}
                openContextMenu={openContextMenu}
                playMode={playMode}
                setPlayMode={setPlayMode}
                playerColorMap={playerColorMap}
                localPlayerId={localPlayerId}
                onCardDoubleClick={onCardDoubleClick}
                onEmptyCellDoubleClick={onEmptyCellDoubleClick}
                imageRefreshVersion={imageRefreshVersion}
                cursorStack={cursorStack}
                currentPhase={currentPhase}
                activePlayerId={activePlayerId}
                onCardClick={onCardClick}
                onEmptyCellClick={onEmptyCellClick}
                isValidTarget={isValidTarget}
                isTargetingModeValidTarget={isTargetingModeValidTarget}
                targetingModePlayerId={targetingMode?.playerId}
                targetingModeOriginalOwnerId={targetingMode?.originalOwnerId}
                showNoTarget={isNoTarget}
                disableActiveHighlights={disableActiveHighlights}
                preserveDeployAbilities={preserveDeployAbilities}
                abilitySourceCoords={abilitySourceCoords}
                abilityCheckKey={abilityCheckKey}
              />
              {cellFloatingTexts.map(ft => (
                <FloatingTextOverlay
                  key={ft.id || `${ft.row}-${ft.col}-${ft.timestamp}`}
                  textData={ft}
                  playerColorMap={playerColorMap}
                />
              ))}
              {cellClickWaves.map(wave => (
                <ClickWaveComponent
                  key={wave.timestamp}
                  timestamp={wave.timestamp}
                  playerColor={wave.playerColor}
                />
              ))}
            </div>
          )),
        )}
{/* Temporary highlight for flash effects */}      {highlight && (        <div className={`absolute top-2 right-2 bottom-2 left-2 grid ${gridSizeClasses[activeGridSize]} gap-0.5 pointer-events-none z-20`}>          {HighlightContent}        </div>      )}
      </div>

    </div>
  )
})

GameBoard.displayName = 'GameBoard'
