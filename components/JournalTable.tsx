'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Trade, PartialExit, parseLocalTimestamp, getTradeId, getTradeRMultiple, getPartialExitRMultiple, getTradeDollarRisk, getTradeResult, buildDailyEquityCurve, getTradeCloseAt } from '@/utils/logParser'
import { findMissingTradingDays, formatDateKey, dateKeyToLabel, isWeekend, getTradingDaysBetween, DateRange as MissingDateRange } from '@/utils/tradingDays'
import { formatUsd, formatUsdPnl, formatUsdPnlOrNa } from '@/lib/format'
import { ImagePlus, X, Trash2, ZoomIn, ZoomOut, RotateCcw, Pen, Eraser, Undo2, Trash, Circle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, StickyNote, ArrowUp, ArrowDown, ArrowUpDown, Tag, Plus, Video, Play, Pause, Scissors, Save, Film, BookOpen, Edit3, Star, Flag } from 'lucide-react'
import WeeklyNoteModal from './WeeklyNoteModal'
import DailyEquityCurveChart from './DailyEquityCurveChart'
import { FitImageViewer, FitVideoViewer } from '@/components/FitImage'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays, getISOWeek, getISOWeekYear } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE, formatWallClockTimeOnly } from '@/lib/timezone'
import {
  imagesForTradeSection,
  normalizeTradeImageSection,
  swapSectionImageOrder,
  tradeImageSectionLabel,
  type TradeImageSection,
} from '@/lib/trade-images'
import { useLazyMedia } from '@/hooks/useLazyMedia'
import { patchTradeJournal } from '@/lib/trade-journal'
import type { TradeJournalBatchEntry } from '@/utils/mediaCache'
import { SETUP_RATING_TAGS, SETUP_TAG_NAMES, countSetupTagRating } from '@/lib/setup-tags'
type SortColumn = 'date' | 'result' | 'direction' | 'rr' | 'pnl'
type SortDirection = 'asc' | 'desc'

// Format price with commas (e.g., 25720.75 -> 25,720.75)
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return 'N/A'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatJournalTradeTime(trade: Trade): string {
  const source = trade.entryTime ?? trade.timestamp
  if (source) return formatWallClockTimeOnly(source)
  return 'N/A'
}

/** ET close-date key — matches calendar and day view grouping. */
function getJournalTradeDayKey(trade: Trade): string | null {
  const closeAt = getTradeCloseAt(trade)
  const fallback = trade.timestamp ? parseLocalTimestamp(trade.timestamp) : null
  const date = closeAt ?? fallback
  if (!date) return null
  return formatDateKey(date)
}

export { SETUP_RATING_TAGS } from '@/lib/setup-tags'

function formatTradeRatingLabel(rating: number): string {
  return Number.isInteger(rating) ? `${rating}` : rating.toFixed(1)
}

// Star Rating Component with half-star increments
function StarRating({ 
  rating, 
  onRatingChange,
  size = 16,
  readOnly = false,
}: { 
  rating: number
  onRatingChange: (rating: number) => void
  size?: number
  readOnly?: boolean
}) {
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  
  const displayRating = hoverRating !== null ? hoverRating : rating
  
  // Calculate click position within star for half-star increments
  const handleStarClick = (starIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const isLeftHalf = clickX < rect.width / 2
    const newRating = starIndex + (isLeftHalf ? 0.5 : 1)
    // Toggle off if clicking the same rating
    onRatingChange(newRating === rating ? 0 : newRating)
  }
  
  const handleStarHover = (starIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const hoverX = event.clientX - rect.left
    const isLeftHalf = hoverX < rect.width / 2
    setHoverRating(starIndex + (isLeftHalf ? 0.5 : 1))
  }
  
  return (
    <div 
      className="flex items-center gap-0.5" 
      onMouseLeave={() => setHoverRating(null)}
    >
      {[0, 1, 2, 3, 4].map((starIndex) => {
        const fillAmount = Math.max(0, Math.min(1, displayRating - starIndex))
        
        return (
          <div
            key={starIndex}
            className={`relative ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
            style={{ width: size, height: size }}
            onClick={readOnly ? undefined : (e) => handleStarClick(starIndex, e)}
            onMouseMove={readOnly ? undefined : (e) => handleStarHover(starIndex, e)}
          >
            {/* Background (empty) star */}
            <Star 
              className="absolute text-gray-500" 
              size={size}
              strokeWidth={1.5}
            />
            {/* Filled star with clip for partial fill */}
            <div 
              className="absolute overflow-hidden"
              style={{ width: `${fillAmount * 100}%` }}
            >
              <Star 
                className="text-amber-400 fill-amber-400" 
                size={size}
                strokeWidth={1.5}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Predefined tags with colors (exported for use in filter dropdowns)
export const AVAILABLE_TAGS = [
  // Positive outcomes
  { name: 'Good TP', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { name: 'A+ Setup', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { name: 'A setup', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { name: 'B setup', color: 'bg-lime-500/20 text-lime-400 border-lime-500/30' },
  { name: 'Good Re-entry', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  { name: 'Stat Loss', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { name: 'Good BE', color: 'bg-lime-500/20 text-lime-400 border-lime-500/30' },
  { name: 'Suppose to Win', color: 'bg-lime-500/20 text-lime-400 border-lime-500/30' },
  
  // Negative outcomes
  { name: 'Mistake', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Bad Reentry', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Bad SL Placement', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Revenge Trading', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Random', color: 'bg-red-600/20 text-red-300 border-red-600/30' },
  { name: 'Early Exit', color: 'bg-amber-600/20 text-amber-300 border-amber-500/30' },

  // Market conditions
  { name: 'Hard Case', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { name: 'Nuance', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { name: 'Choppy Market', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  { name: 'Rollover Week', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  { name: 'News Event', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  
  // Volume profile zones
  { name: 'Thin Zone', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  { name: 'LVN Only', color: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  { name: 'Stuck 2 LVN', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Sudden LVN', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { name: 'Heatmap Only', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  {
    name: 'Recent Heatmap Trigger',
    color: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  { name: '6H+ Heatmap Trigger', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
]

/** Same tags as the trade tag picker — used for tag filter on Journal and Overview. */
export const FILTERABLE_TAGS = AVAILABLE_TAGS

export type TagFilterMode = 'inclusion' | 'exclusion'

/** No tag filter applied — show all trades. */
export function isTagFilterClear(_mode: TagFilterMode, selectedTags: string[]): boolean {
  return selectedTags.length === 0
}

/** Whether a tag chip appears selected in the filter bar. */
export function isTagFilterChipActive(
  mode: TagFilterMode,
  tagName: string,
  selectedTags: string[]
): boolean {
  if (mode === 'exclusion') {
    return selectedTags.length === 0 || !selectedTags.includes(tagName)
  }
  return selectedTags.includes(tagName)
}

export function tradePassesTagFilter(
  trade: Trade,
  mode: TagFilterMode,
  selectedTags: string[],
  tradeTags: Record<string, string[]>
): boolean {
  if (selectedTags.length === 0) return true
  const tags = tradeTags[getTradeId(trade)] ?? []
  if (mode === 'exclusion') {
    return !tags.some(tag => selectedTags.includes(tag))
  }
  return selectedTags.some(selected => tags.includes(selected))
}

interface TagFilterBarProps {
  mode: TagFilterMode
  setMode: React.Dispatch<React.SetStateAction<TagFilterMode>>
  selectedTags: string[]
  setSelectedTags: React.Dispatch<React.SetStateAction<string[]>>
  ringOffsetClass?: string
  className?: string
}

export function TagFilterBar({
  mode,
  setMode,
  selectedTags,
  setSelectedTags,
  ringOffsetClass = 'ring-offset-background',
  className = 'mb-6',
}: TagFilterBarProps) {
  const isClear = isTagFilterClear(mode, selectedTags)

  const handleModeChange = (nextMode: TagFilterMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    setSelectedTags([])
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <span className="text-sm text-muted-foreground">Filter by tags:</span>
      <div
        className="inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-xs"
        role="group"
        aria-label="Tag filter mode"
      >
        <button
          type="button"
          onClick={() => handleModeChange('inclusion')}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            mode === 'inclusion'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Include
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('exclusion')}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            mode === 'exclusion'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Exclude
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setSelectedTags([])}
          className={`px-2 py-0.5 rounded-full text-xs border transition-all ${
            isClear
              ? `ring-2 ring-blue-400 ring-offset-1 ${ringOffsetClass} bg-muted`
              : 'bg-muted/50 opacity-70 hover:opacity-100'
          }`}
        >
          All
        </button>
        {FILTERABLE_TAGS.map(tag => {
          const isActive = isTagFilterChipActive(mode, tag.name, selectedTags)
          return (
            <button
              key={tag.name}
              type="button"
              onClick={() => {
                if (mode === 'exclusion') {
                  if (isActive) {
                    setSelectedTags(prev => [...prev, tag.name])
                  } else {
                    setSelectedTags(prev => prev.filter(t => t !== tag.name))
                  }
                } else if (isActive) {
                  setSelectedTags(prev => prev.filter(t => t !== tag.name))
                } else {
                  setSelectedTags(prev => [...prev, tag.name])
                }
              }}
              className={`px-2 py-0.5 rounded-full text-xs border transition-all ${
                isActive
                  ? `${tag.color} ring-2 ring-blue-400 ring-offset-1 ${ringOffsetClass}`
                  : `${tag.color} opacity-50 hover:opacity-100`
              }`}
            >
              {tag.name}
            </button>
          )
        })}
        {!isClear && (
          <button
            type="button"
            onClick={() => setSelectedTags([])}
            className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"
          >
            Clear
          </button>
        )}
      </div>
      <span className="text-xs text-muted-foreground w-full sm:w-auto">
        {mode === 'exclusion'
          ? 'All tags highlighted — click to exclude trades with that tag.'
          : 'Click tags to show only trades that have at least one selected tag.'}
      </span>
    </div>
  )
}

export function FlagFilterBar({
  showFlaggedOnly,
  setShowFlaggedOnly,
  flaggedCount,
  ringOffsetClass = 'ring-offset-background',
  className,
}: {
  showFlaggedOnly: boolean
  setShowFlaggedOnly: React.Dispatch<React.SetStateAction<boolean>>
  flaggedCount: number
  ringOffsetClass?: string
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setShowFlaggedOnly(prev => !prev)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
          showFlaggedOnly
            ? `bg-amber-500/20 border-amber-500/50 text-amber-400 ring-2 ring-amber-500/40 ${ringOffsetClass}`
            : 'border-border text-muted-foreground hover:text-foreground hover:border-amber-500/30'
        }`}
        aria-pressed={showFlaggedOnly}
      >
        <Flag className={`h-3.5 w-3.5 ${showFlaggedOnly ? 'fill-current' : ''}`} />
        Flagged only
        {flaggedCount > 0 && <span className="tabular-nums">({flaggedCount})</span>}
      </button>
    </div>
  )
}

const getTagStyle = (tagName: string) => {
  const tag = AVAILABLE_TAGS.find(t => t.name === tagName)
  return tag?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
}

interface JournalTableProps {
  trades: Trade[]
  darkMode: boolean
  onTradeTagsChange?: (tags: Record<string, string[]>) => void
  /** Trade IDs flagged for review (calendar day or per-trade). */
  flaggedTrades?: Record<string, boolean>
  onToggleTradeFlag?: (tradeId: string, flagged: boolean) => void
  /** Tag filter mode and selection. When provided, filtering is done at page level. */
  tagFilterMode?: TagFilterMode
  setTagFilterMode?: React.Dispatch<React.SetStateAction<TagFilterMode>>
  tagFilterTags?: string[]
  setTagFilterTags?: React.Dispatch<React.SetStateAction<string[]>>
  /** Timeline / drawdown: full journal table without missing days, week recaps, or page chrome. */
  embedded?: boolean
  embeddedTitle?: string
  /** Keep trades in input order (e.g. equity-curve sequence). */
  preserveTradeOrder?: boolean
  /** Include Saturday/Sunday trades (Timeline lists). */
  includeWeekends?: boolean
  /** Optional equity-curve trade # per row (drawdown recap). */
  equityIndexByTradeId?: Record<string, number>
  /** Pre-select a session day (e.g. from calendar / day view). */
  focusDayKey?: string | null
  /** Timeline daily recap: notify parent when a trade row is selected. */
  onHighlightedTradeChange?: (tradeId: string | null) => void
}

interface TradeImage {
  name: string
  url: string
  note: string
  drawings?: DrawingStroke[]
  section?: TradeImageSection
}

function imagesForSection(images: TradeImage[], section: TradeImageSection): TradeImage[] {
  return imagesForTradeSection(images, section)
}

function globalImageIndex(images: TradeImage[], section: TradeImageSection, localIndex: number): number {
  const sectionImages = imagesForSection(images, section)
  const target = sectionImages[localIndex]
  if (!target) return 0
  const idx = images.findIndex(img => img.name === target.name)
  return idx >= 0 ? idx : 0
}

interface DrawingPoint {
  x: number
  y: number
}

interface DrawingStroke {
  points: DrawingPoint[]
  color: string
  size: number
  tool: 'pen' | 'highlighter' | 'eraser'
}

interface TradeVideo {
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

export default function JournalTable({
  trades,
  darkMode,
  onTradeTagsChange,
  flaggedTrades = {},
  onToggleTradeFlag,
  tagFilterMode: tagFilterModeProp,
  setTagFilterMode: setTagFilterModeProp,
  tagFilterTags: tagFilterTagsProp,
  setTagFilterTags: setTagFilterTagsProp,
  embedded = false,
  embeddedTitle,
  preserveTradeOrder = false,
  includeWeekends = false,
  equityIndexByTradeId,
  focusDayKey,
  onHighlightedTradeChange,
}: JournalTableProps) {
  // Sort state
  const [sortColumn, setSortColumn] = useState<SortColumn>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  
  // Tag filter: use shared from props when provided, otherwise local state (so both tabs stay in sync when props passed)
  const [tagFilterModeLocal, setTagFilterModeLocal] = useState<TagFilterMode>('exclusion')
  const [tagFilterTagsLocal, setTagFilterTagsLocal] = useState<string[]>([])
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false)
  const tagFilterMode = tagFilterModeProp ?? tagFilterModeLocal
  const setTagFilterMode = setTagFilterModeProp ?? setTagFilterModeLocal
  const tagFilterTags = tagFilterTagsProp ?? tagFilterTagsLocal
  const setTagFilterTags = setTagFilterTagsProp ?? setTagFilterTagsLocal
  const [expandedTagRows, setExpandedTagRows] = useState<Set<string>>(new Set())
  
  // Track which row was last interacted with (for highlighting)
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null)
  /** When set, equity curve is scoped to this session day (trade or date click). */
  const [equityCurveDayKey, setEquityCurveDayKey] = useState<string | null>(null)
  const [collapsedDayKeys, setCollapsedDayKeys] = useState<Set<string>>(new Set())
  const dailyChartRef = useRef<HTMLDivElement>(null)

  const toggleDayCollapse = useCallback((dateKey: string) => {
    setCollapsedDayKeys(prev => {
      const next = new Set(prev)
      if (next.has(dateKey)) next.delete(dateKey)
      else next.add(dateKey)
      return next
    })
  }, [])

  useEffect(() => {
    onHighlightedTradeChange?.(highlightedRowId)
  }, [highlightedRowId, onHighlightedTradeChange])
  
  // State for expanded missing day ranges (collapsed by default for 3+ consecutive days)
  const [expandedMissingRanges, setExpandedMissingRanges] = useState<Set<string>>(new Set())
  
  // Weekly notes state
  const [weeklyNotes, setWeeklyNotes] = useState<Record<string, { content: string; updatedAt: string }>>({})
  const [editingWeekKey, setEditingWeekKey] = useState<string | null>(null)
  
  // Use trades directly (period/result filtered from page; tag filter applied below)
  const periodFilteredTrades = trades

  // Toggle sort
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc')
    }
  }
  
  // Render sort indicator
  const renderSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" />
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3 text-blue-400" /> 
      : <ArrowDown className="h-3 w-3 text-blue-400" />
  }
  
  // Get the sourceFile from the first trade (for making missing day IDs unique per file)
  const sourceFile = useMemo(() => {
    const tradeWithSource = trades.find(t => t.sourceFile)
    return tradeWithSource?.sourceFile || 'unknown'
  }, [trades])
  
  // Calculate missing trading days first (needed for allTradeIds)
  const missingDaysForIds = useMemo(() => {
    // Use the same filtering logic but on trades directly
    const tradeDates = new Set<string>()
    let earliestDate: Date | null = null
    let latestDate: Date | null = null
    
    trades.forEach(trade => {
      if (!trade.timestamp) return
      const tradeDate = parseLocalTimestamp(trade.timestamp)
      if (isWeekend(tradeDate)) return
      const dateKey = formatDateKey(tradeDate)
      tradeDates.add(dateKey)
      
      if (!earliestDate || tradeDate < earliestDate) {
        earliestDate = tradeDate
      }
      if (!latestDate || tradeDate > latestDate) {
        latestDate = tradeDate
      }
    })
    
    if (!earliestDate || !latestDate) return []
    
    return findMissingTradingDays(tradeDates, earliestDate, latestDate)
  }, [trades])
  
  // Helper function to generate a missing day ID unique to the source file
  const getMissingDayId = useCallback((date: Date) => {
    return `${sourceFile}::missing-${formatDateKey(date)}`
  }, [sourceFile])
  
  // Get all trade IDs including missing day IDs (must be before useEffects that depend on it)
  const allTradeIds = useMemo(() => {
    const tradeIds = trades.map(trade => getTradeId(trade))
    
    // Add missing day IDs for each day in the ranges
    missingDaysForIds.forEach(range => {
      const days = getTradingDaysBetween(range.start, range.end)
      days.forEach(day => {
        tradeIds.push(getMissingDayId(day))
      })
    })
    
    return tradeIds
  }, [trades, missingDaysForIds, getMissingDayId])
  
  // Tags state
  const [tradeTags, setTradeTags] = useState<Record<string, string[]>>({})
  const [openTagPicker, setOpenTagPicker] = useState<string | null>(null)

  const tagFilteredTrades = useMemo(() => {
    return periodFilteredTrades.filter(trade =>
      tradePassesTagFilter(trade, tagFilterMode, tagFilterTags, tradeTags)
    )
  }, [periodFilteredTrades, tagFilterMode, tagFilterTags, tradeTags])

  const flagFilteredTrades = useMemo(() => {
    if (!showFlaggedOnly) return tagFilteredTrades
    return tagFilteredTrades.filter(trade => Boolean(flaggedTrades[getTradeId(trade)]))
  }, [tagFilteredTrades, showFlaggedOnly, flaggedTrades])

  const flaggedInViewCount = useMemo(() => {
    return periodFilteredTrades.filter(trade => Boolean(flaggedTrades[getTradeId(trade)])).length
  }, [periodFilteredTrades, flaggedTrades])

  const weekdayTrades = useMemo(() => {
    if (includeWeekends) return flagFilteredTrades
    return flagFilteredTrades.filter(trade => {
      if (!trade.timestamp) return false
      return !isWeekend(parseLocalTimestamp(trade.timestamp))
    })
  }, [flagFilteredTrades, includeWeekends])

  const weekdayPeriodTrades = useMemo(() => {
    if (includeWeekends) return periodFilteredTrades
    return periodFilteredTrades.filter(trade => {
      if (!trade.timestamp) return false
      return !isWeekend(parseLocalTimestamp(trade.timestamp))
    })
  }, [periodFilteredTrades, includeWeekends])

  const tradesForTable = includeWeekends ? flagFilteredTrades : weekdayTrades
  const allTradesForDayCurve = includeWeekends ? periodFilteredTrades : weekdayPeriodTrades
  const tagFilterActive = !isTagFilterClear(tagFilterMode, tagFilterTags)
  const flagFilterActive = showFlaggedOnly

  const equityCurveMode = useMemo(() => {
    const filtered = tagFilterActive || flagFilterActive
    if (filtered && equityCurveDayKey) return 'filtered-day' as const
    if (filtered) return 'filtered' as const
    if (equityCurveDayKey) return 'day' as const
    return 'all' as const
  }, [tagFilterActive, flagFilterActive, equityCurveDayKey])

  const equityCurveTrades = useMemo(() => {
    if (tagFilterActive || flagFilterActive) {
      const pool = tradesForTable
      if (equityCurveDayKey) {
        return pool.filter(trade => getJournalTradeDayKey(trade) === equityCurveDayKey)
      }
      return pool
    }
    if (equityCurveDayKey) {
      return allTradesForDayCurve.filter(
        trade => getJournalTradeDayKey(trade) === equityCurveDayKey
      )
    }
    return allTradesForDayCurve
  }, [tagFilterActive, flagFilterActive, equityCurveDayKey, tradesForTable, allTradesForDayCurve])

  const equityCurveLabel = useMemo(() => {
    switch (equityCurveMode) {
      case 'filtered-day': {
        const parts = [dateKeyToLabel(equityCurveDayKey!)]
        if (tagFilterActive && flagFilterActive) parts.push('tag + flag filter')
        else if (tagFilterActive) parts.push('tag filter')
        else parts.push('flag filter')
        return parts.join(' · ')
      }
      case 'filtered':
        if (tagFilterActive && flagFilterActive) return 'Tag + flag filter'
        if (flagFilterActive) return 'Flagged trades'
        return 'Filtered trades'
      case 'day':
        return dateKeyToLabel(equityCurveDayKey!)
      default:
        return 'All trades'
    }
  }, [equityCurveMode, equityCurveDayKey, tagFilterActive, flagFilterActive])

  const equityCurveTitle = equityCurveMode === 'day' || equityCurveMode === 'filtered-day'
    ? 'Daily P&L equity curve'
    : 'Equity curve'

  const equityCurveData = useMemo(
    () => buildDailyEquityCurve(equityCurveTrades),
    [equityCurveTrades]
  )

  const equityCurveTotalPnL = useMemo(
    () => equityCurveTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0),
    [equityCurveTrades]
  )

  const highlightedCurvePoint = useMemo(() => {
    if (!highlightedRowId) return null
    const inCurve = equityCurveTrades.some(t => getTradeId(t) === highlightedRowId)
    if (!inCurve) return null
    return equityCurveData.find(p => p.tradeId === highlightedRowId) ?? null
  }, [highlightedRowId, equityCurveTrades, equityCurveData])
  
  // Trade ratings: auto from setup tags unless ratingManual is set (half-star increments)
  const [tradeRatings, setTradeRatings] = useState<Record<string, number>>({})
  const [tradeRatingManual, setTradeRatingManual] = useState<Record<string, boolean>>({})
  const [tradeSetupTags, setTradeSetupTags] = useState<Record<string, string[]>>({})
  
  // Trade-level notes (text) per tradeId — localStorage + server auto-save
  const [tradeNotes, setTradeNotes] = useState<Record<string, string>>({})
  const [journalSaveStatus, setJournalSaveStatus] = useState<
    Record<string, 'idle' | 'saving' | 'saved' | 'error'>
  >({})
  const noteSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const imageNoteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistTradeRating = useCallback((tradeId: string, rating: number) => {
    setTradeRatings(prev => {
      const updated = { ...prev, [tradeId]: rating }
      localStorage.setItem('tradeRatings', JSON.stringify(updated))
      return updated
    })
  }, [])

  const persistTradeRatingManual = useCallback((tradeId: string, manual: boolean) => {
    setTradeRatingManual(prev => {
      const updated = { ...prev, [tradeId]: manual }
      localStorage.setItem('tradeRatingManual', JSON.stringify(updated))
      return updated
    })
  }, [])

  const getSetupTagRating = useCallback(
    (tradeId: string) => countSetupTagRating(tradeSetupTags[tradeId] || []),
    [tradeSetupTags]
  )

  const getTradeRating = useCallback(
    (tradeId: string) => {
      if (tradeRatingManual[tradeId]) {
        return tradeRatings[tradeId] ?? 0
      }
      return getSetupTagRating(tradeId)
    },
    [tradeRatingManual, tradeRatings, getSetupTagRating]
  )

  // Load trade ratings + setup tags from localStorage
  useEffect(() => {
    const savedRatings = localStorage.getItem('tradeRatings')
    if (savedRatings) {
      setTradeRatings(JSON.parse(savedRatings))
    }
    const savedRatingManual = localStorage.getItem('tradeRatingManual')
    if (savedRatingManual) {
      setTradeRatingManual(JSON.parse(savedRatingManual))
    }
    const savedSetupTags = localStorage.getItem('tradeSetupTags')
    if (savedSetupTags) {
      setTradeSetupTags(JSON.parse(savedSetupTags))
    }
  }, [])

  const applyServerJournal = useCallback((journalData: Record<string, TradeJournalBatchEntry>) => {
    if (Object.keys(journalData).length === 0) return

    setTradeNotes(prev => {
      const updated = { ...prev }
      for (const [tradeId, entry] of Object.entries(journalData)) {
        updated[tradeId] = entry.note ?? ''
      }
      localStorage.setItem('tradeNotes', JSON.stringify(updated))
      return updated
    })

    setTradeSetupTags(prev => {
      const updated = { ...prev }
      for (const [tradeId, entry] of Object.entries(journalData)) {
        updated[tradeId] = entry.setupTags ?? []
      }
      localStorage.setItem('tradeSetupTags', JSON.stringify(updated))
      return updated
    })

    setTradeRatingManual(prev => {
      const updated = { ...prev }
      for (const [tradeId, entry] of Object.entries(journalData)) {
        updated[tradeId] = entry.ratingManual ?? false
      }
      localStorage.setItem('tradeRatingManual', JSON.stringify(updated))
      return updated
    })

    setTradeRatings(prev => {
      const updated = { ...prev }
      for (const [tradeId, entry] of Object.entries(journalData)) {
        const manual = entry.ratingManual ?? false
        updated[tradeId] = manual
          ? (entry.rating ?? 0)
          : countSetupTagRating(entry.setupTags ?? [])
      }
      localStorage.setItem('tradeRatings', JSON.stringify(updated))
      return updated
    })
  }, [])

  const saveJournalToServer = useCallback(
    async (
      tradeId: string,
      patch: { note?: string; setupTags?: string[]; rating?: number; ratingManual?: boolean }
    ) => {
      setJournalSaveStatus(prev => ({ ...prev, [tradeId]: 'saving' }))
      const result = await patchTradeJournal(tradeId, patch)
      setJournalSaveStatus(prev => ({
        ...prev,
        [tradeId]: result.ok ? 'saved' : 'error',
      }))
      if (result.ok) {
        setTimeout(() => {
          setJournalSaveStatus(prev => {
            if (prev[tradeId] !== 'saved') return prev
            return { ...prev, [tradeId]: 'idle' }
          })
        }, 2000)
      }
    },
    []
  )

  const scheduleTradeNoteSave = useCallback(
    (tradeId: string, content: string) => {
      setTradeNotes(prev => {
        const updated = { ...prev, [tradeId]: content }
        localStorage.setItem('tradeNotes', JSON.stringify(updated))
        return updated
      })
      if (noteSaveTimers.current[tradeId]) {
        clearTimeout(noteSaveTimers.current[tradeId])
      }
      noteSaveTimers.current[tradeId] = setTimeout(() => {
        void saveJournalToServer(tradeId, { note: content })
      }, 500)
    },
    [saveJournalToServer]
  )

  const handleTradeRatingChange = useCallback(
    (tradeId: string, newRating: number) => {
      if (newRating <= 0) {
        const autoRating = countSetupTagRating(tradeSetupTags[tradeId] || [])
        persistTradeRatingManual(tradeId, false)
        persistTradeRating(tradeId, autoRating)
        void saveJournalToServer(tradeId, { rating: autoRating, ratingManual: false })
        return
      }
      persistTradeRatingManual(tradeId, true)
      persistTradeRating(tradeId, newRating)
      void saveJournalToServer(tradeId, { rating: newRating, ratingManual: true })
    },
    [tradeSetupTags, persistTradeRating, persistTradeRatingManual, saveJournalToServer]
  )

  const toggleSetupTag = useCallback(
    (tradeId: string, tagName: string) => {
      if (!SETUP_TAG_NAMES.has(tagName)) return
      setTradeSetupTags(prev => {
        const current = prev[tradeId] || []
        const nextTags = current.includes(tagName)
          ? current.filter(t => t !== tagName)
          : [...current, tagName]
        const updated = { ...prev, [tradeId]: nextTags }
        localStorage.setItem('tradeSetupTags', JSON.stringify(updated))
        const isManual = tradeRatingManual[tradeId]
        if (!isManual) {
          const rating = countSetupTagRating(nextTags)
          persistTradeRating(tradeId, rating)
          void saveJournalToServer(tradeId, { setupTags: nextTags, rating })
        } else {
          void saveJournalToServer(tradeId, { setupTags: nextTags })
        }
        return updated
      })
    },
    [tradeRatingManual, persistTradeRating, saveJournalToServer]
  )

  // Load trade notes from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('tradeNotes')
    if (saved) {
      setTradeNotes(JSON.parse(saved))
    }
  }, [])
  
  useEffect(() => {
    if (embedded || !focusDayKey) return
    setEquityCurveDayKey(focusDayKey)
  }, [focusDayKey, embedded])

  useEffect(() => {
    if (!embedded && equityCurveTrades.length === 0) return
    dailyChartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [
    embedded,
    equityCurveDayKey,
    equityCurveTrades.length,
    highlightedCurvePoint?.index,
    tagFilterActive,
    equityCurveMode,
  ])
  
  // Sort trades
  const sortedTrades = useMemo(() => {
    if (preserveTradeOrder) return [...tradesForTable]

    const sorted = [...tradesForTable]
    
    sorted.sort((a, b) => {
      let comparison = 0
      
      switch (sortColumn) {
        case 'date':
          const dateA = a.timestamp ? parseLocalTimestamp(a.timestamp).getTime() : 0
          const dateB = b.timestamp ? parseLocalTimestamp(b.timestamp).getTime() : 0
          comparison = dateA - dateB
          break
        case 'result':
          const resultA = (a.pnl ?? 0) > 0 ? 1 : 0
          const resultB = (b.pnl ?? 0) > 0 ? 1 : 0
          comparison = resultA - resultB
          break
        case 'direction':
          const dirA = a.direction === 'long' ? 1 : 0
          const dirB = b.direction === 'long' ? 1 : 0
          comparison = dirA - dirB
          break
        case 'rr':
          comparison = (getTradeRMultiple(a) ?? 0) - (getTradeRMultiple(b) ?? 0)
          break
        case 'pnl':
          comparison = (a.pnl ?? 0) - (b.pnl ?? 0)
          break
      }
      
      return sortDirection === 'asc' ? comparison : -comparison
    })
    
    return sorted
  }, [tradesForTable, sortColumn, sortDirection, preserveTradeOrder])

  const showEquityIndexCol = Boolean(
    equityIndexByTradeId && Object.keys(equityIndexByTradeId).length > 0
  )
  const showFlagColumn = Boolean(onToggleTradeFlag) && !embedded
  const tableColSpan = (showEquityIndexCol ? 14 : 13) + (showFlagColumn ? 1 : 0)

  // Calculate missing trading days
  const missingDays = useMemo(() => {
    if (embedded) return []
    if (sortedTrades.length === 0) return []
    
    // Get all dates that have trades
    const tradeDates = new Set<string>()
    let earliestDate: Date | null = null
    let latestDate: Date | null = null
    
    sortedTrades.forEach(trade => {
      if (!trade.timestamp) return
      const tradeDate = parseLocalTimestamp(trade.timestamp)
      const dateKey = formatDateKey(tradeDate)
      tradeDates.add(dateKey)
      
      if (!earliestDate || tradeDate < earliestDate) {
        earliestDate = tradeDate
      }
      if (!latestDate || tradeDate > latestDate) {
        latestDate = tradeDate
      }
    })
    
    if (!earliestDate || !latestDate) return []
    
    // Find missing trading days
    return findMissingTradingDays(tradeDates, earliestDate, latestDate)
  }, [sortedTrades])

  // Helper to get week key from date (ISO week format: YYYY-WXX)
  const getWeekKey = useCallback((date: Date): string => {
    const year = getISOWeekYear(date)
    const week = getISOWeek(date)
    return `${year}-W${String(week).padStart(2, '0')}`
  }, [])
  
  // Create a unified list of trades and missing day entries for rendering
  type JournalEntry = 
    | { type: 'trade'; trade: Trade; index: number }
    | { type: 'missingRange'; range: MissingDateRange; key: string }
    | { type: 'weekRecap'; weekKey: string; weekStart: Date; weekEnd: Date }
  
  const journalEntries = useMemo(() => {
    if (embedded) {
      return sortedTrades.map((trade, index) => ({
        type: 'trade' as const,
        trade,
        index,
      }))
    }

    // Collect all items with their dates
    const allItems: Array<{ date: Date; entry: JournalEntry; isWeekRecap?: boolean }> = []
    
    // Track weeks that have been added
    const weeksAdded = new Set<string>()
    
    // Add trades
    sortedTrades.forEach((trade, index) => {
      if (trade.timestamp) {
        const date = parseLocalTimestamp(trade.timestamp)
        allItems.push({
          date,
          entry: { type: 'trade', trade, index }
        })
        
        // Track the week for this trade
        const weekKey = getWeekKey(date)
        weeksAdded.add(weekKey)
      }
    })
    
    // Add missing ranges (using the start date for sorting)
    // Key includes sourceFile for uniqueness per log file
    missingDays.forEach((range) => {
      const weekdayDaysInRange = getTradingDaysBetween(range.start, range.end)
      if (weekdayDaysInRange.length === 0) return

      const key = `${sourceFile}::missing-${formatDateKey(range.start)}`
      allItems.push({
        date: range.start,
        entry: { type: 'missingRange', range, key }
      })
      
      // Track weeks from missing ranges too
      const weekKey = getWeekKey(range.start)
      weeksAdded.add(weekKey)
    })
    
    // Sort by date (descending to match default sort)
    const sortMultiplier = sortDirection === 'desc' ? -1 : 1
    allItems.sort((a, b) => sortMultiplier * (a.date.getTime() - b.date.getTime()))
    
    // Now insert week recap rows after the last entry of each week
    const result: JournalEntry[] = []
    let lastWeekKey: string | null = null
    
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i]
      const currentWeekKey = getWeekKey(item.date)
      
      // When week changes (or at the end), insert a week recap row for the previous week
      if (lastWeekKey && currentWeekKey !== lastWeekKey) {
        // Parse week key to get week start/end dates
        const [yearStr, weekStr] = lastWeekKey.split('-W')
        const year = parseInt(yearStr)
        const week = parseInt(weekStr)
        // Get first day of that ISO week
        const jan4 = new Date(year, 0, 4)
        const weekStart = startOfWeek(jan4, { weekStartsOn: 1 })
        weekStart.setDate(weekStart.getDate() + (week - 1) * 7)
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
        
        result.push({
          type: 'weekRecap',
          weekKey: lastWeekKey,
          weekStart,
          weekEnd
        })
      }
      
      result.push(item.entry)
      lastWeekKey = currentWeekKey
    }
    
    // Add recap for the last week
    if (lastWeekKey) {
      const [yearStr, weekStr] = lastWeekKey.split('-W')
      const year = parseInt(yearStr)
      const week = parseInt(weekStr)
      const jan4 = new Date(year, 0, 4)
      const weekStart = startOfWeek(jan4, { weekStartsOn: 1 })
      weekStart.setDate(weekStart.getDate() + (week - 1) * 7)
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
      
      result.push({
        type: 'weekRecap',
        weekKey: lastWeekKey,
        weekStart,
        weekEnd
      })
    }
    
    return result
  }, [embedded, sortedTrades, missingDays, sortDirection, sourceFile, getWeekKey])

  // Color palette for day groups (cycles through these colors)
  const dayGroupColors = [
    { bar: 'bg-blue-500', bg: 'bg-blue-500/5' },
    { bar: 'bg-emerald-500', bg: 'bg-emerald-500/5' },
    { bar: 'bg-purple-500', bg: 'bg-purple-500/5' },
    { bar: 'bg-amber-500', bg: 'bg-amber-500/5' },
    { bar: 'bg-pink-500', bg: 'bg-pink-500/5' },
    { bar: 'bg-cyan-500', bg: 'bg-cyan-500/5' },
  ]

  // Compute day groupings for visual brackets
  // Returns a map of trade index -> { isFirst, isLast, isOnly, groupSize, dateKey, colorIndex }
  const dayGroups = useMemo(() => {
    const groups: Record<number, { 
      isFirst: boolean
      isLast: boolean
      isOnly: boolean
      groupSize: number
      dateKey: string
      positionInGroup: number
      colorIndex: number
    }> = {}
    
    // Group trades by date
    const dateToIndices: Record<string, number[]> = {}
    const dateOrder: string[] = []
    sortedTrades.forEach((trade, index) => {
      const dateKey = getJournalTradeDayKey(trade)
      if (!dateKey) return
      if (!dateToIndices[dateKey]) {
        dateToIndices[dateKey] = []
        dateOrder.push(dateKey)
      }
      dateToIndices[dateKey].push(index)
    })
    
    // Build group info for each trade with color assignment
    dateOrder.forEach((dateKey, dateIndex) => {
      const indices = dateToIndices[dateKey]
      const groupSize = indices.length
      const colorIndex = dateIndex % dayGroupColors.length
      
      indices.forEach((tradeIndex, positionInGroup) => {
        groups[tradeIndex] = {
          isFirst: positionInGroup === 0,
          isLast: positionInGroup === groupSize - 1,
          isOnly: groupSize === 1,
          groupSize,
          dateKey,
          positionInGroup,
          colorIndex
        }
      })
    })
    
    return groups
  }, [sortedTrades])

  const dayGroupStats = useMemo(() => {
    const stats: Record<string, { totalPnL: number; tradeCount: number }> = {}
    sortedTrades.forEach(trade => {
      const dateKey = getJournalTradeDayKey(trade)
      if (!dateKey) return
      if (!stats[dateKey]) {
        stats[dateKey] = { totalPnL: 0, tradeCount: 0 }
      }
      stats[dateKey].totalPnL += trade.pnl ?? 0
      stats[dateKey].tradeCount += 1
    })
    return stats
  }, [sortedTrades])

  useEffect(() => {
    if (!highlightedRowId || embedded) return
    const trade = sortedTrades.find(t => getTradeId(t) === highlightedRowId)
    const dayKey = trade ? getJournalTradeDayKey(trade) : null
    if (!dayKey) return
    setCollapsedDayKeys(prev => {
      if (!prev.has(dayKey)) return prev
      const next = new Set(prev)
      next.delete(dayKey)
      return next
    })
  }, [highlightedRowId, sortedTrades, embedded])
  
  // Use lazy loading hook for images, videos, tags, and journal notes
  const {
    images: lazyImages,
    videos: lazyVideos,
    tags: lazyTags,
    journal: lazyJournal,
    isLoading: isMediaLoading,
    loadForTrade,
    loadBatch,
    updateImages: updateCachedImages,
    updateVideos: updateCachedVideos,
    updateTags: updateCachedTags
  } = useLazyMedia({ tradeIds: allTradeIds, batchSize: 30 })

  useEffect(() => {
    applyServerJournal(lazyJournal)
  }, [lazyJournal, applyServerJournal])

  // Add tag to trade (auto-saved to server)
  const addTag = useCallback(async (tradeId: string, tag: string) => {
    try {
      const res = await fetch('/api/trade-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, tag })
      })
      
      if (res.ok) {
        const data = await res.json()
        setTradeTags(prev => ({ ...prev, [tradeId]: data.tags }))
        updateCachedTags(tradeId, data.tags)
      }
    } catch (err) {
      console.error('Failed to add tag:', err)
    }
  }, [updateCachedTags])
  
  // Remove tag from trade (auto-saved to server)
  const removeTag = useCallback(async (tradeId: string, tag: string) => {
    try {
      const res = await fetch(`/api/trade-tags?tradeId=${encodeURIComponent(tradeId)}&tag=${encodeURIComponent(tag)}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        const data = await res.json()
        setTradeTags(prev => ({ ...prev, [tradeId]: data.tags }))
        updateCachedTags(tradeId, data.tags)
      }
    } catch (err) {
      console.error('Failed to remove tag:', err)
    }
  }, [updateCachedTags])

  const toggleTradeTag = useCallback(
    (tradeId: string, tagName: string, isSelected: boolean) => {
      if (isSelected) void removeTag(tradeId, tagName)
      else void addTag(tradeId, tagName)
    },
    [addTag, removeTag]
  )

  const tradeTagPickerButtonClass = (tagColor: string, isSelected: boolean) => {
    const ringOffset = darkMode ? 'ring-offset-gray-900' : 'ring-offset-white'
    return `px-2 py-0.5 rounded-full text-xs border transition-all ${
      isSelected
        ? `${tagColor} ring-2 ring-blue-400 ring-offset-1 ${ringOffset}`
        : `${tagColor} opacity-50 hover:opacity-100`
    }`
  }

  const renderTradeTagGrid = (
    tradeId: string,
    variant: 'panel' | 'dropdown'
  ) => {
    const tags = tradeTags[tradeId] || []
    const containerClass =
      variant === 'panel'
        ? 'flex flex-wrap items-center gap-1'
        : 'flex flex-wrap items-center gap-1 p-2'

    return (
      <div className={containerClass}>
        {AVAILABLE_TAGS.map(tag => {
          const isSelected = tags.includes(tag.name)
          return (
            <button
              key={tag.name}
              type="button"
              onClick={() => toggleTradeTag(tradeId, tag.name, isSelected)}
              className={tradeTagPickerButtonClass(tag.color, isSelected)}
            >
              {tag.name}
            </button>
          )
        })}
      </div>
    )
  }

  // Local state that combines lazy loaded data with optimistic updates
  const [tradeImages, setTradeImages] = useState<Record<string, TradeImage[]>>({})
  const [uploadingTrades, setUploadingTrades] = useState<Set<string>>(new Set())

  // Sync lazy loaded images to local state
  useEffect(() => {
    setTradeImages(prev => ({ ...prev, ...lazyImages }))
  }, [lazyImages])
  
  // Modal state
  const [modalState, setModalState] = useState<{
    tradeId: string
    imageIndex: number
  } | null>(null)
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  // Note editing state
  const [editingNote, setEditingNote] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  
  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [drawingTool, setDrawingTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen')
  const [drawingColor, setDrawingColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(3)
  const [strokes, setStrokes] = useState<DrawingStroke[]>([])
  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isSavingDrawing, setIsSavingDrawing] = useState(false)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
  // Video state
  const [tradeVideos, setTradeVideos] = useState<Record<string, TradeVideo[]>>({})
  const [uploadingVideos, setUploadingVideos] = useState<Set<string>>(new Set())

  // Sync lazy loaded videos to local state
  useEffect(() => {
    setTradeVideos(prev => ({ ...prev, ...lazyVideos }))
  }, [lazyVideos])

  // Sync lazy loaded tags to local state
  useEffect(() => {
    setTradeTags(prev => ({ ...prev, ...lazyTags }))
  }, [lazyTags])

  // Notify parent when tradeTags change (for global tag filter across tabs)
  useEffect(() => {
    onTradeTagsChange?.(tradeTags)
  }, [tradeTags, onTradeTagsChange])
  
  // Fetch weekly notes on mount
  useEffect(() => {
    const fetchWeeklyNotes = async () => {
      try {
        const res = await fetch('/api/weekly-notes')
        if (res.ok) {
          const data = await res.json()
          const notesMap: Record<string, { content: string; updatedAt: string }> = {}
          data.notes.forEach((note: { weekKey: string; content: string; updatedAt: string }) => {
            notesMap[note.weekKey] = { content: note.content, updatedAt: note.updatedAt }
          })
          setWeeklyNotes(notesMap)
        }
      } catch (err) {
        console.error('Error fetching weekly notes:', err)
      }
    }
    fetchWeeklyNotes()
  }, [])

  // Save weekly note
  const saveWeeklyNote = useCallback(async (weekKey: string, content: string) => {
    try {
      const res = await fetch('/api/weekly-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekKey, content })
      })
      
      if (res.ok) {
        const data = await res.json()
        if (data.note) {
          setWeeklyNotes(prev => ({
            ...prev,
            [weekKey]: data.note
          }))
        } else {
          // Note was deleted (empty content)
          setWeeklyNotes(prev => {
            const next = { ...prev }
            delete next[weekKey]
            return next
          })
        }
      }
    } catch (err) {
      console.error('Error saving weekly note:', err)
    } finally {
      setEditingWeekKey(null)
    }
  }, [])
  
  // Open weekly note editor
  const openWeeklyNoteEditor = useCallback((weekKey: string) => {
    setEditingWeekKey(weekKey)
  }, [])
  
  // Close weekly note editor
  const closeWeeklyNoteEditor = useCallback(() => {
    setEditingWeekKey(null)
  }, [])
  
  const [videoUploadProgress, setVideoUploadProgress] = useState<Record<string, { fileName: string; phase: 'uploading' | 'converting'; percent?: number }>>({})
  const [videoModalState, setVideoModalState] = useState<{
    tradeId: string
    videoIndex: number
  } | null>(null)
  
  // Video preview modal state (for trimming before upload)
  const [videoPreviewState, setVideoPreviewState] = useState<{
    tradeId: string
    file: File
    localUrl: string
  } | null>(null)
  
  // Video trimming state (shared between preview and saved video modals)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [isClipping, setIsClipping] = useState(false)
  const [videoZoom, setVideoZoom] = useState(1)
  const [videoPanning, setVideoPanning] = useState(false)
  const [videoPanStart, setVideoPanStart] = useState({ x: 0, y: 0 })
  const videoContainerRef = useRef<HTMLDivElement>(null)
  
  // Video pan handlers
  const handleVideoPanStart = useCallback((e: React.MouseEvent) => {
    if (videoZoom <= 1) return
    setVideoPanning(true)
    setVideoPanStart({ x: e.clientX, y: e.clientY })
  }, [videoZoom])
  
  const handleVideoPanMove = useCallback((e: React.MouseEvent) => {
    if (!videoPanning || !videoContainerRef.current) return
    const dx = videoPanStart.x - e.clientX
    const dy = videoPanStart.y - e.clientY
    videoContainerRef.current.scrollLeft += dx
    videoContainerRef.current.scrollTop += dy
    setVideoPanStart({ x: e.clientX, y: e.clientY })
  }, [videoPanning, videoPanStart])
  
  const handleVideoPanEnd = useCallback(() => {
    setVideoPanning(false)
  }, [])
  
  // Load media for visible trades on scroll (lazy loading)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const panelBeforeImageInputRef = useRef<HTMLInputElement>(null)
  const panelAfterImageInputRef = useRef<HTMLInputElement>(null)
  const panelVideoInputRef = useRef<HTMLInputElement>(null)
  const [activeImageSection, setActiveImageSection] = useState<TradeImageSection>('before')
  const [visibleTradeIds, setVisibleTradeIds] = useState<Set<string>>(new Set())
  
  // Track scroll and load media for visible trades
  useEffect(() => {
    const container = tableContainerRef.current
    if (!container) return

    let scrollTimeout: NodeJS.Timeout

    const handleScroll = () => {
      clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        // Get visible trade IDs based on scroll position
        const rows = container.querySelectorAll('[data-trade-id]')
        const containerRect = container.getBoundingClientRect()
        const newVisible = new Set<string>()

        rows.forEach((row) => {
          const rect = row.getBoundingClientRect()
          // Check if row is within visible area (with buffer)
          if (rect.top < containerRect.bottom + 200 && rect.bottom > containerRect.top - 200) {
            const tradeId = row.getAttribute('data-trade-id')
            if (tradeId) newVisible.add(tradeId)
          }
        })

        // Load media for newly visible trades
        const toLoad = Array.from(newVisible).filter(id => !visibleTradeIds.has(id))
        if (toLoad.length > 0) {
          void loadBatch(toLoad).then(result => {
            if (result?.journal) applyServerJournal(result.journal)
          })
        }
        setVisibleTradeIds(newVisible)
      }, 100) // Debounce scroll events
    }

    // Initial load
    handleScroll()

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(scrollTimeout)
    }
  }, [loadBatch, visibleTradeIds, sortedTrades, applyServerJournal])
  
  // Open preview modal when user selects a video (instead of uploading directly)
  const handleVideoSelect = useCallback((tradeId: string, files: FileList) => {
    if (files.length === 0) return
    
    const file = files[0]
    const localUrl = URL.createObjectURL(file)
    
    setVideoPreviewState({ tradeId, file, localUrl })
    setTrimStart(0)
    setTrimEnd(0) // Will be set when video loads
    setCurrentTime(0)
    setIsPlaying(false)
    setVideoZoom(1)
    setHighlightedRowId(tradeId)
  }, [])
  
  // Close preview modal and cleanup
  const closeVideoPreview = useCallback(() => {
    if (videoPreviewState?.localUrl) {
      URL.revokeObjectURL(videoPreviewState.localUrl)
    }
    setVideoPreviewState(null)
    setTrimStart(0)
    setTrimEnd(0)
    setCurrentTime(0)
    setIsPlaying(false)
  }, [videoPreviewState])
  
  // Upload trimmed video clip
  const uploadTrimmedClip = useCallback(async () => {
    if (!videoPreviewState) return
    
    const { tradeId, file } = videoPreviewState
    const clipDuration = trimEnd - trimStart
    
    if (clipDuration <= 0) {
      alert('Please set valid trim start and end times')
      return
    }
    
    if (clipDuration > 600) {
      alert('Clip must be 10 minutes or less')
      return
    }
    
    setIsClipping(true)
    setUploadingVideos(prev => new Set(prev).add(tradeId))
    setVideoUploadProgress(prev => ({ ...prev, [tradeId]: { fileName: file.name, phase: 'uploading' } }))
    
    try {
      const formData = new FormData()
      formData.append('tradeId', tradeId)
      formData.append('file0', file)
      formData.append('trimStart', trimStart.toString())
      formData.append('trimEnd', trimEnd.toString())
      
      // Use XMLHttpRequest for progress tracking
      const uploadPromise = new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            setVideoUploadProgress(prev => ({ ...prev, [tradeId]: { fileName: file.name, phase: 'uploading', percent } }))
          }
        }
        
        xhr.upload.onloadend = () => {
          setVideoUploadProgress(prev => ({ ...prev, [tradeId]: { fileName: file.name, phase: 'converting', percent: 100 } }))
        }
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(new Response(xhr.responseText, { status: xhr.status }))
          } else {
            let message = 'Failed to upload video'
            try {
              const parsed = JSON.parse(xhr.responseText) as { error?: string }
              if (parsed.error) message = parsed.error
            } catch {
              if (xhr.responseText) message = xhr.responseText
            }
            reject(new Error(message))
          }
        }
        
        xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again'))
        xhr.open('POST', '/api/trade-videos/upload')
        xhr.send(formData)
      })
      
      const res = await uploadPromise
      if (res.ok) {
        const data = await res.json()
        setTradeVideos(prev => ({
          ...prev,
          [tradeId]: [...(prev[tradeId] || []), ...data.videos]
        }))
        closeVideoPreview()
      } else {
        const error = await res.json()
        alert(error.error || 'Failed to upload video')
      }
    } catch (err) {
      console.error('Video upload error:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload video')
    } finally {
      setIsClipping(false)
      setVideoUploadProgress(prev => {
        const next = { ...prev }
        delete next[tradeId]
        return next
      })
      setUploadingVideos(prev => {
        const next = new Set(prev)
        next.delete(tradeId)
        return next
      })
    }
  }, [videoPreviewState, trimStart, trimEnd, closeVideoPreview])
  
  // Create video clip
  const createVideoClip = useCallback(async () => {
    if (!videoModalState) return
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    const currentVideo = videos[videoModalState.videoIndex]
    if (!currentVideo) return
    
    if (trimEnd <= trimStart) {
      alert('End time must be after start time')
      return
    }
    
    setIsClipping(true)
    
    try {
      const res = await fetch('/api/trade-videos/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: videoModalState.tradeId,
          videoId: currentVideo.id,
          startSec: trimStart,
          endSec: trimEnd
        })
      })
      
      if (res.ok) {
        const data = await res.json()
        setTradeVideos(prev => ({
          ...prev,
          [videoModalState.tradeId]: [...(prev[videoModalState.tradeId] || []), data.clip]
        }))
        alert('Clip created successfully!')
      } else {
        const error = await res.json()
        alert(error.error || 'Failed to create clip')
      }
    } catch (err) {
      console.error('Clip error:', err)
      alert('Failed to create clip')
    } finally {
      setIsClipping(false)
    }
  }, [videoModalState, tradeVideos, trimStart, trimEnd])
  
  // Open video modal
  const openVideoModal = useCallback((tradeId: string, videoIndex: number = 0) => {
    const videos = tradeVideos[tradeId] || []
    const currentVideo = videos[videoIndex]
    setVideoModalState({ tradeId, videoIndex })
    setTrimStart(0)
    setTrimEnd(currentVideo?.durationSec || 0)
    setIsPlaying(false)
    setCurrentTime(0)
    setVideoZoom(1)
    setHighlightedRowId(tradeId)
  }, [tradeVideos])
  
  // Close video modal
  const closeVideoModal = useCallback(() => {
    setVideoModalState(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setTrimStart(0)
    setTrimEnd(0)
    setVideoZoom(1)
  }, [])

  // Delete a video
  const deleteVideo = useCallback(async (tradeId: string, videoId: string) => {
    if (!confirm('Remove this video? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/trade-videos?tradeId=${encodeURIComponent(tradeId)}&videoId=${encodeURIComponent(videoId)}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to delete video')
        return
      }

      const updated = (tradeVideos[tradeId] || []).filter(v => v.id !== videoId)
      setTradeVideos(prev => ({ ...prev, [tradeId]: updated }))
      updateCachedVideos(tradeId, updated)

      if (videoModalState?.tradeId === tradeId) {
        if (updated.length === 0) {
          closeVideoModal()
        } else if (videoModalState.videoIndex >= updated.length) {
          setVideoModalState(prev => prev ? { ...prev, videoIndex: updated.length - 1 } : null)
        }
      }
    } catch (err) {
      console.error('Delete video error:', err)
      alert('Failed to delete video')
    }
  }, [videoModalState, tradeVideos, updateCachedVideos, closeVideoModal])
  
  // Navigate video slideshow
  const navigateVideoSlideshow = useCallback((direction: 'prev' | 'next') => {
    if (!videoModalState) return
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    if (videos.length === 0) return
    
    let newIndex = videoModalState.videoIndex
    if (direction === 'prev') {
      newIndex = (newIndex - 1 + videos.length) % videos.length
    } else {
      newIndex = (newIndex + 1) % videos.length
    }
    
    const newVideo = videos[newIndex]
    setVideoModalState({ ...videoModalState, videoIndex: newIndex })
    setTrimStart(0)
    setTrimEnd(newVideo?.durationSec || 0)
    setIsPlaying(false)
    setCurrentTime(0)
    setVideoZoom(1)
  }, [videoModalState, tradeVideos])
  
  // Format time to mm:ss
  const formatVideoTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Upload images
  const uploadImages = useCallback(async (
    tradeId: string,
    files: FileList,
    section: TradeImageSection = 'before'
  ) => {
    setUploadingTrades(prev => new Set(prev).add(tradeId))
    
    try {
      const formData = new FormData()
      formData.append('tradeId', tradeId)
      formData.append('section', section)
      
      for (let i = 0; i < files.length; i++) {
        formData.append(`file${i}`, files[i])
      }
      
      const res = await fetch('/api/trade-images/upload', {
        method: 'POST',
        body: formData
      })
      
      if (res.ok) {
        const data = await res.json()
        setTradeImages(prev => {
          const merged = [...(prev[tradeId] || []), ...data.files]
          updateCachedImages(tradeId, merged)
          return { ...prev, [tradeId]: merged }
        })
      }
    } catch (err) {
      console.error('Upload error:', err)
    } finally {
      setUploadingTrades(prev => {
        const next = new Set(prev)
        next.delete(tradeId)
        return next
      })
    }
  }, [updateCachedImages])
  
  // Delete an image
  const deleteImage = useCallback(async (tradeId: string, imageName: string) => {
    try {
      const res = await fetch(`/api/trade-images?tradeId=${encodeURIComponent(tradeId)}&name=${encodeURIComponent(imageName)}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setTradeImages(prev => {
          const updated = (prev[tradeId] || []).filter(img => img.name !== imageName)
          return { ...prev, [tradeId]: updated }
        })
        
        if (modalState?.tradeId === tradeId) {
          const images = tradeImages[tradeId] || []
          if (images.length <= 1) {
            closeModal()
          } else if (modalState.imageIndex >= images.length - 1) {
            setModalState(prev => prev ? { ...prev, imageIndex: Math.max(0, prev.imageIndex - 1) } : null)
          }
        }
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }, [modalState, tradeImages])

  const moveImageInSection = useCallback(
    async (
      tradeId: string,
      section: TradeImageSection,
      localIndex: number,
      direction: 'up' | 'down'
    ) => {
      const images = tradeImages[tradeId] || []
      const reordered = swapSectionImageOrder(images, section, localIndex, direction)
      if (!reordered) return

      const previousImages = images
      const sectionNames = imagesForSection(reordered, section).map(img => img.name)

      setTradeImages(prev => ({ ...prev, [tradeId]: reordered }))
      updateCachedImages(tradeId, reordered)

      try {
        const res = await fetch('/api/trade-images', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradeId,
            sectionOrder: { section, names: sectionNames },
          }),
        })

        if (!res.ok) {
          setTradeImages(prev => ({ ...prev, [tradeId]: previousImages }))
          updateCachedImages(tradeId, previousImages)
        }
      } catch (err) {
        console.error('Reorder error:', err)
        setTradeImages(prev => ({ ...prev, [tradeId]: previousImages }))
        updateCachedImages(tradeId, previousImages)
      }
    },
    [tradeImages, updateCachedImages]
  )
  
  // Save note
  const saveNote = useCallback(async (tradeId: string, imageName: string, note: string) => {
    setIsSavingNote(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, note })
      })
      
      if (res.ok) {
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: (prev[tradeId] || []).map(img => 
            img.name === imageName ? { ...img, note } : img
          )
        }))
      }
    } catch (err) {
      console.error('Failed to save note:', err)
    } finally {
      setIsSavingNote(false)
    }
  }, [])

  // Auto-save screenshot notes while typing in the image modal
  useEffect(() => {
    if (!modalState) return
    const images = tradeImages[modalState.tradeId] || []
    const currentImage = images[modalState.imageIndex]
    if (!currentImage) return
    const savedNote = currentImage.note || ''
    if (editingNote === savedNote) return

    if (imageNoteSaveTimer.current) {
      clearTimeout(imageNoteSaveTimer.current)
    }
    imageNoteSaveTimer.current = setTimeout(() => {
      void saveNote(modalState.tradeId, currentImage.name, editingNote)
    }, 600)

    return () => {
      if (imageNoteSaveTimer.current) {
        clearTimeout(imageNoteSaveTimer.current)
      }
    }
  }, [editingNote, modalState, tradeImages, saveNote])
  
  // Save drawings
  const saveDrawings = useCallback(async (tradeId: string, imageName: string, drawings: DrawingStroke[]) => {
    setIsSavingDrawing(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, drawings })
      })
      
      if (res.ok) {
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: (prev[tradeId] || []).map(img => 
            img.name === imageName ? { ...img, drawings } : img
          )
        }))
      }
    } catch (err) {
      console.error('Failed to save drawings:', err)
    } finally {
      setIsSavingDrawing(false)
    }
  }, [])
  
  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    const allStrokes = [...strokes, ...(currentStroke ? [currentStroke] : [])]
    
    allStrokes.forEach(stroke => {
      if (stroke.points.length < 2) return
      
      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.lineWidth = stroke.size * 3
      } else if (stroke.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply'
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.size * 4
        ctx.globalAlpha = 0.4
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.size
        ctx.globalAlpha = 1
      }
      
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    })
  }, [strokes, currentStroke])
  
  React.useEffect(() => {
    renderCanvas()
  }, [renderCanvas, canvasSize, strokes])
  
  // Get canvas point
  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): DrawingPoint => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    }
  }, [])
  
  // Drawing handlers
  const handleDrawStart = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode) return
    const point = getCanvasPoint(e)
    setIsDrawing(true)
    setCurrentStroke({
      points: [point],
      color: drawingColor,
      size: brushSize,
      tool: drawingTool
    })
  }, [isDrawingMode, getCanvasPoint, drawingColor, brushSize, drawingTool])
  
  const handleDrawMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke) return
    const point = getCanvasPoint(e)
    setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, point] } : null)
  }, [isDrawing, currentStroke, getCanvasPoint])
  
  const handleDrawEnd = useCallback(() => {
    if (!isDrawing || !currentStroke) return
    if (currentStroke.points.length > 1) {
      setStrokes(prev => [...prev, currentStroke])
    }
    setCurrentStroke(null)
    setIsDrawing(false)
  }, [isDrawing, currentStroke])
  
  const undoStroke = useCallback(() => setStrokes(prev => prev.slice(0, -1)), [])
  const clearStrokes = useCallback(() => setStrokes([]), [])
  
  // Open modal
  const openModal = useCallback((tradeId: string, imageIndex: number = 0) => {
    const images = tradeImages[tradeId] || []
    const currentImage = images[imageIndex]
    setModalState({ tradeId, imageIndex })
    setEditingNote(currentImage?.note || '')
    setStrokes(currentImage?.drawings || [])
    setIsDrawingMode(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setHighlightedRowId(tradeId)
  }, [tradeImages])
  
  // Close modal
  const closeModal = useCallback(async () => {
    if (modalState) {
      const images = tradeImages[modalState.tradeId] || []
      const currentImage = images[modalState.imageIndex]
      if (currentImage) {
        if (editingNote !== currentImage.note) {
          await saveNote(modalState.tradeId, currentImage.name, editingNote)
        }
        const currentDrawings = currentImage.drawings || []
        if (JSON.stringify(strokes) !== JSON.stringify(currentDrawings)) {
          await saveDrawings(modalState.tradeId, currentImage.name, strokes)
        }
      }
    }
    
    setModalState(null)
    setEditingNote('')
    setStrokes([])
    setIsDrawingMode(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Navigate slideshow
  const navigateSlideshow = useCallback(async (direction: 'prev' | 'next') => {
    if (!modalState) return
    
    const images = tradeImages[modalState.tradeId] || []
    if (images.length === 0) return
    
    const currentImage = images[modalState.imageIndex]
    if (currentImage) {
      if (editingNote !== currentImage.note) {
        await saveNote(modalState.tradeId, currentImage.name, editingNote)
      }
      const currentDrawings = currentImage.drawings || []
      if (JSON.stringify(strokes) !== JSON.stringify(currentDrawings)) {
        await saveDrawings(modalState.tradeId, currentImage.name, strokes)
      }
    }
    
    let newIndex = modalState.imageIndex
    if (direction === 'prev') {
      newIndex = (newIndex - 1 + images.length) % images.length
    } else {
      newIndex = (newIndex + 1) % images.length
    }
    
    const newImage = images[newIndex]
    setEditingNote(newImage?.note || '')
    setStrokes(newImage?.drawings || [])
    setModalState({ ...modalState, imageIndex: newIndex })
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Zoom/pan handlers
  const handleZoomIn = useCallback(() => setZoom(prev => Math.min(prev * 1.5, 5)), [])
  const handleZoomOut = useCallback(() => setZoom(prev => Math.max(prev / 1.5, 0.5)), [])
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [zoom, pan])
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
    }
  }, [isDragging, zoom, dragStart])
  
  const handleMouseUp = useCallback(() => setIsDragging(false), [])
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) {
      setZoom(prev => Math.min(prev * 1.1, 5))
    } else {
      setZoom(prev => Math.max(prev / 1.1, 0.5))
    }
  }, [])
  
  // Keyboard navigation
  useEffect(() => {
    if (!modalState) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip keyboard shortcuts when user is typing in an input or textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }
      
      switch (e.key) {
        case 'ArrowLeft': navigateSlideshow('prev'); break
        case 'ArrowRight': navigateSlideshow('next'); break
        case 'Escape': closeModal(); break
        case '+': case '=': handleZoomIn(); break
        case '-': handleZoomOut(); break
        case '0': resetZoom(); break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalState, navigateSlideshow, closeModal, handleZoomIn, handleZoomOut, resetZoom])
  
  // border-separate required for sticky thead (border-collapse breaks position: sticky)
  const tableClass = darkMode
    ? 'w-full border-separate border-spacing-0 bg-gray-800'
    : 'w-full border-separate border-spacing-0 bg-white'

  const isCompactTable = Boolean(highlightedRowId)

  const thClass = isCompactTable
    ? darkMode
      ? 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider bg-gray-800 text-gray-300 border-b border-gray-600 sticky top-0 z-20 shadow-[0_2px_6px_rgba(0,0,0,0.45)]'
      : 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider bg-white text-gray-700 border-b border-gray-300 sticky top-0 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.08)]'
    : darkMode
      ? 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider bg-gray-800 text-gray-300 border-b border-gray-600 sticky top-0 z-20 shadow-[0_2px_6px_rgba(0,0,0,0.45)]'
      : 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider bg-white text-gray-700 border-b border-gray-300 sticky top-0 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.08)]'

  const tdClass = isCompactTable
    ? darkMode
      ? 'px-2 py-1 border-b border-gray-700 text-xs leading-snug'
      : 'px-2 py-1 border-b border-gray-200 text-xs leading-snug'
    : darkMode
      ? 'px-3 py-2 border-b border-gray-700 text-sm'
      : 'px-3 py-2 border-b border-gray-200 text-sm'
  
  // Render image modal
  const renderImageModal = () => {
    if (!modalState) return null
    
    const images = tradeImages[modalState.tradeId] || []
    if (images.length === 0) return null
    
    const currentImage = images[modalState.imageIndex]
    if (!currentImage) return null
    
    const hasMultipleImages = images.length > 1
    const currentSection = normalizeTradeImageSection(currentImage.section)
    const sectionLabel = tradeImageSectionLabel(currentSection)
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
        onClick={closeModal}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <span className="text-sm truncate max-w-[300px]">{currentImage.name}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                currentSection === 'after'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'bg-blue-500/20 text-blue-300'
              }`}>
                {sectionLabel}
              </span>
              {hasMultipleImages && (
                <span className="text-xs text-muted-foreground">
                  {modalState.imageIndex + 1} / {images.length}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              {/* Zoom controls */}
              <button onClick={handleZoomOut} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={resetZoom} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset">
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              {/* Drawing tools */}
              <button
                onClick={() => setIsDrawingMode(!isDrawingMode)}
                className={`p-1.5 rounded transition-colors ${isDrawingMode ? 'bg-blue-500 text-white' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                title={isDrawingMode ? 'Exit drawing mode' : 'Enter drawing mode'}
              >
                <Pen className="h-4 w-4" />
              </button>
              
              {isDrawingMode && (
                <>
                  <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <button onClick={() => setDrawingTool('pen')} className={`p-1 rounded ${drawingTool === 'pen' ? 'bg-blue-500 text-white' : ''}`} title="Pen">
                      <Pen className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDrawingTool('highlighter')} className={`p-1 rounded ${drawingTool === 'highlighter' ? 'bg-yellow-500 text-white' : ''}`} title="Highlighter">
                      <Circle className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDrawingTool('eraser')} className={`p-1 rounded ${drawingTool === 'eraser' ? 'bg-gray-500 text-white' : ''}`} title="Eraser">
                      <Eraser className="h-3 w-3" />
                    </button>
                  </div>
                  
                  {drawingTool !== 'eraser' && (
                    <div className="flex items-center gap-0.5">
                      {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'].map(color => (
                        <button
                          key={color}
                          onClick={() => setDrawingColor(color)}
                          className={`w-5 h-5 rounded-full border-2 ${drawingColor === color ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                  
                  <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-16 h-1 accent-blue-500" />
                  <button onClick={undoStroke} disabled={strokes.length === 0} className={`p-1.5 rounded ${strokes.length === 0 ? 'opacity-50' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Undo">
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button onClick={clearStrokes} disabled={strokes.length === 0} className={`p-1.5 rounded ${strokes.length === 0 ? 'opacity-50' : 'hover:bg-red-500/20 text-red-400'}`} title="Clear">
                    <Trash className="h-4 w-4" />
                  </button>
                  {isSavingDrawing && <span className="text-xs text-blue-400 animate-pulse">Saving...</span>}
                </>
              )}
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              <button onClick={() => { if (confirm('Delete?')) deleteImage(modalState.tradeId, currentImage.name) }} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={closeModal} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Image container */}
          <div 
            className="flex-1 min-h-0 w-full overflow-hidden relative flex items-center justify-center p-4"
            onWheel={!isDrawingMode ? handleWheel : undefined}
            onMouseDown={!isDrawingMode ? handleMouseDown : undefined}
            onMouseMove={!isDrawingMode ? handleMouseMove : undefined}
            onMouseUp={!isDrawingMode ? handleMouseUp : undefined}
            style={{ cursor: isDrawingMode ? 'crosshair' : (zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default') }}
          >
            <div
              className="relative inline-flex max-w-full max-h-full items-center justify-center"
              style={{ 
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
            >
              <FitImageViewer
                src={currentImage.url}
                alt={currentImage.name}
                maxHeight="calc(95vh - 10rem)"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight })
                }}
              />
              
              {canvasSize.width > 0 && (
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className="absolute inset-0 w-full h-full"
                  style={{ pointerEvents: isDrawingMode ? 'auto' : 'none' }}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                />
              )}
            </div>
            
            {hasMultipleImages && (
              <>
                <button onClick={(e) => { e.stopPropagation(); navigateSlideshow('prev') }} className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); navigateSlideshow('next') }} className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          
          {/* Note text area */}
          <div className={`shrink-0 px-4 py-3 ${darkMode ? 'bg-gray-850 border-t border-gray-700' : 'bg-gray-50 border-t border-gray-200'}`}>
            <div className="flex items-start gap-3">
              <label className="text-sm font-medium text-muted-foreground shrink-0 pt-2">Notes:</label>
              <div className="flex-1 relative">
                <textarea
                  value={editingNote}
                  onChange={(e) => setEditingNote(e.target.value)}
                  onBlur={async () => {
                    if (currentImage && editingNote !== currentImage.note) {
                      await saveNote(modalState.tradeId, currentImage.name, editingNote)
                    }
                  }}
                  placeholder="Add notes about this trade..."
                  className={`w-full px-3 py-2 rounded-lg resize-none text-sm ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300'} border focus:outline-none focus:ring-1 focus:ring-blue-500`}
                  rows={2}
                />
                {isSavingNote && <span className="absolute right-2 top-2 text-xs text-blue-400 animate-pulse">Saving...</span>}
              </div>
            </div>
          </div>
          
          {/* Thumbnail strip */}
          {hasMultipleImages && (
            <div className={`shrink-0 px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} overflow-x-auto`}>
              <div className="flex items-center gap-2 justify-center">
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={async () => {
                      if (currentImage && editingNote !== currentImage.note) {
                        await saveNote(modalState.tradeId, currentImage.name, editingNote)
                      }
                      setEditingNote(images[idx]?.note || '')
                      setStrokes(images[idx]?.drawings || [])
                      setModalState({ ...modalState, imageIndex: idx })
                      setZoom(1)
                      setPan({ x: 0, y: 0 })
                    }}
                    className={`w-12 h-12 rounded overflow-hidden border-2 shrink-0 ${idx === modalState.imageIndex ? 'border-blue-500' : darkMode ? 'border-gray-600 hover:border-gray-400' : 'border-gray-300 hover:border-gray-500'}`}
                  >
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
  
  // Render video preview modal (for trimming before upload)
  const renderVideoPreviewModal = () => {
    if (!videoPreviewState) return null
    
    const clipDuration = trimEnd - trimStart
    const isValidClip = clipDuration > 0 && clipDuration <= 600
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
        onClick={closeVideoPreview}
      >
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-purple-400" />
              <span className="text-sm font-medium">Preview & Trim Before Saving</span>
              <span className="text-xs text-muted-foreground">{videoPreviewState.file.name}</span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <button onClick={() => setVideoZoom(prev => Math.max(0.5, prev - 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(videoZoom * 100)}%</span>
              <button onClick={() => setVideoZoom(prev => Math.min(3, prev + 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={() => setVideoZoom(1)} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset zoom">
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              <button 
                onClick={closeVideoPreview} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Video player */}
          <div className="flex-1 flex flex-col min-h-0">
            <div 
              ref={videoContainerRef}
              className={`flex-1 flex items-center justify-center bg-black p-4 min-h-0 overflow-auto ${videoZoom > 1 ? (videoPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onMouseDown={handleVideoPanStart}
              onMouseMove={handleVideoPanMove}
              onMouseUp={handleVideoPanEnd}
              onMouseLeave={handleVideoPanEnd}
            >
              <video
                ref={videoRef}
                src={videoPreviewState.localUrl}
                className="rounded transition-transform select-none"
                style={{ 
                  transform: `scale(${videoZoom})`,
                  maxWidth: videoZoom <= 1 ? '100%' : 'none',
                  maxHeight: videoZoom <= 1 ? '100%' : 'none',
                  pointerEvents: videoZoom > 1 ? 'none' : 'auto'
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  const vid = e.currentTarget
                  setDuration(vid.duration)
                  setTrimEnd(Math.min(vid.duration, 600)) // Default to full duration or 10 min max
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </div>
            
            {/* Playback controls */}
            <div className={`px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    const vid = videoRef.current
                    if (vid) {
                      if (isPlaying) vid.pause()
                      else vid.play()
                    }
                  }}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                
                <span className="text-sm font-mono w-24">
                  {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                </span>
                
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value)
                      setCurrentTime(time)
                      if (videoRef.current) videoRef.current.currentTime = time
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-600"
                  />
                </div>
              </div>
            </div>
            
            {/* Trim controls */}
            <div className={`px-4 py-4 border-t ${darkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Scissors className="h-5 w-5 text-purple-400" />
                <span className="font-medium">Set Clip Range (max 10 min)</span>
              </div>
              
              <div className="flex flex-wrap items-center gap-6 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium w-12">Start:</span>
                  <input
                    type="number"
                    min={0}
                    max={trimEnd - 1}
                    step={0.1}
                    value={trimStart.toFixed(1)}
                    onChange={(e) => setTrimStart(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-24 px-3 py-2 rounded ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border text-center`}
                  />
                  <button
                    onClick={() => setTrimStart(currentTime)}
                    className="px-3 py-2 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                  >
                    Use Current
                  </button>
                  <span className="text-sm text-muted-foreground">{formatVideoTime(trimStart)}</span>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium w-12">End:</span>
                  <input
                    type="number"
                    min={trimStart + 1}
                    max={duration}
                    step={0.1}
                    value={trimEnd.toFixed(1)}
                    onChange={(e) => setTrimEnd(Math.min(duration, parseFloat(e.target.value) || duration))}
                    className={`w-24 px-3 py-2 rounded ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border text-center`}
                  />
                  <button
                    onClick={() => setTrimEnd(currentTime)}
                    className="px-3 py-2 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                  >
                    Use Current
                  </button>
                  <span className="text-sm text-muted-foreground">{formatVideoTime(trimEnd)}</span>
                </div>
              </div>
              
              {/* Trim visualization */}
              <div className="relative h-8 bg-gray-700 rounded overflow-hidden mb-4">
                {/* Full duration background */}
                <div className="absolute inset-0 bg-gray-600" />
                {/* Selected clip range */}
                <div
                  className="absolute h-full bg-purple-500/50 border-l-2 border-r-2 border-purple-400"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd - trimStart) / duration) * 100}%`
                  }}
                />
                {/* Current position */}
                <div
                  className="absolute h-full w-1 bg-white shadow-lg"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              </div>
              
              {/* Clip info and save button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className={`text-sm ${isValidClip ? 'text-green-400' : 'text-red-400'}`}>
                    Clip Duration: {formatVideoTime(clipDuration)}
                    {clipDuration > 600 && ' (exceeds 10 min limit)'}
                  </span>
                </div>
                
                <div className="flex items-center gap-3">
                  <button
                    onClick={closeVideoPreview}
                    className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={uploadTrimmedClip}
                    disabled={!isValidClip || isClipping}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
                      !isValidClip || isClipping
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-purple-500 hover:bg-purple-600 text-white'
                    }`}
                  >
                    {isClipping ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        {videoUploadProgress[videoPreviewState.tradeId]?.phase === 'uploading' 
                          ? `Uploading ${videoUploadProgress[videoPreviewState.tradeId]?.percent || 0}%`
                          : 'Converting...'}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save Clip
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // Render video modal
  const renderVideoModal = () => {
    if (!videoModalState) return null
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    if (videos.length === 0) return null
    
    const currentVideo = videos[videoModalState.videoIndex]
    if (!currentVideo) return null
    
    const hasMultipleVideos = videos.length > 1
    const videoDuration = duration || currentVideo.durationSec || 0
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
        onClick={closeVideoModal}
      >
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-purple-400" />
              <span className="text-sm truncate max-w-[300px]">{currentVideo.originalName}</span>
              {hasMultipleVideos && (
                <span className="text-xs text-muted-foreground">
                  {videoModalState.videoIndex + 1} / {videos.length}
                </span>
              )}
              {currentVideo.clipStartSec !== undefined && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  Clip
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <button onClick={() => setVideoZoom(prev => Math.max(0.5, prev - 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(videoZoom * 100)}%</span>
              <button onClick={() => setVideoZoom(prev => Math.min(3, prev + 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={() => setVideoZoom(1)} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset zoom">
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-1" />
              
              <button
                onClick={() => deleteVideo(videoModalState.tradeId, currentVideo.id)}
                className="p-1.5 rounded text-red-400 hover:bg-red-500/20"
                title="Delete video"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button 
                onClick={closeVideoModal} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Video player */}
          <div className="flex-1 flex flex-col min-h-0">
            <div 
              ref={videoContainerRef}
              className={`flex-1 flex items-center justify-center bg-black p-4 min-h-0 overflow-auto ${videoZoom > 1 ? (videoPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onMouseDown={handleVideoPanStart}
              onMouseMove={handleVideoPanMove}
              onMouseUp={handleVideoPanEnd}
              onMouseLeave={handleVideoPanEnd}
            >
              <video
                ref={videoRef}
                src={currentVideo.url}
                className="rounded transition-transform select-none"
                style={{ 
                  transform: `scale(${videoZoom})`,
                  maxWidth: videoZoom <= 1 ? '100%' : 'none',
                  maxHeight: videoZoom <= 1 ? '100%' : 'none',
                  pointerEvents: videoZoom > 1 ? 'none' : 'auto'
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  const vid = e.currentTarget
                  setDuration(vid.duration)
                  setTrimEnd(vid.duration)
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            </div>
            
            {/* Playback controls */}
            <div className={`px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    const vid = videoRef.current
                    if (vid) {
                      if (isPlaying) {
                        vid.pause()
                      } else {
                        vid.play()
                      }
                    }
                  }}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                
                <span className="text-sm font-mono w-20">
                  {formatVideoTime(currentTime)} / {formatVideoTime(videoDuration)}
                </span>
                
                {/* Timeline scrubber */}
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={videoDuration}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value)
                      setCurrentTime(time)
                      if (videoRef.current) {
                        videoRef.current.currentTime = time
                      }
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-600"
                  />
                </div>
              </div>
            </div>
            
            {/* Trimming controls */}
            <div className={`px-4 py-4 border-t ${darkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Scissors className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-medium">Trim & Save Clip</span>
              </div>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Start:</span>
                  <input
                    type="number"
                    min={0}
                    max={trimEnd - 0.1}
                    step={0.1}
                    value={trimStart.toFixed(1)}
                    onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button
                    onClick={() => setTrimStart(currentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Set Current
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">End:</span>
                  <input
                    type="number"
                    min={trimStart + 0.1}
                    max={videoDuration}
                    step={0.1}
                    value={trimEnd.toFixed(1)}
                    onChange={(e) => setTrimEnd(parseFloat(e.target.value) || videoDuration)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button
                    onClick={() => setTrimEnd(currentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Set Current
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Duration: {formatVideoTime(Math.max(0, trimEnd - trimStart))}
                  </span>
                </div>
                
                <button
                  onClick={createVideoClip}
                  disabled={isClipping || trimEnd <= trimStart}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isClipping || trimEnd <= trimStart
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-500 hover:bg-purple-600 text-white'
                  }`}
                >
                  {isClipping ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Clip
                    </>
                  )}
                </button>
              </div>
              
              {/* Trim range visualization */}
              <div className="mt-3 relative h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="absolute h-full bg-purple-500/40"
                  style={{
                    left: `${(trimStart / videoDuration) * 100}%`,
                    width: `${((trimEnd - trimStart) / videoDuration) * 100}%`
                  }}
                />
                <div
                  className="absolute h-full w-0.5 bg-blue-400"
                  style={{ left: `${(currentTime / videoDuration) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Navigation arrows */}
          {hasMultipleVideos && (
            <>
              <button
                onClick={() => navigateVideoSlideshow('prev')}
                className={`absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={() => navigateVideoSlideshow('next')}
                className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          
          {/* Video thumbnails strip */}
          {hasMultipleVideos && (
            <div className={`px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {videos.map((vid, idx) => (
                  <button
                    key={vid.id}
                    onClick={() => {
                      setVideoModalState({ ...videoModalState, videoIndex: idx })
                      setTrimStart(0)
                      setTrimEnd(vid.durationSec || 0)
                      setIsPlaying(false)
                      setCurrentTime(0)
                    }}
                    className={`w-16 h-12 rounded overflow-hidden border-2 shrink-0 relative ${idx === videoModalState.videoIndex ? 'border-purple-500' : darkMode ? 'border-gray-600 hover:border-gray-400' : 'border-gray-300 hover:border-gray-500'}`}
                  >
                    {vid.thumbUrl ? (
                      <img src={vid.thumbUrl} alt={vid.originalName} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-700">
                        <Film className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                    {vid.clipStartSec !== undefined && (
                      <div className="absolute bottom-0 left-0 right-0 bg-purple-500/80 text-[8px] text-center text-white">
                        Clip
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render a missing day row (for days without trades)
  const renderMissingDayRow = (range: MissingDateRange, rangeKey: string, rowIndex: number) => {
    const isExpanded = expandedMissingRanges.has(rangeKey)
    const shouldCollapse = range.count >= 3 && !isExpanded
    const rowBg = rowIndex % 2 === 0 ? (darkMode ? 'bg-gray-800' : 'bg-white') : (darkMode ? 'bg-gray-850' : 'bg-gray-50')
    
    const toggleExpand = () => {
      setExpandedMissingRanges(prev => {
        const next = new Set(prev)
        if (next.has(rangeKey)) {
          next.delete(rangeKey)
        } else {
          next.add(rangeKey)
        }
        return next
      })
    }
    
    // Note: using the component-level getMissingDayId which includes sourceFile for uniqueness
    
    if (shouldCollapse) {
      // Collapsed view for 3+ consecutive days
      const dateRangeStr = `${format(range.start, 'MMM d')} - ${format(range.end, 'MMM d, yyyy')}`
      return (
        <tr 
          key={rangeKey}
          className={`${rowBg} ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-100'}`}
        >
          <td className="p-0 w-3"></td>
          <td colSpan={tableColSpan} className={`${tdClass} py-3`}>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleExpand}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {dateRangeStr} — <span className="text-amber-500">{range.count} days with no trades</span>
                </span>
              </button>
            </div>
          </td>
        </tr>
      )
    }
    
    // Weekdays only (NYC calendar); never show Sat/Sun NO TRADE rows
    const daysToShow = getTradingDaysBetween(range.start, range.end).filter(
      day => !isWeekend(day)
    )
    
    return (
      <React.Fragment key={rangeKey}>
        {daysToShow.map((day, dayIndex) => {
          const dayId = getMissingDayId(day)
          const dayImages = tradeImages[dayId] || []
          const isUploading = uploadingTrades.has(dayId)
          const dayRowBg = (rowIndex + dayIndex) % 2 === 0 ? (darkMode ? 'bg-gray-800' : 'bg-white') : (darkMode ? 'bg-gray-850' : 'bg-gray-50')
          
          const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            if (e.target.files && e.target.files.length > 0) {
              uploadImages(dayId, e.target.files)
              setHighlightedRowId(dayId)
            }
            e.target.value = ''
          }
          
          return (
            <tr 
              key={`${rangeKey}-${dayIndex}`}
              data-trade-id={dayId}
              className={`${dayRowBg} ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-100'} ${highlightedRowId === dayId ? 'ring-2 ring-yellow-400 ring-inset' : ''}`}
            >
              <td className="p-0 w-3"></td>
              <td className={tdClass}>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {formatInTimeZone(day, DISPLAY_TIMEZONE, 'MMM dd, yyyy')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatInTimeZone(day, DISPLAY_TIMEZONE, 'EEE')}
                  </span>
                </div>
              </td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>
                <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-500/20 text-gray-400">
                  NO TRADE
                </span>
              </td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>-</td>
              <td className={tdClass}>
                {/* Screenshots upload for missing day */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {dayImages.map((img, imgIdx) => (
                    <button
                      key={imgIdx}
                      onClick={() => openModal(dayId, imgIdx)}
                      className="w-8 h-8 rounded overflow-hidden border border-gray-600 hover:border-blue-400 transition-colors relative group"
                    >
                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <label className={`p-1.5 rounded cursor-pointer transition-colors ${isUploading ? 'opacity-50' : darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}>
                    <ImagePlus className="h-4 w-4 text-muted-foreground" />
                    <input type="file" accept="image/*" multiple onChange={handleFileChange} disabled={isUploading} className="hidden" />
                  </label>
                </div>
              </td>
            </tr>
          )
        })}
        {/* Show collapse button if expanded */}
        {range.count >= 3 && isExpanded && (
          <tr className={rowBg}>
            <td className="p-0 w-3"></td>
            <td colSpan={tableColSpan} className={`${tdClass} py-1`}>
              <button
                onClick={toggleExpand}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronUp className="h-3 w-3" />
                <span>Collapse {range.count} days</span>
              </button>
            </td>
          </tr>
        )}
      </React.Fragment>
    )
  }

  return (
    <div className={embedded ? 'mb-0' : 'mb-8'}>
      {!embedded && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold">Trade Journal</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Equity curve shows all trades by default. Click a trade for that day&apos;s session curve, or use tag filters to narrow the curve. Click a day badge to collapse or expand grouped trades.
            </p>
          </div>
          <span className="text-sm text-muted-foreground">{sortedTrades.length} trades</span>
        </div>
      )}

      {embedded && embeddedTitle && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-0.5">
          <h4 className="text-sm font-semibold text-muted-foreground">{embeddedTitle}</h4>
          <span className="text-xs text-muted-foreground">
            {onHighlightedTradeChange
              ? 'Click a row for notes, images, and its position on the equity curve'
              : 'Click a row for notes &amp; images beside the table'}
          </span>
        </div>
      )}
      
      {!embedded && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center mb-4">
          <TagFilterBar
            mode={tagFilterMode}
            setMode={setTagFilterMode}
            selectedTags={tagFilterTags}
            setSelectedTags={setTagFilterTags}
            ringOffsetClass="ring-offset-gray-900"
            className="mb-0"
          />
          <FlagFilterBar
            showFlaggedOnly={showFlaggedOnly}
            setShowFlaggedOnly={setShowFlaggedOnly}
            flaggedCount={flaggedInViewCount}
            ringOffsetClass="ring-offset-gray-900"
          />
        </div>
      )}

      {!embedded && equityCurveTrades.length > 0 && (
        <div ref={dailyChartRef} className="mb-4">
          <DailyEquityCurveChart
            title={equityCurveTitle}
            dayLabel={equityCurveLabel}
            totalPnL={equityCurveTotalPnL}
            tradeCount={equityCurveTrades.length}
            data={equityCurveData}
            darkMode={darkMode}
            onClose={equityCurveDayKey ? () => setEquityCurveDayKey(null) : undefined}
            highlightedPoint={highlightedCurvePoint}
          />
        </div>
      )}
      
      {/* Notes panel + trade table side-by-side when a row is selected */}
      <div
        className={
          highlightedRowId
            ? embedded
              ? 'flex flex-col lg:flex-row gap-4 items-start'
              : 'flex flex-col xl:flex-row gap-4 items-start'
            : undefined
        }
      >
      {highlightedRowId && (() => {
        const selectedTrade = sortedTrades.find(t => getTradeId(t) === highlightedRowId)
        if (!selectedTrade) return null
        const selImages = tradeImages[highlightedRowId] || []
        const selNote = tradeNotes[highlightedRowId] ?? ''
        const isUploadingSel = uploadingTrades.has(highlightedRowId)
        const selDate = selectedTrade.timestamp
          ? formatInTimeZone(
              parseLocalTimestamp(selectedTrade.timestamp),
              DISPLAY_TIMEZONE,
              'M/d/yy'
            )
          : ''
        const selPnl = selectedTrade.pnl != null ? formatUsdPnl(selectedTrade.pnl) : 'N/A'
        const selectedSetupTags = tradeSetupTags[highlightedRowId] || []
        const setupTagRating = countSetupTagRating(selectedSetupTags)
        const tradeRating = getTradeRating(highlightedRowId)
        const isRatingManual = tradeRatingManual[highlightedRowId] ?? false
        const handlePanelPaste = (e: React.ClipboardEvent) => {
          const data = e.clipboardData
          if (!data) return
          const files: File[] = []
          // Check clipboardData.files (some browsers put pasted image here)
          if (data.files?.length) {
            for (let i = 0; i < data.files.length; i++) {
              const f = data.files[i]
              if (f.type?.startsWith('image/')) files.push(f)
            }
          }
          // Also check clipboardData.items (getAsFile for image types)
          if (data.items?.length && files.length === 0) {
            for (let i = 0; i < data.items.length; i++) {
              const item = data.items[i]
              if (item.kind === 'file' && item.type?.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) files.push(file)
              }
            }
          }
          if (files.length > 0) {
            e.preventDefault()
            e.stopPropagation()
            const dt = new DataTransfer()
            files.forEach(f => dt.items.add(f))
            uploadImages(highlightedRowId, dt.files, activeImageSection)
          }
        }

        const beforeImages = imagesForSection(selImages, 'before')
        const afterImages = imagesForSection(selImages, 'after')
        const selVideos = tradeVideos[highlightedRowId] || []
        const isUploadingSelVideo = uploadingVideos.has(highlightedRowId)
        const selVideoProgress = videoUploadProgress[highlightedRowId]

        const renderImageSection = (
          section: TradeImageSection,
          title: string,
          sectionImages: TradeImage[],
          inputRef: React.RefObject<HTMLInputElement | null>
        ) => (
          <div
            key={section}
            className="flex flex-col"
            onMouseEnter={() => setActiveImageSection(section)}
            onFocusCapture={() => setActiveImageSection(section)}
          >
            <label
              className={`block text-sm font-bold mb-2 ${
                section === 'after' ? 'text-purple-400' : 'text-blue-400'
              }`}
            >
              {title}
            </label>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  uploadImages(highlightedRowId, e.target.files, section)
                }
                e.target.value = ''
              }}
              disabled={isUploadingSel}
            />
            <div
              className={`rounded-lg border p-3 ${
                activeImageSection === section
                  ? darkMode
                    ? 'bg-gray-900/80 border-blue-500/50 ring-1 ring-blue-500/30'
                    : 'bg-white border-blue-400/60 ring-1 ring-blue-400/30'
                  : darkMode
                    ? 'bg-gray-900/50 border-gray-600'
                    : 'bg-gray-50 border-gray-200'
              }`}
            >
              {sectionImages.length === 0 && !isUploadingSel ? (
                <div className="min-h-[120px] flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                  Paste (Ctrl+V) or add files below
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {sectionImages.map((img, idx) => (
                    <div key={img.name ?? idx} className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          openModal(
                            highlightedRowId,
                            globalImageIndex(selImages, section, idx)
                          )
                        }
                        className={`w-full rounded-lg border p-3 flex items-center justify-center transition-colors duration-150 ${
                          darkMode
                            ? 'border-gray-600 hover:border-blue-400 bg-gray-900/40'
                            : 'border-gray-300 hover:border-blue-500 bg-white'
                        }`}
                      >
                        <FitImageViewer
                          src={img.url}
                          alt={img.name}
                          maxHeight="none"
                          className="mx-auto"
                        />
                      </button>
                      {sectionImages.length > 1 && (
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {idx + 1} of {sectionImages.length}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() =>
                                void moveImageInSection(
                                  highlightedRowId,
                                  section,
                                  idx,
                                  'up'
                                )
                              }
                              className={`p-1 rounded transition-colors ${
                                idx === 0
                                  ? 'opacity-30 cursor-not-allowed'
                                  : darkMode
                                    ? 'hover:bg-gray-700 text-gray-300'
                                    : 'hover:bg-gray-200 text-gray-600'
                              }`}
                              title="Move up"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === sectionImages.length - 1}
                              onClick={() =>
                                void moveImageInSection(
                                  highlightedRowId,
                                  section,
                                  idx,
                                  'down'
                                )
                              }
                              className={`p-1 rounded transition-colors ${
                                idx === sectionImages.length - 1
                                  ? 'opacity-30 cursor-not-allowed'
                                  : darkMode
                                    ? 'hover:bg-gray-700 text-gray-300'
                                    : 'hover:bg-gray-200 text-gray-600'
                              }`}
                              title="Move down"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveImageSection(section)
                inputRef.current?.click()
              }}
              disabled={isUploadingSel}
              className={`mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border-2 border-dashed text-xs font-medium transition-all duration-150 ${
                isUploadingSel
                  ? 'opacity-50 cursor-not-allowed'
                  : darkMode
                    ? 'border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-400 hover:bg-blue-400/5'
                    : 'border-gray-300 text-gray-500 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-500/5'
              }`}
              title={`Add ${title.toLowerCase()} image from file`}
            >
              <Plus className="h-4 w-4" />
              Add {title.toLowerCase()} image
            </button>
          </div>
        )

        return (
          <div
            className={`rounded-xl border shadow-lg flex flex-col transition-all duration-200 ease-out shrink-0 w-full ${
              embedded
                ? 'lg:w-[min(48%,520px)]'
                : 'xl:w-[min(42vw,560px)]'
            } ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            onPasteCapture={handlePanelPaste}
          >
            <div className={`flex items-center justify-between shrink-0 px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div>
                <h3 className="text-xl font-semibold">
                  Trade notes & images — {selDate} ({selPnl})
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {journalSaveStatus[highlightedRowId] === 'saving' && 'Saving…'}
                  {journalSaveStatus[highlightedRowId] === 'saved' && 'All changes saved'}
                  {journalSaveStatus[highlightedRowId] === 'error' && 'Save failed — retry by editing'}
                  {(journalSaveStatus[highlightedRowId] === 'idle' ||
                    !journalSaveStatus[highlightedRowId]) &&
                    'Notes, tags, and photos auto-save'}
                </p>
              </div>
              <button
                onClick={() => setHighlightedRowId(null)}
                className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">
                  Trade tags
                </label>
                {renderTradeTagGrid(highlightedRowId, 'panel')}
                <p className="text-xs text-muted-foreground mt-2">
                  Toggle tags for this trade without leaving the notes panel.
                </p>
              </div>

              <div className={`pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <label className="block text-sm font-medium text-muted-foreground mb-3">Setup tags</label>
                <div className="flex flex-wrap gap-2">
                  {SETUP_RATING_TAGS.map((tag) => {
                    const isSelected = selectedSetupTags.includes(tag.name)
                    return (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => toggleSetupTag(highlightedRowId, tag.name)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                          isSelected
                            ? `${tag.color} ring-2 ring-amber-400/70 ring-offset-1 ${darkMode ? 'ring-offset-gray-800' : 'ring-offset-white'}`
                            : darkMode
                              ? 'bg-gray-900/60 text-gray-400 border-gray-600 hover:border-gray-500 hover:text-gray-200'
                              : 'bg-gray-100 text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800'
                        }`}
                      >
                        {tag.name}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Toggle each setup present on this trade. Each tag adds 1 star (maximum 5).
                </p>
              </div>

              <div className={`pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <label className="text-sm font-medium text-muted-foreground">Trade rating</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatTradeRatingLabel(tradeRating)}/5
                      {isRatingManual ? ' · manual' : ` · from setup (${setupTagRating})`}
                    </span>
                    <StarRating
                      rating={tradeRating}
                      onRatingChange={rating => handleTradeRatingChange(highlightedRowId, rating)}
                      size={18}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click a star for half-star steps. Click the same value again to clear and use setup-tag auto rating.
                </p>
              </div>

              <div className={`flex flex-col pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Notes
                </label>
                <textarea
                  value={selNote}
                  onChange={(e) => scheduleTradeNoteSave(highlightedRowId, e.target.value)}
                  placeholder="Add notes about this trade..."
                  className={`min-h-[200px] w-full px-4 py-3 rounded-lg resize-y text-base border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow duration-150 ${darkMode ? 'bg-gray-900 border-gray-600 text-gray-100' : 'bg-white border-gray-300'}`}
                  rows={8}
                />
              </div>

              <div className={`flex flex-col gap-3 pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <p className="text-xs text-muted-foreground">
                  Paste screenshots with Ctrl+V into the highlighted{' '}
                  {tradeImageSectionLabel('before')} or {tradeImageSectionLabel('after')} section.
                </p>
                <div className="flex flex-col gap-6">
                  {renderImageSection(
                    'before',
                    tradeImageSectionLabel('before'),
                    beforeImages,
                    panelBeforeImageInputRef
                  )}
                  {renderImageSection(
                    'after',
                    tradeImageSectionLabel('after'),
                    afterImages,
                    panelAfterImageInputRef
                  )}
                </div>
              </div>

              <div className={`flex flex-col gap-3 pt-6 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <label className="block text-sm font-bold text-purple-400">Videos</label>
                <input
                  ref={panelVideoInputRef}
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.mov,.avi"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleVideoSelect(highlightedRowId, e.target.files)
                    }
                    e.target.value = ''
                  }}
                  disabled={isUploadingSelVideo}
                />
                <div
                  className={`rounded-lg border p-3 ${
                    darkMode ? 'bg-gray-900/50 border-gray-600' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  {selVideos.length === 0 && !isUploadingSelVideo ? (
                    <div className="min-h-[120px] flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                      No videos yet — add a recording below
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {selVideos.map((vid, vidIdx) => (
                        <div
                          key={vid.id}
                          className={`relative w-full rounded-lg border p-3 transition-colors duration-150 ${
                            darkMode
                              ? 'border-gray-600 bg-gray-900/40'
                              : 'border-gray-300 bg-white'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void deleteVideo(highlightedRowId, vid.id)}
                            className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/60 text-red-400 hover:bg-red-500/30 transition-colors"
                            title="Delete video"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <FitVideoViewer
                            src={vid.url}
                            className="mx-auto"
                            title={vid.originalName}
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground truncate min-w-0 pr-8">
                              {vid.originalName}
                              {vid.clipStartSec !== undefined && (
                                <span className="ml-2 text-purple-400">Clip</span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              {vid.durationSec != null && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {formatVideoTime(vid.durationSec)}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openVideoModal(highlightedRowId, vidIdx)}
                                className={`text-xs px-2 py-1 rounded transition-colors ${
                                  darkMode
                                    ? 'text-purple-300 hover:bg-gray-700'
                                    : 'text-purple-600 hover:bg-gray-100'
                                }`}
                                title="Open full player or trim"
                              >
                                Full screen
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isUploadingSelVideo && (
                    <p className="text-xs text-purple-400 animate-pulse mt-3 text-center">
                      {selVideoProgress?.phase === 'uploading'
                        ? `Uploading ${selVideoProgress.percent ?? 0}%…`
                        : 'Converting video…'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => panelVideoInputRef.current?.click()}
                  disabled={isUploadingSelVideo}
                  className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border-2 border-dashed text-xs font-medium transition-all duration-150 ${
                    isUploadingSelVideo
                      ? 'opacity-50 cursor-not-allowed'
                      : darkMode
                        ? 'border-gray-600 text-gray-400 hover:border-purple-400 hover:text-purple-400 hover:bg-purple-400/5'
                        : 'border-gray-300 text-gray-500 hover:border-purple-500 hover:text-purple-500 hover:bg-purple-500/5'
                  }`}
                  title="Attach trade video"
                >
                  <Video className="h-4 w-4" />
                  Add video
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <div className={highlightedRowId ? 'flex-1 min-w-0 w-full' : 'w-full'}>
      <div 
        ref={tableContainerRef}
        className="overflow-x-auto rounded-lg border border-gray-700 scroll-smooth"
      >
        <table className={tableClass}>
          <thead className={darkMode ? 'bg-gray-800' : 'bg-white'}>
            <tr className={darkMode ? 'bg-gray-800' : 'bg-white'}>
              <th className={`${thClass} w-6 p-0`}></th>
              {showFlagColumn && <th className={`${thClass} w-8 text-center`}>Flag</th>}
              {showEquityIndexCol && <th className={thClass}>#</th>}
              <th className={thClass}>
                <button 
                  onClick={() => handleSort('date')} 
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  Date {renderSortIcon('date')}
                </button>
              </th>
              <th className={thClass}>Time</th>
              <th className={thClass}>
                <button 
                  onClick={() => handleSort('direction')} 
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  Direction {renderSortIcon('direction')}
                </button>
              </th>
              <th className={thClass}>Entry</th>
              <th className={thClass}>Exit</th>
              <th className={thClass}>Qty</th>
              <th className={thClass}>Risk ($)</th>
              <th className={thClass}>
                <button 
                  onClick={() => handleSort('rr')} 
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  R:R {renderSortIcon('rr')}
                </button>
              </th>
              <th className={thClass}>
                <button 
                  onClick={() => handleSort('pnl')} 
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  P&L {renderSortIcon('pnl')}
                </button>
              </th>
              <th className={thClass}>
                <button 
                  onClick={() => handleSort('result')} 
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  Result {renderSortIcon('result')}
                </button>
              </th>
              <th className={thClass}>Trade Rating</th>
              <th className={thClass}>Tags</th>
              <th className={thClass}>Screenshots</th>
            </tr>
          </thead>
          <tbody>
            {journalEntries.map((entry, entryIndex) => {
              // Render missing day range
              if (entry.type === 'missingRange') {
                return renderMissingDayRow(entry.range, entry.key, entryIndex)
              }
              
              // Render week recap row
              if (entry.type === 'weekRecap') {
                const weekNote = weeklyNotes[entry.weekKey]
                const hasNote = weekNote && weekNote.content.trim().length > 0
                const notePreview = hasNote 
                  ? (weekNote.content.length > 60 ? weekNote.content.slice(0, 60) + '...' : weekNote.content)
                  : null
                
                return (
                  <tr 
                    key={`week-${entry.weekKey}`}
                    className={`${darkMode ? 'bg-indigo-900/30 border-y border-indigo-500/30' : 'bg-indigo-50 border-y border-indigo-200'}`}
                  >
                    <td className="p-0 w-6"></td>
                    {showFlagColumn && <td className="p-0 w-8" />}
                    <td colSpan={tableColSpan} className={`${tdClass} py-3`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${darkMode ? 'bg-indigo-500/20' : 'bg-indigo-100'}`}>
                            <BookOpen className="h-4 w-4 text-indigo-400" />
                            <span className="font-semibold text-indigo-400">
                              Week {entry.weekKey.split('-W')[1]}
                            </span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {format(entry.weekStart, 'MMM d')} - {format(entry.weekEnd, 'MMM d, yyyy')}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3 flex-1 justify-end">
                          {notePreview && (
                            <span className="text-sm text-muted-foreground italic truncate max-w-md">
                              {`"${notePreview}"`}
                            </span>
                          )}
                          <button
                            onClick={() => openWeeklyNoteEditor(entry.weekKey)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              hasNote
                                ? darkMode ? 'bg-indigo-500/30 text-indigo-300 hover:bg-indigo-500/40' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            {hasNote ? 'Edit Recap' : 'Add Recap'}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              }
              
              // Render trade row
              const trade = entry.trade
              const index = entry.index
              const tradeDate = trade.timestamp ? parseLocalTimestamp(trade.timestamp) : null
              const dateStr = tradeDate
                ? isCompactTable
                  ? formatInTimeZone(tradeDate, DISPLAY_TIMEZONE, 'M/d')
                  : formatInTimeZone(tradeDate, DISPLAY_TIMEZONE, 'MMM dd, yyyy')
                : 'N/A'
              const dateTitle = tradeDate
                ? formatInTimeZone(tradeDate, DISPLAY_TIMEZONE, 'EEE, MMM d, yyyy')
                : undefined
              const dayOfWeek = tradeDate
                ? formatInTimeZone(tradeDate, DISPLAY_TIMEZONE, 'EEE')
                : ''
              const timeStr = formatJournalTradeTime(trade)
              const tradeId = getTradeId(trade)
              const tradeResult = getTradeResult(trade, tradeTags)
              const direction = trade.direction?.toUpperCase() || 'N/A'
              const images = tradeImages[tradeId] || []
              const isUploading = uploadingTrades.has(tradeId)
              
              // Get first image note preview
              const hasNotes = images.some(img => img.note && img.note.trim().length > 0)
              
              const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                if (e.target.files && e.target.files.length > 0) {
                  uploadImages(tradeId, e.target.files)
                  setHighlightedRowId(tradeId)
                }
                e.target.value = ''
              }
              
              const hasPartialExits = trade.partialExits && trade.partialExits.length > 0
              const rowBg = index % 2 === 0 ? (darkMode ? 'bg-gray-800' : 'bg-white') : (darkMode ? 'bg-gray-850' : 'bg-gray-50')
              
              // Render partial exit row
              const renderPartialRow = (exit: PartialExit, exitIndex: number) => {
                const exitType = exit.isFinal ? 'Final' : 'Partial'
                const exitPnlPositive = exit.pnl > 0
                const groupInfo = dayGroups[index]
                const groupColor = groupInfo ? dayGroupColors[groupInfo.colorIndex] : null
                
                return (
                  <tr 
                    key={`${index}-exit-${exitIndex}`}
                    className={`${darkMode ? 'bg-gray-900/50' : 'bg-gray-100/50'} ${groupInfo && groupColor ? groupColor.bg : ''}`}
                  >
                    {/* Day grouping bracket continuation */}
                    <td className="p-0 w-6 relative">
                      {groupInfo && groupColor && (
                        <div 
                          className={`absolute right-2 w-1 h-full ${groupColor.bar}`}
                        />
                      )}
                    </td>
                    {showEquityIndexCol && <td className={tdClass} />}
                    <td className={`${tdClass} pl-6`}>
                      <span className="text-muted-foreground text-xs">└─</span>
                    </td>
                    <td className={tdClass}>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${exit.isFinal ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                        {exitType} ({exit.contracts} ct)
                      </span>
                    </td>
                    <td className={tdClass}>-</td>
                    <td className={tdClass}>
                      <span className={`text-xs ${exitPnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {exit.reward?.toFixed(1) || '-'} pts
                      </span>
                    </td>
                    <td className={tdClass}>{exit.entryPrice ? formatPrice(exit.entryPrice) : '-'}</td>
                    <td className={tdClass}>{exit.exitPrice ? formatPrice(exit.exitPrice) : '-'}</td>
                    <td className={tdClass}>{exit.contracts}</td>
                    <td className={tdClass}>{exit.estRisk != null ? formatUsd(exit.estRisk) : '-'}</td>
                    <td className={`${tdClass} ${(getPartialExitRMultiple(exit) ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {getPartialExitRMultiple(exit) !== null ? `${getPartialExitRMultiple(exit)!.toFixed(1)}R` : '-'}
                    </td>
                    <td className={`${tdClass} ${exitPnlPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {formatUsdPnl(exit.pnl)}
                    </td>
                    <td className={tdClass}></td>
                    <td className={tdClass}></td>
                    <td className={tdClass}></td>
                    <td className={tdClass}></td>
                  </tr>
                )
              }
              
              const groupInfo = dayGroups[index]
              const groupColor = groupInfo ? dayGroupColors[groupInfo.colorIndex] : null
              const isDayCollapsed =
                !embedded &&
                groupInfo != null &&
                groupInfo.groupSize > 1 &&
                collapsedDayKeys.has(groupInfo.dateKey)

              if (isDayCollapsed && groupInfo && !groupInfo.isFirst) {
                return null
              }

              if (isDayCollapsed && groupInfo?.isFirst) {
                const dayStats = dayGroupStats[groupInfo.dateKey]
                const dayTotalPnL = dayStats?.totalPnL ?? 0
                return (
                  <tr
                    key={`collapsed-${groupInfo.dateKey}`}
                    className={`cursor-pointer ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-50'} ${groupColor?.bg ?? ''}`}
                    onClick={() => toggleDayCollapse(groupInfo.dateKey)}
                  >
                    <td className="p-0 w-6 relative">
                      {groupColor && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            toggleDayCollapse(groupInfo.dateKey)
                          }}
                          className={`absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${groupColor.bar} flex items-center justify-center text-white shadow-md hover:opacity-90`}
                          title={`Expand ${groupInfo.groupSize} trades`}
                          aria-label={`Expand ${groupInfo.groupSize} trades on ${dateKeyToLabel(groupInfo.dateKey)}`}
                        >
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                    {showFlagColumn && <td className="p-0 w-8" />}
                    {showEquityIndexCol && <td className={tdClass} />}
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{dateStr}</span>
                        {dayOfWeek && (
                          <span className="text-xs text-muted-foreground">{dayOfWeek}</span>
                        )}
                      </div>
                    </td>
                    <td colSpan={7} className={`${tdClass} text-sm text-muted-foreground`}>
                      {groupInfo.groupSize} trades collapsed · click to expand
                    </td>
                    <td
                      className={`${tdClass} font-semibold tabular-nums ${
                        dayTotalPnL > 0
                          ? 'text-green-400'
                          : dayTotalPnL < 0
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {formatUsdPnl(dayTotalPnL)}
                    </td>
                    <td colSpan={4} className={tdClass} />
                  </tr>
                )
              }
              
              return (
                <React.Fragment key={index}>
                  <tr 
                    data-trade-id={tradeId}
                    onClick={() => {
                      setHighlightedRowId(tradeId)
                      const dayKey = groupInfo?.dateKey ?? getJournalTradeDayKey(trade)
                      if (dayKey) setEquityCurveDayKey(dayKey)
                    }}
                    className={`group cursor-pointer relative transition-[box-shadow] duration-150 ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-50'} ${rowBg} ${highlightedRowId === tradeId ? 'ring-2 ring-yellow-400 ring-inset' : 'hover:ring-2 hover:ring-blue-400 hover:ring-inset'} ${groupInfo ? groupColor?.bg : ''} ${equityCurveDayKey && groupInfo?.dateKey === equityCurveDayKey ? 'bg-blue-500/[0.06]' : ''}`}
                  >
                    {/* Day grouping bracket */}
                    <td
                      className="p-0 w-6 relative"
                      style={{ minHeight: isCompactTable ? '30px' : '48px' }}
                    >
                      {groupInfo && groupColor && (
                        <>
                          {/* Vertical bar - for single trade show horizontal bar, for groups show connecting line */}
                          {groupInfo.isOnly ? (
                            /* Single trade: show horizontal marker */
                            <div 
                              className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
                            />
                          ) : (
                            <>
                              {/* Multi-trade: show vertical connecting line */}
                              <div 
                                className={`absolute right-2 w-1 ${groupColor.bar}`}
                                style={{
                                  top: groupInfo.isFirst ? '50%' : 0,
                                  bottom: groupInfo.isLast ? '50%' : 0,
                                }}
                              />
                              {/* Top horizontal connector */}
                              {groupInfo.isFirst && (
                                <div 
                                  className={`absolute right-2 top-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
                                />
                              )}
                              {/* Bottom horizontal connector */}
                              {groupInfo.isLast && (
                                <div 
                                  className={`absolute right-2 bottom-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
                                />
                              )}
                            </>
                          )}
                          {/* Group count badge on first row */}
                          {groupInfo.isFirst && groupInfo.groupSize > 1 && !embedded && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                toggleDayCollapse(groupInfo.dateKey)
                              }}
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${groupColor.bar} flex items-center justify-center text-[10px] font-bold text-white shadow-md hover:opacity-90`}
                              title={`Collapse ${groupInfo.groupSize} trades on ${format(parseLocalTimestamp(trade.timestamp!), 'MMM d')}`}
                              aria-label={`Collapse ${groupInfo.groupSize} trades on ${dateKeyToLabel(groupInfo.dateKey)}`}
                            >
                              {collapsedDayKeys.has(groupInfo.dateKey) ? (
                                <ChevronRight className="h-3 w-3" />
                              ) : (
                                groupInfo.groupSize
                              )}
                            </button>
                          )}
                          {groupInfo.isFirst && (groupInfo.groupSize === 1 || embedded) && (
                            <div 
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${groupColor.bar} flex items-center justify-center text-[10px] font-bold text-white shadow-md`}
                              title={`${groupInfo.groupSize} trade${groupInfo.groupSize > 1 ? 's' : ''} on ${format(parseLocalTimestamp(trade.timestamp!), 'MMM d')}`}
                            >
                              {groupInfo.groupSize}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    {showFlagColumn && (
                      <td className={`${tdClass} w-8 text-center p-1`}>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            onToggleTradeFlag?.(tradeId, !flaggedTrades[tradeId])
                          }}
                          className="inline-flex items-center justify-center p-0.5 rounded hover:bg-amber-500/10"
                          aria-label={flaggedTrades[tradeId] ? 'Unflag trade' : 'Flag trade for review'}
                          title={flaggedTrades[tradeId] ? 'Unflag trade' : 'Flag trade for review'}
                        >
                          <Flag
                            className={`h-3.5 w-3.5 ${
                              flaggedTrades[tradeId]
                                ? 'text-amber-400 fill-amber-400/30'
                                : 'text-muted-foreground/40 hover:text-amber-400/70'
                            }`}
                          />
                        </button>
                      </td>
                    )}
                    {showEquityIndexCol && (
                      <td className={`${tdClass} text-muted-foreground tabular-nums`}>
                        {equityIndexByTradeId?.[tradeId] ?? '—'}
                      </td>
                    )}
                    <td
                      className={`${tdClass} ${!embedded ? 'cursor-pointer hover:bg-blue-500/5' : ''} ${equityCurveDayKey && groupInfo?.dateKey === equityCurveDayKey ? 'ring-1 ring-inset ring-blue-400/50' : ''}`}
                      title={dateTitle ? `${dateTitle} — click for daily P&L curve` : undefined}
                      onClick={(e) => {
                        e.stopPropagation()
                        const dayKey = groupInfo?.dateKey ?? getJournalTradeDayKey(trade)
                        if (!dayKey) return
                        setEquityCurveDayKey(prev => (prev === dayKey ? null : dayKey))
                      }}
                    >
                      {isCompactTable ? (
                        <span className="font-medium whitespace-nowrap tabular-nums">
                          {dateStr}
                          {dayOfWeek && (
                            <span className="text-muted-foreground font-normal ml-1">
                              {dayOfWeek}
                            </span>
                          )}
                        </span>
                      ) : (
                        <div className="flex flex-col">
                          <span className="font-medium">{dateStr}</span>
                          <span className="text-xs text-muted-foreground">{dayOfWeek}</span>
                        </div>
                      )}
                    </td>
                    <td className={tdClass}>
                      <div className={`flex items-center ${isCompactTable ? 'gap-1' : 'gap-2'}`}>
                        {timeStr}
                        {hasPartialExits && (
                          <span
                            className={`${
                              isCompactTable ? 'text-[10px] px-1 py-0' : 'text-xs px-1.5 py-0.5'
                            } rounded bg-purple-500/20 text-purple-400`}
                          >
                            {isCompactTable
                              ? `${trade.partialExits!.length}×`
                              : `${trade.partialExits!.length} exits`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${tdClass} ${direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                      {direction}
                    </td>
                    <td className={tdClass}>{formatPrice(trade.entryPrice)}</td>
                    <td className={tdClass}>{formatPrice(trade.exitPrice)}</td>
                    <td className={tdClass}>{trade.orderQty || 'N/A'}</td>
                    <td className={tdClass}>{formatUsd(getTradeDollarRisk(trade))}</td>
                    <td className={`${tdClass} ${
                      tradeResult === 'WIN' ? 'text-green-400' : 
                      tradeResult === 'LOSS' ? 'text-red-400' : 
                      'text-amber-400'
                    }`}>
                      {getTradeRMultiple(trade) !== null ? `${getTradeRMultiple(trade)!.toFixed(1)}R` : 'N/A'}
                    </td>
                    <td className={`${tdClass} font-medium ${
                      tradeResult === 'WIN' ? 'text-green-400' : 
                      tradeResult === 'LOSS' ? 'text-red-400' : 
                      'text-amber-400'
                    }`}>
                      {formatUsdPnlOrNa(trade.pnl)}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`font-semibold rounded ${
                          isCompactTable ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
                        } ${
                        tradeResult === 'WIN' ? 'bg-green-500/20 text-green-400' : 
                        tradeResult === 'LOSS' ? 'bg-red-500/20 text-red-400' : 
                        'bg-amber-500/20 text-amber-400'
                      }`}
                      >
                        {tradeResult}
                      </span>
                    </td>
                    <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                      <StarRating
                        rating={getTradeRating(tradeId)}
                        onRatingChange={rating => handleTradeRatingChange(tradeId, rating)}
                        size={isCompactTable ? 13 : 16}
                      />
                    </td>
                    <td className={tdClass}>
                      {(() => {
                        const tags = tradeTags[tradeId] || []
                        const isExpanded = expandedTagRows.has(tradeId)
                        const visibleTags = isExpanded ? tags : tags.slice(0, 2)
                        const hiddenCount = tags.length - 2
                        
                        return (
                          <div className="flex items-center gap-1 min-w-[120px]">
                            {/* Visible tags */}
                            {visibleTags.map((tag, tagIdx) => (
                              <span
                                key={tagIdx}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border ${getTagStyle(tag)}`}
                                onClick={() => setHighlightedRowId(tradeId)}
                              >
                                {tag.length > 10 ? tag.slice(0, 10) + '…' : tag}
                                <button
                                  onClick={() => {
                                    removeTag(tradeId, tag)
                                    setHighlightedRowId(tradeId)
                                  }}
                                  className="hover:text-white transition-colors ml-0.5"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                            
                            {/* Expand/collapse button */}
                            {!isExpanded && hiddenCount > 0 && (
                              <button
                                onClick={() => {
                                  setExpandedTagRows(prev => new Set(prev).add(tradeId))
                                  setHighlightedRowId(tradeId)
                                }}
                                className="text-[10px] text-blue-400 hover:text-blue-300"
                              >
                                +{hiddenCount}
                              </button>
                            )}
                            {isExpanded && tags.length > 2 && (
                              <button
                                onClick={() => {
                                  setExpandedTagRows(prev => {
                                    const next = new Set(prev)
                                    next.delete(tradeId)
                                    return next
                                  })
                                  setHighlightedRowId(tradeId)
                                }}
                                className="text-[10px] text-gray-400 hover:text-gray-300"
                              >
                                less
                              </button>
                            )}
                            
                            {/* Quick add button */}
                            <div className="relative">
                              <button
                                onClick={() => {
                                  setOpenTagPicker(openTagPicker === tradeId ? null : tradeId)
                                  setHighlightedRowId(tradeId)
                                }}
                                className={`p-0.5 rounded transition-colors ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                                title="Add tag"
                              >
                                <Tag className="h-3.5 w-3.5 text-blue-400" />
                              </button>
                              
                              {/* Tag picker dropdown */}
                              {openTagPicker === tradeId && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setOpenTagPicker(null)} />
                                  <div
                                    className={`absolute right-0 top-full mt-1 z-50 min-w-[min(92vw,36rem)] w-[36rem] max-w-[92vw] max-h-72 overflow-y-auto rounded-lg shadow-xl border ${
                                      darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                                    }`}
                                  >
                                    {renderTradeTagGrid(tradeId, 'dropdown')}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </td>
                    <td className={tdClass} onClick={(e) => e.stopPropagation()}>
                      <div className={`flex items-center ${isCompactTable ? 'gap-1' : 'gap-2'}`}>
                        {/* Upload button */}
                        <label
                          className={`${isCompactTable ? 'p-1' : 'p-1.5'} rounded cursor-pointer transition-colors ${isUploading ? 'opacity-50' : darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ImagePlus className={`${isCompactTable ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-blue-400`} />
                          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} disabled={isUploading} />
                        </label>
                        
                        {/* Thumbnails — hidden in notes view; images shown in side panel */}
                        {!isCompactTable && images.length > 0 && (
                          <div className="flex items-center gap-1">
                            {images.slice(0, 4).map((img, imgIdx) => (
                              <button
                                key={imgIdx}
                                onClick={() => openModal(tradeId, imgIdx)}
                                className={`w-8 h-8 rounded overflow-hidden border ${darkMode ? 'border-gray-600 hover:border-blue-400' : 'border-gray-300 hover:border-blue-500'} transition-colors`}
                              >
                                <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
                              </button>
                            ))}
                            {images.length > 4 && (
                              <span className="text-xs text-muted-foreground">+{images.length - 4}</span>
                            )}
                          </div>
                        )}
                        {isCompactTable && images.length > 0 && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {images.length} img
                          </span>
                        )}
                        
                        {/* Notes indicator */}
                        {hasNotes && (
                          <span title="Has notes">
                            <StickyNote className={`${isCompactTable ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-yellow-400`} />
                          </span>
                        )}
                        
                        {isUploading && <span className="text-xs text-blue-400 animate-pulse">...</span>}
                      </div>
                    </td>
                  </tr>
                  {/* Partial exit rows */}
                  {hasPartialExits && trade.partialExits!.map((exit, exitIndex) => renderPartialRow(exit, exitIndex))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      </div>
      </div>
      
      {renderImageModal()}
      {renderVideoPreviewModal()}
      {renderVideoModal()}
      
      {/* Weekly Note Editor Modal */}
      {editingWeekKey && (
        <WeeklyNoteModal
          weekKey={editingWeekKey}
          initialContent={weeklyNotes[editingWeekKey]?.content || ''}
          updatedAt={weeklyNotes[editingWeekKey]?.updatedAt}
          darkMode={darkMode}
          onSave={saveWeeklyNote}
          onClose={closeWeeklyNoteEditor}
        />
      )}
    </div>
  )
}

