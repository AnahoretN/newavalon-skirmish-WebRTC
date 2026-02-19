/**
 * @file ClickWave component
 * Displays a colored ripple animation when a player clicks on a card or cell
 * 3 waves expanding outward, colored by the clicking player's color
 * Replaces the old TargetSelectionEffect component
 */

import React, { useEffect, useState } from 'react'
import { PLAYER_COLOR_RGB } from '@/constants'
import type { PlayerColor } from '@/types'

interface ClickWaveProps {
  timestamp: number
  playerColor: PlayerColor
  onComplete?: () => void
}

interface Wave {
  id: number
  startTime: number
}

export const ClickWave: React.FC<ClickWaveProps> = ({ timestamp, playerColor, onComplete }) => {
  const [elapsed, setElapsed] = useState(0)

  console.log('[ClickWave] Rendering:', { timestamp, playerColor, elapsed })

  const colorRgb = PLAYER_COLOR_RGB[playerColor] || { r: 255, g: 255, b: 255 }

  useEffect(() => {
    const startTime = Date.now()
    const totalDuration = 600

    const animate = () => {
      const currentTime = Date.now()
      const newElapsed = currentTime - startTime
      setElapsed(newElapsed)

      if (newElapsed < totalDuration) {
        requestAnimationFrame(animate)
      } else if (onComplete) {
        onComplete()
      }
    }

    requestAnimationFrame(animate)
  }, [timestamp, onComplete])

  const waves: Wave[] = [
    { id: 1, startTime: 0 },
    { id: 2, startTime: 150 },
    { id: 3, startTime: 300 },
  ]

  const getWaveStyle = (wave: Wave) => {
    const waveElapsed = elapsed - wave.startTime
    if (waveElapsed < 0) return null

    const duration = 300
    const progress = Math.min(waveElapsed / duration, 1)
    const scale = 1.0 + (progress * 0.2)
    const opacity = 0.8 - (progress * 0.8)
    const borderWidth = Math.max(0.5, 3 - (progress * 2))

    return { opacity, scale, borderWidth }
  }

  const borderColor = `rgb(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b})`
  const borderColorAlpha = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}`

  return (
    <div
      className="click-wave"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {waves.map((wave) => {
        const style = getWaveStyle(wave)
        if (!style) return null

        return (
          <div
            key={wave.id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '8px',
              border: `${style.borderWidth}px solid ${borderColorAlpha}, ${style.opacity})`,
              transform: `scale(${style.scale})`,
              transformOrigin: 'center',
              opacity: style.opacity,
              boxShadow: `0 0 ${8 * style.opacity}px ${borderColorAlpha}, ${style.opacity * 0.3})`,
            }}
          />
        )
      })}
    </div>
  )
}
