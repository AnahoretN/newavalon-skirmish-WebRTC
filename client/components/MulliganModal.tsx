import React, { useState, useCallback, useEffect } from 'react'
import type { Card as CardType, Player as PlayerType } from '@/types'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'

interface MulliganModalProps {
  players: PlayerType[]
  localPlayerId: number | null
  onConfirm: (newHand: CardType[]) => void
  onExchangeCard?: (cardIndex: number) => void
  playerColorMap: Map<number, string>
  imageRefreshVersion?: number
  gameState?: any
}

const MAX_MULLIGAN_ATTEMPTS = 3

export const MulliganModal: React.FC<MulliganModalProps> = ({
  players,
  localPlayerId,
  onConfirm,
  onExchangeCard,
  playerColorMap,
  imageRefreshVersion,
  gameState,
}) => {
  const { t } = useLanguage()

  // Type-safe translation helper
  const tt = (key: string): string => {
    return t(key as any) as string
  }

  // Get player from gameState (fresh data)
  const freshPlayer = gameState?.players?.find((p: any) => p.id === localPlayerId)

  // Internal state - sync with fresh data from gameState
  const [hand, setHand] = useState<CardType[]>(freshPlayer?.hand || players.find(p => p.id === localPlayerId)?.hand || [])
  const [attempts, setAttempts] = useState<number>(freshPlayer?.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS)
  const [exchangingIndex, setExchangingIndex] = useState<number | null>(null)

  // Sync with gameState when it updates
  useEffect(() => {
    if (freshPlayer) {
      // Sync attempts
      const newAttempts = freshPlayer.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS
      if (newAttempts !== attempts) {
        setAttempts(newAttempts)
      }

      // Sync hand
      if (freshPlayer.hand && freshPlayer.hand.length > 0) {
        const currentHandIds = hand.map((c: any) => c.id).join(',')
        const newHandIds = freshPlayer.hand.map((c: any) => c.id).join(',')
        if (currentHandIds !== newHandIds) {
          setHand(freshPlayer.hand)
        }
      }
    }
  }, [freshPlayer, attempts, hand])

  const canExchange = attempts > 0

  // Check player confirmation status
  const confirmedCount = players.filter(p => p.hasMulliganed).length
  const totalPlayers = players.filter(p => !p.isDummy && !p.isSpectator).length

  const handleCardClick = useCallback((index: number) => {
    if (exchangingIndex !== null) {
      return // Already exchanging
    }
    if (!onExchangeCard) {
      return // No exchange handler provided
    }
    if (!canExchange) {
      return // No attempts left
    }

    setExchangingIndex(index)
    onExchangeCard(index)

    // Reset exchanging state after a short delay
    setTimeout(() => {
      setExchangingIndex(null)
    }, 500)
  }, [exchangingIndex, onExchangeCard, canExchange])

  const handleConfirm = useCallback(() => {
    onConfirm(hand)
  }, [hand, onConfirm])

  const canInteract = localPlayerId !== null && !freshPlayer?.hasMulliganed

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-center gap-3 mb-2">
          <h2 className="text-2xl font-bold text-white text-center">{tt('mulligan')}</h2>
          <span className="text-lg text-white font-medium mt-1">[Attempts: {attempts}]</span>
        </div>
        <p className="text-gray-400 mb-6 text-center">{tt('mulliganInstruction')}</p>

        {/* Cards grid - 2 rows by 3 columns */}
        <div className="grid grid-cols-3 gap-4 mb-6 max-w-[600px] mx-auto">
          {hand.map((card, index) => {
            const isClickable = canInteract && canExchange
            return (
              <div
                key={card.id}
                onClick={() => isClickable && handleCardClick(index)}
                className={`flex flex-col ${
                  isClickable ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <div className="aspect-square w-full">
                  <div data-card-image="true" className="w-full h-full">
                    <Card
                      card={card}
                      isFaceUp={true}
                      playerColorMap={playerColorMap as any}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                      disableActiveHighlights={true}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Confirm button - always visible, updates with player count */}
        <div className="flex justify-center">
          <button
            onClick={handleConfirm}
            disabled={!canInteract}
            className={`px-8 py-3 font-bold rounded-lg transition-colors ${
              canInteract
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            {tt('confirmHand')} [{confirmedCount}/{totalPlayers}]
          </button>
        </div>
      </div>
    </div>
  )
}
