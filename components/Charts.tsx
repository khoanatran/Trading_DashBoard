'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
  ScatterChart, Scatter, ReferenceLine, ReferenceDot, Customized, Sector, LabelList
} from 'recharts'
import { EquityCurveDrawdownLayer } from '@/components/EquityCurveDrawdownLayer'
import { useSignificantDrawdownEpisodes } from '@/hooks/useSignificantDrawdownEpisodes'
import {
  requestNavigateToDrawdownRecap,
  consumePendingEquityDrawdownKey,
  NAVIGATE_EQUITY_DRAWDOWN_EVENT,
} from '@/lib/drawdown-nav'
import {
  Trade,
  TradeStats,
  parseLocalTimestamp,
  getTradeCloseAt,
  getTradeRMultiple,
  getTradeResult,
  getARateBreakdown,
} from '@/utils/logParser'
import {
  getCloseDatePeriodKey,
  getDrawdownEpisodeKey,
  SIGNIFICANT_DRAWDOWN_MIN,
  type DrawdownEpisode,
} from '@/utils/logParser'
import type { DrawdownHighlight } from '@/components/EquityCurveDrawdownLayer'
import { formatUsd, formatUsdPnl } from '@/lib/format'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey } from '@/utils/tradingDays'
import { HelpCircle } from 'lucide-react'

// Chart Header with help tooltip
interface ChartHeaderProps {
  title: string
  help: string
  darkMode: boolean
  actions?: React.ReactNode
}

function ChartHeader({ title, help, darkMode, actions }: ChartHeaderProps) {
  const [showHelp, setShowHelp] = useState(false)
  
  return (
    <div className="flex items-center justify-between mb-4 gap-3">
      <h3 className="text-xl font-bold shrink-0">{title}</h3>
      <div className="flex items-center gap-3 min-w-0 flex-1 justify-end">
        {actions}
      <div className="relative shrink-0">
        <button
          onMouseEnter={() => setShowHelp(true)}
          onMouseLeave={() => setShowHelp(false)}
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 hover:bg-accent rounded-full transition-colors"
        >
          <HelpCircle className="h-5 w-5 text-muted-foreground hover:text-foreground" />
        </button>
        {showHelp && (
          <div className={`absolute right-0 top-full mt-2 w-72 p-3 rounded-lg shadow-lg z-50 text-sm ${
            darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'
          }`}>
            {help}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

interface ChartsProps {
  trades: Trade[]
  stats?: TradeStats
  allTrades?: Trade[] // All historical trades for lookback charts
  groupedData: Record<string, Trade[]>
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  darkMode: boolean
  showAllPeriods?: boolean // When true, show all data instead of just last 6 periods
  useAllTradesForTimeChart?: boolean // When true, use allTrades for entry time distribution (for "All Time" only)
  tradeTags?: Record<string, string[]>
}

const COLORS = ['#21C55E', '#EF4444', '#3b82f6', '#8b5cf6', '#f59e0b']
const A_RATE_COLOR = '#14b8a6'
const TRADES_BAR_COLOR = '#f59e0b'

/** Entry time scatter chart Y-axis: 9:15 AM – 12:00 PM ET (afternoon 12:00–17:00 expandable). */
const ENTRY_TIME_Y_START = 9 + 15 / 60 // 9:15
const ENTRY_TIME_MORNING_END = 12 // 12:00
const ENTRY_TIME_AFTERNOON_END = 17 // 17:00

function getEntryTimeYTicks(endHour: number): number[] {
  const ticks: number[] = []
  for (let minutes = 9 * 60 + 15; minutes <= endHour * 60; minutes += 15) {
    ticks.push(minutes / 60)
  }
  return ticks
}

function formatEntryTimeAxisTick(value: number): string {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}`
}

// Helper function to get period key for a date
function getPeriodKey(date: Date, period: 'daily' | 'weekly' | 'monthly' | 'yearly'): string {
  if (period === 'daily') {
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  } else if (period === 'weekly') {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
  } else if (period === 'monthly') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  } else {
    return `${date.getFullYear()}`
  }
}

// Generate last N period keys from current date
function getLastNPeriods(n: number, period: 'daily' | 'weekly' | 'monthly' | 'yearly'): string[] {
  const periods: string[] = []
  const now = new Date()
  
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(now)
    if (period === 'daily') {
      date.setDate(date.getDate() - i)
    } else if (period === 'weekly') {
      date.setDate(date.getDate() - i * 7)
    } else if (period === 'monthly') {
      date.setMonth(date.getMonth() - i)
    } else {
      date.setFullYear(date.getFullYear() - i)
    }
    periods.push(getPeriodKey(date, period))
  }
  
  return periods
}

// Format period type for chart titles (weekly -> Week, daily -> Day, etc.)
function formatPeriodTitle(periodType: string): string {
  switch (periodType) {
    case 'weekly': return 'Week'
    case 'daily': return 'Day'
    case 'monthly': return 'Month'
    case 'yearly': return 'Year'
    default: return periodType.charAt(0).toUpperCase() + periodType.slice(1)
  }
}

// Format period key for display (adds month name to weekly format)
function formatPeriodLabel(periodKey: string): string {
  // Check if it's a weekly format: YYYY-WXX
  const weekMatch = periodKey.match(/^(\d{4})-W(\d{2})$/)
  if (weekMatch) {
    const year = parseInt(weekMatch[1])
    const weekNum = parseInt(weekMatch[2])
    
    // Calculate the date for the start of that week
    // Week 1 starts on the first Thursday of the year
    const jan4 = new Date(year, 0, 4) // January 4th is always in week 1
    const jan4Day = jan4.getDay() // 0 = Sunday
    const weekStart = new Date(jan4)
    weekStart.setDate(jan4.getDate() - jan4Day + (weekNum - 1) * 7)
    
    // Get month abbreviation
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = monthNames[weekStart.getMonth()]
    
    return `${month} ${year} - Week ${weekNum}`
  }
  
  // Check if it's a monthly format: YYYY-MM
  const monthMatch = periodKey.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const year = parseInt(monthMatch[1])
    const monthNum = parseInt(monthMatch[2])
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[monthNum - 1]} ${year}`
  }
  
  // Return as-is for other formats (daily, yearly)
  return periodKey
}

export default function Charts({ trades, stats, allTrades, groupedData, period, darkMode, showAllPeriods = false, useAllTradesForTimeChart = false, tradeTags }: ChartsProps) {
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined)
  const [entryTimeShowAfternoon, setEntryTimeShowAfternoon] = useState(false)
  const [showDrawdownHighlights, setShowDrawdownHighlights] = useState(true)
  const [linkedDrawdownKey, setLinkedDrawdownKey] = useState<string | null>(null)

  // Get the current period key for highlighting
  const currentPeriodKey = useMemo(() => getPeriodKey(new Date(), period), [period])
  
  // Aggregate allTrades by period for historical lookback
  const allTradesGrouped = useMemo(() => {
    const grouped: Record<string, Trade[]> = {}
    const tradesToGroup = allTrades || trades || []
    
    tradesToGroup.forEach(trade => {
      if (!trade.isClosed) return
      const date = getTradeCloseAt(trade)
      if (!date) return
      const key = getCloseDatePeriodKey(date, period)
      
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(trade)
    })
    
    return grouped
  }, [allTrades, trades, period])
  
  const { drawdownSeries, episodes: significantDrawdownEpisodes } =
    useSignificantDrawdownEpisodes(trades ?? [])

  const drawdownHighlights = useMemo((): DrawdownHighlight[] => {
    const { maxDrawdown, peakIndex, troughIndex } = drawdownSeries
    return significantDrawdownEpisodes.map(ep => ({
      amount: ep.amount,
      peakIndex: ep.peakIndex,
      troughIndex: ep.troughIndex,
      peakPnl: ep.peakPnl,
      troughPnl: ep.troughPnl,
      peakSeriesPosition: ep.peakSeriesPosition,
      troughSeriesPosition: ep.troughSeriesPosition,
      episodeKey: getDrawdownEpisodeKey(ep),
      isPrimary:
        maxDrawdown > 0 &&
        peakIndex != null &&
        troughIndex != null &&
        ep.amount === maxDrawdown &&
        ep.peakIndex === peakIndex &&
        ep.troughIndex === troughIndex,
    }))
  }, [significantDrawdownEpisodes, drawdownSeries])

  const maxDrawdownHighlight = useMemo(
    () => drawdownHighlights.find(h => h.isPrimary) ?? null,
    [drawdownHighlights]
  )

  const episodeInRange = useMemo(() => {
    const ranges = drawdownHighlights.map(h => ({
      start: Math.min(h.peakIndex, h.troughIndex),
      end: Math.max(h.peakIndex, h.troughIndex),
      span: Math.abs(h.troughIndex - h.peakIndex),
      amount: h.amount,
      isPrimary: h.isPrimary ?? false,
    }))
    return (tradeIndex: number) => {
      const matches = ranges.filter(
        r => tradeIndex >= r.start && tradeIndex <= r.end
      )
      if (!matches.length) return null
      const primary = matches.find(r => r.isPrimary)
      if (primary) return primary
      return matches.reduce((best, r) => (r.span < best.span ? r : best))
    }
  }, [drawdownHighlights])

  // Prepare equity curve data with positive/negative split for coloring
  const equityCurveData = useMemo(() => {
    return drawdownSeries.points.map(point => {
      const range = episodeInRange(point.index)
      const inDrawdown = range != null
      return {
        index: point.index,
        seriesPosition: point.seriesPosition,
        pnl: point.pnl,
        pnlDrawdown: range?.isPrimary ? point.pnl : null,
        isMaxDrawdown: range?.isPrimary ?? false,
        isSignificantDrawdown: inDrawdown,
        drawdownAmount: range?.amount ?? null,
        dateLabel: point.closedAt
          ? formatInTimeZone(point.closedAt, DISPLAY_TIMEZONE, 'EEE, MMM d, yyyy')
          : 'N/A',
      }
    })
  }, [drawdownSeries, episodeInRange])

  const finalEquityPnl =
    drawdownSeries.points.length > 0
      ? drawdownSeries.points[drawdownSeries.points.length - 1].pnl
      : 0
  const equityStrokeColor = finalEquityPnl >= 0 ? '#21C55E' : '#EF4444'
  const equityGridColor = darkMode ? '#374151' : '#e5e7eb'
  const POSITIVE_TEXT_COLOR = '#21C55E'
  const NEGATIVE_TEXT_COLOR = '#EF4444'
  
  // Prepare win/loss/BE breakdown
  const winLossData = useMemo(() => {
    const tradesList = trades ?? []
    const tradesWithRR = tradesList.filter(t => getTradeRMultiple(t) !== null)
    const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
    const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
    const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
    
    return [
      { name: 'Wins', value: wins.length, color: '#21C55E' },
      { name: 'Losses', value: losses.length, color: '#EF4444' },
      { name: 'BE', value: breakevens.length, color: '#f59e0b' }
    ]
  }, [trades, tradeTags, darkMode])
  
  // Prepare win rate by period data with 6+ period lookback (or all for "All Time")
  const winRateData = useMemo(() => {
    const existingPeriods = Object.keys(allTradesGrouped).sort()
    
    let periodsToShow: string[]
    if (showAllPeriods) {
      // Show all periods for "All Time" view
      periodsToShow = existingPeriods
    } else {
      // Show last 6 periods for specific time filters
      const lookbackPeriods = getLastNPeriods(6, period)
      const allPeriodKeys = [...new Set([...lookbackPeriods, ...existingPeriods])].sort()
      periodsToShow = allPeriodKeys.slice(-6)
    }
    
    return periodsToShow.map(periodKey => {
      const periodTrades = allTradesGrouped[periodKey] || []
      const tradesWithRR = periodTrades.filter(t => getTradeRMultiple(t) !== null)
      const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
      const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
      // Win rate excludes BE trades
      const decisiveTrades = wins.length + losses.length
      const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0
      return {
        period: formatPeriodLabel(periodKey),
        winRate: winRate,
        trades: periodTrades.length,
        isCurrent: periodKey === currentPeriodKey
      }
    })
  }, [allTradesGrouped, period, currentPeriodKey, showAllPeriods, tradeTags])
  
  // Prepare A Rate by period with 6+ period lookback (or all for "All Time")
  const aRateData = useMemo(() => {
    const existingPeriods = Object.keys(allTradesGrouped).sort()
    
    let periodsToShow: string[]
    if (showAllPeriods) {
      periodsToShow = existingPeriods
    } else {
      const lookbackPeriods = getLastNPeriods(6, period)
      const allPeriodKeys = [...new Set([...lookbackPeriods, ...existingPeriods])].sort()
      periodsToShow = allPeriodKeys.slice(-6)
    }
    
    return periodsToShow.map(periodKey => {
      const periodTrades = allTradesGrouped[periodKey] || []
      const { aCount, decisiveTrades, aRate } = getARateBreakdown(periodTrades, tradeTags)
      return {
        period: formatPeriodLabel(periodKey),
        aRate,
        aCount,
        decisiveTrades,
        tradeCount: periodTrades.length,
        isCurrent: periodKey === currentPeriodKey
      }
    })
  }, [allTradesGrouped, period, currentPeriodKey, showAllPeriods, tradeTags])

  const aRateTradeDomain = useMemo(() => {
    const maxTrades = Math.max(...aRateData.map(d => d.tradeCount), 0)
    return [0, Math.ceil(maxTrades * 1.15) || 1] as [number, number]
  }, [aRateData])
  
  // Helper function to parse time from various formats
  const parseTimeToMinutes = (timeStr: string | null | undefined): number | null => {
    if (!timeStr) return null
    try {
      // 1. Try to match full timestamp format: "2025-12-12 07:02:19" or "2025-12-29  09:52:48.170" (TradesList)
      const fullTimestampMatch = timeStr.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/)
      if (fullTimestampMatch) {
        const hours = parseInt(fullTimestampMatch[1])
        const minutes = parseInt(fullTimestampMatch[2])
        return hours * 60 + minutes
      }
      
      // 2. Try simple time format: "09:30:45", "9:30 AM", "09:30"
      const simpleMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?/i)
      if (simpleMatch) {
        let hours = parseInt(simpleMatch[1])
        const minutes = parseInt(simpleMatch[2])
        const ampm = simpleMatch[4]?.toLowerCase()
        
        if (ampm === 'pm' && hours < 12) {
          hours += 12
        } else if (ampm === 'am' && hours === 12) {
          hours = 0
        }
        
        return hours * 60 + minutes
      }

      // 3. Fallback: Try Date parsing
      const date = new Date(timeStr)
      if (!isNaN(date.getTime())) {
        return date.getHours() * 60 + date.getMinutes()
      }
    } catch (e) {
      console.error('Error parsing time:', timeStr, e)
    }
    return null
  }
  
  // Prepare P&L by period with 6+ period lookback (or all for "All Time")
  const pnlByPeriodData = useMemo(() => {
    const existingPeriods = Object.keys(allTradesGrouped).sort()
    
    let periodsToShow: string[]
    if (showAllPeriods) {
      periodsToShow = existingPeriods
    } else {
      const lookbackPeriods = getLastNPeriods(6, period)
      const allPeriodKeys = [...new Set([...lookbackPeriods, ...existingPeriods])].sort()
      periodsToShow = allPeriodKeys.slice(-6)
    }
    
    return periodsToShow.map(periodKey => {
      const periodTrades = allTradesGrouped[periodKey] || []
      const totalPnL = periodTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
      return {
        period: formatPeriodLabel(periodKey),
        pnl: totalPnL,
        isCurrent: periodKey === currentPeriodKey
      }
    })
  }, [allTradesGrouped, period, currentPeriodKey, showAllPeriods])
  
  // Actual average risk by period: avg |P&L| on losing trades (or 0 if none)
  const avgActualRiskData = useMemo(() => {
    const existingPeriods = Object.keys(allTradesGrouped).sort()
    
    let periodsToShow: string[]
    if (showAllPeriods) {
      periodsToShow = existingPeriods
    } else {
      const lookbackPeriods = getLastNPeriods(6, period)
      const allPeriodKeys = [...new Set([...lookbackPeriods, ...existingPeriods])].sort()
      periodsToShow = allPeriodKeys.slice(-6)
    }
    
    return periodsToShow.map(periodKey => {
      const periodTrades = allTradesGrouped[periodKey] || []
      const losingTrades = periodTrades.filter(t => (t.pnl ?? 0) < 0)
      const avgActualRisk =
        losingTrades.length > 0
          ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0) / losingTrades.length
          : 0
      return {
        period: formatPeriodLabel(periodKey),
        avgActualRisk,
        isCurrent: periodKey === currentPeriodKey
      }
    })
  }, [allTradesGrouped, period, currentPeriodKey, showAllPeriods])
  

  const entryTimeYEnd = entryTimeShowAfternoon ? ENTRY_TIME_AFTERNOON_END : ENTRY_TIME_MORNING_END
  const entryTimeYTicks = useMemo(
    () => getEntryTimeYTicks(entryTimeYEnd),
    [entryTimeYEnd]
  )

  // Prepare entry time distribution (9:15 AM to 12:00 PM ET; 12:00–17:00 when expanded)
  const entryTimeData = useMemo(() => {
    // For "All Time" view only, use allTrades directly
    // For other periods (including sinceNov18), use filtered trades prop
    let tradesToUse: Trade[] = []
    if (useAllTradesForTimeChart) {
      // Use allTrades directly for "All Time" view
      tradesToUse = allTrades || trades || []
    } else {
      // Use filtered trades for specific period views
      tradesToUse = trades ?? []
    }
    
    const totalInputTrades = tradesToUse.length
    
    // First, collect all trades with time
    const tradesWithTime = tradesToUse
      .map((trade) => {
        if (!trade.timestamp) return null
        
        let timeInMinutes = parseTimeToMinutes(trade.entryTime)
        
        // Fallback to timestamp if entryTime parsing failed
        if (timeInMinutes === null && trade.timestamp) {
           timeInMinutes = parseTimeToMinutes(trade.timestamp)
        }

        if (timeInMinutes === null) return null
        
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        const dateKey = formatDateKey(tradeDate, DISPLAY_TIMEZONE)
        
        // TradesList (Sierra Chart) and most sources use ET for US futures. Do not apply
        // timezone conversion—assume times are already in ET.
        const nycTimeInMinutes = timeInMinutes
        
        const timeInHours = nycTimeInMinutes / 60
        
        const yEnd = entryTimeShowAfternoon ? ENTRY_TIME_AFTERNOON_END : ENTRY_TIME_MORNING_END
        if (timeInHours < ENTRY_TIME_Y_START || timeInHours > yEnd) return null
        
        const dateStr = formatInTimeZone(tradeDate, DISPLAY_TIMEZONE, 'MMM d')
        
        const classified = getTradeResult(trade, tradeTags)
        const tradeResult: 'Win' | 'Loss' | 'BE' =
          classified === 'WIN' ? 'Win' : classified === 'LOSS' ? 'Loss' : 'BE'
        
        // Format time label from the NYC time
        const hours = Math.floor(nycTimeInMinutes / 60)
        const mins = nycTimeInMinutes % 60
        const timeLabel = `${hours}:${mins.toString().padStart(2, '0')} ET`
        
        return {
          time: timeInHours,
          timeLabel: timeLabel,
          date: dateStr,
          dateKey: dateKey,
          timestamp: tradeDate.getTime(),
          pnl: trade.pnl ?? 0,
          result: tradeResult
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.timestamp - b.timestamp)
    
    // Create a map of unique dates to sequential indices
    const uniqueDates: string[] = []
    const dateToIndex: Record<string, number> = {}
    
    tradesWithTime.forEach(trade => {
      if (!dateToIndex.hasOwnProperty(trade.dateKey)) {
        dateToIndex[trade.dateKey] = uniqueDates.length
        uniqueDates.push(trade.date)
      }
    })
    
    // Add dayIndex to each trade and add small jitter to separate overlapping points
    const tradesWithDayIndex = tradesWithTime.map((trade, index) => {
      // Add small random jitter to both X and Y to separate overlapping dots
      // Jitter range: -0.08 to +0.08 for time (about 5 mins), -0.15 to +0.15 for day
      const timeJitter = (Math.random() - 0.5) * 0.16
      const dayJitter = (Math.random() - 0.5) * 0.3
      
      return {
      ...trade,
        dayIndex: dateToIndex[trade.dateKey] + dayJitter,
        time: trade.time + timeJitter
      }
    })

    const afternoonTrades = tradesWithTime.filter(t => t.time > ENTRY_TIME_MORNING_END)

    return { 
      trades: tradesWithDayIndex, 
      uniqueDates,
      totalInputTrades,
      tradesInTimeWindow: tradesWithTime.length,
      afternoonTradesCount: afternoonTrades.length,
    }
  }, [trades, allTrades, useAllTradesForTimeChart, entryTimeShowAfternoon, tradeTags])

  const chartBg = darkMode ? '#1f2937' : '#ffffff'
  const chartText = darkMode ? '#9ca3af' : '#374151'
  const chartGrid = darkMode ? '#374151' : '#e5e7eb'

  const tooltipStyle: React.CSSProperties = {
    backgroundColor: chartBg,
    border: `1px solid ${chartGrid}`,
    borderRadius: '8px',
    color: chartText
  }
  
  const tooltipItemStyle = { color: chartText }
  const tooltipLabelStyle = { color: chartText }

  const goToTimelineDrawdownRecap = useCallback((ep: DrawdownEpisode) => {
    const key = requestNavigateToDrawdownRecap(ep)
    setLinkedDrawdownKey(key)
  }, [])

  const handleDrawdownHighlightClick = useCallback(
    (highlight: DrawdownHighlight) => {
      const ep = significantDrawdownEpisodes.find(
        episode => getDrawdownEpisodeKey(episode) === highlight.episodeKey
      )
      if (ep) goToTimelineDrawdownRecap(ep)
    },
    [significantDrawdownEpisodes, goToTimelineDrawdownRecap]
  )

  const scrollToEquityDrawdown = useCallback((key: string) => {
    setLinkedDrawdownKey(key)
    setShowDrawdownHighlights(true)
    requestAnimationFrame(() => {
      document
        .getElementById('equity-curve-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  useEffect(() => {
    const applyPending = () => {
      const key = consumePendingEquityDrawdownKey()
      if (key) scrollToEquityDrawdown(key)
    }
    applyPending()
    const onNavigate = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key
      if (key) scrollToEquityDrawdown(key)
    }
    window.addEventListener(NAVIGATE_EQUITY_DRAWDOWN_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATE_EQUITY_DRAWDOWN_EVENT, onNavigate)
  }, [scrollToEquityDrawdown])

  // Custom active shape renderer for pie chart hover (20% larger)
  const renderActiveShape = (props: {
    cx: number
    cy: number
    innerRadius: number
    outerRadius: number
    startAngle: number
    endAngle: number
    fill: string
    payload: { name: string; value: number }
  }) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
    const expandedOuterRadius = outerRadius * 1.20
    const expandedInnerRadius = innerRadius * 1.20

    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={expandedInnerRadius}
        outerRadius={expandedOuterRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    )
  }

  const cardClass = darkMode
    ? 'bg-gray-800/80 p-6 rounded-xl shadow-sm border border-gray-700/80'
    : 'bg-white p-6 rounded-xl shadow-sm border border-gray-200'
  
  return (
    <div className="space-y-8">
      {/* First Row: Equity Curve, Win/Loss Pie, Win Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div id="equity-curve-section" className={`${cardClass} scroll-mt-24`}>
          <ChartHeader 
            title="Equity Curve" 
            help={`Cumulative P&L by closed trade in exit-time order (ET). Drawdown zones of at least ${formatUsdPnl(SIGNIFICANT_DRAWDOWN_MIN)}; if periods overlap, only the largest $ amount is shown. Boldest zone = max drawdown. Click a highlighted zone to open its recap on Timeline.`}
            darkMode={darkMode}
            actions={
              significantDrawdownEpisodes.length > 0 ? (
                <label
                  className={`inline-flex items-center gap-2 text-xs cursor-pointer select-none shrink-0 ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={showDrawdownHighlights}
                    onChange={e => setShowDrawdownHighlights(e.target.checked)}
                    className="rounded border-gray-500 text-[#EF4444] focus:ring-[#EF4444]"
                  />
                  Highlight drawdowns
                </label>
              ) : undefined
            }
          />
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={equityCurveData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="overviewEquityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={equityStrokeColor} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={equityStrokeColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={equityGridColor} vertical={false} />
              <XAxis
                dataKey="index"
                type="number"
                domain={['dataMin', 'dataMax']}
                allowDecimals={false}
                stroke={chartText}
                tick={{ fill: chartText, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: equityGridColor }}
              />
              <YAxis
                stroke={chartText}
                tick={{ fill: chartText, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatUsdPnl(value)}
              />
              <ReferenceLine y={0} stroke={chartText} strokeDasharray="4 4" strokeOpacity={0.6} />
              <Tooltip 
                contentStyle={tooltipStyle} 
                labelStyle={tooltipLabelStyle} 
                itemStyle={tooltipItemStyle}
                content={({ active, payload }) => {
                  if (active && payload?.length) {
                    const dataPoint = payload[0]?.payload
                    if (dataPoint) {
                      const netPnl = dataPoint.pnl ?? 0
                      return (
                        <div style={{ ...tooltipStyle, padding: '8px 12px', borderRadius: 8 }}>
                          <p style={{ fontWeight: 600, color: chartText, marginBottom: '6px' }}>
                            {dataPoint.dateLabel ?? 'N/A'} (ET)
                          </p>
                          <p style={{ color: netPnl >= 0 ? '#21C55E' : '#EF4444', fontWeight: 600 }}>
                            Net Cumulative P&L: {formatUsdPnl(netPnl)}
                          </p>
                          <p style={{ color: chartText, fontSize: '12px', marginTop: '2px' }}>
                            After trade #{dataPoint.index}
                          </p>
                          {showDrawdownHighlights &&
                            dataPoint.isSignificantDrawdown &&
                            dataPoint.drawdownAmount != null && (
                            <>
                              <p style={{ color: '#EF4444', fontSize: '12px', marginTop: '4px', fontWeight: 600 }}>
                                {dataPoint.isMaxDrawdown
                                  ? `Max drawdown: ${formatUsdPnl(dataPoint.drawdownAmount)}`
                                  : `Drawdown: ${formatUsdPnl(dataPoint.drawdownAmount)}`}
                              </p>
                              <p style={{ color: chartText, fontSize: '11px', marginTop: '4px' }}>
                                Click the zone on the chart to open Timeline recap
                              </p>
                            </>
                          )}
                        </div>
                      )
                    }
                  }
                  return null
                }}
              />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke={equityStrokeColor}
                strokeWidth={2}
                fill="url(#overviewEquityGradient)"
                dot={false}
                activeDot={{ r: 5, fill: equityStrokeColor, strokeWidth: 0 }}
                name="Cumulative P&L"
                isAnimationActive={false}
              />
              {showDrawdownHighlights && maxDrawdownHighlight && (
                <Line
                  type="monotone"
                  dataKey="pnlDrawdown"
                  stroke="#EF4444"
                  strokeWidth={3}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
              {showDrawdownHighlights && maxDrawdownHighlight && (
                <>
                  <ReferenceDot
                    x={maxDrawdownHighlight.peakIndex}
                    y={maxDrawdownHighlight.peakPnl}
                    r={6}
                    fill="#21C55E"
                    stroke={darkMode ? '#111827' : '#ffffff'}
                    strokeWidth={2}
                    isFront
                    ifOverflow="extendDomain"
                  />
                  <ReferenceDot
                    x={maxDrawdownHighlight.troughIndex}
                    y={maxDrawdownHighlight.troughPnl}
                    r={6}
                    fill="#EF4444"
                    stroke={darkMode ? '#111827' : '#ffffff'}
                    strokeWidth={2}
                    isFront
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    segment={[
                      { x: maxDrawdownHighlight.peakIndex, y: maxDrawdownHighlight.peakPnl },
                      { x: maxDrawdownHighlight.troughIndex, y: maxDrawdownHighlight.peakPnl },
                    ]}
                    stroke="#EF4444"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    isFront
                    ifOverflow="extendDomain"
                  />
                </>
              )}
              {showDrawdownHighlights && drawdownHighlights.length > 0 && (
                <Customized
                  component={(props: Record<string, unknown>) => (
                    <EquityCurveDrawdownLayer
                      {...props}
                      highlights={drawdownHighlights}
                      darkMode={darkMode}
                      activeEpisodeKey={linkedDrawdownKey}
                      onHighlightClick={handleDrawdownHighlightClick}
                    />
                  )}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        
        <div className={cardClass}>
          <ChartHeader 
            title="Winning % By Trades" 
            help="Donut chart showing the proportion of winning vs losing trades. Win rate is calculated excluding BE trades. Higher win rate generally indicates better trading performance." 
            darkMode={darkMode}
          />
          <div className="flex items-center justify-center">
            <div className="relative overflow-visible" style={{ width: 200, height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={winLossData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                    label={false}
                    activeIndex={activePieIndex}
                    activeShape={renderActiveShape as never}
                    onMouseEnter={(_, index) => setActivePieIndex(index)}
                    onMouseLeave={() => setActivePieIndex(undefined)}
                  >
                    {(winLossData ?? []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Hover label overlay - appears in front when segment is hovered */}
              {activePieIndex !== undefined && (winLossData ?? [])[activePieIndex] && (
                <div
                  className="absolute z-20 px-3 py-2 rounded-lg shadow-lg font-semibold text-sm whitespace-nowrap pointer-events-none"
                  style={{
                    right: -8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    backgroundColor: darkMode ? '#374151' : '#ffffff',
                    border: `2px solid ${(winLossData ?? [])[activePieIndex]?.color}`,
                    color: (winLossData ?? [])[activePieIndex]?.color
                  }}
                >
                  {(winLossData ?? [])[activePieIndex]?.name}: {(winLossData ?? [])[activePieIndex]?.value}
                </div>
              )}
              {/* Center label showing win rate */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-4xl font-bold" style={{ color: '#21C55E' }}>
                  {(() => {
                    const wins = winLossData.find(d => d.name === 'Wins')?.value || 0
                    const losses = winLossData.find(d => d.name === 'Losses')?.value || 0
                    const total = wins + losses
                    return total > 0 ? Math.round((wins / total) * 100) : 0
                  })()}
                  <span className="text-2xl">%</span>
                </span>
                <span className="text-xs uppercase tracking-wider mt-1" style={{ color: '#21C55E' }}>WINRATE</span>
              </div>
            </div>
            {/* Custom legend */}
            <div className="ml-8 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: darkMode ? '#007656' : '#10b981' }} />
                <div className="flex flex-col">
                  <span className="text-lg font-semibold">{(winLossData ?? []).find(d => d.name === 'Wins')?.value || 0}</span>
                  <span className="text-sm text-muted-foreground">winners</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#EF4444' }} />
                <div className="flex flex-col">
                  <span className="text-lg font-semibold">{winLossData.find(d => d.name === 'Losses')?.value || 0}</span>
                  <span className="text-sm text-muted-foreground">losers</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#f59e0b' }} />
                <div className="flex flex-col">
                  <span className="text-lg font-semibold">{(winLossData ?? []).find(d => d.name === 'BE')?.value || 0}</span>
                  <span className="text-sm text-muted-foreground">break-even</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className={cardClass}>
          <ChartHeader 
            title={showAllPeriods 
              ? `Win Rate by ${formatPeriodTitle(period)}`
              : `Win Rate (Last 6 ${formatPeriodTitle(period)}s)`}
            help={showAllPeriods
              ? "Shows your win rate percentage for all periods. Win rate is calculated as (number of winning trades / total trades) × 100."
              : "Shows your win rate percentage for the last 6 periods. Current period is highlighted. Win rate is calculated as (number of winning trades / total trades) × 100."} 
            darkMode={darkMode}
          />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={winRateData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="period" stroke={chartText} angle={-45} textAnchor="end" height={80} />
              <YAxis stroke={chartText} domain={[0, 100]} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
              <Tooltip 
                contentStyle={tooltipStyle} 
                labelStyle={tooltipLabelStyle} 
                itemStyle={tooltipItemStyle}
                formatter={(value: number) => [`${Number(value).toFixed(1)}%`, 'Win Rate']}
              />
              <Line
                type="monotone"
                dataKey="winRate"
                name="Win Rate %"
                stroke="#21C55E"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  if (cx == null || cy == null) return <g />
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={payload.isCurrent ? 5 : 4}
                      fill={payload.isCurrent ? '#21C55E' : '#21C55E99'}
                      stroke={payload.isCurrent ? '#fff' : 'none'}
                      strokeWidth={payload.isCurrent ? 1 : 0}
                    />
                  )
                }}
                activeDot={{ r: 6, fill: '#21C55E' }}
              >
                <LabelList
                  dataKey="winRate"
                  position="top"
                  formatter={(value: number) => `${Number(value).toFixed(1)}%`}
                  fill={chartText}
                  fontSize={11}
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Second Row: A Rate, P&L by Period, Average Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={cardClass}>
          <ChartHeader 
            title={showAllPeriods 
              ? `A Rate by ${formatPeriodTitle(period)}`
              : `A Rate (Last 6 ${formatPeriodTitle(period)}s)`}
            help={showAllPeriods
              ? "A Rate = (A setup + A+ Setup trades) ÷ (wins + losses) × 100. Break-even trades are excluded from the denominator unless tagged Random or Bad SL Placement (counted as a loss). Orange bars show total trades in each period."
              : "A Rate for the last 6 periods. Current period is highlighted. Formula: (A + A+ setups) ÷ (wins + losses) × 100; BE trades excluded unless classified as losses. Orange bars show total trades per period."} 
            darkMode={darkMode}
          />
          <div className="flex flex-wrap items-center gap-4 text-xs mb-3 -mt-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: TRADES_BAR_COLOR }} />
              <span className="text-muted-foreground">Number of Trades</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: A_RATE_COLOR }} />
              <span className="text-muted-foreground">A Rate</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={aRateData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="period" stroke={chartText} angle={-45} textAnchor="end" height={80} />
              <YAxis
                yAxisId="aRate"
                stroke={A_RATE_COLOR}
                domain={[0, 100]}
                tick={{ fill: A_RATE_COLOR, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                width={44}
              />
              <YAxis
                yAxisId="trades"
                orientation="right"
                stroke={TRADES_BAR_COLOR}
                domain={aRateTradeDomain}
                tick={{ fill: TRADES_BAR_COLOR, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip 
                contentStyle={tooltipStyle} 
                labelStyle={tooltipLabelStyle} 
                itemStyle={tooltipItemStyle}
                formatter={(value: number, name: string, props) => {
                  if (name === 'A Rate %') {
                    const payload = props?.payload as { aCount?: number; decisiveTrades?: number } | undefined
                    const countLabel = payload?.decisiveTrades
                      ? ` (${payload.aCount ?? 0}/${payload.decisiveTrades})`
                      : ''
                    return [`${Number(value).toFixed(1)}%${countLabel}`, 'A Rate']
                  }
                  if (name === 'Trades') {
                    return [value, 'Trades']
                  }
                  return [value, name]
                }}
              />
              <Bar
                yAxisId="trades"
                dataKey="tradeCount"
                name="Trades"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              >
                {aRateData.map((entry, index) => (
                  <Cell
                    key={`a-rate-trades-${index}`}
                    fill={TRADES_BAR_COLOR}
                    fillOpacity={entry.isCurrent ? 0.9 : 0.45}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="aRate"
                type="monotone"
                dataKey="aRate"
                name="A Rate %"
                stroke={A_RATE_COLOR}
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  if (cx == null || cy == null) return <g />
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={payload.isCurrent ? 5 : 4}
                      fill={payload.isCurrent ? A_RATE_COLOR : `${A_RATE_COLOR}99`}
                      stroke={payload.isCurrent ? '#fff' : 'none'}
                      strokeWidth={payload.isCurrent ? 1 : 0}
                    />
                  )
                }}
                activeDot={{ r: 6, fill: A_RATE_COLOR }}
              >
                <LabelList
                  dataKey="aRate"
                  position="top"
                  offset={10}
                  formatter={(value: number) => `${Number(value).toFixed(1)}%`}
                  fill={A_RATE_COLOR}
                  fontSize={11}
                />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        
        <div className={cardClass}>
          <ChartHeader 
            title={showAllPeriods
              ? `P&L by ${formatPeriodTitle(period)}`
              : `P&L (Last 6 ${formatPeriodTitle(period)}s)`}
            help={showAllPeriods
              ? "Total profit and loss for all periods. Green = profit, Red = loss."
              : "Total profit and loss for the last 6 periods. Current period is highlighted. Green = profit, Red = loss."} 
            darkMode={darkMode}
          />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pnlByPeriodData} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="period" stroke={chartText} angle={-45} textAnchor="end" height={80} />
              <YAxis stroke={chartText} tickFormatter={(value) => formatUsdPnl(value)} />
              <Tooltip 
                contentStyle={tooltipStyle} 
                labelStyle={tooltipLabelStyle} 
                itemStyle={tooltipItemStyle}
                formatter={(value: number) => [formatUsdPnl(value), 'P&L']}
              />
              <Bar dataKey="pnl" name="P&L">
                {pnlByPeriodData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.isCurrent 
                      ? (entry.pnl >= 0 ? '#21C55E' : '#EF4444')
                      : (entry.pnl >= 0 ? '#21C55E66' : '#EF444466')
                    } 
                  />
                ))}
                <LabelList
                  dataKey="pnl"
                  content={({ x, y, width, value, index }) => {
                    if (value == null || x == null || y == null || width == null) return <g />
                    const pnl = pnlByPeriodData[index ?? 0]?.pnl ?? 0
                    const labelY = pnl >= 0 ? Number(y) - 8 : Number(y) + 16
                    return (
                      <text
                        x={Number(x) + Number(width) / 2}
                        y={labelY}
                        fill={chartText}
                        textAnchor="middle"
                        fontSize={11}
                      >
                        {formatUsdPnl(Number(value))}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div className={cardClass}>
          <ChartHeader 
            title={showAllPeriods
              ? `Actual Average Risk by ${formatPeriodTitle(period)}`
              : `Actual Average Risk (Last 6 ${formatPeriodTitle(period)}s)`}
            help={showAllPeriods
              ? "Average dollar loss per losing trade in each period (|P&L| on losses ÷ number of losses). Shows realized risk on losers, not the $500 planned 1R."
              : "Average dollar loss per losing trade for the last 6 periods. Current period is highlighted."} 
            darkMode={darkMode}
          />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={avgActualRiskData} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} />
              <XAxis dataKey="period" stroke={chartText} angle={-45} textAnchor="end" height={80} />
              <YAxis stroke={chartText} tickFormatter={(value) => formatUsd(value)} />
              <Tooltip 
                contentStyle={tooltipStyle} 
                labelStyle={tooltipLabelStyle} 
                itemStyle={tooltipItemStyle}
                formatter={(value: number) => [formatUsd(value), 'Actual Avg Risk']}
              />
              <Line
                type="monotone"
                dataKey="avgActualRisk"
                name="Actual Average Risk"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  if (cx == null || cy == null) return <g />
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={payload.isCurrent ? 5 : 4}
                      fill={payload.isCurrent ? '#f59e0b' : '#f59e0b99'}
                      stroke={payload.isCurrent ? '#fff' : 'none'}
                      strokeWidth={payload.isCurrent ? 1 : 0}
                    />
                  )
                }}
                activeDot={{ r: 6, fill: '#f59e0b' }}
              >
                <LabelList
                  dataKey="avgActualRisk"
                  position="top"
                  formatter={(value: number) => formatUsd(value)}
                  fill={chartText}
                  fontSize={11}
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Entry Time Distribution (9:15 AM - 12:00 PM ET; afternoon expandable) */}
      <div className={cardClass}>
        <ChartHeader 
          title={
            entryTimeShowAfternoon
              ? 'Entry Time Distribution (9:15 AM - 17:00 ET)'
              : 'Entry Time Distribution (9:15 AM - 12:00 PM ET)'
          }
          help={
            entryTimeShowAfternoon
              ? 'Scatter plot showing when you enter trades by day (Eastern Time). Y-axis runs from 9:15 AM to 5:00 PM in 15-minute steps, including the afternoon session (12:00–17:00). Green dots = wins, red = losses, amber = BE.'
              : 'Scatter plot showing when you enter trades during the morning session by day (Eastern Time). Y-axis runs from 9:15 AM to 12:00 PM in 15-minute steps. Use “Show 12:00–17:00” to include the afternoon session. Green dots = wins, red = losses, amber = BE.'
          }
          darkMode={darkMode}
          actions={
            <label
              className={`inline-flex items-center gap-2 text-xs cursor-pointer select-none shrink-0 ${
                darkMode ? 'text-gray-300' : 'text-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={entryTimeShowAfternoon}
                onChange={e => setEntryTimeShowAfternoon(e.target.checked)}
                className="rounded border-gray-500 text-[#3b82f6] focus:ring-[#3b82f6]"
              />
              Show 12:00–17:00
            </label>
          }
        />
        <p className="text-sm text-muted-foreground mb-4">
          Each dot represents a trade entry (times shown in ET). Green = Win, Red = Loss
          <span className="ml-4 text-xs">
            (Showing {entryTimeData.tradesInTimeWindow} of {entryTimeData.totalInputTrades} trades in time window
            {entryTimeShowAfternoon && entryTimeData.afternoonTradesCount > 0
              ? ` · ${entryTimeData.afternoonTradesCount} after 12:00`
              : ''}
            )
          </span>
        </p>
        <ResponsiveContainer width="100%" height={entryTimeShowAfternoon ? 560 : 400}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 100, left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
            <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: '8px' }} />
            <XAxis 
              type="number" 
              dataKey="dayIndex" 
              name="Date"
              domain={[0, entryTimeData.uniqueDates.length - 1]}
              ticks={entryTimeData.uniqueDates.map((_, i) => i)}
              tickFormatter={(value) => {
                return entryTimeData.uniqueDates[value] || ''
              }}
              stroke={chartText}
              label={{ value: 'Entry Time Distribution', position: 'insideBottom', offset: -15, fill: chartText }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis 
              type="number" 
              dataKey="time" 
              name="Time" 
              domain={[ENTRY_TIME_Y_START, entryTimeYEnd]}
              ticks={entryTimeYTicks}
              tickFormatter={formatEntryTimeAxisTick}
              stroke={chartText}
              label={{ value: 'Entry Time', angle: -90, position: 'insideLeft', fill: chartText }}
            />
            <Tooltip 
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload
                  return (
                    <div style={{ ...tooltipStyle, padding: '8px' }}>
                      <p style={{ fontWeight: 600, color: chartText }}>{`Date: ${data.date}`}</p>
                      <p style={{ color: chartText }}>{`Time: ${data.timeLabel}`}</p>
                      <p style={{ color: data.pnl > 0 ? POSITIVE_TEXT_COLOR : NEGATIVE_TEXT_COLOR }}>
                        {`P&L: ${formatUsdPnl(data.pnl)}`}
                      </p>
                      <p style={{ color: chartText }}>{`Result: ${data.result}`}</p>
                    </div>
                  )
                }
                return null
              }}
            />
            <Scatter 
              name="Wins" 
              data={entryTimeData.trades.filter(d => d.result === 'Win')} 
              fill={darkMode ? 'rgba(33, 197, 94, 0.5)' : 'rgba(33, 197, 94, 0.35)'}
              stroke={darkMode ? 'rgba(33, 197, 94, 0.9)' : 'rgba(33, 197, 94, 0.8)'}
              strokeWidth={1}
            />
            <Scatter 
              name="Losses" 
              data={entryTimeData.trades.filter(d => d.result === 'Loss')} 
              fill="rgba(239, 68, 68, 0.5)"
              stroke="rgba(239, 68, 68, 0.8)"
              strokeWidth={1}
            />
            <Scatter 
              name="BE" 
              data={entryTimeData.trades.filter(d => d.result === 'BE')} 
              fill="rgba(245, 158, 11, 0.35)"
              stroke="rgba(245, 158, 11, 0.8)"
              strokeWidth={1}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

