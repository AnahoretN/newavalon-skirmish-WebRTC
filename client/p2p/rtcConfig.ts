/**
 * RTC Configuration
 *
 * ICE servers for WebRTC connections.
 * Multiple STUN servers provide fallback for NAT traversal.
 */

export interface RTCConfiguration {
  iceServers: Array<{
    urls: string[]
  }>
}

/**
 * RTC configuration with multiple STUN servers for fallback.
 *
 * If one STUN server fails, WebRTC will try the next one automatically.
 * This improves connectivity reliability across different network environments.
 */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['stun:global.stun.twilio.com:3478'] },
    { urls: ['stun:stun.nextcloud.com:443'] },
    { urls: ['stun:stun.framasoft.org:443'] },
    { urls: ['stun:stun.miwifi.com:3478'] },
    { urls: ['stun:stun.voip.blackberry.com:3478'] },
    { urls: ['stun:stun2.l.google.com:19302'] },
    { urls: ['stun:stun3.l.google.com:19302'] }
  ]
}

/**
 * List of alternative PeerJS signaling servers.
 *
 * ПРИМЕЧАНИЕ: Публичных PeerJS серверов очень мало.
 * PeerJS Cloud (0.peerjs.com) — единственный стабильный публичный сервер.
 *
 * Для production рекомендуется запускать свой сервер:
 * npm install -g peerjs-server
 * peerjs-server --port 9000
 *
 * IMPORTANT: When path is not specified, PeerJS uses '/peerjs' by default.
 */
export const ALTERNATIVE_PEERJS_SERVERS = [
  // Официальный PeerJS Cloud (единственный стабильный публичный сервер)
  { host: '0.peerjs.com', port: 443, secure: true },
]

/**
 * Get the index of the last working server from localStorage.
 * Automatically resets to 0 if the saved index is out of bounds.
 */
function getLastServerIndex(): number {
  const savedIndex = localStorage.getItem('peerjs_server_index')
  if (!savedIndex) return 0

  const index = parseInt(savedIndex, 10)
  // Reset if index is out of bounds (server list may have changed)
  if (isNaN(index) || index < 0 || index >= ALTERNATIVE_PEERJS_SERVERS.length) {
    console.warn('[PeerJS] Invalid server index cached, resetting to default')
    localStorage.removeItem('peerjs_server_index')
    return 0
  }
  return index
}

/**
 * Save the index of a working server to localStorage.
 */
function saveServerIndex(index: number): void {
  localStorage.setItem('peerjs_server_index', index.toString())
}

/**
 * Get custom PeerJS server URL from localStorage.
 * Returns null if using the default PeerJS cloud server.
 */
function getCustomPeerJSServer(): string | null {
  const serverUrl = localStorage.getItem('peerjs_server_url')
  if (serverUrl && serverUrl.trim()) {
    return serverUrl.trim()
  }
  return null
}

/**
 * Create PeerJS options with RTC configuration.
 * Pass this to the Peer constructor: new Peer(options)
 *
 * NOTE: By default, we don't specify host/port/path to let PeerJS use its
 * default cloud service. This is more reliable than specifying servers manually.
 *
 * @param customPeerId - Optional custom peer ID for reconnection (same ID after page refresh)
 * @param serverIndex - Optional server index to use (for fallback)
 */
export function getPeerJSOptions(customPeerId?: string, serverIndex?: number): {
  config: RTCConfiguration
  debug?: number
  id?: string
  host?: string
  port?: number
  path?: string
  secure?: boolean
  useFallbackServer?: boolean
  serverIndex?: number
} {
  // One-time migration: clear cached server index from old versions
  // This ensures users get the fix automatically
  if (localStorage.getItem('peerjs_server_index') !== null) {
    localStorage.removeItem('peerjs_server_index')
    console.log('[PeerJS] Migrated to default server configuration')
  }

  const options: {
    config: RTCConfiguration
    debug?: number
    id?: string
    host?: string
    port?: number
    path?: string
    secure?: boolean
    useFallbackServer?: boolean
    serverIndex?: number
  } = {
    config: RTC_CONFIG,
    debug: 0 // Disable PeerJS debug logging to reduce console noise
  }

  // Add custom peer ID if provided (for session restoration after page refresh)
  if (customPeerId) {
    options.id = customPeerId
  }

  // Check for custom PeerJS server first
  const customServer = getCustomPeerJSServer()
  if (customServer) {
    try {
      const url = new URL(customServer)
      options.host = url.hostname
      options.port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80)
      // Use '/' to let PeerJS use its default '/peerjs' path
      // Using '/peerjs' explicitly causes '/peerjs/peerjs/id' double path issue
      options.path = url.pathname.replace(/\/$/, '') || '/'
      options.secure = url.protocol === 'https:'
      console.log('[PeerJS] Using custom server:', options.host, options.port, options.path, options.secure)
      return options
    } catch (e) {
      console.error('[PeerJS] Invalid custom server URL, using fallback:', e)
    }
  }

  // Use fallback server list only if explicitly requested
  // Otherwise, let PeerJS use its default cloud service (more reliable)
  const lastIndex = serverIndex ?? getLastServerIndex()

  // If using server index 0 (default), don't specify host/port - let PeerJS use defaults
  if (lastIndex === 0 && !serverIndex) {
    // Return minimal config - let PeerJS use its default cloud service
    return options
  }

  // Use specific server from fallback list
  const server = ALTERNATIVE_PEERJS_SERVERS[lastIndex] || ALTERNATIVE_PEERJS_SERVERS[0]

  options.host = server.host
  options.port = server.port
  // Only set path if explicitly specified (let PeerJS use default '/peerjs' if undefined)
  if (server.path !== undefined) {
    options.path = server.path
  }
  options.secure = server.secure
  options.useFallbackServer = true
  options.serverIndex = lastIndex

  return options
}

/**
 * Mark current server as failed and try next server.
 * Call this when PeerJS connection fails.
 */
export function tryNextPeerJSServer(): number {
  const currentIndex = getLastServerIndex()
  const nextIndex = (currentIndex + 1) % ALTERNATIVE_PEERJS_SERVERS.length
  saveServerIndex(nextIndex)
  console.log('[PeerJS] Switching to server', nextIndex, 'of', ALTERNATIVE_PEERJS_SERVERS.length)
  return nextIndex
}

/**
 * Reset to default server (index 0).
 */
export function resetPeerJSServer(): void {
  localStorage.removeItem('peerjs_server_index')
  console.log('[PeerJS] Reset to default server')
}
