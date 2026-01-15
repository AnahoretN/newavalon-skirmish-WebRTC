import React, { memo, useMemo, useCallback, useState } from 'react'
import type { Board, GridSize, DragItem, DropTarget, Card as CardType, PlayerColor, HighlightData, FloatingTextData } from '@/types'
import { Card } from './Card'
import { PLAYER_COLORS, FLOATING_TEXT_COLORS, PLAYER_COLOR_RGB } from '@/constants'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'

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
  highlights?: HighlightData[];
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
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
  showNoTarget?: boolean;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
  cellHighlights?: HighlightData[];
    }>(({
      row, col, cell, isGameStarted, handleDrop, draggedItem, setDraggedItem,
      openContextMenu, playMode, setPlayMode, playerColorMap, localPlayerId,
      onCardDoubleClick, onEmptyCellDoubleClick, imageRefreshVersion, cursorStack,
      currentPhase, activePlayerId, onCardClick, onEmptyCellClick,
      isValidTarget, showNoTarget, disableActiveHighlights, preserveDeployAbilities,
      abilitySourceCoords, abilityCheckKey, cellHighlights = [],
    }) => {
      const [isOver, setIsOver] = useState(false)

      const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        if (draggedItem) {
          handleDrop(draggedItem, { target: 'board', boardCoords: { row, col } })
        }
        setIsOver(false)
      }, [draggedItem, handleDrop, row, col])

      const handleClick = useCallback(() => {
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
      }, [playMode, cell.card, onCardClick, onEmptyCellClick, handleDrop, setPlayMode, row, col])

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
        if (!cell.card) {
          openContextMenu(e, 'emptyBoardCell', { boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col])

      const handleDoubleClick = useCallback(() => {
        if (!cell.card) {
          onEmptyCellDoubleClick({ row, col })
        }
      }, [cell.card, onEmptyCellDoubleClick, row, col])

      const handleCardDragStart = useCallback(() => {
        if (cell.card) {
          setDraggedItem({
            card: cell.card,
            source: 'board',
            boardCoords: { row, col },
            isManual: true,
          })
        }
      }, [cell.card, setDraggedItem, row, col])

      const handleCardContextMenu = useCallback((e: React.MouseEvent) => {
        if (cell.card) {
          openContextMenu(e, 'boardItem', { card: cell.card, boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col])

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
      // Check if card has ready ability
      const hasReadyAbility = cell.card && hasReadyAbilityInCurrentPhase(
        cell.card,
        currentPhase ?? 0,
        activePlayerId
      )
      // Card has active effects (highlight, selection, or ready ability) - should appear above other cards
      const hasActiveEffect = isValidTarget || (cellHighlights.length > 0) || hasReadyAbility

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
                src="https://res.cloudinary.com/dxxh6meej/image/upload/v1763978163/no_tarket_mic5sm.png"
                alt="No Target"
                className="w-24 h-24 object-contain animate-fade-out drop-shadow-[0_0_5px_rgba(255,0,0,0.8)]"
              />
            </div>
          )}

          {/* Highlights from gameState - show all highlights for this cell */}
          {cellHighlights.filter(h => {
            // Show all highlights for this cell (regardless of which player created them)
            return h.type === 'cell' && h.row === row && h.col === col
          }).map((highlight, idx) => {
            const playerColor = playerColorMap.get(highlight.playerId)
            const colorStyles = playerColor && PLAYER_COLORS[playerColor] ? PLAYER_COLORS[playerColor] : null
            // Border color: blend between white and owner color (50/50 mix)
            const rgb = playerColor && PLAYER_COLOR_RGB[playerColor]
              ? PLAYER_COLOR_RGB[playerColor]
              : { r: 37, g: 99, b: 235 }
            // Glow color 30% brighter than base color, 50% transparent
            const glowRgb = {
              r: Math.min(255, Math.round(rgb.r * 1.3)),
              g: Math.min(255, Math.round(rgb.g * 1.3)),
              b: Math.min(255, Math.round(rgb.b * 1.3)),
            }
            // Border color: white, gradient background like card ready ability
            return (
              <div
                key={`highlight-${idx}-${highlight.timestamp}`}
                className="absolute inset-0 rounded-md pointer-events-none animate-glow-pulse"
                style={{
                  zIndex: 50,
                  boxShadow: `0 0 12px 2px rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.5)`,
                  border: '3px solid',
                  borderColor: `rgb(255, 255, 255)`,
                  background: `radial-gradient(circle at center, transparent 20%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5) 100%)`,
                }}
              />
            )
          })}

          {cell.card && (
            <div
              key={cell.card.id}
              draggable={isGameStarted}
              onDragStart={handleCardDragStart}
              onDragEnd={() => setDraggedItem(null)}
              onContextMenu={handleCardContextMenu}
              onDoubleClick={handleCardDoubleClick}
              className={`w-full h-full ${isGameStarted ? 'cursor-grab' : 'cursor-default'} relative ${hasActiveEffect ? 'z-40' : 'z-30'}`}
              data-interactive="true"
            >
              <Card
                card={cell.card}
                isFaceUp={isFaceUp}
                playerColorMap={playerColorMap}
                localPlayerId={localPlayerId}
                imageRefreshVersion={imageRefreshVersion}
                activePhaseIndex={currentPhase}
                activePlayerId={activePlayerId}
                disableActiveHighlights={disableActiveHighlights}
                preserveDeployAbilities={preserveDeployAbilities}
                activeAbilitySourceCoords={abilitySourceCoords}
                boardCoords={{ row: row, col: col }}
                abilityCheckKey={abilityCheckKey}
                onCardClick={onCardClick}
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
  highlights,
  abilitySourceCoords = null,
  abilityCheckKey,
}) => {
  // Debug: log highlights when they change
  React.useEffect(() => {
    if (highlights && highlights.length > 0) {
      console.log('[GameBoard] Received highlights:', highlights.length, highlights)
    }
  }, [highlights])

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
    const validTargetsSet = new Set(validTargets?.map(t => `${t.row}-${t.col}`) || [])

    return activeBoard.map((rowItems, rowIndex) =>
      rowItems.map((cell, colIndex) => {
        const originalRowIndex = rowIndex + offset
        const originalColIndex = colIndex + offset
        const cellKey = `${originalRowIndex}-${originalColIndex}`

        return {
          cellKey,
          originalRowIndex,
          originalColIndex,
          cell,
          isValidTarget: validTargetsSet.has(cellKey),
          isNoTarget: noTargetOverlay?.row === originalRowIndex && noTargetOverlay.col === originalColIndex,
          cellFloatingTexts: activeFloatingTexts?.filter(t => t.row === originalRowIndex && t.col === originalColIndex) || [],
          cellHighlights: highlights?.filter(h => h.type === 'cell' && h.row === originalRowIndex && h.col === originalColIndex) || [],
        }
      }),
    )
  }, [activeBoard, board.length, activeGridSize, validTargets, noTargetOverlay, activeFloatingTexts, highlights])

  return (
    <div className="relative p-2 bg-board-bg rounded-xl h-full aspect-square transition-all duration-300">
      <div className={`grid ${gridSizeClasses[activeGridSize]} gap-0.5 h-full w-full`}>
        {processedCells.map((rowCells) =>
          rowCells.map(({
            cellKey, originalRowIndex, originalColIndex, cell, isValidTarget,
            isNoTarget, cellFloatingTexts, cellHighlights,
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
                showNoTarget={isNoTarget}
                disableActiveHighlights={disableActiveHighlights}
                preserveDeployAbilities={preserveDeployAbilities}
                abilitySourceCoords={abilitySourceCoords}
                abilityCheckKey={abilityCheckKey}
                cellHighlights={cellHighlights}
              />
              {cellFloatingTexts.map(ft => (
                <FloatingTextOverlay
                  key={ft.id || `${ft.row}-${ft.col}-${ft.timestamp}`}
                  textData={ft}
                  playerColorMap={playerColorMap}
                />
              ))}
            </div>
          )),
        )}
      </div>

      {/* Highlights from gameState for rows/cols */}
      {highlights && highlights.length > 0 && (
        <div className={`absolute top-2 right-2 bottom-2 left-2 grid ${gridSizeClasses[activeGridSize]} gap-0.5 pointer-events-none z-20`}>
          {highlights.filter(h => h.type === 'row' || h.type === 'col').map((h, idx) => {
            const playerColor = playerColorMap.get(h.playerId)
            const outlineClass = (playerColor && PLAYER_COLORS[playerColor]) ? PLAYER_COLORS[playerColor].outline : 'outline-yellow-400'
            const baseClasses = `outline outline-[8px] ${outlineClass} rounded-lg`
            const totalSize = board.length
            const offset = Math.floor((totalSize - activeGridSize) / 2)

            if (h.type === 'row' && h.row !== undefined && h.row >= offset && h.row < offset + activeGridSize) {
              const gridRow = h.row - offset + 1
              return (
                <div
                  key={`highlight-row-${idx}-${h.timestamp}`}
                  className={baseClasses}
                  style={{
                    gridArea: `${gridRow} / 1 / ${gridRow + 1} / ${activeGridSize + 1}`,
                  }}
                />
              )
            }

            if (h.type === 'col' && h.col !== undefined && h.col >= offset && h.col < offset + activeGridSize) {
              const gridCol = h.col - offset + 1
              return (
                <div
                  key={`highlight-col-${idx}-${h.timestamp}`}
                  className={baseClasses}
                  style={{
                    gridArea: `1 / ${gridCol} / ${activeGridSize + 1} / ${gridCol + 1}`,
                  }}
                />
              )
            }
            return null
          })}
        </div>
      )}

      {/* Legacy highlight for backwards compatibility */}
      {highlight && !highlights?.some(h => h.type === highlight.type && h.row === highlight.row && h.col === highlight.col) && (
        <div className={`absolute top-2 right-2 bottom-2 left-2 grid ${gridSizeClasses[activeGridSize]} gap-0.5 pointer-events-none z-20`}>
          {HighlightContent}
        </div>
      )}
    </div>
  )
})

GameBoard.displayName = 'GameBoard'
