
import React, { useState, useMemo } from 'react'
import type { Card as CardType } from '@/types'
import { getAvailableCounters, STATUS_ICONS, STATUS_DESCRIPTIONS } from '@/constants'
import { Tooltip, CardTooltipContent } from './Tooltip'
import { useLanguage } from '@/contexts/LanguageContext'
import { getCardDatabaseMap } from '@/content'

interface CountersModalProps {
  isOpen: boolean;
  onClose: () => void;
  canInteract: boolean;
  anchorEl: { top: number; left: number } | null;
  imageRefreshVersion?: number;
  onCounterMouseDown: (type: string, e: React.MouseEvent) => void;
  cursorStack: { type: string; count: number } | null;
}

export const CountersModal: React.FC<CountersModalProps> = ({
  isOpen,
  onClose,
  canInteract,
  anchorEl,
  imageRefreshVersion,
  onCounterMouseDown,
  cursorStack
}) => {
  const { getCounterTranslation, t } = useLanguage()
  const [tooltipCard, setTooltipCard] = useState<CardType | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Get available counters dynamically - will update when data is loaded from server
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const availableCounters = useMemo(() => getAvailableCounters(), [getCardDatabaseMap().size])

  if (!isOpen || !anchorEl) {
    return null
  }

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    top: `${anchorEl.top}px`,
    left: `${anchorEl.left}px`,
    zIndex: 60,
  }

  const getIcon = (type: string) => {
    let iconUrl = STATUS_ICONS[type]
    if (iconUrl && imageRefreshVersion) {
      const separator = iconUrl.includes('?') ? '&' : '?'
      iconUrl = `${iconUrl}${separator}v=${imageRefreshVersion}`
    }
    return iconUrl
  }

  const handleMouseDown = (e: React.MouseEvent, type: string, label: string) => {
    if (e.button === 2) {
      const translated = getCounterTranslation(type)
      const displayLabel = translated ? translated.name : label
      const displayDesc = translated ? translated.description : (STATUS_DESCRIPTIONS[type] || '')

      const dummyCard: CardType = {
        id: `tooltip_${type}_${Date.now()}`,
        deck: 'counter',
        name: displayLabel,
        imageUrl: '',
        fallbackImage: '',
        power: 0,
        ability: displayDesc,
        types: [],
        statuses: [],
      }

      setTooltipCard(dummyCard)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    } else if (e.button === 0) {
      if (canInteract) {
        onCounterMouseDown(type, e)
      }
    }
  }

  const handleMouseUp = () => {
    setTooltipCard(null)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (tooltipCard) {
      setTooltipPos({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseLeave = () => {
    if (cursorStack) {
      onClose()
    }
    setTooltipCard(null)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      onClose()
    }
  }

  return (
    <>
      <div
        style={modalStyle}
        className="pointer-events-auto counter-modal-content"
        onMouseLeave={handleMouseLeave}
        onDragLeave={handleDragLeave}
      >
        <div className="bg-gray-800 rounded-lg p-4 shadow-xl w-80 max-w-[90vw] h-auto flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="mb-2">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">{t('counters')}</h2>
              <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-3 rounded text-sm">
                    {t('close')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('holdRightClickViewHints')}</p>
          </div>
          <div className="bg-gray-900 rounded p-4">
            <div className="grid grid-cols-4 gap-1">
              {availableCounters.map((counter) => {
                const iconUrl = getIcon(counter.type)
                const isPower = counter.type.startsWith('Power')

                const translated = getCounterTranslation(counter.type)
                const displayLabel = translated ? translated.name : counter.label

                return (
                  <button
                    key={counter.type}
                    onContextMenu={(e) => e.preventDefault()}
                    onMouseDown={(e) => handleMouseDown(e, counter.type, displayLabel)}
                    onMouseUp={handleMouseUp}
                    onMouseMove={handleMouseMove}
                    className="w-12 h-12 rounded-full border-2 border-white shadow-lg mx-auto relative select-none"
                    style={{
                      backgroundColor: 'rgb(107, 114, 128)', // gray-600 no opacity
                      cursor: canInteract ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt={displayLabel} className="w-full h-full object-contain p-1 pointer-events-none" />
                    ) : (
                      <span className={`font-bold text-white pointer-events-none ${isPower ? 'text-sm' : 'text-lg'}`} style={{ textShadow: '0 0 2px black' }}>
                        {isPower ? displayLabel : counter.type.charAt(0)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      {tooltipCard && (
        <Tooltip x={tooltipPos.x} y={tooltipPos.y}>
          <CardTooltipContent card={tooltipCard} statusDescriptions={STATUS_DESCRIPTIONS} />
        </Tooltip>
      )}
    </>
  )
}
