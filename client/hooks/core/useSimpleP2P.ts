/**
 * useSimpleP2P
 *
 * Упрощённый хук для P2P игры.
 * Заменяет всю сложную систему WebRTC.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { PersonalizedState, SimpleHostConfig, SimpleGuestConfig } from '../../p2p/SimpleP2PTypes'
import { SimpleHost, SimpleGuest } from '../../p2p'
import type { GameState } from '../../types'
import { createInitialState } from './gameCreators'
import { logger } from '../../utils/logger'

export function useSimpleP2P() {
  // Состояние игры
  const [gameState, setGameState] = useState<PersonalizedState>(() => ({
    ...createInitialState(),
    players: (createInitialState().players || []).map(p => ({
      ...p,
      hand: p.hand || [],
      deck: p.deck || [],
      discard: p.discard || [],
      boardHistory: p.boardHistory || []
    }))
  }))

  // Локальный ID игрока
  const [localPlayerId, setLocalPlayerId] = useState<number>(1)

  // P2P менеджеры
  const hostRef = useRef<SimpleHost | null>(null)
  const guestRef = useRef<SimpleGuest | null>(null)
  const isHostRef = useRef<boolean>(false)
  const connectionStatusRef = useRef<'Connecting' | 'Connected' | 'Disconnected'>('Disconnected')

  // Инициализация хоста
  const initializeHost = useCallback(async () => {
    try {
      logger.info('[useSimpleP2P] Initializing host...')

      const hostConfig: SimpleHostConfig = {
        onStateUpdate: (state) => {
          setGameState(state)
        },
        onPlayerJoin: (playerId) => {
          logger.info('[useSimpleP2P] Player joined:', playerId)
        },
        onPlayerLeave: (playerId) => {
          logger.info('[useSimpleP2P] Player left:', playerId)
        }
      }

      const host = new SimpleHost(createInitialState(), hostConfig)
      await host.initialize()

      hostRef.current = host
      isHostRef.current = true
      connectionStatusRef.current = 'Connected'

      logger.info('[useSimpleP2P] Host initialized:', host.getPeerId())

      return host.getPeerId()
    } catch (e) {
      logger.error('[useSimpleP2P] Failed to initialize host:', e)
      connectionStatusRef.current = 'Disconnected'
      throw e
    }
  }, [])

  // Подключение как гость
  const connectAsGuest = useCallback(async (hostPeerId: string) => {
    try {
      logger.info('[useSimpleP2P] Connecting as guest to:', hostPeerId)

      const guestConfig: SimpleGuestConfig = {
        localPlayerId: 0,  // будет установлен сервером
        onStateUpdate: (state) => {
          setGameState(state)
        },
        onConnected: () => {
          connectionStatusRef.current = 'Connected'
          logger.info('[useSimpleP2P] Connected as guest')
        },
        onDisconnected: () => {
          connectionStatusRef.current = 'Disconnected'
          logger.warn('[useSimpleP2P] Disconnected from host')
        },
        onError: (error) => {
          logger.error('[useSimpleP2P] Guest error:', error)
        }
      }

      const guest = new SimpleGuest(guestConfig)
      await guest.connect(hostPeerId)

      guestRef.current = guest
      isHostRef.current = false
      setLocalPlayerId(guest.getLocalPlayerId())

      return guest.getLocalPlayerId()
    } catch (e) {
      logger.error('[useSimpleP2P] Failed to connect as guest:', e)
      connectionStatusRef.current = 'Disconnected'
      throw e
    }
  }, [])

  // Отправить действие
  const sendAction = useCallback((action: string, data?: any) => {
    if (isHostRef.current && hostRef.current) {
      // Хост выполняет действие локально
      hostRef.current.hostAction(action, data)
    } else if (guestRef.current) {
      // Гость отправляет хосту
      guestRef.current.sendAction(action, data)
    } else {
      logger.warn('[useSimpleP2P] No connection, cannot send action:', action)
    }
  }, [])

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      hostRef.current?.destroy()
      guestRef.current?.destroy()
    }
  }, [])

  return {
    // Состояние
    gameState,
    localPlayerId,
    isHost: () => isHostRef.current,
    connectionStatus: () => connectionStatusRef.current,

    // Методы
    initializeHost,
    connectAsGuest,
    sendAction,

    // Ссылки на менеджеры
    host: hostRef.current,
    guest: guestRef.current
  }
}

export default useSimpleP2P
