/**
 * Cloudinary Image Optimization Utilities
 *
 * Provides functions to generate optimized image URLs for faster loading
 */

const CLOUDINARY_BASE = 'res.cloudinary.com/dxxh6meej'

/**
 * Check if URL is a Cloudinary URL
 */
export function isCloudinaryUrl(url: string): boolean {
  return url.includes(CLOUDINARY_BASE)
}

/**
 * Add Cloudinary optimization parameters to URL
 * - q_auto: automatic quality
 * - f_auto: automatic format (WebP/AVIF for modern browsers)
 */
export function getOptimizedImageUrl(url: string, options?: {
  quality?: 'auto' | number
  format?: 'auto' | 'webp' | 'avif' | 'jpg' | 'png'
  width?: number
  height?: number
  blur?: number
}): string {
  if (!url || !isCloudinaryUrl(url)) {
    return url
  }

  const quality = options?.quality ?? 'auto'
  const format = options?.format ?? 'auto'

  // Build transformation string
  const transformations: string[] = [`q_${quality}`, `f_${format}`]

  if (options?.width) {
    transformations.push(`w_${options.width}`)
  }
  if (options?.height) {
    transformations.push(`h_${options.height}`)
  }
  if (options?.blur) {
    transformations.push(`e_blur:${options.blur}`)
  }

  // Insert transformations into URL
  // Cloudinary URL format: .../image/upload/VVERSION/FILENAME.png
  // We want: .../image/upload/q_auto,f_auto/VVERSION/FILENAME.png
  const uploadIndex = url.indexOf('/image/upload/')
  if (uploadIndex === -1) {
    return url
  }

  const before = url.substring(0, uploadIndex + '/image/upload/'.length)
  const after = url.substring(uploadIndex + '/image/upload/'.length)

  return `${before}${transformations.join(',')}/${after}`
}

/**
 * Get a low-quality placeholder URL for progressive loading
 * Uses tiny size + blur effect for instant preview
 */
export function getPlaceholderImageUrl(url: string, blurAmount: number = 10): string {
  if (!url || !isCloudinaryUrl(url)) {
    return url
  }

  // Very small size with blur for placeholder - loads instantly
  return getOptimizedImageUrl(url, {
    quality: 30,
    format: 'jpg',
    width: 50, // Tiny size for instant loading
    blur: blurAmount,
  })
}

/**
 * Get full quality image URL
 */
export function getFullImageUrl(url: string): string {
  if (!url || !isCloudinaryUrl(url)) {
    return url
  }

  // High quality with auto format
  return getOptimizedImageUrl(url, {
    quality: 'auto',
    format: 'auto',
  })
}

/**
 * Get thumbnail URL for previews (smaller size, faster load)
 */
export function getThumbnailImageUrl(url: string, size: number = 200): string {
  if (!url || !isCloudinaryUrl(url)) {
    return url
  }

  return getOptimizedImageUrl(url, {
    quality: 'auto',
    format: 'auto',
    width: size,
  })
}

/**
 * Prefetch an image (load it in background)
 */
export function prefetchImage(url: string): void {
  if (!url) return

  const img = new Image()
  img.src = url
}

/**
 * Prefetch multiple images
 */
export function prefetchImages(urls: string[], maxConcurrent: number = 3): void {
  let index = 0

  function loadNext() {
    if (index >= urls.length) return

    const url = urls[index++]
    const img = new Image()

    img.onload = img.onerror = () => {
      loadNext()
    }

    img.src = url
  }

  // Start initial batch
  for (let i = 0; i < maxConcurrent && i < urls.length; i++) {
    loadNext()
  }
}
