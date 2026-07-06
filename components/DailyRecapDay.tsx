'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Trade, buildDailyEquityCurve } from '@/utils/logParser'
import { Calendar } from 'lucide-react'
import TimelineTradesTable from '@/components/TimelineTradesTable'
import DailySummaryPanel from '@/components/DailySummaryPanel'
import DailyEquityCurveChart from '@/components/DailyEquityCurveChart'

interface WeeklyNote {
  weekKey: string
  content: string
  updatedAt: string
}

export interface DailyRecapDayProps {
  dateKey: string
  dateLabel: string
  trades: Trade[]
  weekNote: WeeklyNote | null
  weekNumberLabel?: string
  darkMode: boolean
  tradesSectionTitle?: string
  emptyIcon?: React.ReactNode
  emptyMessage?: string
}

export default function DailyRecapDay({
  dateKey,
  dateLabel,
  trades,
  weekNote,
  weekNumberLabel,
  darkMode,
  tradesSectionTitle = "Day's trades",
  emptyIcon,
  emptyMessage,
}: DailyRecapDayProps) {
  const cardClass = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const [highlightedTradeId, setHighlightedTradeId] = useState<string | null>(null)

  const equityCurveData = useMemo(() => buildDailyEquityCurve(trades), [trades])
  const dayTotalPnL = useMemo(
    () => trades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0),
    [trades]
  )
  const highlightedCurvePoint = useMemo(() => {
    if (!highlightedTradeId) return null
    return equityCurveData.find(p => p.tradeId === highlightedTradeId) ?? null
  }, [highlightedTradeId, equityCurveData])

  useEffect(() => {
    setHighlightedTradeId(null)
  }, [dateKey])

  return (
    <div className="space-y-6">
      {weekNote?.content?.trim() && (
        <Card className={cardClass}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">This week&apos;s recap</CardTitle>
            {weekNumberLabel && <CardDescription>Week {weekNumberLabel}</CardDescription>}
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{weekNote.content}</p>
          </CardContent>
        </Card>
      )}

      {trades.length === 0 && (
        <Card className={cardClass}>
          <CardContent className="py-6 text-center text-muted-foreground">
            {emptyIcon ?? (
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-50 text-indigo-400" />
            )}
            <p className="text-sm">
              {emptyMessage ?? `No closed trades for ${dateLabel}.`}
            </p>
          </CardContent>
        </Card>
      )}

      <DailySummaryPanel dateKey={dateKey} dateLabel={dateLabel} darkMode={darkMode} />

      {trades.length > 0 && (
        <DailyEquityCurveChart
          dayLabel={dateLabel}
          totalPnL={dayTotalPnL}
          tradeCount={trades.length}
          data={equityCurveData}
          darkMode={darkMode}
          showCloseButton={false}
          highlightedPoint={highlightedCurvePoint}
        />
      )}

      {trades.length > 0 && (
        <TimelineTradesTable
          trades={trades}
          darkMode={darkMode}
          title={tradesSectionTitle}
          onHighlightedTradeChange={setHighlightedTradeId}
        />
      )}
    </div>
  )
}
