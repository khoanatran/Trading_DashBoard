'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { parseTradeFile, aggregateByPeriod, calculateStats, calculateStreaks, parseLocalTimestamp, getTradeId, getTradeResult, getTradeRMultiple, normalizeTradesRisk, getTradeCloseAt, type Trade } from '@/utils/logParser'
import { formatDateKey, dateKeyToLabel } from '@/utils/tradingDays'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { isMt5ReportHistoryFileName, parseMt5ReportHistoryBuffer } from '@/utils/mt5ReportParser'
import { loadStoredTrades, saveStoredTrades, mergeImportedTrades } from '@/lib/trade-storage'
import { formatUsdPnl } from '@/lib/format'
import OverviewCards from '@/components/OverviewCards'
import OverviewSection from '@/components/OverviewSection'
import WeeklyKpiPanel from '@/components/WeeklyKpiPanel'
import PerformanceTable from '@/components/PerformanceTable'
import JournalTable, {
  TagFilterBar,
  isTagFilterClear,
  tradePassesTagFilter,
  type TagFilterMode,
} from '@/components/JournalTable'
import Charts from '@/components/Charts'
import DayOfWeekStats from '@/components/DayOfWeekStats'
import TradingDayHeatmap from '@/components/TradingDayHeatmap'
import TradesPerDayHeatmap from '@/components/TradesPerDayHeatmap'
import { useHeatmapYear } from '@/hooks/useHeatmapYear'
import CalendarView from '@/components/CalendarView'
import WeekView from '@/components/WeekView'
import DayView from '@/components/DayView'
import WeeklyNotesTimeline from '@/components/WeeklyNotesTimeline'
import { CustomDateRangePicker } from '@/components/CustomDateRangePicker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, BarChart3, FileUp, FileDown, Moon, Sun, FileText, BookOpen, CalendarDays, CalendarRange, LayoutDashboard, PanelLeftClose, PanelLeft, Filter, FlaskConical } from 'lucide-react'
import SimulatedOverview from '@/components/SimulatedOverview'
import { format, isWithinInterval, endOfDay, startOfWeek, endOfWeek, subWeeks, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns'
import {
  NAVIGATE_DRAWDOWN_RECAP_EVENT,
  NAVIGATE_EQUITY_DRAWDOWN_EVENT,
  PENDING_DRAWDOWN_RECAP_KEY,
  PENDING_EQUITY_DRAWDOWN_KEY,
} from '@/lib/drawdown-nav'
import { fetchFlags, setDayFlag, setTradeFlag } from '@/lib/trade-flags'
import { syncTradeExportToDisk } from '@/lib/sync-trade-export'
import { getTradeExportFilePath } from '@/lib/trade-export-path'
import { remigrateTradeMetadataOnServer } from '@/lib/sync-trade-metadata'
import { fetchTradesSnapshotFromServer, syncTradesSnapshotToServer } from '@/lib/sync-trades-snapshot'
import { clearAllCaches } from '@/utils/mediaCache'

type DateRange = { from?: Date; to?: Date }

type ViewMode = 'month' | 'week' | 'day' | 'overview' | 'simulation' | 'journal' | 'timeline'
type TimePeriod = 'all' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'

function tradeMatchesDayKey(trade: Trade, dayKey: string): boolean {
  if (!trade.isClosed) return false
  const closeAt = getTradeCloseAt(trade)
  if (!closeAt) return false
  return formatDateKey(closeAt, DISPLAY_TIMEZONE) === dayKey
}

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [period, setPeriod] = useState<TimePeriod>('all')
  // Default to dark mode every time the project is run
  const [darkMode, setDarkMode] = useState(true)
  const [fileName, setFileName] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('overview')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [journalDayKey, setJournalDayKey] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [greeting, setGreeting] = useState('')
  const [resultFilter, setResultFilter] = useState<'all' | 'WIN' | 'LOSS' | 'BE'>('all')
  const [tagFilterMode, setTagFilterMode] = useState<TagFilterMode>('exclusion')
  const [tagFilterTags, setTagFilterTags] = useState<string[]>([])
  const [tradeTagsFromJournal, setTradeTagsFromJournal] = useState<Record<string, string[]>>({})
  const [flaggedDays, setFlaggedDays] = useState<Record<string, boolean>>({})
  const [flaggedTrades, setFlaggedTrades] = useState<Record<string, boolean>>({})
  const [persistReady, setPersistReady] = useState(false)
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0)
  const lastImportAlertKeyRef = useRef<string | null>(null)
  const startupMetadataSyncDoneRef = useRef(false)

  // Restore trades: browser localStorage first, then server snapshot (Git-synced data/)
  useEffect(() => {
    let cancelled = false

    const restoreTrades = async () => {
      const stored = loadStoredTrades()
      if (stored && stored.trades.length > 0) {
        if (!cancelled) {
          setTrades(stored.trades)
          if (stored.lastImportedFile) {
            setFileName(stored.lastImportedFile)
          }
          setViewMode('overview')
        }
        if (!cancelled) setPersistReady(true)
        return
      }

      const snapshot = await fetchTradesSnapshotFromServer()
      if (!cancelled && snapshot.ok && snapshot.trades.length > 0) {
        setTrades(snapshot.trades)
        setFileName('Synced from GitHub')
        setViewMode('overview')
      }
      if (!cancelled) setPersistReady(true)
    }

    void restoreTrades()
    return () => {
      cancelled = true
    }
  }, [])

  // Load saved trade tags for classification rules (e.g. Random / Bad SL Placement → Loss)
  useEffect(() => {
    const loadTradeTags = async () => {
      try {
        const res = await fetch('/api/trade-tags')
        if (!res.ok) return
        const data = await res.json()
        if (data.mapping && typeof data.mapping === 'object') {
          setTradeTagsFromJournal(data.mapping)
        }
      } catch {
        // Tags are optional; journal tab still syncs on visit
      }
    }
    loadTradeTags()
  }, [])

  useEffect(() => {
    const loadFlags = async () => {
      const flags = await fetchFlags()
      setFlaggedDays(flags.days)
      setFlaggedTrades(flags.trades)
    }
    void loadFlags()
  }, [])

  const refreshJournalMetadata = useCallback(async () => {
    try {
      const [tagsRes, flagsRes] = await Promise.all([fetch('/api/trade-tags'), fetch('/api/flags')])
      if (tagsRes.ok) {
        const data = await tagsRes.json()
        if (data.mapping && typeof data.mapping === 'object') {
          setTradeTagsFromJournal(data.mapping)
        }
      }
      if (flagsRes.ok) {
        const data = await flagsRes.json()
        setFlaggedDays(data.days ?? {})
        setFlaggedTrades(data.trades ?? {})
      }
    } catch {
      // Non-fatal if metadata refresh fails
    }
  }, [])

  const syncTradeMetadata = useCallback(async (tradeList: Trade[]) => {
    const result = await remigrateTradeMetadataOnServer(tradeList)
    if (!result.ok) {
      console.warn('Failed to sync journal media metadata.')
      return result
    }

    clearAllCaches()
    setMediaRefreshKey(key => key + 1)
    await refreshJournalMetadata()

    const summary = result.summary
    if (summary) {
      console.log(
        `Journal media synced: images ${summary.images.totalEntries} (${summary.images.recoveredFiles} recovered), ` +
          `videos ${summary.videos.totalEntries} (${summary.videos.recoveredFiles} recovered)`
      )
    }

    return result
  }, [refreshJournalMetadata])

  useEffect(() => {
    if (!persistReady || trades.length === 0 || startupMetadataSyncDoneRef.current) return
    startupMetadataSyncDoneRef.current = true
    void syncTradeMetadata(trades)
  }, [persistReady, trades, syncTradeMetadata])

  const handleExportTrades = useCallback(async () => {
    if (trades.length === 0) {
      alert('No trades to export. Upload a trade file first.')
      return
    }

    const result = await syncTradeExportToDisk(trades)
    if (result.ok) {
      alert(
        `Exported ${result.tradeCount ?? trades.length} trade(s) to:\n${getTradeExportFilePath()}`
      )
    } else {
      alert('Failed to write trade export file. Check the server console for details.')
    }
  }, [trades])

  const handleToggleDayFlag = useCallback(async (dateKey: string) => {
    const nextFlagged = !flaggedDays[dateKey]

    setFlaggedDays(prev => {
      const next = { ...prev }
      if (nextFlagged) next[dateKey] = true
      else delete next[dateKey]
      return next
    })

    const result = await setDayFlag(dateKey, nextFlagged)
    if (!result.ok) {
      const flags = await fetchFlags()
      setFlaggedDays(flags.days)
    } else if (result.data) {
      setFlaggedDays(result.data.days)
    }
  }, [flaggedDays])

  const handleToggleTradeFlag = useCallback(async (tradeId: string, flagged: boolean) => {
    setFlaggedTrades(prev => {
      const next = { ...prev }
      if (flagged) next[tradeId] = true
      else delete next[tradeId]
      return next
    })

    const result = await setTradeFlag(tradeId, flagged)
    if (!result.ok) {
      const flags = await fetchFlags()
      setFlaggedDays(flags.days)
      setFlaggedTrades(flags.trades)
    } else if (result.data) {
      setFlaggedDays(result.data.days)
      setFlaggedTrades(result.data.trades)
    }
  }, [])

  // Persist trades whenever they change (after initial load)
  useEffect(() => {
    if (!persistReady) return
    saveStoredTrades(trades, fileName || null)
  }, [trades, fileName, persistReady])

  // Persist trades to server snapshot + GitHub backup (debounced)
  useEffect(() => {
    if (!persistReady || trades.length === 0) return
    const timer = setTimeout(() => {
      void syncTradesSnapshotToServer(trades)
    }, 2000)
    return () => clearTimeout(timer)
  }, [trades, persistReady])

  // Dynamic greeting based on time of day (client-side only to avoid hydration mismatch)
  useEffect(() => {
    const now = new Date()
    const hours = now.getHours()
    const minutes = now.getMinutes()
    const timeInMinutes = hours * 60 + minutes
    
    // 5:00am (300) to 11:30am (690) = Good Morning
    // 11:30am (690) to 6:00pm (1080) = Good Afternoon
    // 6:00pm (1080) to 5:00am (300) = Good Night
    if (timeInMinutes >= 300 && timeInMinutes < 690) {
      setGreeting('Good Morning, Trader Khoa')
    } else if (timeInMinutes >= 690 && timeInMinutes < 1080) {
      setGreeting('Good Afternoon, Trader Khoa')
    } else {
      setGreeting('Good Night, Trader Khoa')
    }
  }, [])

  // Apply dark mode class to html element
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // Cross-tab: equity curve drawdown row → Timeline recap; recap → Overview chart
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem(PENDING_DRAWDOWN_RECAP_KEY)) setViewMode('timeline')
      if (sessionStorage.getItem(PENDING_EQUITY_DRAWDOWN_KEY)) setViewMode('overview')
    }

    const onDrawdownRecap = () => setViewMode('timeline')
    const onEquityDrawdown = () => setViewMode('overview')
    window.addEventListener(NAVIGATE_DRAWDOWN_RECAP_EVENT, onDrawdownRecap)
    window.addEventListener(NAVIGATE_EQUITY_DRAWDOWN_EVENT, onEquityDrawdown)
    return () => {
      window.removeEventListener(NAVIGATE_DRAWDOWN_RECAP_EVENT, onDrawdownRecap)
      window.removeEventListener(NAVIGATE_EQUITY_DRAWDOWN_EVENT, onEquityDrawdown)
    }
  }, [])

  const applyParsedTrades = (parsedTrades: Trade[], fileLabel: string) => {
    if (parsedTrades.length === 0) {
      alert('No completed trades found in the file. Please check the file format.')
      return
    }

    setTrades(prev => {
      const { merged, added, skipped } = mergeImportedTrades(prev, parsedTrades)
      const tradesWithRR = merged.filter(t => getTradeRMultiple(t) !== null)
      const totalPnl = merged.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
      console.log(
        `Import "${fileLabel}": parsed ${parsedTrades.length}, added ${added}, skipped ${skipped} duplicate(s). ` +
          `Total ${merged.length} trades (${tradesWithRR.length} with R:R, P&L ${formatUsdPnl(totalPnl)})`
      )

      void syncTradeMetadata(merged)
      void syncTradeExportToDisk(merged).then(result => {
        if (result.ok) {
          console.log(
            `Trade export updated (${result.tradeCount ?? merged.length} trades): ${getTradeExportFilePath()}`
          )
        } else {
          console.warn('Failed to auto-update trade export file after import.')
        }
      })

      const alertKey = `${fileLabel}:${added}:${skipped}:${merged.length}`
      if (lastImportAlertKeyRef.current !== alertKey) {
        lastImportAlertKeyRef.current = alertKey
        if (added === 0 && skipped > 0) {
          alert(
            `All ${skipped} trade(s) in this file are already saved. No new trades were added.\n\nTrade export refreshed in ${getTradeExportFilePath()}.`
          )
        } else if (skipped > 0) {
          alert(
            `Added ${added} new trade(s). Skipped ${skipped} duplicate(s) already saved. Total: ${merged.length} trades.\n\nTrade export updated in ${getTradeExportFilePath()}.`
          )
        } else {
          alert(
            `Added ${added} new trade(s). Total: ${merged.length} trades saved locally.\n\nTrade export updated in ${getTradeExportFilePath()}.`
          )
        }
      }

      return merged
    })

    setFileName(fileLabel)
    setViewMode('overview')
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    const isExcel =
      isMt5ReportHistoryFileName(file.name) ||
      file.name.toLowerCase().endsWith('.xlsx') ||
      file.name.toLowerCase().endsWith('.xls')

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        if (isExcel) {
          const buffer = e.target?.result as ArrayBuffer
          const parsedTrades = parseMt5ReportHistoryBuffer(buffer, file.name)
          applyParsedTrades(parsedTrades, file.name)
        } else {
          const content = e.target?.result as string
          console.log(`File loaded, size: ${content.length} characters`)
          const parsedTrades = parseTradeFile(content, file.name)
          applyParsedTrades(parsedTrades, file.name)
        }
      } catch (error) {
        console.error('Error parsing file:', error)
        alert(`Error parsing file: ${error}\n\nCheck the browser console (F12) for details.`)
      }
    }
    reader.onerror = () => {
      alert('Error reading file. Please try again.')
    }

    if (isExcel) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file)
    }

    event.target.value = ''
  }

  const normalizeCalendarDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)

  const openJournalForDay = useCallback((date: Date) => {
    const normalized = normalizeCalendarDay(date)
    setSelectedDate(normalized)
    setJournalDayKey(formatDateKey(normalized, DISPLAY_TIMEZONE))
    setViewMode('journal')
  }, [])

  const handleDateSelect = (date: Date | undefined) => {
    if (date) openJournalForDay(date)
  }

  const handleDayClick = (date: Date) => {
    openJournalForDay(date)
  }

  const handleWeekSelect = (weekStartDate: Date) => {
    setSelectedDate(weekStartDate)
    setViewMode('week')
  }

  const handlePeriodClick = (periodKey: string, period: 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    try {
      if (period === 'weekly') {
        // Parse format: "2024-W01"
        const match = periodKey.match(/^(\d{4})-W(\d{2})$/)
        if (match) {
          const year = parseInt(match[1])
          const weekNum = parseInt(match[2])
          
          // Calculate the date for the start of that week
          // Week 1 starts on the first day of the year that contains a Thursday
          const jan4 = new Date(year, 0, 4) // January 4th is always in week 1
          const jan4Day = jan4.getDay() // 0 = Sunday, 1 = Monday, etc.
          const weekStart = new Date(jan4)
          weekStart.setDate(jan4.getDate() - jan4Day) // Go back to Sunday of week 1
          weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7) // Add weeks
          
          setSelectedDate(weekStart)
          setViewMode('week')
        }
      } else if (period === 'daily') {
        // Parse format: "2024-01-15" - parse manually to avoid UTC interpretation
        const [year, month, day] = periodKey.split('-').map(Number)
        const date = new Date(year, month - 1, day, 12, 0, 0)
        setSelectedDate(date)
        setViewMode('day')
      } else if (period === 'monthly') {
        // Parse format: "2024-01"
        const [year, month] = periodKey.split('-')
        const date = new Date(parseInt(year), parseInt(month) - 1, 1)
        setSelectedDate(date)
        setViewMode('month')
      } else if (period === 'yearly') {
        // Parse format: "2024"
        const date = new Date(parseInt(periodKey), 0, 1)
        setSelectedDate(date)
        setViewMode('month')
      }
    } catch (error) {
      console.error('Error parsing period:', error)
    }
  }

  const riskNormalizedTrades = useMemo(() => normalizeTradesRisk(trades), [trades])

  const tagFilteredTrades = useMemo(() => {
    return riskNormalizedTrades.filter(trade =>
      tradePassesTagFilter(trade, tagFilterMode, tagFilterTags, tradeTagsFromJournal)
    )
  }, [riskNormalizedTrades, tagFilterMode, tagFilterTags, tradeTagsFromJournal])

  // Period + result filter only (no tag filter) — Journal uses this for full-day equity curves.
  const periodFilteredTrades = useMemo(() => {
    const tradesList = riskNormalizedTrades ?? []
    const now = new Date()
    let filtered = [...tradesList]

    if (period === 'custom' && dateRange?.from) {
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        const from = dateRange.from!
        const to = dateRange.to || now
        return isWithinInterval(tradeDate, { start: from, end: endOfDay(to) })
      })
    } else if (period === 'thisWeek') {
      const weekStart = startOfWeek(now, { weekStartsOn: 0 })
      const weekEnd = endOfWeek(now, { weekStartsOn: 0 })
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        return isWithinInterval(tradeDate, { start: weekStart, end: weekEnd })
      })
    } else if (period === 'lastWeek') {
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 0 })
      const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 0 })
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        return isWithinInterval(tradeDate, { start: lastWeekStart, end: lastWeekEnd })
      })
    } else if (period === 'thisMonth') {
      const monthStart = startOfMonth(now)
      const monthEnd = endOfMonth(now)
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        return isWithinInterval(tradeDate, { start: monthStart, end: monthEnd })
      })
    } else if (period === 'lastMonth') {
      const lastMonthStart = startOfMonth(subMonths(now, 1))
      const lastMonthEnd = endOfMonth(subMonths(now, 1))
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        return isWithinInterval(tradeDate, { start: lastMonthStart, end: lastMonthEnd })
      })
    } else if (period === 'thisYear') {
      const yearStart = startOfYear(now)
      const yearEnd = endOfYear(now)
      filtered = tradesList.filter(trade => {
        if (!trade.timestamp) return false
        const tradeDate = parseLocalTimestamp(trade.timestamp)
        return isWithinInterval(tradeDate, { start: yearStart, end: yearEnd })
      })
    }

    if (resultFilter !== 'all') {
      filtered = filtered.filter(trade => getTradeResult(trade, tradeTagsFromJournal) === resultFilter)
    }

    return filtered
  }, [riskNormalizedTrades, dateRange, period, resultFilter, tradeTagsFromJournal])

  // Tag + period + result filter (Overview, stats, etc.)
  const filteredTrades = useMemo(() => {
    return periodFilteredTrades.filter(trade =>
      tradePassesTagFilter(trade, tagFilterMode, tagFilterTags, tradeTagsFromJournal)
    )
  }, [periodFilteredTrades, tagFilterMode, tagFilterTags, tradeTagsFromJournal])

  const {
    calendarYear: heatmapCalendarYear,
    availableYears: heatmapAvailableYears,
    autoFollowCurrentYear: heatmapAutoFollowCurrentYear,
    setCalendarYear: setHeatmapCalendarYear,
    setAutoFollowCurrentYear: setHeatmapAutoFollowCurrentYear,
  } = useHeatmapYear(tagFilteredTrades)

  const [heatmapHoveredDayKey, setHeatmapHoveredDayKey] = useState<string | null>(null)

  useEffect(() => {
    if (viewMode !== 'journal') {
      setJournalDayKey(null)
    }
  }, [viewMode])

  const journalTrades = useMemo(() => {
    if (viewMode !== 'journal' || !journalDayKey) return periodFilteredTrades
    return periodFilteredTrades.filter(trade => tradeMatchesDayKey(trade, journalDayKey))
  }, [periodFilteredTrades, viewMode, journalDayKey])

  // For grouping, use weekly by default
  const groupingPeriod = 'weekly'
  const groupedData = aggregateByPeriod(filteredTrades, groupingPeriod as 'daily' | 'weekly' | 'monthly' | 'yearly')
  const overallStats = calculateStats(filteredTrades, tradeTagsFromJournal)
  const streaks = calculateStreaks(filteredTrades, tradeTagsFromJournal)

  // Navigation items configuration
  const navItems = [
    { id: 'overview' as ViewMode, label: 'Overview', icon: LayoutDashboard },
    { id: 'simulation' as ViewMode, label: 'Simulation', icon: FlaskConical },
    { id: 'month' as ViewMode, label: 'Calendar', icon: Calendar },
    { id: 'journal' as ViewMode, label: 'Journal', icon: FileText },
    { id: 'timeline' as ViewMode, label: 'Timeline', icon: BookOpen },
  ]

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Sidebar */}
      <aside 
        className={`fixed left-0 top-0 h-full bg-card border-r flex flex-col transition-all duration-300 z-40 ${
          sidebarCollapsed ? 'w-16' : 'w-56'
        }`}
      >
        {/* Sidebar Header */}
        <div className={`p-4 border-b flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!sidebarCollapsed && (
            <span className="font-bold text-lg">Dashboard</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="h-8 w-8"
          >
            {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        {/* Upload Section */}
        <div className={`p-3 border-b ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
          <input
            id="file-upload"
            type="file"
            accept=".txt,.xlsx,.xls"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button 
            variant="outline" 
            size={sidebarCollapsed ? 'icon' : 'default'}
            className={sidebarCollapsed ? 'h-10 w-10' : 'w-full justify-start'}
            type="button" 
            onClick={() => {
              const input = document.getElementById('file-upload') as HTMLInputElement
              if (input) {
                input.click()
              }
            }}
            title={sidebarCollapsed ? (fileName || 'Upload') : undefined}
          >
            <FileUp className={sidebarCollapsed ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
            {!sidebarCollapsed && (fileName ? fileName.slice(0, 15) + (fileName.length > 15 ? '...' : '') : 'Upload')}
          </Button>
          {!sidebarCollapsed && (
            <p className="text-xs text-muted-foreground mt-1 truncate" title={fileName || undefined}>
              {trades.length > 0
                ? `${trades.length} trade${trades.length === 1 ? '' : 's'} saved locally`
                : fileName
                  ? fileName
                  : 'No trades saved'}
            </p>
          )}
          <Button
            variant="outline"
            size={sidebarCollapsed ? 'icon' : 'default'}
            className={`${sidebarCollapsed ? 'h-10 w-10' : 'w-full justify-start'} mt-2`}
            type="button"
            onClick={() => void handleExportTrades()}
            disabled={trades.length === 0}
            title={sidebarCollapsed ? 'Export to Trade History for SC' : undefined}
          >
            <FileDown className={sidebarCollapsed ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
            {!sidebarCollapsed && 'Export to SC folder'}
          </Button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-4">
          <ul className="space-y-1 px-2">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = viewMode === item.id
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setViewMode(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive 
                        ? 'bg-primary text-primary-foreground' 
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title={sidebarCollapsed ? item.label : undefined}
                    disabled={trades.length === 0}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Dark Mode Toggle at Bottom */}
        <div className={`p-3 border-t ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
          <Button
            variant="ghost"
            size={sidebarCollapsed ? 'icon' : 'default'}
            onClick={() => setDarkMode(!darkMode)}
            className={sidebarCollapsed ? 'h-10 w-10' : 'w-full justify-start'}
            title={sidebarCollapsed ? (darkMode ? 'Light Mode' : 'Dark Mode') : undefined}
          >
            {darkMode ? (
              <>
                <Sun className={sidebarCollapsed ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
                {!sidebarCollapsed && 'Light Mode'}
              </>
            ) : (
              <>
                <Moon className={sidebarCollapsed ? 'h-4 w-4' : 'mr-2 h-4 w-4'} />
                {!sidebarCollapsed && 'Dark Mode'}
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main 
        className={`flex-1 min-h-screen transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-56'
        }`}
      >
        {/* Header */}
        <header className="border-b bg-card sticky top-0 z-30">
          <div className="px-6 py-4">
            <h1 className="text-[2rem] font-bold">{greeting}</h1>
            <p className="text-sm text-muted-foreground mt-1 italic">{'"You take random setups, you get random results"'}</p>
          </div>
        </header>

        <div
          className={`px-6 py-8 ${
            viewMode === 'overview'
              ? 'max-w-[88rem]'
              : viewMode === 'journal' || viewMode === 'timeline'
                ? 'max-w-[95vw]'
                : 'max-w-7xl'
          }`}
        >
          {trades.length > 0 ? (
            <>
              {/* Time Period Filter Bar - shown on all tabs */}
              <div className="flex flex-col gap-3 mb-6">
                {/* Row 1: Calendar buttons + date range + trade count */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={period === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('all'); setDateRange(undefined) }}
                  >
                    All Time
                  </Button>
                  <Button
                    variant={period === 'thisWeek' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('thisWeek'); setDateRange(undefined) }}
                  >
                    This Week
                  </Button>
                  <Button
                    variant={period === 'lastWeek' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('lastWeek'); setDateRange(undefined) }}
                  >
                    Last Week
                  </Button>
                  <Button
                    variant={period === 'thisMonth' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('thisMonth'); setDateRange(undefined) }}
                  >
                    This Month
                  </Button>
                  <Button
                    variant={period === 'lastMonth' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('lastMonth'); setDateRange(undefined) }}
                  >
                    Last Month
                  </Button>
                  <Button
                    variant={period === 'thisYear' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => { setPeriod('thisYear'); setDateRange(undefined) }}
                  >
                    This Year
                  </Button>
                  <div className="h-6 w-px bg-border mx-1" />
                  <CustomDateRangePicker 
                    dateRange={dateRange} 
                    onDateRangeChange={(range) => {
                      setDateRange(range)
                      if (range?.from) {
                        setPeriod('custom')
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground ml-2">
                    {viewMode === 'journal' && journalDayKey
                      ? `${journalTrades.length} trade${journalTrades.length === 1 ? '' : 's'} on ${dateKeyToLabel(journalDayKey)}`
                      : `${filteredTrades.length} trade${filteredTrades.length === 1 ? '' : 's'}`}
                  </span>
                  {viewMode === 'journal' && journalDayKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setJournalDayKey(null)}
                    >
                      Show all trades
                    </Button>
                  )}
                </div>
              </div>

              {/* Calendar Views */}
              {viewMode === 'month' && (
                <CalendarView
                  trades={filteredTrades}
                  selectedDate={selectedDate}
                  onDateSelect={handleDateSelect}
                  onWeekSelect={handleWeekSelect}
                  onToggleDayFlag={handleToggleDayFlag}
                  flaggedDays={flaggedDays}
                  darkMode={darkMode}
                  tradeTags={tradeTagsFromJournal}
                />
              )}

              {viewMode === 'week' && (
                <WeekView
                  trades={filteredTrades}
                  selectedDate={selectedDate}
                  onDateSelect={handleDayClick}
                  darkMode={darkMode}
                  tradeTags={tradeTagsFromJournal}
                />
              )}

              {viewMode === 'day' && (
                <DayView
                  trades={filteredTrades}
                  selectedDate={selectedDate}
                  darkMode={darkMode}
                  tradeTags={tradeTagsFromJournal}
                />
              )}

              {/* Simulation Mode */}
              {viewMode === 'simulation' && (
                <SimulatedOverview
                  trades={riskNormalizedTrades}
                  tradeTags={tradeTagsFromJournal}
                  darkMode={darkMode}
                />
              )}

              {/* Overview Mode */}
              {viewMode === 'overview' && (
                <div className="space-y-10">
                  <WeeklyKpiPanel
                    trades={tagFilteredTrades}
                    tradeTags={tradeTagsFromJournal}
                    darkMode={darkMode}
                  />

                  <div
                    className={`rounded-xl border p-4 ${
                      darkMode ? 'border-gray-700/80 bg-gray-800/50' : 'border-gray-200 bg-muted/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Tag filter</span>
                      <span className="text-xs text-muted-foreground">
                        Applies to charts, stats, and performance tables below
                      </span>
                    </div>
                    <TagFilterBar
                      mode={tagFilterMode}
                      setMode={setTagFilterMode}
                      selectedTags={tagFilterTags}
                      setSelectedTags={setTagFilterTags}
                      className="mb-0"
                    />
                  </div>

                  <OverviewCards
                    stats={overallStats}
                    streaks={streaks}
                    darkMode={darkMode}
                    trades={filteredTrades}
                    tradeTags={tradeTagsFromJournal}
                  />

                  <OverviewSection
                    id="overview-charts"
                    title="Charts"
                    description="Equity curve, win/loss mix, win rate, A rate, and period P&L trends."
                  >
                    <Charts
                      trades={filteredTrades}
                      stats={overallStats}
                      allTrades={tagFilteredTrades}
                      groupedData={groupedData}
                      period={groupingPeriod as 'daily' | 'weekly' | 'monthly' | 'yearly'}
                      darkMode={darkMode}
                      showAllPeriods={period === 'all'}
                      useAllTradesForTimeChart={period === 'all' && isTagFilterClear(tagFilterMode, tagFilterTags)}
                      tradeTags={tradeTagsFromJournal}
                    />
                  </OverviewSection>

                  <OverviewSection
                    title="Performance breakdown"
                    description="Calendar-year heatmap (daily or weekly) plus expandable period table with win rate, avg R:R, and gross P&L."
                  >
                    <div
                      className="space-y-6"
                      onMouseLeave={() => setHeatmapHoveredDayKey(null)}
                    >
                      <TradingDayHeatmap
                        trades={tagFilteredTrades}
                        darkMode={darkMode}
                        tradeTags={tradeTagsFromJournal}
                        calendarYear={heatmapCalendarYear}
                        availableYears={heatmapAvailableYears}
                        autoFollowCurrentYear={heatmapAutoFollowCurrentYear}
                        onCalendarYearChange={setHeatmapCalendarYear}
                        onAutoFollowCurrentYearChange={setHeatmapAutoFollowCurrentYear}
                        hoveredDayKey={heatmapHoveredDayKey}
                        onHoverDayKey={setHeatmapHoveredDayKey}
                        onDayClick={dayKey => handlePeriodClick(dayKey, 'daily')}
                        onWeekClick={weekKey => handlePeriodClick(weekKey, 'weekly')}
                      />
                      <TradesPerDayHeatmap
                        trades={tagFilteredTrades}
                        darkMode={darkMode}
                        calendarYear={heatmapCalendarYear}
                        availableYears={heatmapAvailableYears}
                        autoFollowCurrentYear={heatmapAutoFollowCurrentYear}
                        onCalendarYearChange={setHeatmapCalendarYear}
                        onAutoFollowCurrentYearChange={setHeatmapAutoFollowCurrentYear}
                        hoveredDayKey={heatmapHoveredDayKey}
                        onHoverDayKey={setHeatmapHoveredDayKey}
                        onDayClick={dayKey => handlePeriodClick(dayKey, 'daily')}
                      />
                      <PerformanceTable
                        groupedData={groupedData}
                        period={groupingPeriod as 'daily' | 'weekly' | 'monthly' | 'yearly'}
                        darkMode={darkMode}
                        onPeriodClick={handlePeriodClick}
                        tradeTags={tradeTagsFromJournal}
                        showTitle={false}
                      />
                    </div>
                  </OverviewSection>

                  <OverviewSection
                    title="Performance by day of week"
                    description="Which weekdays perform best — P&L bars and win rate trend plus detailed table."
                  >
                    <DayOfWeekStats
                      trades={filteredTrades}
                      darkMode={darkMode}
                      tradeTags={tradeTagsFromJournal}
                      showTitle={false}
                    />
                  </OverviewSection>
                </div>
              )}

              {/* Journal Mode */}
              {viewMode === 'journal' && (
                <JournalTable
                  key={mediaRefreshKey}
                  trades={journalTrades} 
                  darkMode={darkMode} 
                  onTradeTagsChange={setTradeTagsFromJournal}
                  flaggedTrades={flaggedTrades}
                  onToggleTradeFlag={handleToggleTradeFlag}
                  tagFilterMode={tagFilterMode}
                  setTagFilterMode={setTagFilterMode}
                  tagFilterTags={tagFilterTags}
                  setTagFilterTags={setTagFilterTags}
                  focusDayKey={journalDayKey}
                />
              )}

              {/* Timeline Mode */}
              {viewMode === 'timeline' && (
                <WeeklyNotesTimeline trades={riskNormalizedTrades} darkMode={darkMode} />
              )}
          </>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-16">
                <h2 className="text-2xl font-bold mb-4">No Data Loaded</h2>
                <p className="text-lg text-muted-foreground mb-8">
                  Upload TradesList.txt (Sierra Chart), trade_logs.txt, or an MT5 Report History Excel file (ReportHistory-*.xlsx) to view your trading performance.
                </p>
                <div className="max-w-2xl mx-auto text-left">
                  <Card>
                    <CardHeader>
                      <CardTitle>Features</CardTitle>
                      <CardDescription>What you can do with this dashboard</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="list-disc list-inside space-y-2 text-sm">
                        <li>Calendar view with month, week, and day breakdowns</li>
                        <li>Daily, Weekly, Monthly, and Yearly performance analysis</li>
                        <li>Win/Loss analysis with interactive charts</li>
                        <li>A Rate tracking (A + A+ setups)</li>
                        <li>Entry and Exit price visualization</li>
                        <li>Average risk per period</li>
                        <li>Equity curve and performance metrics</li>
                        <li>Profit factor, Sharpe ratio, and Max drawdown</li>
                        <li>Detailed trade-by-trade breakdown</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      </main>
    </div>
  )
}
