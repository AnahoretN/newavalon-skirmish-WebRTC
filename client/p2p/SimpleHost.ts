/**
 * SimpleHost
 *
 * Simplified host for P2P game.
 * Single source of truth, two message types.
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
 * SimpleHost - simplified host
 */
export class SimpleHost {
  private peer: any = null  // Peer instance
  private connections: Map<string, any> = new Map()  // peerId -> DataConnection
  private playerIdCounter: number = 2  // Start with 2, since host is already player 1
  private peerIdToPlayerId: Map<string, number> = new Map()

  // Game state
  private state: GameState
  private version: number = 0

  // Configuration
  private config: SimpleHostConfig

  constructor(initialState: GameState, config: SimpleHostConfig = {}) {
    this.state = initialState
    this.config = config
  }

  /**
   * Generate unique token for player
   */
  private generatePlayerToken(): string {
    return Math.random().toString(36).substring(2, 18) + Date.now().toString(36)
  }

  /**
   * Get random deck type
   * Excludes service decks (Tokens, Commands, etc.)
   */
  private getRandomDeckType(): DeckType {
    const decksData = getDecksData()
    const deckKeys = Object.keys(decksData) as DeckType[]

    // Filter only playable decks (with card count >= 20)
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
   * Create deck for player
   */
  private createPlayerDeck(playerId: number, playerName: string, deckType: DeckType): any[] {
    return createDeck(deckType, playerId, playerName)
  }

  /**
   * Initialize host
   */
  async initialize(): Promise<string> {
    const { Peer } = await loadPeerJS()

    // Generate gameId and add host player
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

    // Save host token
    localStorage.setItem('player_token', hostToken)

    return new Promise((resolve, reject) => {
      try {
        this.peer = new Peer()

        this.peer.on('open', (peerId) => {
          logger.info('[SimpleHost] Peer opened with ID:', peerId, 'gameId:', gameId)
          // Notify about initial state
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
   * Handle new connection
   */
  private handleNewConnection(conn: any): void {
    const peerId = conn.peer

    logger.info('[SimpleHost] New connection from:', peerId)

    // Store connection
    this.connections.set(peerId, conn)

    // Set up message handlers
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
   * Handle incoming message
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
   * Handle action from player
   */
  private handleAction(actionMsg: ActionMessage, fromPeerId: string): void {
    const { playerId, action, data } = actionMsg

    logger.info('[SimpleHost] Action:', playerId, action, data)

    // For actions from host (local), skip peerId verification
    if (fromPeerId !== 'host') {
      // Verify playerId matches peerId
      const expectedPeerId = this.getPeerIdForPlayer(playerId)
      if (expectedPeerId !== fromPeerId) {
        logger.warn('[SimpleHost] PlayerId mismatch:', playerId, 'from', fromPeerId)
        return
      }
    }

    // Apply action to state
    const oldState = this.state
    const newState = applyAction(oldState, playerId, action, data)

    // If state changed - broadcast
    if (newState !== oldState) {
      this.state = newState
      this.version++
      this.broadcastAll()  // broadcastAll now calls notifyStateUpdate internally
    }
  }

  /**
   * Handle join request
   */
  private handleJoinRequest(data: any, fromPeerId: string): void {
    const { playerName, playerToken } = data

    // Check for reconnection
    if (playerToken) {
      const existingPlayerId = this.findPlayerByToken(playerToken)
      if (existingPlayerId) {
        // Reconnection
        this.peerIdToPlayerId.set(fromPeerId, existingPlayerId)
        const conn = this.connections.get(fromPeerId)

        conn?.send({
          type: 'JOIN_ACCEPT',
          playerId: existingPlayerId,
          state: this.personalizeForPlayer(existingPlayerId),
          version: this.version
        })

        // Mark player as connected
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

    // New player
    const newPlayerId = this.playerIdCounter++

    // Generate token if not provided
    const finalToken = playerToken || this.generatePlayerToken()

    // Choose random deck for new player
    const randomDeckType = this.getRandomDeckType()
    const newPlayerDeck = this.createPlayerDeck(newPlayerId, playerName || `Player ${newPlayerId}`, randomDeckType)

    // Add player to state
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

    // Create personalized state
    const personalizedState = this.personalizeForPlayer(newPlayerId)
    const myPlayer = personalizedState.players.find((p: any) => p.id === newPlayerId)

    logger.info('[SimpleHost] Sending JOIN_ACCEPT to player', newPlayerId,
      'with playerToken:', myPlayer?.playerToken ? 'YES' : 'NO')

    // Send confirmation
    const conn = this.connections.get(fromPeerId)
    conn?.send({
      type: 'JOIN_ACCEPT',
      playerId: newPlayerId,
      state: personalizedState,
      version: this.version
    })

    // Broadcast to all about new player
    this.broadcastAll()

    // Notify host about state change
    this.notifyStateUpdate()

    logger.info('[SimpleHost] Player joined:', newPlayerId, playerName)
    this.config.onPlayerJoin?.(newPlayerId)
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(data: any, fromPeerId: string): void {
    const { playerId } = data

    // Update peerId -> playerId mapping
    this.peerIdToPlayerId.set(fromPeerId, playerId)

    // Send current state
    const conn = this.connections.get(fromPeerId)
    conn?.send({
      type: 'STATE',
      version: this.version,
      state: this.personalizeForPlayer(playerId),
      timestamp: Date.now()
    })

    // Mark as connected
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
   * Handle disconnect
   */
  private handleDisconnect(peerId: string): void {
    const playerId = this.peerIdToPlayerId.get(peerId)

    if (playerId) {
      // Mark as disconnected
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
   * Send state to all players
   */
  private broadcastAll(): void {
    const message: Omit<StateMessage, 'timestamp'> = {
      type: 'STATE',
      version: this.version,
      state: this.state as any  // will be personalized for each
    }

    // Also notify host
    this.notifyStateUpdate()

    this.connections.forEach((conn, peerId) => {
      const playerId = this.peerIdToPlayerId.get(peerId)

      if (playerId) {
        // Personalize state for this player
        const personalized = this.personalizeForPlayer(playerId)

        // Log all announcedCard for debugging
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
   * Personalize state for player
   * Convert all unsupported PeerJS types (Map, Set) to plain objects
   */
  private personalizeForPlayer(localPlayerId: number): PersonalizedState {
    const baseState = this.state

    // Convert visualEffects Map to object for PeerJS
    const visualEffectsObj: Record<string, any> = {}
    if (baseState.visualEffects instanceof Map) {
      for (const [key, value] of baseState.visualEffects.entries()) {
        visualEffectsObj[key] = value
      }
    }

    const result = {
      ...baseState,
      // Replace Map with object
      visualEffects: visualEffectsObj,
      players: baseState.players.map(player => {
        const isLocalPlayer = player.id === localPlayerId
        const isDummy = player.isDummy

        // For local player and dummy - full data
        // For others - only sizes + announcedCard (showcase visible to all)
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
            playerToken: player.playerToken,  // IMPORTANT: for local player identification
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
            // Make deep copy of announcedCard to avoid reference issues
            announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
            lastPlayedCardId: player.lastPlayedCardId || null
          }
          // Log announcedCard for debugging
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
   * Get peerId for player
   */
  private getPeerIdForPlayer(playerId: number): string | null {
    for (const [peerId, pid] of this.peerIdToPlayerId.entries()) {
      if (pid === playerId) {return peerId}
    }
    return null
  }

  /**
   * Find player by token
   */
  private findPlayerByToken(token: string): number | null {
    const player = this.state.players.find(p => p.playerToken === token)
    return player?.id || null
  }

  /**
   * Get color for player
   */
  private getPlayerColor(playerId: number): any {
    const colors = ['blue', 'purple', 'red', 'green', 'yellow', 'orange']
    return colors[(playerId - 1) % colors.length]
  }

  /**
   * Generate gameId
   */
  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 18).toUpperCase()
  }

  /**
   * Notify about state change
   */
  private notifyStateUpdate(): void {
    if (this.config.onStateUpdate) {
      // For host - local player is always 1
      const hostState = this.personalizeForPlayer(1)

      // Log all announcedCard for debugging
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
   * Execute action from host
   */
  hostAction(action: string, data?: any): void {
    // Host is always player 1
    this.handleAction({
      type: 'ACTION',
      playerId: 1,
      action: action as any,
      data,
      timestamp: Date.now()
    }, 'host')
  }

  /**
   * Get current state
   */
  getState(): PersonalizedState {
    return this.personalizeForPlayer(1)
  }

  /**
   * Get peerId
   */
  getPeerId(): string | null {
    return this.peer?.id || null
  }

  /**
   * Get current state version
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
   * Shutdown
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
