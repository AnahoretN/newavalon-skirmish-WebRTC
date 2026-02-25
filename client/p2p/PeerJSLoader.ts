/**
 * PeerJS Loader
 *
 * Загружает PeerJS по требованию.
 * Позволяет избежать проблем с импортом на клиенте.
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
    try {
      // Пытаемся импортировать PeerJS
      peerjsModule = await import('peerjs')
      return peerjsModule
    } catch (e) {
      console.error('[PeerJSLoader] Failed to load PeerJS:', e)
      throw e
    }
  })()

  return loadPromise
}

export function getPeerJS() {
  return peerjsModule
}

export function isPeerJSLoaded(): boolean {
  return peerjsModule !== null
}
