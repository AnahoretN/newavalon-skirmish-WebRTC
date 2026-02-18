import React, { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { DeckType } from '@/types'
import type { Card as CardType, PlayerColor } from '@/types'
import { DECK_THEMES, PLAYER_COLORS, STATUS_ICONS, PLAYER_COLOR_RGB } from '@/constants'
import { Tooltip, CardTooltipContent } from './Tooltip'
import { hasReadyAbilityInCurrentPhase, hasReadyStatusForPhase } from '@/utils/autoAbilities'
import { useLanguage } from '@/contexts/LanguageContext'
import { getOptimizedImageUrl, getThumbnailImageUrl, addCacheBust, isCloudinaryUrl } from '@/utils/imageOptimization'
import { globalImageLoader } from '@/utils/imageLoader'

// Split props to prevent unnecessary rerenders when only display props change
interface CardCoreProps {
  card: CardType;
  isFaceUp: boolean;
  playerColorMap: Map<number, PlayerColor>;
  imageRefreshVersion?: number;
  smallStatusIcons?: boolean;
  extraPowerSpacing?: boolean;
  hidePower?: boolean;
}

interface CardInteractionProps {
  localPlayerId?: number | null;
  disableTooltip?: boolean;
  activePhaseIndex?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  activeAbilitySourceCoords?: { row: number, col: number } | null; // Source of currently active ability
  boardCoords?: { row: number, col: number } | null; // This card's position on board
  abilityCheckKey?: number; // Incremented to recheck ability readiness after ability completion
  onCardClick?: (card: CardType, boardCoords: { row: number, col: number }) => void; // Called when card is clicked
  targetingMode?: boolean; // Whether targeting mode is active (hides ready statuses)
}

// Extracted outside CardCore to preserve React.memo optimization
interface StatusIconProps {
  type: string;
  playerId: number;
  count: number;
  refreshVersion?: number;
  playerColorMap: Map<number, PlayerColor>;
  smallStatusIcons?: boolean;
}

const StatusIcon: React.FC<StatusIconProps> = memo(({ type, playerId, count, refreshVersion, playerColorMap, smallStatusIcons = false }) => {
  const statusColorName = playerColorMap.get(playerId)
  const statusBg = (statusColorName && PLAYER_COLORS[statusColorName]) ? PLAYER_COLORS[statusColorName].bg : 'bg-gray-500'

  const [iconLoadState, setIconLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [currentIconUrl, setCurrentIconUrl] = useState<string | null>(null)

  const iconUrl = useMemo(() => {
    let url = STATUS_ICONS[type]
    if (url) {
      // Apply Cloudinary optimizations for status icons (small, fast loading)
      url = getOptimizedImageUrl(url, { width: 64 })
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}v=${refreshVersion}`
    }
    return url
  }, [type, refreshVersion])

  // Reset loading state when icon URL changes
  useEffect(() => {
    setCurrentIconUrl(iconUrl)
    setIconLoadState('loading')
  }, [iconUrl])

  const handleIconLoad = useCallback(() => {
    setIconLoadState('loaded')
  }, [])

  const handleIconError = useCallback(() => {
    const maxRetries = 2
    const currentAttempts = globalImageLoader.incrementAttempts(currentIconUrl || '')

    if (currentAttempts <= maxRetries) {
      const delay = Math.min(500 * Math.pow(2, currentAttempts - 1), 2000)
      setTimeout(() => {
        if (currentIconUrl) {
          const separator = currentIconUrl.includes('?') ? '&' : '?'
          setCurrentIconUrl(`${currentIconUrl}${separator}retry=${Date.now()}`)
        }
      }, delay)
    } else {
      setIconLoadState('failed')
    }
  }, [currentIconUrl])

  const isSingleInstance = ['Support', 'Threat', 'Revealed', 'LastPlayed'].includes(type)
  const showCount = !isSingleInstance && count > 1

  // When count is shown, icon padding is larger to make the icon smaller.
  const iconPaddingClass = showCount ? 'p-1.5' : 'p-1'

  // Size logic: w-8 (32px) is default. w-6 (24px) is 75%, which is 25% smaller.
  const sizeClass = smallStatusIcons ? 'w-6 h-6' : 'w-8 h-8'
  const fontSizeClass = smallStatusIcons
    ? (showCount ? 'text-xs' : 'text-base')
    : (showCount ? 'text-base' : 'text-lg')

  const countBadgeSize = smallStatusIcons ? 'text-[10px]' : 'text-xs'

  return (
    <div
      className={`relative ${sizeClass} flex items-center justify-center ${statusBg} bg-opacity-80 rounded-sm shadow-md flex-shrink-0`}
      title={`${type} (Player ${playerId}) ${!isSingleInstance && count > 0 ? `x${count}` : ''}`}
    >
      {currentIconUrl && iconLoadState !== 'failed' ? (
        <img
          src={currentIconUrl}
          onLoad={handleIconLoad}
          onError={handleIconError}
          alt={type}
          className={`object-contain w-full h-full transition-all duration-150 ${iconPaddingClass}`}
        />
      ) : (
        <span className={`text-white font-black transition-all duration-150 ${fontSizeClass}`} style={{ textShadow: '0 0 2px black' }}>
          {type.charAt(0)}
        </span>
      )}

      {showCount && (
        <span
          className={`absolute top-0 right-0.5 text-white font-bold ${countBadgeSize} leading-none`}
          style={{ textShadow: '1px 1px 2px black' }}
        >
          {count}
        </span>
      )}
    </div>
  )
})

const CardCore: React.FC<CardCoreProps & CardInteractionProps> = memo(({
  card,
  isFaceUp,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  disableTooltip = false,
  smallStatusIcons = false,
  activePhaseIndex,
  activePlayerId, // Used for ability highlighting and arePropsEqual comparison
  disableActiveHighlights = false,
  extraPowerSpacing = false,
  hidePower = false,
  preserveDeployAbilities: _preserveDeployAbilities = false, // Used in arePropsEqual comparison
  activeAbilitySourceCoords = null,
  boardCoords = null,
  abilityCheckKey,
  onCardClick,
  targetingMode = false,
}) => {
  const { getCardTranslation } = useLanguage()
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const tooltipTimeoutRef = useRef<number | null>(null)

  const [isShining, setIsShining] = useState(false)

  // Progressive image loading: show 50px preview first, then load to full size
  // Display size depends on context, but we use 100px as a good middle ground
  // for cards in hand (70px) and on board (~85-100px)
  const TARGET_SIZE = 100
  const PREVIEW_SIZE = 50

  // Track which URL to display - only update when target is loaded
  const [displayUrl, setDisplayUrl] = useState<string>(() => {
    if (!card.imageUrl) {
      return card.imageUrl || ''
    }
    // For Cloudinary images, start with preview
    const previewUrl = isCloudinaryUrl(card.imageUrl)
      ? getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
      : card.imageUrl
    return addCacheBust(previewUrl, imageRefreshVersion)
  })

  const [imageLoadState, setImageLoadState] = useState<'loading' | 'loaded' | 'failed'>(() => {
    const url = addCacheBust(card.imageUrl || '', imageRefreshVersion)
    if (url && globalImageLoader.isLoaded(url)) {
      return 'loaded'
    }
    if (url && globalImageLoader.hasFailed(url)) {
      return 'failed'
    }
    return 'loading'
  })

  const retryTimeoutRef = useRef<number | null>(null)

  const [highlightDismissed, setHighlightDismissed] = useState(false)
  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card

  useEffect(() => {
    setHighlightDismissed(false)
  }, [activePhaseIndex, abilityCheckKey])

  useEffect(() => {
    if (!disableActiveHighlights) {
      setHighlightDismissed(false)
    }
  }, [disableActiveHighlights])

  // Progressive loading effect
  useEffect(() => {
    if (!card.imageUrl) {
      return
    }

    if (!isCloudinaryUrl(card.imageUrl)) {
      // Non-Cloudinary images - direct load
      const directUrl = addCacheBust(card.imageUrl, imageRefreshVersion)
      setDisplayUrl(directUrl)
      return
    }

    // For Cloudinary images, use progressive loading
    const previewUrl = getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
    const targetUrl = getThumbnailImageUrl(card.imageUrl, TARGET_SIZE)

    const previewWithVersion = addCacheBust(previewUrl, imageRefreshVersion)
    const targetWithVersion = addCacheBust(targetUrl, imageRefreshVersion)

    // Show preview immediately
    setDisplayUrl(previewWithVersion)

    // Load target image in background
    const img = new Image()

    const handleLoad = () => {
      setDisplayUrl(targetWithVersion)
      setImageLoadState('loaded')
      if (targetWithVersion) {
        globalImageLoader.markLoaded(targetWithVersion)
      }
    }

    img.onload = handleLoad
    img.onerror = () => {
      // If target fails, try preview
      console.warn('Failed to load target image:', targetWithVersion)
      // Keep preview visible
      setImageLoadState('loaded')
    }

    img.src = targetWithVersion

    // Check if already cached
    if (img.complete && img.naturalWidth > 0) {
      handleLoad()
    }
  }, [card.imageUrl, card.id, imageRefreshVersion])

  const currentImageSrc = displayUrl

  const handleImageLoad = useCallback(() => {
    setImageLoadState('loaded')
    if (currentImageSrc) {
      globalImageLoader.markLoaded(currentImageSrc)
    }
  }, [currentImageSrc])

  const handleImageError = useCallback(() => {
    const maxRetries = 3
    const currentAttempts = globalImageLoader.incrementAttempts(currentImageSrc)

    if (currentAttempts <= maxRetries) {
      // Retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, currentAttempts - 1), 5000)

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }

      retryTimeoutRef.current = window.setTimeout(() => {
        // Force reload by adding timestamp
        const separator = currentImageSrc.includes('?') ? '&' : '?'
        setDisplayUrl(`${currentImageSrc}${separator}retry=${Date.now()}`)
      }, delay)
    } else {
      // Max retries reached, try fallback
      let fallback = card.fallbackImage
      if (imageRefreshVersion && fallback) {
        fallback = addCacheBust(fallback, imageRefreshVersion)
      }

      if (currentImageSrc !== fallback && fallback) {
        setDisplayUrl(fallback)
        globalImageLoader.reset(fallback)
      } else {
        setImageLoadState('failed')
        globalImageLoader.markFailed(currentImageSrc)
      }
    }
  }, [currentImageSrc, card.fallbackImage, imageRefreshVersion])

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  const isHero = card.types?.includes('Hero')

  useEffect(() => {
    if (!isHero || !isFaceUp) {
      setIsShining(false)
      return
    }

    let shineTimer: number | undefined
    let resetTimer: number | undefined

    const scheduleShine = () => {
      const delay = 3000 + Math.random() * 500

      shineTimer = window.setTimeout(() => {
        setIsShining(true)

        resetTimer = window.setTimeout(() => {
          setIsShining(false)
          scheduleShine()
        }, 750)
      }, delay)
    }

    scheduleShine()

    return () => {
      if (shineTimer !== undefined) {
        window.clearTimeout(shineTimer)
      }
      if (resetTimer !== undefined) {
        window.clearTimeout(resetTimer)
      }
    }
  }, [isHero, isFaceUp])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!disableTooltip) {
      if (e.clientX !== 0 || e.clientY !== 0) {
        setTooltipPos({ x: e.clientX, y: e.clientY })
      }
      if (!tooltipVisible && !tooltipTimeoutRef.current) {
        tooltipTimeoutRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
        }, 250)
      }
    }
  }, [disableTooltip, tooltipVisible])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (disableTooltip) {
      return
    }
    if (e.clientX !== 0 || e.clientY !== 0) {
      setTooltipPos({ x: e.clientX, y: e.clientY })
    }

    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }
    tooltipTimeoutRef.current = window.setTimeout(() => {
      setTooltipVisible(true)
    }, 250)
  }, [disableTooltip])

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  const handleMouseDown = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  // Check if card should show ready ability highlighting based on:
  // 1. Card's owner is the active player
  // 2. Card has a ready status that matches the current phase
  const hasReadyAbility = hasReadyAbilityInCurrentPhase(
    card,
    activePhaseIndex ?? 0,
    activePlayerId
  )

  // For visual display of ready statuses on OTHER players' cards
  // (so everyone can see what abilities are available)
  const hasReadyStatusVisual = hasReadyStatusForPhase(
    card,
    activePhaseIndex ?? 0
  )

  // Check if this card is currently executing an ability
  const isExecutingAbility = boardCoords && activeAbilitySourceCoords &&
    boardCoords.row === activeAbilitySourceCoords.row &&
    boardCoords.col === activeAbilitySourceCoords.col

  // Highlight if:
  // 1. Has a ready ability usable in current phase and by active player
  // OR has ready status for visual display (for other players' cards)
  // 2. NOT currently executing an ability
  // 3. Not dismissed and not disabled
  // 4. NOT in targeting mode (ready abilities hidden during targeting)
  const shouldHighlight = !disableActiveHighlights && !highlightDismissed && (hasReadyAbility || hasReadyStatusVisual) && !isExecutingAbility && !targetingMode

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // Stop propagation to prevent double-triggering from parent GameBoard cell
    // Only stop if we have a handler or highlight, otherwise let parent handle the click (e.g., DeckViewModal)
    if (onCardClick || shouldHighlight) {
      e.stopPropagation()
    }
    // If card has a ready ability and user clicks it, dismiss highlight and trigger ability
    if (shouldHighlight && localPlayerId === card.ownerId) {
      setHighlightDismissed(true)
    }
    // Call the parent's onCardClick handler if provided
    // Note: Hand cards are handled by the parent component's onClick, not here
    if (onCardClick && boardCoords) {
      onCardClick(card, boardCoords)
    }
  }, [shouldHighlight, localPlayerId, card, onCardClick, boardCoords])

  // Aggregate statuses by TYPE and PLAYER ID to allow separate icons for different players.
  // Filter out readiness statuses (readyDeploy, readySetup, readyCommit) - they are always invisible to players
  // DEV NOTE: ready* statuses are internal-only and intentionally hidden from the UI.
  // They control ability availability and are managed by the auto-abilities system.
  const statusGroups = useMemo(() => {
    const hiddenStatusTypes = ['readyDeploy', 'readySetup', 'readyCommit']
    return (card.statuses ?? []).reduce((acc, status) => {
      // Skip readiness statuses - they should not be displayed
      if (hiddenStatusTypes.includes(status.type)) {
        return acc
      }
      const key = `${status.type}_${status.addedByPlayerId}`
      if (!acc[key]) {
        acc[key] = { type: status.type, playerId: status.addedByPlayerId, count: 0 }
      }
      acc[key].count++
      return acc
    }, {} as Record<string, { type: string, playerId: number, count: number }>)
  }, [card.statuses])

  // Memoized values (must be called before any conditional returns)
  const ownerColorData = useMemo(() => {
    const ownerColorName = card.ownerId ? playerColorMap.get(card.ownerId) : null
    return (ownerColorName && PLAYER_COLORS[ownerColorName]) ? PLAYER_COLORS[ownerColorName] : null
  }, [card.ownerId, playerColorMap])

  const uniqueStatusGroups = useMemo(() => {
    return Object.values(statusGroups).sort((a, b) => {
      // Sort by type first, then by playerId to ensure consistent order
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type)
      }
      return a.playerId - b.playerId
    })
  }, [statusGroups])

  const { currentPower, powerTextColor } = useMemo(() => {
    const modifier = (card.powerModifier || 0) + (card.bonusPower || 0)
    const power = Math.max(0, card.power + modifier)
    let textColor = 'text-white'
    if (modifier > 0) {
      textColor = 'text-green-400'
    } else if (modifier < 0) {
      textColor = 'text-red-500'
    }
    return { currentPower: power, powerTextColor: textColor }
  }, [card.power, card.powerModifier, card.bonusPower])

  const showTooltip = useMemo(() =>
    tooltipVisible && isFaceUp && !disableTooltip && (tooltipPos.x > 0 && tooltipPos.y > 0),
  [tooltipVisible, isFaceUp, disableTooltip, tooltipPos.x, tooltipPos.y],
  )

  // Special rendering for 'counter' type cards.
  if (card.deck === 'counter') {
    return (
      <div
        title={displayCard.name}
        className={`w-full h-full ${card.color} shadow-md`}
        style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)' }}
      ></div>
    )
  }

  const powerPositionClass = extraPowerSpacing ? 'bottom-[10px] right-[10px]' : 'bottom-[5px] right-[5px]'

  return (
    <>
      {!isFaceUp ? (
        // --- CARD BACK ---
        (() => {
          const backColorClass = ownerColorData ? ownerColorData.bg : 'bg-card-back'
          const borderColorClass = ownerColorData ? ownerColorData.border : 'border-blue-300'
          const lastPlayedGroup = uniqueStatusGroups.find(g => g.type === 'LastPlayed')

          return (
            <div
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              className={`relative w-full h-full ${backColorClass} rounded-md shadow-md border-2 ${borderColorClass} flex-shrink-0 transition-transform duration-300 ${shouldHighlight ? 'scale-[1.10] z-10' : ''}`}
            >
              {lastPlayedGroup && (
                <div className="absolute bottom-[3px] left-[3px] pointer-events-none">
                  <StatusIcon type={lastPlayedGroup.type} playerId={lastPlayedGroup.playerId} count={lastPlayedGroup.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} />
                </div>
              )}
            </div>
          )
        })()
      ) : (
        // --- CARD FACE ---
        (() => {
          const themeColor = ownerColorData
            ? ownerColorData.border
            : DECK_THEMES[card.deck]?.color || 'border-gray-300'
          const cardBg = card.deck === DeckType.Tokens ? card.color : 'bg-card-face'
          const textColor = card.deck === DeckType.Tokens ? 'text-black' : 'text-black'

          const positiveStatusTypesList = ['Support', 'Shield']
          const positiveGroups = uniqueStatusGroups.filter(g => positiveStatusTypesList.includes(g.type))
          const negativeGroups = uniqueStatusGroups.filter(g => !positiveStatusTypesList.includes(g.type) && g.type !== 'LastPlayed')
          const lastPlayedGroup = uniqueStatusGroups.find(g => g.type === 'LastPlayed')

          const combinedPositiveGroups = lastPlayedGroup
            ? [lastPlayedGroup, ...positiveGroups]
            : positiveGroups

          const ownerGlowClass = ownerColorData ? ownerColorData.glow : 'shadow-[0_0_15px_#ffffff]'
          // Border: 4px normal, 5px when ready (1px thicker)
          const borderClass = shouldHighlight
            ? `border-[5px] shadow-2xl ${ownerGlowClass}`
            : 'border-4'

          // Inner glow effect with owner's color when ready
          // Border color: blend between white and owner color (50/50 mix)
          const ownerColorName = card.ownerId ? playerColorMap.get(card.ownerId) : null
          // Fallback to white/blue glow if color is missing from PLAYER_COLOR_RGB
          const colorRgb = ownerColorName ? (PLAYER_COLOR_RGB[ownerColorName] || { r: 255, g: 255, b: 255 }) : null
          // Glow color 30% brighter than owner color, 50% transparent
          const glowRgb = colorRgb ? {
            r: Math.min(255, Math.round(colorRgb.r * 1.3)),
            g: Math.min(255, Math.round(colorRgb.g * 1.3)),
            b: Math.min(255, Math.round(colorRgb.b * 1.3)),
          } : null
          // Border color: white
          const innerGlowStyle = shouldHighlight && colorRgb ? {
            background: `radial-gradient(circle at center, transparent 20%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
            boxShadow: glowRgb ? `inset 0 0 12px rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.5)` : undefined,
            border: '5px solid',
            borderColor: `rgb(255, 255, 255)`,
          } : {}

          // Semi-transparent colored filter overlay for cards with ready abilities
          // Gradient from center (0% opacity) to edges (50% opacity), 35% brighter than owner color
          const readyAbilityOverlay = shouldHighlight && colorRgb ? (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(circle at center, transparent 37.5%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
                mixBlendMode: 'normal',
                filter: 'brightness(1.35)',
              }}
            />
          ) : null

          return (
            <div
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onClick={handleCardClick}
              style={innerGlowStyle}
              className={`relative w-full h-full ${cardBg} rounded-md shadow-md ${borderClass} ${themeColor} ${textColor} flex-shrink-0 select-none overflow-hidden transition-all duration-300 ${shouldHighlight ? 'scale-[1.10] z-10' : ''}`}
            >
              {currentImageSrc ? (
                <>
                  {imageLoadState === 'failed' ? (
                    // Show fallback visual when image failed to load
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-2">
                      <div className="text-center">
                        <div className="text-xs text-gray-400 mb-1">{card.deck}</div>
                        <span className="text-center text-sm font-bold text-white break-words">
                          {displayCard.name}
                        </span>
                        {card.power > 0 && !hidePower && (
                          <div className="text-lg font-bold text-white mt-1">{card.power}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <img
                      src={currentImageSrc}
                      onLoad={handleImageLoad}
                      onError={handleImageError}
                      alt={displayCard.name}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imageLoadState === 'loading' ? 'opacity-0' : 'opacity-100'}`}
                    />
                  )}
                  {readyAbilityOverlay}
                  {isHero && <div className={`absolute inset-0 hero-foil-overlay ${isShining ? 'animating' : ''}`}></div>}
                </>
              ) : (
                <div className="w-full h-full p-1 flex items-center justify-center">
                  <span className="text-center text-sm font-bold">
                    {displayCard.name}
                  </span>
                </div>
              )}

              {uniqueStatusGroups.length > 0 && (
                <>
                  <div className="absolute top-[3px] left-[3px] right-[3px] flex flex-row-reverse flex-wrap justify-start items-start z-10 pointer-events-none">
                    {negativeGroups.map((group) => (
                      <StatusIcon key={`${group.type}_${group.playerId}`} type={group.type} playerId={group.playerId} count={group.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} />
                    ))}
                  </div>

                  <div className="absolute bottom-[3px] left-[3px] right-[30px] flex flex-wrap-reverse content-start items-end z-10 pointer-events-none">
                    {combinedPositiveGroups.map((group) => (
                      <StatusIcon key={`${group.type}_${group.playerId}`} type={group.type} playerId={group.playerId} count={group.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} />
                    ))}
                  </div>
                </>
              )}

              {card.power > 0 && !hidePower && (
                <div
                  className={`absolute ${powerPositionClass} w-8 h-8 rounded-full ${ownerColorData ? ownerColorData.bg : 'bg-gray-600'} border-[3px] border-white flex items-center justify-center z-20 shadow-md`}
                >
                  <span className={`${powerTextColor} font-bold text-lg leading-none`} style={{ textShadow: '0 0 2px black' }}>{currentPower}</span>
                </div>
              )}
            </div>
          )
        })()
      )}

      {showTooltip && (
        <Tooltip x={tooltipPos.x} y={tooltipPos.y}>
          <CardTooltipContent card={displayCard} />
        </Tooltip>
      )}
    </>
  )
})

// Custom comparison function to prevent unnecessary rerenders
const arePropsEqual = (prevProps: CardCoreProps & CardInteractionProps, nextProps: CardCoreProps & CardInteractionProps) => {
  // Core props that affect rendering
  if (prevProps.card.id !== nextProps.card.id) {
    return false
  }
  if (prevProps.isFaceUp !== nextProps.isFaceUp) {
    return false
  }

  // Card properties that affect rendering
  if (prevProps.card.imageUrl !== nextProps.card.imageUrl) {
    return false
  }
  if (prevProps.card.fallbackImage !== nextProps.card.fallbackImage) {
    return false
  }
  if (prevProps.card.name !== nextProps.card.name) {
    return false
  }
  if (prevProps.card.deck !== nextProps.card.deck) {
    return false
  }
  if (prevProps.card.color !== nextProps.card.color) {
    return false
  }
  if (prevProps.card.baseId !== nextProps.card.baseId) {
    return false
  }

  // Check types array (shallow comparison)
  const prevTypes = prevProps.card.types || []
  const nextTypes = nextProps.card.types || []
  if (prevTypes.length !== nextTypes.length) {
    return false
  }
  for (let i = 0; i < prevTypes.length; i++) {
    if (prevTypes[i] !== nextTypes[i]) {
      return false
    }
  }
  if (prevProps.imageRefreshVersion !== nextProps.imageRefreshVersion) {
    return false
  }
  if (prevProps.smallStatusIcons !== nextProps.smallStatusIcons) {
    return false
  }
  if (prevProps.extraPowerSpacing !== nextProps.extraPowerSpacing) {
    return false
  }
  if (prevProps.hidePower !== nextProps.hidePower) {
    return false
  }

  // Interaction props - only check if they actually affect the visual state
  if (prevProps.disableTooltip !== nextProps.disableTooltip) {
    return false
  }
  if (prevProps.disableActiveHighlights !== nextProps.disableActiveHighlights) {
    return false
  }
  if (prevProps.preserveDeployAbilities !== nextProps.preserveDeployAbilities) {
    return false
  }

  // Context props that affect ability activation and highlighting
  if (prevProps.activePhaseIndex !== nextProps.activePhaseIndex) {
    return false
  }
  if (prevProps.activePlayerId !== nextProps.activePlayerId) {
    return false
  }
  if (prevProps.localPlayerId !== nextProps.localPlayerId) {
    return false
  }
  if (prevProps.activeAbilitySourceCoords?.row !== nextProps.activeAbilitySourceCoords?.row ||
      prevProps.activeAbilitySourceCoords?.col !== nextProps.activeAbilitySourceCoords?.col) {
    return false
  }
  if (prevProps.boardCoords?.row !== nextProps.boardCoords?.row ||
      prevProps.boardCoords?.col !== nextProps.boardCoords?.col) {
    return false
  }
  // Check abilityCheckKey for rechecking ability readiness
  if (prevProps.abilityCheckKey !== nextProps.abilityCheckKey) {
    return false
  }
  // Check targetingMode - affects ready status visibility and highlighting
  if (prevProps.targetingMode !== nextProps.targetingMode) {
    return false
  }

  // Performance critical: deep comparison only for status and power changes
  const prevStatuses = prevProps.card.statuses || []
  const nextStatuses = nextProps.card.statuses || []
  if (prevStatuses.length !== nextStatuses.length) {
    return false
  }

  // Check if any status changed
  for (let i = 0; i < prevStatuses.length; i++) {
    const prev = prevStatuses[i]
    const next = nextStatuses[i]
    if (!next || prev.type !== next.type || prev.addedByPlayerId !== next.addedByPlayerId) {
      return false
    }
  }

  // Check power-related changes
  if (prevProps.card.power !== nextProps.card.power) {
    return false
  }
  if (prevProps.card.powerModifier !== nextProps.card.powerModifier) {
    return false
  }
  if (prevProps.card.bonusPower !== nextProps.card.bonusPower) {
    return false
  }

  // Check ownerId changes (including to/from undefined)
  if (prevProps.card.ownerId !== nextProps.card.ownerId) {
    return false
  }

  // Check player color map changes if both have owners
  if (prevProps.card.ownerId && nextProps.card.ownerId && prevProps.playerColorMap.get(prevProps.card.ownerId) !== nextProps.playerColorMap.get(nextProps.card.ownerId)) {
    return false
  }

  return true
}

const Card = memo(CardCore, arePropsEqual)

export { Card }
