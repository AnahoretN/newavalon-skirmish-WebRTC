/**
 * Cloudinary Image Optimization Utilities
 *
 * Provides functions to generate optimized image URLs for faster loading
 *
 * VU Size Reference (based on 1080px window height):
 * - 1 VU = 0.1% of window height = 1.08px
 * - IMAGE_TINY = 50 VU ≈ 54px
 * - IMAGE_SMALL = 64 VU ≈ 69px
 * - IMAGE_PREVIEW = 150 VU ≈ 162px
 * - IMAGE_NORMAL = 300 VU ≈ 324px
 * - IMAGE_LARGE = 400 VU ≈ 432px
 */

const CLOUDINARY_BASE = 'res.cloudinary.com/dxxh6meej'

/**
 * VU-based image size constants
 * These match the CSS VU variables in index.css
 */
export const VU_IMAGE_SIZES = {
  TINY: 54,      // --vu-image-tiny: calc(50 * var(--vu-base)) ≈ 54px
  SMALL: 69,     // --vu-image-small: calc(64 * var(--vu-base)) ≈ 69px
  PREVIEW: 162,  // --vu-image-preview: calc(150 * var(--vu-base)) ≈ 162px
  NORMAL: 324,   // --vu-image-normal: calc(300 * var(--vu-base)) ≈ 324px
  LARGE: 432,    // --vu-image-large: calc(400 * var(--vu-base)) ≈ 432px
} as const

/**
 * Get dynamic VU-based image size
 * Calculates actual pixel size based on current window height
 * Falls back to 1080px standard if window not available
 */
export function getVuImageSize(vuUnits: number): number {
  if (typeof window === 'undefined') {
    // Server-side: use 1080px standard (1 VU = 1.08px)
    return Math.round(vuUnits * 1.08)
  }

  const vh = window.innerHeight
  const vuBase = vh * 0.001 // 1 VU = 0.1% of viewport height (CSS пиксели)
  return Math.round(vuUnits * vuBase)
}

/**
 * Get optimized image size using VU constants
 * Use this for responsive image sizing
 */
export function getOptimizedImageSize(
  size: keyof typeof VU_IMAGE_SIZES | 'dynamic'
): number {
  if (size === 'dynamic') {
    // Calculate based on current viewport
    return getVuImageSize(300) // Default to IMAGE_NORMAL
  }

  return VU_IMAGE_SIZES[size]
}

/**
 * Check if URL is a Cloudinary URL
 */
export function isCloudinaryUrl(url: string): boolean {
  return url.includes(CLOUDINARY_BASE)
}

/**
 * Check if URL already has Cloudinary transformations
 */
export function hasTransformations(url: string): boolean {
  if (!url || !isCloudinaryUrl(url)) {
    return false
  }
  const uploadIndex = url.indexOf('/image/upload/')
  if (uploadIndex === -1) {
    return false
  }
  const afterUpload = url.substring(uploadIndex + '/image/upload/'.length)
  // Check if the next segment starts with a transformation (q_, f_, w_, h_, etc.)
  // or a version number (v followed by digits)
  const firstSlash = afterUpload.indexOf('/')
  if (firstSlash === -1) {
    return false
  }
  const segment = afterUpload.substring(0, firstSlash)
  // If segment doesn't start with 'v' followed by digits, it's likely a transformation
  return !/^v\d+/.test(segment)
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

  // If URL already has transformations, return it as-is to avoid corruption
  if (hasTransformations(url)) {
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
    width: VU_IMAGE_SIZES.TINY, // VU-based tiny size for instant loading
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
 *
 * @param url - Image URL
 * @param size - Size preset: 'TINY' | 'SMALL' | 'PREVIEW' | 'NORMAL' | 'LARGE' | custom number
 */
export function getThumbnailImageUrl(
  url: string,
  size: keyof typeof VU_IMAGE_SIZES | number = 'PREVIEW'
): string {
  if (!url || !isCloudinaryUrl(url)) {
    return url
  }

  // Convert size preset to actual pixel value
  const width = typeof size === 'string' ? VU_IMAGE_SIZES[size] : size

  return getOptimizedImageUrl(url, {
    quality: 'auto',
    format: 'auto',
    width,
  })
}

/**
 * Prefetch an image (load it in background)
 */
export function prefetchImage(url: string): void {
  if (!url) {return}

  const img = new Image()
  img.src = url
}

/**
 * Prefetch multiple images
 */
export function prefetchImages(urls: string[], maxConcurrent: number = 3): void {
  let index = 0

  function loadNext() {
    if (index >= urls.length) {return}

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

/**
 * Add cache-busting parameter to image URL
 * Works with both Cloudinary and non-Cloudinary URLs
 * For Cloudinary URLs, adds query parameter at the end
 * For non-Cloudinary URLs, also uses query parameter
 */
export function addCacheBust(url: string, version?: number): string {
  if (!url || !version) {
    return url
  }
  // Use query parameter for cache busting - this works with any URL
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${version}`
}
