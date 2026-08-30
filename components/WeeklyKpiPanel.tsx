'use client'

import { useMemo } from 'react'
import { Check, X } from 'lucide-react'
import {
  Trade,
  TradeStats,
  calculateStats,
  calculateARate,
  getTradeCloseAt,
  getCloseDatePeriodKey,
  formatOverviewAvgRR,
  getOverviewAvgRRRatio,
} from '@/utils/logParser'

interface WeeklyKpiPanelProps {
  trades: Trade[]
  tradeTags?: Record<string, string[]>
  darkMode: boolean
}

interface KpiItem {
  id: string
  label: string
  target: string
  value: string
  pass: boolean
}

function formatRatio(value: number, decimals = 2): string {
  if (value === Infinity) return '∞'
  return value.toFixed(decimals)
}

function buildKpis(stats: TradeStats, aRate: number): KpiItem[] {
  const overviewAvgRR = getOverviewAvgRRRatio(stats)
  const avgRRDisplay = formatOverviewAvgRR(stats)

  return [
    {
      id: 'trades',
      label: 'Total Trades',
      target: '≤ 20',
      value: String(stats.totalTrades),
      pass: stats.totalTrades <= 20,
    },
    {
      id: 'aRate',
      label: 'A Rate',
      target: '≥ 66.7%',
      value: `${aRate.toFixed(1)}%`,
      pass: aRate >= 66.7,
    },
    {
      id: 'avgRR',
      label: 'Avg R:R',
      target: '≥ 4.0',
      value: avgRRDisplay,
      pass: overviewAvgRR !== null && overviewAvgRR >= 4.0,
    },
    {
      id: 'winDayRR',
      label: 'Win Day R:R',
      target: '≥ 1.5',
      value: formatRatio(stats.winDayRR),
      pass: stats.winningDays + stats.losingDays > 0 && stats.winDayRR >= 1.5,
    },
    {
      id: 'profitFactor',
      label: 'Profit Factor',
      target: '≥ 1.5',
      value: formatRatio(stats.profitFactor),
      pass: stats.profitFactor >= 1.5,
    },
  ]
}

function formatWeekLabel(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/)
  if (!match) return weekKey
  return `Week ${parseInt(match[2], 10)}, ${match[1]}`
}

export default function WeeklyKpiPanel({ trades, tradeTags, darkMode }: WeeklyKpiPanelProps) {
  const { weekKey, kpis } = useMemo(() => {
    const currentWeekKey = getCloseDatePeriodKey(new Date(), 'weekly')
    const weekTrades = trades.filter(trade => {
      if (!trade.isClosed) return false
      const closeAt = getTradeCloseAt(trade)
      if (!closeAt) return false
      return getCloseDatePeriodKey(closeAt, 'weekly') === currentWeekKey
    })
    const stats = calculateStats(weekTrades, tradeTags)
    const aRate = calculateARate(weekTrades, tradeTags)
    return {
      weekKey: currentWeekKey,
      kpis: buildKpis(stats, aRate),
    }
  }, [trades, tradeTags])

  const passCount = kpis.filter(k => k.pass).length

  return (
    <div
      className={`mb-6 rounded-xl border p-4 ${
        darkMode ? 'bg-gray-800/60 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Weekly KPIs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatWeekLabel(weekKey)} · closed trades (ET)
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {passCount} / {kpis.length} on target
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(kpi => (
          <div
            key={kpi.id}
            className={`rounded-lg border-2 p-3 transition-colors ${
              kpi.pass
                ? 'border-[#21C55E]/40 bg-[#21C55E]/10'
                : 'border-[#EF4444]/40 bg-[#EF4444]/10'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {kpi.label}
              </span>
              {kpi.pass ? (
                <Check className="h-4 w-4 shrink-0 text-[#21C55E]" aria-label="On target" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-[#EF4444]" aria-label="Off target" />
              )}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
            <div className="text-xs text-muted-foreground mt-1">Target: {kpi.target}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
