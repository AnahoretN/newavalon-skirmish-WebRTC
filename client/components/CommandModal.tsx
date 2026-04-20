import React from 'react'
import type { Card, PlayerColor } from '@/types'
import { Card as CardComponent } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatAbilityText } from '@/utils/textFormatters'

interface CommandModalProps {
    isOpen: boolean;
    card: Card;
    playerColorMap: Map<number, PlayerColor>;
    onConfirm: (optionIndex: number) => void;
    onCancel: () => void;
}

export const CommandModal: React.FC<CommandModalProps> = ({ isOpen, card, playerColorMap, onConfirm, onCancel }) => {
  const { getCardTranslation, t, resources } = useLanguage()
  const abilityKeywords = resources.abilityKeywords

  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card
  const abilityText = displayCard.abilityText || ''

  // Parse Ability Text for N Options
  // Expected format: "● Option 1 Text... \n● Option 2 Text..."
  // Extracts text starting from ● up to the next ● or end of string.
  const parsedOptions = React.useMemo(() => {
    const parts = abilityText.split('●').map(s => s.trim()).filter(s => s.length > 0)
    return parts
  }, [abilityText])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[200] backdrop-blur-sm">
      <div className="bg-gray-900 rounded-vu-2 border-vu-md border-yellow-500 shadow-2xl p-vu-xl w-full max-w-vu-modal-xl flex gap-vu-xl">

        {/* Left: Card View */}
        <div className="w-1/3 flex flex-col items-center justify-center border-r border-gray-700 pr-vu-xl">
          <div className="w-vu-card-xl h-vu-card-xl relative transform hover:scale-105 transition-transform duration-300">
            <CardComponent card={displayCard} isFaceUp={true} playerColorMap={playerColorMap} disableTooltip={true} />
          </div>
          <h2 className="text-vu-3xl font-bold text-yellow-500 mt-vu-xl text-center leading-tight">{displayCard.name}</h2>
        </div>

        {/* Right: Selection Interface */}
        <div className="w-2/3 flex flex-col">
          <h3 className="text-vu-2xl font-bold text-white mb-vu-lg border-b border-gray-700 pb-vu-md">Select Module</h3>

          <div className="flex flex-col gap-vu-md flex-grow justify-center overflow-y-auto max-h-[60vh] pr-vu-md">
            {parsedOptions.map((optionText, index) => (
              <button
                key={index}
                onClick={() => onConfirm(index)}
                className="group relative bg-gray-800 hover:bg-indigo-900 border-vu-md border-gray-600 hover:border-indigo-400 rounded-vu-2 p-vu-lg transition-all duration-200 text-left shadow-lg hover:shadow-indigo-500/20 flex items-start gap-vu-lg shrink-0"
              >
                <div className="bg-gray-700 text-gray-400 w-vu-icon-md h-vu-icon-md flex-shrink-0 flex items-center justify-center rounded-full font-bold text-vu-xs group-hover:bg-indigo-500 group-hover:text-white transition-colors mt-vu-min">
                  {index + 1}
                </div>
                <div className="text-gray-200 group-hover:text-white text-vu-lg font-medium leading-snug">
                  {formatAbilityText(optionText, abilityKeywords)}
                </div>
              </button>
            ))}
            {parsedOptions.length === 0 && (
              <div className="text-gray-500 text-center italic">No selectable modules found on this card.</div>
            )}
          </div>

          <div className="mt-vu-xl flex justify-end">
            <button
              onClick={onCancel}
              className="px-vu-xl py-vu-md rounded bg-gray-700 hover:bg-gray-600 text-white font-bold transition-colors text-vu-sm"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
