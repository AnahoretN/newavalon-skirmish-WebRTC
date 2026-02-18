/**
 * Image Loading Utilities with Retry and Fallback
 *
 * Handles:
 * - Retry on failure with exponential backoff
 * - Fallback to alternate URLs
 * - Preloading for better performance
 */

export interface ImageLoadOptions {
  maxRetries?: number
  retryDelay?: number
  onRetry?: (attempt: number) => void
  onLoad?: () => void
  onError?: (error: Error) => void
}

/**
 * Load an image with retry mechanism
 */
export function loadImageWithRetry(
  url: string,
  options: ImageLoadOptions = {}
): Promise<HTMLImageElement> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onRetry,
    onLoad,
    onError,
  } = options

  return new Promise((resolve, reject) => {
    let attempt = 0

    const tryLoad = () => {
      attempt++
      const img = new Image()

      img.onload = () => {
        onLoad?.()
        resolve(img)
      }

      img.onerror = () => {
        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1) // Exponential backoff
          onRetry?.(attempt)
          setTimeout(tryLoad, delay)
        } else {
          const error = new Error(`Failed to load image after ${maxRetries} attempts: ${url}`)
          onError?.(error)
          reject(error)
        }
      }

      img.src = url
    }

    tryLoad()
  })
}

/**
 * Preload multiple images with concurrency limit
 */
export function preloadImages(
  urls: string[],
  options: { maxConcurrent?: number; timeout?: number } = {}
): Promise<{ success: string[]; failed: string[] }> {
  const { maxConcurrent = 4, timeout = 10000 } = options
  const results: { success: string[]; failed: string[] } = { success: [], failed: [] }
  let index = 0

  return new Promise((resolve) => {
    const loadNext = () => {
      if (index >= urls.length) {
        resolve(results)
        return
      }

      const url = urls[index++]
      const img = new Image()

      const timeoutId = setTimeout(() => {
        results.failed.push(url)
        loadNext()
      }, timeout)

      img.onload = () => {
        clearTimeout(timeoutId)
        results.success.push(url)
        loadNext()
      }

      img.onerror = () => {
        clearTimeout(timeoutId)
        results.failed.push(url)
        loadNext()
      }

      img.src = url
    }

    // Start initial batch
    for (let i = 0; i < maxConcurrent && i < urls.length; i++) {
      loadNext()
    }
  })
}

/**
 * Generate URLs with different quality levels for progressive loading
 */
export function getProgressiveUrls(baseUrl: string): {
  low: string
  medium: string
  high: string
} {
  // Remove any existing transformations
  const cleanUrl = baseUrl.replace(/\/image\/upload\/[^/]+\//, '/image/upload/')

  return {
    low: cleanUrl.replace(
      /\/image\/upload\//,
      '/image/upload/q_30,w_200/'
    ),
    medium: cleanUrl.replace(
      /\/image\/upload\//,
      '/image/upload/q_60,w_400/'
    ),
    high: cleanUrl.replace(
      /\/image\/upload\//,
      '/image/upload/q_auto,f_auto/'
    ),
  }
}

/**
 * Image loading state manager for React components
 */
export class ImageLoader {
  private loadAttempts: Map<string, number> = new Map()
  private loadedUrls: Set<string> = new Set()
  private failedUrls: Set<string> = new Set()

  /**
   * Check if URL has been successfully loaded
   */
  isLoaded(url: string): boolean {
    return this.loadedUrls.has(url)
  }

  /**
   * Check if URL has failed to load
   */
  hasFailed(url: string): boolean {
    return this.failedUrls.has(url)
  }

  /**
   * Get number of load attempts for URL
   */
  getAttemptCount(url: string): number {
    return this.loadAttempts.get(url) || 0
  }

  /**
   * Mark URL as loaded
   */
  markLoaded(url: string): void {
    this.loadedUrls.add(url)
    this.failedUrls.delete(url)
  }

  /**
   * Mark URL as failed
   */
  markFailed(url: string): void {
    this.failedUrls.add(url)
  }

  /**
   * Increment attempt count
   */
  incrementAttempts(url: string): number {
    const count = (this.loadAttempts.get(url) || 0) + 1
    this.loadAttempts.set(url, count)
    return count
  }

  /**
   * Reset state for URL (for retry)
   */
  reset(url: string): void {
    this.loadedUrls.delete(url)
    this.failedUrls.delete(url)
    this.loadAttempts.delete(url)
  }

  /**
   * Clear all cached state
   */
  clear(): void {
    this.loadAttempts.clear()
    this.loadedUrls.clear()
    this.failedUrls.clear()
  }
}

// Global image loader instance
export const globalImageLoader = new ImageLoader()
