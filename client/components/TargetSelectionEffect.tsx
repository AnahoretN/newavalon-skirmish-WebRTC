/**
 * @file TargetSelectionEffect component
 * Displays a white ripple animation when a player selects a target during targeting mode
 * 3 waves with single border line, each starting at card size (1.0) and expanding to 1.15x over 0.5 seconds
 */

import React, { useEffect, useState } from 'react'
import type { TargetSelectionEffect as TargetSelectionEffectType } from '@/types'

interface TargetSelectionEffectProps {
  effect: TargetSelectionEffectType
  onComplete?: () => void
}

interface Wave {
  id: number
  startTime: number // When this wave starts (0, 250, or 500ms)
}

export const TargetSelectionEffect: React.FC<TargetSelectionEffectProps> = ({ effect, onComplete }) => {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const startTime = Date.now()
    const totalDuration = 1000 // 3 waves, last one ends at 1000ms (start 500 + duration 500)

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
  }, [effect.timestamp, onComplete])

  // Wave configuration: 3 waves, each lasting 500ms, staggered start times
  // Wave 1: starts at 0ms, ends at 500ms
  // Wave 2: starts at 250ms (when wave 1 is at 50%), ends at 750ms
  // Wave 3: starts at 500ms (when wave 1 ends), ends at 1000ms
  const waves: Wave[] = [
    { id: 1, startTime: 0 },
    { id: 2, startTime: 250 },
    { id: 3, startTime: 500 },
  ]

  // Calculate animation values for a single wave
  const getWaveStyle = (wave: Wave) => {
    const waveElapsed = elapsed - wave.startTime

    // Wave hasn't started yet
    if (waveElapsed < 0) {
      return null
    }

    // Wave duration is 500ms
    const duration = 500
    const progress = Math.min(waveElapsed / duration, 1)

    // Scale goes from 1.0 (card size) to 1.15 (115% of card)
    const scale = 1.0 + (progress * 0.15)

    // Opacity fades from 1 to 0
    const opacity = 1 - progress

    // Border width stays constant (single line)
    const borderWidth = 2

    return {
      opacity,
      scale,
      borderWidth,
    }
  }

  return (
    <div
      className="target-selection-effect"
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
        if (!style) {return null}

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
              border: `${style.borderWidth}px solid rgba(255, 255, 255, ${style.opacity})`,
              transform: `scale(${style.scale})`,
              transformOrigin: 'center',
              opacity: style.opacity,
            }}
          />
        )
      })}
    </div>
  )
}
