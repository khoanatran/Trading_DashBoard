import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TradeImage,
  TradeVideo,
  TradeJournalBatchEntry,
  fetchImagesWithCache,
  fetchVideosWithCache,
  fetchTagsWithCache,
  getCachedImages,
  getCachedVideos,
  getCachedTags,
  setCachedImages,
  setCachedVideos,
  setCachedTags,
  invalidateImageCache,
  invalidateVideoCache,
  invalidateTagCache,
  fetchBatchMedia
} from '@/utils/mediaCache'

interface UseLazyMediaOptions {
  tradeIds: string[]
  batchSize?: number // How many trades to fetch at once
  prefetchBuffer?: number // How many trades ahead to prefetch
}

interface UseLazyMediaResult {
  images: Record<string, TradeImage[]>
  videos: Record<string, TradeVideo[]>
  tags: Record<string, string[]>
  journal: Record<string, TradeJournalBatchEntry>
  isLoading: boolean
  loadForTrade: (tradeId: string) => Promise<void>
  loadBatch: (tradeIds: string[]) => Promise<{ journal: Record<string, TradeJournalBatchEntry> }>
  invalidateTrade: (tradeId: string) => void
  updateImages: (tradeId: string, images: TradeImage[]) => void
  updateVideos: (tradeId: string, videos: TradeVideo[]) => void
  updateTags: (tradeId: string, tags: string[]) => void
}

/**
 * Hook for lazy loading and caching trade media
 * Uses Intersection Observer internally to load only what's needed
 */
export function useLazyMedia({
  tradeIds,
  batchSize = 20,
  prefetchBuffer = 10
}: UseLazyMediaOptions): UseLazyMediaResult {
  const [images, setImages] = useState<Record<string, TradeImage[]>>({})
  const [videos, setVideos] = useState<Record<string, TradeVideo[]>>({})
  const [tags, setTags] = useState<Record<string, string[]>>({})
  const [journal, setJournal] = useState<Record<string, TradeJournalBatchEntry>>({})
  const [isLoading, setIsLoading] = useState(false)
  const loadedTradeIds = useRef<Set<string>>(new Set())

  // Load media for a single trade
  const loadForTrade = useCallback(async (tradeId: string) => {
    // Skip if already loaded
    if (loadedTradeIds.current.has(tradeId)) {
      // Check cache for updates
      const cachedImages = getCachedImages(tradeId)
      const cachedVideos = getCachedVideos(tradeId)
      const cachedTags = getCachedTags(tradeId)
      
      if (cachedImages) setImages(prev => ({ ...prev, [tradeId]: cachedImages }))
      if (cachedVideos) setVideos(prev => ({ ...prev, [tradeId]: cachedVideos }))
      if (cachedTags) setTags(prev => ({ ...prev, [tradeId]: cachedTags }))
      return
    }

    loadedTradeIds.current.add(tradeId)

    try {
      const [tradeImages, tradeVideos, tradeTags] = await Promise.all([
        fetchImagesWithCache(tradeId),
        fetchVideosWithCache(tradeId),
        fetchTagsWithCache(tradeId)
      ])

      setImages(prev => ({ ...prev, [tradeId]: tradeImages }))
      setVideos(prev => ({ ...prev, [tradeId]: tradeVideos }))
      setTags(prev => ({ ...prev, [tradeId]: tradeTags }))
    } catch (err) {
      console.error('Failed to load media for trade:', tradeId, err)
    }
  }, [])

  // Load media for multiple trades at once using batch API
  const loadBatch = useCallback(async (batchTradeIds: string[]) => {
    // Filter out already loaded trades
    const toLoad = batchTradeIds.filter(id => !loadedTradeIds.current.has(id))
    if (toLoad.length === 0) return { journal: {} }

    setIsLoading(true)

    try {
      const result = await fetchBatchMedia(toLoad)

      // Mark as loaded
      toLoad.forEach(id => loadedTradeIds.current.add(id))

      // Update state
      setImages(prev => ({ ...prev, ...result.images }))
      setVideos(prev => ({ ...prev, ...result.videos }))
      setTags(prev => ({ ...prev, ...result.tags }))
      setJournal(prev => ({ ...prev, ...result.journal }))
      return { journal: result.journal }
    } catch (err) {
      console.error('Failed to load batch media:', err)
      return { journal: {} }
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load - load first batch
  useEffect(() => {
    if (tradeIds.length > 0) {
      const initialBatch = tradeIds.slice(0, batchSize)
      loadBatch(initialBatch)
    }
  }, [tradeIds, batchSize, loadBatch])

  // Invalidate cache for a trade
  const invalidateTrade = useCallback((tradeId: string) => {
    loadedTradeIds.current.delete(tradeId)
    invalidateImageCache(tradeId)
    invalidateVideoCache(tradeId)
    invalidateTagCache(tradeId)
  }, [])

  // Manual cache updates (for after uploads/edits)
  const updateImages = useCallback((tradeId: string, newImages: TradeImage[]) => {
    setCachedImages(tradeId, newImages)
    setImages(prev => ({ ...prev, [tradeId]: newImages }))
  }, [])

  const updateVideos = useCallback((tradeId: string, newVideos: TradeVideo[]) => {
    setCachedVideos(tradeId, newVideos)
    setVideos(prev => ({ ...prev, [tradeId]: newVideos }))
  }, [])

  const updateTags = useCallback((tradeId: string, newTags: string[]) => {
    setCachedTags(tradeId, newTags)
    setTags(prev => ({ ...prev, [tradeId]: newTags }))
  }, [])

  return {
    images,
    videos,
    tags,
    journal,
    isLoading,
    loadForTrade,
    loadBatch,
    invalidateTrade,
    updateImages,
    updateVideos,
    updateTags
  }
}

/**
 * Hook for observing when an element becomes visible
 * Used for lazy loading individual trade rows
 */
export function useIntersectionObserver(
  callback: (isVisible: boolean) => void,
  options?: IntersectionObserverInit
): React.RefObject<HTMLElement | null> {
  const elementRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          callback(entry.isIntersecting)
        })
      },
      { rootMargin: '100px', threshold: 0, ...options }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [callback, options])

  return elementRef
}

/**
 * Simpler hook that loads media when element becomes visible
 */
export function useLazyLoadOnVisible(
  tradeId: string,
  loadFn: (tradeId: string) => Promise<void>
): React.RefObject<HTMLTableRowElement | null> {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const hasLoaded = useRef(false)

  useEffect(() => {
    const element = rowRef.current
    if (!element || hasLoaded.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasLoaded.current) {
          hasLoaded.current = true
          loadFn(tradeId)
          observer.disconnect()
        }
      },
      { rootMargin: '200px', threshold: 0 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [tradeId, loadFn])

  return rowRef
}
