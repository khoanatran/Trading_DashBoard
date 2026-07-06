'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'
import { formatUsdPnlSigned } from '@/lib/format'
import { formatWallClockTimeOnly } from '@/lib/timezone'
import type { DailyEquityCurvePoint } from '@/utils/logParser'

interface DailyEquityCurveChartProps {
  title?: string
  dayLabel: string
  totalPnL: number
  tradeCount: number
  data: DailyEquityCurvePoint[]
  darkMode: boolean
  onClose?: () => void
  showCloseButton?: boolean
  /** Point on the curve for the trade selected in the journal table. */
  highlightedPoint?: DailyEquityCurvePoint | null
}

export default function DailyEquityCurveChart({
  title = 'Daily P&L equity curve',
  dayLabel,
  totalPnL,
  tradeCount,
  data,
  darkMode,
  onClose,
  showCloseButton,
  highlightedPoint = null,
}: DailyEquityCurveChartProps) {
  const gridColor = darkMode ? '#374151' : '#e5e7eb'
  const textColor = darkMode ? '#9ca3af' : '#6b7280'
  const strokeColor = totalPnL >= 0 ? '#21C55E' : '#EF4444'
  const highlightColor = '#FBBF24'
  const closeVisible = showCloseButton ?? Boolean(onClose)
  const highlightedTime =
    highlightedPoint && highlightedPoint.index > 0
      ? formatWallClockTimeOnly(highlightedPoint.label)
      : null

  return (
    <div
      className={`rounded-lg border p-4 ${
        darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dayLabel} · {tradeCount} trade{tradeCount === 1 ? '' : 's'} · close order
            {highlightedPoint && highlightedPoint.index > 0 && (
              <>
                {' '}
                ·{' '}
                <span className="text-amber-400 font-medium">
                  #{highlightedPoint.index} selected
                  {highlightedTime && highlightedTime !== 'N/A' ? ` (${highlightedTime})` : ''}
                  {' · '}
                  {formatUsdPnlSigned(highlightedPoint.cumulative)} after close
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-lg font-bold tabular-nums ${
              totalPnL > 0 ? 'text-[#21C55E]' : totalPnL < 0 ? 'text-[#EF4444]' : 'text-muted-foreground'
            }`}
          >
            {formatUsdPnlSigned(totalPnL)}
          </span>
          {closeVisible && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-md transition-colors ${
                darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
              }`}
              aria-label="Close daily equity curve"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="w-full" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="dailyEquityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="index"
            stroke={textColor}
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            label={{ value: 'Trade #', position: 'insideBottom', offset: -2, fill: textColor, fontSize: 11 }}
          />
          <YAxis
            stroke={textColor}
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => {
              const n = Number(v)
              if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
              return `$${Math.round(n)}`
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: darkMode ? '#1f2937' : '#fff',
              border: `1px solid ${gridColor}`,
              borderRadius: 8,
            }}
            formatter={(value: number, _name, item) => {
              const payload = item.payload as DailyEquityCurvePoint
              if (payload.index === 0) {
                return [formatUsdPnlSigned(0), 'Cumulative P&L']
              }
              const timeLabel = formatWallClockTimeOnly(payload.label)
              return [
                `${formatUsdPnlSigned(value)} (${formatUsdPnlSigned(payload.tradePnl)} this trade)`,
                timeLabel !== 'N/A' ? timeLabel : `Trade ${payload.index}`,
              ]
            }}
            labelFormatter={(index) => (Number(index) === 0 ? 'Session start' : `After trade ${index}`)}
          />
          <ReferenceLine y={0} stroke={textColor} strokeDasharray="4 4" strokeOpacity={0.6} />
          {highlightedPoint && highlightedPoint.index > 0 && (
            <>
              <ReferenceLine
                x={highlightedPoint.index}
                stroke={highlightColor}
                strokeDasharray="4 4"
                strokeOpacity={0.85}
              />
              <ReferenceDot
                x={highlightedPoint.index}
                y={highlightedPoint.cumulative}
                r={8}
                fill={highlightColor}
                stroke={darkMode ? '#1f2937' : '#fff'}
                strokeWidth={2}
              />
            </>
          )}
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={strokeColor}
            strokeWidth={2}
            fill="url(#dailyEquityGradient)"
            dot={(props) => {
              const { cx, cy, payload } = props
              if (payload.index === 0 || cx == null || cy == null) {
                return <circle cx={0} cy={0} r={0} fill="none" />
              }
              const isHighlight =
                highlightedPoint != null && payload.index === highlightedPoint.index
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHighlight ? 7 : 3}
                  fill={isHighlight ? highlightColor : strokeColor}
                  stroke={isHighlight ? (darkMode ? '#1f2937' : '#fff') : undefined}
                  strokeWidth={isHighlight ? 2 : 0}
                />
              )
            }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
