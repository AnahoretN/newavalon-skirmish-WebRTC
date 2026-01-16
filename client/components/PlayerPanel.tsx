import React, { memo, useRef, useState, useEffect, useMemo } from 'react'
import { DeckType as DeckTypeEnum } from '@/types'
import type { Player, PlayerColor, Card as CardType, DragItem, DropTarget, CustomDeckFile, ContextMenuParams } from '@/types'
import { PLAYER_COLORS, GAME_ICONS, PLAYER_COLOR_RGB } from '@/constants'
import { getSelectableDecks } from '@/content'
import { Card as CardComponent } from './Card'
import { CardTooltipContent } from './Tooltip'
import { useLanguage } from '@/contexts/LanguageContext'
import { validateDeckData } from '@/utils/deckValidation'

type ContextMenuData =
  | { player: Player }
  | { card: CardType; player: Player }
  | { card: CardType; player: Player; cardIndex: number }

interface PlayerPanelProps {
  player: Player;
  isLocalPlayer: boolean;
  localPlayerId: number | null;
  isSpectator: boolean;
  isGameStarted: boolean;
  onNameChange: (name: string) => void;
  onColorChange: (color: PlayerColor) => void;
  onScoreChange: (delta: number) => void;
  onDeckChange: (deckType: DeckTypeEnum) => void;
  onLoadCustomDeck: (deckFile: CustomDeckFile) => void;
  onDrawCard: () => void;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: ContextMenuParams['type'], data: ContextMenuData) => void;
  onHandCardDoubleClick: (player: Player, card: CardType, index: number) => void;
  playerColorMap: Map<number, PlayerColor>;
  allPlayers: Player[];
  localPlayerTeamId?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  onToggleActivePlayer: (playerId: number) => void;
  imageRefreshVersion: number;
  layoutMode: 'list-local' | 'list-remote';
  onCardClick?: (player: Player, card: CardType, index: number) => void;
  validHandTargets?: { playerId: number, cardIndex: number }[];
  onAnnouncedCardDoubleClick?: (player: Player, card: CardType) => void;
  currentPhase: number;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  roundWinners?: Record<number, number[]>;
  startingPlayerId?: number | null; // Aligned with GameState type (null when not set)
  onDeckClick?: (playerId: number) => void;
  isDeckSelectable?: boolean;
  hideDummyCards?: boolean; // If true, hide dummy player cards like real players
}

const ColorPicker: React.FC<{ player: Player, canEditSettings: boolean, selectedColors: Set<PlayerColor>, onColorChange: (c: PlayerColor) => void, compact?: boolean }> = memo(({ player, canEditSettings, selectedColors, onColorChange, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const sizeClass = compact ? 'w-4 h-4' : 'w-9 h-9'
  const roundedClass = compact ? 'rounded-sm' : 'rounded-md'
  const borderClass = compact ? 'border' : 'border-2'
  const borderColorClass = compact ? 'border-white/40' : 'border-gray-600'
  const paddingClass = compact ? 'p-0' : 'p-0'

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => canEditSettings && setIsOpen(!isOpen)}
        className={`${sizeClass} ${paddingClass} ${roundedClass} ${PLAYER_COLORS[player.color].bg} ${borderClass} ${borderColorClass} ${canEditSettings ? 'hover:border-white cursor-pointer' : 'cursor-default'} transition-all shadow-md flex items-center justify-center group flex-shrink-0`}
        title={canEditSettings ? "Change Color" : player.color}
      >
        {!compact && canEditSettings && (
          <svg className={`w-4 h-4 text-white/60 group-hover:text-white transition-colors drop-shadow-md`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 p-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 grid grid-cols-4 gap-2 w-max animate-fade-in">
          {Object.keys(PLAYER_COLORS).map((colorKey) => {
            const color = colorKey as PlayerColor
            const isTaken = selectedColors.has(color) && player.color !== color
            const isCurrent = player.color === color

            return (
              <button
                key={color}
                onClick={() => {
                  if (!isTaken) {
                    onColorChange(color)
                    setIsOpen(false)
                  }
                }}
                disabled={isTaken}
                className={`w-8 h-8 rounded-md ${PLAYER_COLORS[color].bg} border-2 ${
                  isCurrent ? 'border-white ring-1 ring-white scale-110' :
                    isTaken ? 'border-transparent opacity-20 cursor-not-allowed' :
                      'border-transparent hover:border-white hover:scale-110 hover:shadow-lg'
                } transition-all duration-150`}
                title={color}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

const DropZone: React.FC<{ onDrop: () => void, className?: string, isOverClassName?: string, children: React.ReactNode, onContextMenu?: (e: React.MouseEvent) => void }> = ({ onDrop, className, isOverClassName, children, onContextMenu }) => {
  const [isOver, setIsOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsOver(false)
        onDrop()
      }}
      onContextMenu={onContextMenu}
      className={`${className || ''} ${isOver ? (isOverClassName || '') : ''}`}
    >
      {children}
    </div>
  )
}

const RemoteScore: React.FC<{ score: number, onChange: (delta: number) => void, canEdit: boolean }> = ({ score, onChange, canEdit }) => (
  <div className="w-full h-full aspect-square bg-gray-800 rounded flex flex-col items-center text-white select-none overflow-hidden">
    <button
      onClick={() => canEdit && onChange(1)}
      disabled={!canEdit}
      className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors text-base sm:text-xl font-bold disabled:opacity-50 disabled:cursor-default leading-none"
    >
            +
    </button>
    <div className="h-1/3 flex items-center justify-center font-bold text-base sm:text-xl w-full px-px">
      {score}
    </div>
    <button
      onClick={() => canEdit && onChange(-1)}
      disabled={!canEdit}
      className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors text-base sm:text-xl font-bold disabled:opacity-50 disabled:cursor-default leading-none"
    >
            -
    </button>
  </div>
)

const RemotePile: React.FC<{ label: string, count: number, onClick?: () => void, children?: React.ReactNode, className?: string, style?: React.CSSProperties }> = ({ label, count, onClick, children, className, style }) => (
  <div
    onClick={onClick}
    className={`w-full h-full rounded flex flex-col items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-sm select-none text-white border border-gray-600 relative overflow-hidden ${className || ''}`}
    style={style}
  >
    {children ? children : (
      <>
        <span className="text-[9px] font-bold mb-0.5 opacity-80 uppercase tracking-tighter">{label}</span>
        <span className="text-base font-bold">{count}</span>
      </>
    )}
  </div>
)

const PlayerPanel: React.FC<PlayerPanelProps> = memo(({
  player,
  isLocalPlayer,
  localPlayerId,
  isGameStarted,
  onNameChange,
  onColorChange,
  onScoreChange,
  onDeckChange,
  onLoadCustomDeck,
  onDrawCard,
  handleDrop,
  draggedItem,
  setDraggedItem,
  openContextMenu,
  onHandCardDoubleClick,
  playerColorMap,
  allPlayers,
  localPlayerTeamId,
  activePlayerId,
  onToggleActivePlayer,
  imageRefreshVersion,
  layoutMode,
  onCardClick,
  validHandTargets,
  onAnnouncedCardDoubleClick,
  currentPhase,
  disableActiveHighlights,
  preserveDeployAbilities = false,
  roundWinners,
  startingPlayerId,
  onDeckClick,
  isDeckSelectable,
  hideDummyCards = false,
}) => {
  const { t, resources } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canPerformActions: boolean = isLocalPlayer || !!player.isDummy

  const isPlayerActive = activePlayerId === player.id
  const isTeammate = localPlayerTeamId !== undefined && player.teamId === localPlayerTeamId && !isLocalPlayer
  const isDisconnected = !!player.isDisconnected

  const selectableDecks = getSelectableDecks()
  const selectedColors = useMemo(() => new Set(allPlayers.map(p => p.color)), [allPlayers])

  const winCount = roundWinners ? Object.values(roundWinners).filter(winners => winners.includes(player.id)).length : 0
  const isFirstPlayer = startingPlayerId === player.id
  const firstPlayerIconUrl = GAME_ICONS.FIRST_PLAYER
  const ROUND_WIN_MEDAL_URL = GAME_ICONS.ROUND_WIN_MEDAL
  const shouldFlashDeck = isPlayerActive && currentPhase === 0

  const handleDeckSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onDeckChange(e.target.value as DeckTypeEnum)
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const deckData = JSON.parse(event.target?.result as string)
        const validation = validateDeckData(deckData)

        if (!validation.isValid) {
          console.error('Failed to load deck:', validation.error)
          return
        }

        const { deckFile } = validation
        onLoadCustomDeck(deckFile)
      } catch (err) {
        console.error('Failed to parse deck file', err)
      }
    }
    reader.readAsText(file)
  }

  const handleLoadDeckClick = () => {
    fileInputRef.current?.click()
  }

  const handleDeckInteraction = () => {
    if (isDeckSelectable && onDeckClick) {
      onDeckClick(player.id)
    } else if (canPerformActions) {
      onDrawCard()
    }
  }

  if (layoutMode === 'list-local') {
    const borderClass = isPlayerActive ? 'border-yellow-400' : 'border-gray-700'

    return (
      <div className={`w-full h-full flex flex-col p-4 bg-panel-bg border-2 ${borderClass} rounded-lg shadow-2xl ${isDisconnected ? 'opacity-60' : ''} relative`}>
        {/* Status Icons - absolute positioned in top-right corner */}
        {/* Order from left to right: win medals, first player star, checkbox (rightmost) */}
        <div className="absolute top-4 right-4 flex items-center gap-[2px] z-50">
          {/* Win medals */}
          {winCount > 0 && Array.from({ length: winCount }).map((_, i) => (
            <img key={`win-${i}`} src={ROUND_WIN_MEDAL_URL} alt="Round Winner" className="w-6 h-6 drop-shadow-md flex-shrink-0" title="Round Winner" />
          ))}
          {/* First player star */}
          {isFirstPlayer && (
            <img src={firstPlayerIconUrl} alt="First Player" className="w-6 h-6 drop-shadow-md flex-shrink-0" title="First Player" />
          )}
          {/* Active player checkbox */}
          <input type="checkbox" checked={isPlayerActive} onChange={() => onToggleActivePlayer(player.id)} disabled={!isLocalPlayer && !player.isDummy} className={`w-6 h-6 text-yellow-400 bg-gray-700 border-2 border-yellow-400 rounded flex-shrink-0 ${!isLocalPlayer && !player.isDummy ? 'cursor-default' : 'cursor-pointer'}`} title="Active Player" />
        </div>

        {/* Header: ColorPicker + Name (name takes all available space) */}
        <div className="flex items-center gap-2 mb-[3px] flex-shrink-0 pr-[100px]">
          <ColorPicker player={player} canEditSettings={!isGameStarted && canPerformActions} selectedColors={selectedColors} onColorChange={onColorChange} />
          <div className="flex-grow relative flex items-center min-w-0">
            <input type="text" value={player.name} onChange={(e) => onNameChange(e.target.value)} readOnly={isGameStarted || !canPerformActions} className="bg-transparent font-bold text-xl p-1 flex-grow focus:bg-gray-800 rounded focus:outline-none border-b border-gray-600 text-white truncate" />
          </div>
        </div>

        <div className="bg-gray-800 p-1 rounded-lg mb-1 flex-shrink-0">
          <div className="grid grid-cols-4 gap-1 sm:gap-2">
            {/* Deck */}
            <DropZone className="relative" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => openContextMenu(e, 'deckPile', { player })}>
              {(() => {
                // Calculate deck highlight style matching the board highlight effect
                const playerColorName = playerColorMap.get(player.id)
                const rgb = playerColorName && PLAYER_COLOR_RGB[playerColorName]
                  ? PLAYER_COLOR_RGB[playerColorName]
                  : { r: 37, g: 99, b: 235 }
                const glowRgb = {
                  r: Math.min(255, Math.round(rgb.r * 1.3)),
                  g: Math.min(255, Math.round(rgb.g * 1.3)),
                  b: Math.min(255, Math.round(rgb.b * 1.3)),
                }
                const deckHighlightStyle = isDeckSelectable ? {
                  boxShadow: `0 0 12px 2px rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.5)`,
                  border: '3px solid rgb(255, 255, 255)',
                } : {}

                return (
                  <div className="relative aspect-square">
                    {/* Highlight overlay - doesn't interfere with deck visibility */}
                    {isDeckSelectable && (
                      <div
                        className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                        style={{
                          zIndex: 10,
                          background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                        }}
                      />
                    )}
                    <div
                      onClick={handleDeckInteraction}
                      className={`absolute inset-0 bg-card-back rounded flex flex-col items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-md select-none text-white ${shouldFlashDeck ? 'animate-deck-start' : ''}`}
                      style={deckHighlightStyle}
                    >
                      <span className="text-[10px] sm:text-xs font-bold mb-0.5 uppercase tracking-tight relative z-20">{t('deck')}</span>
                      <span className="text-base sm:text-lg font-bold relative z-20">{player.deck.length}</span>
                    </div>
                  </div>
                )
              })()}
            </DropZone>

            {/* Discard */}
            <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => openContextMenu(e, 'discardPile', { player })} isOverClassName="bg-indigo-600 ring-2">
              <div className="aspect-square bg-gray-700 rounded flex flex-col items-center justify-center cursor-pointer hover:bg-gray-600 transition-all shadow-md border border-gray-600 select-none text-white">
                <span className="text-[10px] sm:text-xs font-bold mb-0.5 text-gray-400 uppercase tracking-tight">{t('discard')}</span>
                <span className="text-base sm:text-lg font-bold">{player.discard.length}</span>
              </div>
            </DropZone>

            {/* Showcase */}
            <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })}>
              <div className="aspect-square bg-gray-800 border border-dashed border-gray-600 rounded flex items-center justify-center relative overflow-hidden">
                {player.announcedCard ? (
                  <div
                    className="w-full h-full p-1 cursor-pointer"
                    draggable={canPerformActions}
                    onDragStart={() => canPerformActions && setDraggedItem({
                      card: player.announcedCard!,
                      source: 'announced',
                      playerId: player.id,
                      isManual: true
                    })}
                    onDragEnd={() => setDraggedItem(null)}
                    onContextMenu={(e) => canPerformActions && player.announcedCard && openContextMenu(e, 'announcedCard', {
                      card: player.announcedCard,
                      player
                    })}
                    onDoubleClick={() => onAnnouncedCardDoubleClick?.(player, player.announcedCard!)}
                  >
                    <CardComponent
                      card={player.announcedCard}
                      isFaceUp={true}
                      playerColorMap={playerColorMap}
                      imageRefreshVersion={imageRefreshVersion}
                      activePhaseIndex={currentPhase}
                      activePlayerId={activePlayerId}
                      disableActiveHighlights={disableActiveHighlights}
                      preserveDeployAbilities={preserveDeployAbilities}
                    />
                  </div>
                ) : <span className="text-[10px] sm:text-xs font-bold text-gray-500 select-none uppercase tracking-tight">{t('showcase')}</span>}
              </div>
            </DropZone>

            {/* Score */}
            <RemoteScore score={player.score} onChange={onScoreChange} canEdit={canPerformActions} />
          </div>
        </div>

        {!isGameStarted && canPerformActions && (
          <div className="mb-[3px] flex-shrink-0 text-white">
            <select value={player.selectedDeck} onChange={handleDeckSelectChange} className="w-full bg-gray-700 border border-gray-600 rounded p-2 mb-2">
              {selectableDecks.map(deck => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
              <option value={DeckTypeEnum.Custom}>{t('customDeck')}</option>
            </select>
            {player.selectedDeck === DeckTypeEnum.Custom && (
              <div className="flex gap-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelected} accept=".json" className="hidden" />
                <button onClick={handleLoadDeckClick} className="w-full bg-indigo-600 hover:bg-indigo-700 py-1 rounded font-bold">{t('loadDeck')}</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-grow flex flex-col min-h-0">
          <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'hand', playerId: player.id })} className="flex-grow bg-gray-800 rounded-lg p-2 overflow-y-scroll border border-gray-700 custom-scrollbar">
            <div className="flex flex-col gap-[2px]">
              {player.hand.map((card, index) => {
                const isTarget = validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
                const targetClass = isTarget ? 'ring-3 ring-cyan-400 shadow-[0_0_9px_#22d3ee] rounded-md z-10' : ''

                return (
                  <div
                    key={`${player.id}-hand-${index}-${card.id}`}
                    className={`flex items-center bg-gray-900 border border-gray-700 rounded p-2 ${targetClass}`}
                    draggable={canPerformActions}
                    onDragStart={() => canPerformActions && setDraggedItem({
                      card,
                      source: 'hand',
                      playerId: player.id,
                      cardIndex: index,
                      isManual: true
                    })}
                    onDragEnd={() => setDraggedItem(null)}
                    onContextMenu={(e) => canPerformActions && openContextMenu(e, 'handCard', {
                      card,
                      player,
                      cardIndex: index
                    })}
                    onDoubleClick={() => onHandCardDoubleClick(player, card, index)}
                    onClick={() => onCardClick?.(player, card, index)}
                    data-hand-card={`${player.id},${index}`}
                    data-interactive="true"
                  >
                    <div className="aspect-square flex-shrink-0 mr-3 w-[28.75%] max-w-[230px] min-w-[40px] overflow-hidden rounded">
                      <CardComponent
                        card={card}
                        isFaceUp={true}
                        playerColorMap={playerColorMap}
                        localPlayerId={localPlayerId}
                        imageRefreshVersion={imageRefreshVersion}
                        disableTooltip={true}
                        disableActiveHighlights={disableActiveHighlights}
                        preserveDeployAbilities={preserveDeployAbilities}
                      />
                    </div>
                    <div className="flex-grow min-w-0">
                      <CardTooltipContent
                        card={card}
                        className="relative flex flex-col text-left w-full h-full justify-start whitespace-normal break-words"
                        hideOwner={card.ownerId === player.id}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </DropZone>
        </div>
      </div>
    )
  }

  if (layoutMode === 'list-remote') {
    const borderClass = isPlayerActive ? 'border-yellow-400' : 'border-gray-700'
    return (
      <div className={`w-full h-full flex flex-col p-1 pt-[3px] bg-panel-bg border-2 ${borderClass} rounded-lg shadow-xl ${isDisconnected ? 'opacity-60' : ''} relative`}>
        {/* Header: Color + Name + Deck Select + Status Icons - all in one row */}
        <div className="flex items-center gap-1 px-1 min-h-[20px] mt-[2px] relative z-10">
          {/* Color picker - compact for remote panels */}
          <ColorPicker player={player} canEditSettings={!isGameStarted && canPerformActions} selectedColors={selectedColors} onColorChange={onColorChange} compact={true} />
          {/* Name - larger font */}
          <span className="font-bold text-white text-[14px] truncate leading-tight flex-1 min-w-0 relative z-10">{player.name}</span>
          {/* Status icons and deck select - aligned right */}
          <div className="flex items-center gap-[2px] flex-shrink-0">
            {/* Dummy deck select - shown before status icons */}
            {!isGameStarted && player.isDummy && canPerformActions && (
              <select
                value={player.selectedDeck}
                onChange={handleDeckSelectChange}
                className="text-[11px] bg-gray-700 text-white border border-gray-600 rounded px-1 py-0 h-5 w-[110px] focus:outline-none truncate flex-shrink-0"
              >
                {selectableDecks.map(deck => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
                <option value={DeckTypeEnum.Custom}>{t('customDeck')}</option>
              </select>
            )}
            {/* Win medal */}
            {winCount > 0 && <img src={ROUND_WIN_MEDAL_URL} alt="Round Winner" className="w-[19px] h-[17.7] flex-shrink-0 mt-[1.3px]" title="Round Winner" />}
            {/* First player star */}
            {isFirstPlayer && <img src={firstPlayerIconUrl} className="w-[16.75px] h-[16.75px] flex-shrink-0" title="First Player" />}
            {/* Active player checkbox */}
            <input
              type="checkbox"
              checked={isPlayerActive}
              onChange={() => onToggleActivePlayer(player.id)}
              disabled={!canPerformActions}
              className="w-[15px] h-[15px] text-yellow-400 bg-gray-800 border-2 border-yellow-400 rounded cursor-pointer flex-shrink-0 accent-yellow-500"
              title="Active Player"
            />
          </div>
        </div>

        {/* Main Vertical Layout */}
        <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* Combined: Resources + Hand with gap-1 spacing */}
          <div className="flex flex-col flex-1 min-h-0 gap-1 px-1 mt-[4px]">
            {/* Row 1: Resources (Deck, Discard, Showcase) + Score at right edge - same size as hand cards */}
            <div className="grid grid-cols-6 gap-1 flex-shrink-0 scale-[0.975] origin-left">
            {/* Deck */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => openContextMenu(e, 'deckPile', { player })}>
                {(() => {
                  // Calculate deck highlight style matching the board highlight effect
                  const playerColorName = playerColorMap.get(player.id)
                  const rgb = playerColorName && PLAYER_COLOR_RGB[playerColorName]
                    ? PLAYER_COLOR_RGB[playerColorName]
                    : { r: 37, g: 99, b: 235 }
                  const glowRgb = {
                    r: Math.min(255, Math.round(rgb.r * 1.3)),
                    g: Math.min(255, Math.round(rgb.g * 1.3)),
                    b: Math.min(255, Math.round(rgb.b * 1.3)),
                  }
                  const deckHighlightStyle = isDeckSelectable ? {
                    boxShadow: `0 0 12px 2px rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.5)`,
                    border: '3px solid rgb(255, 255, 255)',
                  } : {}

                  return (
                    <div className="relative w-full h-full">
                      {/* Highlight overlay - doesn't interfere with deck visibility */}
                      {isDeckSelectable && (
                        <div
                          className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                          style={{
                            zIndex: 10,
                            background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                          }}
                        />
                      )}
                      <RemotePile
                        label={t('deck')}
                        count={player.deck.length}
                        onClick={handleDeckInteraction}
                        className={`bg-card-back ${shouldFlashDeck ? 'animate-deck-start' : ''}`}
                        style={deckHighlightStyle}
                      />
                    </div>
                  )
                })()}
              </DropZone>
            </div>

            {/* Discard */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => openContextMenu(e, 'discardPile', { player })} isOverClassName="ring-2 ring-indigo-500">
                <RemotePile
                  label={t('discard')}
                  count={player.discard.length}
                  className="bg-gray-700"
                />
              </DropZone>
            </div>

            {/* Showcase */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })}>
                <div className="w-full h-full bg-gray-800 border border-dashed border-gray-600 rounded flex items-center justify-center relative overflow-hidden">
                  {player.announcedCard ? (
                    <div
                      className="w-full h-full"
                      draggable={canPerformActions}
                      onDragStart={() => canPerformActions && setDraggedItem({
                        card: player.announcedCard!,
                        source: 'announced',
                        playerId: player.id,
                        isManual: true
                      })}
                      onDragEnd={() => setDraggedItem(null)}
                      onContextMenu={(e) => player.announcedCard && openContextMenu(e, 'announcedCard', {
                        card: player.announcedCard,
                        player
                      })}
                      onDoubleClick={() => onAnnouncedCardDoubleClick?.(player, player.announcedCard!)}
                    >
                      <CardComponent
                        card={player.announcedCard}
                        isFaceUp={true}
                        playerColorMap={playerColorMap}
                        imageRefreshVersion={imageRefreshVersion}
                        disableTooltip={false}
                        disableActiveHighlights={disableActiveHighlights}
                        preserveDeployAbilities={preserveDeployAbilities}
                      />
                    </div>
                  ) : <span className="text-[9px] font-bold text-gray-500 select-none uppercase">SHOW</span>}
                </div>
              </DropZone>
            </div>

            {/* Empty cells for spacing */}
            <div className="aspect-square"></div>
            <div className="aspect-square"></div>

            {/* Score Counter - at right edge */}
            <div className="aspect-square">
              <RemoteScore score={player.score} onChange={onScoreChange} canEdit={canPerformActions} />
            </div>
          </div>

          {/* Row 2: Hand Cards - Grid 6 cols - Scrollable with ALWAYS VISIBLE SCROLLBAR */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (draggedItem) {
                handleDrop(draggedItem, { target: 'hand', playerId: player.id })
              }
            }}
            className="grid grid-cols-6 gap-1 overflow-y-scroll custom-scrollbar flex-grow content-start min-h-[30px]"
          >
            {player.hand.map((card, index) => {
              const isTarget = validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
              const targetClass = isTarget ? 'ring-2 ring-cyan-400 shadow-[0_0_10px_#22d3ee] rounded-md z-10' : ''

              const isRevealedToAll = card.revealedTo === 'all'
              const isRevealedToMe = localPlayerId !== null && Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
              const isRevealedByStatus = localPlayerId !== null && card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)

              const owner = allPlayers.find(p => p.id === card.ownerId)
              const isOwnerDummy = owner?.isDummy
              const isOwner = localPlayerId === card.ownerId

              // If hideDummyCards is enabled, dummy cards are only visible if they have a reveal status
              const isDummyVisible = !hideDummyCards || !!isRevealedToAll || !!isRevealedToMe || !!isRevealedByStatus
              const isVisible: boolean = isOwner || (!!isOwnerDummy && isDummyVisible) || isTeammate || isRevealedToAll || !!isRevealedToMe || !!isRevealedByStatus

              return (
                <div
                  key={`${player.id}-hand-${index}-${card.id}`}
                  className={`aspect-square relative ${targetClass}`}
                  draggable={canPerformActions}
                  onDragStart={() => canPerformActions && setDraggedItem({ card, source: 'hand', playerId: player.id, cardIndex: index, isManual: true })}
                  onDragEnd={() => setDraggedItem(null)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openContextMenu(e, 'handCard', { card, player, cardIndex: index })
                  }}
                  onDoubleClick={() => onHandCardDoubleClick(player, card, index)}
                  onClick={() => onCardClick?.(player, card, index)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (draggedItem) {
                      // If dropping on same player's hand, insert at this index
                      if (draggedItem.playerId === player.id && draggedItem.source === 'hand') {
                        handleDrop(draggedItem, { target: 'hand', playerId: player.id, cardIndex: index })
                      } else {
                        // Different source or player, append to end
                        handleDrop(draggedItem, { target: 'hand', playerId: player.id })
                      }
                    }
                  }}
                  data-hand-card={`${player.id},${index}`}
                  data-interactive="true"
                >
                  <div className="w-full h-full">
                    <CardComponent
                      card={card}
                      isFaceUp={isVisible}
                      playerColorMap={playerColorMap}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                      disableTooltip={!isVisible}
                      disableActiveHighlights={disableActiveHighlights}
                      smallStatusIcons={true}
                      preserveDeployAbilities={preserveDeployAbilities}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>
      </div>
    )
  }

  // Should never reach here since layoutMode is always 'list-local' or 'list-remote'
  return null
})

export { PlayerPanel }
