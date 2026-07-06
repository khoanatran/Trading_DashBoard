'use client'

import React, { useMemo } from 'react'
import { addDays, differenceInCalendarDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { Trade, aggregateByPeriod } from '@/utils/logParser'
import { formatDateKey, dateKeyToLabel } from '@/utils/tradingDays'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import HeatmapYearSelect from '@/components/HeatmapYearSelect'

interface TradesPerDayHeatmapProps {
  trades: Trade[]
  darkMode: boolean
  calendarYear: number
  availableYears: number[]
  autoFollowCurrentYear: boolean
  onCalendarYearChange: (year: number) => void
  onAutoFollowCurrentYearChange: (auto: boolean) => void
  hoveredDayKey: string | null
  onHoverDayKey: (dayKey: string | null) => void
  onDayClick?: (dayKey: string) => void
}

interface TradeDayCell {
  id: string
  label: string
  tradeCount: number
  colorIndex: number | null
  month: number
  row: number
  col: number
}

interface MonthSpan {
  label: string
  startCol: number
  colSpan: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const GRID_GAP_CLASS = 'gap-[2px]'

/** GitHub contribution graph palette — https://github.com */
const GITHUB_HEATMAP = {
  light: {
    empty: '#ebedf0',
    emptyHover: '#d8dee4',
    border: '#d0d7de',
    levels: ['#9be9a8', '#40c463', '#30a14e', '#216e39'],
  },
  dark: {
    empty: '#161b22',
    emptyHover: '#21262d',
    border: '#30363d',
    levels: ['#0e4429', '#006d32', '#26a641', '#39d353'],
  },
} as const

const VOLUME_LABELS = ['1–5 trades', '6–10 trades', '11–19 trades', '20+ trades']

function heatmapPalette(darkMode: boolean) {
  return darkMode ? GITHUB_HEATMAP.dark : GITHUB_HEATMAP.light
}

function brightestVolumeColor(darkMode: boolean) {
  return heatmapPalette(darkMode).levels[3]
}

function tradeCountToColorIndex(count: number): number | null {
  if (count <= 0) return null
  if (count <= 5) return 0
  if (count <= 10) return 1
  if (count <= 19) return 2
  return 3
}

function yearBounds(year: number) {
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


function computeMonthBoundaryCols(cells: TradeDayCell[]): Set<number> {
  const firstColByMonth = new Map<number, number>()
  for (const cell of cells) {
    const existing = firstColByMonth.get(cell.month)
    if (existing === undefined || cell.col < existing) {
      firstColByMonth.set(cell.month, cell.col)
    }
  }

  const boundaries = new Set<number>()
  for (const [month, col] of firstColByMonth) {
    if (month === 1 && col === 0) continue
    boundaries.add(col)
  }
  return boundaries
}

function computeMonthSpans(cells: TradeDayCell[]): MonthSpan[] {
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
    return { label, startCol: b.min, colSpan: b.max - b.min + 1 }
  }).filter((s): s is MonthSpan => s != null)
}

function getTileStyle(
  colorIndex: number | null,
  darkMode: boolean,
  hovered: boolean
): React.CSSProperties {
  const palette = heatmapPalette(darkMode)
  if (colorIndex == null) {
    return {
      backgroundColor: hovered ? palette.emptyHover : palette.empty,
      borderColor: palette.border,
    }
  }
  return {
    backgroundColor: palette.levels[colorIndex],
    borderColor: 'transparent',
  }
}

function VolumeLegend({ darkMode }: { darkMode: boolean }) {
  const palette = heatmapPalette(darkMode)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-muted-foreground">Less</span>
      <div className="flex rounded-sm overflow-hidden border border-border/40">
        {palette.levels.map((color, i) => (
          <span
            key={i}
            className="h-2.5 w-3 sm:w-4"
            style={{ backgroundColor: color }}
            title={VOLUME_LABELS[i]}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">More</span>
      <span className="inline-flex items-center gap-1 ml-1">
        <span
          className="inline-block h-2.5 w-3 rounded-[1px] border"
          style={{ backgroundColor: palette.empty, borderColor: palette.border }}
        />
        <span className="text-[10px] text-muted-foreground">None</span>
      </span>
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
  cell: TradeDayCell
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
    monthDivider
      ? darkMode
        ? 'border-l border-l-white/10 shadow-[-1px_0_0_0_rgba(255,255,255,0.06)]'
        : 'border-l border-l-black/10 shadow-[-1px_0_0_0_rgba(0,0,0,0.04)]'
      : '',
  ].join(' ')

  const style = getTileStyle(cell.colorIndex, darkMode, isHovered)

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={className}
      style={style}
      aria-label={
        cell.tradeCount > 0
          ? `${cell.label}, ${cell.tradeCount} trades`
          : `${cell.label}, no trades`
      }
    />
  )
}

export default function TradesPerDayHeatmap({
  trades,
  darkMode,
  calendarYear,
  availableYears,
  autoFollowCurrentYear,
  onCalendarYearChange,
  onAutoFollowCurrentYearChange,
  hoveredDayKey,
  onHoverDayKey,
  onDayClick,
}: TradesPerDayHeatmapProps) {
  const { grid, weekCount, monthSpans, monthBoundaryCols, cells, summary } = useMemo(() => {
    const grouped = aggregateByPeriod(trades, 'daily')
    const { start, end, startKey, endKey } = yearBounds(calendarYear)
    const gridStart = startOfWeekSunday(start)
    const gridEnd = endOfWeekSaturday(end)
    const weekCount = Math.floor(differenceInCalendarDays(gridEnd, gridStart) / 7) + 1

    const grid: (TradeDayCell | null)[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: weekCount }, () => null)
    )

    const rawCells: Omit<TradeDayCell, 'colorIndex'>[] = []
    let cursor = gridStart

    for (let col = 0; col < weekCount; col++) {
      for (let dow = 0; dow < 7; dow++) {
        const dayKey = formatDateKey(cursor, DISPLAY_TIMEZONE)
        const inYear = dayKey >= startKey && dayKey <= endKey
        const row = monFriRowIndex(cursor)

        if (inYear && row != null) {
          const month = Number(dayKey.slice(5, 7))
          const tradeCount = grouped[dayKey]?.length ?? 0
          const cell: Omit<TradeDayCell, 'colorIndex'> = {
            id: dayKey,
            label: dateKeyToLabel(dayKey),
            tradeCount,
            month,
            row,
            col,
          }
          grid[row][col] = cell as TradeDayCell
          rawCells.push(cell)
        }

        cursor = addDays(cursor, 1)
      }
    }

    const maxCount = Math.max(0, ...rawCells.map(c => c.tradeCount))
    const colored: TradeDayCell[] = rawCells.map(cell => ({
      ...cell,
      colorIndex: tradeCountToColorIndex(cell.tradeCount),
    }))
    const cellById = new Map(colored.map(c => [c.id, c]))

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < weekCount; col++) {
        const slot = grid[row][col]
        if (slot) grid[row][col] = cellById.get(slot.id) ?? null
      }
    }

    const activeDays = colored.filter(c => c.tradeCount > 0)
    const totalTrades = colored.reduce((sum, c) => sum + c.tradeCount, 0)

    return {
      grid,
      weekCount,
      monthSpans: computeMonthSpans(colored),
      monthBoundaryCols: computeMonthBoundaryCols(colored),
      cells: colored,
      summary: {
        totalTrades,
        activeDays: activeDays.length,
        maxCount,
        avgPerActiveDay: activeDays.length > 0 ? totalTrades / activeDays.length : 0,
      },
    }
  }, [trades, calendarYear])

  const hovered = hoveredDayKey != null ? cells.find(c => c.id === hoveredDayKey) ?? null : null

  const panelClass = darkMode
    ? 'rounded-xl border border-gray-700/60 bg-gradient-to-b from-gray-900/40 to-gray-900/20'
    : 'rounded-xl border border-gray-200/90 bg-gradient-to-b from-white to-gray-50/80'

  const columnTemplate = `repeat(${weekCount}, minmax(0, 1fr))`

  return (
    <div className={`${panelClass} p-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold tracking-tight">
              {calendarYear} trades per day
            </h3>
            <HeatmapYearSelect
              calendarYear={calendarYear}
              availableYears={availableYears}
              autoFollowCurrentYear={autoFollowCurrentYear}
              onCalendarYearChange={onCalendarYearChange}
              onAutoFollowCurrentYearChange={onAutoFollowCurrentYearChange}
              darkMode={darkMode}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{summary.totalTrades} trades</span>
          <span>{summary.activeDays} active days</span>
          {summary.maxCount > 0 && <span>Peak {summary.maxCount}/day</span>}
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
            <div
              className={`grid w-full mb-1.5 ${GRID_GAP_CLASS}`}
              style={{ gridTemplateColumns: `2rem ${columnTemplate}` }}
            >
              <span aria-hidden="true" />
              {monthSpans.map(span => (
                <div
                  key={span.label}
                  className={`text-[10px] font-medium truncate text-center px-0.5 pb-1 ${
                    darkMode ? 'text-gray-400' : 'text-muted-foreground'
                  } ${
                    span.startCol > 0
                      ? darkMode
                        ? 'border-l border-l-white/10'
                        : 'border-l border-l-black/8'
                      : ''
                  }`}
                  style={{ gridColumn: `${span.startCol + 2} / span ${span.colSpan}` }}
                >
                  {span.label}
                </div>
              ))}
            </div>

            <div
              className={`grid w-full ${GRID_GAP_CLASS} ${
                darkMode ? 'border-t border-white/5' : 'border-t border-black/5'
              } pt-1`}
              style={{
                gridTemplateColumns: `2rem ${columnTemplate}`,
              }}
              role="img"
              aria-label={`${calendarYear} trades per day heatmap`}
            >
              {grid.map((rowCells, rowIdx) => (
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
                        monthDivider={monthBoundaryCols.has(colIdx)}
                        onHover={() => onHoverDayKey(cell.id)}
                        onClick={() => onDayClick?.(cell.id)}
                      />
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 min-h-[2rem] flex flex-wrap items-center justify-between gap-2">
        <VolumeLegend darkMode={darkMode} />
        {hovered && (
          <div
            className={`text-xs rounded-md px-2.5 py-1.5 ${
              darkMode
                ? 'bg-gray-950/95 border border-gray-700/80 text-gray-100'
                : 'bg-white border border-gray-200 shadow-sm'
            }`}
          >
            <span className="font-medium">{hovered.label}</span>
            {hovered.tradeCount > 0 ? (
              <>
                {' · '}
                <span
                  className="font-medium"
                  style={{
                    color: hovered.tradeCount > 0 ? brightestVolumeColor(darkMode) : undefined,
                  }}
                >
                  {hovered.tradeCount} trade{hovered.tradeCount === 1 ? '' : 's'}
                </span>
                {hovered.colorIndex != null && (
                  <span className="text-muted-foreground"> · {VOLUME_LABELS[hovered.colorIndex]}</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground"> · No trades</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
