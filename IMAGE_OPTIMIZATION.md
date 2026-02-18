# Image Optimization with Cloudinary

## Overview

This project uses Cloudinary CDN for image hosting. Several optimizations have been implemented to improve loading performance.

## Implemented Optimizations

### 1. Automatic Format & Quality Optimization

All Cloudinary images now use:
- `q_auto` - Automatic quality optimization
- `f_auto` - Automatic format selection (WebP/AVIF for modern browsers)

**Before:**
```
https://res.cloudinary.com/dxxh6meej/image/upload/v1763253319/card.png
```

**After:**
```
https://res.cloudinary.com/dxxh6meej/image/upload/q_auto,f_auto/v1763253319/card.png
```

### 2. Size-Specific Optimization

Status icons are optimized with a smaller size (64px width):
```typescript
getOptimizedImageUrl(url, { width: 64 })
```

### 3. Automatic Retry Mechanism (NEW)

Images that fail to load automatically retry with exponential backoff:
- **Max retries:** 3 for card images, 2 for status icons
- **Backoff strategy:** 1s → 2s → 4s (capped at 5s)
- **Fallback:** Shows styled text placeholder when all retries fail
- **State tracking:** Uses global `ImageLoader` class to track load attempts

### 4. Loading States

Visual feedback during image loading:
- `loading` - Image is transparent until loaded (smooth fade-in)
- `loaded` - Fully visible with opacity transition
- `failed` - Shows gradient background with card name and power

## Files Created/Modified

### New Files:
- `client/utils/imageOptimization.ts` - Utility functions for Cloudinary URL optimization
- `client/components/ProgressiveImage.tsx` - Progressive image component (for future use)
- `client/utils/imageLoader.ts` - Image loading utilities with retry mechanism

### Modified Files:
- `client/components/Card.tsx` - Applied optimization to card images and status icons, integrated retry mechanism

## Additional Optimizations (Future)

### Progressive Loading (not yet implemented)

For even faster perceived loading, progressive loading can be added:

1. Load low-quality blurry placeholder instantly
2. Fade in full-quality image when loaded

This is implemented in `ProgressiveImage.tsx` but not yet integrated.

### Prefetching

The `imageOptimization.ts` utility includes prefetching functions:

```typescript
// Prefetch a single image
prefetchImage(url)

// Prefetch multiple images with concurrency limit
prefetchImages([url1, url2, url3], 3)
```

This can be used to preload cards during opponent's turn.

## Cloudinary Transformations Reference

### Quality Options
- `q_auto` - Automatic quality (recommended)
- `q_10` to `q_100` - Specific quality (lower = smaller file)

### Format Options
- `f_auto` - Best format for browser (WebP, AVIF)
- `f_webp`, `f_avif`, `f_jpg`, `f_png` - Specific format

### Size Options
- `w_200` - Width 200px
- `h_200` - Height 200px
- `w_200,h_200` - Both dimensions

### Effects
- `e_blur:2000` - Heavy blur (for placeholders)
- `e_grayscale` - Grayscale
- `e_brightness:-20` - Darken

## Performance Impact

Expected improvements:
- **30-50% smaller file sizes** with WebP/AVIF
- **20-30% faster loading** with q_auto
- **Instant visual feedback** with progressive loading (when implemented)
