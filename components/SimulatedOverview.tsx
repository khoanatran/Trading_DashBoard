'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  analyzeTradeSimulations,
  buildCumulativePnlByTradeId,
  combineSimulationScenarios,
  createCombinedScenario,
  formatSimulationTradeLabel,
  getScenarioById,
  type SimulationScenario,
  type SimulationScenarioId,
  type SimulationResult,
  type TradeSimulationDecision,
} from '@/utils/tradeSimulation'
import {
  buildDayGroupsByTradeId,
  DAY_GROUP_COLORS,
  formatTradeDayGroupLabel,
  type DayGroupInfo,
} from '@/utils/tradeDayGroups'
import type { TradeJournalEntry } from '@/lib/trade-journal'
import { Trade, getTradeId, getTradeRMultiple, getTradeResult } from '@/utils/logParser'
import { formatUsdPnl, formatUsdPnlSigned } from '@/lib/format'
import { cn } from '@/lib/utils'
import OverviewSection from '@/components/OverviewSection'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Lightbulb,
  TrendingUp,
  Shield,
  Target,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CheckCircle,
  X,
  FlaskConical,
  ChevronRight,
  RotateCcw,
  Plus,
  BarChart3,
  Activity,
  ListFilter,
  Filter,
  Zap,
} from 'lucide-react'

interface SimulatedOverviewProps {
  trades: Trade[]
  tradeTags: Record<string, string[]>
  darkMode: boolean
}

const CATEGORY_STYLES: Record<SimulationScenario['category'], string> = {
  baseline: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25',
  filter: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
  rule: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25',
}

function DeltaBadge({
  value,
  invert = false,
  size = 'sm',
}: {
  value: number
  invert?: boolean
  size?: 'sm' | 'md'
}) {
  const positive = invert ? value < 0 : value > 0
  const negative = invert ? value > 0 : value < 0
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold tabular-nums rounded-full px-2 py-0.5',
        size === 'md' ? 'text-sm' : 'text-xs',
        positive && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        negative && 'bg-red-500/15 text-red-600 dark:text-red-400',
        !positive && !negative && 'bg-muted text-muted-foreground'
      )}
    >
      {value > 0 ? '+' : ''}
      {formatUsdPnl(value)}
    </span>
  )
}

function ComparisonStatCard({
  label,
  actual,
  simulated,
  format = 'usd',
  betterWhenLower = false,
  icon: Icon,
}: {
  label: string
  actual: number
  simulated: number
  format?: 'usd' | 'percent' | 'ratio' | 'count'
  betterWhenLower?: boolean
  icon: React.ElementType
}) {
  const delta = simulated - actual
  const improved = betterWhenLower ? delta < 0 : delta > 0

  const fmt = (v: number) => {
    if (format === 'percent') return `${v.toFixed(1)}%`
    if (format === 'ratio') return v >= 999 ? '∞' : v.toFixed(2)
    if (format === 'count') return String(Math.round(v))
    return formatUsdPnlSigned(v)
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-colors',
        improved && delta !== 0
          ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
          : delta !== 0
            ? 'border-amber-500/25 bg-amber-500/[0.04]'
            : 'border-border bg-card'
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-tight">{fmt(simulated)}</div>
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">Was {fmt(actual)}</span>
        {delta !== 0 && (
          <span
            className={cn(
              'text-xs font-semibold tabular-nums rounded-full px-2 py-0.5',
              improved && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
              !improved && 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            )}
          >
            {format === 'percent'
              ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
              : format === 'count'
                ? `${delta > 0 ? '+' : ''}${delta}`
                : `${delta > 0 ? '+' : ''}${formatUsdPnl(delta)}`}
          </span>
        )}
      </div>
    </div>
  )
}

function MetricCell({
  label,
  actual,
  simulated,
  format = 'usd',
  betterWhenLower = false,
}: {
  label: string
  actual: number
  simulated: number
  format?: 'usd' | 'percent' | 'ratio' | 'count'
  betterWhenLower?: boolean
}) {
  const delta = simulated - actual
  const improved = betterWhenLower ? delta < 0 : delta > 0

  const fmt = (v: number) => {
    if (format === 'percent') return `${v.toFixed(1)}%`
    if (format === 'ratio') return v >= 999 ? '∞' : v.toFixed(2)
    if (format === 'count') return String(Math.round(v))
    return formatUsdPnl(v)
  }

  const deltaStr =
    format === 'percent'
      ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
      : format === 'ratio'
        ? `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`
        : format === 'count'
          ? `${delta > 0 ? '+' : ''}${delta}`
          : formatUsdPnlSigned(delta)

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
      <td className="py-3.5 pr-4 text-sm font-medium">{label}</td>
      <td className="py-3.5 px-4 text-sm tabular-nums text-right text-muted-foreground">{fmt(actual)}</td>
      <td className="py-3.5 px-4 text-sm font-semibold tabular-nums text-right">{fmt(simulated)}</td>
      <td className="py-3.5 pl-4 text-right">
        <span
          className={cn(
            'inline-flex text-xs font-semibold tabular-nums rounded-md px-2 py-1',
            improved && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
            !improved && delta !== 0 && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            delta === 0 && 'text-muted-foreground'
          )}
        >
          {deltaStr}
        </span>
      </td>
    </tr>
  )
}

type TradeBreakdownTab = 'included' | 'excluded' | 'all'

function DayGroupBracket({ groupInfo }: { groupInfo: DayGroupInfo | undefined }) {
  if (!groupInfo) return <td className="p-0 w-8 relative" />

  const groupColor = DAY_GROUP_COLORS[groupInfo.colorIndex]

  return (
    <td className="p-0 w-8 relative" style={{ minHeight: 40 }}>
      <>
        {groupInfo.isOnly ? (
          <div
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
          />
        ) : (
          <>
            <div
              className={`absolute right-2 w-1 ${groupColor.bar}`}
              style={{
                top: groupInfo.isFirst ? '50%' : 0,
                bottom: groupInfo.isLast ? '50%' : 0,
              }}
            />
            {groupInfo.isFirst && (
              <div
                className={`absolute right-2 top-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
              />
            )}
            {groupInfo.isLast && (
              <div
                className={`absolute right-2 bottom-1/2 w-3 h-1 ${groupColor.bar} rounded-l`}
              />
            )}
          </>
        )}
        {groupInfo.isFirst && (
          <div
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full ${groupColor.bar} flex items-center justify-center text-[10px] font-bold text-white shadow-md z-[1]`}
            title={`${groupInfo.groupSize} trade${groupInfo.groupSize > 1 ? 's' : ''} on ${formatTradeDayGroupLabel(groupInfo.dateKey)}`}
          >
            {groupInfo.groupSize}
          </div>
        )}
      </>
    </td>
  )
}

function ScenarioTradeBreakdown({
  result,
  baselineTrades,
  tradeTags,
  isCombined,
}: {
  result: SimulationResult
  baselineTrades: Trade[]
  tradeTags: Record<string, string[]>
  isCombined?: boolean
}) {
  const [tab, setTab] = useState<TradeBreakdownTab>('excluded')

  const rows = useMemo(() => {
    const source =
      tab === 'included'
        ? result.includedDecisions
        : tab === 'excluded'
          ? result.excludedDecisions
          : result.decisions
    return [...source].sort((a, b) =>
      (a.trade.entryTime ?? a.trade.timestamp ?? '').localeCompare(
        b.trade.entryTime ?? b.trade.timestamp ?? ''
      )
    )
  }, [result, tab])

  const actualCumByTradeId = useMemo(
    () => buildCumulativePnlByTradeId(baselineTrades),
    [baselineTrades]
  )

  const simulatedCumByTradeId = useMemo(
    () => buildCumulativePnlByTradeId(result.trades),
    [result.trades]
  )

  const includedTradeIds = useMemo(
    () => new Set(result.includedDecisions.map((d) => getTradeId(d.trade))),
    [result.includedDecisions]
  )

  const dayGroupsByTradeId = useMemo(
    () => buildDayGroupsByTradeId(rows.map((r) => r.trade)),
    [rows]
  )

  const tabs: { id: TradeBreakdownTab; label: string; count: number; tone: string }[] = [
    {
      id: 'included',
      label: 'Included',
      count: result.includedDecisions.length,
      tone: 'data-[active=true]:bg-emerald-600 data-[active=true]:text-white',
    },
    {
      id: 'excluded',
      label: 'Excluded',
      count: result.excludedDecisions.length,
      tone: 'data-[active=true]:bg-red-600 data-[active=true]:text-white',
    },
    { id: 'all', label: 'All', count: result.decisions.length, tone: 'data-[active=true]:bg-primary' },
  ]

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              Trade breakdown
            </CardTitle>
            <CardDescription className="mt-1">
              Per-trade decisions grouped by day (journal-style brackets). Cumulative P&L uses close-time
              equity order — actual includes every trade; simulated only advances on included trades.
              {isCombined ? ' Combined rules show which rule failed.' : ''}
            </CardDescription>
          </div>
          <div className="inline-flex p-1 rounded-lg bg-muted/60 border">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-active={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  'text-muted-foreground hover:text-foreground',
                  t.tone,
                  tab === t.id && 'shadow-sm'
                )}
              >
                {t.label}
                <span className="ml-1 opacity-70">({t.count})</span>
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">No {tab} trades.</p>
        ) : (
          <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-1 font-semibold w-8" aria-label="Day group" />
                  <th className="py-3 px-4 font-semibold w-16">Status</th>
                  <th className="py-3 px-4 font-semibold">Trade</th>
                  <th className="py-3 px-4 font-semibold text-right">P&L</th>
                  <th className="py-3 px-4 font-semibold text-right">R</th>
                  <th className="py-3 px-4 font-semibold">Result</th>
                  <th className="py-3 px-4 font-semibold">Tags</th>
                  <th className="py-3 px-4 font-semibold text-right">Actual cum.</th>
                  <th className="py-3 px-4 font-semibold text-right">Sim cum.</th>
                  <th className="py-3 px-4 font-semibold min-w-[200px]">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((decision) => {
                  const tradeId = getTradeId(decision.trade)
                  const groupInfo = dayGroupsByTradeId[tradeId]
                  const groupColor = groupInfo
                    ? DAY_GROUP_COLORS[groupInfo.colorIndex]
                    : null
                  return (
                    <TradeBreakdownRow
                      key={tradeId}
                      decision={decision}
                      tradeTags={tradeTags}
                      groupInfo={groupInfo}
                      groupColor={groupColor}
                      actualCum={actualCumByTradeId[tradeId]}
                      simulatedCum={
                        includedTradeIds.has(tradeId)
                          ? simulatedCumByTradeId[tradeId]
                          : undefined
                      }
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CumPnlCell({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return <span className="text-muted-foreground/50">—</span>
  }
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        value > 0 && 'text-emerald-600 dark:text-emerald-400',
        value < 0 && 'text-red-600 dark:text-red-400'
      )}
    >
      {formatUsdPnlSigned(value)}
    </span>
  )
}

function TradeBreakdownRow({
  decision,
  tradeTags,
  groupInfo,
  groupColor,
  actualCum,
  simulatedCum,
}: {
  decision: TradeSimulationDecision
  tradeTags: Record<string, string[]>
  groupInfo?: DayGroupInfo
  groupColor?: (typeof DAY_GROUP_COLORS)[number] | null
  actualCum?: number
  simulatedCum?: number
}) {
  const { trade, included, reason, excludedBy } = decision
  const r = getTradeRMultiple(trade)
  const result = getTradeResult(trade, tradeTags)
  const tags = tradeTags[getTradeId(trade)] ?? []

  return (
    <tr
      className={cn(
        'border-b border-border/40 last:border-0 transition-colors',
        groupColor?.bg,
        included ? 'hover:bg-emerald-500/[0.06]' : 'hover:bg-red-500/[0.06]'
      )}
    >
      <DayGroupBracket groupInfo={groupInfo} />
      <td className="py-3 px-4">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-md',
            included
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/15 text-red-600 dark:text-red-400'
          )}
        >
          {included ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {included ? 'In' : 'Out'}
        </span>
      </td>
      <td className="py-3 px-4 whitespace-nowrap font-medium text-[13px]">
        {formatSimulationTradeLabel(trade)}
      </td>
      <td
        className={cn(
          'py-3 px-4 text-right tabular-nums font-semibold',
          (trade.pnl ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : (trade.pnl ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : ''
        )}
      >
        {formatUsdPnlSigned(trade.pnl)}
      </td>
      <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
        {r != null ? `${r.toFixed(1)}R` : '—'}
      </td>
      <td className="py-3 px-4">
        <span
          className={cn(
            'text-xs font-bold px-1.5 py-0.5 rounded',
            result === 'WIN' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
            result === 'LOSS' && 'bg-red-500/15 text-red-600 dark:text-red-400',
            result === 'BE' && 'bg-muted text-muted-foreground'
          )}
        >
          {result}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1 max-w-[160px]">
          {tags.length > 0 ? (
            tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted border truncate max-w-full"
                title={tags.join(', ')}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-right whitespace-nowrap">
        <CumPnlCell value={actualCum} />
      </td>
      <td className="py-3 px-4 text-right whitespace-nowrap">
        <CumPnlCell value={simulatedCum} />
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground leading-relaxed">
        <span title={reason}>{reason}</span>
        {excludedBy && excludedBy.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {excludedBy.map((f) => (
              <div
                key={f.scenarioId}
                className="flex gap-1.5 text-red-600/90 dark:text-red-400/90 bg-red-500/5 rounded px-2 py-1"
              >
                <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold">{f.scenarioName}</span> — {f.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}

function ScenarioCard({
  result,
  selected,
  onSelect,
  isBaseline,
  stackIndex,
}: {
  result: SimulationResult
  selected: boolean
  onSelect: () => void
  isBaseline?: boolean
  stackIndex?: number
}) {
  const { scenario, stats, pnlDelta, skippedTrades } = result

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative w-full text-left rounded-xl border p-4 transition-all duration-200',
        'hover:shadow-md hover:-translate-y-0.5',
        selected
          ? 'border-primary shadow-md shadow-primary/10 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent ring-1 ring-primary/30'
          : 'border-border bg-card hover:border-primary/40'
      )}
    >
      {!selected && !isBaseline && (
        <span className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
            <Plus className="h-3 w-3" /> Add
          </span>
        </span>
      )}

      <div className="flex items-start gap-2 mb-2.5">
        {stackIndex != null && (
          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 shadow-sm">
            {stackIndex}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
                CATEGORY_STYLES[scenario.category]
              )}
            >
              {scenario.category}
            </span>
            {!isBaseline && pnlDelta > 0 && (
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                +{formatUsdPnl(pnlDelta)}
              </span>
            )}
          </div>
          <span className="font-semibold text-sm leading-snug block pr-8">{scenario.name}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">{scenario.action}</p>

      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/60">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">P&L</div>
          <div
            className={cn(
              'text-sm font-bold tabular-nums',
              stats.totalPnL > 0 ? 'text-emerald-600 dark:text-emerald-400' : stats.totalPnL < 0 ? 'text-red-600 dark:text-red-400' : ''
            )}
          >
            {formatUsdPnlSigned(stats.totalPnL)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Trades</div>
          <div className="text-sm font-bold tabular-nums">
            {stats.totalTrades}
            {!isBaseline && skippedTrades > 0 && (
              <span className="text-muted-foreground font-normal text-xs"> −{skippedTrades}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Max DD</div>
          <div className="text-sm font-bold tabular-nums">{formatUsdPnl(stats.maxDrawdown)}</div>
        </div>
      </div>
    </button>
  )
}

function ActiveRulesPipeline({
  activeRuleIds,
  selected,
  onRemove,
  onReset,
}: {
  activeRuleIds: SimulationScenarioId[]
  selected: SimulationResult
  onRemove: (id: SimulationScenarioId) => void
  onReset: () => void
}) {
  return (
    <div className="mb-5 rounded-xl border bg-gradient-to-r from-primary/5 via-transparent to-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Active simulation stack</span>
          <span className="text-xs text-muted-foreground">
            {activeRuleIds.length} rule{activeRuleIds.length !== 1 ? 's' : ''} · AND logic
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} className="h-8 text-xs gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to actual
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {activeRuleIds.map((id, index) => {
          const scenario = getScenarioById(id)
          return (
            <React.Fragment key={id}>
              {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
              <span className="inline-flex items-center gap-2 pl-3 pr-1.5 py-2 rounded-lg border border-primary/25 bg-card shadow-sm text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {index + 1}
                </span>
                <span className="font-medium">{scenario.name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${scenario.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </React.Fragment>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-4 text-sm tabular-nums">
        <span>
          <span className="text-muted-foreground">Simulated P&L </span>
          <span className="font-bold">{formatUsdPnlSigned(selected.stats.totalPnL)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Trades </span>
          <span className="font-bold">{selected.stats.totalTrades}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Included </span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">
            {selected.includedDecisions.length}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Excluded </span>
          <span className="font-bold text-red-600 dark:text-red-400">
            {selected.excludedDecisions.length}
          </span>
        </span>
        {selected.pnlDelta !== 0 && (
          <DeltaBadge value={selected.pnlDelta} size="md" />
        )}
      </div>
    </div>
  )
}

export default function SimulatedOverview({ trades, tradeTags, darkMode }: SimulatedOverviewProps) {
  const [journal, setJournal] = useState<Record<string, TradeJournalEntry>>({})
  const [activeRuleIds, setActiveRuleIds] = useState<SimulationScenarioId[]>(['stop-2-loss-day'])
  const isBaseline = activeRuleIds.length === 0
  const isCombinedActive = activeRuleIds.length >= 2

  useEffect(() => {
    const loadJournal = async () => {
      try {
        const res = await fetch('/api/trade-journal')
        if (!res.ok) return
        const data = await res.json()
        if (data.mapping && typeof data.mapping === 'object') {
          setJournal(data.mapping)
        }
      } catch {
        // Journal optional
      }
    }
    void loadJournal()
  }, [])

  const analysis = useMemo(
    () => analyzeTradeSimulations(trades, tradeTags, journal),
    [trades, tradeTags, journal]
  )

  const selectedResult = useMemo(() => {
    if (isBaseline) return analysis.baseline
    return combineSimulationScenarios(
      trades,
      activeRuleIds,
      tradeTags,
      journal,
      analysis.baseline.stats.totalPnL,
      analysis.baseline.stats.maxDrawdown
    )
  }, [trades, tradeTags, journal, activeRuleIds, isBaseline, analysis.baseline])

  const chartData = useMemo(() => {
    const actual = analysis.baseline.equityCurve
    const simulated = selectedResult.equityCurve
    const maxLen = Math.max(actual.length, simulated.length)
    const points: { trade: number; actual: number | null; simulated: number | null }[] = []
    for (let i = 0; i < maxLen; i++) {
      points.push({
        trade: i + 1,
        actual: actual[i]?.cumulative ?? null,
        simulated: simulated[i]?.cumulative ?? null,
      })
    }
    return points
  }, [analysis.baseline.equityCurve, selectedResult.equityCurve])

  const { baseline } = analysis
  const selected = selectedResult
  const selectedScenario = isBaseline
    ? getScenarioById('actual')
    : activeRuleIds.length === 1
      ? getScenarioById(activeRuleIds[0])
      : createCombinedScenario(activeRuleIds)

  const handleScenarioClick = (id: SimulationScenarioId) => {
    if (id === 'actual') {
      setActiveRuleIds([])
      return
    }
    setActiveRuleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const recommendations = useMemo(() => {
    const items = [
      {
        icon: Target,
        accent: 'from-amber-500/20 to-orange-500/5 border-amber-500/30',
        iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        title: 'Highest simulated P&L',
        scenario: getScenarioById(analysis.bestByPnL),
        result: analysis.scenarios.find((s) => s.scenario.id === analysis.bestByPnL),
      },
      {
        icon: Shield,
        accent: 'from-sky-500/20 to-blue-500/5 border-sky-500/30',
        iconBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
        title: 'Lowest max drawdown',
        scenario: getScenarioById(analysis.bestByDrawdown),
        result: analysis.scenarios.find((s) => s.scenario.id === analysis.bestByDrawdown),
      },
      {
        icon: TrendingUp,
        accent: 'from-violet-500/20 to-purple-500/5 border-violet-500/30',
        iconBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
        title: 'Best profit factor',
        scenario: getScenarioById(analysis.bestByProfitFactor),
        result: analysis.scenarios.find((s) => s.scenario.id === analysis.bestByProfitFactor),
      },
    ]
    return items.filter((i) => i.result)
  }, [analysis])

  if (trades.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-20 text-center">
          <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">Import trade history to run counterfactual simulations.</p>
        </CardContent>
      </Card>
    )
  }

  const gridColor = darkMode ? '#374151' : '#e5e7eb'
  const textColor = darkMode ? '#9ca3af' : '#6b7280'
  const avgRRActual = baseline.stats.avgWinRR / Math.abs(baseline.stats.avgLossRR || 1)
  const avgRRSim = selected.stats.avgWinRR / Math.abs(selected.stats.avgLossRR || 1)

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border p-6 md:p-8',
          darkMode
            ? 'bg-gradient-to-br from-primary/10 via-card to-card border-primary/20'
            : 'bg-gradient-to-br from-primary/5 via-card to-violet-500/5 border-primary/15'
        )}
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-primary text-sm font-medium mb-2">
              <FlaskConical className="h-4 w-4" />
              Counterfactual analysis
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Simulated Overview</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Replay your past trades with different rules. Click scenario cards to stack filters — each
              trade must pass every active rule.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <div className="rounded-xl border bg-card/80 backdrop-blur px-4 py-3 min-w-[130px]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Actual P&L</div>
              <div
                className={cn(
                  'text-xl font-bold tabular-nums',
                  baseline.stats.totalPnL > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}
              >
                {formatUsdPnlSigned(baseline.stats.totalPnL)}
              </div>
            </div>
            {!isBaseline && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 min-w-[130px]">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Simulated</div>
                <div
                  className={cn(
                    'text-xl font-bold tabular-nums',
                    selected.stats.totalPnL > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {formatUsdPnlSigned(selected.stats.totalPnL)}
                </div>
                {selected.pnlDelta !== 0 && (
                  <div className="mt-1">
                    <DeltaBadge value={selected.pnlDelta} size="sm" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scenario explorer — primary interactive section */}
      <OverviewSection
        title="Scenario explorer"
        description="Click cards to add or remove rules. Actual clears the stack."
      >
        {!isBaseline && (
          <ActiveRulesPipeline
            activeRuleIds={activeRuleIds}
            selected={selected}
            onRemove={(id) => setActiveRuleIds((prev) => prev.filter((x) => x !== id))}
            onReset={() => setActiveRuleIds([])}
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
          <ScenarioCard
            result={baseline}
            selected={isBaseline}
            onSelect={() => handleScenarioClick('actual')}
            isBaseline
          />
          {analysis.scenarios.map((result) => {
            const stackIndex = activeRuleIds.indexOf(result.scenario.id)
            return (
              <ScenarioCard
                key={result.scenario.id}
                result={result}
                selected={stackIndex >= 0}
                stackIndex={stackIndex >= 0 ? stackIndex + 1 : undefined}
                onSelect={() => handleScenarioClick(result.scenario.id)}
              />
            )
          })}
        </div>

        {!isBaseline && (
          <Card className="mb-6 overflow-hidden border-primary/20">
            <CardContent className="p-0">
              <div className="flex items-start gap-4 p-5 bg-gradient-to-r from-primary/8 to-transparent border-b">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base">{selectedScenario.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{selectedScenario.description}</p>
                  {isCombinedActive && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {activeRuleIds.map((id) => (
                        <span
                          key={id}
                          className="text-xs px-2 py-1 rounded-md bg-muted border font-medium"
                        >
                          {getScenarioById(id).name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!isBaseline && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <ComparisonStatCard
              label="Total P&L"
              actual={baseline.stats.totalPnL}
              simulated={selected.stats.totalPnL}
              icon={BarChart3}
            />
            <ComparisonStatCard
              label="Trades"
              actual={baseline.stats.totalTrades}
              simulated={selected.stats.totalTrades}
              format="count"
              betterWhenLower={false}
              icon={Activity}
            />
            <ComparisonStatCard
              label="Win rate"
              actual={baseline.stats.winRate}
              simulated={selected.stats.winRate}
              format="percent"
              icon={Target}
            />
            <ComparisonStatCard
              label="Max drawdown"
              actual={baseline.stats.maxDrawdown}
              simulated={selected.stats.maxDrawdown}
              betterWhenLower
              icon={Shield}
            />
          </div>
        )}

        <Card className="mb-6 overflow-hidden">
          <CardHeader className="pb-2 border-b bg-muted/15">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Equity curve comparison
            </CardTitle>
            <CardDescription>Cumulative P&L by trade close order</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={380}>
              <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
                <defs>
                  <linearGradient id="simGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={darkMode ? '#94a3b8' : '#64748b'} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={darkMode ? '#94a3b8' : '#64748b'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis
                  dataKey="trade"
                  stroke={textColor}
                  tick={{ fill: textColor, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  stroke={textColor}
                  tick={{ fill: textColor, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? '#1f2937' : '#fff',
                    border: `1px solid ${gridColor}`,
                    borderRadius: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  }}
                  formatter={(value: number, name: string) => [
                    formatUsdPnlSigned(value),
                    name === 'actual' ? 'Actual' : isBaseline ? 'Actual' : selectedScenario.name,
                  ]}
                />
                <Legend wrapperStyle={{ paddingTop: 12 }} />
                <ReferenceLine y={0} stroke={textColor} strokeDasharray="4 4" strokeOpacity={0.5} />
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke={darkMode ? '#94a3b8' : '#64748b'}
                  strokeWidth={2}
                  fill="url(#actualGradient)"
                  dot={false}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="simulated"
                  name={isBaseline ? 'Actual' : selectedScenario.name}
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#simGradient)"
                  dot={false}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2 border-b bg-muted/15">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              Full metrics comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-5 font-semibold">Metric</th>
                    <th className="py-3 px-4 font-semibold text-right">Actual</th>
                    <th className="py-3 px-4 font-semibold text-right">Simulated</th>
                    <th className="py-3 px-5 font-semibold text-right">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <MetricCell label="Total P&L" actual={baseline.stats.totalPnL} simulated={selected.stats.totalPnL} />
                  <MetricCell
                    label="Total trades"
                    actual={baseline.stats.totalTrades}
                    simulated={selected.stats.totalTrades}
                    format="count"
                  />
                  <MetricCell
                    label="Win rate"
                    actual={baseline.stats.winRate}
                    simulated={selected.stats.winRate}
                    format="percent"
                  />
                  <MetricCell
                    label="Profit factor"
                    actual={baseline.stats.profitFactor === Infinity ? 999 : baseline.stats.profitFactor}
                    simulated={selected.stats.profitFactor === Infinity ? 999 : selected.stats.profitFactor}
                    format="ratio"
                  />
                  <MetricCell
                    label="Gross profits"
                    actual={baseline.stats.totalGains}
                    simulated={selected.stats.totalGains}
                  />
                  <MetricCell
                    label="Gross losses"
                    actual={baseline.stats.totalLosses}
                    simulated={selected.stats.totalLosses}
                    betterWhenLower
                  />
                  <MetricCell
                    label="Max drawdown"
                    actual={baseline.stats.maxDrawdown}
                    simulated={selected.stats.maxDrawdown}
                    betterWhenLower
                  />
                  <MetricCell label="A Rate" actual={baseline.aRate} simulated={selected.aRate} format="percent" />
                  <MetricCell label="Avg R:R (overview)" actual={avgRRActual} simulated={avgRRSim} format="ratio" />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <ScenarioTradeBreakdown
          result={selected}
          baselineTrades={baseline.trades}
          tradeTags={tradeTags}
          isCombined={isCombinedActive}
        />
      </OverviewSection>

      {/* Key findings */}
      <OverviewSection
        title="Key findings"
        description="Patterns in your trade history that hurt equity the most."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {analysis.insights.map((insight) => (
            <Card
              key={insight.id}
              className={cn(
                'overflow-hidden transition-shadow hover:shadow-md',
                insight.severity === 'high' && 'border-amber-500/35',
                insight.severity === 'medium' && 'border-border',
                insight.severity === 'low' && 'border-border opacity-90'
              )}
            >
              <div
                className={cn(
                  'h-1',
                  insight.severity === 'high' && 'bg-gradient-to-r from-amber-500 to-orange-500',
                  insight.severity === 'medium' && 'bg-gradient-to-r from-primary/60 to-primary/20',
                  insight.severity === 'low' && 'bg-muted'
                )}
              />
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      insight.severity === 'high'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {insight.severity === 'high' ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <Lightbulb className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{insight.title}</div>
                    <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{insight.detail}</p>
                    {insight.tradeCount > 0 && insight.impactPnL !== 0 && (
                      <p className="text-xs mt-2.5 flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {insight.impactPnL > 0 ? 'Opportunity cost' : 'Recoverable'}
                        </span>
                        <DeltaBadge value={insight.impactPnL} />
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </OverviewSection>

      {/* Top recommendations */}
      <OverviewSection
        title="Top simulated actions"
        description="Best-performing single rules from your history."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {recommendations.map(({ icon: Icon, title, scenario, result, accent, iconBg }) => (
            <Card
              key={scenario.id}
              className={cn('overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 bg-gradient-to-b', accent)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <CardDescription className="mb-0 text-[11px] uppercase tracking-wide">
                      {title}
                    </CardDescription>
                    <CardTitle className="text-base mt-0.5">{scenario.name}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground text-xs leading-relaxed">{scenario.action}</p>
                {result && (
                  <div className="rounded-lg bg-card/60 border p-3 space-y-1 tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-xs">P&L</span>
                      <span className="font-bold">{formatUsdPnlSigned(result.stats.totalPnL)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground text-xs">vs actual</span>
                      <DeltaBadge value={result.pnlDelta} />
                    </div>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs"
                  onClick={() => setActiveRuleIds([scenario.id])}
                >
                  Apply rule
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </OverviewSection>

      {/* Action plan */}
      <OverviewSection
        title="Suggested action plan"
        description="Process rules your journal already flags as problems."
      >
        <Card>
          <CardContent className="pt-6">
            <ol className="space-y-0 list-none relative">
              {[
                {
                  title: 'Trade only A / A+ setups',
                  body: `A-setup-only would capture most gains with far fewer trades and ${formatUsdPnl(
                    analysis.scenarios.find((s) => s.scenario.id === 'a-setups-only')?.stats.maxDrawdown ?? 0
                  )} max drawdown.`,
                },
                {
                  title: 'Stop after 2 losses per day',
                  body: `Simulated +${formatUsdPnl(
                    analysis.scenarios.find((s) => s.scenario.id === 'stop-2-loss-day')?.pnlDelta ?? 0
                  )} by cutting ${
                    analysis.scenarios.find((s) => s.scenario.id === 'stop-2-loss-day')?.skippedTrades ?? 0
                  } later trades.`,
                },
                {
                  title: 'Eliminate Mistake and Random entries',
                  body: `Skipping both adds +${formatUsdPnl(
                    analysis.scenarios.find((s) => s.scenario.id === 'skip-mistake-random')?.pnlDelta ?? 0
                  )} with lower drawdown.`,
                },
                {
                  title: 'Cap at 3 trades per day',
                  body: `Max-3 improves profit factor to ${(
                    analysis.scenarios.find((s) => s.scenario.id === 'max-3-day')?.stats.profitFactor ?? 0
                  ).toFixed(2)}.`,
                },
              ].map((step, i, arr) => (
                <li key={step.title} className="flex gap-4 pb-6 last:pb-0 relative">
                  {i < arr.length - 1 && (
                    <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
                  )}
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shadow-sm z-10">
                    {i + 1}
                  </span>
                  <div className="pt-0.5">
                    <div className="font-semibold">{step.title}</div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground border-t mt-6 pt-4 leading-relaxed">
              Simulations replay past trades only — they do not predict future results.
            </p>
          </CardContent>
        </Card>
      </OverviewSection>
    </div>
  )
}
