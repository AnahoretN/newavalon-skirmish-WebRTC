/**
 * PeerJS Loader
 *
 * Loads PeerJS on demand.
 * Avoids import issues on the client.
 */

let peerjsModule: any = null
let loadPromise: Promise<any> | null = null

export async function loadPeerJS(): Promise<any> {
  if (peerjsModule) {
    return peerjsModule
  }

  if (loadPromise) {
    return loadPromise
  }

  loadPromise = (async () => {
    // Try to import PeerJS
    peerjsModule = await import('peerjs')
    return peerjsModule
  })()

  return loadPromise
}

export function getPeerJS() {
  return peerjsModule
}

export function isPeerJSLoaded(): boolean {
  return peerjsModule !== null
}
