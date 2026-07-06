'use client'

import React, { useMemo, useState } from 'react'
import { addDays, differenceInCalendarDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import {
  Trade,
  aggregateByPeriod,
  calculateStats,
  getCloseDatePeriodKey,
} from '@/utils/logParser'
import { formatDateKey, dateKeyToLabel } from '@/utils/tradingDays'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatUsdPnl } from '@/lib/format'
import HeatmapYearSelect from '@/components/HeatmapYearSelect'

type HeatmapMode = 'daily' | 'weekly'

interface HeatmapCell {
  id: string
  label: string
  totalPnL: number
  tradeCount: number
  wins: number
  losses: number
  winRate: number
  outcome: 'empty' | 'be' | 'win' | 'loss'
  colorIndex: number | null
  month: number
  isFirstOfMonth: boolean
  row: number
  col: number
}

interface MonthSpan {
  label: string
  startCol: number
  colSpan: number
}

interface TradingDayHeatmapProps {
  trades: Trade[]
  darkMode: boolean
  tradeTags?: Record<string, string[]>
  calendarYear: number
  availableYears: number[]
  autoFollowCurrentYear: boolean
  onCalendarYearChange: (year: number) => void
  onAutoFollowCurrentYearChange: (auto: boolean) => void
  hoveredDayKey: string | null
  onHoverDayKey: (dayKey: string | null) => void
  onDayClick?: (dayKey: string) => void
  onWeekClick?: (weekKey: string) => void
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const GRID_GAP_CLASS = 'gap-[2px]'

/** GitHub contribution-style palette with 4 win greens and 4 loss reds. */
const GITHUB_PNL = {
  light: {
    empty: '#ebedf0',
    emptyHover: '#d8dee4',
    border: '#d0d7de',
    win: ['#9be9a8', '#40c463', '#30a14e', '#216e39'],
    loss: ['#ffebe9', '#ff8182', '#fa4549', '#cf222e'],
  },
  dark: {
    empty: '#161b22',
    emptyHover: '#21262d',
    border: '#30363d',
    win: ['#0e4429', '#006d32', '#26a641', '#39d353'],
    loss: ['#3d1215', '#671f26', '#da3633', '#ff7b72'],
  },
} as const

const WIN_LABELS = ['$250–$1k', '$1k–$1.4k', '$1.4k–$1.8k', '≥ $1.8k']
const LOSS_LABELS = ['-$250–-$1k', '-$1k–-$1.4k', '-$1.4k–-$1.8k', '≤ -$1.8k']

/** Fixed P&L bands — no color between -$250 and +$250. */
const PNL_NEUTRAL_MIN = -250
const PNL_NEUTRAL_MAX = 250
const PNL_TIER_1_MAX = 1000
const PNL_TIER_2_MAX = 1400
const PNL_TIER_3_MAX = 1800

function pnlPalette(darkMode: boolean) {
  return darkMode ? GITHUB_PNL.dark : GITHUB_PNL.light
}

function brightestWinColor(darkMode: boolean) {
  return pnlPalette(darkMode).win[3]
}

function brightestLossColor(darkMode: boolean) {
  return pnlPalette(darkMode).loss[3]
}


function yearBounds(year: number): { start: Date; end: Date; startKey: string; endKey: string } {
  const start = fromZonedTime(`${year}-01-01 12:00:00`, DISPLAY_TIMEZONE)
  const end = fromZonedTime(`${year}-12-31 12:00:00`, DISPLAY_TIMEZONE)
  return {
    start,
    end,
    startKey: formatDateKey(start, DISPLAY_TIMEZONE),
    endKey: formatDateKey(end, DISPLAY_TIMEZONE),
  }
}

function startOfWeekSunday(date: Date): Date {
  const iso = parseInt(formatInTimeZone(date, DISPLAY_TIMEZONE, 'i'), 10)
  return addDays(date, iso === 7 ? 0 : -iso)
}

function endOfWeekSaturday(date: Date): Date {
  const iso = parseInt(formatInTimeZone(date, DISPLAY_TIMEZONE, 'i'), 10)
  if (iso === 6) return date
  if (iso === 7) return addDays(date, 6)
  return addDays(date, 6 - iso)
}

function monFriRowIndex(date: Date): number | null {
  const iso = parseInt(formatInTimeZone(date, DISPLAY_TIMEZONE, 'i'), 10)
  if (iso >= 1 && iso <= 5) return iso - 1
  return null
}

function buildCalendarYearWeekKeys(year: number): { weekKey: string; month: number }[] {
  const { start, end } = yearBounds(year)
  const seen = new Set<string>()
  const keys: { weekKey: string; month: number }[] = []
  let cursor = start
  while (cursor <= end) {
    const wk = getCloseDatePeriodKey(cursor, 'weekly')
    if (!seen.has(wk)) {
      seen.add(wk)
      keys.push({
        weekKey: wk,
        month: Number(formatDateKey(cursor, DISPLAY_TIMEZONE).slice(5, 7)),
      })
    }
    cursor = addDays(cursor, 1)
  }
  return keys
}

function formatWeekLabel(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/)
  if (!match) return weekKey
  return `Week ${parseInt(match[2], 10)}, ${match[1]}`
}

/** Days with more than this many trades get dim highlight even inside ±$250. */
const HIGH_ACTIVITY_TRADE_THRESHOLD = 3

function pnlToColorIndex(pnl: number, tradeCount: number): number | null {
  if (tradeCount <= 0) return null

  const inNeutralBand = pnl >= PNL_NEUTRAL_MIN && pnl <= PNL_NEUTRAL_MAX
  if (inNeutralBand) {
    if (tradeCount > HIGH_ACTIVITY_TRADE_THRESHOLD && pnl !== 0) {
      return 0
    }
    return null
  }

  if (pnl > PNL_NEUTRAL_MAX) {
    if (pnl <= PNL_TIER_1_MAX) return 0
    if (pnl <= PNL_TIER_2_MAX) return 1
    if (pnl < PNL_TIER_3_MAX) return 2
    return 3
  }

  if (pnl >= -PNL_TIER_1_MAX) return 0
  if (pnl >= -PNL_TIER_2_MAX) return 1
  if (pnl > -PNL_TIER_3_MAX) return 2
  return 3
}

function buildCell(
  id: string,
  label: string,
  periodTrades: Trade[],
  tradeTags?: Record<string, string[]>
): Omit<HeatmapCell, 'colorIndex' | 'month' | 'isFirstOfMonth' | 'row' | 'col'> {
  if (periodTrades.length === 0) {
    return {
      id,
      label,
      totalPnL: 0,
      tradeCount: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      outcome: 'empty',
    }
  }

  const stats = calculateStats(periodTrades, tradeTags)
  let outcome: HeatmapCell['outcome'] = 'be'
  if (stats.totalPnL > 0) outcome = 'win'
  else if (stats.totalPnL < 0) outcome = 'loss'

  return {
    id,
    label,
    totalPnL: stats.totalPnL,
    tradeCount: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    outcome,
  }
}

function assignColorIndices<T extends { totalPnL: number; tradeCount: number }>(
  cells: T[]
): (T & { colorIndex: number | null })[] {
  return cells.map(cell => ({
    ...cell,
    colorIndex: pnlToColorIndex(cell.totalPnL, cell.tradeCount),
  }))
}

function detailPnlColor(outcome: HeatmapCell['outcome'], darkMode: boolean): string | undefined {
  if (outcome === 'win') return brightestWinColor(darkMode)
  if (outcome === 'loss') return brightestLossColor(darkMode)
  return undefined
}

function isHighActivityNeutralHighlight(
  pnl: number,
  tradeCount: number,
  colorIndex: number | null
): boolean {
  return (
    colorIndex === 0 &&
    tradeCount > HIGH_ACTIVITY_TRADE_THRESHOLD &&
    pnl >= PNL_NEUTRAL_MIN &&
    pnl <= PNL_NEUTRAL_MAX &&
    pnl !== 0
  )
}

function colorIndexLabel(
  outcome: HeatmapCell['outcome'],
  index: number | null,
  pnl: number,
  tradeCount: number
): string | null {
  if (index == null) {
    if (outcome === 'empty') return null
    return 'Within ±$250'
  }
  if (isHighActivityNeutralHighlight(pnl, tradeCount, index)) {
    return 'High activity · within ±$250'
  }
  if (outcome === 'win') return WIN_LABELS[index] ?? null
  if (outcome === 'loss') return LOSS_LABELS[index] ?? null
  return null
}

function getTileStyle(
  outcome: HeatmapCell['outcome'] | undefined,
  colorIndex: number | null,
  darkMode: boolean,
  hovered: boolean
): React.CSSProperties {
  const palette = pnlPalette(darkMode)
  const isEmptySlot = !outcome || outcome === 'empty' || colorIndex == null
  if (isEmptySlot) {
    return {
      backgroundColor: hovered && outcome && outcome !== 'empty' ? palette.emptyHover : palette.empty,
      borderColor: palette.border,
    }
  }
  const colors = outcome === 'win' ? palette.win : palette.loss
  return {
    backgroundColor: colors[colorIndex],
    borderColor: 'transparent',
  }
}

function GradientLegend({ darkMode }: { darkMode: boolean }) {
  const palette = pnlPalette(darkMode)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-muted-foreground">Gain</span>
      <div className="flex rounded-sm overflow-hidden border border-border/40">
        {palette.win.map((color, i) => (
          <span
            key={`win-${i}`}
            className="h-2.5 w-3 sm:w-4"
            style={{ backgroundColor: color }}
            title={WIN_LABELS[i]}
          />
        ))}
      </div>
      <span
        className="inline-block h-2.5 w-3 sm:w-4 rounded-[1px] border"
        style={{ backgroundColor: palette.empty, borderColor: palette.border }}
        title="±$250 (no highlight)"
      />
      <div className="flex rounded-sm overflow-hidden border border-border/40">
        {palette.loss.map((color, i) => (
          <span
            key={`loss-${i}`}
            className="h-2.5 w-3 sm:w-4"
            style={{ backgroundColor: color }}
            title={LOSS_LABELS[i]}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">Loss</span>
    </div>
  )
}

function HeatmapTile({
  cell,
  isHovered,
  darkMode,
  monthDivider,
  onHover,
  onClick,
}: {
  cell: HeatmapCell
  isHovered: boolean
  darkMode: boolean
  monthDivider?: boolean
  onHover: () => void
  onClick?: () => void
}) {
  const className = [
    'w-full aspect-square min-w-0 rounded-[1px] border p-0 transition-all duration-100',
    'cursor-pointer hover:scale-110 hover:z-20',
    'focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/70',
    isHovered ? 'scale-110 z-20 ring-1 ring-sky-400/60' : '',
    monthDivider ? 'border-l-[2px] border-l-foreground/70' : '',
  ].join(' ')

  const style = getTileStyle(cell.outcome, cell.colorIndex, darkMode, isHovered)

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={className}
      style={style}
      aria-label={
        cell.outcome !== 'empty'
          ? `${cell.label}, ${formatUsdPnl(cell.totalPnL)}`
          : `${cell.label}, no trades`
      }
    />
  )
}

function HoverDetail({ cell, darkMode }: { cell: HeatmapCell; darkMode: boolean }) {
  const grade = colorIndexLabel(cell.outcome, cell.colorIndex, cell.totalPnL, cell.tradeCount)
  const pnlColor = detailPnlColor(cell.outcome, darkMode)
  return (
    <div
      className={`text-xs rounded-md px-2.5 py-1.5 ${
        darkMode
          ? 'bg-gray-950/95 border border-gray-700/80 text-gray-100'
          : 'bg-white border border-gray-200 shadow-sm'
      }`}
    >
      <span className="font-medium">{cell.label}</span>
      {cell.outcome === 'empty' ? (
        <span className="text-muted-foreground"> · No trades</span>
      ) : (
        <>
          {' · '}
          <span className="font-medium" style={{ color: pnlColor }}>
            {formatUsdPnl(cell.totalPnL)}
          </span>
          {' · '}
          {cell.tradeCount} trades · {cell.wins}W/{cell.losses}L
          {cell.wins + cell.losses > 0 && ` · ${cell.winRate.toFixed(0)}% WR`}
          {grade && <> · {grade}</>}
        </>
      )}
    </div>
  )
}

function ModeToggle({
  mode,
  setMode,
  darkMode,
}: {
  mode: HeatmapMode
  setMode: (mode: HeatmapMode) => void
  darkMode: boolean
}) {
  return (
    <div
      className={`inline-flex items-center rounded-full border p-0.5 text-xs ${
        darkMode ? 'border-gray-600 bg-gray-800/60' : 'border-border bg-muted/40'
      }`}
      role="group"
      aria-label="Heatmap granularity"
    >
      {(['daily', 'weekly'] as const).map(option => (
        <button
          key={option}
          type="button"
          onClick={() => setMode(option)}
          className={`px-2.5 py-1 rounded-full capitalize transition-colors ${
            mode === option
              ? darkMode
                ? 'bg-gray-700 text-foreground shadow-sm'
                : 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function computeMonthSpans(cells: HeatmapCell[], weekCount: number): MonthSpan[] {
  const bounds = new Map<number, { min: number; max: number }>()
  for (const cell of cells) {
    const entry = bounds.get(cell.month) ?? { min: cell.col, max: cell.col }
    entry.min = Math.min(entry.min, cell.col)
    entry.max = Math.max(entry.max, cell.col)
    bounds.set(cell.month, entry)
  }

  return MONTH_LABELS.map((label, idx) => {
    const b = bounds.get(idx + 1)
    if (!b) return null
    return {
      label,
      startCol: b.min,
      colSpan: b.max - b.min + 1,
    }
  }).filter((s): s is MonthSpan => s != null)
}

export default function TradingDayHeatmap({
  trades,
  darkMode,
  tradeTags,
  calendarYear,
  availableYears,
  autoFollowCurrentYear,
  onCalendarYearChange,
  onAutoFollowCurrentYearChange,
  hoveredDayKey,
  onHoverDayKey,
  onDayClick,
  onWeekClick,
}: TradingDayHeatmapProps) {
  const [mode, setMode] = useState<HeatmapMode>('daily')

  const dailyData = useMemo(() => {
    const grouped = aggregateByPeriod(trades, 'daily')
    const { start, end, startKey, endKey } = yearBounds(calendarYear)
    const gridStart = startOfWeekSunday(start)
    const gridEnd = endOfWeekSaturday(end)
    const weekCount = Math.floor(differenceInCalendarDays(gridEnd, gridStart) / 7) + 1

    const grid: (HeatmapCell | null)[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: weekCount }, () => null)
    )

    const rawCells: Omit<HeatmapCell, 'colorIndex'>[] = []
    let cursor = gridStart

    for (let col = 0; col < weekCount; col++) {
      for (let dow = 0; dow < 7; dow++) {
        const dayKey = formatDateKey(cursor, DISPLAY_TIMEZONE)
        const inYear = dayKey >= startKey && dayKey <= endKey
        const row = monFriRowIndex(cursor)

        if (inYear && row != null) {
          const month = Number(dayKey.slice(5, 7))
          const dayOfMonth = Number(dayKey.slice(8, 10))
          const base = buildCell(dayKey, dateKeyToLabel(dayKey), grouped[dayKey] ?? [], tradeTags)
          const cell: Omit<HeatmapCell, 'colorIndex'> = {
            ...base,
            month,
            isFirstOfMonth: dayOfMonth === 1,
            row,
            col,
          }
          grid[row][col] = cell as HeatmapCell
          rawCells.push(cell)
        }

        cursor = addDays(cursor, 1)
      }
    }

    const colored = assignColorIndices(rawCells)
    const cellById = new Map(colored.map(c => [c.id, c]))

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < weekCount; col++) {
        const slot = grid[row][col]
        if (slot) {
          grid[row][col] = cellById.get(slot.id) ?? null
        }
      }
    }

    const cells = colored as HeatmapCell[]
    const active = cells.filter(c => c.outcome !== 'empty')
    const winning = active.filter(c => c.outcome === 'win').length
    const losing = active.filter(c => c.outcome === 'loss').length

    return {
      grid,
      weekCount,
      monthSpans: computeMonthSpans(cells, weekCount),
      cells,
      summary: {
        winning,
        losing,
        breakeven: active.filter(c => c.outcome === 'be').length,
        winRate: winning + losing > 0 ? (winning / (winning + losing)) * 100 : 0,
        unitLabel: 'days',
      },
    }
  }, [trades, tradeTags, calendarYear])

  const weeklyData = useMemo(() => {
    const grouped = aggregateByPeriod(trades, 'weekly')
    const weekEntries = buildCalendarYearWeekKeys(calendarYear)

    const rawCells = weekEntries.map(({ weekKey, month }, index) => {
      const base = buildCell(weekKey, formatWeekLabel(weekKey), grouped[weekKey] ?? [], tradeTags)
      return {
        ...base,
        month,
        isFirstOfMonth: false,
        row: 0,
        col: index,
      }
    })

    const cells = assignColorIndices(rawCells) as HeatmapCell[]
    const weekCount = Math.max(cells.length, 1)

    const monthBounds = new Map<number, { min: number; max: number }>()
    cells.forEach(cell => {
      const month = cell.month
      const b = monthBounds.get(month) ?? { min: cell.col, max: cell.col }
      b.min = Math.min(b.min, cell.col)
      b.max = Math.max(b.max, cell.col)
      monthBounds.set(month, b)
    })

    const monthSpans: MonthSpan[] = MONTH_LABELS.map((label, idx) => {
      const b = monthBounds.get(idx + 1)
      if (!b) return null
      return { label, startCol: b.min, colSpan: b.max - b.min + 1 }
    }).filter((s): s is MonthSpan => s != null)

    const active = cells.filter(c => c.outcome !== 'empty')
    const winning = active.filter(c => c.outcome === 'win').length
    const losing = active.filter(c => c.outcome === 'loss').length

    return {
      cells,
      weekCount,
      monthSpans,
      summary: {
        winning,
        losing,
        breakeven: active.filter(c => c.outcome === 'be').length,
        winRate: winning + losing > 0 ? (winning / (winning + losing)) * 100 : 0,
        unitLabel: 'weeks',
      },
    }
  }, [trades, tradeTags, calendarYear])

  const activeData = mode === 'daily' ? dailyData : weeklyData

  const hovered =
    hoveredDayKey != null
      ? activeData.cells.find(cell => cell.id === hoveredDayKey) ?? null
      : null

  const handleModeChange = (next: HeatmapMode) => {
    setMode(next)
    onHoverDayKey(null)
  }

  const panelClass = darkMode
    ? 'rounded-xl border border-gray-700/60 bg-gradient-to-b from-gray-900/40 to-gray-900/20'
    : 'rounded-xl border border-gray-200/90 bg-gradient-to-b from-white to-gray-50/80'

  const columnTemplate = (count: number) => `repeat(${count}, minmax(0, 1fr))`

  return (
    <div className={`${panelClass} p-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold tracking-tight">
              {calendarYear} performance map
            </h3>
            <HeatmapYearSelect
              calendarYear={calendarYear}
              availableYears={availableYears}
              autoFollowCurrentYear={autoFollowCurrentYear}
              onCalendarYearChange={onCalendarYearChange}
              onAutoFollowCurrentYearChange={onAutoFollowCurrentYearChange}
              darkMode={darkMode}
            />
            <ModeToggle mode={mode} setMode={handleModeChange} darkMode={darkMode} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium" style={{ color: brightestWinColor(darkMode) }}>
              {activeData.summary.winning}W
            </span>
            {' / '}
            <span className="font-medium" style={{ color: brightestLossColor(darkMode) }}>
              {activeData.summary.losing}L
            </span>
            {activeData.summary.breakeven > 0 && (
              <>
                {' / '}
                <span className="font-medium">{activeData.summary.breakeven}BE</span>
              </>
            )}
          </span>
          {activeData.summary.winning + activeData.summary.losing > 0 && (
            <span>
              {activeData.summary.winRate.toFixed(0)}% winning {activeData.summary.unitLabel}
            </span>
          )}
        </div>
      </div>

      <div className="w-full pb-1">
        <div className="flex w-full gap-2">
          <div
            className="flex shrink-0 items-center justify-center text-xs font-semibold text-muted-foreground select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {calendarYear}
          </div>

          <div className="flex-1 min-w-0">
            {mode === 'daily' ? (
              <>
                <div
                  className={`grid w-full mb-1 ${GRID_GAP_CLASS}`}
                  style={{ gridTemplateColumns: `2rem ${columnTemplate(dailyData.weekCount)}` }}
                >
                  <span aria-hidden="true" />
                  {dailyData.monthSpans.map(span => (
                    <div
                      key={span.label}
                      className="text-[10px] font-medium text-muted-foreground truncate text-center px-0.5"
                      style={{ gridColumn: `${span.startCol + 2} / span ${span.colSpan}` }}
                    >
                      {span.label}
                    </div>
                  ))}
                </div>
                <div
                  className={`grid w-full ${GRID_GAP_CLASS}`}
                  style={{ gridTemplateColumns: `2rem ${columnTemplate(dailyData.weekCount)}` }}
                  role="img"
                  aria-label={`${calendarYear} daily trading performance heatmap`}
                >
                  {dailyData.grid.map((rowCells, rowIdx) => (
                    <React.Fragment key={`row-${rowIdx}`}>
                      <span className="flex items-center text-[9px] text-muted-foreground/80 select-none pr-1">
                        {ROW_LABELS[rowIdx]}
                      </span>
                      {rowCells.map((cell, colIdx) => {
                        if (!cell) {
                          return (
                            <span
                              key={`empty-${rowIdx}-${colIdx}`}
                              className="w-full aspect-square min-w-0"
                              aria-hidden="true"
                            />
                          )
                        }
                        return (
                          <HeatmapTile
                            key={cell.id}
                            cell={cell}
                            isHovered={hoveredDayKey === cell.id}
                            darkMode={darkMode}
                            monthDivider={cell.isFirstOfMonth && colIdx > 0}
                            onHover={() => onHoverDayKey(cell.id)}
                            onClick={() => onDayClick?.(cell.id)}
                          />
                        )
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div
                  className={`grid w-full mb-1 ${GRID_GAP_CLASS}`}
                  style={{ gridTemplateColumns: columnTemplate(activeData.weekCount) }}
                >
                  {activeData.monthSpans.map(span => (
                    <div
                      key={span.label}
                      className="text-[10px] font-medium text-muted-foreground truncate text-center px-0.5"
                      style={{ gridColumn: `${span.startCol + 1} / span ${span.colSpan}` }}
                    >
                      {span.label}
                    </div>
                  ))}
                </div>
                <div
                  className={`grid w-full ${GRID_GAP_CLASS}`}
                  style={{ gridTemplateColumns: columnTemplate(weeklyData.weekCount) }}
                  role="img"
                  aria-label={`${calendarYear} weekly trading performance heatmap`}
                >
                  {weeklyData.cells.map((cell, index) => {
                    const prevMonth = index > 0 ? weeklyData.cells[index - 1].month : cell.month
                    return (
                      <HeatmapTile
                        key={cell.id}
                        cell={cell}
                        isHovered={hoveredDayKey === cell.id}
                        darkMode={darkMode}
                        monthDivider={cell.month !== prevMonth && index > 0}
                        onHover={() => onHoverDayKey(cell.id)}
                        onClick={() => onWeekClick?.(cell.id)}
                      />
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 min-h-[2rem] flex flex-wrap items-center justify-between gap-2">
        <GradientLegend darkMode={darkMode} />
        {hovered && <HoverDetail cell={hovered} darkMode={darkMode} />}
      </div>
    </div>
  )
}
