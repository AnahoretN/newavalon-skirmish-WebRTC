/**
 * @file Renders a modal to ask for permission to reveal a card.
 */
import React from 'react'
import type { Player } from '@/types'

interface RevealRequestModalProps {
  fromPlayer: Player;
  cardCount: number;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * A modal that appears for a card's owner when another player requests to see it.
 * @param {RevealRequestModalProps} props The properties for the component.
 * @returns {React.ReactElement} The rendered modal.
 */
export const RevealRequestModal: React.FC<RevealRequestModalProps> = ({ fromPlayer, cardCount, onAccept, onDecline }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[105]">
      <div className="bg-gray-800 rounded-vu-2 p-8 shadow-xl w-full max-w-md text-center">
        <h2 className="text-2xl font-bold mb-4">Reveal Request</h2>
        <p className="text-gray-300 mb-6">
          <span className="font-bold">{fromPlayer.name}</span> would like to see {cardCount > 1 ? `${cardCount} of your hidden cards` : 'one of your hidden cards'}.
        </p>
        <div className="flex justify-center space-x-4">
          <button onClick={onDecline} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded transition-colors">
            Decline
          </button>
          <button onClick={onAccept} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded transition-colors">
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
