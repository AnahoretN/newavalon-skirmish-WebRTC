
import React, { useState, useMemo, useEffect } from 'react'
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

  // Hide tooltip when any card drag starts
  useEffect(() => {
    const handleDragStart = () => {
      setTooltipCard(null)
    }

    window.addEventListener('cardDragStart', handleDragStart)
    return () => {
      window.removeEventListener('cardDragStart', handleDragStart)
    }
  }, [])

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
        abilityText: displayDesc,
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
        <div className="bg-gray-800 rounded-vu-5 p-vu-lg shadow-xl h-auto flex flex-col" onClick={e => e.stopPropagation()} style={{ width: 'calc(300 * var(--vu-base))', maxWidth: 'calc(400 * var(--vu-base))' }}>
          <div className="flex justify-between items-center mb-vu-md">
            <div className="flex flex-col">
              <h2 className="text-vu-2xl font-bold">{t('counters')}</h2>
              <p className="text-gray-400 text-vu-13">{t('holdRightClickViewHints')}</p>
            </div>
            <button
              onClick={onClose}
              className="py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
              style={{ fontSize: 'var(--vu-text-13)' }}
            >
              {t('close')}
            </button>
          </div>
          <div className="bg-gray-900 rounded p-vu-lg">
            <div className="grid grid-cols-4 gap-vu-min">
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
                    className="rounded-full border-vu-md border-white shadow-lg mx-auto relative select-none"
                    style={{
                      width: 'calc(45 * var(--vu-base))',
                      height: 'calc(45 * var(--vu-base))',
                      backgroundColor: 'rgb(107, 114, 128)', // gray-600 no opacity
                      cursor: canInteract ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt={displayLabel} className="w-full h-full object-contain p-vu-min pointer-events-none" />
                    ) : (
                      <span className={`font-bold text-white pointer-events-none ${isPower ? 'text-vu-sm' : 'text-vu-lg'}`} style={{ textShadow: '0 0 2px black' }}>
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
