import * as XLSX from 'xlsx'
import {
  applyDollarsPerR,
  getTradeCloseTimeMs,
  type Trade,
} from '@/utils/logParser'
import { mt5WallClockToNycIso } from '@/lib/timezone'

/** MetaTrader 5 Account History → Positions export (e.g. ReportHistory-*.xlsx) */
const MT5_TIME_RE = /^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/

/** Default Positions column indices (MT5 English export). */
const DEFAULT_POSITIONS_COLUMNS = {
  entryTime: 0,
  symbol: 2,
  type: 3,
  volume: 4,
  entryPrice: 5,
  sl: 6,
  tp: 7,
  exitTime: 8,
  exitPrice: 9,
  commission: 10,
  swap: 11,
  profit: 12,
}

interface PositionsColumnMap {
  entryTime: number
  symbol: number
  type: number
  volume: number
  entryPrice: number
  sl: number
  tp: number
  exitTime: number
  exitPrice: number
  commission: number
  swap: number
  profit: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseMt5DateTime(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return mt5WallClockToNycIso(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds()
    )
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return mt5WallClockToNycIso(
        parsed.y,
        parsed.m,
        parsed.d,
        parsed.H,
        parsed.M,
        parsed.S
      )
    }
  }

  const raw = String(value ?? '').trim()
  if (!MT5_TIME_RE.test(raw)) return null
  const [datePart, timePart] = raw.split(/\s+/)
  const [y, m, d] = datePart.split('.').map(Number)
  const [hour, minute, second = 0] = timePart.split(':').map(Number)
  if (!y || !m || !d || Number.isNaN(hour)) return null
  return mt5WallClockToNycIso(y, m, d, hour, minute, second)
}

/** MT5 exports may use space thousands separators (e.g. "2 457") which parseFloat reads as 2. */
function parseNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  let s = String(value).trim().replace(/[\s\u00a0]/g, '')
  if (!s) return null

  // European decimal comma (e.g. "-527,40")
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }

  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function parseVolume(value: unknown): number {
  const raw = String(value ?? '').trim()
  const head = raw.split('/')[0].trim()
  const n = parseFloat(head)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function findSectionStart(rows: unknown[][], label: string): number {
  return rows.findIndex(row => String(row?.[0] ?? '').trim() === label)
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').toLowerCase().trim()
}

/** Map Positions header row; falls back to MT5 default indices when headers are missing. */
export function mapMt5PositionsColumns(headerRow: unknown[]): PositionsColumnMap {
  const headers = headerRow.map(normalizeHeader)
  const timeCols: number[] = []
  const priceCols: number[] = []

  headers.forEach((name, index) => {
    if (name === 'time' || name === 'open time' || name.includes('open') && name.includes('time')) {
      timeCols.push(index)
    }
    if (name === 'price' || name === 'open price') {
      priceCols.push(index)
    }
    if (name === 'close time' || (name.includes('close') && name.includes('time'))) {
      timeCols.push(index)
    }
    if (name === 'close price' || (name.includes('close') && name.includes('price'))) {
      priceCols.push(index)
    }
  })

  const uniqueTimes = [...new Set(timeCols)]
  const uniquePrices = [...new Set(priceCols)]

  const indexOf = (...names: string[]) => {
    for (const name of names) {
      const i = headers.indexOf(name)
      if (i >= 0) return i
    }
    return -1
  }

  const entryTime = uniqueTimes[0] ?? DEFAULT_POSITIONS_COLUMNS.entryTime
  const exitTime =
    uniqueTimes.length > 1
      ? uniqueTimes[uniqueTimes.length - 1]
      : indexOf('close time') >= 0
        ? indexOf('close time')
        : DEFAULT_POSITIONS_COLUMNS.exitTime

  return {
    entryTime,
    symbol: indexOf('symbol') >= 0 ? indexOf('symbol') : DEFAULT_POSITIONS_COLUMNS.symbol,
    type: indexOf('type') >= 0 ? indexOf('type') : DEFAULT_POSITIONS_COLUMNS.type,
    volume: indexOf('volume') >= 0 ? indexOf('volume') : DEFAULT_POSITIONS_COLUMNS.volume,
    entryPrice:
      uniquePrices.length > 0
        ? uniquePrices[0]
        : DEFAULT_POSITIONS_COLUMNS.entryPrice,
    sl:
      indexOf('s / l', 's/l', 'sl', 'stop loss') >= 0
        ? indexOf('s / l', 's/l', 'sl', 'stop loss')
        : DEFAULT_POSITIONS_COLUMNS.sl,
    tp:
      indexOf('t / p', 't/p', 'tp', 'take profit') >= 0
        ? indexOf('t / p', 't/p', 'tp', 'take profit')
        : DEFAULT_POSITIONS_COLUMNS.tp,
    exitTime,
    exitPrice:
      uniquePrices.length > 1
        ? uniquePrices[uniquePrices.length - 1]
        : indexOf('close price') >= 0
          ? indexOf('close price')
          : DEFAULT_POSITIONS_COLUMNS.exitPrice,
    commission:
      indexOf('commission') >= 0
        ? indexOf('commission')
        : DEFAULT_POSITIONS_COLUMNS.commission,
    swap: indexOf('swap') >= 0 ? indexOf('swap') : DEFAULT_POSITIONS_COLUMNS.swap,
    profit:
      indexOf('profit') >= 0 ? indexOf('profit') : DEFAULT_POSITIONS_COLUMNS.profit,
  }
}

/** Parse raw sheet rows from an MT5 Report History workbook. */
export function parseMt5ReportHistoryRows(
  rows: unknown[][],
  sourceFile?: string
): Trade[] {
  const positionsStart = findSectionStart(rows, 'Positions')
  if (positionsStart < 0) return []

  const ordersStart = findSectionStart(rows, 'Orders')
  const dataEnd = ordersStart >= 0 ? ordersStart : rows.length
  const headerRowIndex = positionsStart + 1
  const headerRow = rows[headerRowIndex]
  const cols = mapMt5PositionsColumns(
    Array.isArray(headerRow) ? headerRow : []
  )
  const trades: Trade[] = []

  for (let i = headerRowIndex + 1; i < dataEnd; i++) {
    const row = rows[i]
    if (!row || !Array.isArray(row)) continue

    const type = String(row[cols.type] ?? '').trim().toLowerCase()
    if (type !== 'buy' && type !== 'sell') continue

    const entryTimestamp = parseMt5DateTime(row[cols.entryTime])
    const exitTimestamp = parseMt5DateTime(row[cols.exitTime])
    if (!entryTimestamp || !exitTimestamp) continue

    const symbol = String(row[cols.symbol] ?? '').trim() || null
    const direction = type === 'sell' ? 'short' : 'long'
    const volume = parseVolume(row[cols.volume])
    const entryPrice = parseNumber(row[cols.entryPrice])
    const sl = parseNumber(row[cols.sl])
    const exitPrice = parseNumber(row[cols.exitPrice])
    const commission = parseNumber(row[cols.commission]) ?? 0
    const swap = parseNumber(row[cols.swap]) ?? 0
    // MT5 Positions "Profit" is net P&L for the closed position (commission/swap columns are separate adjustments)
    const profit = parseNumber(row[cols.profit]) ?? 0
    const pnl = profit + commission + swap

    let reward: number | null = null
    if (entryPrice != null && exitPrice != null) {
      reward =
        direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice
    }

    trades.push({
      // Use exit time as primary timestamp so period grouping matches realized P&L (Report History).
      timestamp: exitTimestamp,
      direction,
      riskAmount: null,
      estDollarRisked: null,
      slPoints:
        sl != null && entryPrice != null ? Math.abs(entryPrice - sl) : null,
      tpPoints: parseNumber(row[cols.tp]),
      orderQty: volume,
      entryPrice,
      exitPrice,
      reward,
      rrRatio: null,
      pnl,
      isClosed: true,
      entryTime: entryTimestamp,
      exitTime: exitTimestamp,
      partialExits: [],
      sourceFile: sourceFile ?? null,
      symbol,
      commission: commission + swap,
    })
  }

  for (const trade of trades) {
    applyDollarsPerR(trade)
  }

  trades.sort((a, b) => getTradeCloseTimeMs(a) - getTradeCloseTimeMs(b))

  return trades
}

export function parseMt5ReportHistoryBuffer(
  buffer: ArrayBuffer,
  sourceFile?: string
): Trade[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][]

  return parseMt5ReportHistoryRows(rows, sourceFile)
}

export function isMt5ReportHistoryFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.includes('reporthistory')
  )
}
