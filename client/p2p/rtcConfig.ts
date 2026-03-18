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
 * Create PeerJS options with RTC configuration.
 * Pass this to the Peer constructor: new Peer(options)
 * @param customPeerId - Optional custom peer ID for reconnection (same ID after page refresh)
 */
export function getPeerJSOptions(customPeerId?: string): { config: RTCConfiguration; debug?: number; id?: string } {
  const options: { config: RTCConfiguration; debug?: number; id?: string } = {
    config: RTC_CONFIG,
    debug: 1 // Enable PeerJS debug logging
  }

  // Add custom peer ID if provided (for session restoration after page refresh)
  if (customPeerId) {
    options.id = customPeerId
  }

  return options
}
