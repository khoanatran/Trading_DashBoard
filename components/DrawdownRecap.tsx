'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Trade,
  calculateStats,
  getTradeRMultiple,
  getTradesInDrawdownEpisode,
  formatDrawdownEpisodePeriod,
  drawdownEpisodeIndexRange,
  getDrawdownEpisodeKey,
  drawdownRecapSectionId,
  type DrawdownEpisode,
  type MaxDrawdownSeriesResult,
} from '@/utils/logParser'
import { formatUsdPnl, formatUsdPnlSigned } from '@/lib/format'
import { requestNavigateToEquityDrawdown } from '@/lib/drawdown-nav'
import TimelineTradesTable from '@/components/TimelineTradesTable'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface DrawdownRecapProps {
  trades: Trade[]
  episodes: DrawdownEpisode[]
  drawdownSeries: MaxDrawdownSeriesResult
  darkMode: boolean
  activeEpisodeKey: string | null
  onActiveEpisodeKeyChange: (key: string | null) => void
  /** When false, hides link back to Overview equity curve (e.g. already on Timeline). */
  showOverviewChartLink?: boolean
}

function isMaxDrawdownEpisode(
  ep: DrawdownEpisode,
  series: MaxDrawdownSeriesResult
): boolean {
  return (
    series.maxDrawdown > 0 &&
    ep.amount === series.maxDrawdown &&
    ep.peakIndex === series.peakIndex &&
    ep.troughIndex === series.troughIndex
  )
}

export default function DrawdownRecap({
  trades,
  episodes,
  drawdownSeries,
  darkMode,
  activeEpisodeKey,
  onActiveEpisodeKeyChange,
  showOverviewChartLink = true,
}: DrawdownRecapProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!activeEpisodeKey) return
    setExpanded(prev => {
      if (prev.has(activeEpisodeKey)) return prev
      const next = new Set(prev)
      next.add(activeEpisodeKey)
      return next
    })
    requestAnimationFrame(() => {
      document
        .getElementById(drawdownRecapSectionId(activeEpisodeKey))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [activeEpisodeKey])

  const recapItems = useMemo(() => {
    return episodes.map(ep => {
      const episodeTrades = getTradesInDrawdownEpisode(trades, ep)
      const stats = calculateStats(episodeTrades)
      return { ep, episodeTrades, stats }
    })
  }, [trades, episodes])

  if (episodes.length === 0) return null

  const border = darkMode ? 'border-gray-700' : 'border-gray-200'
  const cardBg = darkMode ? 'bg-gray-800/80' : 'bg-gray-50'
  const rowHover = darkMode ? 'hover:bg-gray-700/40' : 'hover:bg-gray-100'

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each period matches a drawdown zone on the equity curve (Overview). Click a period
        for a summary and trade notes/images for every closed trade in that slump (peak through
        trough, ET).
        {showOverviewChartLink && (
          <>
            {' '}
            Use &quot;View on chart&quot; to jump to Overview.
          </>
        )}
      </p>

      {recapItems.map(({ ep, episodeTrades, stats }, idx) => {
        const key = getDrawdownEpisodeKey(ep)
        const isOpen = expanded.has(key)
        const isLinked = activeEpisodeKey === key
        const dateRange = formatDrawdownEpisodePeriod(ep.peakAt, ep.troughAt)
        const isMax = isMaxDrawdownEpisode(ep, drawdownSeries)
        const { start, end } = drawdownEpisodeIndexRange(ep)

        return (
          <div
            key={key}
            id={drawdownRecapSectionId(key)}
            className={`rounded-lg border overflow-hidden scroll-mt-24 transition-shadow ${border} ${cardBg} ${
              isLinked ? 'ring-2 ring-blue-500/70 shadow-md' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onActiveEpisodeKeyChange(key)
                toggle(key)
              }}
              className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left ${rowHover}`}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold text-muted-foreground">#{idx + 1}</span>
              <span className="text-[#EF4444] font-semibold">{formatUsdPnl(ep.amount)}</span>
              {dateRange && (
                <span className="text-sm text-muted-foreground">{dateRange} (ET)</span>
              )}
              <span className="text-xs text-muted-foreground">
                Trades {start}–{end} · {episodeTrades.length} closed
              </span>
              {isMax && (
                <span className="text-xs font-medium text-[#EF4444]">Max drawdown</span>
              )}
              {showOverviewChartLink && (
                <span
                  role="link"
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation()
                    onActiveEpisodeKeyChange(key)
                    requestNavigateToEquityDrawdown(ep)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onActiveEpisodeKeyChange(key)
                      requestNavigateToEquityDrawdown(ep)
                    }
                  }}
                  className="ml-auto text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer shrink-0"
                >
                  View on chart (Overview) ↑
                </span>
              )}
            </button>

            {isOpen && (
              <div className="px-4 pb-4 border-t border-inherit">
                <div className="pt-4 mb-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                    Summary
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
                    <SummaryCell
                      label="Equity drawdown"
                      value={
                        <span className="text-[#EF4444]">{formatUsdPnl(ep.amount)}</span>
                      }
                    />
                    <SummaryCell
                      label="Peak → trough equity"
                      value={
                        <span>
                          {formatUsdPnlSigned(ep.peakPnl)} →{' '}
                          <span className="text-[#EF4444]">
                            {formatUsdPnlSigned(ep.troughPnl)}
                          </span>
                        </span>
                      }
                    />
                    <SummaryCell
                      label="Net P&L (trades in period)"
                      value={
                        <span
                          className={
                            stats.totalPnL >= 0 ? 'text-[#21C55E]' : 'text-[#EF4444]'
                          }
                        >
                          {formatUsdPnlSigned(stats.totalPnL)}
                        </span>
                      }
                    />
                    <SummaryCell
                      label="Win rate"
                      value={`${stats.winRate.toFixed(1)}%`}
                    />
                    <SummaryCell
                      label="W / L / BE"
                      value={`${stats.wins} / ${stats.losses} / ${stats.breakevens}`}
                    />
                    <SummaryCell
                      label="Gross gains"
                      value={
                        <span className="text-[#21C55E]">
                          {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '—'}
                        </span>
                      }
                    />
                    <SummaryCell
                      label="Gross losses"
                      value={
                        <span className="text-[#EF4444]">
                          {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '—'}
                        </span>
                      }
                    />
                    <SummaryCell
                      label="Profit factor"
                      value={
                        stats.profitFactor === Infinity
                          ? '∞'
                          : stats.profitFactor > 0
                            ? stats.profitFactor.toFixed(2)
                            : '—'
                      }
                    />
                    <SummaryCell
                      label="Avg R"
                      value={`${stats.avgRR.toFixed(1)}R`}
                    />
                    <SummaryCell
                      label="Best / worst trade"
                      value={
                        <>
                          {stats.bestTrade && getTradeRMultiple(stats.bestTrade) != null
                            ? `${getTradeRMultiple(stats.bestTrade)!.toFixed(1)}R`
                            : '—'}{' '}
                          /{' '}
                          {stats.worstTrade && getTradeRMultiple(stats.worstTrade) != null
                            ? `${getTradeRMultiple(stats.worstTrade)!.toFixed(1)}R`
                            : '—'}
                        </>
                      }
                    />
                  </div>
                </div>

                <TimelineTradesTable
                  trades={episodeTrades}
                  darkMode={darkMode}
                  title={`Trades (${episodeTrades.length})`}
                  equityIndexStart={start}
                  emptyMessage="No closed trades in this range."
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SummaryCell({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}
