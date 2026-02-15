/**
 * @file Renders a modal for a detailed view of a single card.
 */
import React, { useMemo, useState, useEffect } from 'react'
import type { Card as CardType, Player } from '@/types'
import { PLAYER_COLORS, DECK_THEMES } from '@/constants'
import { formatAbilityText } from '@/utils/textFormatters'
import { useLanguage } from '@/contexts/LanguageContext'

interface CardDetailModalProps {
  card: CardType;
  ownerPlayer?: Player;
  onClose: () => void;
  statusDescriptions: Record<string, string>;
  allPlayers: Player[];
  imageRefreshVersion?: number;
}

/**
 * A modal that displays detailed information about a card.
 * @param {CardDetailModalProps} props The properties for the component.
 * @returns {React.ReactElement} The rendered modal.
 */
export const CardDetailModal: React.FC<CardDetailModalProps> = ({ card, ownerPlayer, onClose, statusDescriptions, allPlayers, imageRefreshVersion }) => {
  const { getCardTranslation, getCounterTranslation, resources } = useLanguage()
  const abilityKeywords = resources.abilityKeywords
  const [currentImageSrc, setCurrentImageSrc] = useState(card.imageUrl)

  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card

  useEffect(() => {
    let src = card.imageUrl
    if (imageRefreshVersion && src) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${imageRefreshVersion}`
    }
    setCurrentImageSrc(src)
  }, [card.imageUrl, imageRefreshVersion])

  const handleImageError = () => {
    let fallback = card.fallbackImage
    if (imageRefreshVersion && fallback) {
      const separator = fallback.includes('?') ? '&' : '?'
      fallback = `${fallback}${separator}v=${imageRefreshVersion}`
    }

    if (currentImageSrc !== fallback) {
      setCurrentImageSrc(fallback ?? '')
    }
  }

  const ownerColorName = ownerPlayer?.color
  const themeColor = ownerColorName
    ? PLAYER_COLORS[ownerColorName]?.border || DECK_THEMES[card.deck as keyof typeof DECK_THEMES]?.color || 'border-gray-300'
    : DECK_THEMES[card.deck as keyof typeof DECK_THEMES]?.color || 'border-gray-300'

  const teamName = useMemo(() => {
    if (ownerPlayer?.teamId === undefined) {
      return null
    }
    return `Team ${ownerPlayer.teamId}`
  }, [ownerPlayer])

  // Aggregate statuses by type
  // Filter out readiness statuses (readyDeploy, readySetup, readyCommit) - they are invisible to players
  const hiddenStatusTypes = ['readyDeploy', 'readySetup', 'readyCommit']
  const statusGroups: Record<string, number[]> = (card.statuses ?? []).reduce(
    (acc, status) => {
      // Skip readiness statuses - they should not be displayed
      if (hiddenStatusTypes.includes(status.type)) {
        return acc
      }
      if (!acc[status.type]) {
        acc[status.type] = []
      }
      acc[status.type].push(status.addedByPlayerId)
      return acc
    },
    {} as Record<string, number[]>,
  )

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[300]">
      <div onClick={e => e.stopPropagation()} className={`bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl h-[40rem] p-6 flex gap-6 border-4 ${themeColor}`}>
        {/* Left: Image */}
        <div className="w-1/2 h-full flex-shrink-0">
          {currentImageSrc ? (
            <img src={currentImageSrc} onError={handleImageError} alt={displayCard.name} className="w-full h-full object-contain rounded-lg" />
          ) : (
            <div className="w-full h-full bg-gray-700 rounded-lg flex items-center justify-center text-2xl font-bold text-center p-4">{displayCard.name}</div>
          )}
        </div>
        {/* Right: Details */}
        <div className="w-1/2 h-full flex flex-col gap-4 overflow-y-auto pr-2 text-left">
          {/* Title & Deck */}
          <div>
            <h2 className="text-4xl font-bold">{displayCard.name}</h2>
            <p className="text-lg text-gray-400 capitalize">{displayCard.types?.join(', ') || `${displayCard.deck} Card`}</p>
          </div>

          {/* Core Stats */}
          <div className="bg-gray-900 p-4 rounded-lg">
            <p><strong className="text-indigo-400 text-lg">Power:</strong> <span className="text-xl font-bold">{displayCard.power}</span></p>
            <p className="mt-2"><strong className="text-indigo-400 text-lg">Ability:</strong> <span className="text-gray-200 text-base">{formatAbilityText(displayCard.ability, abilityKeywords)}</span></p>
          </div>

          {/* Owner Info */}
          {ownerPlayer && (
            <div className="bg-gray-900 p-4 rounded-lg text-sm">
              <p><strong className="text-indigo-400">Owner:</strong> {ownerPlayer.name}</p>
              {teamName && <p className="mt-1"><strong className="text-indigo-400">Team:</strong> {teamName}</p>}
            </div>
          )}

          {/* Statuses */}
          {card.statuses && card.statuses.length > 0 && (
            <div className="bg-gray-900 p-4 rounded-lg">
              <h3 className="text-indigo-400 text-lg font-bold mb-2">Statuses</h3>
              <ul className="space-y-2 text-sm">
                {Object.entries(statusGroups).map(([type, owners]) => {
                  // Calculate counts per player
                  const playerCounts = owners.reduce((acc, playerId) => {
                    acc[playerId] = (acc[playerId] || 0) + 1
                    return acc
                  }, {} as Record<number, number>)

                  const breakdown = Object.entries(playerCounts).map(([pid, count]) => {
                    const pName = allPlayers.find(p => p.id === Number(pid))?.name || `Player ${pid}`
                    return `${pName} (x${count})`
                  }).join(', ')

                  const counterDef = getCounterTranslation(type)
                  const description = counterDef ? counterDef.description : (statusDescriptions[type] || 'No description available.')

                  return (
                    <li key={type}>
                      <strong className="text-gray-200">{type}</strong> <span className="text-gray-400 text-xs ml-1">- {breakdown}</span>
                      <p className="text-gray-400 text-xs pl-2 mt-0.5">{description}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Flavor Text */}
          {displayCard.flavorText && (
            <div className="bg-gray-900 p-4 rounded-lg">
              <h3 className="text-indigo-400 font-bold mb-1">Flavor Text</h3>
              <p className="italic text-gray-400">{displayCard.flavorText?.split('\n').map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}</p>
            </div>
          )}

          <button onClick={onClose} className="mt-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded self-end">
                Close
          </button>
        </div>
      </div>
    </div>
  )
}
