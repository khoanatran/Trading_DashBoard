// Parse trade_logs.txt and TradesList.txt (Sierra Chart export) and extract trade data

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey } from '@/utils/tradingDays'

export interface PartialExit {
  contracts: number
  exitPrice: number
  entryPrice: number
  reward: number | null
  rrRatio: number | null
  pnl: number
  cumulativePnl: number
  timestamp: string | null
  isFinal: boolean
  estRisk: number | null // Pro-rata estimated risk based on contracts
}

export interface Trade {
  timestamp: string | null
  direction: string | null
  riskAmount: number | null
  estDollarRisked: number | null
  slPoints: number | null
  tpPoints: number | null
  orderQty: number | null
  entryPrice: number | null
  exitPrice: number | null
  reward: number | null
  rrRatio: number | null
  pnl: number | null
  isClosed: boolean
  entryTime?: string | null
  exitTime?: string | null
  partialExits?: PartialExit[]
  sourceFile?: string | null // The log file name this trade came from
  symbol?: string | null // Instrument symbol (e.g. MNQH26_FUT_CME) for MNQ-specific R:R
  commission?: number | null // Commission fees for risk calculation
}

/** Fixed account risk per 1R (used for R-multiple and est. dollar risked). */
export const DOLLARS_PER_R = 500

export function roundRMultiple(rr: number): number {
  return Math.round(rr * 10) / 10
}

export function pnlToRMultiple(pnl: number | null | undefined): number | null {
  if (pnl === null || pnl === undefined) return null
  if (Math.abs(pnl) < 1) return 0
  return roundRMultiple(pnl / DOLLARS_PER_R)
}

/** Set estDollarRisked / riskAmount to $500 and derive R:R from P&L. */
export function applyDollarsPerR(trade: Trade): void {
  trade.estDollarRisked = DOLLARS_PER_R
  trade.riskAmount = DOLLARS_PER_R
  trade.rrRatio = pnlToRMultiple(trade.pnl)
}

function applyPartialExitDollarsPerR(trade: Trade): void {
  if (!trade.partialExits?.length) return
  const orderQty = trade.orderQty || 1
  for (const exit of trade.partialExits) {
    exit.estRisk =
      orderQty > 0
        ? (exit.contracts / orderQty) * DOLLARS_PER_R
        : DOLLARS_PER_R
    if (exit.pnl !== undefined) {
      exit.rrRatio = pnlToRMultiple(exit.pnl)
    }
  }
}

/** Re-apply $500-per-R to every trade (call after import or when refreshing metrics). */
export function normalizeTradesRisk(trades: Trade[]): Trade[] {
  return trades.map(trade => {
    const normalized: Trade = {
      ...trade,
      partialExits: trade.partialExits?.map(exit => ({ ...exit })),
    }
    applyDollarsPerR(normalized)
    applyPartialExitDollarsPerR(normalized)
    return normalized
  })
}

/** Canonical R multiple: P&L / $500. Always use this for display and stats. */
export function getTradeRMultiple(trade: Trade): number | null {
  return pnlToRMultiple(trade.pnl)
}

export function getPartialExitRMultiple(exit: PartialExit): number | null {
  return pnlToRMultiple(exit.pnl)
}

export function getTradeDollarRisk(_trade?: Trade): number {
  return DOLLARS_PER_R
}

// Position-adjusted R uses the same $500-per-R rule as the rest of the dashboard.
export function getPositionAdjustedRMultiple(trade: Trade): number | null {
  return getTradeRMultiple(trade)
}

// Generate a stable trade ID from sourceFile + timestamp (journal notes, tags, media)
export function getTradeId(trade: Trade): string {
  const file = trade.sourceFile || 'unknown'
  const ts = trade.timestamp || 'unknown'
  return `${file}::${ts}`
}

/** Content fingerprint for deduplication across imports (ignores source file name). */
export function getTradeDedupKey(trade: Trade): string {
  const entry = trade.entryTime ?? trade.timestamp ?? ''
  const exit = trade.exitTime ?? ''
  const symbol = (trade.symbol ?? '').trim().toLowerCase()
  const direction = (trade.direction ?? '').trim().toLowerCase()
  const entryPrice = trade.entryPrice != null ? trade.entryPrice.toFixed(5) : ''
  const exitPrice = trade.exitPrice != null ? trade.exitPrice.toFixed(5) : ''
  const pnl = trade.pnl != null ? trade.pnl.toFixed(2) : ''
  const qty = trade.orderQty != null ? String(trade.orderQty) : ''
  return `${symbol}|${entry}|${exit}|${direction}|${entryPrice}|${exitPrice}|${pnl}|${qty}`
}

export interface TradeStats {
  totalTrades: number
  wins: number
  losses: number
  breakevens: number
  winRate: number
  avgRR: number
  avgWinRR: number
  avgLossRR: number
  totalPnL: number
  bestTrade: Trade | null
  worstTrade: Trade | null
  profitFactor: number
  sharpeRatio: number
  maxDrawdown: number
  /** Equity peak date (ET calendar day of trade) at start of max drawdown */
  maxDrawdownPeakAt: Date | null
  /** Equity trough date (ET calendar day of trade) at end of max drawdown */
  maxDrawdownTroughAt: Date | null
  /** 1-based trade index on equity curve at peak before max drawdown */
  maxDrawdownPeakIndex: number | null
  /** 1-based trade index on equity curve at max drawdown trough */
  maxDrawdownTroughIndex: number | null
  /** Cumulative P&L at the equity peak before max drawdown */
  maxDrawdownPeakPnl: number | null
  /** Cumulative P&L at the max drawdown trough */
  maxDrawdownTroughPnl: number | null
  avgRisk: number
  totalRisk: number
  totalGains: number
  totalLosses: number
  /** % of decisive trading days that were net green (BE days excluded). */
  winDayPercent: number
  winningDays: number
  losingDays: number
  breakevenDays: number
  /** Avg net $ on winning days ÷ avg |net $| on losing days. */
  winDayRR: number
  avgWinDayPnL: number
  avgLossDayPnL: number
}

/** Overview Avg R:R = avg win R ÷ |avg loss R| (BE excluded). Returns null when no decisive trades. */
export function getOverviewAvgRRRatio(stats: TradeStats): number | null {
  if (stats.wins + stats.losses === 0) return null
  if (stats.losses === 0 && stats.wins > 0) return Infinity
  if (Math.abs(stats.avgLossRR) === 0) return stats.avgWinRR > 0 ? Infinity : 0
  return stats.avgWinRR / Math.abs(stats.avgLossRR)
}

export function formatOverviewAvgRR(stats: TradeStats): string {
  const ratio = getOverviewAvgRRRatio(stats)
  if (ratio === null) return 'N/A'
  if (ratio === Infinity) return '∞'
  return ratio.toFixed(2)
}

export function isOverviewAvgRRFavorable(stats: TradeStats): boolean {
  const ratio = getOverviewAvgRRRatio(stats)
  if (ratio === null) return false
  if (ratio === Infinity) return true
  return ratio >= 1
}

// BE threshold: trades between -0.25R and +0.25R are considered break-even
export const BE_THRESHOLD = 0.25

/** Trades tagged "Random" in the BE band are classified as losses. */
export const RANDOM_TAG = 'Random'

/** Trades tagged "Bad SL Placement" in the BE band are classified as losses. */
export const BAD_SL_PLACEMENT_TAG = 'Bad SL Placement'

/** BE-band trades with any of these tags count as losses (win rate, A Rate, stats). */
export const BE_LOSS_OVERRIDE_TAGS = [RANDOM_TAG, BAD_SL_PLACEMENT_TAG] as const

/** Tags that count toward A Rate (A and A+ setups). */
export const A_SETUP_TAGS = ['A+ Setup', 'A setup'] as const

export function isASetupTrade(
  trade: Trade,
  tradeTags?: Record<string, string[]> | null
): boolean {
  const tags = tradeTags?.[getTradeId(trade)] ?? []
  return tags.some(tag => (A_SETUP_TAGS as readonly string[]).includes(tag))
}

export type TradeResult = 'WIN' | 'LOSS' | 'BE'

export function classifyTradeResult(rr: number, tags?: string[] | null): TradeResult {
  if (rr > BE_THRESHOLD) return 'WIN'
  if (rr < -BE_THRESHOLD) return 'LOSS'
  if (tags?.some(tag => (BE_LOSS_OVERRIDE_TAGS as readonly string[]).includes(tag))) return 'LOSS'
  return 'BE'
}

export function getTradeResult(
  trade: Trade,
  tradeTags?: Record<string, string[]> | null
): TradeResult {
  return classifyTradeResult(
    getTradeRMultiple(trade) ?? 0,
    tradeTags?.[getTradeId(trade)]
  )
}

export function isDecisiveTrade(
  trade: Trade,
  tradeTags?: Record<string, string[]> | null
): boolean {
  const result = getTradeResult(trade, tradeTags)
  return result === 'WIN' || result === 'LOSS'
}

/** A Rate = (A + A+ setups) ÷ (wins + losses) × 100; BE trades excluded unless classified as losses. */
export function getARateBreakdown(
  trades: Trade[],
  tradeTags?: Record<string, string[]> | null
): { aCount: number; decisiveTrades: number; aRate: number } {
  const aCount = trades.filter(t => isASetupTrade(t, tradeTags)).length
  const decisiveTrades = trades.filter(t => isDecisiveTrade(t, tradeTags)).length
  const aRate = decisiveTrades > 0 ? (aCount / decisiveTrades) * 100 : 0
  return { aCount, decisiveTrades, aRate }
}

export function calculateARate(
  trades: Trade[],
  tradeTags?: Record<string, string[]> | null
): number {
  return getARateBreakdown(trades, tradeTags).aRate
}

export interface Streaks {
  currentStreak: number
  currentStreakType: 'win' | 'loss' | null
  longestWinStreak: number
  longestLossStreak: number
}

// Helper function to extract content after timestamp and log level
function getLineContent(line: string): string {
  const parts = line.split(' - ')
  if (parts.length >= 2) {
    return parts[parts.length - 1].trim()
  }
  return line.trim()
}

export function parseTradeLogs(fileContent: string, sourceFile?: string): Trade[] {
  const trades: Trade[] = []
  const lines = fileContent.split('\n')
  
  let currentTrade: Trade | null = null
  let isInTrade = false
  let currentPartialExit: Partial<PartialExit> | null = null
  let isInPartialExit = false
  let isInFinalExit = false
  let finalExitPrice: number | null = null
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine) continue
    
    const line = getLineContent(rawLine)
    
    // Extract timestamp from raw line for partial exits
    const timestampMatch = rawLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
    // Convert to ISO format with 'T' for consistent Date parsing across browsers
    const lineTimestamp = timestampMatch ? timestampMatch[1].replace(' ', 'T') : null
    
    // Start of a new trade
    if (line.includes('=== NEW TRADE ===')) {
      if (isInTrade && currentTrade) {
        if (currentTrade.timestamp) {
          currentTrade.isClosed = true
          trades.push({ ...currentTrade })
        }
      }
      
      isInTrade = true
      isInPartialExit = false
      isInFinalExit = false
      currentPartialExit = null
      finalExitPrice = null
      currentTrade = {
        timestamp: null,
        direction: null,
        riskAmount: null,
        estDollarRisked: null,
        slPoints: null,
        tpPoints: null,
        orderQty: null,
        entryPrice: null,
        exitPrice: null,
        reward: null,
        rrRatio: null,
        pnl: null,
        isClosed: false,
        entryTime: null,
        exitTime: null,
        partialExits: [],
        sourceFile: sourceFile || null
      }
      continue
    }
    
    // Parse trade details
    if (isInTrade && currentTrade) {
      // Capture flattening position line to get final exit price
      if (line.includes('Flattening full position:') && line.includes('contracts at')) {
        const priceMatch = line.match(/contracts at\s*([\d.]+)/)
        if (priceMatch) {
          finalExitPrice = parseFloat(priceMatch[1])
        }
      }
      
      // Detect start of partial exit section
      if (line.includes('--- PARTIAL EXIT')) {
        isInPartialExit = true
        isInFinalExit = false
        const contractMatch = line.match(/PARTIAL EXIT \((\d+) contracts?\)/)
        currentPartialExit = {
          contracts: contractMatch ? parseInt(contractMatch[1]) : 0,
          isFinal: false,
          timestamp: lineTimestamp
        }
        continue
      }
      
      // Detect start of final exit section
      if (line.includes('--- FINAL EXIT')) {
        isInPartialExit = false
        isInFinalExit = true
        const contractMatch = line.match(/FINAL EXIT \((\d+) contracts?\)/)
        currentPartialExit = {
          contracts: contractMatch ? parseInt(contractMatch[1]) : 0,
          isFinal: true,
          timestamp: lineTimestamp
        }
        continue
      }
      
      // Parse partial exit details
      if (isInPartialExit && currentPartialExit) {
        if (line.includes('Exit Price:') && line.includes('Entry:')) {
          const exitMatch = line.match(/Exit Price:\s*([\d.]+)/)
          const entryMatch = line.match(/Entry:\s*([\d.]+)/)
          if (exitMatch) currentPartialExit.exitPrice = parseFloat(exitMatch[1])
          if (entryMatch) currentPartialExit.entryPrice = parseFloat(entryMatch[1])
        } else if (line.includes('Reward:') && line.includes('R:R:')) {
          const rewardMatch = line.match(/Reward:\s*([\d.]+)\s*pts/)
          const rrMatch = line.match(/R:R:\s*([\d.]+)R/)
          if (rewardMatch) currentPartialExit.reward = parseFloat(rewardMatch[1])
          if (rrMatch) currentPartialExit.rrRatio = Math.round(parseFloat(rrMatch[1]) * 10) / 10
        } else if (line.includes('Partial P&L:')) {
          const pnlMatch = line.match(/\$([\d.]+)/)
          if (pnlMatch) currentPartialExit.pnl = parseFloat(pnlMatch[1])
        } else if (line.includes('Cumulative P&L:')) {
          const cumMatch = line.match(/\$([\d.]+)/)
          if (cumMatch) currentPartialExit.cumulativePnl = parseFloat(cumMatch[1])
        } else if (line.includes('---')) {
          // End of partial exit section, save it
          if (currentPartialExit.contracts && currentPartialExit.pnl !== undefined) {
            // Calculate pro-rata estimated risk
            const orderQty = currentTrade.orderQty || 1
            const estDollarRisked = currentTrade.estDollarRisked || 0
            currentPartialExit.estRisk = orderQty > 0 
              ? (currentPartialExit.contracts / orderQty) * estDollarRisked
              : null
            
            currentTrade.partialExits = currentTrade.partialExits || []
            currentTrade.partialExits.push(currentPartialExit as PartialExit)
          }
          isInPartialExit = false
          currentPartialExit = null
        }
      }
      
      // Parse final exit details
      if (isInFinalExit && currentPartialExit) {
        if (line.includes('Final Exit P&L:')) {
          const pnlMatch = line.match(/\$([\d.]+)/)
          if (pnlMatch && currentPartialExit.contracts) {
            const finalPnl = parseFloat(pnlMatch[1])
            currentPartialExit.pnl = finalPnl
            
            // Get entry price from first partial exit (since it's parsed before final entry/exit line)
            const firstPartialExit = currentTrade.partialExits?.[0]
            const entryPrice = firstPartialExit?.entryPrice || currentTrade.entryPrice || 0
            const slPoints = currentTrade.slPoints || 1
            const direction = currentTrade.direction?.toLowerCase() || 'long'
            const exitPrice = finalExitPrice || currentTrade.exitPrice || 0
            
            // Calculate reward points from price difference
            let rewardPoints: number
            if (direction === 'short') {
              // Short: profit when price goes down
              rewardPoints = entryPrice - exitPrice
            } else {
              // Long: profit when price goes up
              rewardPoints = exitPrice - entryPrice
            }
            
            // R:R ratio = reward / risk (sl points) - rounded to 1 decimal place
            const rrRatio = slPoints > 0 ? Math.round((rewardPoints / slPoints) * 10) / 10 : 0
            
            currentPartialExit.entryPrice = entryPrice
            currentPartialExit.exitPrice = exitPrice
            currentPartialExit.reward = rewardPoints
            currentPartialExit.rrRatio = rrRatio
            
            // Calculate pro-rata estimated risk
            const orderQty = currentTrade.orderQty || 1
            const estDollarRisked = currentTrade.estDollarRisked || 0
            currentPartialExit.estRisk = orderQty > 0 
              ? (currentPartialExit.contracts / orderQty) * estDollarRisked
              : null
            
            // Calculate cumulative P&L (sum of all previous partial exits + this one)
            const previousPnl = (currentTrade.partialExits || []).reduce((sum, exit) => sum + exit.pnl, 0)
            currentPartialExit.cumulativePnl = previousPnl + finalPnl
            
            currentTrade.partialExits = currentTrade.partialExits || []
            currentTrade.partialExits.push(currentPartialExit as PartialExit)
          }
          isInFinalExit = false
          currentPartialExit = null
        } else if (line.includes('---')) {
          isInFinalExit = false
          currentPartialExit = null
        }
      }
      
      if (line.includes('Trade timestamp:')) {
        const parts = line.split('Trade timestamp:')
        if (parts.length > 1) {
          const rawTimestamp = parts[1].trim()
          // Convert "YYYY-MM-DD HH:MM:SS" to ISO format "YYYY-MM-DDTHH:MM:SS" for consistent parsing
          // Without the 'T', some browsers parse as UTC which shifts dates incorrectly
          currentTrade.timestamp = rawTimestamp.replace(' ', 'T')
          currentTrade.entryTime = rawTimestamp.replace(' ', 'T')
        }
      } else if (line.includes('Direction:')) {
        const parts = line.split('Direction:')
        if (parts.length > 1) {
          currentTrade.direction = parts[1].trim()
        }
      } else if (line.includes('Risk amount:')) {
        const match = line.match(/\$(\d+(?:\.\d+)?)/)
        currentTrade.riskAmount = match ? parseFloat(match[1]) : null
      } else if (line.includes('SL points:')) {
        const parts = line.split('SL points:')
        if (parts.length > 1) {
          currentTrade.slPoints = parseFloat(parts[1].trim())
        }
      } else if (line.includes('TP points:')) {
        const parts = line.split('TP points:')
        if (parts.length > 1) {
          currentTrade.tpPoints = parseFloat(parts[1].trim())
        }
      } else if (line.includes('Order quantity:')) {
        const parts = line.split('Order quantity:')
        if (parts.length > 1) {
          currentTrade.orderQty = parseInt(parts[1].trim())
        }
      } else if (line.includes('Est dollar risked:')) {
        const match = line.match(/\$(\d+(?:\.\d+)?)/)
        currentTrade.estDollarRisked = match ? parseFloat(match[1]) : null
      } else if (line.includes('=== TRADE CLOSED ===')) {
        currentTrade.isClosed = true
      } else if (line.includes('Position fully closed')) {
        currentTrade.isClosed = true
        if (currentTrade.timestamp) {
          trades.push({ ...currentTrade })
          currentTrade = null
          isInTrade = false
        }
      } else if (line.includes('Entry:') && line.includes('|') && line.includes('Exit:') && !isInPartialExit) {
        const parts = line.split('|')
        const entryPart = parts[0].split(':')[1].trim()
        const exitPart = parts[1].split(':')[1].trim()
        currentTrade.entryPrice = parseFloat(entryPart)
        currentTrade.exitPrice = parseFloat(exitPart)
      } else if (line.startsWith('Risk:') && line.includes('Reward:')) {
        const parts = line.split('|')
        const rewardPart = parts[1].match(/(\-?\d+(?:\.\d+)?)\s*pts/)
        currentTrade.reward = rewardPart ? parseFloat(rewardPart[1]) : null
      } else if (line.startsWith('R:R Ratio:')) {
        const match = line.match(/(\-?\d+(?:\.\d+)?)R/)
        currentTrade.rrRatio = match ? Math.round(parseFloat(match[1]) * 10) / 10 : null
      } else if (line.startsWith('P&L:') && !isInPartialExit && !isInFinalExit) {
        const match = line.match(/\$(\-?\d+(?:\.\d+)?)/)
        currentTrade.pnl = match ? parseFloat(match[1]) : null
        
        // Extract exit time from the log line timestamp
        if (lineTimestamp) {
          currentTrade.exitTime = lineTimestamp
        }
        
        if (currentTrade.isClosed) {
          trades.push({ ...currentTrade })
          currentTrade = null
          isInTrade = false
        }
      }
    }
  }
  
  // Save any remaining trade at the end
  if (isInTrade && currentTrade && currentTrade.timestamp) {
    currentTrade.isClosed = true
    trades.push({ ...currentTrade })
  }
  
  trades.forEach(trade => {
    applyDollarsPerR(trade)
    applyPartialExitDollarsPerR(trade)
  })

  return trades
}

export function aggregateByPeriod(trades: Trade[], period: 'daily' | 'weekly' | 'monthly' | 'yearly'): Record<string, Trade[]> {
  const grouped: Record<string, Trade[]> = {}
  
  trades.forEach(trade => {
    if (!trade.isClosed) return
    const closedAt = getTradeCloseAt(trade)
    if (!closedAt) return
    const key = getCloseDatePeriodKey(closedAt, period)
    
    if (!grouped[key]) {
      grouped[key] = []
    }
    grouped[key].push(trade)
  })
  
  return grouped
}

export interface DayWinMetrics {
  winDayPercent: number
  winningDays: number
  losingDays: number
  breakevenDays: number
  winDayRR: number
  avgWinDayPnL: number
  avgLossDayPnL: number
}

const EMPTY_DAY_WIN_METRICS: DayWinMetrics = {
  winDayPercent: 0,
  winningDays: 0,
  losingDays: 0,
  breakevenDays: 0,
  winDayRR: 0,
  avgWinDayPnL: 0,
  avgLossDayPnL: 0,
}

/** Net daily P&L by ET close date, then win/loss day counts and Win Day RR. */
export function computeDayWinMetrics(trades: Trade[]): DayWinMetrics {
  const dailyPnL: Record<string, number> = {}

  for (const trade of trades) {
    if (!trade.isClosed) continue
    const closedAt = getTradeCloseAt(trade)
    if (!closedAt) continue
    const dayKey = formatDateKey(closedAt, DISPLAY_TIMEZONE)
    dailyPnL[dayKey] = (dailyPnL[dayKey] ?? 0) + (trade.pnl ?? 0)
  }

  const dayTotals = Object.values(dailyPnL)
  if (dayTotals.length === 0) return EMPTY_DAY_WIN_METRICS

  let winningDays = 0
  let losingDays = 0
  let breakevenDays = 0
  let sumWinDayPnL = 0
  let sumLossDayPnL = 0

  for (const pnl of dayTotals) {
    if (pnl > 0) {
      winningDays++
      sumWinDayPnL += pnl
    } else if (pnl < 0) {
      losingDays++
      sumLossDayPnL += Math.abs(pnl)
    } else {
      breakevenDays++
    }
  }

  const decisiveDays = winningDays + losingDays
  const winDayPercent =
    decisiveDays > 0 ? (winningDays / decisiveDays) * 100 : 0
  const avgWinDayPnL = winningDays > 0 ? sumWinDayPnL / winningDays : 0
  const avgLossDayPnL = losingDays > 0 ? sumLossDayPnL / losingDays : 0
  const winDayRR =
    avgLossDayPnL > 0
      ? avgWinDayPnL / avgLossDayPnL
      : avgWinDayPnL > 0
        ? Infinity
        : 0

  return {
    winDayPercent,
    winningDays,
    losingDays,
    breakevenDays,
    winDayRR,
    avgWinDayPnL,
    avgLossDayPnL,
  }
}

export function calculateStats(
  trades: Trade[],
  tradeTags?: Record<string, string[]>
): TradeStats {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      avgRR: 0,
      avgWinRR: 0,
      avgLossRR: 0,
      totalPnL: 0,
      bestTrade: null,
      worstTrade: null,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPeakAt: null,
      maxDrawdownTroughAt: null,
      maxDrawdownPeakIndex: null,
      maxDrawdownTroughIndex: null,
      maxDrawdownPeakPnl: null,
      maxDrawdownTroughPnl: null,
      avgRisk: 0,
      totalRisk: 0,
      totalGains: 0,
      totalLosses: 0,
      winDayPercent: 0,
      winningDays: 0,
      losingDays: 0,
      breakevenDays: 0,
      winDayRR: 0,
      avgWinDayPnL: 0,
      avgLossDayPnL: 0,
    }
  }

  const dayWin = computeDayWinMetrics(trades)
  
  const tradesWithRR = trades.filter(t => getTradeRMultiple(t) !== null)
  
  const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
  const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
  const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
  
  const avgWinRR = wins.length > 0 
    ? wins.reduce((sum, t) => sum + (getTradeRMultiple(t) ?? 0), 0) / wins.length 
    : 0
  
  const avgLossRR = losses.length > 0
    ? losses.reduce((sum, t) => sum + (getTradeRMultiple(t) ?? 0), 0) / losses.length
    : 0
  
  // Average R:R excludes BE trades (wins + losses only)
  const decisiveForAvgRR = [...wins, ...losses]
  const avgRR = decisiveForAvgRR.length > 0
    ? decisiveForAvgRR.reduce((sum, t) => sum + (getTradeRMultiple(t) ?? 0), 0) / decisiveForAvgRR.length
    : 0
  
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const totalGains = trades
    .filter(t => (t.pnl ?? 0) > 0)
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const totalLosses = Math.abs(
    trades.filter(t => (t.pnl ?? 0) < 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  )

  // Calculate profit factor
  const grossProfit = wins.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0)
  const grossLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0)
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0)
  
  // Calculate Sharpe Ratio (simplified)
  const returns = tradesWithRR.map(t => t.pnl ?? 0)
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance = returns.length > 0 
    ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length 
    : 0
  const stdDev = Math.sqrt(variance)
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0
  
  const drawdownSeries = computeMaxDrawdownSeries(trades)
  const maxDrawdown = drawdownSeries.maxDrawdown
  const maxDrawdownPeakAt = drawdownSeries.peakAt
  const maxDrawdownTroughAt = drawdownSeries.troughAt
  const maxDrawdownPeakIndex = drawdownSeries.peakIndex
  const maxDrawdownTroughIndex = drawdownSeries.troughIndex
  const maxDrawdownPeakPnl = drawdownSeries.peakPnl
  const maxDrawdownTroughPnl = drawdownSeries.troughPnl
  
  const avgRisk = trades.length > 0 ? DOLLARS_PER_R : 0
  const totalRisk = trades.length * DOLLARS_PER_R
  
  // Best/worst trade: sort by position-adjusted R multiple (accounts for contract size)
  const tradesWithR = trades.filter(t => getPositionAdjustedRMultiple(t) !== null)
  const sortedByR = tradesWithR.length > 0
    ? [...tradesWithR].sort((a, b) => 
        (getPositionAdjustedRMultiple(b) ?? 0) - (getPositionAdjustedRMultiple(a) ?? 0)
      )
    : []
  
  const sortedByRR = sortedByR
  
  // Win rate excludes BE trades (only count decisive wins vs losses)
  const decisiveTrades = wins.length + losses.length
  const winRate = decisiveTrades > 0
    ? (wins.length / decisiveTrades) * 100
    : 0
  
  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: winRate,
    avgRR: avgRR,
    avgWinRR: avgWinRR,
    avgLossRR: avgLossRR,
    totalPnL: totalPnL,
    bestTrade: sortedByRR[0] || null,
    worstTrade: sortedByRR[sortedByRR.length - 1] || null,
    profitFactor: profitFactor,
    sharpeRatio: sharpeRatio,
    maxDrawdown: maxDrawdown,
    maxDrawdownPeakAt,
    maxDrawdownTroughAt,
    maxDrawdownPeakIndex,
    maxDrawdownTroughIndex,
    maxDrawdownPeakPnl,
    maxDrawdownTroughPnl,
    avgRisk: avgRisk,
    totalRisk: totalRisk,
    totalGains,
    totalLosses,
    winDayPercent: dayWin.winDayPercent,
    winningDays: dayWin.winningDays,
    losingDays: dayWin.losingDays,
    breakevenDays: dayWin.breakevenDays,
    winDayRR: dayWin.winDayRR,
    avgWinDayPnL: dayWin.avgWinDayPnL,
    avgLossDayPnL: dayWin.avgLossDayPnL,
  }
}

export function calculateStreaks(
  trades: Trade[],
  tradeTags?: Record<string, string[]>
): Streaks {
  if (!trades || trades.length === 0) {
    return {
      currentStreak: 0,
      currentStreakType: null,
      longestWinStreak: 0,
      longestLossStreak: 0
    }
  }
  
  const tradesWithRR = trades.filter(t => getTradeRMultiple(t) !== null)
  
  if (tradesWithRR.length === 0) {
    return {
      currentStreak: 0,
      currentStreakType: null,
      longestWinStreak: 0,
      longestLossStreak: 0
    }
  }
  
  let currentStreak = 0
  let currentStreakType: 'win' | 'loss' | null = null
  let longestWinStreak = 0
  let longestLossStreak = 0
  let tempWinStreak = 0
  let tempLossStreak = 0
  
  const sortedTrades = [...tradesWithRR].sort((a, b) => 
    (a.timestamp ? parseLocalTimestamp(a.timestamp).getTime() : 0) - 
    (b.timestamp ? parseLocalTimestamp(b.timestamp).getTime() : 0)
  )
  
  sortedTrades.forEach((trade, index) => {
    const result = getTradeResult(trade, tradeTags)

    if (result === 'WIN') {
      tempWinStreak++
      tempLossStreak = 0
      longestWinStreak = Math.max(longestWinStreak, tempWinStreak)
    } else if (result === 'LOSS') {
      tempLossStreak++
      tempWinStreak = 0
      longestLossStreak = Math.max(longestLossStreak, tempLossStreak)
    }
    // BE trades (not Random) are ignored for streak calculation
    
    if (index === sortedTrades.length - 1) {
      if (tempWinStreak > 0) {
        currentStreak = tempWinStreak
        currentStreakType = 'win'
      } else if (tempLossStreak > 0) {
        currentStreak = tempLossStreak
        currentStreakType = 'loss'
      }
    }
  })
  
  return {
    currentStreak,
    currentStreakType,
    longestWinStreak,
    longestLossStreak
  }
}

// Parse stored timestamps as US Eastern wall-clock (Sierra Chart / converted MT5 reports).
export function parseLocalTimestamp(timestamp: string): Date {
  const cleaned = timestamp.replace(/[,\.]\d+.*$/, '').trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(cleaned)) {
    return new Date(cleaned)
  }

  const normalized = cleaned.includes('T') ? cleaned.replace('T', ' ') : cleaned
  if (!normalized) return new Date(timestamp)

  return fromZonedTime(normalized, DISPLAY_TIMEZONE)
}

/** Sort key: entry time when present, otherwise trade timestamp (NYC wall-clock). */
export function getTradeEntryTimeMs(trade: Trade): number {
  const raw = trade.entryTime ?? trade.timestamp
  if (!raw) return 0
  return parseLocalTimestamp(raw).getTime()
}

/** When P&L is realized (exit/close); falls back to timestamp for legacy imports. */
export function getTradeCloseTimeMs(trade: Trade): number {
  const raw = trade.exitTime ?? trade.timestamp
  if (!raw) return 0
  return parseLocalTimestamp(raw).getTime()
}

export function getTradeCloseAt(trade: Trade): Date | null {
  const raw = trade.exitTime ?? trade.timestamp
  if (!raw) return null
  return parseLocalTimestamp(raw)
}

/** Closed trades in exit-time order (stable tie-break). */
export function sortTradesForEquityCurve(trades: Trade[]): Trade[] {
  return [...trades].filter(t => t.isClosed && (t.exitTime || t.timestamp)).sort((a, b) => {
    const byClose = getTradeCloseTimeMs(a) - getTradeCloseTimeMs(b)
    if (byClose !== 0) return byClose
    const byEntry = getTradeEntryTimeMs(a) - getTradeEntryTimeMs(b)
    if (byEntry !== 0) return byEntry
    return getTradeDedupKey(a).localeCompare(getTradeDedupKey(b))
  })
}

export interface EquityCurvePoint {
  index: number
  seriesPosition: number
  pnl: number
  closedAt: Date | null
}

export interface MaxDrawdownSeriesResult {
  points: EquityCurvePoint[]
  maxDrawdown: number
  peakAt: Date | null
  troughAt: Date | null
  peakIndex: number | null
  troughIndex: number | null
  peakPnl: number | null
  troughPnl: number | null
  peakSeriesPosition: number | null
  troughSeriesPosition: number | null
}

export interface DailyEquityCurvePoint {
  index: number
  cumulative: number
  tradePnl: number
  label: string
  tradeId?: string
}

/** Session-day trailing P&L by close order (starts at $0 before first trade). */
export function buildDailyEquityCurve(trades: Trade[]): DailyEquityCurvePoint[] {
  const sorted = [...trades]
    .filter(t => t.exitTime || t.timestamp)
    .sort((a, b) => {
      const byClose = getTradeCloseTimeMs(a) - getTradeCloseTimeMs(b)
      if (byClose !== 0) return byClose
      const byEntry = getTradeEntryTimeMs(a) - getTradeEntryTimeMs(b)
      if (byEntry !== 0) return byEntry
      return getTradeDedupKey(a).localeCompare(getTradeDedupKey(b))
    })
  let cumulative = 0
  const points: DailyEquityCurvePoint[] = [
    { index: 0, cumulative: 0, tradePnl: 0, label: 'Start' },
  ]
  sorted.forEach((trade, i) => {
    const tradePnl = trade.pnl ?? 0
    cumulative += tradePnl
    points.push({
      index: i + 1,
      cumulative,
      tradePnl,
      label: trade.exitTime ?? trade.entryTime ?? trade.timestamp ?? `Trade ${i + 1}`,
      tradeId: getTradeId(trade),
    })
  })
  return points
}

/** Minimum peak-to-trough decline (USD) shown on the equity curve. */
export const SIGNIFICANT_DRAWDOWN_MIN = 1000

export interface DrawdownEpisode {
  amount: number
  peakIndex: number
  troughIndex: number
  peakPnl: number
  troughPnl: number
  peakSeriesPosition: number
  troughSeriesPosition: number
  peakAt: Date | null
  troughAt: Date | null
  /** First trade after the peak where equity turns down (ET) — matches visible slump start on chart. */
  declineStartAt?: Date | null
  declineStartIndex?: number
}

/** Stable id for linking equity-curve drawdown rows to recap sections. */
export function getDrawdownEpisodeKey(ep: DrawdownEpisode): string {
  return `${ep.peakIndex}-${ep.troughIndex}-${ep.amount}`
}

export function drawdownRecapSectionId(key: string): string {
  return `drawdown-recap-${key}`
}

export function equityDrawdownLinkId(key: string): string {
  return `equity-drawdown-link-${key}`
}

const EMPTY_DRAWDOWN_SERIES: MaxDrawdownSeriesResult = {
  points: [],
  maxDrawdown: 0,
  peakAt: null,
  troughAt: null,
  peakIndex: null,
  troughIndex: null,
  peakPnl: null,
  troughPnl: null,
  peakSeriesPosition: null,
  troughSeriesPosition: null,
}

/** Single source of truth for equity curve ordering and max drawdown peak/trough. */
export function computeMaxDrawdownSeries(trades: Trade[]): MaxDrawdownSeriesResult {
  if (!trades.length) return EMPTY_DRAWDOWN_SERIES

  const sortedTrades = sortTradesForEquityCurve(trades)
  const periodStartAt = getTradeCloseAt(sortedTrades[0])

  let peak = 0
  let maxDrawdown = 0
  let peakAt: Date | null = null
  let troughAt: Date | null = null
  let peakIndex: number | null = null
  let troughIndex: number | null = null
  let peakPnl: number | null = null
  let troughPnl: number | null = null
  let peakSeriesPosition: number | null = null
  let troughSeriesPosition: number | null = null
  let runningPeakAt: Date | null = null
  let runningPeakIndex = 1
  let runningPeakSeriesPosition = 0
  let cumulative = 0

  const points: EquityCurvePoint[] = []

  sortedTrades.forEach((trade, arrayIndex) => {
    const tradeIndex = arrayIndex + 1
    const tradeAt = getTradeCloseAt(trade) ?? periodStartAt
    cumulative += trade.pnl ?? 0

    if (cumulative > peak) {
      peak = cumulative
      runningPeakAt = tradeAt
      runningPeakIndex = tradeIndex
      runningPeakSeriesPosition = arrayIndex
    }

    const drawdown = peak - cumulative
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      peakAt = runningPeakAt ?? periodStartAt ?? tradeAt
      troughAt = tradeAt
      peakIndex = runningPeakIndex
      troughIndex = tradeIndex
      peakPnl = peak
      troughPnl = cumulative
      peakSeriesPosition = runningPeakSeriesPosition
      troughSeriesPosition = arrayIndex
    }

    points.push({
      index: tradeIndex,
      seriesPosition: arrayIndex,
      pnl: cumulative,
      closedAt: tradeAt,
    })
  })

  return {
    points,
    maxDrawdown,
    peakAt,
    troughAt,
    peakIndex,
    troughIndex,
    peakPnl,
    troughPnl,
    peakSeriesPosition,
    troughSeriesPosition,
  }
}

/**
 * Every local high on the equity curve to the deepest trough before that high is reclaimed,
 * with decline >= minAmount (USD). Includes nested drawdowns inside a larger slump.
 */
export function computeDrawdownEpisodes(
  points: EquityCurvePoint[],
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode[] {
  const n = points.length
  if (!n || minAmount <= 0) return []

  const episodes: DrawdownEpisode[] = []
  const seen = new Set<string>()

  for (let i = 0; i < n; i++) {
    const peakPnl = points[i].pnl
    const nextPnl = i + 1 < n ? points[i + 1].pnl : null
    // Local high: equity stops climbing (next point is lower) or series ends on this level.
    if (nextPnl !== null && nextPnl >= peakPnl) continue

    let peakPosEnd = i
    while (peakPosEnd + 1 < n && points[peakPosEnd + 1].pnl === peakPnl) {
      peakPosEnd++
    }
    i = peakPosEnd

    let troughPos = peakPosEnd
    let troughPnl = peakPnl

    for (let j = peakPosEnd + 1; j < n; j++) {
      const pnl = points[j].pnl
      if (pnl >= peakPnl) break
      if (pnl < troughPnl) {
        troughPnl = pnl
        troughPos = j
      }
    }

    const amount = peakPnl - troughPnl
    if (amount < minAmount || troughPos <= peakPosEnd) continue

    const key = `${peakPosEnd}-${troughPos}-${amount}`
    if (seen.has(key)) continue
    seen.add(key)

    const declineStartPos = peakPosEnd + 1
    const declineStartPoint =
      declineStartPos <= troughPos ? points[declineStartPos] : points[peakPosEnd]

    episodes.push({
      amount,
      peakIndex: points[peakPosEnd].index,
      troughIndex: points[troughPos].index,
      peakPnl,
      troughPnl,
      peakSeriesPosition: peakPosEnd,
      troughSeriesPosition: troughPos,
      peakAt: points[peakPosEnd].closedAt,
      troughAt: points[troughPos].closedAt,
      declineStartAt: declineStartPoint?.closedAt ?? points[peakPosEnd].closedAt,
      declineStartIndex: declineStartPoint?.index ?? points[peakPosEnd].index,
    })
  }

  return episodes.sort((a, b) => b.amount - a.amount)
}

export function drawdownEpisodeIndexRange(ep: DrawdownEpisode): { start: number; end: number } {
  return {
    start: Math.min(ep.peakIndex, ep.troughIndex),
    end: Math.max(ep.peakIndex, ep.troughIndex),
  }
}

/** Closed trades from equity peak through trough (exit-time order, inclusive). */
export function getTradesInDrawdownEpisode(trades: Trade[], episode: DrawdownEpisode): Trade[] {
  const sorted = sortTradesForEquityCurve(trades)
  const { start, end } = drawdownEpisodeIndexRange(episode)
  return sorted.slice(start - 1, end)
}

export function formatDrawdownEpisodePeriod(
  peakAt: Date | null,
  troughAt: Date | null
): string | null {
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

function drawdownEpisodesOverlap(a: DrawdownEpisode, b: DrawdownEpisode): boolean {
  const ra = drawdownEpisodeIndexRange(a)
  const rb = drawdownEpisodeIndexRange(b)
  return ra.start <= rb.end && ra.end >= rb.start
}

/**
 * When drawdown periods overlap on the equity curve, keep only the largest $ decline.
 * Processes highest amount first so nested/smaller overlapping zones are dropped.
 */
export function filterOverlappingDrawdownEpisodes(
  episodes: DrawdownEpisode[]
): DrawdownEpisode[] {
  if (!episodes.length) return []

  const sorted = [...episodes].sort((a, b) => b.amount - a.amount)
  const kept: DrawdownEpisode[] = []

  for (const ep of sorted) {
    const overlapsKept = kept.some(k => drawdownEpisodesOverlap(ep, k))
    if (!overlapsKept) kept.push(ep)
  }

  return kept.sort((a, b) => b.amount - a.amount)
}

/** Single-day (EOD) drops on the daily equity curve — catches slumps that start on a calendar day. */
export function computeConsecutiveDailyDropEpisodes(
  points: EquityCurvePoint[],
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode[] {
  const daily = collapseEquityPointsToDaily(points)
  if (daily.length < 2 || minAmount <= 0) return []

  const episodes: DrawdownEpisode[] = []
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1]
    const curr = daily[i]
    const amount = prev.pnl - curr.pnl
    if (amount < minAmount) continue

    episodes.push({
      amount,
      peakIndex: prev.index,
      troughIndex: curr.index,
      peakPnl: prev.pnl,
      troughPnl: curr.pnl,
      peakSeriesPosition: prev.seriesPosition,
      troughSeriesPosition: curr.seriesPosition,
      peakAt: prev.closedAt,
      troughAt: curr.closedAt,
      declineStartAt: curr.closedAt,
      declineStartIndex: curr.index,
    })
  }
  return episodes
}

export type DrawdownPeriodGrouping = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Period key for a trade close date (ET daily; week/month/year aligned with aggregateByPeriod). */
function getEtYmd(date: Date): { year: number; month: number; day: number } {
  return {
    year: Number(formatInTimeZone(date, DISPLAY_TIMEZONE, 'yyyy')),
    month: Number(formatInTimeZone(date, DISPLAY_TIMEZONE, 'MM')),
    day: Number(formatInTimeZone(date, DISPLAY_TIMEZONE, 'dd')),
  }
}

function getIsoWeekNumber(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export function getCloseDatePeriodKey(
  date: Date,
  period: DrawdownPeriodGrouping
): string {
  if (period === 'daily') {
    return formatDateKey(date, DISPLAY_TIMEZONE)
  }
  const { year, month, day } = getEtYmd(date)
  if (period === 'weekly') {
    const weekNum = getIsoWeekNumber(year, month, day)
    return `${year}-W${String(weekNum).padStart(2, '0')}`
  }
  if (period === 'monthly') {
    return `${year}-${String(month).padStart(2, '0')}`
  }
  return `${year}`
}

/** Last equity point per ET day (for calendar drawdowns missed at trade granularity). */
export function collapseEquityPointsToDaily(
  points: EquityCurvePoint[]
): EquityCurvePoint[] {
  const byDay = new Map<string, EquityCurvePoint>()
  for (const point of points) {
    if (!point.closedAt) continue
    const dayKey = formatDateKey(point.closedAt, DISPLAY_TIMEZONE)
    const existing = byDay.get(dayKey)
    if (!existing || point.index > existing.index) {
      byDay.set(dayKey, point)
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
}

export function dedupeDrawdownEpisodes(episodes: DrawdownEpisode[]): DrawdownEpisode[] {
  const byKey = new Map<string, DrawdownEpisode>()
  for (const ep of episodes) {
    const key = `${ep.peakIndex}-${ep.troughIndex}`
    const existing = byKey.get(key)
    if (!existing || ep.amount > existing.amount) {
      byKey.set(key, ep)
    }
  }
  return [...byKey.values()]
}

/** Max peak-to-trough decline while both peak and trough close inside the same period. */
export function computeContainedPeriodDrawdownEpisodes(
  points: EquityCurvePoint[],
  period: DrawdownPeriodGrouping,
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode[] {
  if (!points.length || minAmount <= 0) return []

  const periodKeys = new Set<string>()
  for (const point of points) {
    if (point.closedAt) {
      periodKeys.add(getCloseDatePeriodKey(point.closedAt, period))
    }
  }

  const episodes: DrawdownEpisode[] = []

  for (const periodKey of periodKeys) {
    const inPeriod = points.filter(
      p =>
        p.closedAt && getCloseDatePeriodKey(p.closedAt, period) === periodKey
    )
    if (!inPeriod.length) continue

    let peakPnl = inPeriod[0].pnl
    let peakPos = inPeriod[0].seriesPosition
    let maxDd = 0
    let bestPeakPos = peakPos
    let bestTroughPos = peakPos
    let bestTroughPnl = peakPnl

    for (const point of inPeriod) {
      if (point.pnl >= peakPnl) {
        peakPnl = point.pnl
        peakPos = point.seriesPosition
      }
      const dd = peakPnl - point.pnl
      if (dd > maxDd) {
        maxDd = dd
        bestPeakPos = peakPos
        bestTroughPos = point.seriesPosition
        bestTroughPnl = point.pnl
      }
    }

    if (maxDd < minAmount) continue

    const peakPoint = points[bestPeakPos]
    const troughPoint = points[bestTroughPos]
    if (!peakPoint || !troughPoint) continue

    episodes.push({
      amount: maxDd,
      peakIndex: peakPoint.index,
      troughIndex: troughPoint.index,
      peakPnl,
      troughPnl: bestTroughPnl,
      peakSeriesPosition: bestPeakPos,
      troughSeriesPosition: bestTroughPos,
      peakAt: peakPoint.closedAt,
      troughAt: troughPoint.closedAt,
    })
  }

  return dedupeDrawdownEpisodes(episodes)
}

/** All detected slumps (trade, daily local-peak, and large single-day EOD drops). */
export function collectDrawdownEpisodeCandidates(
  points: EquityCurvePoint[],
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode[] {
  if (!points.length || minAmount <= 0) return []
  return dedupeDrawdownEpisodes([
    ...computeDrawdownEpisodes(points, minAmount),
    ...computeDrawdownEpisodes(collapseEquityPointsToDaily(points), minAmount),
    ...computeConsecutiveDailyDropEpisodes(points, minAmount),
  ])
}

/** Overview-aligned max drawdown as a chart episode (may span multiple weeks). */
export function maxDrawdownSeriesToEpisode(
  series: MaxDrawdownSeriesResult,
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode | null {
  if (
    series.maxDrawdown < minAmount ||
    series.peakIndex == null ||
    series.troughIndex == null ||
    series.peakSeriesPosition == null ||
    series.troughSeriesPosition == null
  ) {
    return null
  }

  const peakPoint = series.points[series.peakSeriesPosition]
  const troughPoint = series.points[series.troughSeriesPosition]

  return {
    amount: series.maxDrawdown,
    peakIndex: series.peakIndex,
    troughIndex: series.troughIndex,
    peakPnl: series.peakPnl ?? peakPoint?.pnl ?? 0,
    troughPnl: series.troughPnl ?? troughPoint?.pnl ?? 0,
    peakSeriesPosition: series.peakSeriesPosition,
    troughSeriesPosition: series.troughSeriesPosition,
    peakAt: series.peakAt ?? peakPoint?.closedAt ?? null,
    troughAt: series.troughAt ?? troughPoint?.closedAt ?? null,
  }
}

export function getEpisodeDeclineStartAt(
  ep: DrawdownEpisode,
  points: EquityCurvePoint[]
): Date | null {
  if (ep.declineStartAt) return ep.declineStartAt
  const startPos = ep.peakSeriesPosition + 1
  if (startPos > ep.troughSeriesPosition) return ep.peakAt
  return points[startPos]?.closedAt ?? ep.peakAt
}

/** Period bucket for grouping: when the slump starts (first down trade after peak), else peak close. */
export function getEpisodePeriodBucketAt(
  ep: DrawdownEpisode,
  points: EquityCurvePoint[]
): Date | null {
  return getEpisodeDeclineStartAt(ep, points) ?? ep.peakAt
}

/**
 * Largest drawdown per period (by slump start date in ET) plus overall max (Overview).
 */
export function buildDisplayedDrawdownEpisodes(
  series: MaxDrawdownSeriesResult,
  points: EquityCurvePoint[],
  period: DrawdownPeriodGrouping,
  minAmount: number = SIGNIFICANT_DRAWDOWN_MIN
): DrawdownEpisode[] {
  const candidates = collectDrawdownEpisodeCandidates(points, minAmount)
  const periodKeys = new Set<string>()
  for (const point of points) {
    if (point.closedAt) {
      periodKeys.add(getCloseDatePeriodKey(point.closedAt, period))
    }
  }

  const winners = new Map<string, DrawdownEpisode>()
  for (const periodKey of periodKeys) {
    const inPeriod = candidates.filter(ep => {
      if (ep.amount < minAmount) return false
      const bucket = getEpisodePeriodBucketAt(ep, points)
      if (!bucket) return false
      return getCloseDatePeriodKey(bucket, period) === periodKey
    })
    if (!inPeriod.length) continue
    const best = inPeriod.reduce((a, b) => (b.amount > a.amount ? b : a))
    winners.set(periodKey, best)
  }

  const maxEpisode = maxDrawdownSeriesToEpisode(series, minAmount)
  return dedupeDrawdownEpisodes([
    ...winners.values(),
    ...(maxEpisode ? [maxEpisode] : []),
  ]).sort((a, b) => b.amount - a.amount)
}

// Helper function to get ISO week number (local calendar parts; prefer getIsoWeekNumber + ET)
function getWeekNumber(date: Date): number {
  const { year, month, day } = getEtYmd(date)
  return getIsoWeekNumber(year, month, day)
}

// Parse TradesList.txt (Sierra Chart export format - TSV)
// This handles the tab-separated export from Sierra Chart
export function parseTradesList(fileContent: string, sourceFile?: string): Trade[] {
  const trades: Trade[] = []
  const lines = fileContent.split('\n')
  
  if (lines.length < 2) return trades
  
  // Parse header to get column indices
  const headerLine = lines[0].trim()
  const headers = headerLine.split('\t')
  
  // Map column names to indices
  const columnMap: Record<string, number> = {}
  headers.forEach((header, index) => {
    columnMap[header.trim()] = index
  })
  
  // Required columns
  const symbolCol = columnMap['Symbol']
  const tradeTypeCol = columnMap['Trade Type']
  const entryDateTimeCol = columnMap['Entry DateTime']
  const exitDateTimeCol = columnMap['Exit DateTime']
  const entryPriceCol = columnMap['Entry Price']
  const exitPriceCol = columnMap['Exit Price']
  const tradeQtyCol = columnMap['Trade Quantity']
  const flatToFlatPnlCol = columnMap['FlatToFlat Profit/Loss (C)']
  const maxOpenQtyCol = columnMap['Max Open Quantity']
  const commissionCol = columnMap['Commission (C)']
  
  // Process each trade line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    
    const columns = line.split('\t')
    if (columns.length < headers.length) continue
    
    // Parse FlatToFlat Profit/Loss to check if this is a complete trade (has " F" suffix)
    const flatToFlatPnl = columns[flatToFlatPnlCol]?.trim() || ''
    const isCompleteTrade = flatToFlatPnl.endsWith(' F')
    
    // Skip partial fills - only process complete trades (ending with " F")
    if (!isCompleteTrade) continue
    
    // Parse entry datetime - format: "YYYY-MM-DD  HH:MM:SS.mmm BP" or "YYYY-MM-DD  HH:MM:SS.mmm EP"
    const entryDateTimeRaw = columns[entryDateTimeCol]?.trim() || ''
    const exitDateTimeRaw = columns[exitDateTimeCol]?.trim() || ''
    
    // Clean up datetime strings (remove BP/EP markers and extra spaces)
    const entryDateTime = entryDateTimeRaw
      .replace(/\s+BP$/, '')
      .replace(/\s+EP$/, '')
      .replace(/\s+/, ' ')
      .trim()
    const exitDateTime = exitDateTimeRaw
      .replace(/\s+BP$/, '')
      .replace(/\s+EP$/, '')
      .replace(/\s+/, ' ')
      .trim()
    
    // Convert to ISO format for consistent parsing
    const timestamp = entryDateTime.replace(' ', 'T').replace(/\.\d+$/, '')
    const exitTime = exitDateTime.replace(' ', 'T').replace(/\.\d+$/, '')
    
    // Parse trade type
    const tradeType = columns[tradeTypeCol]?.trim().toLowerCase() || ''
    const direction = tradeType === 'short' ? 'short' : 'long'
    
    // Parse prices
    const entryPrice = parseFloat(columns[entryPriceCol]?.trim() || '0')
    const exitPrice = parseFloat(columns[exitPriceCol]?.trim() || '0')
    
    // Parse quantity - use Max Open Quantity for actual position size (Trade Quantity is per-fill for scaled trades)
    const tradeQty = parseInt(columns[tradeQtyCol]?.trim() || '1')
    const maxOpenQty = maxOpenQtyCol !== undefined ? parseInt(columns[maxOpenQtyCol]?.trim() || '1') : tradeQty
    const orderQty = maxOpenQty > 0 ? maxOpenQty : tradeQty
    
    // Parse P&L (remove " F" suffix if present and parse)
    const pnlStr = flatToFlatPnl.replace(' F', '').trim()
    const pnl = parseFloat(pnlStr) || 0
    
    // Parse symbol and commission (commission col may be missing in some exports)
    const symbol = symbolCol !== undefined ? (columns[symbolCol]?.trim() || '') : ''
    const commission = commissionCol !== undefined ? (parseFloat(columns[commissionCol]?.trim() || '0') || 0) : 0
    
    // Calculate reward points (price movement)
    let rewardPoints: number
    if (direction === 'short') {
      rewardPoints = entryPrice - exitPrice
    } else {
      rewardPoints = exitPrice - entryPrice
    }
    
    const trade: Trade = {
      timestamp,
      direction,
      riskAmount: null,
      estDollarRisked: null,
      slPoints: null, // Not available in TradesList format
      tpPoints: null, // Not available in TradesList format
      orderQty,
      entryPrice,
      exitPrice,
      reward: rewardPoints,
      rrRatio: null,
      pnl,
      isClosed: true,
      entryTime: timestamp,
      exitTime: exitTime,
      partialExits: [],
      sourceFile: sourceFile || null,
      symbol: symbol || null,
      commission: commission || null
    }

    applyDollarsPerR(trade)
    trades.push(trade)
  }
  
  return trades
}

// Auto-detect file format and parse accordingly
export function parseTradeFile(fileContent: string, sourceFile?: string): Trade[] {
  // Check if it's a TradesList format (TSV with specific headers)
  const firstLine = fileContent.split('\n')[0] || ''
  
  if (firstLine.includes('Symbol\t') && 
      firstLine.includes('Trade Type') && 
      firstLine.includes('Entry DateTime')) {
    // TradesList.txt format (Sierra Chart TSV export)
    console.log('Detected TradesList.txt format (Sierra Chart TSV)')
    return parseTradesList(fileContent, sourceFile)
  } else if (firstLine.includes('=== NEW TRADE ===') || 
             fileContent.includes('=== NEW TRADE ===')) {
    // Original trade_logs.txt format
    console.log('Detected trade_logs.txt format')
    return parseTradeLogs(fileContent, sourceFile)
  } else {
    // Default to trying TradesList format for TSV-like files
    if (firstLine.includes('\t')) {
      console.log('Attempting TradesList.txt format (TSV detected)')
      return parseTradesList(fileContent, sourceFile)
    }
    // Otherwise try original format
    console.log('Attempting trade_logs.txt format')
    return parseTradeLogs(fileContent, sourceFile)
  }
}