/**
 * SimpleGuest
 *
 * Simplified guest for P2P game.
 * Sends actions to host, receives state.
 */

import { loadPeerJS } from './PeerJSLoader'
import { getPeerJSOptions, tryNextPeerJSServer } from './rtcConfig'
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

  // Signalling server optimization
  private disconnectedFromSignalling: boolean = false  // True after we disconnect from signalling server

  constructor(config: SimpleGuestConfig) {
    this.config = config
    this.localPlayerId = config.localPlayerId
  }

  /**
   * Connect to host
   */
  async connect(hostPeerId: string): Promise<void> {
    this.hostPeerId = hostPeerId

    logger.info('[SimpleGuest] Starting connection to host:', {
      hostPeerId,
      localPlayerId: this.localPlayerId
    })

    const { Peer } = await loadPeerJS()

    return new Promise((resolve, reject) => {
      let joinResolved = false

      this.resolveJoin = () => {
        if (!joinResolved) {
          joinResolved = true
          logger.info('[SimpleGuest] Join completed successfully, playerId:', this.localPlayerId)
          resolve()
        }
      }

      this.rejectJoin = (err: any) => {
        if (!joinResolved) {
          joinResolved = true
          logger.error('[SimpleGuest] Join rejected:', err)
          reject(err)
        }
      }

      try {
        this.peer = new Peer(getPeerJSOptions())

        this.peer.on('open', (myPeerId: string) => {
          logger.info('[SimpleGuest] Local peer opened:', myPeerId)

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
          // Check if this is a connection error that might be fixed by trying a different server
          if (err?.type === 'peer-unavailable' || err?.type === 'network' || err?.message?.includes('WebSocket')) {
            const nextServerIndex = tryNextPeerJSServer()
            console.warn('[SimpleGuest] Connection error, trying server', nextServerIndex)
            this.rejectJoin?.(new Error(`PeerJS connection failed. Try again or use WebSocket mode. (Server ${nextServerIndex})`))
          } else {
            logger.error('[SimpleGuest] Peer error:', err)
            this.rejectJoin?.(err)
          }
        })

        this.peer.on('disconnected', () => {
          // Only attempt reconnection if this was not intentional
          // If we intentionally disconnected (disconnectedFromSignalling=true), don't reconnect
          if (this.disconnectedFromSignalling) {
            logger.info('[SimpleGuest] Disconnected from signalling (intentional), skipping reconnect')
            return
          }

          // Attempt to reconnect to signalling server
          // Existing P2P connection to host should continue working
          logger.info('[SimpleGuest] Disconnected from PeerJS signalling server, attempting to reconnect...')
          setTimeout(() => {
            if (this.peer && !this.disconnectedFromSignalling) {
              this.peer.reconnect()
            }
          }, 1000)
        })

        // Connection timeout
        setTimeout(() => {
          if (!joinResolved) {
            logger.error('[SimpleGuest] Connection timeout after 15s')
            this.rejectJoin?.(new Error('Connection timeout'))
          }
        }, 15000) // 15 seconds

      } catch (e) {
        logger.error('[SimpleGuest] Exception during peer creation:', e)
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
      logger.info('[SimpleGuest] Connection to host opened, sending JOIN_REQUEST')

      // Save host peer ID for auto-reconnect
      localStorage.setItem('webrtc_host_peer_id', this.hostPeerId || '')

      const playerName = localStorage.getItem('player_name') || `Player ${this.localPlayerId}`
      const playerToken = localStorage.getItem('player_token')

      logger.info('[SimpleGuest] Sending JOIN_REQUEST:', { playerName, hasToken: !!playerToken })

      // Send join request
      conn.send({
        type: 'JOIN_REQUEST',
        playerName,
        playerToken
      })

      this.config.onConnected?.()
    })

    conn.on('data', (data: any) => {
      logger.info('[SimpleGuest] Received message from host:', data.type)
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
    } else if (data.type === 'RECONNECT_REJECTED') {
      this.handleReconnectRejected(data)
    } else if (data.type === 'HOST_ENDED_GAME') {
      this.handleHostEndedGame()
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

    logger.info('[SimpleGuest] Join accepted - playerId:', playerId, 'version:', version, 'players count:', state?.players?.length)

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
        logger.info('[SimpleGuest] Stored player token for playerId:', playerId)
      }

      // Notify about state update
      if (this.config.onStateUpdate) {
        this.config.onStateUpdate(state)
      }
    }

    // Resolve join promise
    if (this.resolveJoin) {
      logger.info('[SimpleGuest] Resolving join promise')
      this.resolveJoin()
      this.resolveJoin = null
      this.rejectJoin = null
    }

    // OPTIMIZATION: Disconnect from PeerJS signalling server after successful connection
    // The P2P connection to host is established, so we no longer need the signalling server
    // This reduces load on public PeerJS servers
    if (this.peer && !this.disconnectedFromSignalling) {
      try {
        this.peer.disconnect() // Disconnects from signalling server but keeps P2P connections
        this.disconnectedFromSignalling = true
        logger.info('[SimpleGuest] Disconnected from signalling server (P2P connection active)')
      } catch (e) {
        logger.warn('[SimpleGuest] Failed to disconnect from signalling server:', e)
      }
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

    // Close old P2P connection to host
    if (this.hostConnection) {
      this.hostConnection.close()
      this.hostConnection = null
    }

    // If we disconnected from signalling server, reconnect first
    if (this.disconnectedFromSignalling && this.peer) {
      try {
        logger.info('[SimpleGuest] Reconnecting to signalling server...')
        this.peer.reconnect()
        this.disconnectedFromSignalling = false
        // Wait a bit for signalling connection to establish
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (e) {
        logger.warn('[SimpleGuest] Failed to reconnect to signalling, creating new peer:', e)
        // If reconnect fails, create new peer
        this.peer.destroy()
        this.peer = null
      }
    }

    // If new peerId provided, create new Peer
    if (newHostPeerId && this.peer) {
      this.peer.destroy()
      this.peer = null
      this.disconnectedFromSignalling = false
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
    if (targetingMode.handTargets && targetingMode.handTargets.length > 0) {
      console.log('[DISCARD_FROM_HAND] Guest received targetingMode with handTargets:', {
        playerId: targetingMode.playerId,
        actionMode: targetingMode.action?.mode,
        actionType: targetingMode.action?.payload?.actionType,
        handTargetsCount: targetingMode.handTargets.length,
        handTargets: targetingMode.handTargets,
      })
    }
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
   * Handle reconnect rejected - player was converted to dummy or removed
   */
  private handleReconnectRejected(data: any): void {
    const { reason } = data
    logger.warn('[SimpleGuest] Reconnect rejected:', reason)

    // Clear saved credentials to prevent further auto-reconnect attempts
    localStorage.removeItem('webrtc_host_peer_id')
    localStorage.removeItem('player_token')

    // Notify app to show appropriate UI (return to main menu)
    this.config.onReconnectRejected?.(reason)
  }

  /**
   * Check if there are saved credentials for auto-reconnect
   */
  hasSavedCredentials(): boolean {
    const hostPeerId = localStorage.getItem('webrtc_host_peer_id')
    const playerToken = localStorage.getItem('player_token')
    return !!(hostPeerId && playerToken)
  }

  /**
   * Auto-reconnect using saved credentials
   */
  async autoReconnect(): Promise<boolean> {
    const hostPeerId = localStorage.getItem('webrtc_host_peer_id')

    if (!hostPeerId) {
      throw new Error('No saved host peer ID')
    }

    logger.info('[SimpleGuest] Auto-reconnecting to saved host:', hostPeerId)

    try {
      await this.reconnect(hostPeerId)
      return true
    } catch (e) {
      logger.error('[SimpleGuest] Auto-reconnect failed:', e)
      return false
    }
  }

  /**
   * Handle host ended game - host has exited the game
   */
  private handleHostEndedGame(): void {
    logger.info('[SimpleGuest] Host ended the game')

    // Clear saved credentials to prevent auto-reconnect
    localStorage.removeItem('webrtc_host_peer_id')
    localStorage.removeItem('player_token')

    // Destroy connection
    this.destroy()

    // Notify app to show message and return to main menu
    this.config.onHostEndedGame?.()
  }

  /**
   * Shutdown
   */
  destroy(): void {
    // Clear reconnect timer
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
