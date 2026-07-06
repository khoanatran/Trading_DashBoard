import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE, formatNycDateTime } from '@/lib/timezone'
import type { TradeJournalEntry } from '@/lib/trade-journal'
import {
  Trade,
  TradeStats,
  calculateStats,
  calculateARate,
  getTradeId,
  getTradeResult,
  getTradeEntryTimeMs,
  getTradeRMultiple,
  isASetupTrade,
  sortTradesForEquityCurve,
  parseLocalTimestamp,
  A_SETUP_TAGS,
  RANDOM_TAG,
} from '@/utils/logParser'

export type SimulationScenarioId =
  | 'actual'
  | 'skip-mistake'
  | 'skip-random'
  | 'skip-mistake-random'
  | 'a-setups-only'
  | 'stop-2-loss-day'
  | 'max-3-day'
  | 'skip-choppy'
  | 'skip-low-rated'
  | 'discipline-combo'

export interface SimulationScenario {
  id: SimulationScenarioId
  name: string
  description: string
  action: string
  category: 'filter' | 'rule' | 'baseline'
  /** Higher = more recommended when sorting by impact */
  priority: number
}

export interface TradeSimulationDecision {
  trade: Trade
  included: boolean
  reason: string
  /** Present when trade fails a combined multi-rule simulation */
  excludedBy?: { scenarioId: SimulationScenarioId; scenarioName: string; reason: string }[]
}

export interface SimulationResult {
  scenario: SimulationScenario
  trades: Trade[]
  stats: TradeStats
  aRate: number
  skippedTrades: number
  skippedPnL: number
  pnlDelta: number
  maxDrawdownDelta: number
  equityCurve: { index: number; cumulative: number }[]
  decisions: TradeSimulationDecision[]
  includedDecisions: TradeSimulationDecision[]
  excludedDecisions: TradeSimulationDecision[]
}

export interface TradeInsight {
  id: string
  title: string
  detail: string
  impactPnL: number
  tradeCount: number
  severity: 'high' | 'medium' | 'low'
}

export interface SimulationAnalysis {
  baseline: SimulationResult
  scenarios: SimulationResult[]
  insights: TradeInsight[]
  bestByPnL: SimulationScenarioId
  bestByDrawdown: SimulationScenarioId
  bestByProfitFactor: SimulationScenarioId
}

const MISTAKE_TAG = 'Mistake'
const CHOPPY_TAG = 'Choppy Market'

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: 'actual',
    name: 'Actual',
    description: 'Your recorded trades exactly as taken.',
    action: 'No change — baseline for comparison.',
    category: 'baseline',
    priority: 0,
  },
  {
    id: 'a-setups-only',
    name: 'Only A / A+ setups',
    description: 'Take only trades tagged A setup or A+ Setup.',
    action: 'Wait for A-grade LVN + heatmap alignment before entering.',
    category: 'filter',
    priority: 10,
  },
  {
    id: 'stop-2-loss-day',
    name: 'Stop after 2 losses per day',
    description: 'After two losing trades in a session, stop trading for the day.',
    action: 'Walk away after the second full loss; no revenge trades.',
    category: 'rule',
    priority: 9,
  },
  {
    id: 'skip-mistake-random',
    name: 'Skip Mistake & Random',
    description: 'Remove trades you tagged as Mistake or Random.',
    action: 'Pre-trade checklist: if it feels random or off-plan, do not click.',
    category: 'filter',
    priority: 8,
  },
  {
    id: 'max-3-day',
    name: 'Max 3 trades per day',
    description: 'Keep only the first three trades each day (by entry time).',
    action: 'Cap daily attempts at 3; prioritize morning A setups.',
    category: 'rule',
    priority: 7,
  },
  {
    id: 'skip-mistake',
    name: 'Skip Mistake trades',
    description: 'Remove trades tagged Mistake.',
    action: 'Review journal before entry; avoid known error patterns.',
    category: 'filter',
    priority: 6,
  },
  {
    id: 'skip-random',
    name: 'Skip Random trades',
    description: 'Remove trades tagged Random (emotional / off-plan entries).',
    action: 'No dip buys or heatmap-only entries without full setup confluence.',
    category: 'filter',
    priority: 5,
  },
  {
    id: 'discipline-combo',
    name: 'Discipline combo',
    description: 'Keep A setups plus any trade that is not Mistake or Random.',
    action: 'Trade A setups; otherwise only high-conviction non-mistake plans.',
    category: 'filter',
    priority: 4,
  },
  {
    id: 'skip-choppy',
    name: 'Skip Choppy Market',
    description: 'Remove trades taken during choppy conditions.',
    action: 'Stand aside when price action is two-sided and LVN quality is poor.',
    category: 'filter',
    priority: 3,
  },
  {
    id: 'skip-low-rated',
    name: 'Skip journal rating < 2',
    description: 'Remove trades you later rated below 2 stars in the journal.',
    action: 'If setup quality feels below 2/5 pre-trade, pass.',
    category: 'filter',
    priority: 2,
  },
]

/** Scenario IDs that can be stacked in a combined simulation (excludes actual). */
export const COMBINABLE_SCENARIO_IDS: SimulationScenarioId[] = SIMULATION_SCENARIOS.filter(
  (s) => s.id !== 'actual'
).map((s) => s.id)

function hasTag(trade: Trade, tag: string, tradeTags: Record<string, string[]>): boolean {
  return (tradeTags[getTradeId(trade)] ?? []).includes(tag)
}

export function getClosedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.isClosed && t.pnl != null)
}

function sortByEntry(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => getTradeEntryTimeMs(a) - getTradeEntryTimeMs(b))
}

function getEntryDayKey(trade: Trade): string {
  const raw = trade.entryTime ?? trade.timestamp
  if (!raw) return 'unknown'
  return formatInTimeZone(parseLocalTimestamp(raw), DISPLAY_TIMEZONE, 'yyyy-MM-dd')
}

function formatEntryDayLabel(trade: Trade): string {
  const raw = trade.entryTime ?? trade.timestamp
  if (!raw) return 'unknown date'
  return formatNycDateTime(raw, { showTime: false })
}

function isMorningSession(trade: Trade): boolean {
  const raw = trade.entryTime ?? trade.timestamp
  if (!raw) return true
  const hour = parseInt(formatInTimeZone(parseLocalTimestamp(raw), DISPLAY_TIMEZONE, 'H'), 10)
  return hour < 12
}

function getTradeTagsLabel(trade: Trade, tradeTags: Record<string, string[]>): string {
  const tags = tradeTags[getTradeId(trade)] ?? []
  return tags.length > 0 ? tags.join(', ') : '—'
}

function evaluateMaxTradesPerDayDecisions(
  closed: Trade[],
  maxPerDay: number
): TradeSimulationDecision[] {
  const counts: Record<string, number> = {}
  return sortByEntry(closed).map((trade) => {
    const day = getEntryDayKey(trade)
    const dayLabel = formatEntryDayLabel(trade)
    counts[day] = (counts[day] ?? 0) + 1
    const tradeNum = counts[day]
    const included = tradeNum <= maxPerDay
    return {
      trade,
      included,
      reason: included
        ? `Included — trade ${tradeNum} of ${maxPerDay} allowed on ${dayLabel}`
        : `Excluded — daily cap exceeded (trade ${tradeNum} on ${dayLabel})`,
    }
  })
}

function evaluateStopAfterLossesPerDayDecisions(
  closed: Trade[],
  maxLosses: number,
  tradeTags: Record<string, string[]>
): TradeSimulationDecision[] {
  const dayLosses: Record<string, number> = {}
  return sortByEntry(closed).map((trade) => {
    const day = getEntryDayKey(trade)
    const dayLabel = formatEntryDayLabel(trade)
    if ((dayLosses[day] ?? 0) >= maxLosses) {
      return {
        trade,
        included: false,
        reason: `Excluded — day stopped after ${maxLosses} losses (${dayLabel})`,
      }
    }
    const result = getTradeResult(trade, tradeTags)
    const included = true
    let reason = `Included — taken before ${maxLosses}-loss stop on ${dayLabel}`
    if (result === 'LOSS') {
      dayLosses[day] = (dayLosses[day] ?? 0) + 1
      if (dayLosses[day] >= maxLosses) {
        reason = `Included — ${dayLosses[day]}${dayLosses[day] === 2 ? 'nd' : 'th'} loss triggers stop for rest of ${dayLabel}`
      }
    }
    return { trade, included, reason }
  })
}

/** Per-trade include/exclude evaluation for a single scenario. */
export function evaluateScenarioDecisions(
  trades: Trade[],
  scenarioId: SimulationScenarioId,
  tradeTags: Record<string, string[]>,
  journal?: Record<string, TradeJournalEntry>
): TradeSimulationDecision[] {
  const closed = getClosedTrades(trades)

  switch (scenarioId) {
    case 'actual':
      return closed.map((trade) => ({
        trade,
        included: true,
        reason: 'Included — actual recorded trade',
      }))

    case 'skip-mistake':
      return closed.map((trade) => {
        const tagged = hasTag(trade, MISTAKE_TAG, tradeTags)
        return {
          trade,
          included: !tagged,
          reason: tagged
            ? `Excluded — tagged "${MISTAKE_TAG}"`
            : 'Included — not tagged Mistake',
        }
      })

    case 'skip-random':
      return closed.map((trade) => {
        const tagged = hasTag(trade, RANDOM_TAG, tradeTags)
        return {
          trade,
          included: !tagged,
          reason: tagged
            ? `Excluded — tagged "${RANDOM_TAG}"`
            : 'Included — not tagged Random',
        }
      })

    case 'skip-mistake-random':
      return closed.map((trade) => {
        const mistake = hasTag(trade, MISTAKE_TAG, tradeTags)
        const random = hasTag(trade, RANDOM_TAG, tradeTags)
        if (mistake) {
          return { trade, included: false, reason: `Excluded — tagged "${MISTAKE_TAG}"` }
        }
        if (random) {
          return { trade, included: false, reason: `Excluded — tagged "${RANDOM_TAG}"` }
        }
        return { trade, included: true, reason: 'Included — not Mistake or Random' }
      })

    case 'a-setups-only':
      return closed.map((trade) => {
        const isA = isASetupTrade(trade, tradeTags)
        const tags = getTradeTagsLabel(trade, tradeTags)
        return {
          trade,
          included: isA,
          reason: isA
            ? `Included — A setup (${tags})`
            : `Excluded — not tagged ${A_SETUP_TAGS.join(' or ')} (tags: ${tags})`,
        }
      })

    case 'stop-2-loss-day':
      return evaluateStopAfterLossesPerDayDecisions(closed, 2, tradeTags)

    case 'max-3-day':
      return evaluateMaxTradesPerDayDecisions(closed, 3)

    case 'skip-choppy':
      return closed.map((trade) => {
        const tagged = hasTag(trade, CHOPPY_TAG, tradeTags)
        return {
          trade,
          included: !tagged,
          reason: tagged
            ? `Excluded — tagged "${CHOPPY_TAG}"`
            : 'Included — not tagged Choppy Market',
        }
      })

    case 'skip-low-rated':
      return closed.map((trade) => {
        const entry = journal?.[getTradeId(trade)]
        const lowRated = entry && entry.rating != null && entry.rating < 2
        return {
          trade,
          included: !lowRated,
          reason: lowRated
            ? `Excluded — journal rating ${entry!.rating} (< 2)`
            : entry?.rating != null
              ? `Included — journal rating ${entry.rating} (≥ 2)`
              : 'Included — no journal rating below 2',
        }
      })

    case 'discipline-combo':
      return closed.map((trade) => {
        const isA = isASetupTrade(trade, tradeTags)
        const mistake = hasTag(trade, MISTAKE_TAG, tradeTags)
        const random = hasTag(trade, RANDOM_TAG, tradeTags)
        if (isA) {
          return { trade, included: true, reason: 'Included — A / A+ setup' }
        }
        if (mistake) {
          return { trade, included: false, reason: `Excluded — tagged "${MISTAKE_TAG}"` }
        }
        if (random) {
          return { trade, included: false, reason: `Excluded — tagged "${RANDOM_TAG}"` }
        }
        return { trade, included: true, reason: 'Included — not Mistake or Random' }
      })

    default:
      return closed.map((trade) => ({ trade, included: true, reason: 'Included' }))
  }
}

function buildEquityCurve(trades: Trade[]): { index: number; cumulative: number }[] {
  const sorted = sortTradesForEquityCurve(trades)
  let cumulative = 0
  return sorted.map((trade, i) => {
    cumulative += trade.pnl ?? 0
    return { index: i + 1, cumulative }
  })
}

function partitionDecisions(decisions: TradeSimulationDecision[]): {
  includedDecisions: TradeSimulationDecision[]
  excludedDecisions: TradeSimulationDecision[]
  trades: Trade[]
} {
  const includedDecisions = decisions.filter((d) => d.included)
  const excludedDecisions = decisions.filter((d) => !d.included)
  return {
    includedDecisions,
    excludedDecisions,
    trades: includedDecisions.map((d) => d.trade),
  }
}

function buildSimulationResult(
  scenario: SimulationScenario,
  decisions: TradeSimulationDecision[],
  tradeTags: Record<string, string[]>,
  baselinePnL: number,
  baselineMaxDD: number
): SimulationResult {
  const { includedDecisions, excludedDecisions, trades: filtered } = partitionDecisions(decisions)
  const stats = calculateStats(filtered, tradeTags)
  const aRate = calculateARate(filtered, tradeTags)
  const allClosed = decisions
  const skippedPnL = excludedDecisions.reduce((s, d) => s + (d.trade.pnl ?? 0), 0)

  return {
    scenario,
    trades: filtered,
    stats,
    aRate,
    skippedTrades: excludedDecisions.length,
    skippedPnL,
    pnlDelta: stats.totalPnL - baselinePnL,
    maxDrawdownDelta: stats.maxDrawdown - baselineMaxDD,
    equityCurve: buildEquityCurve(filtered),
    decisions,
    includedDecisions,
    excludedDecisions,
  }
}

function simulateScenario(
  trades: Trade[],
  scenario: SimulationScenario,
  tradeTags: Record<string, string[]>,
  baselinePnL: number,
  baselineMaxDD: number,
  journal?: Record<string, TradeJournalEntry>
): SimulationResult {
  const decisions = evaluateScenarioDecisions(trades, scenario.id, tradeTags, journal)
  return buildSimulationResult(scenario, decisions, tradeTags, baselinePnL, baselineMaxDD)
}

/** Build a display scenario object for a multi-rule combination. */
export function createCombinedScenario(scenarioIds: SimulationScenarioId[]): SimulationScenario {
  const names = scenarioIds.map((id) => getScenarioById(id).name)
  return {
    id: 'discipline-combo', // placeholder id for type compatibility; UI uses custom label
    name:
      names.length <= 2
        ? names.join(' + ')
        : `${names.slice(0, 2).join(' + ')} + ${names.length - 2} more`,
    description: `Combined simulation: trade must pass all ${scenarioIds.length} selected rules.`,
    action: scenarioIds.map((id) => getScenarioById(id).action).join(' · '),
    category: 'filter',
    priority: 0,
  }
}

/**
 * Combine multiple scenario simulations with AND logic.
 * A trade is included only if every selected scenario would include it.
 */
export function combineSimulationScenarios(
  trades: Trade[],
  scenarioIds: SimulationScenarioId[],
  tradeTags: Record<string, string[]>,
  journal?: Record<string, TradeJournalEntry>,
  baselinePnL = 0,
  baselineMaxDD = 0
): SimulationResult {
  const uniqueIds = [...new Set(scenarioIds)].filter((id) => id !== 'actual')
  if (uniqueIds.length === 0) {
    return simulateScenario(
      trades,
      getScenarioById('actual'),
      tradeTags,
      baselinePnL,
      baselineMaxDD,
      journal
    )
  }
  if (uniqueIds.length === 1) {
    return simulateScenario(
      trades,
      getScenarioById(uniqueIds[0]),
      tradeTags,
      baselinePnL,
      baselineMaxDD,
      journal
    )
  }

  const perScenario = uniqueIds.map((id) => ({
    id,
    scenario: getScenarioById(id),
    decisions: evaluateScenarioDecisions(trades, id, tradeTags, journal),
  }))

  const closed = getClosedTrades(trades)
  const decisionByTradeId = perScenario.map(
    (s) => new Map(s.decisions.map((d) => [getTradeId(d.trade), d]))
  )

  const combinedDecisions: TradeSimulationDecision[] = closed.map((trade) => {
    const tradeId = getTradeId(trade)
    const failures = perScenario
      .map((s, i) => {
        const d = decisionByTradeId[i].get(tradeId)
        if (!d || d.included) return null
        return {
          scenarioId: s.id,
          scenarioName: s.scenario.name,
          reason: d.reason,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)

    const included = failures.length === 0
    const reason = included
      ? `Included — passes all ${uniqueIds.length} rules (${perScenario.map((s) => s.scenario.name).join(', ')})`
      : `Excluded — failed ${failures.length} of ${uniqueIds.length} rules`

    return {
      trade,
      included,
      reason,
      excludedBy: failures.length > 0 ? failures : undefined,
    }
  })

  const combinedScenario = createCombinedScenario(uniqueIds)
  return buildSimulationResult(
    combinedScenario,
    combinedDecisions,
    tradeTags,
    baselinePnL,
    baselineMaxDD
  )
}

function buildInsights(
  trades: Trade[],
  tradeTags: Record<string, string[]>,
  journal?: Record<string, TradeJournalEntry>
): TradeInsight[] {
  const closed = getClosedTrades(trades)
  const insights: TradeInsight[] = []

  const mistakeTrades = closed.filter((t) => hasTag(t, MISTAKE_TAG, tradeTags))
  if (mistakeTrades.length > 0) {
    const pnl = mistakeTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'mistake',
      title: 'Mistake-tagged trades',
      detail: `${mistakeTrades.length} trades tagged "${MISTAKE_TAG}" cost ${pnl >= 0 ? 'net' : ''} ${Math.abs(pnl).toFixed(0)} in P&L. Removing them improves equity and drawdown.`,
      impactPnL: -pnl,
      tradeCount: mistakeTrades.length,
      severity: pnl < -500 ? 'high' : 'medium',
    })
  }

  const randomTrades = closed.filter((t) => hasTag(t, RANDOM_TAG, tradeTags))
  if (randomTrades.length > 0) {
    const pnl = randomTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'random',
      title: 'Random / emotional entries',
      detail: `${randomTrades.length} Random-tagged trades (often revenge dip buys) contributed ${pnl.toFixed(0)}. Journal notes cite emotional entries after large losses.`,
      impactPnL: -pnl,
      tradeCount: randomTrades.length,
      severity: pnl < -300 ? 'high' : 'medium',
    })
  }

  const aOnly = closed.filter((t) => isASetupTrade(t, tradeTags))
  const nonA = closed.filter((t) => !isASetupTrade(t, tradeTags))
  if (aOnly.length > 0 && nonA.length > 0) {
    const aPnL = aOnly.reduce((s, t) => s + (t.pnl ?? 0), 0)
    const nonAPnL = nonA.reduce((s, t) => s + (t.pnl ?? 0), 0)
    const totalPnL = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'a-setups',
      title: 'A setups vs everything else',
      detail: `Only ${aOnly.length} of ${closed.length} trades were A/A+ setups, yet they produced ${aPnL.toFixed(0)} (${totalPnL !== 0 ? ((aPnL / totalPnL) * 100).toFixed(0) : 0}% of total P&L). Non-A trades: ${nonAPnL.toFixed(0)} across ${nonA.length} trades.`,
      impactPnL: nonAPnL,
      tradeCount: nonA.length,
      severity: 'high',
    })
  }

  const afternoon = closed.filter((t) => !isMorningSession(t))
  if (afternoon.length > 0) {
    const pnl = afternoon.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'afternoon',
      title: 'Afternoon session (12:00+ ET)',
      detail: `${afternoon.length} trades after noon ET netted ${pnl.toFixed(0)}. Morning-only would remove these — mixed result, but afternoon adds drawdown risk.`,
      impactPnL: -pnl,
      tradeCount: afternoon.length,
      severity: pnl < 0 ? 'medium' : 'low',
    })
  }

  const overtradeDays = (() => {
    const byDay: Record<string, Trade[]> = {}
    for (const t of closed) {
      const day = getEntryDayKey(t)
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(t)
    }
    return Object.entries(byDay).filter(([, list]) => list.length > 3)
  })()
  if (overtradeDays.length > 0) {
    const extraTrades = overtradeDays.flatMap(([, list]) => list.slice(3))
    const extraPnL = extraTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'overtrade',
      title: 'Overtrading (4+ trades/day)',
      detail: `${overtradeDays.length} days had 4+ trades. Trades beyond the 3rd each day cost ${extraPnL.toFixed(0)} combined.`,
      impactPnL: -extraPnL,
      tradeCount: extraTrades.length,
      severity: extraPnL < -500 ? 'high' : 'medium',
    })
  }

  const lowRated = closed.filter((t) => {
    const entry = journal?.[getTradeId(t)]
    return entry && entry.rating != null && entry.rating < 2
  })
  if (lowRated.length > 0) {
    const pnl = lowRated.reduce((s, t) => s + (t.pnl ?? 0), 0)
    insights.push({
      id: 'low-rated',
      title: 'Low-conviction trades (rating < 2)',
      detail: `${lowRated.length} trades you rated below 2 stars netted ${pnl.toFixed(0)}. Pre-trade quality filter would have skipped these.`,
      impactPnL: -pnl,
      tradeCount: lowRated.length,
      severity: pnl < -500 ? 'high' : 'medium',
    })
  }

  const aRate = calculateARate(closed, tradeTags)
  if (aRate < 75) {
    insights.push({
      id: 'a-rate',
      title: 'A Rate below weekly target',
      detail: `A Rate is ${aRate.toFixed(0)}% vs 75% KPI target. Only ${A_SETUP_TAGS.join(' / ')} tags count — most trades are B-grade or untagged.`,
      impactPnL: 0,
      tradeCount: closed.length - aOnly.length,
      severity: 'high',
    })
  }

  return insights.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 }
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity]
    }
    return Math.abs(b.impactPnL) - Math.abs(a.impactPnL)
  })
}

export function analyzeTradeSimulations(
  trades: Trade[],
  tradeTags: Record<string, string[]>,
  journal?: Record<string, TradeJournalEntry>
): SimulationAnalysis {
  const baselineScenario = SIMULATION_SCENARIOS.find((s) => s.id === 'actual')!
  const baseline = simulateScenario(trades, baselineScenario, tradeTags, 0, 0, journal)

  const scenarios = SIMULATION_SCENARIOS.filter((s) => s.id !== 'actual').map((scenario) =>
    simulateScenario(
      trades,
      scenario,
      tradeTags,
      baseline.stats.totalPnL,
      baseline.stats.maxDrawdown,
      journal
    )
  )

  scenarios.sort((a, b) => b.stats.totalPnL - a.stats.totalPnL)

  const bestByPnL = scenarios[0]?.scenario.id ?? 'actual'
  const bestByDrawdown = [...scenarios].sort(
    (a, b) => a.stats.maxDrawdown - b.stats.maxDrawdown
  )[0]?.scenario.id ?? 'actual'
  const bestByProfitFactor = [...scenarios].sort((a, b) => {
    const pfA = a.stats.profitFactor === Infinity ? 999 : a.stats.profitFactor
    const pfB = b.stats.profitFactor === Infinity ? 999 : b.stats.profitFactor
    return pfB - pfA
  })[0]?.scenario.id ?? 'actual'

  return {
    baseline,
    scenarios,
    insights: buildInsights(trades, tradeTags, journal),
    bestByPnL,
    bestByDrawdown,
    bestByProfitFactor,
  }
}

export function getScenarioById(id: SimulationScenarioId): SimulationScenario {
  return SIMULATION_SCENARIOS.find((s) => s.id === id) ?? SIMULATION_SCENARIOS[0]
}

/** Cumulative P&L after each trade closes (equity-curve order), keyed by trade id. */
export function buildCumulativePnlByTradeId(trades: Trade[]): Record<string, number> {
  const sorted = sortTradesForEquityCurve(trades)
  const map: Record<string, number> = {}
  let cumulative = 0
  for (const trade of sorted) {
    cumulative += trade.pnl ?? 0
    map[getTradeId(trade)] = cumulative
  }
  return map
}

/** Format trade row label for breakdown tables. */
export function formatSimulationTradeLabel(trade: Trade): string {
  const ts = trade.entryTime ?? trade.timestamp
  const time = ts ? formatNycDateTime(ts) : 'Unknown time'
  const dir = trade.direction ? trade.direction.toUpperCase() : '—'
  return `${time} · ${dir}`
}
