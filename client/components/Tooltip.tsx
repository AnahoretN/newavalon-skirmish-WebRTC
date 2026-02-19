
/**
 * @file A generic, reusable tooltip component and the specific card content renderer.
 */

import React, { useRef, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Card } from '@/types'
import { formatAbilityText } from '@/utils/textFormatters'
import { useLanguage } from '@/contexts/LanguageContext'

/**
 * Props for the Tooltip component.
 */
interface TooltipProps {
  x: number;
  y: number;
  children: React.ReactNode;
}

/**
 * A generic tooltip component that displays content at specific coordinates
 * and automatically adjusts its position to stay within the viewport.
 * Uses a Portal to render at the body level to bypass stacking contexts.
 */
export const Tooltip: React.FC<TooltipProps> = ({ x, y, children }) => {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: y + 20, left: x + 20 })

  // useLayoutEffect ensures that the position is calculated after render but before the browser paints,
  // preventing visual flickering.
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const { innerWidth, innerHeight } = window
      const { offsetWidth, offsetHeight } = tooltipRef.current

      let newLeft = x + 20
      // If the tooltip would go off the right edge, flip it to the left of the cursor.
      if (newLeft + offsetWidth > innerWidth) {
        newLeft = x - offsetWidth - 20
      }
      // Ensure it doesn't go off the left edge
      if (newLeft < 5) {
        newLeft = 5
      }

      let newTop = y + 20
      // If the tooltip would go off the bottom edge, flip it to above the cursor.
      if (newTop + offsetHeight > innerHeight) {
        newTop = y - offsetHeight - 20
      }
      // Ensure it doesn't go off the top edge
      if (newTop < 5) {
        newTop = 5
      }

      setPosition({ top: newTop, left: newLeft })
    }
  }, [x, y, children]) // Rerun when content changes, as its size might change.

  return createPortal(
    <div
      ref={tooltipRef}
      // Removed fixed max-w-xs to allow children to dictate width (up to a reasonable screen limit)
      // Added w-max to try to hug content, but max-w constraints in children prevent overflow.
      className="fixed bg-gray-900 border border-gray-700 rounded-md shadow-lg z-[99999] p-3 text-white text-base pointer-events-none transition-opacity duration-100"
      style={{ top: position.top, left: position.left, opacity: 1 }}
    >
      {children}
    </div>,
    document.body,
  )
}

interface CardTooltipContentProps {
  card: Card;
  statusDescriptions?: Record<string, string>; // Optional mapping for detailed status descriptions
  className?: string; // Allow overriding styles for inline display
  hideOwner?: boolean; // Optionally hide the owner line
  powerPosition?: 'default' | 'inner'; // Controls where the power icon sits. 'inner' is for list mode (2px padding).
}

export const CardTooltipContent: React.FC<CardTooltipContentProps> = ({ card, statusDescriptions, className, hideOwner = false, powerPosition = 'default' }) => {
  const { resources, getCardTranslation } = useLanguage()
  const abilityKeywords = resources.abilityKeywords
  const cardTypes = resources.cardTypes

  // Get localized card data if available
  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayName = localized?.name || card.name
  const displayAbility = localized?.ability || card.ability

  // Calculate the display string for types with translation.
  // If there are specific types, translate and join them.
  // If no types, default to "{Deck} Card", UNLESS it's a 'counter' deck, in which case we show nothing (per user request).
  const typeString = card.types?.length
    ? card.types.map(type => cardTypes[type as keyof typeof cardTypes] || type).join(', ')
    : (card.deck === 'counter' ? '' : `${card.deck} Card`)

  // Group statuses by type and count them
  // Filter out readiness statuses (readyDeploy, readySetup, readyCommit) - they are invisible to players
  const hiddenStatusTypes = ['readyDeploy', 'readySetup', 'readyCommit']
  const statusCountsByType = (card.statuses ?? []).reduce((acc, status) => {
    // Skip readiness statuses - they should not be displayed
    if (hiddenStatusTypes.includes(status.type)) {
      return acc
    }
    acc[status.type] = (acc[status.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const hasStatuses = Object.keys(statusCountsByType).length > 0
  const ownerName = card.ownerName || (card.ownerId ? `Player ${card.ownerId}` : null)

  // Heuristic to determine if we should enforce a wrap width (approx 35 chars).
  // 16rem is roughly 256px, which fits ~35 characters of standard text.
  const abilityLen = card.ability ? card.ability.length : 0
  // Estimate status text length (approx 10 chars per status group)
  const statusLen = hasStatuses ? Object.keys(statusCountsByType).length * 10 : 0

  // Constraint set to 35 characters to trigger wrapping
  const isLongContent = abilityLen > 35 || statusLen > 35

  // Default base classes
  const baseClasses = className || 'relative flex flex-col text-left w-max max-w-[90vw]'

  // Power positioning styles for inner mode (list mode)
  const powerStyles = powerPosition === 'inner' ? {
    powerContainer: 'absolute top-[2px] right-[2px] w-4 h-4 rounded-full bg-gray-700 border border-gray-500 flex items-center justify-center text-xs font-bold',
  } : null

  return (
    <div className={baseClasses}>
      {/* Header Section: Name & Type */}
      {/* truncate ensures long names fit without causing horizontal scroll */}
      <div className="mb-1 pr-1 relative min-w-0">
        <div className="font-bold text-white text-lg leading-tight mb-0.5 truncate">
          {displayName}
        </div>
        {typeString && (
          <div className="text-xs text-gray-400 font-semibold truncate">
            {typeString}
          </div>
        )}
        {/* Power display for inner positioning (list mode) */}
        {powerStyles && card.power && card.power > 0 && (
          <div className={powerStyles.powerContainer}>
            {card.power}
          </div>
        )}
      </div>

      {/* Body Section: Ability, Statuses, Owner */}
      {/*
          Logic:
          - If content is long (>35 chars), set w-[16rem] (approx 256px) to force wrapping at ~35 chars.
          - If content is short, let it auto-size (shrink wrap).
          - whitespace-normal allows wrapping.
          - If Title is wider than 16rem, the parent (w-max) expands.
            This body section will align to the left inside that space.
      */}
      <div className={`flex flex-col ${!className && isLongContent ? 'w-[16rem]' : 'w-full'} whitespace-normal break-words`}>

        {/* Divider above Ability - Custom spacing: 1px top, 5px bottom */}
        {displayAbility && <hr className="border-gray-600 mt-[0px] mb-[2px]" />}

        {/* Ability Text */}
        {displayAbility && (
          <div className="text-sm text-gray-200 leading-snug">
            {formatAbilityText(displayAbility, abilityKeywords)}
          </div>
        )}

        {/* Divider below Ability */}
        {displayAbility && <hr className="border-gray-600 my-[4px]" />}

        {/* Statuses Section */}
        {hasStatuses && (
          <div className="text-xs text-gray-200 leading-snug">
            {Object.entries(statusCountsByType).map(([type, count], index, array) => (
              <span key={type}>
                <span className="font-bold text-indigo-300">{type}</span>
                {count > 1 && <span className="text-gray-400 ml-1">(x{count})</span>}
                {statusDescriptions?.[type] && (
                  <span className="text-gray-400 ml-1">({statusDescriptions[type]})</span>
                )}
                {index < array.length - 1 ? <span className="text-gray-400 mr-1">, </span> : ''}
              </span>
            ))}
          </div>
        )}

        {/* Divider above Owner */}
        {hasStatuses && ownerName && !hideOwner && <hr className="border-gray-600 my-[2px]" />}

        {/* Owner Section */}
        {ownerName && !hideOwner && (
          <div className="text-xs text-gray-500 font-semibold">
              Owner: <span className="text-gray-300">{ownerName}</span>
          </div>
        )}
      </div>
    </div>
  )
}
