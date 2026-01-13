import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Player, Card as CardType, DragItem, PlayerColor } from '@/types'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'

interface DeckViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  player: Player;
  cards: CardType[];
  setDraggedItem: (item: DragItem | null) => void;
  onCardContextMenu?: (e: React.MouseEvent, cardIndex: number) => void;
  onCardDoubleClick?: (cardIndex: number) => void;
  onCardClick?: (cardIndex: number) => void;
  onReorder?: (playerId: number, newCards: CardType[]) => void; // Callback for reordering cards
  canInteract: boolean;
  isDeckView?: boolean; // If true, the source of dragged cards is 'deck' instead of 'discard'.
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  imageRefreshVersion?: number;
  highlightFilter?: (card: CardType) => boolean; // Optional filter to highlight certain cards (e.g. Units)
}

export const DeckViewModal: React.FC<DeckViewModalProps> = ({
  isOpen,
  onClose,
  title,
  player,
  cards,
  setDraggedItem,
  onCardContextMenu,
  onCardDoubleClick,
  onCardClick,
  onReorder,
  canInteract,
  isDeckView = false,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  highlightFilter
}) => {
  const { t } = useLanguage()
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [localCards, setLocalCards] = useState<CardType[]>(cards)
  const [droppedOutside, setDroppedOutside] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedCardRef = useRef<CardType | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
      setLocalCards(cards)
      setDroppedOutside(false)
      draggedCardRef.current = null
    }
  }, [isOpen, cards])

  // Determine which cards to display (with reordering applied if drag is active)
  const displayCards = useMemo(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const reordered = [...localCards]
      const [movedCard] = reordered.splice(draggedIndex, 1)
      reordered.splice(dragOverIndex, 0, movedCard)
      return reordered
    }
    return localCards
  }, [localCards, draggedIndex, dragOverIndex])

  const handleDragStart = useCallback((card: CardType, index: number) => {
    if (!canInteract) {
      return
    }

    setDraggedIndex(index)
    setDraggedCardId(card.id)
    draggedCardRef.current = card
    setDroppedOutside(false)
  }, [canInteract])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }, [dragOverIndex])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!draggedCardRef.current || !modalRef.current) {
      return
    }

    const rect = modalRef.current.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    // If cursor is outside modal bounds, set up draggedItem and close modal
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      const card = draggedCardRef.current
      const index = draggedIndex ?? 0

      setDraggedItem({
        card,
        source: isDeckView ? 'deck' : 'discard',
        playerId: player.id,
        cardIndex: index,
      })

      setDroppedOutside(true)

      // Close modal immediately so drop can happen on underlying elements
      onClose()
    }
  }, [draggedIndex, isDeckView, player.id, setDraggedItem, onClose])

  const handleDragEnd = useCallback(() => {
    // Only cleanup if we didn't drop outside (outside case is handled by dragLeave)
    if (!droppedOutside) {
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
    }
    draggedCardRef.current = null
  }, [droppedOutside])

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    e.stopPropagation()

    // If drop happened but we already marked as outside, ignore
    if (droppedOutside) {
      return
    }

    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDraggedCardId(null)
      setDragOverIndex(null)
      return
    }

    // Reorder the cards
    const newCards = [...localCards]
    const [movedCard] = newCards.splice(draggedIndex, 1)
    newCards.splice(targetIndex, 0, movedCard)

    setLocalCards(newCards)

    // Notify parent of reorder
    if (onReorder) {
      onReorder(player.id, newCards)
    }

    setDraggedIndex(null)
    setDraggedCardId(null)
    setDragOverIndex(null)
  }, [draggedIndex, localCards, onReorder, player.id, droppedOutside])

  const rowCount = Math.ceil(cards.length / 5)
  const shouldScroll = rowCount > 5
  const heightFor5Rows = 'calc(5 * 7rem + 4 * 0.5rem + 1rem)'

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 pointer-events-auto"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onDragLeave={handleDragLeave}
        className="bg-gray-800 rounded-lg p-4 shadow-xl w-auto max-w-4xl max-h-[95vh] flex flex-col">
        <div className="flex justify-between items-center mb-2 flex-shrink-0">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-3 rounded text-sm">
                {t('close')}
          </button>
        </div>
        <div
          className={`bg-gray-900 rounded p-2 ${shouldScroll ? 'overflow-y-auto' : ''}`}
          style={shouldScroll ? { height: heightFor5Rows } : {}}
        >
          <div className="grid grid-cols-5 gap-2">
            {displayCards.map((card, index) => {
              // Find original index for this card in case of reordering
              const originalIndex = localCards.findIndex(c => c.id === card.id)

              const isMatchingFilter = highlightFilter ? highlightFilter(card) : true
              const isHighlighted = isMatchingFilter
              const isBeingDragged = draggedCardId === card.id
              const isDragTarget = dragOverIndex === index && draggedIndex !== index
              const isInteractive = canInteract && isMatchingFilter

              const opacity = isBeingDragged ? 0.5 : (isMatchingFilter ? 1 : 0.3)

              return (
                <div
                  key={`${card.id}-${index}`}
                  style={{ opacity }}
                  draggable={isInteractive}
                  onDragStart={() => handleDragStart(card, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, index)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (onCardContextMenu) {
                      onCardContextMenu(e, originalIndex)
                    }
                  }}
                  onClick={() => isInteractive && onCardClick?.(originalIndex)}
                  onDoubleClick={() => isInteractive && onCardDoubleClick?.(originalIndex)}
                  data-interactive={isInteractive}
                  className={`w-28 h-28 relative transition-all rounded-lg
                    ${isInteractive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
                    ${isDragTarget ? 'scale-105 z-10' : ''}
                    ${isBeingDragged ? 'scale-95' : 'hover:scale-105'}
                  `}
                >
                  <div className={`w-full h-full ${isHighlighted && highlightFilter ? 'ring-4 ring-cyan-400 rounded-md shadow-[0_0_18px_#22d3ee]' : ''}`}>
                    <Card
                      card={card}
                      isFaceUp={true}
                      playerColorMap={playerColorMap}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                      disableActiveHighlights={!isMatchingFilter}
                    />
                  </div>
                </div>
              )
            })}
            {displayCards.length === 0 && <p className="col-span-5 w-full text-center text-gray-400 py-8">{t('empty')}</p>}
          </div>
        </div>
        <p className="text-gray-400 text-xs mt-2 text-center">
          {t('dragCardsReorder')}
        </p>
      </div>
    </div>
  )
}
