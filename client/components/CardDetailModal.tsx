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
  // Filter out internal statuses - they are invisible to players:
  // - readyDeploy, readySetup, readyCommit: control ability availability
  // - deployUsedThisTurn, setupUsedThisTurn, commitUsedThisTurn: track ability usage
  const hiddenStatusTypes = ['readyDeploy', 'readySetup', 'readyCommit', 'deployUsedThisTurn', 'setupUsedThisTurn', 'commitUsedThisTurn']
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
      <div onClick={e => e.stopPropagation()} className={`bg-gray-800 rounded-vu-5 shadow-2xl w-full ${themeColor} border-vu-5`} style={{ maxWidth: 'calc(var(--vu-modal-xl) * 2)', maxHeight: '90vh' }}>
        {/* Main Container: Image (left) + Text+Button (right) */}
        <div className="flex">
          {/* Left: Image Container - 3/5 width */}
          <div className="w-3/5 p-vu-lg">
            {currentImageSrc ? (
              <img src={currentImageSrc} onError={handleImageError} alt={displayCard.name} className="w-full h-auto object-contain rounded-vu-5 max-h-[85vh]" />
            ) : (
              <div className="w-full h-40 bg-gray-700 rounded-vu-5 flex items-center justify-center text-vu-3xl font-bold text-center p-vu-lg">{displayCard.name}</div>
            )}
          </div>

          {/* Right: Text Container + Close Button - 2/5 width */}
          <div className="w-2/5 flex flex-col p-vu-lg">
            {/* Scrollable text container */}
            <div className="flex flex-col gap-vu-min overflow-y-auto pr-vu-md flex-grow text-left">
              {/* Title & Deck */}
              <div>
                <h2 className="text-vu-20 font-bold">{displayCard.name}</h2>
                <p className="text-vu-13 text-gray-400 capitalize">{displayCard.types?.join(', ') || `${displayCard.deck} Card`}</p>
              </div>

              {/* Core Stats */}
              <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                <p><strong className="text-indigo-400 text-vu-15">Power:</strong> <span className="text-vu-15 font-bold">{displayCard.power}</span></p>
                <p className="mt-vu-md leading-none"><strong className="text-indigo-400 text-vu-15">Ability:</strong> <span className="text-gray-200 text-vu-13">{formatAbilityText(displayCard.abilityText, abilityKeywords)}</span></p>
              </div>

              {/* Owner Info */}
              {ownerPlayer && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-2 text-vu-13">
                  <p><strong className="text-indigo-400 text-vu-15">Owner:</strong> {ownerPlayer.name}</p>
                  {teamName && <p className="mt-vu-min"><strong className="text-indigo-400 text-vu-15">Team:</strong> {teamName}</p>}
                </div>
              )}

              {/* Statuses */}
              {card.statuses && card.statuses.length > 0 && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                  <h3 className="text-indigo-400 text-vu-15 font-bold mb-vu-md">Statuses</h3>
                  <ul className="space-y-vu-md text-vu-13 max-h-50 overflow-y-auto pr-vu-md">
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
                          <strong className="text-gray-200">{type}</strong> <span className="text-gray-400 text-vu-13 ml-vu-min">- {breakdown}</span>
                          <p className="text-gray-400 text-vu-13 pl-vu-md mt-vu-min leading-none">{description}</p>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Flavor Text */}
              {displayCard.flavorText && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                  <h3 className="text-indigo-400 text-vu-15 font-bold mb-vu-min">Flavor Text</h3>
                  <p className="italic text-gray-400 leading-none">{displayCard.flavorText?.split('\n').map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}</p>
                </div>
              )}
            </div>

            {/* Close Button below text container */}
            <div className="mt-vu-md">
              <button
                onClick={onClose}
                className="w-full py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                style={{ fontSize: 'var(--vu-text-13)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
