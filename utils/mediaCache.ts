/**
 * Media Cache Utility
 * Provides in-memory caching for trade images, videos, and tags
 * with TTL-based expiration and batch loading support
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

export interface TradeImage {
  name: string
  url: string
  note: string
  drawings?: DrawingStroke[]
  section?: 'before' | 'after'
}

export interface DrawingStroke {
  points: { x: number; y: number }[]
  color: string
  size: number
  tool: 'pen' | 'highlighter' | 'eraser'
}

export interface TradeVideo {
  id: string
  originalName: string
  mp4FileName: string
  thumbFileName?: string
  durationSec?: number
  clipStartSec?: number
  clipEndSec?: number
  createdAt: string
  url: string
  thumbUrl: string | null
}

// Cache stores
const imageCache = new Map<string, CacheEntry<TradeImage[]>>()
const videoCache = new Map<string, CacheEntry<TradeVideo[]>>()
const tagCache = new Map<string, CacheEntry<string[]>>()

// Default TTL: 5 minutes
const DEFAULT_TTL = 5 * 60 * 1000

// Track ongoing fetch requests to prevent duplicate calls
const pendingImageFetches = new Map<string, Promise<TradeImage[]>>()
const pendingVideoFetches = new Map<string, Promise<TradeVideo[]>>()
const pendingTagFetches = new Map<string, Promise<string[]>>()
const pendingBatchFetch: { promise: Promise<void> | null; tradeIds: Set<string> } = { 
  promise: null, 
  tradeIds: new Set() 
}

function isExpired<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) return true
  return Date.now() - entry.timestamp > entry.ttl
}

// ===== IMAGES =====

export function getCachedImages(tradeId: string): TradeImage[] | null {
  const entry = imageCache.get(tradeId)
  if (isExpired(entry)) {
    imageCache.delete(tradeId)
    return null
  }
  return entry!.data
}

export function setCachedImages(tradeId: string, images: TradeImage[], ttl = DEFAULT_TTL): void {
  imageCache.set(tradeId, { data: images, timestamp: Date.now(), ttl })
}

export async function fetchImagesWithCache(tradeId: string): Promise<TradeImage[]> {
  // Check cache first
  const cached = getCachedImages(tradeId)
  if (cached !== null) return cached

  // Check for pending request
  const pending = pendingImageFetches.get(tradeId)
  if (pending) return pending

  // Make new request
  const fetchPromise = (async () => {
    try {
      const res = await fetch(`/api/trade-images?tradeId=${encodeURIComponent(tradeId)}`)
      if (res.ok) {
        const data = await res.json()
        const images = data.images || []
        setCachedImages(tradeId, images)
        return images
      }
      return []
    } catch (err) {
      console.error('Failed to fetch images for trade:', tradeId, err)
      return []
    } finally {
      pendingImageFetches.delete(tradeId)
    }
  })()

  pendingImageFetches.set(tradeId, fetchPromise)
  return fetchPromise
}

export function invalidateImageCache(tradeId: string): void {
  imageCache.delete(tradeId)
}

// ===== VIDEOS =====

export function getCachedVideos(tradeId: string): TradeVideo[] | null {
  const entry = videoCache.get(tradeId)
  if (isExpired(entry)) {
    videoCache.delete(tradeId)
    return null
  }
  return entry!.data
}

export function setCachedVideos(tradeId: string, videos: TradeVideo[], ttl = DEFAULT_TTL): void {
  videoCache.set(tradeId, { data: videos, timestamp: Date.now(), ttl })
}

export async function fetchVideosWithCache(tradeId: string): Promise<TradeVideo[]> {
  // Check cache first
  const cached = getCachedVideos(tradeId)
  if (cached !== null) return cached

  // Check for pending request
  const pending = pendingVideoFetches.get(tradeId)
  if (pending) return pending

  // Make new request
  const fetchPromise = (async () => {
    try {
      const res = await fetch(`/api/trade-videos?tradeId=${encodeURIComponent(tradeId)}`)
      if (res.ok) {
        const data = await res.json()
        const videos = data.videos || []
        setCachedVideos(tradeId, videos)
        return videos
      }
      return []
    } catch (err) {
      console.error('Failed to fetch videos for trade:', tradeId, err)
      return []
    } finally {
      pendingVideoFetches.delete(tradeId)
    }
  })()

  pendingVideoFetches.set(tradeId, fetchPromise)
  return fetchPromise
}

export function invalidateVideoCache(tradeId: string): void {
  videoCache.delete(tradeId)
}

// ===== TAGS =====

export function getCachedTags(tradeId: string): string[] | null {
  const entry = tagCache.get(tradeId)
  if (isExpired(entry)) {
    tagCache.delete(tradeId)
    return null
  }
  return entry!.data
}

export function setCachedTags(tradeId: string, tags: string[], ttl = DEFAULT_TTL): void {
  tagCache.set(tradeId, { data: tags, timestamp: Date.now(), ttl })
}

export async function fetchTagsWithCache(tradeId: string): Promise<string[]> {
  // Check cache first
  const cached = getCachedTags(tradeId)
  if (cached !== null) return cached

  // Check for pending request
  const pending = pendingTagFetches.get(tradeId)
  if (pending) return pending

  // Make new request
  const fetchPromise = (async () => {
    try {
      const res = await fetch(`/api/trade-tags?tradeId=${encodeURIComponent(tradeId)}`)
      if (res.ok) {
        const data = await res.json()
        const tags = data.tags || []
        setCachedTags(tradeId, tags)
        return tags
      }
      return []
    } catch (err) {
      console.error('Failed to fetch tags for trade:', tradeId, err)
      return []
    } finally {
      pendingTagFetches.delete(tradeId)
    }
  })()

  pendingTagFetches.set(tradeId, fetchPromise)
  return fetchPromise
}

export function invalidateTagCache(tradeId: string): void {
  tagCache.delete(tradeId)
}

// ===== BATCH LOADING =====

export interface TradeJournalBatchEntry {
  note: string
  setupTags: string[]
  rating: number
  ratingManual?: boolean
}

export interface BatchMediaResult {
  images: Record<string, TradeImage[]>
  videos: Record<string, TradeVideo[]>
  tags: Record<string, string[]>
  journal: Record<string, TradeJournalBatchEntry>
}

/**
 * Fetch all media (images, videos, tags) for multiple trades in a single batch request
 * Uses debouncing to combine multiple calls into one
 */
export async function fetchBatchMedia(tradeIds: string[]): Promise<BatchMediaResult> {
  // Filter out trades that already have cached data
  const uncachedIds = tradeIds.filter(id => {
    const hasImages = getCachedImages(id) !== null
    const hasVideos = getCachedVideos(id) !== null
    const hasTags = getCachedTags(id) !== null
    return !hasImages || !hasVideos || !hasTags
  })

  if (uncachedIds.length === 0) {
    // Return from cache
    return {
      images: Object.fromEntries(tradeIds.map(id => [id, getCachedImages(id) || []])),
      videos: Object.fromEntries(tradeIds.map(id => [id, getCachedVideos(id) || []])),
      tags: Object.fromEntries(tradeIds.map(id => [id, getCachedTags(id) || []])),
      journal: {},
    }
  }

  try {
    const res = await fetch('/api/trade-media/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeIds: uncachedIds })
    })

    if (res.ok) {
      const data = await res.json()
      
      // Update caches
      for (const tradeId of uncachedIds) {
        setCachedImages(tradeId, data.images[tradeId] || [])
        setCachedVideos(tradeId, data.videos[tradeId] || [])
        setCachedTags(tradeId, data.tags[tradeId] || [])
      }

      return {
        images: Object.fromEntries(tradeIds.map(id => [id, getCachedImages(id) || []])),
        videos: Object.fromEntries(tradeIds.map(id => [id, getCachedVideos(id) || []])),
        tags: Object.fromEntries(tradeIds.map(id => [id, getCachedTags(id) || []])),
        journal: data.journal || {},
      }
    }
  } catch (err) {
    console.error('Batch fetch failed:', err)
  }

  // Fallback to cached data
  return {
    images: Object.fromEntries(tradeIds.map(id => [id, getCachedImages(id) || []])),
    videos: Object.fromEntries(tradeIds.map(id => [id, getCachedVideos(id) || []])),
    tags: Object.fromEntries(tradeIds.map(id => [id, getCachedTags(id) || []])),
    journal: {},
  }
}

// ===== CACHE MANAGEMENT =====

export function clearAllCaches(): void {
  imageCache.clear()
  videoCache.clear()
  tagCache.clear()
}

export function getCacheStats(): { images: number; videos: number; tags: number } {
  return {
    images: imageCache.size,
    videos: videoCache.size,
    tags: tagCache.size
  }
}
