'use client'

import React, { useState, useMemo } from 'react'
import { TradeStats, Streaks, Trade, BE_THRESHOLD, DOLLARS_PER_R, getPositionAdjustedRMultiple, getTradeResult, pnlToRMultiple, roundRMultiple, formatOverviewAvgRR, isOverviewAvgRRFavorable } from '@/utils/logParser'
import { formatUsd, formatUsdPnl, formatUsdPnlSigned } from '@/lib/format'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { Card, CardContent } from '@/components/ui/card'
import { HelpCircle } from 'lucide-react'

interface OverviewCardsProps {
  stats: TradeStats
  streaks: Streaks
  darkMode: boolean
  trades?: Trade[] // Optional trades array for additional calculations
  tradeTags?: Record<string, string[]>
}

// Stat Card with help tooltip
interface StatCardProps {
  title: string
  value: React.ReactNode
  subtitle?: React.ReactNode
  help: string
  darkMode: boolean
}

function StatCard({ title, value, subtitle, help, darkMode }: StatCardProps) {
  const [showHelp, setShowHelp] = useState(false)
  
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-2">
          <div className="text-sm text-muted-foreground uppercase tracking-wide">{title}</div>
          <div className="relative">
            <button
              onMouseEnter={() => setShowHelp(true)}
              onMouseLeave={() => setShowHelp(false)}
              onClick={() => setShowHelp(!showHelp)}
              className="p-0.5 hover:bg-accent rounded-full transition-colors"
            >
              <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
            {showHelp && (
              <div className={`absolute right-0 top-full mt-2 w-64 p-3 rounded-lg shadow-lg z-50 text-sm ${
                darkMode ? 'bg-gray-700 border border-gray-600' : 'bg-white border border-gray-200'
              }`}>
                {help}
              </div>
            )}
          </div>
        </div>
        <div className="text-3xl font-bold">{value}</div>
        {subtitle && <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>}
      </CardContent>
    </Card>
  )
}

/** R-multiple from dollars using fixed $500 per 1R. */
function formatDollarsAsR(amount: number, mode: 'signed' | 'magnitude' = 'signed'): string {
  const r =
    mode === 'signed'
      ? pnlToRMultiple(amount)
      : roundRMultiple(Math.abs(amount) / DOLLARS_PER_R)
  if (r === null) return '0R'
  return `${r.toFixed(1)}R`
}

function formatDrawdownPeriod(peakAt: Date | null, troughAt: Date | null): string | null {
  if (!peakAt || !troughAt) return null
  const peakKey = formatInTimeZone(peakAt, DISPLAY_TIMEZONE, 'yyyy-MM-dd')
  const troughKey = formatInTimeZone(troughAt, DISPLAY_TIMEZONE, 'yyyy-MM-dd')
  if (peakKey === troughKey) {
    return formatInTimeZone(peakAt, DISPLAY_TIMEZONE, 'MMM d, yyyy')
  }
  const sameYear =
    formatInTimeZone(peakAt, DISPLAY_TIMEZONE, 'yyyy') ===
    formatInTimeZone(troughAt, DISPLAY_TIMEZONE, 'yyyy')
  if (sameYear) {
    return `${formatInTimeZone(peakAt, DISPLAY_TIMEZONE, 'MMM d')} – ${formatInTimeZone(troughAt, DISPLAY_TIMEZONE, 'MMM d, yyyy')}`
  }
  return `${formatInTimeZone(peakAt, DISPLAY_TIMEZONE, 'MMM d, yyyy')} – ${formatInTimeZone(troughAt, DISPLAY_TIMEZONE, 'MMM d, yyyy')}`
}

export default function OverviewCards({ stats, streaks, darkMode, trades = [], tradeTags }: OverviewCardsProps) {
  // Best/worst trade R multiples (position-adjusted for contract size)
  const bestTradeR = useMemo(() => 
    stats.bestTrade ? getPositionAdjustedRMultiple(stats.bestTrade) : null
  , [stats.bestTrade])
  const worstTradeR = useMemo(() => 
    stats.worstTrade ? getPositionAdjustedRMultiple(stats.worstTrade) : null
  , [stats.worstTrade])

  // Calculate gross profits, gross losses, and BE trade dollars (R-based BE classification)
  const drawdownPeriodLabel = useMemo(
    () => formatDrawdownPeriod(stats.maxDrawdownPeakAt, stats.maxDrawdownTroughAt),
    [stats.maxDrawdownPeakAt, stats.maxDrawdownTroughAt]
  )

  const { grossProfits, grossLosses, grossBePnL } = useMemo(() => {
    const profits = trades.filter(t => (t.pnl ?? 0) > 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0)
    const losses = Math.abs(trades.filter(t => (t.pnl ?? 0) < 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0))
    const bePnL = trades.reduce((sum, t) => {
      if (getTradeResult(t, tradeTags) === 'BE') {
        return sum + (t.pnl ?? 0)
      }
      return sum
    }, 0)
    return { grossProfits: profits, grossLosses: losses, grossBePnL: bePnL }
  }, [trades, tradeTags])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8">
      <StatCard
        title="Total P&L"
        value={<span className={stats.totalPnL > 0 ? 'text-[#21C55E]' : 'text-[#EF4444]'}>{formatUsdPnlSigned(stats.totalPnL)}</span>}
        subtitle={
          <span className={stats.totalPnL > 0 ? 'text-[#21C55E]' : stats.totalPnL < 0 ? 'text-[#EF4444]' : ''}>
            {formatDollarsAsR(stats.totalPnL)} at ${DOLLARS_PER_R}/R
          </span>
        }
        help="Total profit and loss for the selected period. R-multiple uses $500 risk per 1R (P&L ÷ $500). Positive values indicate net profit, negative values indicate net loss."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Win Rate"
        value={<span className={stats.winRate >= 50 ? 'text-[#21C55E]' : 'text-[#EF4444]'}>{stats.winRate.toFixed(1)}%</span>}
        subtitle={`${stats.wins}W / ${stats.losses}L`}
        help={`Percentage of winning trades, excluding break-even trades (±${BE_THRESHOLD}R). Calculated as Wins / (Wins + Losses) × 100.`}
        darkMode={darkMode}
      />

      <StatCard
        title="Avg R:R"
        value={
          stats.wins + stats.losses > 0 ? (
            <span
              className={
                isOverviewAvgRRFavorable(stats) ? 'text-[#21C55E]' : 'text-[#EF4444]'
              }
            >
              {formatOverviewAvgRR(stats)}
            </span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        }
        subtitle={
          stats.wins + stats.losses > 0 ? (
            <span className="text-sm">
              <span className="text-[#21C55E]">{stats.avgWinRR.toFixed(1)}R</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-[#EF4444]">{stats.avgLossRR.toFixed(1)}R</span>
            </span>
          ) : undefined
        }
        help="Ratio of average winning-trade R to average losing-trade R (|avg loss R|). Subtitle shows the underlying averages. Excludes BE trades (±0.25R)."
        darkMode={darkMode}
      />

      <StatCard
        title="Win Day %"
        value={
          <span className={stats.winDayPercent >= 50 ? 'text-[#21C55E]' : 'text-[#EF4444]'}>
            {stats.winDayPercent.toFixed(1)}%
          </span>
        }
        subtitle={
          stats.winningDays + stats.losingDays > 0
            ? `${stats.winningDays} / ${stats.winningDays + stats.losingDays} winning days`
            : 'No decisive trading days'
        }
        help="Percentage of trading days with net positive P&L vs net negative P&L (ET close date). Break-even days (exactly $0 net) are excluded from the rate, same as trade win rate excludes BE trades."
        darkMode={darkMode}
      />

      <StatCard
        title="Win Day R:R"
        value={
          stats.winningDays + stats.losingDays > 0 ? (
            <span
              className={
                stats.losingDays === 0 || stats.winDayRR >= 1
                  ? 'text-[#21C55E]'
                  : 'text-[#EF4444]'
              }
            >
              {stats.losingDays === 0 && stats.winningDays > 0
                ? '∞'
                : stats.winDayRR === Infinity
                  ? '∞'
                  : stats.winDayRR.toFixed(2)}
            </span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        }
        subtitle={
          stats.winningDays + stats.losingDays > 0 ? (
            <span className="text-sm">
              <span className="text-[#21C55E]">
                {stats.avgWinDayPnL > 0 ? formatUsdPnl(stats.avgWinDayPnL) : formatUsd(0)}
              </span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-[#EF4444]">
                {stats.avgLossDayPnL > 0 ? formatUsdPnl(stats.avgLossDayPnL) : formatUsd(0)}
              </span>
            </span>
          ) : (
            'No decisive trading days'
          )
        }
        help="Ratio of average net P&L on winning days to average net loss on losing days (by ET session day). Subtitle shows the underlying dollar averages."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Gross Profits"
        value={<span className="text-[#21C55E]">{formatUsdPnl(grossProfits)}</span>}
        subtitle={<span className="text-[#21C55E]">{formatDollarsAsR(grossProfits, 'magnitude')} at ${DOLLARS_PER_R}/R</span>}
        help="Total dollar amount from all winning trades before accounting for losses. R-multiple uses $500 risk per 1R."
        darkMode={darkMode}
      />

      <StatCard
        title="Gross Losses"
        value={<span className="text-[#EF4444]">{formatUsdPnl(grossLosses)}</span>}
        subtitle={<span className="text-[#EF4444]">{formatDollarsAsR(grossLosses, 'magnitude')} at ${DOLLARS_PER_R}/R</span>}
        help="Total dollar amount from all losing trades (shown as positive). R-multiple uses $500 risk per 1R."
        darkMode={darkMode}
      />

      <StatCard
        title="Profit Factor"
        value={<span className={stats.profitFactor >= 1 ? 'text-[#21C55E]' : 'text-[#EF4444]'}>
          {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
        </span>}
        help="Ratio of gross profit to gross loss. A value above 1.0 means you're profitable. Higher values are better. For example, 2.0 means you make $2 for every $1 you lose."
        darkMode={darkMode}
      />

      <StatCard
        title="BE Trades"
        value={<span className="text-amber-500">{stats.breakevens}</span>}
        subtitle={
          <span
            className={
              grossBePnL > 0
                ? 'text-[#21C55E]'
                : grossBePnL < 0
                  ? 'text-[#EF4444]'
                  : 'text-amber-500'
            }
          >
            Gross: {formatUsdPnlSigned(grossBePnL)} ({formatDollarsAsR(grossBePnL)})
          </span>
        }
        help={`Trades with R:R between -${BE_THRESHOLD}R and +${BE_THRESHOLD}R are considered break-even and excluded from win rate calculations. Subtitle shows combined gross P&L and R from those trades.`}
        darkMode={darkMode}
      />

      <StatCard
        title="Total Trades"
        value={stats.totalTrades}
        help="Total number of completed trades in the selected period."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Max Drawdown"
        value={<span className="text-red-500">{formatUsdPnl(stats.maxDrawdown)}</span>}
        subtitle={
          <>
            <span className="text-red-500">
              {formatDollarsAsR(stats.maxDrawdown, 'magnitude')} at ${DOLLARS_PER_R}/R
            </span>
            {stats.maxDrawdown > 0 && drawdownPeriodLabel && (
              <span className="block mt-0.5 text-muted-foreground">
                {drawdownPeriodLabel} (ET)
              </span>
            )}
          </>
        }
        help="Largest peak-to-trough decline in cumulative P&L across closed trades in exit-time order. The subtitle shows the drawdown window in Eastern Time (trade close); the equity curve highlights the same segment in red. R-multiple uses $500 risk per 1R."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Longest Win Streak"
        value={<span className="text-green-500">{streaks.longestWinStreak}</span>}
        help="Longest consecutive sequence of winning trades. Shows your best period of consistent performance."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Longest Loss Streak"
        value={<span className="text-[#EF4444]">{streaks.longestLossStreak}</span>}
        help="Longest consecutive sequence of losing trades. Important for understanding maximum consecutive losses you might face."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Best Trade"
        value={<span className={bestTradeR != null ? 'text-[#21C55E]' : 'text-muted-foreground'}>{bestTradeR != null ? `${bestTradeR.toFixed(1)}R` : 'N/A'}</span>}
        subtitle={stats.bestTrade ? `${formatUsdPnl(stats.bestTrade.pnl)} (${stats.bestTrade.orderQty || 1} MNQ)` : undefined}
        help="Your most profitable trade in R multiples ($500 risk per 1R). Shows your maximum profit potential."
        darkMode={darkMode}
      />
      
      <StatCard
        title="Worst Trade"
        value={<span className="text-[#EF4444]">{worstTradeR != null ? `${worstTradeR.toFixed(1)}R` : 'N/A'}</span>}
        subtitle={stats.worstTrade ? `${formatUsdPnlSigned(stats.worstTrade.pnl)} (${stats.worstTrade.orderQty || 1} MNQ)` : undefined}
        help="Your worst trade in R multiples ($500 risk per 1R). Shows your maximum loss exposure."
        darkMode={darkMode}
      />
    </div>
  )
}
