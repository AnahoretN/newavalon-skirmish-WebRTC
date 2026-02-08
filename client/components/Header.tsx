
import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { GameMode } from '@/types'
import type { GridSize } from '@/types'
import type { ConnectionStatus } from '@/hooks/useGameState'
import { TURN_PHASES, MAX_PLAYERS, PLAYER_COLORS } from '@/constants'
import { useLanguage } from '@/contexts/LanguageContext'
import type { TranslationResource } from '@/locales/types'
import { generateInviteLink } from '@/utils/inviteLinks'

interface HeaderProps {
  gameId: string | null;
  isGameStarted: boolean;
  onStartGame: () => void;
  onResetGame?: () => void;
  activeGridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  dummyPlayerCount: number;
  onDummyPlayerCountChange: (count: number) => void;
  realPlayerCount: number;
  connectionStatus: ConnectionStatus;
  onExitGame: () => void;
  onOpenTokensModal: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenCountersModal: (event: React.MouseEvent<HTMLButtonElement>) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  isPrivate: boolean;
  onPrivacyChange: (isPrivate: boolean) => void;
  isHost: boolean;
  hostId?: string | null;
  onSyncGame: () => void;
  currentPhase: number;
  onSetPhase: (index: number) => void;
  onNextPhase: () => void;
  onPrevPhase: () => void;
  activePlayerId: number | null;
  playerColorMap: Map<number, string>;
  isAutoAbilitiesEnabled: boolean;
  onToggleAutoAbilities: (enabled: boolean) => void;
  isAutoDrawEnabled: boolean;
  onToggleAutoDraw: (enabled: boolean) => void;
  hideDummyCards: boolean;
  onToggleHideDummyCards: (enabled: boolean) => void;
  currentRound?: number;
  turnNumber?: number;
}

const StatusIndicator = memo<{ connectionStatus: ConnectionStatus }>(({ connectionStatus }) => {
  return (
    <span className="relative flex h-3 w-3" title={connectionStatus}>
      {connectionStatus === 'Connected' && (
        <>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
        </>
      )}
      {connectionStatus === 'Connecting' && (
        <>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
        </>
      )}
      {connectionStatus === 'Disconnected' && (
        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
      )}
    </span>
  )
})

StatusIndicator.displayName = 'StatusIndicator'

const RoundTracker = memo<{
  currentRound: number;
  turnNumber: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  showTooltip: boolean;
  isGameStarted: boolean;
  t: (key: keyof TranslationResource['ui']) => string;
  }>(({ currentRound, turnNumber, onMouseEnter, onMouseLeave, showTooltip, isGameStarted, t }) => {
    const threshold = useMemo(() => (currentRound * 10) + 10, [currentRound])

    return (
      <div className="relative">
        <div
          className={`flex items-center bg-gray-800 rounded-lg px-3 py-1.5 border border-gray-700 shadow-md ${isGameStarted ? 'cursor-help' : 'opacity-50'}`}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <span className="text-yellow-500 font-bold text-sm tracking-wider">{t('round').toUpperCase()} {currentRound}</span>
          <span className="text-gray-500 mx-2">|</span>
          <span className="text-gray-300 text-xs font-mono">{t('turn').toUpperCase()} {turnNumber}</span>
        </div>

        {showTooltip && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[100] bg-gray-900 text-white p-3 rounded-lg shadow-xl border border-gray-700 text-sm whitespace-nowrap min-w-max">
            <div className="text-center">
              <p className="font-bold text-yellow-400 mb-1 whitespace-nowrap">{t('round')} {currentRound} {t('roundVictoryCondition')}</p>
              <p className="whitespace-nowrap">{t('reach')} <span className="font-bold text-white">{threshold} {t('scorePoints')}</span> {t('toWinRound')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('checkedAtFirstPlayer')}</p>
            </div>
          </div>
        )}
      </div>
    )
  })

RoundTracker.displayName = 'RoundTracker'

// Game Settings Dropdown Menu
const GameSettingsMenu = memo<{
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  isAutoAbilitiesEnabled: boolean;
  onToggleAutoAbilities: (enabled: boolean) => void;
  isAutoDrawEnabled: boolean;
  onToggleAutoDraw: (enabled: boolean) => void;
  dummyPlayerCount: number;
  onDummyPlayerCountChange: (count: number) => void;
  realPlayerCount: number;
  activeGridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  isGameStarted: boolean;
  isHost: boolean;
  hideDummyCards: boolean;
  onToggleHideDummyCards: (enabled: boolean) => void;
  t: (key: keyof TranslationResource['ui']) => string;
}>(({
  isOpen,
  onClose,
  anchorEl,
  isAutoAbilitiesEnabled,
  onToggleAutoAbilities,
  isAutoDrawEnabled,
  onToggleAutoDraw,
  dummyPlayerCount,
  onDummyPlayerCountChange,
  realPlayerCount,
  activeGridSize,
  onGridSizeChange,
  gameMode,
  onGameModeChange,
  isGameStarted,
  isHost,
  hideDummyCards,
  onToggleHideDummyCards,
  t,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const dummyOptions = useMemo(() => [0, 1, 2, 3], [])

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) {return}

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && !anchorEl?.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, anchorEl])

  if (!isOpen || !anchorEl) {return null}

  const rect = anchorEl.getBoundingClientRect()

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-4 min-w-[280px]"
      style={{ top: rect.bottom + 8, left: rect.left }}
    >
      <h3 className="text-white font-bold mb-4 text-sm border-b border-gray-700 pb-2">{t('gameSettings')}</h3>

      {/* Auto-Abilities */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-300 text-sm">{t('autoAbilities')}</span>
        <button
          onClick={() => onToggleAutoAbilities(!isAutoAbilitiesEnabled)}
          disabled={!isHost}
          className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
            isAutoAbilitiesEnabled
              ? 'bg-green-600 text-white'
              : 'bg-gray-600 text-gray-400'
          } ${!isHost ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isAutoAbilitiesEnabled ? t('on') : t('off')}
        </button>
      </div>

      {/* Auto-Draw */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-300 text-sm">{t('autoDraw')}</span>
        <button
          onClick={() => onToggleAutoDraw(!isAutoDrawEnabled)}
          className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
            isAutoDrawEnabled
              ? 'bg-green-600 text-white'
              : 'bg-gray-600 text-gray-400'
          }`}
        >
          {isAutoDrawEnabled ? t('on') : t('off')}
        </button>
      </div>

      {/* Dummy Players */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-300 text-sm">{t('dummyPlayers')}</span>
        <div className="flex gap-1 items-center">
          {dummyOptions.map(option => (
            <button
              key={option}
              onClick={() => onDummyPlayerCountChange(option)}
              disabled={!isHost || isGameStarted || (realPlayerCount + option > MAX_PLAYERS)}
              className={`w-8 h-8 rounded text-xs font-bold transition-colors ${
                dummyPlayerCount === option
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              } ${!isHost || isGameStarted || (realPlayerCount + option > MAX_PLAYERS) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {option}
            </button>
          ))}
          {/* Hide Dummy Cards toggle button */}
          <button
            onClick={() => onToggleHideDummyCards(!hideDummyCards)}
            className={`w-8 h-8 rounded text-xs font-bold transition-colors ${
              hideDummyCards
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
            title={t('hideDummyCardsTooltip')}
          >
            🙈
          </button>
        </div>
      </div>

      {/* Grid Size */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-300 text-sm">{t('gridSize')}</span>
        <div className="flex gap-1">
          {[4, 5, 6, 7].map(size => (
            <button
              key={size}
              onClick={() => onGridSizeChange(size as GridSize)}
              disabled={!isHost || isGameStarted}
              className={`w-10 h-8 rounded text-xs font-bold transition-colors ${
                activeGridSize === size
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              } ${!isHost || isGameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {size}x{size}
            </button>
          ))}
        </div>
      </div>

      {/* Game Mode */}
      <div className="flex items-center justify-between">
        <span className="text-gray-300 text-sm">{t('gameMode')}</span>
        <select
          value={gameMode}
          onChange={(e) => onGameModeChange(e.target.value as GameMode)}
          disabled={!isHost || isGameStarted}
          className="bg-gray-700 border border-gray-600 text-white text-xs rounded px-2 py-1 disabled:opacity-50"
        >
          <option value={GameMode.FreeForAll}>{t('ffa')}</option>
          <option value={GameMode.TwoVTwo}>{t('2v2')}</option>
          <option value={GameMode.ThreeVOne}>{t('3v1')}</option>
        </select>
      </div>
    </div>
  )
})

GameSettingsMenu.displayName = 'GameSettingsMenu'

// Invite Player Menu
const InvitePlayerMenu = memo<{
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  gameId: string | null;
  isPrivate: boolean;
  onPrivacyChange: (isPrivate: boolean) => void;
  isHost: boolean;
  isGameStarted: boolean;
  hostId?: string | null;
  t: (key: keyof TranslationResource['ui']) => string;
}>(({
  isOpen,
  onClose,
  anchorEl,
  gameId,
  isPrivate,
  onPrivacyChange,
  isHost,
  isGameStarted,
  hostId,
  t,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [gameIdCopySuccess, setGameIdCopySuccess] = useState(false)
  const [linkCopySuccess, setLinkCopySuccess] = useState(false)

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) {return}

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && !anchorEl?.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, anchorEl])

  // Reset copy success states when menu closes
  useEffect(() => {
    if (!isOpen) {
      setGameIdCopySuccess(false)
      setLinkCopySuccess(false)
    }
  }, [isOpen])

  const handleCopyGameId = useCallback(() => {
    if (!gameId) {return}

    navigator.clipboard.writeText(gameId).then(() => {
      setGameIdCopySuccess(true)
      setTimeout(() => setGameIdCopySuccess(false), 1500)
    }).catch(err => {
      console.error('Failed to copy:', err)
    })
  }, [gameId])

  const handleCopyLink = useCallback(() => {
    if (!gameId) {return}

    // Check if WebRTC mode is enabled
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    // For WebRTC mode, generate host link; otherwise use standard invite link
    let inviteLink: string
    if (isWebRTCMode && hostId) {
      // WebRTC P2P mode - use host link
      const baseUrl = window.location.origin + window.location.pathname
      inviteLink = `${baseUrl}#hostId=${encodeURIComponent(hostId)}`
    } else {
      // Standard server mode - use generateInviteLink
      const { url: link } = generateInviteLink(gameId, isGameStarted, isPrivate)
      inviteLink = link
    }

    // Copy to clipboard
    navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopySuccess(true)
      setTimeout(() => setLinkCopySuccess(false), 2000)
    }).catch(err => {
      console.error('Failed to copy:', err)
    })
  }, [gameId, isGameStarted, isPrivate, hostId])

  if (!isOpen || !anchorEl) {return null}

  const rect = anchorEl.getBoundingClientRect()

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-4 min-w-[300px]"
      style={{ top: rect.bottom + 8, left: Math.max(8, rect.right - 300) }}
    >
      <h3 className="text-white font-bold mb-4 text-sm border-b border-gray-700 pb-2">{t('invitePlayer')}</h3>

      {/* Game ID */}
      <div className="mb-4">
        <div className="bg-gray-900 rounded px-3 py-2 flex items-center justify-between gap-2">
          <span className="font-mono text-indigo-300 text-sm truncate flex-1">{gameId || '-'}</span>
          <button
            onClick={handleCopyGameId}
            disabled={!gameId}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
              gameIdCopySuccess
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            } ${!gameId ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={t('copy')}
          >
            {gameIdCopySuccess ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Privacy Toggle */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-gray-300 text-sm">{t('hiddenGame')}</span>
        <div className={`flex rounded overflow-hidden ${!isHost || isGameStarted ? 'opacity-50' : ''}`}>
          <button
            onClick={() => !isPrivate && onPrivacyChange(true)}
            disabled={!isHost || isGameStarted}
            className={`w-10 h-8 flex items-center justify-center transition-colors ${
              isPrivate ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            } ${!isHost || isGameStarted ? 'cursor-not-allowed' : ''}`}
            title={t('private')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M1 1l22 22"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            </svg>
          </button>
          <button
            onClick={() => isPrivate && onPrivacyChange(false)}
            disabled={!isHost || isGameStarted}
            className={`w-10 h-8 flex items-center justify-center transition-colors ${
              !isPrivate ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            } ${!isHost || isGameStarted ? 'cursor-not-allowed' : ''}`}
            title={t('public')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Copy Link Button */}
      <button
        onClick={handleCopyLink}
        disabled={!gameId}
        className={`w-full py-2 rounded text-sm font-bold transition-colors ${
          linkCopySuccess
            ? 'bg-green-600 text-white'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        } ${!gameId ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {linkCopySuccess ? t('copied') : t('copyInviteLink')}
      </button>
    </div>
  )
})

InvitePlayerMenu.displayName = 'InvitePlayerMenu'

const Header = memo<HeaderProps>(({
  gameId,
  isGameStarted,
  onStartGame,
  onResetGame,
  activeGridSize,
  onGridSizeChange,
  dummyPlayerCount,
  onDummyPlayerCountChange,
  realPlayerCount,
  connectionStatus,
  onExitGame,
  onOpenTokensModal,
  onOpenCountersModal,
  gameMode,
  onGameModeChange,
  isPrivate,
  onPrivacyChange,
  isHost,
  hostId,
  onSyncGame: _onSyncGame, // Currently unused in UI but may be needed later
  currentPhase,
  onSetPhase,
  onNextPhase,
  onPrevPhase,
  activePlayerId,
  playerColorMap,
  isAutoAbilitiesEnabled,
  onToggleAutoAbilities,
  isAutoDrawEnabled,
  onToggleAutoDraw,
  hideDummyCards,
  onToggleHideDummyCards,
  currentRound = 1,
  turnNumber = 1,
}) => {
  const { t } = useLanguage()
  const [showRoundTooltip, setShowRoundTooltip] = useState(false)

  // Game Settings Menu
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  // Invite Player Menu
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)

  const handleRoundMouseEnter = useCallback(() => {
    setShowRoundTooltip(true)
  }, [])

  const handleRoundMouseLeave = useCallback(() => {
    setShowRoundTooltip(false)
  }, [])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-14 bg-panel-bg bg-opacity-80 backdrop-blur-sm z-50 flex items-center justify-between px-4 shadow-lg">
        {/* Left side: Connection indicator + divider + Game Settings + Invite Player + divider */}
        <div className="flex items-center space-x-3">
          <StatusIndicator connectionStatus={connectionStatus} />

          {/* Vertical divider after connection indicator */}
          <div className="w-px h-8 bg-gray-600" />

          {/* Game Settings Button */}
          <button
            ref={settingsButtonRef}
            onClick={() => setSettingsMenuOpen(!settingsMenuOpen)}
            className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-3 rounded text-sm transition-colors"
          >
            {t('gameSettings')}
          </button>

          {/* Invite Player Button */}
          <button
            ref={inviteButtonRef}
            onClick={() => setInviteMenuOpen(!inviteMenuOpen)}
            disabled={isGameStarted}
            className={`font-medium py-2 px-3 rounded text-sm transition-colors ${
              isGameStarted
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {t('invitePlayer')}
          </button>
        </div>

        {/* Center-left: Round tracker (always visible, inactive until game starts) */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center" style={{ marginLeft: '-280px' }}>
          <RoundTracker
            currentRound={currentRound}
            turnNumber={turnNumber}
            onMouseEnter={handleRoundMouseEnter}
            onMouseLeave={handleRoundMouseLeave}
            showTooltip={showRoundTooltip}
            isGameStarted={isGameStarted}
            t={t}
          />
        </div>

        {/* Center: Phase display with all 4 phases and navigation arrows (always visible, strictly centered) */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center">
          <div className={`flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700 shadow-md ${!isGameStarted ? 'opacity-50' : ''}`}>
            <button
              onClick={onPrevPhase}
              disabled={!isGameStarted}
              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 mr-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6 L8 12 L15 18 Z" /></svg>
            </button>
            {TURN_PHASES.map((phase, index) => {
              // Phase mapping: TURN_PHASES indices (0-3) map to phases (1-4)
              // Preparation phase (0) is hidden and maps to Setup display (index 0)
              const visiblePhaseIndex = index + 1  // 1=Setup, 2=Main, 3=Commit, 4=Scoring
              const isCurrentPhase = currentPhase === visiblePhaseIndex || currentPhase === 0
              // Get active player's color for current phase highlight
              const activePlayerColor = activePlayerId !== null ? playerColorMap.get(activePlayerId) : undefined
              const colorClasses = activePlayerColor ? PLAYER_COLORS[activePlayerColor as keyof typeof PLAYER_COLORS]?.bg : 'bg-yellow-500'
              // Only show highlight color if game is started
              const bgClass = isGameStarted && isCurrentPhase ? `${colorClasses} text-white` : 'text-gray-400 hover:text-white'
              return (
                <div
                  key={phase}
                  onClick={() => isGameStarted && onSetPhase(visiblePhaseIndex)}
                  className={`
                    px-3 py-1.5 text-sm font-bold uppercase transition-all duration-200 cursor-pointer rounded
                    ${isCurrentPhase ? '' : ''}
                    ${bgClass}
                  `}
                >
                  {phase}
                </div>
              )
            })}
            <button
              onClick={onNextPhase}
              disabled={!isGameStarted}
              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ml-1"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6 L16 12 L9 18 Z" /></svg>
            </button>
          </div>
        </div>

        {/* Center-right: Tokens & Counters */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center" style={{ marginLeft: '280px' }}>
          <button
            onClick={onOpenTokensModal}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-3 rounded text-sm"
          >
            {t('tokens')}
          </button>
          <button
            onClick={onOpenCountersModal}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-3 rounded text-sm ml-[5px]"
          >
            {t('counters')}
          </button>
        </div>

        {/* Right side: Start Game + divider + Exit */}
        <div className="flex items-center space-x-2">
          {/* Start Game button */}
          {!isGameStarted && (
            <button
              onClick={onStartGame}
              disabled={!isHost}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded text-sm animate-pulse disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed disabled:animate-none"
            >
              {t('startGame')}
            </button>
          )}

          {/* Reset Game button (only visible when game is started) */}
          {isGameStarted && onResetGame && (
            <button
              onClick={onResetGame}
              disabled={!isHost}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded text-sm disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed"
              title="Reset game to lobby (keeps players and decks)"
            >
              {t('resetGame')}
            </button>
          )}

          {/* Vertical divider */}
          <div className="w-px h-8 bg-gray-600" />

          {/* Exit button */}
          <button
            onClick={onExitGame}
            className={`bg-${isGameStarted ? 'red' : 'gray'}-600 hover:bg-${isGameStarted ? 'red' : 'gray'}-700 text-white font-bold py-2 px-4 rounded text-sm`}
          >
            {t('exit')}
          </button>
        </div>
      </header>

      {/* Game Settings Menu */}
      <GameSettingsMenu
        isOpen={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        anchorEl={settingsButtonRef.current}
        isAutoAbilitiesEnabled={isAutoAbilitiesEnabled}
        onToggleAutoAbilities={onToggleAutoAbilities}
        isAutoDrawEnabled={isAutoDrawEnabled}
        onToggleAutoDraw={onToggleAutoDraw}
        dummyPlayerCount={dummyPlayerCount}
        onDummyPlayerCountChange={onDummyPlayerCountChange}
        realPlayerCount={realPlayerCount}
        activeGridSize={activeGridSize}
        onGridSizeChange={onGridSizeChange}
        gameMode={gameMode}
        onGameModeChange={onGameModeChange}
        isGameStarted={isGameStarted}
        isHost={isHost}
        hideDummyCards={hideDummyCards}
        onToggleHideDummyCards={onToggleHideDummyCards}
        t={t}
      />

      {/* Invite Player Menu */}
      <InvitePlayerMenu
        isOpen={inviteMenuOpen}
        onClose={() => setInviteMenuOpen(false)}
        anchorEl={inviteButtonRef.current}
        gameId={gameId}
        isPrivate={isPrivate}
        onPrivacyChange={onPrivacyChange}
        isHost={isHost}
        isGameStarted={isGameStarted}
        hostId={hostId}
        t={t}
      />
    </>
  )
})

export { Header }
