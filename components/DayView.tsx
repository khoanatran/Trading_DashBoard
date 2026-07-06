'use client'

import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Trade, calculateStats, parseLocalTimestamp } from '@/utils/logParser'
import { formatUsd, formatUsdPnl } from '@/lib/format'
import { format, isSameDay } from 'date-fns'
import { Calendar as CalendarIcon, TrendingUp, TrendingDown, DollarSign, Target, BarChart3 } from 'lucide-react'
import TradeDetailTable from './TradeDetailTable'

interface DayViewProps {
  trades: Trade[]
  selectedDate: Date
  darkMode: boolean
  tradeTags?: Record<string, string[]>
}

export default function DayView({ trades, selectedDate, darkMode, tradeTags }: DayViewProps) {
  // Filter trades for selected date
  const dayTrades = useMemo(() => {
    return trades.filter(trade => {
      if (!trade.timestamp) return false
      const tradeDate = parseLocalTimestamp(trade.timestamp)
      return isSameDay(tradeDate, selectedDate)
    })
  }, [trades, selectedDate])

  const dayStats = useMemo(() => calculateStats(dayTrades, tradeTags), [dayTrades, tradeTags])

  if (dayTrades.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No trades found for this date.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </CardTitle>
          <CardDescription>
            Detailed performance breakdown for this day
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">Total Trades</div>
              </div>
              <div className="text-3xl font-bold">{dayStats.totalTrades}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {dayStats.wins}W / {dayStats.losses}L / <span className="text-amber-500">{dayStats.breakevens}BE</span>
              </div>
            </div>

            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">Win Rate</div>
              </div>
              <div className={`text-3xl font-bold ${dayStats.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
                {dayStats.winRate.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Avg Win: {dayStats.avgWinRR.toFixed(1)}R
              </div>
            </div>

            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">Total P&L</div>
              </div>
              <div className={`text-3xl font-bold flex items-center gap-1 ${dayStats.totalPnL > 0 ? 'text-green-500' : 'text-red-500'}`}>
                {dayStats.totalPnL > 0 ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                {formatUsdPnl(dayStats.totalPnL)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Avg Risk: {formatUsd(dayStats.avgRisk)}
              </div>
            </div>

            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">Avg R:R</div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-green-500">{dayStats.avgWinRR.toFixed(2)}R</span>
                <span className="text-muted-foreground text-lg">/</span>
                <span className="text-2xl font-bold text-red-500">{dayStats.avgLossRR.toFixed(2)}R</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">Overall: {dayStats.avgRR.toFixed(1)}R</div>
              <div className="text-xs text-muted-foreground">
                Profit Factor: {dayStats.profitFactor === Infinity ? '∞' : dayStats.profitFactor.toFixed(2)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trade Details</CardTitle>
        </CardHeader>
        <CardContent>
          <TradeDetailTable trades={dayTrades} darkMode={darkMode} />
        </CardContent>
      </Card>
    </div>
  )
}
