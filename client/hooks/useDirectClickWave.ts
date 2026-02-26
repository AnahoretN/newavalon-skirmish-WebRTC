/**
 * useDirectClickWave - Direct DOM manipulation for instant click wave effect
 * Bypasses React state updates for maximum speed
 */

import { useEffect } from 'react'
import type { PlayerColor } from '../types'
import { PLAYER_COLOR_RGB } from '../constants'

export interface ClickWaveData {
  timestamp: number
  location: 'board' | 'hand' | 'deck'
  boardCoords?: { row: number; col: number }
  handTarget?: { playerId: number; cardIndex: number }
  clickedByPlayerId: number
  playerColor: PlayerColor
}

// Global overlay container
let overlayContainer: HTMLDivElement | null = null
const activeWaves = new Map<number, HTMLDivElement[]>()

// Initialize the overlay container IMMEDIATELY when module loads
// This ensures the overlay is ready before any user interaction
if (typeof document !== 'undefined' && document.body) {
  overlayContainer = document.createElement('div')
  overlayContainer.id = 'click-wave-overlay'
  overlayContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
  `
  document.body.appendChild(overlayContainer)
}

// Add CSS keyframes for wave animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
    @keyframes click-wave-expand {
      0% {
        transform: scale(0.98);
        opacity: 1;
      }
      50% {
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
      50% {
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
    .click-wave-ring {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: 8px;
      pointer-events: none;
    }
    .click-wave-fill {
      background: radial-gradient(circle, transparent 0%, var(--wave-color) 100%);
    }
    .click-wave-border {
      border: 4px solid var(--wave-border-color);
    }
  `
  document.head?.appendChild(style)
}

// Initialize function (now just checks if overlay exists)
export function initClickWaveOverlay() {
  if (!overlayContainer && typeof document !== 'undefined' && document.body) {
    overlayContainer = document.createElement('div')
    overlayContainer.id = 'click-wave-overlay'
    overlayContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    `
    document.body.appendChild(overlayContainer)
  }
}

// Find the target element for the wave
function findTargetElement(wave: ClickWaveData): HTMLElement | null {
  if (wave.location === 'board' && wave.boardCoords) {
    // Find cell by data attributes
    return document.querySelector(`[data-row="${wave.boardCoords.row}"][data-col="${wave.boardCoords.col}"]`)
  } else if (wave.location === 'hand' && wave.handTarget) {
    // Find hand card
    return document.querySelector(`[data-hand-card="${wave.handTarget.playerId}-${wave.handTarget.cardIndex}"]`)
  } else if (wave.location === 'deck') {
    // Find deck element
    return document.querySelector('[data-deck]')
  }
  return null
}

// Create wave element using CSS animations (simpler and faster)
function createWaveElement(wave: ClickWaveData, targetElement: HTMLElement): HTMLDivElement {
  const container = document.createElement('div')
  const colorRgb = PLAYER_COLOR_RGB[wave.playerColor] || { r: 255, g: 255, b: 255 }

  // Get target position
  const rect = targetElement.getBoundingClientRect()

  container.style.cssText = `
    position: absolute;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 10000;
  `

  // Set CSS variables for this wave
  const waveColor = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5)`
  const waveBorderColor = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 1)`

  // Create 3 waves with 175ms delays (3 waves over 525ms total: 0 + 175 + 350 + 175 = 525)
  const delays = [0, 175, 350]

  delays.forEach((delay) => {
    // Fill element (gradient background)
    const fillEl = document.createElement('div')
    fillEl.className = 'click-wave-ring click-wave-fill'
    fillEl.style.cssText = `
      --wave-color: ${waveColor};
      animation: click-wave-expand 175ms ease-out ${delay}ms forwards;
    `
    container.appendChild(fillEl)

    // Border element
    const borderEl = document.createElement('div')
    borderEl.className = 'click-wave-ring click-wave-border'
    borderEl.style.cssText = `
      --wave-border-color: ${waveBorderColor};
      animation: click-wave-expand-border 175ms ease-out ${delay}ms forwards;
    `
    container.appendChild(borderEl)
  })

  return container
}

// Trigger click wave (direct DOM, no React state update)
export function triggerDirectClickWave(wave: ClickWaveData) {
  if (!overlayContainer) {
    initClickWaveOverlay()
  }

  const targetElement = findTargetElement(wave)
  if (!targetElement) {
    console.warn('[DirectClickWave] Target element not found:', wave)
    return
  }

  const container = createWaveElement(wave, targetElement)
  overlayContainer!.appendChild(container)

  // Track waves for this timestamp
  const timestamp = wave.timestamp
  if (!activeWaves.has(timestamp)) {
    activeWaves.set(timestamp, [])
  }
  activeWaves.get(timestamp)!.push(container)

  // Auto-remove after 700ms (3 waves: last starts at 350ms + 175ms animation + buffer)
  setTimeout(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
    const waves = activeWaves.get(timestamp)
    if (waves) {
      const idx = waves.indexOf(container)
      if (idx > -1) {
        waves.splice(idx, 1)
      }
      if (waves.length === 0) {
        activeWaves.delete(timestamp)
      }
    }
  }, 850)
}

// Cleanup (optional, for testing)
export function cleanupClickWaveOverlay() {
  if (overlayContainer && overlayContainer.parentNode) {
    overlayContainer.parentNode.removeChild(overlayContainer)
    overlayContainer = null
  }
  activeWaves.clear()
}
