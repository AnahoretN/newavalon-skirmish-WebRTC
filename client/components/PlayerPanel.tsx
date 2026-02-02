import React, { memo, useRef, useState, useEffect, useMemo } from 'react'
import { DeckType as DeckTypeEnum } from '@/types'
import type { Player, PlayerColor, Card as CardType, DragItem, DropTarget, CustomDeckFile, ContextMenuParams, CursorStackState } from '@/types'
import { PLAYER_COLORS, GAME_ICONS } from '@/constants'
import { getSelectableDecks } from '@/content'
import { Card as CardComponent } from './Card'
import { CardTooltipContent } from './Tooltip'
import { useLanguage } from '@/contexts/LanguageContext'
import { parseTextDeckFormat } from '@/utils/textDeckFormat'
import { calculateGlowColor, rgba, getPlayerColorRgbOrDefault, TIMING } from '@/utils/common'

// Track deck change deltas for each player
const deckChangeDeltas = new Map<number, { delta: number, timerId: NodeJS.Timeout }>()

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
  currentRound?: number; // Force re-render when round changes
  onDeckClick?: (playerId: number) => void;
  isDeckSelectable?: boolean;
  hideDummyCards?: boolean; // If true, hide dummy player cards like real players
  deckSelections?: { playerId: number; selectedByPlayerId: number; timestamp: number }[];
  handCardSelections?: { playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }[];
  cursorStack?: CursorStackState | null;
  remoteValidTargets?: { playerId: number, validHandTargets: { playerId: number, cardIndex: number }[], isDeckSelectable: boolean } | null;
  highlightOwnerId?: number; // The owner of the current ability/mode (for correct highlight color)
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
        e.stopPropagation()
        setIsOver(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        setIsOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setIsOver(false)
        onDrop()
      }}
      onContextMenu={onContextMenu}
      className={`${className || ''} ${isOver ? `relative z-10 ${isOverClassName || ''}` : ''}`}
    >
      {children}
    </div>
  )
}

const RemoteScore: React.FC<{ score: number, onChange: (delta: number) => void, canEdit: boolean }> = ({ score, onChange, canEdit }) => {
  // Local state for immediate feedback effect
  const [pendingDelta, setPendingDelta] = useState(0)
  const [effectKey, setEffectKey] = useState(0)
  const [externalDelta, setExternalDelta] = useState(0)  // Server-initiated changes
  const pendingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingDeltaRef = useRef(0)  // Ref to preserve value through server updates
  const prevScoreRef = useRef(score)
  const expectingServerUpdateRef = useRef(false)  // Flag to track if we're waiting for server response

  // Detect score changes from server (scoring effects)
  useEffect(() => {
    if (prevScoreRef.current !== score) {
      const delta = score - prevScoreRef.current
      let cleanupTimer: NodeJS.Timeout | undefined

      // Only show external delta if we're not expecting a response from manual changes
      if (!expectingServerUpdateRef.current) {
        setExternalDelta(delta)
        setEffectKey(prev => prev + 1)
        // Clear external delta effect after animation
        cleanupTimer = setTimeout(() => {
          setExternalDelta(0)
        }, 1500)
      } else {
        // We were expecting this update from our manual changes
        expectingServerUpdateRef.current = false
      }

      // Always update prevScoreRef
      prevScoreRef.current = score

      // Return cleanup if timer was set
      if (cleanupTimer) {
        return () => clearTimeout(cleanupTimer)
      }
    }
    return undefined
  }, [score])

  const handleScoreChange = (delta: number) => {
    if (!canEdit) {return;}

    // Immediately update local accumulation (shown separately, not added to main score)
    const newDelta = pendingDeltaRef.current + delta
    pendingDeltaRef.current = newDelta
    setPendingDelta(newDelta)
    setEffectKey(prev => prev + 1)

    // Clear existing timer
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
    }

    // Start new timer - after 250ms of no clicks, send to server and clear delta
    pendingTimerRef.current = setTimeout(() => {
      const finalDelta = pendingDeltaRef.current
      if (finalDelta !== 0) {
        expectingServerUpdateRef.current = true  // Mark that we're expecting server response
        onChange(finalDelta)
      }
      // Clear both state and ref
      pendingDeltaRef.current = 0
      setPendingDelta(0)
    }, 250)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
      }
    }
  }, [])

  // Show pending delta or external delta
  const showDelta = pendingDelta !== 0 || externalDelta !== 0
  const deltaToShow = externalDelta !== 0 ? externalDelta : pendingDelta
  // External delta fades out, pending delta stays visible while accumulating
  const isExternalEffect = externalDelta !== 0

  return (
    <div className="w-full h-full aspect-square bg-gray-800 rounded flex flex-col items-center text-white select-none overflow-hidden">
      <button
        onClick={() => handleScoreChange(1)}
        disabled={!canEdit}
        className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors text-base sm:text-xl font-bold disabled:opacity-50 disabled:cursor-default leading-none"
      >
        +
      </button>
      <div className="h-1/3 flex items-center justify-center font-bold text-base sm:text-xl w-full px-px relative">
        {/* Main score - always centered, unchanged while clicking */}
        <span className="absolute left-1/2 -translate-x-1/2">{score}</span>
        {/* Delta effect - always on the right, no parentheses */}
        {showDelta && (
          <span key={effectKey} className={`absolute right-1 text-base sm:text-lg font-bold ${deltaToShow > 0 ? 'text-green-400' : 'text-red-400'} ${isExternalEffect ? 'animate-fade-out' : ''}`}>
            {deltaToShow > 0 ? `+${deltaToShow}` : deltaToShow}
          </span>
        )}
      </div>
      <button
        onClick={() => handleScoreChange(-1)}
        disabled={!canEdit}
        className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors text-base sm:text-xl font-bold disabled:opacity-50 disabled:cursor-default leading-none"
      >
        -
      </button>
    </div>
  )
}

const RemotePile: React.FC<{ label: string, count: number, onClick?: () => void, children?: React.ReactNode, className?: string, style?: React.CSSProperties, delta?: number | null }> = ({ label, count, onClick, children, className, style, delta }) => (
  <div
    onClick={onClick}
    className={`w-full h-full rounded flex flex-col items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-sm select-none text-white border border-gray-600 relative overflow-hidden ${className || ''}`}
    style={style}
  >
    {children ? children : (
      <>
        <span className="text-[9px] font-bold mb-0.5 opacity-80 uppercase tracking-tighter">{label}</span>
        <div className="relative">
          <span className="text-base font-bold">{count}</span>
          {delta !== null && delta !== undefined && (
            <span className={`absolute left-full top-0 ml-0.5 text-base font-bold animate-fade-out ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
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
  deckSelections = [],
  handCardSelections = [],
  cursorStack = null,
  remoteValidTargets = null,
  highlightOwnerId,
}) => {
  const { t, resources } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevDeckLengthRef = useRef<number>(player.deck.length)

  // State for deck change indicator (+/- number)
  const [deckChangeDelta, setDeckChangeDelta] = useState<number | null>(null)
  // Key for forcing re-render of delta animation (resets opacity to 100%)
  const [deckChangeKey, setDeckChangeKey] = useState(0)

  const canPerformActions: boolean = isLocalPlayer || !!player.isDummy
  const canDrag: boolean = canPerformActions && !cursorStack

  const isPlayerActive = activePlayerId === player.id
  const isTeammate = localPlayerTeamId !== undefined && player.teamId === localPlayerTeamId && !isLocalPlayer
  const isDisconnected = !!player.isDisconnected

  const selectableDecks = getSelectableDecks()
  const selectedColors = useMemo(() => new Set(allPlayers.map(p => p.color)), [allPlayers])

  const winCount = roundWinners ? Object.values(roundWinners).filter(winners => winners.includes(player.id)).length : 0
  const isFirstPlayer = startingPlayerId === player.id
  const firstPlayerIconUrl = GAME_ICONS.FIRST_PLAYER
  const ROUND_WIN_MEDAL_URL = GAME_ICONS.ROUND_WIN_MEDAL

  // Track deck count changes and show delta indicator
  useEffect(() => {
    const prevLength = prevDeckLengthRef.current
    const currentLength = player.deck.length

    if (prevLength !== currentLength) {
      const delta = currentLength - prevLength
      prevDeckLengthRef.current = currentLength

      // Accumulate delta if there's already a pending change (within 500ms)
      const existing = deckChangeDeltas.get(player.id)
      if (existing) {
        clearTimeout(existing.timerId)
        const newDelta = existing.delta + delta
        setDeckChangeDelta(newDelta)
        setDeckChangeKey(prev => prev + 1) // Reset animation
        const timerId = setTimeout(() => {
          setDeckChangeDelta(null)
          deckChangeDeltas.delete(player.id)
        }, 500)
        deckChangeDeltas.set(player.id, { delta: newDelta, timerId })
      } else {
        setDeckChangeDelta(delta)
        setDeckChangeKey(prev => prev + 1) // Reset animation
        const timerId = setTimeout(() => {
          setDeckChangeDelta(null)
          deckChangeDeltas.delete(player.id)
        }, 500)
        deckChangeDeltas.set(player.id, { delta, timerId })
      }
    }
  }, [player.deck.length, player.id])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const existingDeck = deckChangeDeltas.get(player.id)
      if (existingDeck) {
        clearTimeout(existingDeck.timerId)
        deckChangeDeltas.delete(player.id)
      }
    }
  }, [player.id])

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
        const text = event.target?.result as string

        // Try text deck format
        const validation = parseTextDeckFormat(text)
        if (!validation.isValid) {
          console.error('Failed to load deck:', validation.error)
          alert((validation as { error: string }).error)
          return
        }

        const { deckFile } = validation
        onLoadCustomDeck(deckFile)

      } catch (err) {
        console.error('Failed to parse deck file', err)
        alert('Failed to parse deck file.')
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
          <input type="checkbox" checked={isPlayerActive} onChange={() => onToggleActivePlayer(player.id)} disabled={!canPerformActions} className={`w-6 h-6 text-yellow-400 bg-gray-700 border-2 border-yellow-400 rounded flex-shrink-0 ${!canPerformActions ? 'cursor-not-allowed' : 'cursor-pointer'}`} title="Active Player" />
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
            <DropZone className="relative" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => openContextMenu(e, 'deckPile', { player })} isOverClassName="rounded ring-2 ring-white">
              {(() => {
                // Check if deck is selectable (either from local player or from remote player)
                const isLocalDeckSelectable = isDeckSelectable
                const isRemoteDeckSelectable = remoteValidTargets?.isDeckSelectable ?? false
                const isDeckSelectableActive = isLocalDeckSelectable || isRemoteDeckSelectable

                // Use active player's color for the selection effect (not the deck owner's color)
                // For remote targets, use the remote player's color
                const targetPlayerId = isRemoteDeckSelectable && remoteValidTargets ? remoteValidTargets.playerId : activePlayerId
                const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })
                const deckHighlightStyle = isDeckSelectableActive ? {
                  boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                  border: '3px solid rgb(255, 255, 255)',
                } : {}

                // Find recent deck selection for this player (within last 1 second)
                const now = Date.now()
                const recentSelection = deckSelections?.find(
                  ds => ds.playerId === player.id && (now - ds.timestamp) < 1000
                )
                // Use the selecting player's color for the ripple
                const selectionColorName = recentSelection?.selectedByPlayerId
                  ? playerColorMap.get(recentSelection.selectedByPlayerId)
                  : null
                const selectionRgb = getPlayerColorRgbOrDefault(selectionColorName, rgb)

                return (
                  <div className="relative aspect-square">
                    {/* Highlight overlay - doesn't interfere with deck visibility */}
                    {isDeckSelectableActive && (
                      <div
                        className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                        style={{
                          zIndex: 10,
                          background: `radial-gradient(circle at center, transparent 30%, ${rgba(rgb, 0.4)} 100%)`,
                        }}
                      />
                    )}
                    {/* Ripple effect when deck is selected */}
                    {recentSelection && (
                      <div
                        className="absolute inset-0 rounded pointer-events-none animate-deck-selection"
                        style={{
                          zIndex: 15,
                          border: '3px solid',
                          borderColor: `rgb(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b})`,
                          background: `radial-gradient(circle at center, transparent 20%, ${rgba(selectionRgb, 0.6)} 100%)`,
                        }}
                      />
                    )}
                    <div
                      onClick={handleDeckInteraction}
                      className="absolute inset-0 bg-card-back rounded flex flex-col items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-md select-none text-white"
                      style={deckHighlightStyle}
                    >
                      <span className="text-[10px] sm:text-xs font-bold mb-0.5 uppercase tracking-tight relative z-20">{t('deck')}</span>
                      <div className="relative z-20">
                        <span className="text-base sm:text-lg font-bold">{player.deck.length}</span>
                        {deckChangeDelta !== null && (
                          <span key={deckChangeKey} className={`absolute left-full top-0 ml-1 text-base sm:text-lg font-bold animate-fade-out ${deckChangeDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {deckChangeDelta > 0 ? `+${deckChangeDelta}` : deckChangeDelta}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </DropZone>

            {/* Discard */}
            <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => openContextMenu(e, 'discardPile', { player })} isOverClassName="rounded ring-2 ring-white">
              <div className="aspect-square bg-gray-700 rounded flex flex-col items-center justify-center cursor-pointer hover:bg-gray-600 transition-all shadow-md border border-gray-600 select-none text-white">
                <span className="text-[10px] sm:text-xs font-bold mb-0.5 text-gray-400 uppercase tracking-tight">{t('discard')}</span>
                <span className="text-base sm:text-lg font-bold">{player.discard.length}</span>
              </div>
            </DropZone>

            {/* Showcase */}
            <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })} isOverClassName="rounded ring-2 ring-white">
              <div className="aspect-square bg-gray-800 border border-dashed border-gray-600 rounded flex items-center justify-center relative overflow-hidden">
                {player.announcedCard ? (
                  <div
                    className="w-full h-full p-1 cursor-pointer"
                    draggable={canDrag}
                    onDragStart={() => canDrag && setDraggedItem({
                      card: player.announcedCard!,
                      source: 'announced',
                      playerId: player.id,
                      isManual: true
                    })}
                    onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
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
            <RemoteScore
              score={player.score}
              onChange={onScoreChange}
              canEdit={canPerformActions}
            />
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
                <input type="file" ref={fileInputRef} onChange={handleFileSelected} accept=".txt" className="hidden" />
                <button onClick={handleLoadDeckClick} className="w-full bg-indigo-600 hover:bg-indigo-700 py-1 rounded font-bold">{t('loadDeck')}</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-grow flex flex-col min-h-0">
          <DropZone onDrop={() => {
            if (draggedItem) {
              handleDrop(draggedItem, { target: 'hand', playerId: player.id })
              setDraggedItem(null)
            }
          }} className="flex-grow bg-gray-800 rounded-lg p-2 overflow-y-scroll border border border-gray-700 custom-scrollbar">
            <div className="flex flex-col gap-[2px]">
              {player.hand.map((card, index) => {
                // Check if this card is a valid target (either from local player or from remote player)
                const isLocalTarget = validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
                const isRemoteTarget = remoteValidTargets?.validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
                const isTarget = isLocalTarget || isRemoteTarget

                // Use highlightOwnerId for local targets (ability owner's color), fallback to activePlayerId
                // For remote targets, use the remote player's color
                const targetPlayerId = isRemoteTarget && remoteValidTargets
                  ? remoteValidTargets.playerId
                  : (highlightOwnerId ?? activePlayerId)
                const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })

                // Find recent hand card selection for this card (within last 1 second)
                const now = Date.now()
                const recentSelection = handCardSelections?.find(
                  cs => cs.playerId === player.id && cs.cardIndex === index && (now - cs.timestamp) < 1000
                )

                // Card container style with highlight if target
                const cardContainerStyle = isTarget ? {
                  boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                  border: '3px solid rgb(255, 255, 255)',
                } : {}

                return (
                  <div
                    key={`${player.id}-hand-${index}-${card.id}`}
                    className="relative"
                  >
                    {/* Highlight overlay - doesn't interfere with card visibility */}
                    {isTarget && (
                      <div
                        className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                        style={{
                          zIndex: 10,
                          background: `radial-gradient(circle at center, transparent 30%, ${rgba(rgb, 0.4)} 100%)`,
                        }}
                      />
                    )}
                    {/* Ripple effect when card is selected */}
                    {recentSelection && (
                      <div
                        className="absolute inset-0 rounded pointer-events-none animate-deck-selection"
                        style={{
                          zIndex: 15,
                          border: '3px solid',
                          borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                          background: `radial-gradient(circle at center, transparent 20%, ${rgba(rgb, 0.6)} 100%)`,
                        }}
                      />
                    )}
                    <div
                      className={`flex items-center bg-gray-900 border rounded p-2 ${isTarget ? 'border-transparent' : 'border-gray-700'}`}
                      style={cardContainerStyle}
                      draggable={canDrag}
                      onDragStart={() => canDrag && setDraggedItem({
                        card,
                        source: 'hand',
                        playerId: player.id,
                        cardIndex: index,
                        isManual: true
                      })}
                      onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                      onContextMenu={(e) => canPerformActions && openContextMenu(e, 'handCard', {
                        card,
                        player,
                        cardIndex: index
                      })}
                      onDoubleClick={() => onHandCardDoubleClick(player, card, index)}
                      onClick={() => {
                        onCardClick?.(player, card, index)
                      }}
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
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => openContextMenu(e, 'deckPile', { player })} isOverClassName="rounded ring-2 ring-white">
                {(() => {
                  // Check if deck is selectable (either from local player or from remote player)
                  const isLocalDeckSelectable = isDeckSelectable
                  const isRemoteDeckSelectable = remoteValidTargets?.isDeckSelectable ?? false
                  const isDeckSelectableActive = isLocalDeckSelectable || isRemoteDeckSelectable

                  // Use active player's color for the selection effect (not the deck owner's color)
                  // For remote targets, use the remote player's color
                  const targetPlayerId = isRemoteDeckSelectable && remoteValidTargets ? remoteValidTargets.playerId : activePlayerId
                  const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                  const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })
                  const deckHighlightStyle = isDeckSelectableActive ? {
                    boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                    border: '3px solid rgb(255, 255, 255)',
                  } : {}

                  // Find recent deck selection for this player (within last 1 second)
                  const now = Date.now()
                  const recentSelection = deckSelections?.find(
                    ds => ds.playerId === player.id && (now - ds.timestamp) < 1000
                  )
                  // Use the selecting player's color for the ripple
                  const selectionColorName = recentSelection?.selectedByPlayerId
                    ? playerColorMap.get(recentSelection.selectedByPlayerId)
                    : null
                  const selectionRgb = getPlayerColorRgbOrDefault(selectionColorName, rgb)

                  return (
                    <div className="relative w-full h-full">
                      {/* Highlight overlay - doesn't interfere with deck visibility */}
                      {isDeckSelectableActive && (
                        <div
                          className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                          style={{
                            zIndex: 10,
                            background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                          }}
                        />
                      )}
                      {/* Ripple effect when deck is selected */}
                      {recentSelection && (
                        <div
                          className="absolute inset-0 rounded pointer-events-none animate-deck-selection"
                          style={{
                            zIndex: 15,
                            border: '3px solid',
                            borderColor: `rgb(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b})`,
                            background: `radial-gradient(circle at center, transparent 20%, rgba(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b}, 0.6) 100%)`,
                          }}
                        />
                      )}
                      <RemotePile
                        label={t('deck')}
                        count={player.deck.length}
                        onClick={handleDeckInteraction}
                        className="bg-card-back"
                        style={deckHighlightStyle}
                        delta={deckChangeDelta}
                      />
                    </div>
                  )
                })()}
              </DropZone>
            </div>

            {/* Discard */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => openContextMenu(e, 'discardPile', { player })} isOverClassName="rounded ring-2 ring-white">
                <RemotePile
                  label={t('discard')}
                  count={player.discard.length}
                  className="bg-gray-700"
                />
              </DropZone>
            </div>

            {/* Showcase */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })} isOverClassName="rounded ring-2 ring-white">
                <div className="w-full h-full bg-gray-800 border border-dashed border-gray-600 rounded flex items-center justify-center relative overflow-hidden">
                  {player.announcedCard ? (
                    <div
                      className="w-full h-full"
                      draggable={canDrag}
                      onDragStart={() => canDrag && setDraggedItem({
                        card: player.announcedCard!,
                        source: 'announced',
                        playerId: player.id,
                        isManual: true
                      })}
                      onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
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
              <RemoteScore
                score={player.score}
                onChange={onScoreChange}
                canEdit={canPerformActions}
              />
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
              // Check if this card is a valid target (either from local player or from remote player)
              const isLocalTarget = validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
              const isRemoteTarget = remoteValidTargets?.validHandTargets?.some(t => t.playerId === player.id && t.cardIndex === index)
              const isTarget = isLocalTarget || isRemoteTarget

              // Use highlightOwnerId for local targets (ability owner's color), fallback to activePlayerId
              // For remote targets, use the remote player's color
              const targetPlayerId = isRemoteTarget && remoteValidTargets
                ? remoteValidTargets.playerId
                : (highlightOwnerId ?? activePlayerId)
              const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
              const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })

              // Find recent hand card selection for this card (within last 1 second)
              const now = Date.now()
              const recentSelection = handCardSelections?.find(
                cs => cs.playerId === player.id && cs.cardIndex === index && (now - cs.timestamp) < 1000
              )

              // Card container style with highlight if target
              const cardHighlightStyle = isTarget ? {
                boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                border: '3px solid rgb(255, 255, 255)',
              } : {}

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
                  className="aspect-square relative"
                  draggable={canDrag}
                  onDragStart={() => canDrag && setDraggedItem({ card, source: 'hand', playerId: player.id, cardIndex: index, isManual: true })}
                  onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openContextMenu(e, 'handCard', { card, player, cardIndex: index })
                  }}
                  onDoubleClick={() => onHandCardDoubleClick(player, card, index)}
                  onClick={() => {
                    onCardClick?.(player, card, index)
                  }}
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
                  {/* Highlight overlay - doesn't interfere with card visibility */}
                  {isTarget && (
                    <div
                      className="absolute inset-0 rounded pointer-events-none animate-glow-pulse"
                      style={{
                        zIndex: 10,
                        background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                      }}
                    />
                  )}
                  {/* Ripple effect when card is selected */}
                  {recentSelection && (
                    <div
                      className="absolute inset-0 rounded pointer-events-none animate-deck-selection"
                      style={{
                        zIndex: 15,
                        border: '3px solid',
                        borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                        background: `radial-gradient(circle at center, transparent 20%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6) 100%)`,
                      }}
                    />
                  )}
                  <div className="w-full h-full rounded" style={cardHighlightStyle}>
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
}, (prevProps, nextProps) => {
  // Custom comparison for PlayerPanel memo
  // Re-render if important props change
  const cursorStackEqual = (
    (prevProps.cursorStack === null && nextProps.cursorStack === null) ||
    (prevProps.cursorStack !== null && nextProps.cursorStack !== null &&
     prevProps.cursorStack.type === nextProps.cursorStack.type &&
     prevProps.cursorStack.count === nextProps.cursorStack.count)
  )
  const playModeEqual = (
    (prevProps.playMode === null && nextProps.playMode === null) ||
    (prevProps.playMode !== null && nextProps.playMode !== null &&
     prevProps.playMode.card.id === nextProps.playMode.card.id)
  )
  return (
    prevProps.player.id === nextProps.player.id &&
    prevProps.player.score === nextProps.player.score &&
    prevProps.player.color === nextProps.player.color &&
    prevProps.player.name === nextProps.player.name &&
    prevProps.player.hand.length === nextProps.player.hand.length &&
    prevProps.player.deck.length === nextProps.player.deck.length &&
    prevProps.player.discard.length === nextProps.player.discard.length &&
    prevProps.player.announcedCard?.id === nextProps.player.announcedCard?.id &&
    prevProps.isGameStarted === nextProps.isGameStarted &&
    prevProps.activePlayerId === nextProps.activePlayerId &&
    prevProps.currentPhase === nextProps.currentPhase &&
    prevProps.imageRefreshVersion === nextProps.imageRefreshVersion &&
    prevProps.currentRound === nextProps.currentRound &&
    cursorStackEqual &&
    playModeEqual
  )
})

export { PlayerPanel }
