
import React, { useRef, useState, useEffect } from 'react'
import { DeckType } from '@/types'
import type { DragItem, Card as CardType } from '@/types'
import { decksData } from '@/content'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'

interface TokensModalProps {
  isOpen: boolean;
  onClose: () => void;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: 'token_panel_item', data: { card: CardType }) => void;
  canInteract: boolean;
  anchorEl: { top: number; left: number } | null;
  imageRefreshVersion?: number;
  localPlayerId: number | null; // The player who is dragging the token (becomes token owner)
  activePlayerId?: number | null; // The active player (may be dummy)
  players?: any[]; // All players to check if active is dummy
}

export const TokensModal: React.FC<TokensModalProps> = ({ isOpen, onClose, setDraggedItem, openContextMenu, canInteract, anchorEl, imageRefreshVersion, localPlayerId, activePlayerId, players }) => {
  const { t } = useLanguage()
  const [draggedTokenId, setDraggedTokenId] = useState<string | null>(null)
  const [droppedOutside, setDroppedOutside] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedTokenRef = useRef<CardType | null>(null)

  useEffect(() => {
    if (isOpen) {
      setDraggedTokenId(null)
      setDroppedOutside(false)
      draggedTokenRef.current = null
    }
  }, [isOpen])

  if (!isOpen || !anchorEl) {
    return null
  }

  const tokenCards = (decksData[DeckType.Tokens] || []).filter(token => {
    return !token.allowedPanels || token.allowedPanels.includes('TOKEN_PANEL')
  })

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    top: `${anchorEl.top}px`,
    left: `${anchorEl.left}px`,
    zIndex: 60,
  }

  const handleDragStart = (token: CardType) => {
    if (!canInteract) {return}

    setDraggedTokenId(token.id)
    draggedTokenRef.current = token
    setDroppedOutside(false)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!draggedTokenRef.current || !modalRef.current) {return}

    const rect = modalRef.current.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    // If cursor is outside modal bounds, set up draggedItem and close modal
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      // Determine token owner: tokens belong to the active player (even if it's a dummy)
      // This ensures dummy player's tokens belong to the dummy, not the controlling player
      const activePlayer = players?.find(p => p.id === activePlayerId)
      const tokenOwnerId = (activePlayer?.isDummy && activePlayerId !== null)
        ? activePlayerId
        : (localPlayerId ?? undefined)

      setDraggedItem({
        card: draggedTokenRef.current,
        source: 'token_panel',
        ownerId: tokenOwnerId, // The active player owns the token (even if dummy)
      })

      setDroppedOutside(true)

      // Close modal immediately so drop can happen on underlying elements
      onClose()
    }
  }

  const handleDragEnd = () => {
    // Only cleanup if we didn't drop outside (outside case is handled by dragLeave)
    if (!droppedOutside) {
      setDraggedTokenId(null)
    }
    draggedTokenRef.current = null
  }

  return (
    <div
      style={modalStyle}
      className="pointer-events-auto"
      ref={modalRef}
      onDragLeave={handleDragLeave}
    >
      <div className="bg-gray-800 rounded-lg p-4 shadow-xl w-96 max-w-[90vw] h-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold">{t('tokens')}</h2>
          <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-3 rounded text-sm">
                {t('close')}
          </button>
        </div>
        <div className="flex-grow bg-gray-900 rounded p-2 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2">
            {tokenCards.map((token) => {
              const isBeingDragged = draggedTokenId === token.id
              const opacity = isBeingDragged ? 0.5 : 1

              return (
                <div
                  key={token.id}
                  style={{ opacity }}
                  draggable={canInteract}
                  onDragStart={() => handleDragStart(token)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => canInteract && openContextMenu(e, 'token_panel_item', { card: token })}
                  data-interactive={canInteract}
                  className={`w-24 h-24 transition-all rounded-lg ${canInteract ? 'cursor-grab active:cursor-grabbing hover:scale-105' : 'cursor-not-allowed'} ${isBeingDragged ? 'scale-95' : ''}`}
                >
                  <Card card={token} isFaceUp={true} playerColorMap={new Map()} imageRefreshVersion={imageRefreshVersion} />
                </div>
              )
            })}
          </div>
        </div>
        <p className="text-gray-400 text-xs mt-2 text-center">
          {t('dragOutsideToPlaceToken')}
        </p>
      </div>
    </div>
  )
}
