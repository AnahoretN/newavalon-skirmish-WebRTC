import React, { useState, memo, useCallback, useMemo } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

interface JoinGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoin: (gameId: string) => void;
  games: { gameId: string; playerCount: number }[];
  onRefreshGames: () => void;
}

const JoinGameModal: React.FC<JoinGameModalProps> = memo(({ isOpen, onClose, onJoin, games, onRefreshGames }) => {
  const { t } = useLanguage()
  const [gameIdInput, setGameIdInput] = useState('')

  const handleJoinWithCode = useCallback(() => {
    if (gameIdInput.trim()) {
      onJoin(gameIdInput.trim().toUpperCase())
    }
  }, [gameIdInput, onJoin])

  const handleJoinGame = useCallback((gameId: string) => {
    onJoin(gameId)
  }, [onJoin])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setGameIdInput(e.target.value)
  }, [setGameIdInput])

  const renderedGames = useMemo(() => {
    return games.map(game => (
      <li key={game.gameId}>
        <button
          onClick={() => handleJoinGame(game.gameId)}
          className="w-full text-left p-vu-lg bg-gray-700 hover:bg-indigo-600 hover:border-indigo-400 border border-gray-600 rounded-vu-2 transition-all shadow-md group flex flex-col gap-vu-md"
        >
          <div className="flex justify-between items-center w-full">
            <span className="text-vu-xs font-bold text-gray-400 group-hover:text-indigo-200 uppercase tracking-wider">{t('gameCode')}</span>
            <span className="bg-gray-800 px-vu-md py-vu-min rounded-full text-vu-xs font-bold border border-gray-600 group-hover:border-indigo-300">
              {game.playerCount} / 4
            </span>
          </div>
          <span className="block font-mono text-vu-xl text-indigo-300 group-hover:text-white font-bold truncate">
            {game.gameId}
          </span>
        </button>
      </li>
    ))
  }, [games, handleJoinGame, t])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-vu-min">
      <div className="bg-gray-800 rounded-vu-2 p-vu-xl shadow-xl w-full max-w-vu-join-modal flex flex-col max-h-vu-join-modal">
        <div className="flex items-center gap-vu-md mb-vu-lg flex-shrink-0">
          <h2 className="text-vu-2xl font-bold">{t('joinGame')}</h2>
          <button
            onClick={onRefreshGames}
            className="w-vu-btn-sm h-vu-btn-sm flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
            title="Refresh games"
          >
            ↻
          </button>
        </div>

        <h3 className="text-vu-lg font-semibold text-gray-300 mb-vu-md flex-shrink-0">{t('activeGames')}</h3>
        <div className="flex-grow overflow-y-auto pr-vu-md border-b border-gray-700 pb-vu-lg mb-vu-lg custom-scrollbar min-h-vu-join-list">
          {games.length > 0 ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-vu-lg">
              {renderedGames}
            </ul>
          ) : (
            <div className="flex items-center justify-center h-full min-h-vu-join-empty">
              <p className="text-gray-400 text-center opacity-70">
                {t('noActiveGames')} <br/>
                <span className="text-vu-sm">{t('createOne')}</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          <h3 className="text-vu-lg font-semibold text-gray-300 mb-vu-md">{t('orJoinWithCode')}</h3>
          <div className="flex space-x-vu-md">
            <input
              type="text"
              value={gameIdInput}
              onChange={handleInputChange}
              placeholder={t('enterGameId')}
              className="flex-grow bg-gray-700 border border-gray-600 text-white font-mono rounded-vu-2 p-vu-md focus:ring-indigo-500 focus:border-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && handleJoinWithCode()}
            />
            <button
              onClick={handleJoinWithCode}
              disabled={!gameIdInput.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-vu-md px-vu-xl rounded disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {t('join')}
            </button>
          </div>

          <div className="flex justify-end mt-vu-xl">
            <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-vu-md px-vu-xl rounded transition-colors">
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export { JoinGameModal }
