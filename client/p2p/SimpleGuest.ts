/**
 * SimpleGuest
 *
 * Simplified guest for P2P game.
 * Sends actions to host, receives state.
 */

import { loadPeerJS } from './PeerJSLoader'
import type { PersonalizedState, SimpleGuestConfig, P2PMessage } from './SimpleP2PTypes'
import { logger } from '../utils/logger'

/**
 * SimpleGuest - simplified guest
 */
export class SimpleGuest {
  private peer: any = null  // Peer instance
  private hostConnection: any = null  // DataConnection to host
  private hostPeerId: string | null = null
  private localPlayerId: number

  // State
  private state: PersonalizedState | null = null
  private lastVersion: number = 0

  // Configuration
  private config: SimpleGuestConfig

  // Callbacks for Promise from connect()
  private resolveJoin: (() => void) | null = null
  private rejectJoin: ((err: any) => void) | null = null

  constructor(config: SimpleGuestConfig) {
    this.config = config
    this.localPlayerId = config.localPlayerId
  }

  /**
   * Connect to host
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

        this.peer.on('open', (_peerId: string) => {
          logger.info('[SimpleGuest] Peer opened')

          // Connect to host
          this.connectToHost(hostPeerId)
        })

        this.peer.on('connection', (conn: any) => {
          logger.info('[SimpleGuest] Incoming connection from:', conn.peer)
          // Use first incoming connection as host
          if (!this.hostConnection) {
            this.hostConnection = conn
            this.setupHostConnection(conn)
          }
        })

        this.peer.on('error', (err: any) => {
          logger.error('[SimpleGuest] Peer error:', err)
          this.rejectJoin?.(err)
        })

        // Connection timeout
        setTimeout(() => {
          if (!joinResolved) {
            this.rejectJoin?.(new Error('Connection timeout'))
          }
        }, 15000) // 15 seconds

      } catch (e) {
        this.rejectJoin?.(e)
      }
    })
  }

  /**
   * Connect to host (guest initiates)
   */
  private connectToHost(hostPeerId: string): void {
    if (!this.peer) {return}

    logger.info('[SimpleGuest] Connecting to host:', hostPeerId)

    const conn = this.peer.connect(hostPeerId, {
      reliable: true
    })

    this.hostConnection = conn
    this.setupHostConnection(conn)
  }

  /**
   * Setup host connection
   */
  private setupHostConnection(conn: any): void {
    conn.on('open', () => {
      logger.info('[SimpleGuest] Connected to host')

      // Send join request
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
   * Handle incoming message from host
   */
  private handleMessage(data: P2PMessage): void {
    if (data.type === 'JOIN_ACCEPT') {
      this.handleJoinAccept(data)
    } else if (data.type === 'STATE') {
      this.handleState(data)
    } else if (data.type === 'HIGHLIGHT') {
      this.handleHighlight(data)
    } else if (data.type === 'FLOATING_TEXT') {
      this.handleFloatingText(data)
    } else if (data.type === 'TARGETING_MODE') {
      this.handleTargetingMode(data)
    } else if (data.type === 'CLEAR_TARGETING_MODE') {
      this.handleClearTargetingMode()
    } else if (data.type === 'NO_TARGET') {
      this.handleNoTarget(data)
    } else if (data.type === 'DECK_SELECTION') {
      this.handleDeckSelection(data)
    } else if (data.type === 'HAND_CARD_SELECTION') {
      this.handleHandCardSelection(data)
    } else if (data.type === 'CLICK_WAVE') {
      this.handleClickWave(data)
    } else {
      logger.warn('[SimpleGuest] Unknown message type:', data.type)
    }
  }

  /**
   * Handle join accept - host accepted the connection
   * Host sends: { type: 'JOIN_ACCEPT', playerId, state, version }
   */
  private handleJoinAccept(data: any): void {
    const playerId = data.playerId
    const state = data.state
    const version = data.version

    logger.info('[SimpleGuest] Join accepted - playerId:', playerId, 'version:', version)

    // Update local player ID
    this.localPlayerId = playerId

    // If state included, process it (accept initial state version 0 or newer)
    if (state && version >= this.lastVersion) {
      this.lastVersion = version
      this.state = state

      // Find and store player token from personalized state
      const myPlayer = state.players.find((p: any) => p.id === playerId)
      if (myPlayer?.playerToken) {
        localStorage.setItem('player_token', myPlayer.playerToken)
      }

      // Notify about state update
      if (this.config.onStateUpdate) {
        this.config.onStateUpdate(state)
      }
    }

    // Resolve join promise
    if (this.resolveJoin) {
      this.resolveJoin()
      this.resolveJoin = null
      this.rejectJoin = null
    }
  }

  /**
   * Handle state message
   */
  private handleState(data: any): void {
    // Version control - only apply new states
    if (data.version <= this.lastVersion) {
      logger.debug('[SimpleGuest] Ignoring old state:', data.version, '<=', this.lastVersion)
      return
    }

    this.lastVersion = data.version
    this.state = data.state
    this.localPlayerId = this.findLocalPlayerId()

    // Log all announcedCard for debugging
    const announcedCards = this.state?.players
      .filter((p: any) => p.announcedCard)
      .map((p: any) => `Player${p.id}:${p.announcedCard.name}`)
      .join(', ')
    if (announcedCards) {
      logger.info('[SimpleGuest] Received state version:', data.version, 'with announcedCards: [', announcedCards, ']')
    }

    logger.info('[SimpleGuest] State updated, version:', data.version,
      'phase:', this.state?.currentPhase,
      'activePlayer:', this.state?.activePlayerId)

    // Notify
    if (this.config.onStateUpdate && this.state) {
      this.config.onStateUpdate(this.state)
    }

    // Resolve Promise on first state receipt with gameId
    if (this.resolveJoin && this.state?.gameId) {
      this.resolveJoin()
      this.resolveJoin = null
      this.rejectJoin = null
    }
  }

  /**
   * Find local playerId in state
   */
  private findLocalPlayerId(): number {
    if (!this.state) {return this.localPlayerId}

    // Try to find by token
    const token = localStorage.getItem('player_token')
    if (token) {
      const player = this.state.players.find((p: any) => p.playerToken === token)
      if (player) {return player.id}
    }

    return this.localPlayerId
  }

  /**
   * Send action to host
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
   * Reconnect
   */
  async reconnect(newHostPeerId?: string): Promise<void> {
    const hostId = newHostPeerId || this.hostPeerId

    if (!hostId) {
      throw new Error('No host peer ID')
    }

    logger.info('[SimpleGuest] Reconnecting to:', hostId)

    // Close old connection
    if (this.hostConnection) {
      this.hostConnection.close()
    }

    // If new peerId provided, create new Peer
    if (newHostPeerId && this.peer) {
      this.peer.destroy()
      this.peer = null
    }

    await this.connect(hostId)

    // Send reconnect request
    if (this.hostConnection) {
      this.hostConnection.send({
        type: 'RECONNECT',
        playerId: this.localPlayerId,
        playerToken: localStorage.getItem('player_token')
      })
    }
  }

  /**
   * Get current state
   */
  getState(): PersonalizedState | null {
    return this.state
  }

  /**
   * Get local player ID
   */
  getLocalPlayerId(): number {
    return this.localPlayerId
  }

  /**
   * Handle cell highlight
   */
  private handleHighlight(data: any): void {
    const highlightData = data.data
    this.config.onHighlight?.({ row: highlightData.row, col: highlightData.col, color: highlightData.color, duration: highlightData.duration })
  }

  /**
   * Handle floating text
   */
  private handleFloatingText(data: any): void {
    const { batch } = data.data
    this.config.onFloatingText?.(batch)
  }

  /**
   * Handle targeting mode set
   */
  private handleTargetingMode(data: any): void {
    const { targetingMode } = data.data
    this.config.onTargetingMode?.(targetingMode)
  }

  /**
   * Handle targeting mode clear
   */
  private handleClearTargetingMode(): void {
    this.config.onClearTargetingMode?.()
  }

  /**
   * Handle no target overlay
   */
  private handleNoTarget(data: any): void {
    const { coords } = data.data
    this.config.onNoTarget?.(coords)
  }

  /**
   * Handle deck selection
   */
  private handleDeckSelection(data: any): void {
    const { playerId, selectedByPlayerId } = data.data
    this.config.onDeckSelection?.(playerId, selectedByPlayerId)
  }

  /**
   * Handle hand card selection
   */
  private handleHandCardSelection(data: any): void {
    const { playerId, cardIndex, selectedByPlayerId } = data.data
    this.config.onHandCardSelection?.(playerId, cardIndex, selectedByPlayerId)
  }

  /**
   * Handle click wave
   */
  private handleClickWave(data: any): void {
    const wave = data.data
    this.config.onClickWave?.(wave)
  }

  /**
   * Shutdown
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
