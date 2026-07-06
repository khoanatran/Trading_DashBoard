'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Trade,
  calculateStats,
  parseLocalTimestamp,
  getTradeEntryTimeMs,
} from '@/utils/logParser'
import { formatUsdPnl } from '@/lib/format'
import { format, startOfWeek, endOfWeek, getISOWeek, getISOWeekYear } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey, dateKeyToLabel } from '@/utils/tradingDays'
import {
  BookOpen,
  Calendar,
  CalendarDays,
  TrendingUp,
  TrendingDown,
  Edit3,
  Save,
  ChevronDown,
  ChevronUp,
  Sun,
  LineChart,
} from 'lucide-react'
import TimelineTradesTable from '@/components/TimelineTradesTable'
import DailyRecapDay from '@/components/DailyRecapDay'
import DrawdownRecap from '@/components/DrawdownRecap'
import { useSignificantDrawdownEpisodes } from '@/hooks/useSignificantDrawdownEpisodes'
import {
  consumePendingDrawdownRecapKey,
  NAVIGATE_DRAWDOWN_RECAP_EVENT,
} from '@/lib/drawdown-nav'
import { SIGNIFICANT_DRAWDOWN_MIN } from '@/utils/logParser'

type TimelineScope = 'all' | 'today' | 'recap' | 'drawdown'

interface WeeklyNote {
  weekKey: string
  content: string
  updatedAt: string
}

interface WeeklyNotesTimelineProps {
  trades: Trade[]
  darkMode: boolean
}

interface WeekData {
  weekKey: string
  weekStart: Date
  weekEnd: Date
  trades: Trade[]
  note: WeeklyNote | null
}

function getTradesForDateKey(trades: Trade[], dateKey: string): Trade[] {
  return trades
    .filter(trade => {
      if (!trade.timestamp || !trade.isClosed) return false
      const tradeKey = formatDateKey(parseLocalTimestamp(trade.timestamp), DISPLAY_TIMEZONE)
      return tradeKey === dateKey
    })
    .sort((a, b) => getTradeEntryTimeMs(b) - getTradeEntryTimeMs(a))
}

export default function WeeklyNotesTimeline({ trades, darkMode }: WeeklyNotesTimelineProps) {
  const [weeklyNotes, setWeeklyNotes] = useState<WeeklyNote[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [timelineScope, setTimelineScope] = useState<TimelineScope>('all')
  const [recapDateKey, setRecapDateKey] = useState(() =>
    formatDateKey(new Date(), DISPLAY_TIMEZONE)
  )
  const [editingWeekKey, setEditingWeekKey] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set())
  const [activeDrawdownKey, setActiveDrawdownKey] = useState<string | null>(null)

  const { drawdownSeries, episodes: drawdownEpisodes } =
    useSignificantDrawdownEpisodes(trades)

  useEffect(() => {
    const applyPending = () => {
      const key = consumePendingDrawdownRecapKey()
      if (key) {
        setTimelineScope('drawdown')
        setActiveDrawdownKey(key)
      }
    }
    applyPending()
    const onNavigate = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key
      if (!key) return
      setTimelineScope('drawdown')
      setActiveDrawdownKey(key)
    }
    window.addEventListener(NAVIGATE_DRAWDOWN_RECAP_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATE_DRAWDOWN_RECAP_EVENT, onNavigate)
  }, [])

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch('/api/weekly-notes')
        if (res.ok) {
          const data = await res.json()
          setWeeklyNotes(data.notes || [])
        }
      } catch (err) {
        console.error('Error fetching weekly notes:', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchNotes()
  }, [])

  const getWeekKey = (date: Date): string => {
    const year = getISOWeekYear(date)
    const week = getISOWeek(date)
    return `${year}-W${String(week).padStart(2, '0')}`
  }

  const todayKey = formatDateKey(new Date(), DISPLAY_TIMEZONE)
  const todayLabel = dateKeyToLabel(todayKey)

  const todayTrades = useMemo(
    () => getTradesForDateKey(trades, todayKey),
    [trades, todayKey]
  )

  const todayStats = useMemo(
    () => (todayTrades.length > 0 ? calculateStats(todayTrades) : null),
    [todayTrades]
  )

  const recapTrades = useMemo(
    () => getTradesForDateKey(trades, recapDateKey),
    [trades, recapDateKey]
  )

  const recapLabel = useMemo(() => dateKeyToLabel(recapDateKey), [recapDateKey])

  const recapStats = useMemo(
    () => (recapTrades.length > 0 ? calculateStats(recapTrades) : null),
    [recapTrades]
  )

  const datesWithTrades = useMemo(() => {
    const keys = new Set<string>()
    trades.forEach(trade => {
      if (!trade.timestamp || !trade.isClosed) return
      keys.add(formatDateKey(parseLocalTimestamp(trade.timestamp), DISPLAY_TIMEZONE))
    })
    return Array.from(keys).sort((a, b) => b.localeCompare(a))
  }, [trades])

  const currentWeekKey = getWeekKey(new Date())
  const todayWeekNote = weeklyNotes.find(n => n.weekKey === currentWeekKey) ?? null

  const recapWeekKey = useMemo(() => {
    const d = fromZonedTime(`${recapDateKey} 12:00:00`, DISPLAY_TIMEZONE)
    return getWeekKey(d)
  }, [recapDateKey])

  const recapWeekNote = weeklyNotes.find(n => n.weekKey === recapWeekKey) ?? null

  const weekData = useMemo(() => {
    const weeks: Record<string, WeekData> = {}

    trades.forEach(trade => {
      if (!trade.timestamp || !trade.isClosed) return

      const date = parseLocalTimestamp(trade.timestamp)
      const weekKey = getWeekKey(date)

      if (!weeks[weekKey]) {
        const weekStart = startOfWeek(date, { weekStartsOn: 1 })
        const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
        weeks[weekKey] = {
          weekKey,
          weekStart,
          weekEnd,
          trades: [],
          note: null,
        }
      }

      weeks[weekKey].trades.push(trade)
    })

    weeklyNotes.forEach(note => {
      if (weeks[note.weekKey]) {
        weeks[note.weekKey].note = note
      } else {
        const [yearStr, weekStr] = note.weekKey.split('-W')
        const year = parseInt(yearStr)
        const weekNum = parseInt(weekStr)
        const jan4 = new Date(year, 0, 4)
        const weekStart = startOfWeek(jan4, { weekStartsOn: 1 })
        weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7)
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

        weeks[note.weekKey] = {
          weekKey: note.weekKey,
          weekStart,
          weekEnd,
          trades: [],
          note,
        }
      }
    })

    return Object.values(weeks).sort((a, b) => b.weekKey.localeCompare(a.weekKey))
  }, [trades, weeklyNotes])

  const weeksWithNotes = useMemo(() => {
    return weekData.filter(w => w.note !== null)
  }, [weekData])

  const sortWeekTrades = (weekTrades: Trade[]) =>
    [...weekTrades].sort((a, b) => getTradeEntryTimeMs(a) - getTradeEntryTimeMs(b))

  const saveNote = useCallback(async () => {
    if (!editingWeekKey) return

    setIsSaving(true)
    try {
      const res = await fetch('/api/weekly-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekKey: editingWeekKey, content: editContent }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.note) {
          setWeeklyNotes(prev => {
            const existing = prev.findIndex(n => n.weekKey === editingWeekKey)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = { weekKey: editingWeekKey, ...data.note }
              return updated
            }
            return [...prev, { weekKey: editingWeekKey, ...data.note }]
          })
        } else {
          setWeeklyNotes(prev => prev.filter(n => n.weekKey !== editingWeekKey))
        }
      }
    } catch (err) {
      console.error('Error saving note:', err)
    } finally {
      setIsSaving(false)
      setEditingWeekKey(null)
    }
  }, [editingWeekKey, editContent])

  const toggleWeek = (weekKey: string) => {
    setCollapsedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(weekKey)) {
        next.delete(weekKey)
      } else {
        next.add(weekKey)
      }
      return next
    })
  }

  const cardClass = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'

  const scopeTabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      active
        ? darkMode
          ? 'bg-gray-900 text-white border border-b-0 border-gray-600'
          : 'bg-white text-gray-900 border border-b-0 border-gray-300 shadow-sm'
        : darkMode
          ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
    }`

  const dateInputClass = `rounded-lg border px-3 py-1.5 text-sm ${
    darkMode
      ? 'bg-gray-900 border-gray-600 text-gray-100'
      : 'bg-white border-gray-300 text-gray-900'
  }`

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className={cardClass}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-400" />
            Trading Timeline
          </CardTitle>
          <CardDescription>
            Weekly recaps, daily views, and drawdown periods linked from the equity curve on
            Overview
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`flex flex-wrap gap-1 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={timelineScope === 'all'}
              className={scopeTabClass(timelineScope === 'all')}
              onClick={() => setTimelineScope('all')}
            >
              All Time
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={timelineScope === 'today'}
              className={scopeTabClass(timelineScope === 'today')}
              onClick={() => setTimelineScope('today')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Sun className="h-4 w-4 text-amber-400" />
                Today
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={timelineScope === 'recap'}
              className={scopeTabClass(timelineScope === 'recap')}
              onClick={() => setTimelineScope('recap')}
            >
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-indigo-400" />
                Daily Recap
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={timelineScope === 'drawdown'}
              className={scopeTabClass(timelineScope === 'drawdown')}
              onClick={() => setTimelineScope('drawdown')}
            >
              <span className="inline-flex items-center gap-1.5">
                <LineChart className="h-4 w-4 text-red-400" />
                Drawdown Recap
              </span>
            </button>
          </div>

          {timelineScope === 'all' ? (
            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
              <span>{weekData.length} weeks with trades</span>
              <span>•</span>
              <span className="text-indigo-400 font-medium">
                {weeksWithNotes.length} weeks with recaps
              </span>
            </div>
          ) : timelineScope === 'today' ? (
            <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
              <span className="text-muted-foreground">{todayLabel} (ET)</span>
              <span className="font-medium">{todayTrades.length} trade(s) today</span>
              {todayStats && (
                <span className={todayStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}>
                  {formatUsdPnl(todayStats.totalPnL)}
                </span>
              )}
            </div>
          ) : timelineScope === 'drawdown' ? (
            <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
              <span className="text-muted-foreground">
                Drawdowns over {formatUsdPnl(SIGNIFICANT_DRAWDOWN_MIN)}
              </span>
              <span className="font-medium">{drawdownEpisodes.length} period(s)</span>
              {drawdownSeries.maxDrawdown > 0 && (
                <span className="text-red-500">
                  Max {formatUsdPnl(drawdownSeries.maxDrawdown)}
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-muted-foreground" htmlFor="recap-date">
                  Date (ET)
                </label>
                <input
                  id="recap-date"
                  type="date"
                  value={recapDateKey}
                  max={todayKey}
                  onChange={e => {
                    if (e.target.value) setRecapDateKey(e.target.value)
                  }}
                  className={dateInputClass}
                />
                {recapDateKey !== todayKey && (
                  <button
                    type="button"
                    onClick={() => setRecapDateKey(todayKey)}
                    className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      darkMode
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                    }`}
                  >
                    Jump to today
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-muted-foreground">{recapLabel} (ET)</span>
                <span className="font-medium">{recapTrades.length} trade(s)</span>
                {recapStats && (
                  <span className={recapStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}>
                    {formatUsdPnl(recapStats.totalPnL)}
                  </span>
                )}
              </div>
              {datesWithTrades.length > 0 && (
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                  {datesWithTrades.slice(0, 30).map(key => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRecapDateKey(key)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        recapDateKey === key
                          ? 'bg-indigo-500 text-white'
                          : darkMode
                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {formatInTimeZone(
                        fromZonedTime(`${key} 12:00:00`, DISPLAY_TIMEZONE),
                        DISPLAY_TIMEZONE,
                        'MMM d, yyyy'
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {timelineScope === 'drawdown' ? (
        drawdownEpisodes.length === 0 ? (
          <Card className={cardClass}>
            <CardContent className="py-12 text-center text-muted-foreground">
              <TrendingDown className="h-12 w-12 mx-auto mb-4 opacity-50 text-red-400" />
              <p className="text-lg mb-2">No significant drawdowns</p>
              <p className="text-sm">
                None over {formatUsdPnl(SIGNIFICANT_DRAWDOWN_MIN)} in your trade history, or import
                trades to build the equity curve.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className={cardClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingDown className="h-5 w-5 text-red-400" />
                Drawdown Recap
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DrawdownRecap
                trades={trades}
                episodes={drawdownEpisodes}
                drawdownSeries={drawdownSeries}
                darkMode={darkMode}
                activeEpisodeKey={activeDrawdownKey}
                onActiveEpisodeKeyChange={setActiveDrawdownKey}
                showOverviewChartLink
              />
            </CardContent>
          </Card>
        )
      ) : timelineScope === 'today' ? (
        <DailyRecapDay
          dateKey={todayKey}
          dateLabel={todayLabel}
          trades={todayTrades}
          weekNote={todayWeekNote}
          weekNumberLabel={currentWeekKey.split('-W')[1]}
          darkMode={darkMode}
          tradesSectionTitle="Today's trades"
          emptyIcon={<Sun className="h-10 w-10 mx-auto mb-3 opacity-50 text-amber-400" />}
          emptyMessage={`No closed trades for ${todayLabel} yet.`}
        />
      ) : timelineScope === 'recap' ? (
        <DailyRecapDay
          dateKey={recapDateKey}
          dateLabel={recapLabel}
          trades={recapTrades}
          weekNote={recapWeekNote}
          weekNumberLabel={recapWeekKey.split('-W')[1]}
          darkMode={darkMode}
          tradesSectionTitle={`Trades on ${formatInTimeZone(
            fromZonedTime(`${recapDateKey} 12:00:00`, DISPLAY_TIMEZONE),
            DISPLAY_TIMEZONE,
            'MMM d, yyyy'
          )}`}
          emptyMessage={`No closed trades for ${recapLabel}.`}
        />
      ) : weeksWithNotes.length === 0 ? (
        <Card className={cardClass}>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-2">No weekly recaps yet</p>
              <p className="text-sm">
                Add your first recap from the Journal tab to start building your timeline
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          <div
            className={`absolute left-8 top-0 bottom-0 w-0.5 ${darkMode ? 'bg-indigo-500/30' : 'bg-indigo-200'}`}
          />

          <div className="space-y-4">
            {weeksWithNotes.map((week, index) => {
              const stats = week.trades.length > 0 ? calculateStats(week.trades) : null
              const isExpanded = !collapsedWeeks.has(week.weekKey)
              const isEditing = editingWeekKey === week.weekKey
              const sortedTrades = sortWeekTrades(week.trades)

              const currentYear = week.weekKey.split('-W')[0]
              const prevWeek = index > 0 ? weeksWithNotes[index - 1] : null
              const prevYear = prevWeek ? prevWeek.weekKey.split('-W')[0] : null
              const showYearMarker = index === 0 || currentYear !== prevYear

              return (
                <React.Fragment key={week.weekKey}>
                  {showYearMarker && (
                    <div className="relative pl-16 py-2">
                      <div
                        className={`absolute left-5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center ${
                          darkMode ? 'bg-indigo-600' : 'bg-indigo-500'
                        }`}
                      >
                        <span className="text-white text-xs font-bold">
                          {currentYear.slice(2)}
                        </span>
                      </div>
                      <div
                        className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold ${
                          darkMode
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {currentYear}
                      </div>
                    </div>
                  )}

                  <div className="relative pl-16">
                    <div
                      className={`absolute left-6 top-6 w-5 h-5 rounded-full border-2 ${
                        darkMode
                          ? 'bg-gray-900 border-indigo-400'
                          : 'bg-white border-indigo-500'
                      }`}
                    >
                      <div className="absolute inset-1 rounded-full bg-indigo-500" />
                    </div>

                    <Card className={`${cardClass} overflow-hidden`}>
                      <div
                        className={`px-6 py-4 cursor-pointer ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-50'}`}
                        onClick={() => toggleWeek(week.weekKey)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                                darkMode ? 'bg-indigo-500/20' : 'bg-indigo-100'
                              }`}
                            >
                              <Calendar className="h-4 w-4 text-indigo-400" />
                              <span className="font-semibold text-indigo-400">
                                Week {week.weekKey.split('-W')[1]}
                              </span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {format(week.weekStart, 'MMM d')} -{' '}
                              {format(week.weekEnd, 'MMM d, yyyy')}
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            {stats && (
                              <div className="flex items-center gap-3 text-sm">
                                <span
                                  className={
                                    stats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'
                                  }
                                >
                                  {stats.totalPnL > 0 ? (
                                    <TrendingUp className="h-4 w-4 inline mr-1" />
                                  ) : (
                                    <TrendingDown className="h-4 w-4 inline mr-1" />
                                  )}
                                  {formatUsdPnl(stats.totalPnL)}
                                </span>
                                <span className="text-muted-foreground">
                                  {stats.totalTrades} trades
                                </span>
                                <span
                                  className={
                                    stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'
                                  }
                                >
                                  {stats.winRate.toFixed(0)}% WR
                                </span>
                              </div>
                            )}
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div
                          className={`px-6 py-4 border-t space-y-6 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
                        >
                          <div>
                            <h4 className="text-sm font-semibold text-indigo-400 mb-3">
                              Weekly recap
                            </h4>
                            {isEditing ? (
                              <div className="space-y-4">
                                <textarea
                                  value={editContent}
                                  onChange={e => setEditContent(e.target.value)}
                                  className={`w-full h-40 px-4 py-3 rounded-lg border resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                                    darkMode
                                      ? 'bg-gray-900 border-gray-700 text-white'
                                      : 'bg-gray-50 border-gray-300 text-gray-900'
                                  }`}
                                  autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setEditingWeekKey(null)}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                      darkMode
                                        ? 'bg-gray-700 hover:bg-gray-600'
                                        : 'bg-gray-200 hover:bg-gray-300'
                                    }`}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={saveNote}
                                    disabled={isSaving}
                                    className="px-4 py-2 rounded-lg font-medium bg-indigo-500 hover:bg-indigo-600 text-white flex items-center gap-2"
                                  >
                                    <Save className="h-4 w-4" />
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <p className="whitespace-pre-wrap text-sm">
                                  {week.note?.content}
                                </p>
                                <div className="flex items-center justify-between pt-2">
                                  <span className="text-xs text-muted-foreground">
                                    Last updated:{' '}
                                    {week.note?.updatedAt
                                      ? format(
                                          new Date(week.note.updatedAt),
                                          'MMM d, yyyy h:mm a'
                                        )
                                      : 'N/A'}
                                  </span>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      setEditingWeekKey(week.weekKey)
                                      setEditContent(week.note?.content || '')
                                    }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                      darkMode
                                        ? 'bg-gray-700 hover:bg-gray-600'
                                        : 'bg-gray-200 hover:bg-gray-300'
                                    }`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    Edit recap
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {sortedTrades.length > 0 && (
                            <TimelineTradesTable
                              trades={sortedTrades}
                              darkMode={darkMode}
                              title={`Trades (${sortedTrades.length})`}
                            />
                          )}
                        </div>
                      )}
                    </Card>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
