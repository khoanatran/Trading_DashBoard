import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { Trade, parseLocalTimestamp, getTradeId } from '@/utils/logParser'

export const DAY_GROUP_COLORS = [
  { bar: 'bg-blue-500', bg: 'bg-blue-500/5' },
  { bar: 'bg-emerald-500', bg: 'bg-emerald-500/5' },
  { bar: 'bg-purple-500', bg: 'bg-purple-500/5' },
  { bar: 'bg-amber-500', bg: 'bg-amber-500/5' },
  { bar: 'bg-pink-500', bg: 'bg-pink-500/5' },
  { bar: 'bg-cyan-500', bg: 'bg-cyan-500/5' },
] as const

export interface DayGroupInfo {
  isFirst: boolean
  isLast: boolean
  isOnly: boolean
  groupSize: number
  dateKey: string
  positionInGroup: number
  colorIndex: number
}

/** NYC calendar day key for grouping (matches journal day brackets). */
export function getTradeDayGroupKey(trade: Trade): string | null {
  const raw = trade.entryTime ?? trade.timestamp
  if (!raw) return null
  return formatInTimeZone(parseLocalTimestamp(raw), DISPLAY_TIMEZONE, 'yyyy-MM-dd')
}

export function formatTradeDayGroupLabel(dateKey: string): string {
  const instant = parseLocalTimestamp(`${dateKey}T12:00:00`)
  return format(instant, 'MMM d, yyyy')
}

/** Build day-group metadata keyed by trade id for an ordered trade list. */
export function buildDayGroupsByTradeId(trades: Trade[]): Record<string, DayGroupInfo> {
  const groups: Record<string, DayGroupInfo> = {}
  const dateToTradeIds: Record<string, string[]> = {}
  const dateOrder: string[] = []

  for (const trade of trades) {
    const dateKey = getTradeDayGroupKey(trade)
    if (!dateKey) continue
    const id = getTradeId(trade)
    if (!dateToTradeIds[dateKey]) {
      dateToTradeIds[dateKey] = []
      dateOrder.push(dateKey)
    }
    dateToTradeIds[dateKey].push(id)
  }

  dateOrder.forEach((dateKey, dateIndex) => {
    const tradeIds = dateToTradeIds[dateKey]
    const groupSize = tradeIds.length
    const colorIndex = dateIndex % DAY_GROUP_COLORS.length

    tradeIds.forEach((tradeId, positionInGroup) => {
      groups[tradeId] = {
        isFirst: positionInGroup === 0,
        isLast: positionInGroup === groupSize - 1,
        isOnly: groupSize === 1,
        groupSize,
        dateKey,
        positionInGroup,
        colorIndex,
      }
    })
  })

  return groups
}
