/**
 * Invite Link Types based on game state
 */
export type InviteLinkType = 'mainMenu' | 'lobby' | 'inGame' | 'spectator' | 'webrtcHost'

/**
 * Result of invite link generation
 */
export interface InviteLinkResult {
  url: string
  type: InviteLinkType
  description: string
}

/**
 * Parse invite link parameters from URL hash
 * Returns parsed parameters or null if no invite link present
 */
export interface ParsedInviteLink {
  gameId?: string
  serverUrl?: string
  hostId?: string
  webrtcMode?: boolean
}

export function parseInviteLink(): ParsedInviteLink | null {
  const hash = window.location.hash.slice(1) // Remove #
  if (!hash) {return null}

  const params = new URLSearchParams(hash)
  const result: ParsedInviteLink = {}

  if (params.has('game')) {
    result.gameId = params.get('game') || undefined
  }
  if (params.has('s')) {
    try {
      result.serverUrl = decodeURIComponent(atob(params.get('s') || ''))
    } catch {
      // Invalid encoding, ignore
    }
  }
  if (params.has('hostId')) {
    result.hostId = params.get('hostId') || undefined
    result.webrtcMode = true
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Generate WebRTC host invite link
 * @param hostId - PeerJS host ID
 * @returns Invite link for P2P connection
 */
export function generateWebrtcHostLink(hostId: string): string {
  const baseUrl = window.location.origin + window.location.pathname
  return `${baseUrl}#hostId=${encodeURIComponent(hostId)}`
}

/**
 * Generate invite link based on current game state
 *
 * Rules:
 * - Main menu (no gameId): Share server config only
 * - Lobby (gameId exists, !isGameStarted): Share server + game invite
 * - In game (isGameStarted): Share server + game invite (for spectator or late join)
 * - WebRTC Host mode: Share host peer ID for P2P connection
 *
 * Uses hash parameters (#game=...&s=...&hostId=...) for GitHub Pages compatibility
 *
 * @param gameId - Current game ID (null if not in a game)
 * @param isGameStarted - Whether the game has started
 * @param isPrivate - Whether the game is private (affects link description)
 * @param hostId - WebRTC host peer ID (if in WebRTC host mode)
 * @returns InviteLinkResult with URL, type, and description
 */
export function generateInviteLink(
  gameId: string | null,
  isGameStarted: boolean,
  isPrivate: boolean = false,
  hostId?: string | null
): InviteLinkResult {
  // Get the game site URL (where the game is hosted)
  // Include pathname for GitHub Pages (e.g., /newavalon-skirmish/)
  const baseUrl = window.location.origin + window.location.pathname

  // WebRTC Host mode - direct P2P link
  if (hostId) {
    const inviteLink = generateWebrtcHostLink(hostId)
    return {
      url: inviteLink,
      type: 'webrtcHost',
      description: 'Share WebRTC host link for direct P2P connection',
    }
  }

  // Get the WebSocket server URL we're connected to
  const wsUrl = localStorage.getItem('websocket_url') || ''

  // Encode the WebSocket URL for safe transmission
  const encodedServerUrl = wsUrl
    ? btoa(encodeURIComponent(wsUrl))
    : ''

  // Determine link type based on game state
  if (!gameId) {
    // Main menu - only share server config
    const inviteLink = encodedServerUrl
      ? `${baseUrl}#s=${encodedServerUrl}`
      : baseUrl

    return {
      url: inviteLink,
      type: 'mainMenu',
      description: encodedServerUrl
        ? 'Share server configuration'
        : 'Share game site',
    }
  }

  // In a game (lobby or playing) - use hash parameters for GitHub Pages
  const inviteLink = encodedServerUrl
    ? `${baseUrl}#game=${gameId}&s=${encodedServerUrl}`
    : `${baseUrl}#game=${gameId}`

  if (isGameStarted) {
    return {
      url: inviteLink,
      type: 'inGame',
      description: isPrivate
        ? 'Share private game (spectator)'
        : 'Share game link (spectator)',
    }
  }

  // Lobby
  return {
    url: inviteLink,
    type: 'lobby',
    description: isPrivate
      ? 'Share private game invite'
      : 'Share game invite',
  }
}

/**
 * Get localized description for invite link type
 */
export function getInviteLinkDescription(
  type: InviteLinkType,
  isPrivate: boolean,
  t: (key: string) => string
): string {
  switch (type) {
    case 'mainMenu':
      return t('inviteLinkMainMenu')
    case 'lobby':
      return isPrivate ? t('inviteLinkPrivateLobby') : t('inviteLinkLobby')
    case 'inGame':
      return isPrivate ? t('inviteLinkPrivateGame') : t('inviteLinkGame')
    case 'spectator':
      return t('inviteLinkSpectator')
    case 'webrtcHost':
      return t('copyHostLink')
  }
}
