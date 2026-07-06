'use client'

import React, { useMemo } from 'react'
import { Trade, parseLocalTimestamp, getTradeRMultiple, getTradeResult } from '@/utils/logParser'
import { formatUsdPnl } from '@/lib/format'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
  ReferenceLine,
} from 'recharts'

interface DayOfWeekStatsProps {
  trades: Trade[]
  darkMode: boolean
  tradeTags?: Record<string, string[]>
  showTitle?: boolean
}

interface DayStats {
  day: string
  dayIndex: number
  trades: number
  wins: number
  losses: number
  breakevens: number
  winRate: number
  winRateLine: number | null
  totalPnL: number
  grossProfits: number
  grossLosses: number
  avgRR: number
}

const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PNL_GREEN = '#21C55E'
const PNL_RED = '#EF4444'
const WIN_RATE_COLOR = '#38bdf8'

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{ payload: DayStats; name: string; value: number; color?: string }>
  label?: string
  darkMode: boolean
}

function DayChartTooltip({ active, payload, label, darkMode }: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  const row = payload[0].payload
  const panelClass = darkMode
    ? 'rounded-lg border border-gray-600 bg-gray-900/95 px-3 py-2.5 shadow-xl backdrop-blur-sm'
    : 'rounded-lg border border-gray-200 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur-sm'

  return (
    <div className={panelClass}>
      <p className="text-sm font-semibold mb-2">{label}</p>
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Total P&L</span>
          <span className={row.totalPnL >= 0 ? 'text-[#21C55E] font-semibold' : 'text-[#EF4444] font-semibold'}>
            {formatUsdPnl(row.totalPnL)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Win Rate</span>
          <span className="font-semibold" style={{ color: WIN_RATE_COLOR }}>
            {row.wins + row.losses > 0 ? `${row.winRate.toFixed(1)}%` : 'N/A'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6 pt-1 border-t border-border/40">
          <span className="text-muted-foreground">Trades</span>
          <span>
            {row.trades} ·{' '}
            <span className="text-[#21C55E]">{row.wins}W</span>
            {' / '}
            <span className="text-[#EF4444]">{row.losses}L</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default function DayOfWeekStats({ trades, darkMode, tradeTags, showTitle = true }: DayOfWeekStatsProps) {
  const dayStats = useMemo(() => {
    const stats: Record<
      number,
      {
        trades: Trade[]
        wins: number
        losses: number
        breakevens: number
        totalPnL: number
        grossProfits: number
        grossLosses: number
        totalRR: number
      }
    > = {}

    for (let i = 0; i < 7; i++) {
      stats[i] = {
        trades: [],
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalPnL: 0,
        grossProfits: 0,
        grossLosses: 0,
        totalRR: 0,
      }
    }

    trades.forEach(trade => {
      if (!trade.timestamp || !trade.isClosed) return

      const date = parseLocalTimestamp(trade.timestamp)
      const dayOfWeek = date.getDay()

      stats[dayOfWeek].trades.push(trade)

      const result = getTradeResult(trade, tradeTags)
      if (result === 'WIN') {
        stats[dayOfWeek].wins++
      } else if (result === 'LOSS') {
        stats[dayOfWeek].losses++
      } else {
        stats[dayOfWeek].breakevens++
      }

      const pnl = trade.pnl ?? 0
      stats[dayOfWeek].totalPnL += pnl
      if (pnl > 0) {
        stats[dayOfWeek].grossProfits += pnl
      } else if (pnl < 0) {
        stats[dayOfWeek].grossLosses += Math.abs(pnl)
      }

      const tradeR = getTradeRMultiple(trade)
      if (tradeR !== null && (result === 'WIN' || result === 'LOSS')) {
        stats[dayOfWeek].totalRR += tradeR
      }
    })

    const result: DayStats[] = SHORT_DAY_NAMES.map((day, index) => {
      const dayData = stats[index]
      const decisiveTrades = dayData.wins + dayData.losses
      const winRate = decisiveTrades > 0 ? (dayData.wins / decisiveTrades) * 100 : 0
      const totalTrades = dayData.wins + dayData.losses + dayData.breakevens
      const avgRR = decisiveTrades > 0 ? dayData.totalRR / decisiveTrades : 0

      return {
        day,
        dayIndex: index,
        trades: totalTrades,
        wins: dayData.wins,
        losses: dayData.losses,
        breakevens: dayData.breakevens,
        winRate,
        winRateLine: decisiveTrades > 0 ? winRate : null,
        totalPnL: dayData.totalPnL,
        grossProfits: dayData.grossProfits,
        grossLosses: dayData.grossLosses,
        avgRR,
      }
    })

    return result.filter(d => d.trades > 0 || (d.dayIndex >= 1 && d.dayIndex <= 5))
  }, [trades, tradeTags])

  const tableClass = darkMode
    ? 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-gray-800 border border-gray-700'
    : 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-white border border-gray-200'

  const thClass = darkMode
    ? 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-700 text-gray-300'
    : 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-100 text-gray-700'

  const tdClass = darkMode
    ? 'px-4 py-3 border-t border-gray-700'
    : 'px-4 py-3 border-t border-gray-200'

  const chartText = darkMode ? '#9ca3af' : '#6b7280'
  const gridColor = darkMode ? '#374151' : '#e5e7eb'
  const axisLineColor = darkMode ? '#4b5563' : '#d1d5db'

  const pnlDomain = useMemo((): [number, number] => {
    if (dayStats.length === 0) return [-500, 500]
    const values = dayStats.map(d => d.totalPnL)
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    const span = Math.max(Math.abs(max), Math.abs(min), 1)
    const pad = span * 0.2
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [dayStats])

  const chartCardClass = darkMode
    ? 'rounded-xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg mb-6'
    : 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm mb-6'

  const tradingDays = dayStats.filter(d => d.trades > 0)
  const bestDay = tradingDays.length > 0 ? tradingDays.reduce((a, b) => a.winRate > b.winRate ? a : b) : null
  const worstDay = tradingDays.length > 0 ? tradingDays.reduce((a, b) => a.winRate < b.winRate ? a : b) : null

  return (
    <div className="mb-8">
      {showTitle && <h2 className="text-2xl font-bold mb-4">Performance by Day of Week</h2>}

      {tradingDays.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div className="text-sm text-muted-foreground">Best Day</div>
            <div className="text-xl font-bold text-green-500">{bestDay?.day}</div>
            <div className="text-sm text-green-400">{bestDay?.winRate.toFixed(1)}% win rate</div>
          </div>
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div className="text-sm text-muted-foreground">Worst Day</div>
            <div className="text-xl font-bold text-red-500">{worstDay?.day}</div>
            <div className="text-sm text-red-400">{worstDay?.winRate.toFixed(1)}% win rate</div>
          </div>
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div className="text-sm text-muted-foreground">Most Active</div>
            <div className="text-xl font-bold">
              {tradingDays.reduce((a, b) => a.trades > b.trades ? a : b).day}
            </div>
            <div className="text-sm text-muted-foreground">
              {tradingDays.reduce((a, b) => a.trades > b.trades ? a : b).trades} trades
            </div>
          </div>
          <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div className="text-sm text-muted-foreground">Total Trades</div>
            <div className="text-xl font-bold">{tradingDays.reduce((sum, d) => sum + d.trades, 0)}</div>
            <div className="text-sm text-muted-foreground">in period</div>
          </div>
        </div>
      )}

      <div className={chartCardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="text-lg font-semibold">P&L & Win Rate by Day</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bars = net P&L · Line = win rate (excludes BE)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="inline-flex gap-0.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PNL_GREEN }} />
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PNL_RED }} />
              </span>
              <span className="text-muted-foreground">Total P&L</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: WIN_RATE_COLOR }} />
              <span className="text-muted-foreground">Win Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-px w-5 border-t border-dashed border-muted-foreground/60" />
              <span className="text-muted-foreground">50% WR</span>
            </div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={dayStats}
            margin={{ top: 20, right: 8, left: 4, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <ReferenceLine yAxisId="pnl" y={0} stroke={axisLineColor} strokeWidth={1.5} />
            <ReferenceLine
              yAxisId="winRate"
              y={50}
              stroke={WIN_RATE_COLOR}
              strokeDasharray="4 4"
              strokeOpacity={0.45}
            />
            <XAxis
              dataKey="day"
              stroke={chartText}
              tick={{ fill: chartText, fontSize: 12, fontWeight: 500 }}
              axisLine={{ stroke: axisLineColor }}
              tickLine={false}
              dy={6}
            />
            <YAxis
              yAxisId="pnl"
              stroke={chartText}
              domain={pnlDomain}
              tick={{ fill: chartText, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={value => formatUsdPnl(value)}
              width={64}
            />
            <YAxis
              yAxisId="winRate"
              orientation="right"
              stroke={WIN_RATE_COLOR}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: WIN_RATE_COLOR, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={value => `${value}%`}
              width={44}
            />
            <Tooltip
              cursor={{ fill: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
              content={<DayChartTooltip darkMode={darkMode} />}
            />
            <Bar
              yAxisId="pnl"
              dataKey="totalPnL"
              name="Total P&L"
              radius={[6, 6, 0, 0]}
              maxBarSize={52}
            >
              {dayStats.map((entry, index) => (
                <Cell
                  key={`pnl-${index}`}
                  fill={entry.trades === 0 ? (darkMode ? '#374151' : '#e5e7eb') : entry.totalPnL >= 0 ? PNL_GREEN : PNL_RED}
                  fillOpacity={entry.trades === 0 ? 0.35 : 0.9}
                />
              ))}
            </Bar>
            <Line
              yAxisId="winRate"
              type="monotone"
              dataKey="winRateLine"
              name="Win Rate"
              stroke={WIN_RATE_COLOR}
              strokeWidth={2.5}
              connectNulls={false}
              dot={props => {
                const { cx, cy, payload } = props
                if (cx == null || cy == null || payload.winRateLine == null) return <g />
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={WIN_RATE_COLOR}
                    stroke={darkMode ? '#111827' : '#ffffff'}
                    strokeWidth={2}
                  />
                )
              }}
              activeDot={{ r: 7, fill: WIN_RATE_COLOR, stroke: darkMode ? '#111827' : '#ffffff', strokeWidth: 2 }}
            >
              <LabelList
                dataKey="winRateLine"
                position="top"
                offset={10}
                formatter={(value: number) => (value != null ? `${Number(value).toFixed(0)}%` : '')}
                fill={WIN_RATE_COLOR}
                fontSize={11}
                fontWeight={600}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Day</th>
              <th className={thClass}>Trades</th>
              <th className={thClass}>Wins</th>
              <th className={thClass}>Losses</th>
              <th className={thClass}>Win Rate</th>
              <th className={thClass}>Avg R:R</th>
              <th className={thClass}>Gross Profits</th>
              <th className={thClass}>Gross Losses</th>
              <th className={thClass}>Total P&L</th>
            </tr>
          </thead>
          <tbody>
            {dayStats.map(day => (
              <tr key={day.day} className={darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}>
                <td className={`${tdClass} font-medium`}>{day.day}</td>
                <td className={tdClass}>{day.trades}</td>
                <td className={`${tdClass} text-green-400`}>{day.wins}</td>
                <td className={`${tdClass} text-red-400`}>{day.losses}</td>
                <td className={`${tdClass} ${day.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                  {day.wins + day.losses > 0 ? `${day.winRate.toFixed(1)}%` : 'N/A'}
                </td>
                <td className={`${tdClass} ${day.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {day.wins + day.losses > 0 ? `${day.avgRR.toFixed(1)}R` : 'N/A'}
                </td>
                <td className={`${tdClass} text-green-400`}>
                  {day.grossProfits > 0 ? formatUsdPnl(day.grossProfits) : '-'}
                </td>
                <td className={`${tdClass} text-red-400`}>
                  {day.grossLosses > 0 ? formatUsdPnl(day.grossLosses) : '-'}
                </td>
                <td className={`${tdClass} ${day.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatUsdPnl(day.totalPnL)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
