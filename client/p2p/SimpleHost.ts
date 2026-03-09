/**
 * SimpleHost
 *
 * Simplified host for P2P game.
 * Single source of truth, two message types.
 */

import { loadPeerJS } from './PeerJSLoader'
import { getPeerJSOptions } from './rtcConfig'
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
import { getRandomHostColor, assignUniqueRandomColor } from '../utils/colorAssigner'

// Reconnection timeout: 30 seconds for a disconnected player to reconnect
const RECONNECT_TIMEOUT_MS = 30000

/**
 * SimpleHost - simplified host
 */
export class SimpleHost {
  private peer: any = null  // Peer instance
  private connections: Map<string, any> = new Map()  // _peerId -> DataConnection
  private playerIdCounter: number  // Initialized in constructor based on existing players
  private peerIdToPlayerId: Map<string, number> = new Map()

  // Game state
  private state: GameState
  private version: number = 0

  // Reconnection timers: playerId -> timer ID
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map()

  // Configuration
  private config: SimpleHostConfig

  constructor(initialState: GameState, config: SimpleHostConfig = {}) {
    this.state = initialState
    this.config = config
    // Initialize playerIdCounter based on existing players to avoid ID conflicts
    const maxPlayerId = initialState.players.length > 0
      ? Math.max(...initialState.players.map(p => p.id))
      : 1
    this.playerIdCounter = maxPlayerId + 1
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
      return 'SynchroTech' as DeckType // fallback
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

    // Assign random unique color for host
    const hostColor = getRandomHostColor()
    logger.info('[SimpleHost] Host assigned random color:', hostColor)

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
          color: hostColor,
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
        this.peer = new Peer(getPeerJSOptions())

        this.peer.on('open', (_peerId: string) => {
          logger.info('[SimpleHost] Peer opened with ID:', _peerId, 'gameId:', gameId)
          // Notify about initial state
          this.notifyStateUpdate()
          resolve(_peerId)
        })

        this.peer.on('connection', (conn: any) => {
          this.handleNewConnection(conn)
        })

        this.peer.on('error', (err: any) => {
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
    const _peerId = conn.peer

    logger.info('[SimpleHost] New connection from:', _peerId)

    // Store connection
    this.connections.set(_peerId, conn)

    // Set up message handlers
    conn.on('data', (data: any) => {
      this.handleMessage(data, _peerId)
    })

    conn.on('open', () => {
      logger.info('[SimpleHost] Connection opened:', _peerId)
    })

    conn.on('close', () => {
      logger.warn('[SimpleHost] Connection closed:', _peerId)
      this.handleDisconnect(_peerId)
    })

    conn.on('error', (err: any) => {
      logger.error('[SimpleHost] Connection error:', _peerId, err)
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

    // For actions from host (local), skip _peerId verification
    if (fromPeerId !== 'host') {
      // Verify playerId matches _peerId
      const expectedPeerId = this.getPeerIdForPlayer(playerId)
      if (expectedPeerId !== fromPeerId) {
        logger.warn('[SimpleHost] PlayerId mismatch:', playerId, 'from', fromPeerId)
        return
      }
    }

    // Visual effects - broadcast without state change
    if (action === 'CLICK_WAVE') {
      this.broadcastClickWave(data, fromPeerId)
      return
    }

    // Handle EXIT_GAME - intentional player exit (becomes dummy, no reconnection)
    // @ts-ignore - EXIT_GAME is not in standard action types
    if (action === 'EXIT_GAME') {
      logger.info('[SimpleHost] Player', playerId, 'intentionally exited - converting to dummy')

      // Cancel reconnection timer if exists
      const timer = this.reconnectTimers.get(playerId)
      if (timer) {
        clearTimeout(timer)
        this.reconnectTimers.delete(playerId)
      }

      // Convert player to dummy (stay in game, don't reconnect)
      this.state = {
        ...this.state,
        players: this.state.players.map(p =>
          p.id === playerId
            ? {
                ...p,
                isDummy: true,
                isDisconnected: false,
                disconnectTimestamp: undefined,
                reconnectionDeadline: undefined,
                // Clear token so they can't auto-reconnect as this player
                playerToken: undefined
              }
            : p
        )
      }

      // Close and remove connection (don't keep connection open for dummy)
      const peerId = this.getPeerIdForPlayer(playerId)
      if (peerId) {
        const conn = this.connections.get(peerId)
        if (conn) {
          conn.close()
        }
        this.connections.delete(peerId)
        this.peerIdToPlayerId.delete(peerId)
      }

      // Increment version and broadcast
      this.version++
      this.broadcastAll()

      this.config.onPlayerLeave?.(playerId)
      return
    }

    // Special handling for SELECT_SCORING_LINE - need to send floating texts BEFORE passing turn
    if (action === 'SELECT_SCORING_LINE') {
      const oldState = this.state
      const { lineType, lineIndex } = data || {}

      if (lineType && oldState.isScoringStep) {
        // Get scoring player BEFORE any state changes
        const scoringPlayerId = oldState?.activePlayerId ?? 0
        const clickingPlayer = oldState?.players.find((p: any) => p.id === playerId)
        const scoringPlayer = oldState?.players.find((p: any) => p.id === scoringPlayerId)
        logger.info(`[SimpleHost] SELECT_SCORING_LINE: clickingPlayer=${playerId} (${clickingPlayer?.name}) scoringPlayer=${scoringPlayerId} (${scoringPlayer?.name}) line=${lineType} ${lineIndex}`)

        // CRITICAL: Send floating texts FIRST using current state (before turn pass)
        this.broadcastFloatingTextForScoring(oldState, scoringPlayerId, lineType, lineIndex, oldState)

        // NOW apply action (which updates scores but does NOT pass turn yet)
        let intermediateState = applyAction(oldState, playerId, action, data)

        // NOW pass turn after floating texts were sent
        intermediateState = applyAction(intermediateState, playerId, 'PASS_TURN', { reason: 'scoring_complete' })

        // Update state if changed
        if (intermediateState !== oldState) {
          this.state = intermediateState
          const maxPlayerId = intermediateState.players.length > 0
            ? Math.max(...intermediateState.players.map(p => p.id))
            : 0
          if (maxPlayerId >= this.playerIdCounter) {
            this.playerIdCounter = maxPlayerId + 1
          }
          this.version++
          this.broadcastAll()
        }
        return
      }
    }

    // Special handling for SCORE_DIAGONAL - apply action first, then send floating texts
    if (action === 'SCORE_DIAGONAL') {
      const oldState = this.state
      const { playerId: scoringPlayerId, bonusType = 'point_per_support' } = data || {}

      // Apply action to get new state with scoring data
      const resultState = applyAction(oldState, playerId, action, data)
      const scoringData = (resultState as any)._diagonalScoringEvents

      if (scoringData) {
        const { powerScoreEvents, supportBonusEvents, powerScore, supportCount, totalScoreGain } = scoringData

        logger.info(`[SimpleHost] SCORE_DIAGONAL: power=${powerScore} support=${supportCount} total=${totalScoreGain}`)

        // Create floating text events
        const scoreEvents: { row: number; col: number; text: string; playerId: number }[] = []

        // Add floating texts for power contribution from each card
        for (const event of powerScoreEvents) {
          scoreEvents.push({
            row: event.row,
            col: event.col,
            text: `+${event.power}`,
            playerId: scoringPlayerId
          })
        }

        // Add floating texts for Support bonus (+1 per Support)
        if (bonusType === 'point_per_support') {
          for (const event of supportBonusEvents) {
            scoreEvents.push({
              row: event.row,
              col: event.col,
              text: '+1',
              playerId: scoringPlayerId
            })
          }
        }

        // Send floating texts as batch (with slight delays for visual effect)
        if (scoreEvents.length > 0) {
          this.broadcast({
            type: 'FLOATING_TEXT',
            data: { batch: scoreEvents.map((item, i) => ({ ...item, timestamp: Date.now() + (i * 100) })) }
          })
        }

        // Clean up temporary data from result state
        delete (resultState as any)._diagonalScoringEvents
      }

      // Update state with result from applyAction
      if (resultState !== oldState) {
        this.state = resultState
        const maxPlayerId = resultState.players.length > 0
          ? Math.max(...resultState.players.map(p => p.id))
          : 0
        if (maxPlayerId >= this.playerIdCounter) {
          this.playerIdCounter = maxPlayerId + 1
        }
        this.version++
        this.broadcastAll()
      }
      return
    }

    // Apply action to state (normal flow for all other actions)
    const oldState = this.state
    const newState = applyAction(oldState, playerId, action, data)

    // If state changed - broadcast
    if (newState !== oldState) {
      this.state = newState

      // Update playerIdCounter to reflect new max player ID
      // This prevents ID conflicts when players are added via actions (like SET_DUMMY_PLAYER_COUNT)
      const maxPlayerId = newState.players.length > 0
        ? Math.max(...newState.players.map(p => p.id))
        : 0
      if (maxPlayerId >= this.playerIdCounter) {
        this.playerIdCounter = maxPlayerId + 1
      }
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
        logger.info('[SimpleHost] Reconnection request for player', existingPlayerId, 'from peer', fromPeerId)

        // Cancel reconnection timer if exists
        const timer = this.reconnectTimers.get(existingPlayerId)
        if (timer) {
          clearTimeout(timer)
          this.reconnectTimers.delete(existingPlayerId)
          logger.info('[SimpleHost] Cancelled reconnection timer for player', existingPlayerId)
        }

        // Remove old connection for this player (if any)
        const oldPeerId = this.getPeerIdForPlayer(existingPlayerId)
        if (oldPeerId && oldPeerId !== fromPeerId) {
          const oldConn = this.connections.get(oldPeerId)
          if (oldConn) {
            oldConn.close()
            this.connections.delete(oldPeerId)
            logger.info('[SimpleHost] Closed old connection', oldPeerId, 'for player', existingPlayerId)
          }
        }

        // Update peerId mapping
        this.peerIdToPlayerId.set(fromPeerId, existingPlayerId)

        // Mark player as connected and clear reconnection fields
        this.state = {
          ...this.state,
          players: this.state.players.map(p =>
            p.id === existingPlayerId
              ? { ...p, isDisconnected: false, disconnectTimestamp: undefined, reconnectionDeadline: undefined }
              : p
          )
        }

        // Increment version so guests know state changed
        this.version++

        const conn = this.connections.get(fromPeerId)
        conn?.send({
          type: 'JOIN_ACCEPT',
          playerId: existingPlayerId,
          state: this.personalizeForPlayer(existingPlayerId),
          version: this.version
        })

        // Broadcast updated state to all players
        this.broadcastAll()

        logger.info('[SimpleHost] Player reconnected successfully:', existingPlayerId)
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
    // Assign random unique color (not already used by existing players)
    const existingColors = this.state.players.map(p => p.color)
    const newPlayerColor = assignUniqueRandomColor(existingColors)
    logger.info(`[SimpleHost] Creating player ${newPlayerId} with random unique color: ${newPlayerColor}`)

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
          color: newPlayerColor,
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

    // Increment version so existing guests know state changed
    this.version++

    // Create personalized state
    const personalizedState = this.personalizeForPlayer(newPlayerId)
    const myPlayer = personalizedState.players.find((p: any) => p.id === newPlayerId)

    logger.info('[SimpleHost] Sending JOIN_ACCEPT to player', newPlayerId,
      'with playerToken:', myPlayer?.playerToken ? 'YES' : 'NO',
      'version:', this.version)

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
   * Handle reconnection - cancel timer and restore player
   */
  private handleReconnect(data: any, fromPeerId: string): void {
    const { playerId } = data

    // Cancel reconnection timer if exists
    const timer = this.reconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(playerId)
      logger.info('[SimpleHost] Cancelled reconnection timer for player', playerId)
    }

    // Update _peerId -> playerId mapping (in case of new peerId)
    this.peerIdToPlayerId.set(fromPeerId, playerId)

    // Mark as connected and clear reconnection fields
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.id === playerId
          ? { ...p, isDisconnected: false, disconnectTimestamp: undefined, reconnectionDeadline: undefined }
          : p
      )
    }

    // Increment version so guests know state changed
    this.version++

    // Send current state to reconnected player
    const conn = this.connections.get(fromPeerId)
    conn?.send({
      type: 'STATE',
      version: this.version,
      state: this.personalizeForPlayer(playerId),
      timestamp: Date.now()
    })

    // Broadcast to all (including reconnected player)
    this.broadcastAll()

    logger.info('[SimpleHost] Player reconnected successfully:', playerId)
  }

  /**
   * Handle disconnect - start reconnection timer
   */
  private handleDisconnect(_peerId: string): void {
    const playerId = this.peerIdToPlayerId.get(_peerId)

    // Remove connection and peerId mapping FIRST
    // This prevents broadcastAll from trying to send to closed connection
    this.connections.delete(_peerId)
    this.peerIdToPlayerId.delete(_peerId)

    if (playerId) {
      const deadline = Date.now() + RECONNECT_TIMEOUT_MS

      // Mark as disconnected with deadline
      this.state = {
        ...this.state,
        players: this.state.players.map(p =>
          p.id === playerId
            ? { ...p, isDisconnected: true, disconnectTimestamp: Date.now(), reconnectionDeadline: deadline }
            : p
        )
      }

      // Increment version so guests know state changed
      this.version++

      // Broadcast updated state (now that old peerId is removed from map)
      this.broadcastAll()

      // Start reconnection timer - after 30s, convert to dummy
      const timer = setTimeout(() => {
        this.convertToDummy(playerId)
      }, RECONNECT_TIMEOUT_MS)

      this.reconnectTimers.set(playerId, timer)

      logger.info('[SimpleHost] Player disconnected, reconnection window open until:', new Date(deadline).toISOString())

      this.config.onPlayerLeave?.(playerId)
    }
  }

  /**
   * Convert disconnected player to dummy after timeout
   */
  private convertToDummy(playerId: number): void {
    // Clear timer
    const timer = this.reconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(playerId)
    }

    // Check if player has reconnected in the meantime
    const player = this.state.players.find(p => p.id === playerId)
    if (!player || player.isDummy || !player.isDisconnected) {
      return // Player no longer exists, is already dummy, or has reconnected
    }

    logger.warn('[SimpleHost] Converting player', playerId, 'to dummy after reconnection timeout')

    // Convert to dummy
    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.id === playerId
          ? { ...p, isDummy: true, isDisconnected: false, disconnectTimestamp: undefined, reconnectionDeadline: undefined }
          : p
      )
    }

    // Increment version and broadcast
    this.version++
    this.broadcastAll()

    this.config.onPlayerLeave?.(playerId)
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

    this.connections.forEach((conn, _peerId) => {
      const playerId = this.peerIdToPlayerId.get(_peerId)

      if (playerId) {
        // Check if connection is still open before sending
        // @ts-ignore - PeerJS connection has open property
        if (conn.open !== false) {
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

          try {
            conn.send({
              ...message,
              state: personalized,
              timestamp: Date.now()
            })
          } catch (e) {
            logger.warn('[SimpleHost] Failed to send to player', playerId, 'peer', _peerId, e)
          }
        }
      }
    })
  }

  /**
   * Broadcast click wave effect to all players
   * @param data - Wave data
   * @param excludePeerId - Peer ID to exclude from broadcast (the sender)
   */
  private broadcastClickWave(data: any, excludePeerId?: string): void {
    const wave = {
      timestamp: Date.now(),
      location: data.location || 'board',
      boardCoords: data.boardCoords,
      handTarget: data.handTarget,
      clickedByPlayerId: data.clickedByPlayerId,
      playerColor: data.playerColor
    }

    const message = {
      type: 'CLICK_WAVE',
      data: wave
    }

    // Send to all connected guests except the sender
    this.connections.forEach((conn, peerId) => {
      // Skip the sender - they already have the wave locally
      if (peerId === excludePeerId) {
        return
      }
      try {
        conn.send(message)
      } catch (e) {
        logger.error('[SimpleHost] Failed to send click wave:', e)
      }
    })

    // Notify host locally via callback for waves from guests
    // (host's own clicks are handled locally via triggerClickWave)
    if (!data._local) {
      this.config.onClickWave?.(wave)
    }
  }

  /**
   * Broadcast floating text for scoring to all players
   * Shows floating text over cards that actually contributed to the score.
   * The text color matches the player who received the points.
   *
   * @param newState - Updated game state after scoring
   * @param playerId - Player who scored (receives the points)
   * @param lineType - Type of line scored ('row' | 'col')
   * @param lineIndex - Index of line scored (from active player's perspective)
   * @param oldState - State before scoring (to find which cards contributed)
   */
  private broadcastFloatingTextForScoring(newState: GameState, playerId: number, lineType: string, lineIndex?: number, _oldState?: any): void {
    const gridSize = newState.activeGridSize
    const scoreEvents: { row: number; col: number; text: string; playerId: number }[] = []

    // IMPORTANT: We need to find ALL cards on the board that either:
    // 1. Belong to the scoring player, OR
    // 2. Have Exploit tokens from the scoring player (when Data Liberator with Support is on board)
    // and are in the selected line (row/col).
    //
    // The lineType and lineIndex tell us WHICH line was selected for scoring.
    // We check each cell in that line, and if the card contributes to score,
    // we add floating text for that card.

    // Check if player has Data Liberator with Support on board
    // Data Liberator allows scoring points from cards with Exploit tokens
    let hasDataLiberatorWithSupport = false
    for (let r = 0; r < newState.board.length; r++) {
      for (let c = 0; c < newState.board[r]?.length; c++) {
        const cell = newState.board[r][c]
        if (cell.card?.ownerId === playerId &&
            cell.card.baseId === 'dataLiberator' &&
            cell.card.statuses?.some((s: any) => s.type === 'Support' && s.addedByPlayerId === playerId)) {
          hasDataLiberatorWithSupport = true
          break
        }
      }
      if (hasDataLiberatorWithSupport) {break}
    }

    // CRITICAL: Calculate offset to convert active grid coordinates to full board coordinates
    // The active grid is centered in the full board, so we need to add the offset
    const totalSize = newState.board.length
    const offset = Math.floor((totalSize - gridSize) / 2)

    // Find cells in the selected line (CONVERT to full board coordinates with offset)
    const cellsToCheck: { row: number; col: number }[] = []
    if (lineType === 'row' && lineIndex !== undefined) {
      const actualRow = lineIndex + offset  // Convert to full board coordinate
      for (let c = 0; c < gridSize; c++) {
        cellsToCheck.push({ row: actualRow, col: c + offset })
      }
    } else if (lineType === 'col' && lineIndex !== undefined) {
      const actualCol = lineIndex + offset  // Convert to full board coordinate
      for (let r = 0; r < gridSize; r++) {
        cellsToCheck.push({ row: r + offset, col: actualCol })
      }
    }

    logger.info(`[SimpleHost] broadcastFloatingTextForScoring: checking ${lineType} ${lineIndex}, ${cellsToCheck.length} cells for player ${playerId}, hasDataLiberator=${hasDataLiberatorWithSupport}`)

    // Generate floating text for each card that contributes to score in this line
    for (const { row, col } of cellsToCheck) {
      const cell = newState.board[row]?.[col]
      const card = cell?.card
      if (card) {
        const belongsToScoringPlayer = card.ownerId === playerId
        const isStunned = card.statuses?.some((s: any) => s.type === 'Stun')
        const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))

        // Check if card has Exploit from scoring player (for Data Liberator passive)
        const hasExploitFromPlayer = card.statuses?.some((s: any) =>
          s.type === 'Exploit' && s.addedByPlayerId === playerId
        )

        logger.info(`[SimpleHost]   Card at (${row},${col}): owner=${card.ownerId} (target=${playerId}) isTarget=${belongsToScoringPlayer} hasExploit=${hasExploitFromPlayer} stunned=${isStunned} power=${points} name=${card.name}`)

        // Add floating text for cards that:
        // Case 1: Player's own cards (not stunned, positive power)
        if (belongsToScoringPlayer && !isStunned && points > 0) {
          scoreEvents.push({ row, col, text: `+${points}`, playerId })
          logger.info(`[SimpleHost]   -> Added score event at (${row},${col}): +${points} (own card)`)
        }
        // Case 2: Cards with Exploit from player (Data Liberator passive, not stunned, positive power)
        else if (hasDataLiberatorWithSupport && hasExploitFromPlayer && !isStunned && points > 0) {
          scoreEvents.push({ row, col, text: `+${points}`, playerId })
          logger.info(`[SimpleHost]   -> Added score event at (${row},${col}): +${points} (Exploit card)`)
        }
      }
    }

    // Only send floating text if there are actual scoring cards
    if (scoreEvents.length > 0) {
      const calculatedScore = scoreEvents.reduce((sum, e) => sum + parseInt(e.text), 0)
      logger.info(`[SimpleHost] Broadcasting ${scoreEvents.length} score events for player ${playerId} (${lineType} ${lineIndex}), total: ${calculatedScore}`)

      const message = {
        type: 'FLOATING_TEXT',
        data: { batch: scoreEvents.map((item, i) => ({ ...item, timestamp: Date.now() + i })) }
      }

      // Broadcast to all guests
      this.connections.forEach((conn) => {
        try {
          conn.send(message)
        } catch (e) {
          logger.error('[SimpleHost] Failed to send floating text:', e)
        }
      })

      // Notify host locally
      this.config.onFloatingTextBatch?.(scoreEvents)
    } else {
      logger.info(`[SimpleHost] No score events for player ${playerId} scoring ${lineType} ${lineIndex || ''}`)
    }
  }

  /**
   * Personalize state for player
   * Convert all unsupported PeerJS types (Map, Set) to plain objects
   */
  private personalizeForPlayer(localPlayerId: number): PersonalizedState {
    const baseState = this.state

    // Check if there's a deck view request
    // @ts-ignore - temporary flag for deck view request
    const deckViewRequest = baseState._deckViewRequest as { requestingPlayerId: number; targetPlayerId: number } | undefined
    const isDeckViewRequest = deckViewRequest &&
      deckViewRequest.requestingPlayerId === localPlayerId

    if (deckViewRequest) {
      logger.info(`[SimpleHost] Deck view request: requesting=${deckViewRequest.requestingPlayerId} target=${deckViewRequest.targetPlayerId} localPlayer=${localPlayerId} isMatch=${isDeckViewRequest}`)
    }

    // Convert visualEffects Map to object for PeerJS
    const visualEffectsObj: Record<string, any> = {}
    if (baseState.visualEffects instanceof Map) {
      for (const [key, value] of baseState.visualEffects.entries()) {
        visualEffectsObj[key] = value
      }
    }

    // Helper to get Tailwind background class from color name
    const getColorBgClass = (colorName: string): string => {
      const colorMap: Record<string, string> = {
        blue: 'bg-blue-600',
        purple: 'bg-purple-600',
        red: 'bg-red-600',
        green: 'bg-green-600',
        yellow: 'bg-yellow-500',
        orange: 'bg-orange-500',
        pink: 'bg-pink-500',
        brown: 'bg-[#8B4513]'
      }
      return colorMap[colorName] || 'bg-gray-600'
    }

    const result = {
      ...baseState,
      // Replace Map with object
      visualEffects: visualEffectsObj,
      players: baseState.players.map(player => {
        const isLocalPlayer = player.id === localPlayerId
        const isDummy = player.isDummy
        const playerBgClass = getColorBgClass(player.color)
        const isDeckViewTarget = isDeckViewRequest && player.id === deckViewRequest!.targetPlayerId

        // For local player and dummy - full data (hand, deck, discard)
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
            lastPlayedCardId: player.lastPlayedCardId || null,
            hasMulliganed: player.hasMulliganed,
            mulliganAttempts: player.mulliganAttempts,
            disconnectTimestamp: player.disconnectTimestamp,
            reconnectionDeadline: player.reconnectionDeadline
          }
        }

        // For deck view target - include full deck data but keep hand as placeholder
        if (isDeckViewTarget) {
          const placeholderHand = (player.hand || []).map((card: any) => {
            // Check if this card is Revealed for the local player
            const isRevealedToMe = card.revealedTo?.includes(localPlayerId) ||
              (card.statuses || []).some((s: any) =>
                s.type === 'Revealed' && s.ownerId === localPlayerId
              )

            // If Revealed to this player, send full card data so they can see it face-up
            if (isRevealedToMe) {
              return {
                ...card,  // Full card data
                _isPlaceholder: false  // Not a placeholder anymore
              }
            }

            // Otherwise, minimal placeholder (face-down)
            return {
              _isPlaceholder: true,
              id: card.id,
              baseId: card.baseId,  // IMPORTANT: Include baseId so Revealed cards can be looked up
              ownerId: card.ownerId || player.id,
              statuses: card.statuses || [],
              revealedTo: card.revealedTo,
              deck: '' as const,
              name: '',
              power: 0,
              abilityText: '',
              types: [],
              imageUrl: '',
              fallbackImage: '',
              color: playerBgClass  // Use Tailwind background class
            }
          })

          // Log deck data for debugging
          logger.info(`[SimpleHost] Deck view for ${localPlayerId}: viewing player ${player.id} deck, hasDeck: !!player.deck, deckLength: ${player.deck?.length || 0}`)

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
            // Hand remains as placeholder (private)
            hand: placeholderHand,
            handSize: player.hand?.length || 0,
            // Deck is full data (for viewing)
            deck: player.deck || [],
            deckSize: player.deck?.length || 0,
            discard: [],
            discardSize: player.discard?.length || 0,
            announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
            lastPlayedCardId: player.lastPlayedCardId || null,
            hasMulliganed: player.hasMulliganed,
            mulliganAttempts: player.mulliganAttempts,
            disconnectTimestamp: player.disconnectTimestamp,
            reconnectionDeadline: player.reconnectionDeadline
          }
        }

        // For opponents - create placeholder cards in hand with minimal data
        // This allows status tokens (like Revealed) to be placed on them
        // These cards will be shown face-down (as card backs) in UI
        // EXCEPTION: If card has Revealed status for local player, include full data
        const placeholderHand = (player.hand || []).map((card: any) => {
          // Check if this card is Revealed for the local player
          const isRevealedToMe = card.revealedTo?.includes(localPlayerId) ||
            (card.statuses || []).some((s: any) =>
              s.type === 'Revealed' && s.ownerId === localPlayerId
            )

          // If Revealed to this player, send full card data so they can see it face-up
          if (isRevealedToMe) {
            return {
              ...card,  // Full card data
              _isPlaceholder: false  // Not a placeholder anymore
            }
          }

          // Otherwise, minimal placeholder (face-down)
          return {
            _isPlaceholder: true,  // Mark as placeholder so UI knows to hide details
            id: card.id,
            baseId: card.baseId,  // IMPORTANT: Include baseId so Revealed cards can be looked up
            ownerId: card.ownerId || player.id,
            // CRITICAL: Include statuses so Revealed tokens are visible
            statuses: card.statuses || [],
            // CRITICAL: Include revealedTo so Revealed token owners can see the card face-up
            revealedTo: card.revealedTo,
            // Minimal properties for validation and Card component
            deck: '' as const,
            name: '',
            power: 0,
            abilityText: '',
            types: [],
            imageUrl: '',
            fallbackImage: '',
            color: playerBgClass  // Use Tailwind background class
          }
        })

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
          hand: placeholderHand,  // Placeholder cards with statuses
          handSize: player.hand?.length || 0,
          deckSize: player.deck?.length || 0,
          discardSize: player.discard?.length || 0,
          // Make deep copy of announcedCard to avoid reference issues
          announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
          lastPlayedCardId: player.lastPlayedCardId || null,
          hasMulliganed: player.hasMulliganed,
          mulliganAttempts: player.mulliganAttempts,
          disconnectTimestamp: player.disconnectTimestamp,
          reconnectionDeadline: player.reconnectionDeadline
        }
        // DEBUG: Log player color being sent
        if (!isLocalPlayer && !isDummy) {
          logger.info(`[SimpleHost] Opponent player color for ${localPlayerId}: player ${player.id} color=${player.color} type=${typeof player.color}`)
        }
        return pData
      }) as PersonalizedPlayer[]
    }

    // Clear the deck view request flag after processing
    if (deckViewRequest) {
      delete (result as any)._deckViewRequest
    }

    return result as PersonalizedState
  }

  /**
   * Get _peerId for player
   */
  private getPeerIdForPlayer(playerId: number): string | null {
    for (const [_peerId, pid] of this.peerIdToPlayerId.entries()) {
      if (pid === playerId) {return _peerId}
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
   * Get _peerId
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
    this.connections.forEach((conn, _peerId) => {
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
