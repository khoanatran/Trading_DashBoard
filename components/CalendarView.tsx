'use client'

import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Trade,
  TradeStats,
  calculateStats,
  getARateBreakdown,
  getTradeCloseAt,
  getCloseDatePeriodKey,
  formatOverviewAvgRR,
  isOverviewAvgRRFavorable,
} from '@/utils/logParser'
import { formatUsdPnl } from '@/lib/format'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey } from '@/utils/tradingDays'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, addMonths, subMonths, getWeek, isWithinInterval } from 'date-fns'
import { Calendar as CalendarIcon, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CalendarViewProps {
  trades: Trade[]
  selectedDate: Date | undefined
  onDateSelect: (date: Date | undefined) => void
  onWeekSelect?: (weekStartDate: Date) => void
  onToggleDayFlag?: (dateKey: string) => void
  flaggedDays?: Record<string, boolean>
  darkMode: boolean
  tradeTags?: Record<string, string[]>
}

/** Map a calendar grid day to a stable ET date key (matches Overview/charts close-date grouping). */
function calendarGridDayToEtKey(day: Date): string {
  const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0)
  return formatDateKey(noon, DISPLAY_TIMEZONE)
}

function formatCellARate(trades: Trade[], tradeTags?: Record<string, string[]>) {
  const { aRate, decisiveTrades } = getARateBreakdown(trades, tradeTags)
  return decisiveTrades > 0 ? `${aRate.toFixed(0)}% A` : 'N/A'
}

function GrossProfitLossLine({
  stats,
  size = 'sm',
}: {
  stats: TradeStats
  size?: 'sm' | 'xs'
}) {
  const textClass = size === 'xs' ? 'text-[10px]' : 'text-sm'
  return (
    <div className={`${textClass} text-center flex gap-1 justify-center flex-wrap`}>
      <span className="text-green-500">
        {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '-'}
      </span>
      <span className="text-muted-foreground">/</span>
      <span className="text-red-500">
        {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '-'}
      </span>
    </div>
  )
}

function CalendarCellStats({
  stats,
  trades,
  tradeTags,
  darkMode,
}: {
  stats: TradeStats
  trades: Trade[]
  tradeTags?: Record<string, string[]>
  darkMode: boolean
}) {
  return (
    <div className="w-full space-y-1.5">
      <div
        className={`text-2xl font-bold text-center ${
          stats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'
        }`}
      >
        {formatUsdPnl(stats.totalPnL)}
      </div>
      <GrossProfitLossLine stats={stats} size="xs" />
      <div className={`text-[1.025rem] font-semibold text-center ${darkMode ? 'text-white' : ''}`}>
        {stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'}
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-center">
        <span
          className={
            stats.wins + stats.losses > 0
              ? stats.winRate >= 50
                ? 'text-green-500'
                : 'text-red-500'
              : 'text-muted-foreground'
          }
        >
          {stats.wins + stats.losses > 0 ? `${stats.winRate.toFixed(0)}% WR` : 'N/A WR'}
        </span>
        <span className="text-teal-400">{formatCellARate(trades, tradeTags)}</span>
      </div>
    </div>
  )
}

export default function CalendarView({
  trades,
  selectedDate,
  onDateSelect,
  onWeekSelect,
  onToggleDayFlag,
  flaggedDays = {},
  darkMode,
  tradeTags,
}: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = React.useState(selectedDate || new Date())

  // Group closed trades by ET close date (same as Overview A Rate chart / aggregateByPeriod)
  const tradesByCloseDate = useMemo(() => {
    const grouped: Record<string, Trade[]> = {}
    trades.forEach(trade => {
      if (!trade.isClosed) return
      const closeAt = getTradeCloseAt(trade)
      if (!closeAt) return
      const dateKey = formatDateKey(closeAt, DISPLAY_TIMEZONE)
      if (!grouped[dateKey]) {
        grouped[dateKey] = []
      }
      grouped[dateKey].push(trade)
    })
    return grouped
  }, [trades])

  // Calculate stats for the current month (by close date in ET)
  const monthStats = useMemo(() => {
    const monthKey = format(currentMonth, 'yyyy-MM')
    const monthTrades = trades.filter(trade => {
      if (!trade.isClosed) return false
      const closeAt = getTradeCloseAt(trade)
      if (!closeAt) return false
      const closeKey = formatDateKey(closeAt, DISPLAY_TIMEZONE)
      return closeKey.startsWith(monthKey)
    })
    return monthTrades.length > 0 ? calculateStats(monthTrades, tradeTags) : null
  }, [trades, currentMonth, tradeTags])

  const getTradesForDate = (date: Date): Trade[] => {
    return tradesByCloseDate[calendarGridDayToEtKey(date)] || []
  }

  // Generate calendar days grouped by weeks
  const calendarWeeks = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart)
    const endDate = endOfWeek(monthEnd)

    const weeks: Date[][] = []
    let day = startDate
    let currentWeek: Date[] = []
    
    while (day <= endDate) {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
      day = addDays(day, 1)
    }
    
    if (currentWeek.length > 0) {
      weeks.push(currentWeek)
    }
    
    return weeks
  }, [currentMonth])

  const getWeekData = (weekDays: Date[]) => {
    const anchor = weekDays[3] ?? weekDays[0]
    const anchorNoon = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 12, 0, 0)
    const weekKey = getCloseDatePeriodKey(anchorNoon, 'weekly')
    const weekTrades = trades.filter(trade => {
      if (!trade.isClosed) return false
      const closeAt = getTradeCloseAt(trade)
      if (!closeAt) return false
      return getCloseDatePeriodKey(closeAt, 'weekly') === weekKey
    })
    if (weekTrades.length === 0) return null
    return {
      weekKey,
      trades: weekTrades,
      stats: calculateStats(weekTrades, tradeTags),
    }
  }

  return (
    <div className="space-y-6">
      {/* Month Summary Stats */}
      {monthStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Total Trades</div>
              <div className="text-3xl font-bold">{monthStats.totalTrades}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Win Rate</div>
              <div className={`text-3xl font-bold ${monthStats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
                {monthStats.winRate.toFixed(1)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">{monthStats.wins}W / {monthStats.losses}L / <span className="text-amber-500">{monthStats.breakevens}BE</span></div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Total P&L</div>
              <div className={`text-3xl font-bold flex items-center gap-2 ${monthStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}`}>
                {monthStats.totalPnL > 0 ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                {formatUsdPnl(monthStats.totalPnL)}
              </div>
              <div className="mt-1">
                <GrossProfitLossLine stats={monthStats} />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Avg R:R</div>
              {(() => {
                const avgRR = {
                  value: formatOverviewAvgRR(monthStats),
                  favorable: isOverviewAvgRRFavorable(monthStats),
                  showSubtitle: monthStats.wins + monthStats.losses > 0,
                }
                return (
                  <>
                    <div
                      className={`text-3xl font-bold ${
                        avgRR.value === 'N/A'
                          ? 'text-muted-foreground'
                          : avgRR.favorable
                            ? 'text-[#21C55E]'
                            : 'text-[#EF4444]'
                      }`}
                    >
                      {avgRR.value}
                    </div>
                    {avgRR.showSubtitle && (
                      <div className="text-sm text-muted-foreground mt-1">
                        <span className="text-[#21C55E]">{monthStats.avgWinRR.toFixed(1)}R</span>
                        <span> / </span>
                        <span className="text-[#EF4444]">{monthStats.avgLossRR.toFixed(1)}R</span>
                      </div>
                    )}
                  </>
                )
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                {format(currentMonth, 'MMMM yyyy')}
              </CardTitle>
              <CardDescription>
                Click a date for details. Use the flag to mark a calendar day for review (separate from trade flags in the journal).
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Day headers - 7 days + weekly summary (30% wider) - 35% larger font */}
          <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: 'repeat(7, 1fr) 1.3fr', fontSize: '1.35em' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="text-center text-sm font-semibold text-muted-foreground py-2"
              >
                {day}
              </div>
            ))}
            <div className="text-center text-sm font-semibold text-muted-foreground py-2">
              Week
            </div>
          </div>

          {/* Calendar grid by weeks */}
          <div className="space-y-2 overflow-visible">
            {calendarWeeks.map((week, weekIndex) => {
              const weekData = getWeekData(week)
              const weekStats = weekData?.stats ?? null
              const weekTrades = weekData?.trades ?? []
              const weekNum = weekData?.weekKey
                ? parseInt(weekData.weekKey.split('-W')[1] ?? '', 10)
                : getWeek(week[0])
              
              return (
                <div key={weekIndex} className="grid gap-2 overflow-visible" style={{ gridTemplateColumns: 'repeat(7, 1fr) 1.3fr', fontSize: '1.35em' }}>
                  {/* Day cells */}
                  {week.map((day, dayIndex) => {
                    const dayTrades = getTradesForDate(day)
                    const dayStats = dayTrades.length > 0 ? calculateStats(dayTrades, tradeTags) : null
                    const dateKey = calendarGridDayToEtKey(day)
                    const isFlagged = Boolean(flaggedDays[dateKey])
                    const isCurrentMonth = isSameMonth(day, currentMonth)
                    const isToday = isSameDay(day, new Date())
                    const isSelected = selectedDate ? isSameDay(day, selectedDate) : false

                    const pnlBgColor = dayStats
                      ? dayStats.totalPnL > 0
                        ? (darkMode ? '#004530' : '#D6F4EC')
                        : dayStats.totalPnL < 0
                          ? (darkMode ? '#4E1616' : '#F8C3BE')
                          : undefined
                      : undefined

                    return (
                      <button
                        key={dayIndex}
                        onClick={() => onDateSelect(day)}
                        style={{ backgroundColor: pnlBgColor }}
                        className={`
                          relative min-h-[140px] p-3 rounded-lg border-2 transition-all
                          hover:scale-[1.35] hover:z-10 hover:shadow-lg hover:ring-2 hover:ring-foreground/25
                          ${isSelected ? 'border-foreground/60 ring-2 ring-foreground/40' : 'border-border hover:border-foreground/40'}
                          ${isFlagged ? 'ring-2 ring-amber-500/70 border-amber-500/50' : ''}
                          ${!isCurrentMonth ? 'opacity-40' : ''}
                          ${isToday ? 'ring-2 ring-foreground/50' : ''}
                          flex flex-col items-start gap-2
                        `}
                      >
                        {onToggleDayFlag && (
                          <button
                            type="button"
                            title={isFlagged ? 'Unflag day' : 'Flag day for review'}
                            aria-label={isFlagged ? 'Unflag day' : 'Flag day for review'}
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleDayFlag(dateKey)
                            }}
                            className={`absolute top-2 right-2 rounded-md p-1 transition-colors ${
                              isFlagged
                                ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                                : 'text-muted-foreground hover:text-amber-400 hover:bg-muted/80'
                            }`}
                          >
                            <Flag className={`h-3.5 w-3.5 ${isFlagged ? 'fill-current' : ''}`} />
                          </button>
                        )}
                        {/* Date number */}
                        <div className={`text-lg font-bold pr-6 ${darkMode ? 'text-white' : isToday ? 'text-primary' : ''}`}>
                          {format(day, 'd')}
                        </div>

                        {/* Trade stats (if there are trades) */}
                        {dayStats && (
                          <CalendarCellStats
                            stats={dayStats}
                            trades={dayTrades}
                            tradeTags={tradeTags}
                            darkMode={darkMode}
                          />
                        )}
                      </button>
                    )
                  })}
                  
                  {/* Weekly summary cell */}
                  {onWeekSelect ? (
                    <button
                      type="button"
                      onClick={() => onWeekSelect(week[0])}
                      style={{
                        backgroundColor: weekStats
                          ? weekStats.totalPnL > 0 ? (darkMode ? '#004530' : '#D6F4EC') : weekStats.totalPnL < 0 ? (darkMode ? '#4E1616' : '#F8C3BE') : undefined
                          : undefined
                      }}
                      className={`
                        relative min-h-[140px] p-3 rounded-lg border-2 transition-all cursor-pointer
                        hover:scale-[1.35] hover:z-10 hover:shadow-lg hover:ring-2 hover:ring-foreground/25
                        ${weekStats ? 'border-border hover:border-foreground/40' : 'border-border hover:border-foreground/40 hover:bg-muted/50'}
                        ${selectedDate && isWithinInterval(selectedDate, { start: week[0], end: endOfWeek(week[0]) }) ? 'ring-2 ring-foreground/40 border-foreground/60' : ''}
                        flex flex-col items-center justify-center gap-2 text-left
                      `}
                    >
                      {/* Week number */}
                      <div className={`text-xs font-semibold ${darkMode ? 'text-white' : 'text-muted-foreground'}`}>
                        Week {weekNum}
                      </div>

                      {/* Weekly stats */}
                      {weekStats ? (
                        <CalendarCellStats
                          stats={weekStats}
                          trades={weekTrades}
                          tradeTags={tradeTags}
                          darkMode={darkMode}
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">No trades</div>
                      )}
                    </button>
                  ) : (
                    <div
                      style={{
                        backgroundColor: weekStats
                          ? weekStats.totalPnL > 0
                            ? (darkMode ? '#004530' : '#D6F4EC')
                            : weekStats.totalPnL < 0
                              ? (darkMode ? '#4E1616' : '#F8C3BE')
                              : undefined
                          : undefined
                      }}
                      className={`
                        min-h-[140px] p-3 rounded-lg border-2 transition-all
                        ${weekStats ? 'border-primary/30' : 'border-border'}
                        flex flex-col items-center justify-center gap-2
                      `}
                    >
                      {/* Week number */}
                      <div className={`text-xs font-semibold ${darkMode ? 'text-white' : 'text-muted-foreground'}`}>
                        Week {weekNum}
                      </div>

                      {/* Weekly stats */}
                      {weekStats ? (
                        <CalendarCellStats
                          stats={weekStats}
                          trades={weekTrades}
                          tradeTags={tradeTags}
                          darkMode={darkMode}
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">No trades</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

