'use client'

import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trade, calculateStats, parseLocalTimestamp } from '@/utils/logParser'
import { formatUsd, formatUsdPnl } from '@/lib/format'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WeekViewProps {
  trades: Trade[]
  selectedDate: Date
  onDateSelect: (date: Date) => void
  darkMode: boolean
  tradeTags?: Record<string, string[]>
}

export default function WeekView({ trades, selectedDate, onDateSelect, darkMode, tradeTags }: WeekViewProps) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 0 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  // Group trades by date
  const tradesByDate = useMemo(() => {
    const grouped: Record<string, Trade[]> = {}
    trades.forEach(trade => {
      if (trade.timestamp) {
        const date = parseLocalTimestamp(trade.timestamp)
        const dateKey = format(date, 'yyyy-MM-dd')
        if (!grouped[dateKey]) {
          grouped[dateKey] = []
        }
        grouped[dateKey].push(trade)
      }
    })
    return grouped
  }, [trades])

  const getTradesForDate = (date: Date): Trade[] => {
    const dateKey = format(date, 'yyyy-MM-dd')
    return tradesByDate[dateKey] || []
  }

  const weekStats = useMemo(() => {
    const weekTrades = weekDays.flatMap(day => getTradesForDate(day))
    return calculateStats(weekTrades, tradeTags)
  }, [weekDays, tradesByDate, tradeTags])

  return (
    <div className="space-y-6">
      {/* Week Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Total Trades</div>
            <div className="text-3xl font-bold">{weekStats.totalTrades}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Win Rate</div>
            <div className={`text-3xl font-bold ${weekStats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
              {weekStats.winRate.toFixed(1)}%
            </div>
            <div className="text-sm text-muted-foreground mt-1">{weekStats.wins}W / {weekStats.losses}L / <span className="text-amber-500">{weekStats.breakevens}BE</span></div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Total P&L</div>
            <div className={`text-3xl font-bold ${weekStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatUsdPnl(weekStats.totalPnL)}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-2 uppercase tracking-wide">Avg R:R</div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-green-500">{weekStats.avgWinRR.toFixed(1)}R</span>
              <span className="text-muted-foreground text-lg">/</span>
              <span className="text-2xl font-bold text-red-500">{weekStats.avgLossRR.toFixed(2)}R</span>
            </div>
            <div className="text-sm text-muted-foreground mt-1">Overall: {weekStats.avgRR.toFixed(1)}R</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Week View: {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </CardTitle>
          <CardDescription>
            Click on a day to view detailed performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Daily Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {weekDays.map((day, index) => {
                const dayTrades = getTradesForDate(day)
                const dayStats = calculateStats(dayTrades, tradeTags)
                const isSelected = isSameDay(day, selectedDate)
                const isToday = isSameDay(day, new Date())

                return (
                  <Button
                    key={index}
                    variant={isSelected ? "default" : "outline"}
                    className={`h-auto p-3 flex flex-col items-center gap-2 ${isToday && !isSelected ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => onDateSelect(day)}
                  >
                    <div className={`text-xs font-medium ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {format(day, 'EEE')}
                    </div>
                    <div className={`text-lg font-bold ${isSelected ? 'text-primary-foreground' : isToday ? 'text-primary' : ''}`}>
                      {format(day, 'd')}
                    </div>
                    {dayTrades.length > 0 && (
                      <div className="space-y-1 text-xs">
                        <div className={`font-semibold ${isSelected ? 'text-primary-foreground' : ''}`}>
                          {dayTrades.length} trade{dayTrades.length !== 1 ? 's' : ''}
                        </div>
                        <div className={`${dayStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatUsdPnl(dayStats.totalPnL)}
                        </div>
                      </div>
                    )}
                  </Button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

