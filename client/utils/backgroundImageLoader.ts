/**
 * Background Image Loader with Rate Limiting
 *
 * Preloads images in the background with controlled concurrency
 * and rate limiting to avoid interfering with game traffic.
 *
 * Rate limit: ~0.5 Mbps = ~62.5 KB/s
 * Average card image: ~50-100 KB at full quality
 * So we can load ~1 card per second in background
 */

interface LoadTask {
  url: string
  priority: 'low' | 'normal' | 'high'
  timestamp: number
}

class BackgroundImageLoader {
  private queue: LoadTask[] = []
  private loading: Set<string> = new Set()
  private loaded: Set<string> = new Set()
  private maxConcurrent = 1 // Only load 1 image at a time in background
  private minDelayBetweenLoads = 1000 // 1 second between loads to respect rate limit
  private lastLoadTime = 0
  private isProcessing = false

  /**
   * Add image URL to preload queue
   */
  preload(url: string, priority: 'low' | 'normal' | 'high' = 'low'): void {
    if (!url || this.loaded.has(url) || this.loading.has(url)) {
      return // Already loaded or loading
    }

    // Check if already in queue
    const exists = this.queue.some(task => task.url === url)
    if (exists) {
      return
    }

    this.queue.push({
      url,
      priority,
      timestamp: Date.now()
    })

    // Sort queue by priority (high first), then by timestamp
    this.queue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.timestamp - b.timestamp
    })

    this.processQueue()
  }

  /**
   * Add multiple URLs to preload queue
   */
  preloadMany(urls: string[], priority: 'low' | 'normal' | 'high' = 'low'): void {
    urls.forEach(url => this.preload(url, priority))
  }

  /**
   * Check if image is already loaded
   */
  isLoaded(url: string): boolean {
    return this.loaded.has(url)
  }

  /**
   * Clear the queue (e.g., when navigating away)
   */
  clearQueue(): void {
    this.queue = []
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.queue = []
    this.loading.clear()
    this.loaded.clear()
  }

  /**
   * Process the next item in queue
   */
  private processQueue(): void {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true

    const processNext = () => {
      if (this.queue.length === 0) {
        this.isProcessing = false
        return
      }

      // Check rate limit
      const now = Date.now()
      const timeSinceLastLoad = now - this.lastLoadTime
      const delayNeeded = Math.max(0, this.minDelayBetweenLoads - timeSinceLastLoad)

      setTimeout(() => {
        const task = this.queue.shift()
        if (!task) {
          this.isProcessing = false
          return
        }

        this.loadImage(task.url).then(() => {
          this.lastLoadTime = Date.now()
          processNext() // Continue to next
        }).catch(() => {
          this.lastLoadTime = Date.now()
          processNext() // Continue even on error
        })
      }, delayNeeded)
    }

    processNext()
  }

  /**
   * Load a single image
   */
  private loadImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loading.add(url)

      const img = new Image()

      img.onload = () => {
        this.loading.delete(url)
        this.loaded.add(url)
        resolve()
      }

      img.onerror = () => {
        this.loading.delete(url)
        // Don't add to loaded set on error, so we can retry
        reject(new Error(`Failed to load: ${url}`))
      }

      // Start loading
      img.src = url
    })
  }
}

// Singleton instance
export const backgroundLoader = new BackgroundImageLoader()

/**
 * Helper function to extract card image URLs from player data
 * for background preloading
 */
export function extractCardUrls(players: any[], localPlayerId: number | null): string[] {
  const urls: string[] = []

  for (const player of players) {
    // Skip local player's visible cards (they're already loading)
    if (player.id === localPlayerId) {
      continue
    }

    // Add hand cards (low priority since they're face down for opponents)
    if (player.hand) {
      for (const card of player.hand) {
        if (card.imageUrl && !urls.includes(card.imageUrl)) {
          urls.push(card.imageUrl)
        }
      }
    }

    // Add deck cards (low priority, not visible)
    if (player.deck) {
      for (const card of player.deck) {
        if (card.imageUrl && !urls.includes(card.imageUrl)) {
          urls.push(card.imageUrl)
        }
      }
    }

    // Add discard cards (visible but not urgent)
    if (player.discard) {
      for (const card of player.discard) {
        if (card.imageUrl && !urls.includes(card.imageUrl)) {
          urls.push(card.imageUrl)
        }
      }
    }
  }

  return urls
}

/**
 * Preload images for CardDetailModal
 * These are high priority since user is likely to click
 */
export function preloadCardDetailImages(card: any): void {
  if (!card) return

  const urls: string[] = []

  // Main card image
  if (card.imageUrl) {
    urls.push(card.imageUrl)
  }

  // Fallback image
  if (card.fallbackImage) {
    urls.push(card.fallbackImage)
  }

  // Load at normal priority
  backgroundLoader.preloadMany(urls, 'normal')
}
