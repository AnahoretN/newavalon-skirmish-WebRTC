import React, { memo, useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { GameBoard } from './components/GameBoard'
import { PlayerPanel } from './components/PlayerPanel'
import { Header } from './components/Header'
import { DeckViewModal } from './components/DeckViewModal'
import { TokensModal } from './components/TokensModal'
import { CountersModal } from './components/CountersModal'
import { TeamAssignmentModal } from './components/TeamAssignmentModal'
import { ReadyCheckModal } from './components/ReadyCheckModal'
import { CardDetailModal } from './components/CardDetailModal'
import { RevealRequestModal } from './components/RevealRequestModal'
import { ContextMenu } from './components/ContextMenu'
import { CommandModal } from './components/CommandModal'
import { MainMenu } from './components/MainMenu'
import { RoundEndModal } from './components/RoundEndModal'
import { CounterSelectionModal } from './components/CounterSelectionModal'
import { TopDeckView } from './components/TopDeckView'
import { useGameState } from './hooks/useGameState'
import { useAppAbilities } from './hooks/useAppAbilities'
import { useAppCommand } from './hooks/useAppCommand'
import { useAppCounters } from './hooks/useAppCounters'
import type {
  Player,
  Card,
  DragItem,
  ContextMenuItem,
  ContextMenuParams,
  CursorStackState,
  CardStatus,
  HighlightData,
  PlayerColor,
  FloatingTextData,
  CommandContext,
  CounterSelectionData,
  AbilityAction,
  TargetSelectionEffect,
} from './types'
import { GameMode, DeckType } from './types'
import { STATUS_ICONS, STATUS_DESCRIPTIONS } from './constants'
import { countersDatabase, fetchContentDatabase } from './content'
import { validateTarget, calculateValidTargets, checkActionHasTargets } from '@server/utils/targeting'
import { getCommandAction } from '@server/utils/commandLogic'
import { useLanguage } from './contexts/LanguageContext'
import { TIMING } from './utils/common'
import { shuffleDeck } from '@shared/utils/array'

const COUNTER_BG_URL = 'https://res.cloudinary.com/dxxh6meej/image/upload/v1763653192/background_counter_socvss.png'

const App = memo(function App() {
  const { t } = useLanguage()

  // Declare ability state early (needed by useGameState)
  const [abilityMode, setAbilityMode] = useState<AbilityAction | null>(null)

  const gameStateHook = useGameState({ abilityMode, setAbilityMode })

  const {
    gameState,
    localPlayerId,
    setLocalPlayerId,
    createGame,
    joinGameViaModal,
    joinAsInvite,
    startReadyCheck,
    cancelReadyCheck,
    playerReady,
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    setDummyPlayerCount,
    updatePlayerName,
    changePlayerColor,
    updatePlayerScore,
    changePlayerDeck,
    loadCustomDeck,
    drawCard,
    drawCardsBatch,
    handleDrop,
    draggedItem,
    setDraggedItem,
    connectionStatus,
    gamesList,
    requestGamesList,
    exitGame,
    moveItem,
    updateState,
    shufflePlayerDeck,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    modifyBoardCardPower,
    addAnnouncedCardStatus,
    removeAnnouncedCardStatus,
    modifyAnnouncedCardPower,
    addHandCardStatus,
    removeHandCardStatus,
    flipBoardCard,
    flipBoardCardFaceDown,
    revealHandCard,
    revealBoardCard,
    requestCardReveal,
    respondToRevealRequest,
    syncGame,
    toggleActivePlayer,
    toggleAutoDraw,
    forceReconnect,
    triggerHighlight,
    latestHighlight,
    latestFloatingTexts,
    latestNoTarget,
    triggerNoTarget,
    triggerDeckSelection,
    syncValidTargets,
    remoteValidTargets,
    setTargetingMode,
    clearTargetingMode,
    nextPhase,
    prevPhase,
    setPhase,
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    recoverDiscardedCard,
    resurrectDiscardedCard,
    spawnToken,
    scoreLine,
    closeRoundEndModal,
    resetGame,
    resetDeployStatus,
    scoreDiagonal,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    triggerFloatingText,
    triggerHandCardSelection,
    latestDeckSelections,
    latestHandCardSelections,
  } = gameStateHook

  const [modalsState, setModalsState] = useState({
    isJoinModalOpen: false,
    isDeckBuilderOpen: false,
    isSettingsModalOpen: false,
    isTokensModalOpen: false,
    isCountersModalOpen: false,
    isRulesModalOpen: false,
    isTeamAssignOpen: false,
  })


  const [commandModalCard, setCommandModalCard] = useState<Card | null>(null)
  const [counterSelectionData, setCounterSelectionData] = useState<CounterSelectionData | null>(null)
  const [topDeckViewState, setTopDeckViewState] = useState<{
    targetPlayerId: number;
    isLocked: boolean;
    initialCount: number;
    sourceCard?: Card;
    isDeployAbility?: boolean;
    sourceCoords?: {row: number, col: number};
  } | null>(null)

  const [modalAnchors, setModalAnchors] = useState({
    tokensModalAnchor: null as { top: number; left: number } | null,
    countersModalAnchor: null as { top: number; left: number } | null,
  })

  const [viewingDiscard, setViewingDiscard] = useState<{
    player: Player;
    isDeckView?: boolean;
    pickConfig?: {
      filterType: string;
      action: 'recover' | 'resurrect';
      targetCoords?: {row: number, col: number};
      isDeck?: boolean
    }
  } | null>(null)

  const [viewingCard, setViewingCard] = useState<{ card: Card; player?: Player } | null>(null)

  const [imageRefreshVersion, setImageRefreshVersion] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('image_refresh_data')
      if (stored) {
        const { version, timestamp } = JSON.parse(stored)
        const twelveHours = 12 * 60 * 60 * 1000
        if (Date.now() - timestamp < twelveHours) {
          return version
        }
      }
    } catch (e) {
      console.error('Error parsing image refresh data', e)
    }
    const newVersion = Date.now()
    localStorage.setItem('image_refresh_data', JSON.stringify({ version: newVersion, timestamp: newVersion }))
    return newVersion
  })

  const [contextMenuProps, setContextMenuProps] = useState<ContextMenuParams | null>(null)
  const [playMode, setPlayMode] = useState<{ card: Card; sourceItem: DragItem; faceDown?: boolean } | null>(null)

  const [highlight, setHighlight] = useState<HighlightData | null>(null)
  const [activeFloatingTexts, setActiveFloatingTexts] = useState<FloatingTextData[]>([])
  const [targetSelectionEffects, setTargetSelectionEffects] = useState<TargetSelectionEffect[]>([])

  // Track when we last received highlights from server (to prevent clearing them prematurely)
  const [isAutoAbilitiesEnabled, setIsAutoAbilitiesEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('auto_abilities_enabled')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  // Save auto-abilities setting to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('auto_abilities_enabled', String(isAutoAbilitiesEnabled))
    } catch {
      // Ignore localStorage errors
    }
  }, [isAutoAbilitiesEnabled])

  // Auto-draw is now stored per-player in gameState.players
  const isAutoDrawEnabled = useMemo(() => {
    if (!localPlayerId || !gameState) {
      return false
    }
    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    return localPlayer?.autoDrawEnabled ?? true // Default to true if not set
  }, [gameState, localPlayerId])

  // Memoize board size to avoid unnecessary effect re-renders
  const boardSize = useMemo(() => gameState?.board?.length ?? 6, [gameState?.board?.length])

  // Save auto-draw setting to localStorage when it changes
  useEffect(() => {
    if (!localPlayerId || !gameState) {
      return
    }
    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    if (localPlayer && localPlayer.autoDrawEnabled !== undefined) {
      try {
        localStorage.setItem('auto_draw_enabled', String(localPlayer.autoDrawEnabled))
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [localPlayerId, gameState])

  // Hide dummy cards setting - stored in localStorage
  const [hideDummyCards, setHideDummyCards] = useState(() => {
    try {
      const saved = localStorage.getItem('hide_dummy_cards')
      return saved === null ? false : saved === 'true'
    } catch {
      return false
    }
  })

  // Save hideDummyCards setting to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('hide_dummy_cards', String(hideDummyCards))
    } catch {
      // Ignore localStorage errors
    }
  }, [hideDummyCards])

  const [justAutoTransitioned, setJustAutoTransitioned] = useState(false)
  const [actionQueue, setActionQueue] = useState<AbilityAction[]>([])
  const [validTargets, setValidTargets] = useState<{row: number, col: number}[]>([])
  const [validHandTargets, setValidHandTargets] = useState<{playerId: number, cardIndex: number}[]>([])
  const [noTargetOverlay, setNoTargetOverlay] = useState<{row: number, col: number} | null>(null)
  // Local state for highlights - synchronized via WebSocket, NOT via gameState
  const [commandContext, setCommandContext] = useState<CommandContext>({})
  const [abilityCheckKey, setAbilityCheckKey] = useState(0)
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const [sidePanelWidth, setSidePanelWidth] = useState<number | undefined>(undefined)

  // Trigger target selection effect (white ripple animation)
  const triggerTargetSelection = useCallback((location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => {
    if (localPlayerId === null) {
      return
    }
    const effect: TargetSelectionEffect = {
      timestamp: Date.now(),
      location,
      boardCoords,
      handTarget,
      selectedByPlayerId: localPlayerId,
    }
    setTargetSelectionEffects(prev => [...prev, effect])
    // Auto-remove after 1 second (animation duration)
    setTimeout(() => {
      setTargetSelectionEffects(prev => prev.filter(e => e.timestamp !== effect.timestamp))
    }, 1000)
  }, [localPlayerId])

  const interactionLock = useRef(false)
  // Track sent highlights to avoid duplicate broadcasts

  // Lifted state for cursor stack to resolve circular dependency
  const [cursorStack, setCursorStack] = useState<CursorStackState | null>(null)

  // Determine the owner of the current mode for highlight color
  // This is used for both board highlights and hand card selection highlights
  const highlightOwnerId = useMemo(() => {
    if (abilityMode?.originalOwnerId !== undefined) {
      return abilityMode.originalOwnerId
    }
    if (abilityMode?.sourceCard?.ownerId !== undefined) {
      return abilityMode.sourceCard.ownerId
    }
    if (cursorStack?.originalOwnerId !== undefined) {
      return cursorStack.originalOwnerId
    }
    if (cursorStack?.sourceCard?.ownerId !== undefined) {
      return cursorStack.sourceCard.ownerId
    }
    if (playMode?.card?.ownerId !== undefined) {
      return playMode.card.ownerId
    }
    if (commandModalCard?.ownerId !== undefined) {
      return commandModalCard.ownerId
    }
    return gameState?.activePlayerId ?? 0
  }, [abilityMode, cursorStack, playMode, commandModalCard, gameState?.activePlayerId])

  const pendingRevealRequest = useMemo(() => {
    if (!localPlayerId || !gameState) {
      return null
    }
    return gameState.revealRequests?.find(req => req.toPlayerId === localPlayerId)
  }, [gameState, localPlayerId])

  const {
    playCommandCard,
    handleCommandConfirm,
    handleCounterSelectionConfirm,
  } = useAppCommand({
    gameState,
    localPlayerId,
    setActionQueue,
    setCommandContext,
    setCommandModalCard,
    setCounterSelectionData,
    moveItem,
    drawCard,
    drawCardsBatch,
    updatePlayerScore,
    updateState,
    removeBoardCardStatus,
  })

  // Wrapper for nextPhase that sets justAutoTransitioned flag
  const handleNextPhase = useCallback(() => {
    setJustAutoTransitioned(true)
    nextPhase()
  }, [nextPhase])

  const {
    executeAction,
    handleBoardCardClick,
    handleEmptyCellClick,
    handleHandCardClick,
  } = useAppAbilities({
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    setCursorStack,
    commandContext,
    setCommandContext,
    setViewingDiscard,
    setPlayMode,
    triggerNoTarget,
    triggerTargetSelection,
    setCounterSelectionData,
    interactionLock,
    onAbilityComplete: () => setAbilityCheckKey(prev => prev + 1),
    updateState,
    moveItem,
    drawCard,
    drawCardsBatch,
    updatePlayerScore,
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    resurrectDiscardedCard,
    spawnToken,
    scoreLine,
    nextPhase: handleNextPhase,
    modifyBoardCardPower,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    resetDeployStatus,
    scoreDiagonal,
    removeStatusByType,
    triggerFloatingText,
    triggerHandCardSelection,
    clearValidTargets: () => setValidTargets([]),
  })

  const handleAnnouncedCardDoubleClick = (player: Player, card: Card) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    const isOwner = player.id === localPlayerId
    const isDummy = !!player.isDummy
    const canControl = isOwner || isDummy

    if (canControl) {
      if (card.deck === DeckType.Command) {
        closeAllModals()
        playCommandCard(card, { card, source: 'announced', playerId: player.id })
        return
      }

      closeAllModals()
      const sourceItem: DragItem = { card, source: 'announced', playerId: player.id }
      setPlayMode({ card, sourceItem, faceDown: false })
    } else {
      setViewingCard({ card, player })
    }
  }

  const {
    cursorFollowerRef,
    handleCounterMouseDown,
  } = useAppCounters({
    gameState,
    localPlayerId,
    handleDrop,
    markAbilityUsed,
    requestCardReveal,
    interactionLock,
    setCommandContext, // Passed down for False Orders Step 1 recording
    onAction: executeAction, // Pass the executor here
    cursorStack,
    setCursorStack,
    setAbilityMode,
    triggerTargetSelection,
  })

  const isSpectator = useMemo(
    () => localPlayerId === null && gameState.gameId !== null,
    [localPlayerId, gameState.gameId],
  )

  const realPlayerCount = useMemo(
    () => gameState.players?.filter(p => !p.isDummy).length || 0,
    [gameState.players],
  )

  const isHost = useMemo(() => localPlayerId === 1, [localPlayerId])

  const localPlayer = useMemo(
    () => gameState?.players?.find(p => p.id === localPlayerId),
    [gameState?.players, localPlayerId],
  )

  const isGameActive = useMemo(
    () => gameState?.gameId && (localPlayer || isSpectator),
    [gameState?.gameId, localPlayer, isSpectator],
  )

  const playerColorMap = useMemo(() => {
    const map = new Map<number, PlayerColor>()
    gameState?.players?.forEach(p => map.set(p.id, p.color))
    return map
  }, [gameState?.players])

  const isTargetingMode = useMemo(
    () => !!abilityMode || !!cursorStack,
    [abilityMode, cursorStack],
  )

  const handleDeckClick = useCallback((targetPlayerId: number) => {
    if (abilityMode?.mode === 'SELECT_DECK') {
      // Trigger deck selection effect visible to all players via WebSocket
      triggerDeckSelection(targetPlayerId, gameState.activePlayerId ?? localPlayerId ?? 1)
      setTopDeckViewState({
        targetPlayerId,
        isLocked: true,
        initialCount: 3,
        ...(abilityMode.sourceCard && { sourceCard: abilityMode.sourceCard }),
        ...(abilityMode.isDeployAbility !== undefined && { isDeployAbility: abilityMode.isDeployAbility }),
        ...(abilityMode.sourceCoords && { sourceCoords: abilityMode.sourceCoords }),
      })
      setAbilityMode(null)
    }
  }, [abilityMode, gameState.activePlayerId, localPlayerId, triggerDeckSelection])

  const handleTopDeckReorder = useCallback((playerId: number, newTopCards: Card[]) => {
    reorderTopDeck(playerId, newTopCards)
  }, [reorderTopDeck])

  const handleTopDeckMoveToBottom = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      deckPosition: 'bottom',
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckMoveToHand = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'hand',
      playerId: topDeckViewState.targetPlayerId,
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckMoveToDiscard = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'discard',
      playerId: topDeckViewState.targetPlayerId,
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckPlay = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const card = targetPlayer.deck[cardIndex]
    if (!card) {
      return
    }

    setTopDeckViewState(null)

    const sourceItem: DragItem = {
      card,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex,
    }
    setPlayMode({ card, sourceItem, faceDown: false })
  }, [topDeckViewState, gameState.players, setPlayMode])

  const handleTopDeckClose = useCallback(() => {
    if (topDeckViewState) {
      if (topDeckViewState.isLocked && topDeckViewState.sourceCard) {
        if (topDeckViewState.sourceCard.ownerId !== undefined) {
          drawCard(topDeckViewState.sourceCard.ownerId)
          // Note: Deck shuffling should only happen for specific search abilities (Mr. Pearl, Lucius, Quick Response Team, Michael Falk)
          // Secret Informant and similar view-top abilities do NOT shuffle
        }
        if (topDeckViewState.sourceCoords) {
          markAbilityUsed(topDeckViewState.sourceCoords, topDeckViewState.isDeployAbility)
        }
      }
    }
    setTopDeckViewState(null)
  }, [topDeckViewState, drawCard, markAbilityUsed])

  const topDeckPlayer = useMemo(() => {
    if (!topDeckViewState) {
      return null
    }
    return gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
  }, [topDeckViewState, gameState.players])

  useLayoutEffect(() => {
    const handleResize = () => {
      const headerHeight = 56
      const availableHeight = window.innerHeight - headerHeight
      const boardWidth = availableHeight

      const availableWidth = window.innerWidth
      const remainingX = (availableWidth - boardWidth) / 2

      setSidePanelWidth(Math.max(0, remainingX))
    }

    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Load content database from server on mount
  useEffect(() => {
    let mounted = true

    fetchContentDatabase().then(() => {
      // After loading, if counters are now available, trigger a re-render
      // This ensures STATUS_ICONS are properly loaded for status displays
      if (mounted && Object.keys(countersDatabase).length > 0) {
        setImageRefreshVersion(prev => prev + 1)
      }
    }).catch(err => {
      console.error('Failed to load content database:', err)
    })

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const handleGlobalClickCapture = (e: MouseEvent) => {
      if (interactionLock.current) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    window.addEventListener('click', handleGlobalClickCapture, true)
    return () => window.removeEventListener('click', handleGlobalClickCapture, true)
  }, [])

  useEffect(() => {
    const handleCancelInteraction = () => {
      if (abilityMode?.sourceCoords && abilityMode.sourceCoords.row >= 0) {
        markAbilityUsed(abilityMode.sourceCoords, abilityMode.isDeployAbility, false, abilityMode.readyStatusToRemove)
      }
      if (cursorStack?.sourceCoords && cursorStack.sourceCoords.row >= 0) {
        markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
      }

      // Robust cleanup for ALL controlled players (Local + Dummies)
      gameState.players.forEach(p => {
        // Check if we have permission to control this player (Local or Dummy if we are Host/involved)
        if ((p.id === localPlayerId || p.isDummy) && p.announcedCard) {
          moveItem({
            card: p.announcedCard,
            source: 'announced',
            playerId: p.id,
          }, {
            target: 'discard',
            playerId: p.id,
          })
        }
      })

      setCursorStack(null)
      setPlayMode(null)
      setAbilityMode(null)
      setViewingDiscard(null)
      setCommandModalCard(null)
      setActionQueue([])
      setCommandContext({})
      setCounterSelectionData(null)
      setTopDeckViewState(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        if (gameState.isGameStarted) {
          nextPhase()
        }
      }
      if (e.key === 'Escape') {
        handleCancelInteraction()
      }
    }

    const handleRightClick = (e: MouseEvent) => {
      if (cursorStack || playMode || abilityMode) {
        e.preventDefault()
        handleCancelInteraction()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('contextmenu', handleRightClick)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('contextmenu', handleRightClick)
    }
  }, [cursorStack, playMode, abilityMode, markAbilityUsed, gameState.isGameStarted, nextPhase, localPlayer, moveItem, gameState.players, localPlayerId])

  // Synchronize NO TARGET Overlay via WebSocket Signal
  useEffect(() => {
    if (latestNoTarget) {
      setNoTargetOverlay(latestNoTarget.coords)
      const timer = setTimeout(() => setNoTargetOverlay(null), TIMING.NO_TARGET_DURATION)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestNoTarget])

  // Track token status changes for ability readiness recheck
  const tokenHashRef = useRef<string>('')

  // Reset justAutoTransitioned when phase changes
  useEffect(() => {
    setJustAutoTransitioned(false)
  }, [gameState?.currentPhase])

  // Recheck ability readiness when phase changes
  useEffect(() => {
    setAbilityCheckKey(prev => prev + 1)
  }, [gameState?.currentPhase])

  // Recheck ability readiness when Support/Threat tokens change on active player's cards
  useEffect(() => {
    if (!gameState) {return}
    const activePlayerId = gameState.activePlayerId
    if (activePlayerId === undefined) {
      return
    }

    // Count Support and Threat tokens on all active player's cards
    let tokenHash = ''
    gameState.board.forEach(row => {
      row.forEach(cell => {
        if (cell.card?.ownerId === activePlayerId && cell.card.statuses) {
          const supportCount = cell.card.statuses.filter(s => s.type === 'Support').length
          const threatCount = cell.card.statuses.filter(s => s.type === 'Threat').length
          const stunCount = cell.card.statuses.filter(s => s.type === 'Stun').length
          tokenHash += `${cell.card.id}:${supportCount}:${threatCount}:${stunCount};`
        }
      })
    })

    // Use ref to track previous hash and trigger recheck when it changes
    if (tokenHashRef.current !== tokenHash) {
      tokenHashRef.current = tokenHash
      setAbilityCheckKey(prev => prev + 1)
    }
  }, [gameState])

  useEffect(() => {
    let effectiveAction: AbilityAction | null = abilityMode
    if (cursorStack && !abilityMode) {
      effectiveAction = {
        type: 'CREATE_STACK',
        tokenType: cursorStack.type,
        count: cursorStack.count,
        ...(cursorStack.sourceCard && { sourceCard: cursorStack.sourceCard }),
        ...(cursorStack.onlyFaceDown !== undefined && { onlyFaceDown: cursorStack.onlyFaceDown }),
        ...(cursorStack.onlyOpponents !== undefined && { onlyOpponents: cursorStack.onlyOpponents }),
        ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
        ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
        ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
        ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
        ...(cursorStack.requireStatusFromSourceOwner !== undefined && { requireStatusFromSourceOwner: cursorStack.requireStatusFromSourceOwner }),
        ...(cursorStack.mustBeAdjacentToSource && { mustBeAdjacentToSource: cursorStack.mustBeAdjacentToSource }),
        ...(cursorStack.mustBeInLineWithSource && { mustBeInLineWithSource: cursorStack.mustBeInLineWithSource }),
        ...(cursorStack.maxDistanceFromSource !== undefined && { maxDistanceFromSource: cursorStack.maxDistanceFromSource }),
        ...(cursorStack.maxOrthogonalDistance !== undefined && { maxOrthogonalDistance: cursorStack.maxOrthogonalDistance }),
        ...(cursorStack.sourceCoords && { sourceCoords: cursorStack.sourceCoords }),
      }
    }

    // Effective actor logic for highlighting valid targets
    let actorId: number | null = localPlayerId || gameState.activePlayerId || null
    if (effectiveAction?.sourceCard?.ownerId) {
      actorId = effectiveAction.sourceCard.ownerId
    } else if (effectiveAction?.sourceCoords &&
                 effectiveAction.sourceCoords.row >= 0 &&
                 effectiveAction.sourceCoords.row < boardSize &&
                 effectiveAction.sourceCoords.col >= 0 &&
                 effectiveAction.sourceCoords.col < gameState.board[effectiveAction.sourceCoords.row].length) {
      const sourceCell = gameState.board[effectiveAction.sourceCoords.row][effectiveAction.sourceCoords.col]
      const sourceCard = sourceCell?.card
      if (sourceCard?.ownerId) {
        actorId = sourceCard.ownerId
      }
    } else if (gameState.activePlayerId) {
      const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
      if (activePlayer?.isDummy) {
        actorId = activePlayer.id
      }
    }

    const boardTargets = calculateValidTargets(effectiveAction, gameState, actorId ?? null, commandContext)
    const handTargets: {playerId: number, cardIndex: number}[] = []

    // Handle playMode - highlight empty board cells for unit placement
    if (playMode && !abilityMode && !cursorStack) {
      const card = playMode.card
      const isUnit = card?.types?.includes('Unit')

      if (isUnit) {
        // Find all empty cells on the board within the active grid size
        const activeRows = gameState.board.slice(0, boardSize)
        activeRows.forEach((row, r) => {
          const activeCols = row.slice(0, row.length)
          activeCols.forEach((cell, c) => {
            if (!cell.card) {
              boardTargets.push({ row: r, col: c })
            }
          })
        })
      }
    }

    // Handle commandModalCard - calculate valid targets for command card actions
    if (commandModalCard && !abilityMode && !cursorStack) {
      const player = gameState.players.find(p => p.id === commandModalCard.ownerId)
      if (player?.announcedCard?.id === commandModalCard.id) {
        // Command is in announced zone, get its actions
        const baseId = (commandModalCard.baseId || commandModalCard.id.split('_')[1] || commandModalCard.id).toLowerCase()
        const complexCommands = [
          'overwatch',
          'tacticalmaneuver',
          'repositioning',
          'inspiration',
          'datainterception',
          'falseorders',
          'experimentalstimulants',
          'logisticschain',
          'quickresponseteam',
          'temporaryshelter',
          'enhancedinterrogation',
        ]

        if (complexCommands.some(id => baseId.includes(id))) {
          // For complex commands, we need to get the actions that will be available
          // Try option 0 (first option) to see what targets it needs
          try {
            const optionActions = getCommandAction(commandModalCard.id, 0, commandModalCard, gameState, commandModalCard.ownerId!)
            optionActions.forEach(action => {
              const targets = calculateValidTargets(action, gameState, commandModalCard.ownerId!, commandContext)
              targets.forEach(t => {
                if (!boardTargets.some(bt => bt.row === t.row && bt.col === t.col)) {
                  boardTargets.push(t)
                }
              })
            })
          } catch (e) {
            // If we can't calculate targets, that's ok - modal is open for selection
          }
        }
      }
    }

    if (abilityMode?.type === 'ENTER_MODE' && abilityMode.mode === 'SELECT_TARGET') {
      // Special logic for Quick Response Team Hand Selection highlight
      if (abilityMode.payload.actionType === 'SELECT_HAND_FOR_DEPLOY' || abilityMode.payload.filter) {
        gameState.players.forEach(p => {
          p.hand.forEach((card, index) => {
            // Ensure payload filter is used for hand targets too
            if (abilityMode.payload.filter?.(card)) {
              // For Deploy from Hand, only check owner
              if (abilityMode.payload.actionType === 'SELECT_HAND_FOR_DEPLOY') {
                if (p.id === actorId) {
                  handTargets.push({ playerId: p.id, cardIndex: index })
                }
              } else {
                // Generic destroy/select logic
                handTargets.push({ playerId: p.id, cardIndex: index })
              }
            }
          })
        })
      }
    } else if (cursorStack) {
      const counterDef = countersDatabase[cursorStack.type]
      const allowsHand = cursorStack.type === 'Revealed' || (counterDef?.allowedTargets?.includes('hand'))

      if (allowsHand) {
        gameState.players.forEach(p => {
          p.hand.forEach((card, index) => {
            const constraints = {
              ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
              ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
              onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
              ...(cursorStack.onlyFaceDown !== undefined && { onlyFaceDown: cursorStack.onlyFaceDown }),
              ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
              ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
              tokenType: cursorStack.type,
            }
            const isValid = validateTarget(
              { card, ownerId: p.id, location: 'hand' },
              constraints,
              actorId,
              gameState.players,
            )
            if (isValid) {
              handTargets.push({ playerId: p.id, cardIndex: index })
            }
          })
        })
      }
    }
    if (abilityMode && (abilityMode.mode === 'SCORE_LAST_PLAYED_LINE' || abilityMode.mode === 'SELECT_LINE_END' || abilityMode.mode === 'INTEGRATOR_LINE_SELECT' || abilityMode.mode === 'ZIUS_LINE_SELECT')) {
      const gridSize = boardSize
      if (abilityMode.sourceCoords) {
        // Highlight horizontal line (same row)
        for (let c = 0; c < gridSize; c++) {
          boardTargets.push({ row: abilityMode.sourceCoords.row, col: c })
        }
        // Highlight vertical line (same column)
        for (let r = 0; r < gridSize; r++) {
          boardTargets.push({ row: r, col: abilityMode.sourceCoords.col })
        }
      } else {
        for (let r = 0; r < gridSize; r++) {
          for (let c = 0; c < gridSize; c++) {
            boardTargets.push({ row: r, col: c })
          }
        }
      }
    }

    setValidTargets(boardTargets)
    setValidHandTargets(handTargets)

    // Use universal targeting mode system to sync targets to all players
    // This ensures all players see the same visual highlights
    const hasPlayMode = playMode && playMode.card?.types?.includes('Unit')
    const hasCommandModal = !!commandModalCard
    const hasActiveMode = abilityMode || cursorStack || hasPlayMode || hasCommandModal

    if (hasActiveMode && boardTargets.length > 0) {
      // Determine the action to use for targeting mode
      let targetingAction: AbilityAction | null = null

      if (abilityMode) {
        targetingAction = abilityMode
      } else if (cursorStack) {
        const targetType = cursorStack.targetType
        targetingAction = {
          type: 'ENTER_MODE',
          mode: 'SELECT_TARGET',
          sourceCoords: cursorStack.sourceCoords,
          payload: {
            filter: targetType ? ((card: Card) => card.types?.includes(targetType)) : undefined,
            ...(cursorStack.maxDistanceFromSource !== undefined && { range: cursorStack.maxDistanceFromSource }),
          },
          originalOwnerId: cursorStack.originalOwnerId,
        }
      } else if (playMode) {
        targetingAction = {
          type: 'ENTER_MODE',
          mode: 'SELECT_TARGET',
        }
      } else if (commandModalCard) {
        targetingAction = {
          type: 'ENTER_MODE',
          mode: 'SELECT_TARGET',
        }
      }

      if (targetingAction && actorId !== null) {
        // Pass pre-calculated boardTargets to avoid recalculating (important for line modes)
        // IMPORTANT: The visual highlight color should match the ACTIVE PLAYER (dummy's color when controlled by local player)
        // Priority:
        // 1. commandModalCard.ownerId (for command cards - the card that triggered the mode)
        // 2. abilityMode.sourceCoords -> card.ownerId (for abilities on cards - the card with the ability)
        // 3. cursorStack.sourceCard.ownerId (for token stacking - the source card)
        // 4. gameState.activePlayerId (active player in game - IMPORTANT for dummy control)
        // 5. localPlayerId (current player on this client - fallback)
        // 6. actorId (last resort)
        let targetingPlayerId: number | null = null

        // Priority 1: commandModalCard.ownerId (for command cards)
        if (commandModalCard?.ownerId !== undefined) {
          targetingPlayerId = commandModalCard.ownerId
        }

        // Priority 2: abilityMode.sourceCoords -> card.ownerId (for abilities on cards)
        if (targetingPlayerId === null && abilityMode?.sourceCoords) {
          const { row, col } = abilityMode.sourceCoords
          if (row >= 0 && row < boardSize && col >= 0 && col < gameState.board[row].length) {
            const sourceCard = gameState.board[row][col]?.card
            if (sourceCard?.ownerId !== undefined) {
              targetingPlayerId = sourceCard.ownerId
            }
          }
        }

        // Priority 3: cursorStack.sourceCard.ownerId (for token stacking)
        if (targetingPlayerId === null && cursorStack?.sourceCard?.ownerId !== undefined) {
          targetingPlayerId = cursorStack.sourceCard.ownerId
        }

        // Fallbacks - prioritize activePlayerId (for dummy control) over localPlayerId
        targetingPlayerId = targetingPlayerId ?? gameState.activePlayerId ?? localPlayerId ?? actorId

        setTargetingMode(targetingAction, targetingPlayerId, abilityMode?.sourceCoords || cursorStack?.sourceCoords, boardTargets, commandContext)
      }
    } else if (!hasActiveMode) {
      // Clear targeting mode when no active mode exists
      clearTargetingMode()
    }

    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilityMode, cursorStack, playMode, commandModalCard, gameState.board, gameState.players, localPlayerId, commandContext, gameState.activePlayerId, setTargetingMode, clearTargetingMode])


  // Sync valid hand targets and deck selectability to other players
  useEffect(() => {
    const activePlayerId = gameState.activePlayerId

    // Only the active player should broadcast valid targets
    if (!activePlayerId || activePlayerId !== localPlayerId) {
      return
    }

    // Check if we have valid hand targets or deck selectability
    const hasValidHandTargets = validHandTargets.length > 0
    const isDeckSelectableMode = abilityMode?.mode === 'SELECT_DECK'

    if (!hasValidHandTargets && !isDeckSelectableMode) {
      // No valid targets to sync - could send empty array to clear, but for now just skip
      return
    }

    // Sync valid targets to other players
    syncValidTargets({
      validHandTargets,
      isDeckSelectable: isDeckSelectableMode,
    })
  }, [abilityMode, abilityMode?.mode, validHandTargets, gameState.activePlayerId, localPlayerId, syncValidTargets])

  useEffect(() => {
    if (latestHighlight) {
      setHighlight(latestHighlight)
      const timer = setTimeout(() => setHighlight(null), TIMING.HIGHLIGHT_DURATION)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestHighlight])

  useEffect(() => {
    if (latestFloatingTexts && latestFloatingTexts.length > 0) {
      const newTexts = latestFloatingTexts.map(ft => ({ ...ft, id: `float_${Date.now()}_${Math.random()}` }))
      setActiveFloatingTexts(prev => [...prev, ...newTexts])

      const timer = setTimeout(() => {
        setActiveFloatingTexts(prev => prev.filter(item => !newTexts.find(nt => nt.id === item.id)))
      }, 2000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestFloatingTexts])

  // Scoring Phase Logic
  useEffect(() => {
    // If we left scoring step (e.g. someone else scored), clear the mode
    if (!gameState.isScoringStep && abilityMode?.mode === 'SCORE_LAST_PLAYED_LINE') {
      setAbilityMode(null)
      return
    }

    if (gameState.isScoringStep && !abilityMode) {
      const activePlayerId = gameState.activePlayerId
      const activePlayer = gameState.players.find(p => p.id === activePlayerId)
      // Allow control if it's local player's turn OR if it's a dummy turn (anyone helps dummy)
      const canControl = activePlayer && (activePlayer.id === localPlayerId || activePlayer.isDummy)

      if (canControl) {
        let found = false
        let lastPlayedCoords = null

        // Find the card with LastPlayed status owned by ACTIVE PLAYER
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c < boardSize; c++) {
            const cell = gameState.board[r]?.[c]
            const card = cell?.card
            if (card?.statuses?.some(s => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)) {
              lastPlayedCoords = { row: r, col: c }
              found = true
              break
            }
          }
          if (found) {
            break
          }
        }

        if (found && lastPlayedCoords) {
          setAbilityMode({
            type: 'ENTER_MODE',
            mode: 'SCORE_LAST_PLAYED_LINE',
            sourceCoords: lastPlayedCoords,
          })
        } else {
          // No LastPlayed card found (e.g. destroyed), skip scoring.
          // Prevent race condition: Only Active Player (or Host for Dummy) triggers the phase change.
          if (activePlayerId === localPlayerId || (activePlayer?.isDummy && localPlayerId === 1)) {
            nextPhase()
          }
        }
      }
    }
  }, [gameState?.isScoringStep, gameState?.activePlayerId, localPlayerId, gameState?.board, abilityMode, nextPhase, gameState?.players, boardSize])

  useEffect(() => {
    if (actionQueue.length > 0 && !abilityMode && !cursorStack) {
      const nextAction = actionQueue[0]
      setActionQueue(prev => prev.slice(1))

      // Context Injection Logic for Multi-Step Commands (False Orders / Tactical Maneuver)
      const actionToProcess = { ...nextAction }

      // Only use commandContext if the action explicitly requests it (via useContextCard flag)
      // This prevents actions like Recon Drone's Setup from incorrectly targeting the wrong card
      if (actionToProcess.mode === 'SELECT_CELL' && commandContext.lastMovedCardCoords && actionToProcess.payload?.useContextCard) {
        const { row, col } = commandContext.lastMovedCardCoords
        // Add bounds/null checks before accessing the board
        if (
          typeof row === 'number' && typeof col === 'number' &&
          row >= 0 && row < boardSize &&
          gameState.board[row] &&
          col >= 0 && col < gameState.board[row].length &&
          gameState.board[row][col]
        ) {
          const contextCard = gameState.board[row][col].card
          // If we have a context card on the board, inject it as the source for the move.
          // This is crucial for commands where Step 1 selects a unit and Step 2 moves it.
          if (contextCard) {
            actionToProcess.sourceCard = contextCard
            actionToProcess.sourceCoords = commandContext.lastMovedCardCoords
            // Force recordContext to true so the subsequent step (e.g. Stun in False Orders Mode 2)
            // knows where the card ended up.
            actionToProcess.recordContext = true
          }
        }
      }

      const calculateDynamicCount = (factor: string, ownerId: number, baseCount: number = 0) => {
        let count = baseCount
        if (factor === 'Aim') {
          gameState.board.forEach(row => row.forEach(cell => {
            if (cell.card?.statuses) {
              count += cell.card.statuses.filter(s => s.type === 'Aim' && s.addedByPlayerId === ownerId).length
            }
          }))
        } else if (factor === 'Exploit') {
          gameState.board.forEach(row => row.forEach(cell => {
            if (cell.card?.statuses) {
              count += cell.card.statuses.filter(s => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
            }
          }))
        }
        return count
      }

      if (actionToProcess.type === 'GLOBAL_AUTO_APPLY') {
        if (actionToProcess.payload?.cleanupCommand) {
          // Robust cleanup: determine target player and use current announced card
          const targetPlayerId = actionToProcess.payload.ownerId !== undefined
            ? actionToProcess.payload.ownerId
            : actionToProcess.sourceCard?.ownerId

          if (targetPlayerId !== undefined) {
            const playerState = gameState.players.find(p => p.id === targetPlayerId)
            // Prefer the card actually sitting in the announced slot
            const cardToDiscard = playerState?.announcedCard || actionToProcess.sourceCard

            if (cardToDiscard && cardToDiscard.id !== 'dummy') {
              moveItem({
                card: cardToDiscard,
                source: 'announced',
                playerId: targetPlayerId,
              }, {
                target: 'discard',
                playerId: targetPlayerId,
              })
            }
          }
        } else if (actionToProcess.payload?.dynamicResource) {
          const { type, factor, baseCount, ownerId: payloadOwnerId } = actionToProcess.payload.dynamicResource
          // Use multiple fallbacks: sourceCard.ownerId, originalOwnerId (set in commandLogic), payload.ownerId, then localPlayerId
          const resourceOwnerId = actionToProcess.sourceCard?.ownerId ?? actionToProcess.originalOwnerId ?? payloadOwnerId ?? localPlayerId
          const count = calculateDynamicCount(factor, resourceOwnerId, baseCount)
          if (type === 'draw' && count > 0) {
            drawCardsBatch(resourceOwnerId, count)
          }
        } else if (actionToProcess.payload?.resourceChange) {
          const { draw, score } = actionToProcess.payload.resourceChange
          const activePlayerId = actionToProcess.sourceCard?.ownerId || gameState.activePlayerId
          if (activePlayerId !== undefined && activePlayerId !== null) {
            if (draw) {
              const count = typeof draw === 'number' ? draw : 1
              drawCardsBatch(activePlayerId, count)
            }
            if (score) {
              updatePlayerScore(activePlayerId, score)
            }
          }
        } else if (actionToProcess.payload?.contextReward && actionToProcess.sourceCard) {
          // This is handled inside useAppAbilities now for better access to board state
          // but we call executeAction to trigger it
          executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
        } else if (actionToProcess.payload?.customAction && actionToProcess.sourceCard) {
          // Handle custom actions like FINN_SCORING
          executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
        }
      } else if (actionToProcess.type === 'CREATE_STACK' || actionToProcess.type === 'OPEN_MODAL') {
        // DIRECTLY EXECUTE the action from the queue.
        executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
      } else {
        // Ensure we check targets before blindly setting mode from queue
        const actorId = actionToProcess.sourceCard?.ownerId || localPlayerId
        const hasTargets = checkActionHasTargets(actionToProcess, gameState, actorId, commandContext)


        if (hasTargets) {
          setAbilityMode(actionToProcess)
        } else {
          if (actionToProcess.sourceCoords && actionToProcess.sourceCoords.row >= 0) {
            triggerNoTarget(actionToProcess.sourceCoords)
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionQueue, abilityMode, cursorStack, localPlayerId, drawCard, updatePlayerScore, gameState.activePlayerId, gameState.board, moveItem, commandContext, addBoardCardStatus, gameState.players, executeAction, triggerNoTarget])

  const closeAllModals = useCallback(() => {
    setModalsState(prev => ({
      ...prev,
      isTokensModalOpen: false,
      isCountersModalOpen: false,
      isRulesModalOpen: false,
    }))
    setViewingDiscard(null)
    setViewingCard(null)
    setCommandModalCard(null)
    setCounterSelectionData(null)
    setTopDeckViewState(null)
    setModalAnchors({
      tokensModalAnchor: null,
      countersModalAnchor: null,
    })
  }, [])

  const handleStartGameSequence = useCallback(() => {
    if (!isHost) {
      return
    }
    // Make game private when starting
    setGamePrivacy(true)
    if (gameState.gameMode === GameMode.FreeForAll) {
      startReadyCheck()
    } else {
      setModalsState(prev => ({ ...prev, isTeamAssignOpen: true }))
    }
  }, [isHost, gameState.gameMode, startReadyCheck, setGamePrivacy])

  const handleTeamAssignment = useCallback((teamAssignments: Record<number, number[]>) => {
    assignTeams(teamAssignments)
    setModalsState(prev => ({ ...prev, isTeamAssignOpen: false }))
    startReadyCheck()
  }, [assignTeams, startReadyCheck])

  const handleJoinGame = useCallback((gameId: string) => {
    joinGameViaModal(gameId)
    setModalsState(prev => ({ ...prev, isJoinModalOpen: false }))
  }, [joinGameViaModal])

  const handleCreateGame = useCallback(() => {
    createGame()
    setLocalPlayerId(1)
  }, [createGame, setLocalPlayerId])

  const handleOpenJoinModal = useCallback(() => {
    requestGamesList()
    setModalsState(prev => ({ ...prev, isJoinModalOpen: true }))
  }, [requestGamesList])

  const handleSaveSettings = useCallback((url: string) => {
    const trimmedUrl = url.trim()
    const oldUrl = localStorage.getItem('custom_ws_url') || ''

    // Only reconnect if URL actually changed
    if (trimmedUrl !== oldUrl) {
      localStorage.setItem('custom_ws_url', trimmedUrl)
      forceReconnect()
    }
    setModalsState(prev => ({ ...prev, isSettingsModalOpen: false }))
  }, [forceReconnect])

  // Handle invite link - auto-join game as new player or spectator
  useEffect(() => {
    const inviteGameId = sessionStorage.getItem('invite_game_id')
    const autoJoinFlag = sessionStorage.getItem('invite_auto_join')

    // Only attempt invite join if:
    // 1. We have an invite game ID
    // 2. Connection is established
    // 3. Either we're not in a game, OR the invite game is different from current game
    // 4. We have the auto-join flag (prevents accidental joins when refreshing in an existing game)
    if (inviteGameId && autoJoinFlag && connectionStatus === 'Connected') {
      const shouldJoinAsInvite = !gameState.gameId || gameState.gameId !== inviteGameId

      if (shouldJoinAsInvite) {
        console.warn('[App] Auto-joining game from invite link:', inviteGameId)
        // Clear the stored invite data so we don't try again
        sessionStorage.removeItem('invite_game_id')
        sessionStorage.removeItem('invite_auto_join')
        // Generate a player name for the invite join
        const playerName = `Player ${Math.floor(Math.random() * 1000)}`
        // Join using joinAsInvite (handles new player or spectator)
        joinAsInvite(inviteGameId, playerName)
      } else {
        // Already in this game, clear invite flags
        sessionStorage.removeItem('invite_game_id')
        sessionStorage.removeItem('invite_auto_join')
      }
    }
  }, [connectionStatus, gameState.gameId, joinAsInvite])

  const handleSyncAndRefresh = useCallback(() => {
    const newVersion = Date.now()
    setImageRefreshVersion(newVersion)
    localStorage.setItem('image_refresh_data', JSON.stringify({ version: newVersion, timestamp: newVersion }))
    syncGame()
  }, [syncGame])

  const handleTriggerHighlight = useCallback((coords: { type: 'row' | 'col' | 'cell', row?: number, col?: number}) => {
    if (localPlayerId === null) {
      return
    }
    triggerHighlight({
      ...coords,
      playerId: localPlayerId,
    })
  }, [localPlayerId, triggerHighlight])

  const closeContextMenu = useCallback(() => setContextMenuProps(null), [])

  const openContextMenu = useCallback((e: React.MouseEvent, type: ContextMenuParams['type'], data: any) => {
    e.preventDefault()
    if (abilityMode || cursorStack || playMode) {
      return
    }
    e.stopPropagation()
    if (localPlayerId === null) {
      return
    }
    setContextMenuProps({ x: e.clientX, y: e.clientY, type, data })
  }, [abilityMode, cursorStack, playMode, localPlayerId])

  const handleDoubleClickBoardCard = (card: Card, boardCoords: { row: number, col: number }) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }
    const isOwner = card.ownerId === localPlayerId
    if (isOwner && card.isFaceDown) {
      flipBoardCard(boardCoords); return
    }
    const owner = card.ownerId ? gameState?.players?.find(p => p.id === card.ownerId) : undefined
    const isRevealedByRequest = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
    const isVisibleForMe = !card.isFaceDown || card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId!)) || isRevealedByRequest
    if (isVisibleForMe || isOwner) {
      setViewingCard({ card, player: owner })
    } else if (localPlayerId !== null) {
      requestCardReveal({ source: 'board', ownerId: card.ownerId!, boardCoords }, localPlayerId)
    }
  }

  const handleDoubleClickEmptyCell = (boardCoords: { row: number, col: number }) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }
    handleTriggerHighlight({ type: 'cell', row: boardCoords.row, col: boardCoords.col })
  }

  const handleDoubleClickHandCard = (player: Player, card: Card, cardIndex: number) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    if (player.id === localPlayerId || player.isDummy) {
      if (card.deck === DeckType.Command) {
        closeAllModals()
        playCommandCard(card, { card, source: 'hand', playerId: player.id, cardIndex })
        return
      }

      closeAllModals()
      const sourceItem: DragItem = { card, source: 'hand', playerId: player.id, cardIndex }
      setPlayMode({ card, sourceItem, faceDown: false })
    } else if (localPlayerId !== null) {
      const isRevealedToAll = card.revealedTo === 'all'
      const isRevealedToMe = Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
      const isRevealedByRequest = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
      const isVisible = isRevealedToAll || isRevealedToMe || isRevealedByRequest || !!player.isDummy || !!player.isDisconnected
      if (isVisible) {
        setViewingCard({ card, player })
      } else {
        requestCardReveal({ source: 'hand', ownerId: player.id, cardIndex }, localPlayerId)
      }
    }
  }


  const handleViewDeck = useCallback((player: Player) => {
    setViewingDiscard({ player, isDeckView: true })
  }, [])
  const handleViewDiscard = useCallback((player: Player) => {
    setViewingDiscard({ player, isDeckView: false })
  }, [])

  const viewingDiscardPlayer = useMemo(() => {
    if (!viewingDiscard) {
      return null
    }
    return gameState.players.find(p => p.id === viewingDiscard.player.id) || viewingDiscard.player
  }, [viewingDiscard, gameState.players])

  // Derived highlighting filter for DiscardModal (Deck Search)
  const highlightFilter = useMemo(() => {
    if (viewingDiscard?.pickConfig?.filterType === 'Unit') {
      return (card: Card) => !!card.types?.includes('Unit')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Command') {
      return (card: Card) => card.deck === DeckType.Command || !!card.types?.includes('Command')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Device') {
      return (card: Card) => !!card.types?.includes('Device')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Optimates') {
      return (card: Card) => !!card.types?.includes('Unit') && !!card.types?.includes('Optimates')
    }
    return undefined
  }, [viewingDiscard?.pickConfig?.filterType])

  const handleDiscardCardClick = (cardIndex: number) => {
    if (!viewingDiscard?.pickConfig) {
      return
    }

    const { action, isDeck } = viewingDiscard.pickConfig

    if (action === 'recover') {
      // Add to hand
      if (isDeck) {
        moveItem({
          card: viewingDiscardPlayer!.deck[cardIndex],
          source: 'deck',
          playerId: viewingDiscardPlayer!.id,
          cardIndex,
        }, {
          target: 'hand',
          playerId: viewingDiscardPlayer!.id,
        })

        // Shuffle deck after search for specific abilities that mention "shuffle" in their text
        // These abilities: Mr. Pearl, Lucius Setup, Quick Response Team, Michael Falk
        const shouldShuffle = abilityMode?.sourceCard && (
          abilityMode.sourceCard.name.includes('Mr. Pearl') ||
          abilityMode.sourceCard.name.includes('Lucius') ||
          abilityMode.sourceCard.name.includes('Quick Response') ||
          abilityMode.sourceCard.name.includes('Michael Falk')
        )
        if (shouldShuffle) {
          updateState(currentState => {
            const player = currentState.players.find(p => p.id === viewingDiscardPlayer!.id)
            if (player) {
              player.deck = shuffleDeck(player.deck)
            }
            return currentState
          })
        }
      } else {
        recoverDiscardedCard(viewingDiscardPlayer!.id, cardIndex)
      }
      setViewingDiscard(null)
    } else if (action === 'resurrect') {
      // For Immunis: Select card, then close modal to allow cell selection
      if (abilityMode?.mode === 'IMMUNIS_RETRIEVE') {
        setAbilityMode(prev => ({
          ...prev!,
          payload: { ...prev!.payload, selectedCardIndex: cardIndex },
        }))
        setViewingDiscard(null)
      }
    }
  }

  const handleDiscardContextMenu = (e: React.MouseEvent, cardIndex: number) => {
    if (!viewingDiscard || !viewingDiscardPlayer) {
      return
    }

    // Determine source type for context menu logic
    const isDeck = viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck
    const type = isDeck ? 'deckCard' : 'discardCard'

    const pile = isDeck ? viewingDiscardPlayer.deck : viewingDiscardPlayer.discard
    const card = pile[cardIndex]

    if (card) {
      openContextMenu(e, type, {
        card,
        player: viewingDiscardPlayer,
        cardIndex,
      })
    }
  }

  const renderedContextMenu = useMemo(() => {
    // ... (Context menu logic same as original)
    if (!contextMenuProps || localPlayerId === null || !gameState) {
      return null
    }
    const { type, data, x, y } = contextMenuProps
    let items: ContextMenuItem[] = []
    if (type === 'emptyBoardCell') {
      items.push({ label: t('highlightCell'), onClick: () => handleTriggerHighlight({ type: 'cell', row: data.boardCoords.row, col: data.boardCoords.col }) })
      items.push({ label: t('highlightColumn'), onClick: () => handleTriggerHighlight({ type: 'col', col: data.boardCoords.col }) })
      items.push({ label: t('highlightRow'), onClick: () => handleTriggerHighlight({ type: 'row', row: data.boardCoords.row }) })
    } else if (type === 'boardItem' || type === 'announcedCard') {
      const isBoardItem = type === 'boardItem'
      let card = isBoardItem ? gameState.board[data.boardCoords.row][data.boardCoords.col].card : data.card
      let player = isBoardItem ? null : data.player
      if (!isBoardItem && player) {
        const currentPlayer = gameState.players?.find(p => p.id === player.id)
        if (currentPlayer) {
          player = currentPlayer; card = currentPlayer.announcedCard || card
        }
      }
      if (!card) {
        setContextMenuProps(null); return null
      }
      const owner = card.ownerId ? gameState.players?.find(p => p.id === card.ownerId) : undefined
      const isOwner = card.ownerId === localPlayerId
      const isDummyCard = !!owner?.isDummy
      const canControl = isOwner || isDummyCard
      const isRevealedByRequest = card.statuses?.some((s: any) => s.type === 'Revealed' && (s.addedByPlayerId === localPlayerId))
      const isVisible = !card.isFaceDown || card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)) || isRevealedByRequest
      if (isVisible || (isOwner && card.isFaceDown)) {
        items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card, player: owner }) })
      }
      if (!isBoardItem && canControl && card.deck === DeckType.Command) {
        items.push({ label: t('play'), isBold: true, onClick: () => {
          playCommandCard(card, { card, source: 'announced', playerId: player!.id })
        } })
      }
      if (isBoardItem && canControl) {
        if (card.isFaceDown) {
          items.push({ label: t('flipUp'), isBold: true, onClick: () => flipBoardCard(data.boardCoords) })
        } else {
          items.push({ label: t('flipDown'), onClick: () => flipBoardCardFaceDown(data.boardCoords) })
        }
      }
      const sourceItem: DragItem = isBoardItem ? { card, source: 'board', boardCoords: data.boardCoords } : { card, source: 'announced', playerId: player!.id }
      const ownerId = card.ownerId
      const isSpecialItem = card?.deck === DeckType.Tokens || card?.deck === 'counter'
      if (isBoardItem) {
        if (canControl && card.isFaceDown) {
          items.push({ label: t('revealToAll'), onClick: () => revealBoardCard(data.boardCoords, 'all') })
        }
        if (!isOwner && !isVisible) {
          items.push({ label: t('requestReveal'), onClick: () => requestCardReveal({ source: 'board', ownerId: card.ownerId!, boardCoords: data.boardCoords }, localPlayerId) })
        }
      }
      if (items.length > 0) {
        items.push({ isDivider: true })
      }
      if (canControl && isVisible) {
        items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: ownerId }) })
        if (ownerId) {
          const discardLabel = isSpecialItem ? t('remove') : t('toDiscard')
          items.push({ label: discardLabel, onClick: () => moveItem(sourceItem, { target: 'discard', playerId: ownerId }) })
          items.push({ label: t('toDeckTop'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: ownerId, deckPosition: 'top' }) })
          items.push({ label: t('toDeckBottom'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: ownerId, deckPosition: 'bottom' }) })
        }
      }
      if (isBoardItem) {
        items.push({ isDivider: true })
        items.push({ label: t('highlightCell'), onClick: () => handleTriggerHighlight({ type: 'cell', row: data.boardCoords.row, col: data.boardCoords.col }) })
        items.push({ label: t('highlightColumn'), onClick: () => handleTriggerHighlight({ type: 'col', col: data.boardCoords.col }) })
        items.push({ label: t('highlightRow'), onClick: () => handleTriggerHighlight({ type: 'row', row: data.boardCoords.row }) })
      }
      if (isVisible && (canControl || isBoardItem)) {
        const allStatusTypes = ['Aim', 'Exploit', 'Stun', 'Shield', 'Support', 'Threat', 'Revealed']
        const visibleStatusItems: ContextMenuItem[] = []
        allStatusTypes.forEach(status => {
          const currentCount = card.statuses?.filter((s: any) => s.type === status).length || 0
          if (currentCount > 0) {
            visibleStatusItems.push({
              type: 'statusControl',
              label: status,
              onAdd: () => isBoardItem ? addBoardCardStatus(data.boardCoords, status, localPlayerId) : addAnnouncedCardStatus(player.id, status, localPlayerId),
              onRemove: () => isBoardItem ? removeBoardCardStatus(data.boardCoords, status) : removeAnnouncedCardStatus(player.id, status),
              removeDisabled: false,
            })
          }
        })
        if (visibleStatusItems.length > 0) {
          if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
            items.push({ isDivider: true })
          }
          items.push(...visibleStatusItems)
        }
        if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
          items.push({ isDivider: true })
        }
        items.push({
          type: 'statusControl',
          label: t('power'),
          onAdd: () => isBoardItem ? modifyBoardCardPower(data.boardCoords, 1) : modifyAnnouncedCardPower(player.id, 1),
          onRemove: () => isBoardItem ? modifyBoardCardPower(data.boardCoords, -1) : modifyAnnouncedCardPower(player.id, -1),
          removeDisabled: false,
        })
      }
    } else if (type === 'token_panel_item') {
      const { card } = data
      const sourceItem: DragItem = { card, source: 'token_panel' }
      items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card }) })
      items.push({ isDivider: true })
      items.push({ label: t('play'), isBold: true, onClick: () => {
        closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
      } })
      items.push({ label: t('playFaceDown'), onClick: () => {
        closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
      } })
    } else if (['handCard', 'discardCard', 'deckCard'].includes(type)) {
      let { card, player } = data
      const { boardCoords, cardIndex } = data
      const currentPlayer = gameState.players?.find(p => p.id === player.id)
      if (currentPlayer) {
        player = currentPlayer
        if (type === 'handCard') {
          card = currentPlayer.hand[cardIndex] || card
        } else if (type === 'discardCard') {
          card = currentPlayer.discard[cardIndex] || card
        } else if (type === 'deckCard') {
          card = currentPlayer.deck[cardIndex] || card
        }
      }
      const canControl = player.id === localPlayerId || !!player.isDummy
      const localP = gameState.players?.find(p => p.id === localPlayerId)
      const isTeammate = localP?.teamId !== undefined && player.teamId === localP.teamId
      const isRevealedToMe = card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId))
      const isRevealedByRequest = card.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
      const isVisible = (() => {
        if (type !== 'handCard') {
          return true
        }
        return player.id === localPlayerId || isTeammate || !!player.isDummy || !!player.isDisconnected || isRevealedToMe || isRevealedByRequest
      })()
      let source: DragItem['source']
      if (type === 'handCard') {
        source = 'hand'
      } else if (type === 'discardCard') {
        source = 'discard'
      } else {
        source = 'deck'
      }
      const sourceItem: DragItem = { card, source, playerId: player?.id, cardIndex, boardCoords }
      const ownerId = card.ownerId
      const isSpecialItem = card?.deck === DeckType.Tokens || card?.deck === 'counter'

      // Show View option if visible to local player
      if (isVisible) {
        const owner = card.ownerId ? gameState?.players?.find(p => p.id === card.ownerId) : undefined
        items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card, player: owner }) })
      }

      if (canControl) {
        if (card.deck === DeckType.Command) {
          items.push({ label: t('play'), isBold: true, onClick: () => {
            closeAllModals(); playCommandCard(card, sourceItem)
          } })
        } else if (type === 'handCard') {
          items.push({ label: t('play'), isBold: true, onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
          } })
          items.push({ label: t('playFaceDown'), onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
          } })
        } else if (isVisible && ['discardCard', 'deckCard'].includes(type)) {
          items.push({ label: t('play'), isBold: true, onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
          } })
          items.push({ label: t('playFaceDown'), onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
          } })
        }
        if (items.length > 0) {
          items.push({ isDivider: true })
        }
        if (type === 'handCard') {
          items.push({ label: t('revealToAll'), onClick: () => revealHandCard(player.id, cardIndex, 'all') })
        }
        if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
          items.push({ isDivider: true })
        }
        if (type === 'discardCard') {
          // Use ownerId if set, otherwise fall back to the player who owns the discard pile
          const targetPlayerId = ownerId ?? player.id
          items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: targetPlayerId }) })
        } else if (type === 'handCard') {
          items.push({ label: t('toDiscard'), onClick: () => moveItem(sourceItem, { target: 'discard', playerId: ownerId }) })
        }
        if (['handCard', 'discardCard'].includes(type)) {
          // Use ownerId if set, otherwise fall back to the player who owns the pile
          const targetPlayerId = ownerId ?? player.id
          items.push({ label: t('toDeckTop'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: targetPlayerId, deckPosition: 'top' }) })
          items.push({ label: t('toDeckBottom'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: targetPlayerId, deckPosition: 'bottom' }) })
        }
        if (type === 'deckCard') {
          items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: player.id }) })
          items.push({ label: t('toDiscard'), onClick: () => moveItem(sourceItem, { target: 'discard', playerId: player.id }) })
        }
        if (type === 'handCard') {
          const revealedCount = card.statuses?.filter((s: CardStatus) => s.type === 'Revealed').length || 0
          if (revealedCount > 0) {
            if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
              items.push({ isDivider: true })
            }
            items.push({ type: 'statusControl', label: t('revealed'), onAdd: () => addHandCardStatus(player.id, cardIndex, 'Revealed', localPlayerId), onRemove: () => removeHandCardStatus(player.id, cardIndex, 'Revealed'), removeDisabled: false })
          }
        }
      } else if (type === 'handCard' && !isVisible) {
        // If it's an opponent's card and NOT visible, allow request reveal.
        items.push({ label: t('requestReveal'), onClick: () => requestCardReveal({ source: 'hand', ownerId: player.id, cardIndex }, localPlayerId) })
      }
    } else if (type === 'deckPile') {
      const { player } = data
      const canControl = player.id === localPlayerId || !!player.isDummy
      if (canControl) {
        items.push({ label: t('drawCard'), onClick: () => drawCard(player.id) })
        items.push({ label: t('drawStartingHand'), onClick: () => {
          for (let i = 0; i < 6; i++) {
            drawCard(player.id)
          }
        } })
        items.push({ label: t('viewTopCards'), onClick: () => setTopDeckViewState({ targetPlayerId: player.id, isLocked: false, initialCount: 1 }) })
        items.push({ label: t('shuffle'), onClick: () => shufflePlayerDeck(player.id) })
      }
      items.push({ label: t('view'), onClick: () => handleViewDeck(player) })
    } else if (type === 'discardPile') {
      const { player } = data
      items.push({ label: t('view'), onClick: () => handleViewDiscard(player) })
    }
    items = items.filter((item, index) => {
      if (!('isDivider' in item)) {
        return true
      }
      if (index === 0 || index === items.length - 1) {
        return false
      }
      if ('isDivider' in items[index - 1]) {
        return false
      }
      return true
    })
    return <ContextMenu x={x} y={y} items={items} onClose={closeContextMenu} />
  }, [gameState, localPlayerId, moveItem, handleTriggerHighlight, addBoardCardStatus, removeBoardCardStatus, modifyBoardCardPower, addAnnouncedCardStatus, removeAnnouncedCardStatus, modifyAnnouncedCardPower, addHandCardStatus, removeHandCardStatus, drawCard, shufflePlayerDeck, flipBoardCard, flipBoardCardFaceDown, revealHandCard, revealBoardCard, requestCardReveal, t, playCommandCard, contextMenuProps, closeAllModals, closeContextMenu, handleViewDeck, handleViewDiscard])

  useEffect(() => {
    window.addEventListener('click', closeContextMenu)
    const handleContextMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-interactive]')) {
        closeContextMenu()
      }
    }
    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('click', closeContextMenu)
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [closeContextMenu])

  useEffect(() => {
    if (draggedItem) {
      closeContextMenu()
    }
  }, [draggedItem, closeContextMenu])

  const handleOpenTokensModal = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (modalsState.isTokensModalOpen) {
      setModalsState(prev => ({ ...prev, isTokensModalOpen: false }))
      setModalAnchors(prev => ({ ...prev, tokensModalAnchor: null }))
    } else {
      setModalsState(prev => ({ ...prev, isTokensModalOpen: true, isCountersModalOpen: false }))
      const rect = event.currentTarget.getBoundingClientRect()
      setModalAnchors({
        tokensModalAnchor: { top: rect.top, left: rect.left },
        countersModalAnchor: null,
      })
    }
  }, [modalsState.isTokensModalOpen])

  const handleOpenCountersModal = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (modalsState.isCountersModalOpen) {
      setModalsState(prev => ({ ...prev, isCountersModalOpen: false }))
      setModalAnchors(prev => ({ ...prev, countersModalAnchor: null }))
    } else {
      setModalsState(prev => ({ ...prev, isCountersModalOpen: true, isTokensModalOpen: false }))
      const rect = event.currentTarget.getBoundingClientRect()
      setModalAnchors({
        countersModalAnchor: { top: rect.top, left: rect.left },
        tokensModalAnchor: null,
      })
    }
  }, [modalsState.isCountersModalOpen])

  // Only show MainMenu if not in game
  if (!isGameActive) {
    return (
      <MainMenu
        handleCreateGame={handleCreateGame}
        setSettingsModalOpen={(open) => setModalsState(prev => ({ ...prev, isSettingsModalOpen: open }))}
        handleOpenJoinModal={handleOpenJoinModal}
        setDeckBuilderOpen={(open) => setModalsState(prev => ({ ...prev, isDeckBuilderOpen: open }))}
        setRulesModalOpen={(open) => setModalsState(prev => ({ ...prev, isRulesModalOpen: open }))}
        isJoinModalOpen={modalsState.isJoinModalOpen}
        setJoinModalOpen={(open) => setModalsState(prev => ({ ...prev, isJoinModalOpen: open }))}
        handleJoinGame={handleJoinGame}
        gamesList={gamesList}
        requestGamesList={requestGamesList}
        isDeckBuilderOpen={modalsState.isDeckBuilderOpen}
        setViewingCard={setViewingCard}
        isSettingsModalOpen={modalsState.isSettingsModalOpen}
        handleSaveSettings={handleSaveSettings}
        isRulesModalOpen={modalsState.isRulesModalOpen}
        viewingCard={viewingCard}
        gameState={gameState}
        imageRefreshVersion={imageRefreshVersion}
        t={t}
        connectionStatus={connectionStatus}
        forceReconnect={forceReconnect}
        gameId={gameState.gameId}
        isGameStarted={gameState.isGameStarted}
        isPrivate={gameState.isPrivate}
      />
    )
  }

  return (
    <div className={`relative w-screen h-screen overflow-hidden ${cursorStack ? 'cursor-none cursor-stack-active' : ''}`}>
      <Header
        gameId={gameState.gameId}
        isGameStarted={gameState.isGameStarted}
        onStartGame={handleStartGameSequence}
        onResetGame={resetGame}
        activeGridSize={gameState.activeGridSize}
        onGridSizeChange={setActiveGridSize}
        dummyPlayerCount={gameState.dummyPlayerCount}
        onDummyPlayerCountChange={setDummyPlayerCount}
        realPlayerCount={realPlayerCount}
        connectionStatus={connectionStatus}
        onExitGame={exitGame}
        onOpenTokensModal={handleOpenTokensModal}
        onOpenCountersModal={handleOpenCountersModal}
        gameMode={gameState.gameMode}
        onGameModeChange={setGameMode}
        isPrivate={gameState.isPrivate}
        onPrivacyChange={setGamePrivacy}
        isHost={isHost}
        onSyncGame={handleSyncAndRefresh}
        currentPhase={gameState.currentPhase}
        onSetPhase={setPhase}
        onNextPhase={nextPhase}
        onPrevPhase={prevPhase}
        activePlayerId={gameState.activePlayerId}
        playerColorMap={playerColorMap}
        isAutoAbilitiesEnabled={isAutoAbilitiesEnabled}
        onToggleAutoAbilities={setIsAutoAbilitiesEnabled}
        isAutoDrawEnabled={isAutoDrawEnabled}
        onToggleAutoDraw={(enabled) => {
          if (localPlayerId) {
            toggleAutoDraw(localPlayerId, enabled)
          }
        }}
        hideDummyCards={hideDummyCards}
        onToggleHideDummyCards={setHideDummyCards}
        currentRound={gameState.currentRound}
        turnNumber={gameState.turnNumber}
      />

      {gameState.isRoundEndModalOpen && (
        <RoundEndModal
          gameState={gameState}
          onContinueGame={resetGame}
          onStartNextRound={closeRoundEndModal}
          onExit={exitGame}
        />
      )}

      {modalsState.isTeamAssignOpen && (
        <TeamAssignmentModal
          players={gameState.players}
          gameMode={gameState.gameMode}
          onCancel={() => setModalsState(prev => ({ ...prev, isTeamAssignOpen: false }))}
          onConfirm={handleTeamAssignment}
        />
      )}

      {gameState.isReadyCheckActive && localPlayer && (
        <ReadyCheckModal
          players={gameState.players}
          localPlayer={localPlayer}
          onReady={playerReady}
          onCancel={cancelReadyCheck}
        />
      )}

      {/* Reveal Request Modal - Rendered if there is a pending request for local player */}
      {pendingRevealRequest && (
        <RevealRequestModal
          fromPlayer={gameState.players.find(p => p.id === pendingRevealRequest.fromPlayerId)!}
          cardCount={pendingRevealRequest.cardIdentifiers.length}
          onAccept={() => respondToRevealRequest(pendingRevealRequest.fromPlayerId, true)}
          onDecline={() => respondToRevealRequest(pendingRevealRequest.fromPlayerId, false)}
        />
      )}

      {commandModalCard && (
        <CommandModal
          isOpen={!!commandModalCard}
          card={commandModalCard}
          playerColorMap={new Map(gameState.players.map(p => [p.id, p.color])) as any}
          onConfirm={(index) => handleCommandConfirm(index, commandModalCard)}
          onCancel={() => {
            setCommandModalCard(null); setActionQueue([]); setCommandContext({})
          }}
        />
      )}

      {counterSelectionData && (
        <CounterSelectionModal
          isOpen={!!counterSelectionData}
          data={counterSelectionData}
          onConfirm={(count) => handleCounterSelectionConfirm(count, counterSelectionData)}
          onCancel={() => {
            setCounterSelectionData(null); setAbilityMode(null)
          }}
        />
      )}

      {topDeckViewState && topDeckPlayer && (
        <TopDeckView
          isOpen={!!topDeckViewState}
          player={topDeckPlayer}
          onClose={handleTopDeckClose}
          onReorder={handleTopDeckReorder}
          onMoveToBottom={handleTopDeckMoveToBottom}
          onViewCard={(card) => setViewingCard({ card })}
          onMoveToHand={handleTopDeckMoveToHand}
          onMoveToDiscard={handleTopDeckMoveToDiscard}
          onPlayCard={handleTopDeckPlay}
          playerColorMap={playerColorMap}
          localPlayerId={localPlayerId}
          imageRefreshVersion={imageRefreshVersion}
          initialCount={topDeckViewState.initialCount}
          isLocked={topDeckViewState.isLocked}
        />
      )}

      {viewingCard && (
        <CardDetailModal
          card={viewingCard.card}
          ownerPlayer={viewingCard.player}
          onClose={() => setViewingCard(null)}
          statusDescriptions={STATUS_DESCRIPTIONS}
          allPlayers={gameState.players}
          imageRefreshVersion={imageRefreshVersion}
        />
      )}

      {/* MODALS RE-ADDED TO RENDER TREE */}
      {viewingDiscard && viewingDiscardPlayer && (
        <DeckViewModal
          isOpen={!!viewingDiscard}
          onClose={() => {
            setViewingDiscard(null); setAbilityMode(null)
          }}
          title={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? (viewingDiscard.pickConfig ? t('selectCardFromDeck') : t('deckView')) : (viewingDiscard.pickConfig ? t('selectCardFromDiscard') : t('discardView'))}
          player={viewingDiscardPlayer}
          cards={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? viewingDiscardPlayer.deck : viewingDiscardPlayer.discard}
          setDraggedItem={setDraggedItem}
          canInteract={!!viewingDiscard.pickConfig || viewingDiscardPlayer.id === localPlayerId || !!viewingDiscardPlayer.isDummy}
          onCardClick={handleDiscardCardClick}
          onCardDoubleClick={handleDiscardCardClick}
          onCardContextMenu={handleDiscardContextMenu}
          onReorder={(playerId, newCards) => {
            const source = viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? 'deck' : 'discard'
            reorderCards(playerId, newCards, source)
          }}
          isDeckView={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck}
          playerColorMap={playerColorMap}
          localPlayerId={localPlayerId}
          imageRefreshVersion={imageRefreshVersion}
          highlightFilter={highlightFilter}
          cursorStack={cursorStack}
        />
      )}

      <TokensModal
        isOpen={modalsState.isTokensModalOpen}
        onClose={() => setModalsState(prev => ({ ...prev, isTokensModalOpen: false }))}
        setDraggedItem={setDraggedItem}
        openContextMenu={openContextMenu}
        canInteract={!!localPlayerId && !isSpectator}
        anchorEl={modalAnchors.tokensModalAnchor}
        imageRefreshVersion={imageRefreshVersion}
      />

      <CountersModal
        isOpen={modalsState.isCountersModalOpen}
        onClose={() => setModalsState(prev => ({ ...prev, isCountersModalOpen: false }))}
        canInteract={!!localPlayerId && !isSpectator}
        anchorEl={modalAnchors.countersModalAnchor}
        imageRefreshVersion={imageRefreshVersion}
        onCounterMouseDown={handleCounterMouseDown}
        cursorStack={cursorStack}
      />

      {renderedContextMenu}

      {/* Cursor Follower for Token Stacks */}
      {cursorStack && (
        <div
          ref={cursorFollowerRef}
          className="fixed top-0 left-0 pointer-events-none z-[99999] flex items-center justify-center"
          style={{ willChange: 'transform' }}
        >
          <div
            className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center relative bg-gray-900"
            style={{
              backgroundImage: `url(${COUNTER_BG_URL})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {STATUS_ICONS[cursorStack.type] ? (
              <img
                src={`${STATUS_ICONS[cursorStack.type]}${imageRefreshVersion ? `?v=${imageRefreshVersion}` : ''}`}
                alt={cursorStack.type}
                className="w-8 h-8 object-contain"
              />
            ) : (
              <span className={`font-bold text-white drop-shadow-md ${cursorStack.type.startsWith('Power') ? 'text-sm' : 'text-lg'}`}>
                {cursorStack.type.startsWith('Power') ? cursorStack.type : cursorStack.type.charAt(0)}
              </span>
            )}

            {cursorStack.count > 1 && (
              <div className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10">
                {cursorStack.count}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative h-full w-full pt-14 overflow-hidden bg-gray-900">
        {localPlayer && (
          <div
            ref={leftPanelRef}
            className="absolute left-0 top-14 bottom-[2px] z-30 bg-panel-bg shadow-xl flex flex-col w-fit min-w-0 pl-[2px] py-[2px] pr-0 transition-all duration-100 overflow-hidden"
            style={{ width: sidePanelWidth }}
          >
            <PlayerPanel
              key={localPlayer.id}
              player={localPlayer}
              isLocalPlayer={true}
              localPlayerId={localPlayerId}
              isSpectator={isSpectator}
              isGameStarted={gameState.isGameStarted}
              onNameChange={(name) => updatePlayerName(localPlayer.id, name)}
              onColorChange={(color) => changePlayerColor(localPlayer.id, color)}
              onScoreChange={(delta) => updatePlayerScore(localPlayer.id, delta)}
              onDeckChange={(deckType) => changePlayerDeck(localPlayer.id, deckType)}
              onLoadCustomDeck={(deckFile) => loadCustomDeck(localPlayer.id, deckFile)}
              onDrawCard={() => drawCard(localPlayer.id)}
              handleDrop={handleDrop}
              draggedItem={draggedItem}
              setDraggedItem={setDraggedItem}
              openContextMenu={openContextMenu}
              onHandCardDoubleClick={handleDoubleClickHandCard}
              playerColorMap={playerColorMap}
              allPlayers={gameState.players}
              localPlayerTeamId={localPlayer?.teamId}
              activePlayerId={gameState.activePlayerId}
              onToggleActivePlayer={toggleActivePlayer}
              imageRefreshVersion={imageRefreshVersion}
              layoutMode="list-local"
              onCardClick={handleHandCardClick}
              validHandTargets={validHandTargets}
              onAnnouncedCardDoubleClick={handleAnnouncedCardDoubleClick}
              currentPhase={gameState.currentPhase}
              disableActiveHighlights={isTargetingMode}
              preserveDeployAbilities={justAutoTransitioned}
              roundWinners={gameState.roundWinners}
              startingPlayerId={gameState.startingPlayerId}
              onDeckClick={handleDeckClick}
              isDeckSelectable={abilityMode?.mode === 'SELECT_DECK'}
              hideDummyCards={hideDummyCards}
              deckSelections={latestDeckSelections}
              handCardSelections={latestHandCardSelections}
              cursorStack={cursorStack}
              remoteValidTargets={remoteValidTargets}
              highlightOwnerId={highlightOwnerId}
            />
          </div>
        )}

        <div
          className="absolute top-14 bottom-0 z-10 flex items-center justify-center pointer-events-none w-full left-0"
        >
          <div
            ref={boardContainerRef}
            className="pointer-events-auto h-full aspect-square flex items-center justify-center py-[2px]"
          >
            <GameBoard
              board={gameState.board}
              isGameStarted={gameState.isGameStarted}
              activeGridSize={gameState.activeGridSize}
              handleDrop={handleDrop}
              draggedItem={draggedItem}
              setDraggedItem={setDraggedItem}
              openContextMenu={openContextMenu}
              playMode={playMode}
              setPlayMode={setPlayMode}
              highlight={highlight}
              playerColorMap={playerColorMap}
              localPlayerId={localPlayerId}
              onCardDoubleClick={handleDoubleClickBoardCard}
              onEmptyCellDoubleClick={handleDoubleClickEmptyCell}
              imageRefreshVersion={imageRefreshVersion}
              cursorStack={cursorStack}
              currentPhase={gameState.currentPhase}
              activePlayerId={gameState.activePlayerId}
              onCardClick={handleBoardCardClick}
              onEmptyCellClick={handleEmptyCellClick}
              validTargets={validTargets}
              targetingMode={gameState.targetingMode}
              noTargetOverlay={noTargetOverlay}
              disableActiveHighlights={isTargetingMode}
              preserveDeployAbilities={justAutoTransitioned}
              activeFloatingTexts={activeFloatingTexts}
              abilitySourceCoords={abilityMode?.sourceCoords || null}
              abilityCheckKey={abilityCheckKey}
              targetSelectionEffects={targetSelectionEffects}
            />
          </div>
        </div>

        <div
          className="absolute right-0 top-14 bottom-[2px] z-30 bg-panel-bg shadow-xl flex flex-col min-w-0 pr-[2px] py-[2px] pl-0 transition-all duration-100 overflow-hidden"
          style={{ width: sidePanelWidth }}
        >
          <div className="flex flex-col h-full w-full">
            {gameState.players
              .filter(p => p.id !== localPlayerId)
              .sort((a, b) => {
                // Sort players in clockwise order relative to local player
                // Players after local player come first, then players before
                const localPos = localPlayer?.position ?? 0
                const aPos = a.position ?? 0
                const bPos = b.position ?? 0

                // Calculate relative positions (0 = next player, higher = later)
                const aRelative = (aPos - localPos + gameState.players.length) % gameState.players.length
                const bRelative = (bPos - localPos + gameState.players.length) % gameState.players.length

                return aRelative - bRelative
              })
              .map(player => (
                <div key={player.id} className="w-full flex-1 min-h-0 flex flex-col">
                  <PlayerPanel
                    player={player}
                    isLocalPlayer={false}
                    localPlayerId={localPlayerId}
                    isSpectator={isSpectator}
                    isGameStarted={gameState.isGameStarted}
                    onNameChange={(name) => updatePlayerName(player.id, name)}
                    onColorChange={(color) => changePlayerColor(player.id, color)}
                    onScoreChange={(delta) => updatePlayerScore(player.id, delta)}
                    onDeckChange={(deckType) => changePlayerDeck(player.id, deckType)}
                    onLoadCustomDeck={(deckFile) => loadCustomDeck(player.id, deckFile)}
                    onDrawCard={() => drawCard(player.id)}
                    handleDrop={handleDrop}
                    draggedItem={draggedItem}
                    setDraggedItem={setDraggedItem}
                    openContextMenu={openContextMenu}
                    onHandCardDoubleClick={handleDoubleClickHandCard}
                    playerColorMap={playerColorMap}
                    allPlayers={gameState.players}
                    localPlayerTeamId={localPlayer?.teamId}
                    activePlayerId={gameState.activePlayerId}
                    onToggleActivePlayer={toggleActivePlayer}
                    imageRefreshVersion={imageRefreshVersion}
                    layoutMode="list-remote"
                    onCardClick={handleHandCardClick}
                    currentPhase={gameState.currentPhase}
                    validHandTargets={validHandTargets}
                    onAnnouncedCardDoubleClick={handleAnnouncedCardDoubleClick}
                    disableActiveHighlights={isTargetingMode}
                    preserveDeployAbilities={justAutoTransitioned}
                    roundWinners={gameState.roundWinners}
                    startingPlayerId={gameState.startingPlayerId}
                    onDeckClick={handleDeckClick}
                    isDeckSelectable={abilityMode?.mode === 'SELECT_DECK'}
                    hideDummyCards={hideDummyCards}
                    deckSelections={latestDeckSelections}
                    handCardSelections={latestHandCardSelections}
                    cursorStack={cursorStack}
                    remoteValidTargets={remoteValidTargets}
                    highlightOwnerId={highlightOwnerId}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
})

export default App
