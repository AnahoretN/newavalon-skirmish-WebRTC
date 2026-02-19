/**
 * useClickWave - Custom hook for handling click wave effects
 *
 * Wraps onClick handlers to trigger click wave animation
 * Prevents waves from being sent during drag operations
 */

import { useCallback, useRef } from 'react'

export interface UseClickWaveProps {
  triggerClickWave: (location: 'board' | 'hand' | 'emptyCell', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void
  onClick?: (e: React.MouseEvent) => void
  location: 'board' | 'hand' | 'emptyCell'
  boardCoords?: { row: number; col: number }
  handTarget?: { playerId: number, cardIndex: number }
  isDragging?: boolean
}

export function useClickWave(props: UseClickWaveProps) {
  const {
    triggerClickWave,
    onClick,
    location,
    boardCoords,
    handTarget,
    isDragging = false,
  } = props

  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null)
  const hasMovedRef = useRef(false)

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't trigger wave if we were dragging
    if (isDragging || hasMovedRef.current) {
      hasMovedRef.current = false
      mouseDownPosRef.current = null
      return
    }

    // Trigger the click wave
    triggerClickWave(location, boardCoords, handTarget)

    // Call original onClick if provided
    if (onClick) {
      onClick(e)
    }

    hasMovedRef.current = false
    mouseDownPosRef.current = null
  }, [triggerClickWave, onClick, location, boardCoords, handTarget, isDragging])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Store initial mouse position
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
    hasMovedRef.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Check if mouse moved significantly (drag threshold)
    if (mouseDownPosRef.current) {
      const dx = e.clientX - mouseDownPosRef.current.x
      const dy = e.clientY - mouseDownPosRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > 5) {
        hasMovedRef.current = true
      }
    }
  }, [])

  return {
    onClick: handleClick,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
  }
}
