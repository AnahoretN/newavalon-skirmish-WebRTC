/**
 * SimpleHost
 *
 * Упрощённый хост для P2P игры.
 * Один источник правды, два типа сообщений.
 */

import { loadPeerJS } from './PeerJSLoader'
import type { GameState } from '../types'
import type {
  ActionMessage,
  StateMessage,
  PersonalizedState,
  SimpleHostConfig,
  PersonalizedPlayer
} from './SimpleP2PTypes'
import { applyAction } from './SimpleGameLogic'
import { logger } from '../utils/logger'
import { createDeck } from '../hooks/core/gameCreators'
import { getDecksData } from '../content'
import type { DeckType } from '../types'

/**
 * SimpleHost - упрощённый хост
 */
export class SimpleHost {
  private peer: any = null  // Peer instance
  private connections: Map<string, any> = new Map()  // peerId -> DataConnection
  private playerIdCounter: number = 2  // Начинаем с 2, так как хост уже игрок 1
  private peerIdToPlayerId: Map<string, number> = new Map()

  // Состояние игры
  private state: GameState
  private version: number = 0

  // Конфигурация
  private config: SimpleHostConfig

  constructor(initialState: GameState, config: SimpleHostConfig = {}) {
    this.state = initialState
    this.config = config
  }

  /**
   * Сгенерировать уникальный токен для игрока
   */
  private generatePlayerToken(): string {
    return Math.random().toString(36).substring(2, 18) + Date.now().toString(36)
  }

  /**
   * Получить случайный тип колоды
   * Исключает служебные колоды (Tokens, Commands и т.д.)
   */
  private getRandomDeckType(): DeckType {
    const decksData = getDecksData()
    const deckKeys = Object.keys(decksData) as DeckType[]

    // Фильтруем только игровые колоды (с количеством карт >= 20)
    const playableDeckKeys = deckKeys.filter(deckType => {
      const deck = decksData[deckType]
      return deck && deck.length >= 20
    })

    if (playableDeckKeys.length === 0) {
      logger.warn('[SimpleHost] No playable decks found, using fallback')
      return 'SynchroTech' // fallback
    }

    const randomDeck = playableDeckKeys[Math.floor(Math.random() * playableDeckKeys.length)]
    logger.info('[SimpleHost] Random deck chosen from', playableDeckKeys.length, 'playable decks:', randomDeck)

    return randomDeck
  }

  /**
   * Создать колоду для игрока
   */
  private createPlayerDeck(playerId: number, playerName: string, deckType: DeckType): any[] {
    return createDeck(deckType, playerId, playerName)
  }

  /**
   * Инициализировать хост
   */
  async initialize(): Promise<string> {
    const { Peer } = await loadPeerJS()

    // Генерируем gameId и добавляем хост-игрока
    const gameId = this.generateGameId()
    const hostToken = this.generatePlayerToken()
    const hostDeckType = this.getRandomDeckType()
    const hostDeck = this.createPlayerDeck(1, localStorage.getItem('player_name') || 'Host', hostDeckType)

    this.state = {
      ...this.state,
      gameId,
      players: [
        {
          id: 1,
          name: localStorage.getItem('player_name') || 'Host',
          score: 0,
          hand: [],
          deck: hostDeck,
          discard: [],
          announcedCard: null,
          selectedDeck: hostDeckType,
          color: 'blue',
          isDummy: false,
          isDisconnected: false,
          isReady: false,
          boardHistory: [],
          autoDrawEnabled: true,
          playerToken: hostToken
        }
      ]
    }

    logger.info('[SimpleHost] Host deck:', hostDeckType, 'cards:', hostDeck.length)

    // Сохраняем токен хоста
    localStorage.setItem('player_token', hostToken)

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer()

        this.peer.on('open', (peerId) => {
          logger.info('[SimpleHost] Peer opened with ID:', peerId, 'gameId:', gameId)
          // Уведомляем о начальном состоянии
          this.notifyStateUpdate()
          resolve(peerId)
        })

        this.peer.on('connection', (conn) => {
          this.handleNewConnection(conn)
        })

        this.peer.on('error', (err) => {
          logger.error('[SimpleHost] Peer error:', err)
          reject(err)
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * Обработка нового соединения
   */
  private handleNewConnection(conn: any): void {
    const peerId = conn.peer

    logger.info('[SimpleHost] New connection from:', peerId)

    // Сохраняем соединение
    this.connections.set(peerId, conn)

    // Настраиваем обработчики сообщений
    conn.on('data', (data: any) => {
      this.handleMessage(data, peerId)
    })

    conn.on('open', () => {
      logger.info('[SimpleHost] Connection opened:', peerId)
    })

    conn.on('close', () => {
      logger.warn('[SimpleHost] Connection closed:', peerId)
      this.handleDisconnect(peerId)
    })

    conn.on('error', (err: any) => {
      logger.error('[SimpleHost] Connection error:', peerId, err)
    })
  }

  /**
   * Обработка входящего сообщения
   */
  private handleMessage(data: any, fromPeerId: string): void {
    logger.info('[SimpleHost] Received message:', data.type, 'from:', fromPeerId)

    if (data.type === 'ACTION') {
      this.handleAction(data as ActionMessage, fromPeerId)
    } else if (data.type === 'JOIN_REQUEST') {
      this.handleJoinRequest(data, fromPeerId)
    } else if (data.type === 'RECONNECT') {
      this.handleReconnect(data, fromPeerId)
    } else {
      logger.warn('[SimpleHost] Unknown message type:', data.type)
    }
  }

  /**
   * Обработка действия от игрока
   */
  private handleAction(actionMsg: ActionMessage, fromPeerId: string): void {
    const { playerId, action, data } = actionMsg

    logger.info('[SimpleHost] Action:', playerId, action, data)

    // Для действий от хоста (локальных) пропускаем проверку peerId
    if (fromPeerId !== 'host') {
      // Проверяем playerId соответствует peerId
      const expectedPeerId = this.getPeerIdForPlayer(playerId)
      if (expectedPeerId !== fromPeerId) {
        logger.warn('[SimpleHost] PlayerId mismatch:', playerId, 'from', fromPeerId)
        return
      }
    }

    // Применяем действие к состоянию
    const oldState = this.state
    const newState = applyAction(oldState, playerId, action, data)

    // Если состояние изменилось - broadcast
    if (newState !== oldState) {
      this.state = newState
      this.version++
      this.broadcastAll()  // broadcastAll теперь вызывает notifyStateUpdate внутри
    }
  }

  /**
   * Обработка запроса на присоединение
   */
  private handleJoinRequest(data: any, fromPeerId: string): void {
    const { playerName, playerToken } = data

    // Проверяем переподключение
    if (playerToken) {
      const existingPlayerId = this.findPlayerByToken(playerToken)
      if (existingPlayerId) {
        // Переподключение
        this.peerIdToPlayerId.set(fromPeerId, existingPlayerId)
        const conn = this.connections.get(fromPeerId)

        conn?.send({
          type: 'JOIN_ACCEPT',
          playerId: existingPlayerId,
          state: this.personalizeForPlayer(existingPlayerId),
          version: this.version
        })

        // Помечаем игрока как подключённого
        this.state = {
          ...this.state,
          players: this.state.players.map(p =>
            p.id === existingPlayerId
              ? { ...p, isDisconnected: false }
              : p
          )
        }

        logger.info('[SimpleHost] Player reconnected:', existingPlayerId)
        return
      }
    }

    // Новый игрок
    const newPlayerId = this.playerIdCounter++

    // Генерируем токен, если его нет
    const finalToken = playerToken || this.generatePlayerToken()

    // Выбираем случайную колоду для нового игрока
    const randomDeckType = this.getRandomDeckType()
    const newPlayerDeck = this.createPlayerDeck(newPlayerId, playerName || `Player ${newPlayerId}`, randomDeckType)

    // Добавляем игрока в состояние
    this.state = {
      ...this.state,
      players: [
        ...this.state.players,
        {
          id: newPlayerId,
          name: playerName || `Player ${newPlayerId}`,
          score: 0,
          hand: [],
          deck: newPlayerDeck,
          discard: [],
          selectedDeck: randomDeckType,
          color: this.getPlayerColor(newPlayerId),
          isDummy: false,
          isDisconnected: false,
          isReady: false,
          boardHistory: [],
          playerToken: finalToken
        }
      ]
    }

    logger.info('[SimpleHost] Created player', newPlayerId, 'with deck:', randomDeckType, 'cards:', newPlayerDeck.length)

    this.peerIdToPlayerId.set(fromPeerId, newPlayerId)

    // Создаём персонализированное состояние
    const personalizedState = this.personalizeForPlayer(newPlayerId)
    const myPlayer = personalizedState.players.find((p: any) => p.id === newPlayerId)

    logger.info('[SimpleHost] Sending JOIN_ACCEPT to player', newPlayerId,
      'with playerToken:', myPlayer?.playerToken ? 'YES' : 'NO')

    // Отправляем подтверждение
    const conn = this.connections.get(fromPeerId)
    conn?.send({
      type: 'JOIN_ACCEPT',
      playerId: newPlayerId,
      state: personalizedState,
      version: this.version
    })

    // Broadcast всем о новом игроке
    this.broadcastAll()

    // Уведомляем хоста об изменении состояния
    this.notifyStateUpdate()

    logger.info('[SimpleHost] Player joined:', newPlayerId, playerName)
    this.config.onPlayerJoin?.(newPlayerId)
  }

  /**
   * Обработка переподключения
   */
  private handleReconnect(data: any, fromPeerId: string): void {
    const { playerId } = data

    // Обновляем соответствие peerId -> playerId
    this.peerIdToPlayerId.set(fromPeerId, playerId)

    // Отправляем текущее состояние
    const conn = this.connections.get(fromPeerId)
    conn?.send({
      type: 'STATE',
      version: this.version,
      state: this.personalizeForPlayer(playerId),
      timestamp: Date.now()
    })

    // Помечаем как подключённого
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.id === playerId
          ? { ...p, isDisconnected: false }
          : p
      )
    }

    // Broadcast
    this.broadcastAll()

    logger.info('[SimpleHost] Player reconnected:', playerId)
  }

  /**
   * Обработка отключения
   */
  private handleDisconnect(peerId: string): void {
    const playerId = this.peerIdToPlayerId.get(peerId)

    if (playerId) {
      // Помечаем как отключённого
      this.state = {
        ...this.state,
        players: this.state.players.map(p =>
          p.id === playerId
            ? { ...p, isDisconnected: true, disconnectTimestamp: Date.now() }
            : p
        )
      }

      // Broadcast
      this.broadcastAll()

      this.config.onPlayerLeave?.(playerId)
    }

    this.connections.delete(peerId)
    this.peerIdToPlayerId.delete(peerId)
  }

  /**
   * Отправить состояние всем игрокам
   */
  private broadcastAll(): void {
    const message: Omit<StateMessage, 'timestamp'> = {
      type: 'STATE',
      version: this.version,
      state: this.state as any  // будет персонализировано для каждого
    }

    // Также уведомляем хоста
    this.notifyStateUpdate()

    this.connections.forEach((conn, peerId) => {
      const playerId = this.peerIdToPlayerId.get(peerId)

      if (playerId) {
        // Персонализируем состояние для этого игрока
        const personalized = this.personalizeForPlayer(playerId)

        // Логируем все announcedCard для отладки
        const announcedCards = personalized.players
          .filter((p: any) => p.announcedCard)
          .map((p: any) => `Player${p.id}:${p.announcedCard.name}`)
          .join(', ')
        if (announcedCards) {
          logger.info(`[SimpleHost] Broadcasting to player ${playerId} with announcedCards: [${announcedCards}]`)
        }

        conn.send({
          ...message,
          state: personalized,
          timestamp: Date.now()
        })
      }
    })
  }

  /**
   * Персонализировать состояние для игрока
   * Конвертируем все неподдерживаемые PeerJS типы (Map, Set) в обычные объекты
   */
  private personalizeForPlayer(localPlayerId: number): PersonalizedState {
    const baseState = this.state

    // Конвертируем visualEffects Map в объект для PeerJS
    const visualEffectsObj: Record<string, any> = {}
    if (baseState.visualEffects instanceof Map) {
      for (const [key, value] of baseState.visualEffects.entries()) {
        visualEffectsObj[key] = value
      }
    }

    const result = {
      ...baseState,
      // Заменяем Map на объект
      visualEffects: visualEffectsObj,
      players: baseState.players.map(player => {
        const isLocalPlayer = player.id === localPlayerId
        const isDummy = player.isDummy

        // Для локального игрока и dummy - полные данные
        // Для остальных - только размеры + announcedCard (витрина видна всем)
        if (isLocalPlayer || isDummy) {
          return {
            id: player.id,
            name: player.name,
            score: player.score,
            color: player.color,
            isDummy: player.isDummy,
            isDisconnected: player.isDisconnected,
            isReady: player.isReady,
            teamId: player.teamId,
            autoDrawEnabled: player.autoDrawEnabled,
            isSpectator: player.isSpectator,
            position: player.position,
            selectedDeck: player.selectedDeck,
            playerToken: player.playerToken,  // ВАЖНО: для идентификации локального игрока
            hand: player.hand,
            deck: player.deck,
            discard: player.discard,
            announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
            boardHistory: player.boardHistory,
            lastPlayedCardId: player.lastPlayedCardId || null
          }
        } else {
          const pData = {
            id: player.id,
            name: player.name,
            score: player.score,
            color: player.color,
            isDummy: player.isDummy,
            isDisconnected: player.isDisconnected,
            isReady: player.isReady,
            teamId: player.teamId,
            autoDrawEnabled: player.autoDrawEnabled,
            isSpectator: player.isSpectator,
            position: player.position,
            selectedDeck: player.selectedDeck,
            handSize: player.hand?.length || 0,
            deckSize: player.deck?.length || 0,
            discardSize: player.discard?.length || 0,
            // Делаем глубокую копию announcedCard для избежания проблем с ссылками
            announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
            lastPlayedCardId: player.lastPlayedCardId || null
          }
          // Логируем announcedCard для отладки
          if (player.announcedCard) {
            logger.info(`[SimpleHost] Player ${player.id} announcedCard for ${localPlayerId}:`, player.announcedCard.name)
          }
          return pData
        }
      }) as PersonalizedPlayer[]
    }

    return result
  }

  /**
   * Получить peerId для игрока
   */
  private getPeerIdForPlayer(playerId: number): string | null {
    for (const [peerId, pid] of this.peerIdToPlayerId.entries()) {
      if (pid === playerId) return peerId
    }
    return null
  }

  /**
   * Найти игрока по токену
   */
  private findPlayerByToken(token: string): number | null {
    const player = this.state.players.find(p => p.playerToken === token)
    return player?.id || null
  }

  /**
   * Получить цвет для игрока
   */
  private getPlayerColor(playerId: number): any {
    const colors = ['blue', 'purple', 'red', 'green', 'yellow', 'orange']
    return colors[(playerId - 1) % colors.length]
  }

  /**
   * Генерировать gameId
   */
  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 18).toUpperCase()
  }

  /**
   * Уведомить о смене состояния
   */
  private notifyStateUpdate(): void {
    if (this.config.onStateUpdate) {
      // Для хоста - локальный игрок всегда 1
      const hostState = this.personalizeForPlayer(1)

      // Логируем все announcedCard для отладки
      const announcedCards = hostState.players
        .filter((p: any) => p.announcedCard)
        .map((p: any) => `Player${p.id}:${p.announcedCard.name}`)
        .join(', ')
      if (announcedCards) {
        logger.info(`[SimpleHost] Host (player1) receiving state with announcedCards: [${announcedCards}]`)
      }

      this.config.onStateUpdate(hostState)
    }
  }

  /**
   * Выполнить действие от хоста
   */
  hostAction(action: string, data?: any): void {
    // Хост всегда игрок 1
    this.handleAction({
      type: 'ACTION',
      playerId: 1,
      action: action as any,
      data,
      timestamp: Date.now()
    }, 'host')
  }

  /**
   * Получить текущее состояние
   */
  getState(): PersonalizedState {
    return this.personalizeForPlayer(1)
  }

  /**
   * Получить peerId
   */
  getPeerId(): string | null {
    return this.peer?.id || null
  }

  /**
   * Получить текущую версию состояния
   */
  getVersion(): number {
    return this.version
  }

  /**
   * Broadcast visual effect message to all guests
   * Used for highlights, floating text, targeting mode, etc.
   */
  broadcast(message: any): void {
    this.connections.forEach((conn, peerId) => {
      conn.send({
        ...message,
        timestamp: Date.now()
      })
    })
  }

  /**
   * Завершить работу
   */
  destroy(): void {
    this.connections.forEach(conn => conn.close())
    this.connections.clear()

    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }
}

export default SimpleHost
