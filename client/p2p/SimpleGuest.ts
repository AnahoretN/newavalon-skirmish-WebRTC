/**
 * SimpleGuest
 *
 * Упрощённый гость для P2P игры.
 * Отправляет действия хосту, получает состояние.
 */

import { loadPeerJS } from './PeerJSLoader'
import type { PersonalizedState, SimpleGuestConfig, P2PMessage } from './SimpleP2PTypes'
import { logger } from '../utils/logger'

/**
 * SimpleGuest - упрощённый гость
 */
export class SimpleGuest {
  private peer: any = null  // Peer instance
  private hostConnection: any = null  // DataConnection to host
  private hostPeerId: string | null = null
  private localPlayerId: number

  // Состояние
  private state: PersonalizedState | null = null
  private lastVersion: number = 0

  // Конфигурация
  private config: SimpleGuestConfig

  // Callbacks для Promise из connect()
  private resolveJoin: (() => void) | null = null
  private rejectJoin: ((err: any) => void) | null = null

  constructor(config: SimpleGuestConfig) {
    this.config = config
    this.localPlayerId = config.localPlayerId
  }

  /**
   * Подключиться к хосту
   */
  async connect(hostPeerId: string): Promise<void> {
    this.hostPeerId = hostPeerId

    const { Peer } = await loadPeerJS()

    return new Promise((resolve, reject) => {
      let joinResolved = false

      this.resolveJoin = () => {
        if (!joinResolved) {
          joinResolved = true
          logger.info('[SimpleGuest] Join completed successfully')
          resolve()
        }
      }

      this.rejectJoin = (err: any) => {
        if (!joinResolved) {
          joinResolved = true
          reject(err)
        }
      }

      try {
        this.peer = new Peer()

        this.peer.on('open', (peerId) => {
          logger.info('[SimpleGuest] Peer opened with ID:', peerId)

          // Подключаемся к хосту
          this.connectToHost(hostPeerId)
        })

        this.peer.on('connection', (conn) => {
          logger.info('[SimpleGuest] Incoming connection from:', conn.peer)
          // Используем первое входящее соединение как хоста
          if (!this.hostConnection) {
            this.hostConnection = conn
            this.setupHostConnection(conn)
          }
        })

        this.peer.on('error', (err) => {
          logger.error('[SimpleGuest] Peer error:', err)
          this.rejectJoin?.(err)
        })

        // Таймаут на подключение
        setTimeout(() => {
          if (!joinResolved) {
            this.rejectJoin?.(new Error('Connection timeout'))
          }
        }, 15000) // 15 секунд

      } catch (e) {
        this.rejectJoin?.(e)
      }
    })
  }

  /**
   * Подключиться к хосту (инициатива от гостя)
   */
  private connectToHost(hostPeerId: string): void {
    if (!this.peer) return

    logger.info('[SimpleGuest] Connecting to host:', hostPeerId)

    const conn = this.peer.connect(hostPeerId, {
      reliable: true
    })

    this.hostConnection = conn
    this.setupHostConnection(conn)
  }

  /**
   * Настроить соединение с хостом
   */
  private setupHostConnection(conn: any): void {
    conn.on('open', () => {
      logger.info('[SimpleGuest] Connected to host')

      // Отправляем запрос на присоединение
      conn.send({
        type: 'JOIN_REQUEST',
        playerName: localStorage.getItem('player_name') || `Player ${this.localPlayerId}`,
        playerToken: localStorage.getItem('player_token')
      })

      this.config.onConnected?.()
    })

    conn.on('data', (data: any) => {
      this.handleMessage(data)
    })

    conn.on('close', () => {
      logger.warn('[SimpleGuest] Host connection closed')
      this.config.onDisconnected?.()
    })

    conn.on('error', (err: any) => {
      logger.error('[SimpleGuest] Connection error:', err)
      this.config.onError?.(err?.message || 'Connection error')
      this.rejectJoin?.(err)
    })
  }

  /**
   * Обработка входящего сообщения от хоста
   */
  private handleMessage(data: P2PMessage): void {
    if (data.type === 'STATE') {
      this.handleState(data)
    } else if (data.type === 'JOIN_ACCEPT') {
      this.handleJoinAccept(data)
    } else {
      logger.warn('[SimpleGuest] Unknown message type:', data.type)
    }
  }

  /**
   * Обработка сообщения о состоянии
   */
  private handleState(data: any): void {
    // Версионный контроль - применяем только новые состояния
    if (data.version <= this.lastVersion) {
      logger.debug('[SimpleGuest] Ignoring old state:', data.version, '<=', this.lastVersion)
      return
    }

    this.lastVersion = data.version
    this.state = data.state
    this.localPlayerId = this.findLocalPlayerId()

    // Логируем все announcedCard для отладки
    const announcedCards = this.state.players
      .filter((p: any) => p.announcedCard)
      .map((p: any) => `Player${p.id}:${p.announcedCard.name}`)
      .join(', ')
    if (announcedCards) {
      logger.info('[SimpleGuest] Received state version:', data.version, 'with announcedCards: [', announcedCards, ']')
    }

    logger.info('[SimpleGuest] State updated, version:', data.version,
      'phase:', this.state.currentPhase,
      'activePlayer:', this.state.activePlayerId)

    // Уведомляем
    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.state)
    }

    // Резолвим Promise при первом получении состояния с gameId
    if (this.resolveJoin && this.state.gameId) {
      this.resolveJoin()
      this.resolveJoin = null
      this.rejectJoin = null
    }
  }

  /**
   * Обработка подтверждения присоединения
   */
  private handleJoinAccept(data: any): void {
    this.localPlayerId = data.playerId
    this.state = data.state
    this.lastVersion = data.version

    // Сохраняем токен для переподключения
    if (data.state?.players) {
      const player = data.state.players.find((p: any) => p.id === this.localPlayerId)
      if (player?.playerToken) {
        localStorage.setItem('player_token', player.playerToken)
      }
    }

    logger.info('[SimpleGuest] Joined as player:', this.localPlayerId, 'gameId:', this.state?.gameId)

    if (this.config.onStateUpdate) {
      this.config.onStateUpdate(this.state)
    }

    // Резолвим Promise - теперь мы полностью подключились
    if (this.resolveJoin) {
      this.resolveJoin()
      this.resolveJoin = null
      this.rejectJoin = null
    }
  }

  /**
   * Найти локальный playerId в состоянии
   */
  private findLocalPlayerId(): number {
    if (!this.state) return this.localPlayerId

    // Пытаемся найти по токену
    const token = localStorage.getItem('player_token')
    if (token) {
      const player = this.state.players.find((p: any) => p.playerToken === token)
      if (player) return player.id
    }

    return this.localPlayerId
  }

  /**
   * Отправить действие хосту
   */
  sendAction(action: string, data?: any): void {
    if (!this.hostConnection) {
      logger.warn('[SimpleGuest] No host connection')
      return
    }

    const message = {
      type: 'ACTION',
      playerId: this.localPlayerId,
      action,
      data,
      timestamp: Date.now()
    }

    logger.info('[SimpleGuest] Sending action:', action)

    try {
      this.hostConnection.send(message)
    } catch (e) {
      logger.error('[SimpleGuest] Failed to send action:', e)
    }
  }

  /**
   * Переподключиться
   */
  async reconnect(newHostPeerId?: string): Promise<void> {
    const hostId = newHostPeerId || this.hostPeerId

    if (!hostId) {
      throw new Error('No host peer ID')
    }

    logger.info('[SimpleGuest] Reconnecting to:', hostId)

    // Закрываем старое соединение
    if (this.hostConnection) {
      this.hostConnection.close()
    }

    // Если даём новый peerId, создаём новый Peer
    if (newHostPeerId && this.peer) {
      this.peer.destroy()
      this.peer = null
    }

    await this.connect(hostId)

    // Отправляем запрос на переподключение
    if (this.hostConnection) {
      this.hostConnection.send({
        type: 'RECONNECT',
        playerId: this.localPlayerId,
        playerToken: localStorage.getItem('player_token')
      })
    }
  }

  /**
   * Получить текущее состояние
   */
  getState(): PersonalizedState | null {
    return this.state
  }

  /**
   * Получить локальный ID игрока
   */
  getLocalPlayerId(): number {
    return this.localPlayerId
  }

  /**
   * Завершить работу
   */
  destroy(): void {
    if (this.hostConnection) {
      this.hostConnection.close()
    }

    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }
}

export default SimpleGuest
