import React, { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Card as CardType, PlayerColor, Player, ContextMenuItem, DragItem } from '@/types'
import { Card } from './Card'
import { ContextMenu } from './ContextMenu'
import { useLanguage } from '@/contexts/LanguageContext'
import { isCloudinaryUrl, getThumbnailImageUrl, getFullImageUrl } from '@/utils/imageOptimization'

/**
 * TopDeckCard - Optimized card component for TopDeckView
 * Uses progressive loading: tiny (50px) for instant preview -> optimal (150px) for display
 */
const TopDeckCard: React.FC<{
  card: CardType;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  imageRefreshVersion?: number;
}> = memo(({ card, playerColorMap, localPlayerId, imageRefreshVersion }) => {
  // Target size: 128x128 display, so 150px gives some margin
  const TARGET_SIZE = 150
  const PREVIEW_SIZE = 50  // Tiny preview for instant load

  const [imageSrc, setImageSrc] = useState<string>(() => {
    // Start with tiny preview for instant display
    if (!card.imageUrl || !isCloudinaryUrl(card.imageUrl)) {
      return card.imageUrl
    }
    return getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
  })

  useEffect(() => {
    if (!card.imageUrl || !isCloudinaryUrl(card.imageUrl)) {
      return
    }

    // Load target quality image after preview is shown
    const targetImage = getThumbnailImageUrl(card.imageUrl, TARGET_SIZE)
    const img = new Image()

    img.onload = () => {
      setImageSrc(targetImage)
    }

    // Small delay to let preview render first
    const timer = setTimeout(() => {
      img.src = targetImage
    }, 10)

    return () => clearTimeout(timer)
  }, [card.imageUrl])

  // Add version parameter for cache busting
  const finalImageUrl = useMemo(() => {
    if (imageRefreshVersion && imageSrc && isCloudinaryUrl(imageSrc)) {
      const separator = imageSrc.includes('?') ? '&' : '?'
      return `${imageSrc}${separator}v=${imageRefreshVersion}`
    }
    return imageSrc
  }, [imageSrc, imageRefreshVersion])

  // Create optimized card with current image source
  const optimizedCard = useMemo(() => ({
    ...card,
    imageUrl: finalImageUrl,
  }), [card, finalImageUrl])

  return (
    <Card
      card={optimizedCard}
      isFaceUp={true}
      playerColorMap={playerColorMap}
      localPlayerId={localPlayerId}
      // Don't pass imageRefreshVersion - URL already has version
    />
  )
})

interface TopDeckViewProps {
    isOpen: boolean;
    player: Player;
    onClose: () => void;
    onReorder: (playerId: number, newTopCards: CardType[]) => void;
    onMoveToBottom: (cardIndex: number) => void;
    onMoveToHand: (cardIndex: number) => void;
    onMoveToDiscard: (cardIndex: number) => void;
    onPlayCard: (cardIndex: number) => void;
    onViewCard: (card: CardType) => void;
    setDraggedItem?: (item: DragItem | null) => void;
    playerColorMap: Map<number, PlayerColor>;
    localPlayerId: number | null;
    imageRefreshVersion?: number;
    initialCount?: number;
    isLocked?: boolean;
}

const TopDeckView: React.FC<TopDeckViewProps> = memo(({
  isOpen,
  player,
  onClose,
  onReorder,
  onMoveToBottom,
  onMoveToHand,
  onMoveToDiscard,
  onPlayCard,
  onViewCard,
  setDraggedItem,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  initialCount = 3,
  isLocked = false,
}) => {
  const { t } = useLanguage()
  const [viewCount, setViewCount] = useState(initialCount)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, cardIndex: number } | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [localVisibleCards, setLocalVisibleCards] = useState<CardType[]>([])
  const [droppedOutside, setDroppedOutside] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedCardRef = useRef<CardType | null>(null)

  useEffect(() => {
    if (isOpen) {
      setViewCount(initialCount)
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
      setDroppedOutside(false)
      draggedCardRef.current = null
    }
  }, [isOpen, initialCount])

  // Update local visible cards when player deck or view count changes
  useEffect(() => {
    const cards = player.deck.slice(0, Math.min(viewCount, player.deck.length))
    setLocalVisibleCards(cards)
  }, [player.deck, viewCount])

  // Determine which cards to display (with reordering applied if drag is active)
  const displayCards = useMemo(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const reordered = [...localVisibleCards]
      const [movedCard] = reordered.splice(draggedIndex, 1)
      reordered.splice(dragOverIndex, 0, movedCard)
      return reordered
    }
    return localVisibleCards
  }, [localVisibleCards, draggedIndex, dragOverIndex])

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, cardIndex: index })
  }, [])

  const handleCloseMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleIncrement = useCallback(() => {
    if (!isLocked && viewCount < player.deck.length) {
      setViewCount(prev => prev + 1)
    }
  }, [isLocked, viewCount, player.deck.length])

  const handleDecrement = useCallback(() => {
    if (!isLocked && viewCount > 1) {
      setViewCount(prev => prev - 1)
    }
  }, [isLocked, viewCount])

  const handleDragStart = useCallback((card: CardType, index: number) => {
    setDraggedIndex(index)
    setDraggedCardId(card.id)
    draggedCardRef.current = card
    setDroppedOutside(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }, [dragOverIndex])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!draggedCardRef.current || !modalRef.current) {return}

    const rect = modalRef.current.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    // If cursor is outside modal bounds, set up draggedItem and close modal
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      const card = draggedCardRef.current
      const index = draggedIndex ?? 0

      if (setDraggedItem) {
        setDraggedItem({
          card,
          source: 'deck',
          playerId: player.id,
          cardIndex: index,
        })
      }

      setDroppedOutside(true)

      // Close modal immediately so drop can happen on underlying elements
      onClose()
    }
  }, [draggedIndex, player.id, setDraggedItem, onClose])

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
    setDragOverIndex(null)

    // If drop happened but we already marked as outside, ignore
    if (droppedOutside) {return}

    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDraggedCardId(null)
      return
    }

    // Reorder the visible cards
    const newCards = [...localVisibleCards]
    const [movedCard] = newCards.splice(draggedIndex, 1)
    newCards.splice(targetIndex, 0, movedCard)

    setLocalVisibleCards(newCards)
    onReorder(player.id, newCards)
    setDraggedIndex(null)
    setDraggedCardId(null)
  }, [draggedIndex, localVisibleCards, onReorder, player.id, droppedOutside])

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) {
      return []
    }

    return [
      { label: t('view'), isBold: true, onClick: () => onViewCard(displayCards[contextMenu.cardIndex]) },
      { label: t('play'), disabled: isLocked, onClick: () => {
        onPlayCard(contextMenu.cardIndex)
      } },
      { label: t('moveToBottom'), onClick: () => {
        onMoveToBottom(contextMenu.cardIndex)
        setViewCount(prev => Math.max(0, prev - 1))
      } },
      { isDivider: true },
      { label: t('toHand'), disabled: isLocked, onClick: () => {
        onMoveToHand(contextMenu.cardIndex)
        setViewCount(prev => Math.max(0, prev - 1))
      } },
      { label: t('toDiscard'), disabled: isLocked, onClick: () => {
        onMoveToDiscard(contextMenu.cardIndex)
        setViewCount(prev => Math.max(0, prev - 1))
      } },
    ]
  }, [displayCards, isLocked, onViewCard, onPlayCard, onMoveToBottom, onMoveToHand, onMoveToDiscard, contextMenu, t])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[250] backdrop-blur-sm" onClick={onClose}>
      <div
        ref={modalRef}
        onDragLeave={handleDragLeave}
        className="bg-gray-800 rounded-lg p-6 shadow-xl w-auto max-w-5xl border border-gray-600 relative flex flex-col items-center"
        onClick={e => e.stopPropagation()}
      >

        <h2 className="text-2xl font-bold text-white mb-2 text-center">{t('topDeckView')}</h2>

        <div className="flex items-center gap-4 mb-4 bg-gray-900 p-2 rounded-full border border-gray-700">
          <button
            onClick={handleDecrement}
            disabled={isLocked || viewCount <= 1}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-red-600 rounded-full text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
                        -
          </button>
          <span className="text-xl font-mono font-bold text-indigo-400 w-8 text-center">{viewCount}</span>
          <button
            onClick={handleIncrement}
            disabled={isLocked || viewCount >= player.deck.length}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-green-600 rounded-full text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
                        +
          </button>
        </div>

        <p className="text-gray-400 text-xs mb-6 text-center">
          {t('dragToReorder')} {t('rightClickForActions')}
        </p>

        <div className="flex justify-center flex-wrap gap-4 mb-8 min-h-[140px] px-4">
          {displayCards.length === 0 ? (
            <p className="text-gray-500 italic">{t('deckEmpty')}</p>
          ) : (
            displayCards.map((card, index) => {
              // Find original index in localVisibleCards
              const originalIndex = localVisibleCards.findIndex(c => c.id === card.id)
              const isDragTarget = dragOverIndex === index && draggedIndex !== index
              const isDragging = draggedCardId === card.id

              return (
                <div
                  key={`${card.id || index}-${imageRefreshVersion}`}
                  draggable={true}
                  onDragStart={() => handleDragStart(card, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, index)}
                  onContextMenu={(e) => handleContextMenu(e, originalIndex)}
                  className="w-32 h-32 relative rounded-lg flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                  style={{
                    opacity: isDragging ? 0.5 : 1,
                    zIndex: isDragTarget ? 10 : 0,
                    transform: isDragTarget ? 'scale(1.05)' : (isDragging ? 'scale(0.95)' : 'scale(1)'),
                  }}
                >
                  <div className="absolute -top-3 -left-2 z-20 bg-gray-900 text-gray-400 text-xs font-bold px-2 py-0.5 rounded-full border border-gray-600 shadow-md">
                                        #{index + 1}
                  </div>

                  <div className="w-full h-full flex items-center justify-center">
                    <TopDeckCard
                      card={card}
                      playerColorMap={playerColorMap}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>

        <p className="text-gray-400 text-xs mb-4 text-center">
          {t('dragOutsideToMove')}
        </p>

        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-8 rounded shadow-lg transition-colors"
          >
            {t('done')}
          </button>
        </div>
      </div>

      {contextMenu && (
        <div className="fixed inset-0 z-[255]" onClick={handleCloseMenu} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseMenu}
          items={contextMenuItems}
        />
      )}
    </div>
  )
})

export { TopDeckView }
