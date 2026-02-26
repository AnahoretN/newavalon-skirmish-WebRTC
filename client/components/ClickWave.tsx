/**
 * @file ClickWave component
 * Displays a colored ripple animation when a player clicks on a card or cell
 * 3 waves expanding outward, colored by the clicking player's color
 * Optimized for instant display using CSS animations
 */

import React from 'react'
import { PLAYER_COLOR_RGB } from '@/constants'
import type { PlayerColor } from '@/types'

interface ClickWaveProps {
  timestamp: number
  playerColor: PlayerColor
  onComplete?: () => void
}

export const ClickWave: React.FC<ClickWaveProps> = ({ timestamp, playerColor, onComplete }) => {
  const colorRgb = PLAYER_COLOR_RGB[playerColor] || { r: 255, g: 255, b: 255 }
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
      {/* Wave 1 - starts immediately */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          background: `radial-gradient(circle, transparent 0%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
          transform: 'scale(0.98)',
          transformOrigin: 'center',
          opacity: '1',
          animation: 'click-wave-expand 330ms ease-out forwards',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          transformOrigin: 'center',
          opacity: '1',
          animation: 'click-wave-expand-border 330ms ease-out forwards',
        }}
      />

      {/* Wave 2 - starts after 100ms */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          background: `radial-gradient(circle, transparent 0%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
          transform: 'scale(0.98)',
          transformOrigin: 'center',
          opacity: '0',
          animation: 'click-wave-expand 330ms ease-out 100ms forwards',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          transformOrigin: 'center',
          opacity: '0',
          animation: 'click-wave-expand-border 330ms ease-out 100ms forwards',
        }}
      />

      {/* Wave 3 - starts after 200ms */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          background: `radial-gradient(circle, transparent 0%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
          transform: 'scale(0.98)',
          transformOrigin: 'center',
          opacity: '0',
          animation: 'click-wave-expand 330ms ease-out 200ms forwards',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '8px',
          border: `4px solid ${borderColorAlpha}, 1)`,
          transformOrigin: 'center',
          opacity: '0',
          animation: 'click-wave-expand-border 330ms ease-out 200ms forwards',
        }}
      />

      {/* Inline keyframes for instant animation */}
      <style>{`
        @keyframes click-wave-expand {
          0% {
            transform: scale(0.98);
            opacity: 1;
          }
          40% {
            transform: scale(1.1);
            opacity: 1;
          }
          100% {
            transform: scale(1.25);
            opacity: 0;
          }
        }
        @keyframes click-wave-expand-border {
          0% {
            transform: scale(1.0);
            opacity: 1;
            border-width: 4px;
          }
          40% {
            transform: scale(1.1);
            opacity: 1;
            border-width: 4px;
          }
          100% {
            transform: scale(1.25);
            opacity: 0;
            border-width: 2px;
          }
        }
      `}</style>
    </div>
  )
}
