import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

interface UseVirtualizedListOptions {
  itemCount: number
  itemHeight: number
  overscan?: number // Number of items to render outside visible area
  containerHeight?: number
}

interface VirtualizedListResult {
  visibleItems: { index: number; style: React.CSSProperties }[]
  containerRef: React.RefObject<HTMLDivElement | null>
  totalHeight: number
  scrollToIndex: (index: number) => void
  visibleRange: { start: number; end: number }
}

/**
 * Hook for virtualizing a list of items
 * Only renders items that are visible + overscan buffer
 */
export function useVirtualizedList({
  itemCount,
  itemHeight,
  overscan = 5,
  containerHeight: fixedContainerHeight
}: UseVirtualizedListOptions): VirtualizedListResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(fixedContainerHeight || 600)

  // Update container height on mount and resize
  useEffect(() => {
    if (fixedContainerHeight) {
      setContainerHeight(fixedContainerHeight)
      return
    }

    const container = containerRef.current
    if (!container) return

    const updateHeight = () => {
      setContainerHeight(container.clientHeight)
    }

    updateHeight()

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [fixedContainerHeight])

  // Handle scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      setScrollTop(container.scrollTop)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Calculate visible range
  const { visibleItems, visibleRange } = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endIndex = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )

    const items: { index: number; style: React.CSSProperties }[] = []
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        style: {
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight
        }
      })
    }

    return {
      visibleItems: items,
      visibleRange: { start: startIndex, end: endIndex }
    }
  }, [scrollTop, containerHeight, itemCount, itemHeight, overscan])

  const totalHeight = itemCount * itemHeight

  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current
    if (!container) return

    const targetScroll = index * itemHeight
    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
  }, [itemHeight])

  return {
    visibleItems,
    containerRef,
    totalHeight,
    scrollToIndex,
    visibleRange
  }
}

/**
 * Simpler hook that just tracks which items are visible
 * For use with existing table structure
 */
export function useVisibleItems(itemCount: number): {
  isVisible: (index: number) => boolean
  visibleRange: { start: number; end: number }
  setVisibleRange: (start: number, end: number) => void
} {
  const [range, setRange] = useState({ start: 0, end: Math.min(50, itemCount) })

  const isVisible = useCallback(
    (index: number) => index >= range.start && index <= range.end,
    [range]
  )

  const setVisibleRange = useCallback((start: number, end: number) => {
    setRange({ start, end })
  }, [])

  return { isVisible, visibleRange: range, setVisibleRange }
}
