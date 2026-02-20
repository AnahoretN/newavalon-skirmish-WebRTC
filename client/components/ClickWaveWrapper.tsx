/**
 * @file ClickWaveWrapper component
 * Wraps children to display click wave effect and handle click wave triggering
 */

import React from 'react'
import { ClickWave } from './ClickWave'
import type { PlayerColor } from '@/types'
import type { ClickWave as ClickWaveType } from '@/types'

interface ClickWaveWrapperProps {
  children: React.ReactNode
  clickWaves?: ClickWaveType[]
  playerId: number
  location: 'board' | 'hand' | 'emptyCell'
  boardCoords?: { row: number; col: number }
  handTarget?: { playerId: number; cardIndex: number }
  playerColor: PlayerColor
  onClick?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
  onMouseMove?: (e: React.MouseEvent) => void
  triggerClickWave?: (location: 'board' | 'hand' | 'emptyCell', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void
}

export const ClickWaveWrapper: React.FC<ClickWaveWrapperProps> = ({
  children,
  clickWaves = [],
  playerId,
  location,
  boardCoords,
  handTarget,
  playerColor,
  onClick,
  onMouseDown,
  onMouseMove,
  triggerClickWave,
}) => {
  // Find active click wave for this specific location
  const activeWave = clickWaves.find(w => {
    if (w.clickedByPlayerId !== playerId) {
      return false
    }
    if (w.location !== location) {
      return false
    }
    if (location === 'board' && boardCoords) {
      return w.boardCoords?.row === boardCoords.row && w.boardCoords?.col === boardCoords.col
    }
    if (location === 'hand' && handTarget) {
      return w.handTarget?.playerId === handTarget.playerId && w.handTarget?.cardIndex === handTarget.cardIndex
    }
    if (location === 'emptyCell' && boardCoords) {
      return w.boardCoords?.row === boardCoords.row && w.boardCoords?.col === boardCoords.col
    }
    return false
  })

  const handleClick = (e: React.MouseEvent) => {
    // Trigger click wave
    if (triggerClickWave && !activeWave) {
      triggerClickWave(location, boardCoords, handTarget)
    }
    onClick?.(e)
  }

  return (
    <div
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      style={{ position: 'relative' }}
    >
      {children}
      {activeWave && <ClickWave timestamp={activeWave.timestamp} playerColor={playerColor} />}
    </div>
  )
}
