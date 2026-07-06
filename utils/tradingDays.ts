// US Stock Market (NYSE/NASDAQ) Holidays for 2025-2026
// These are the days when the market is closed

import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'

export const US_STOCK_HOLIDAYS: string[] = [
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-20', // Martin Luther King Jr. Day
  '2025-02-17', // Presidents' Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving Day
  '2025-12-25', // Christmas Day

  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
]

// Set for faster lookup
const holidaySet = new Set(US_STOCK_HOLIDAYS)

/** Calendar date in US Eastern (dashboard display timezone). */
export function formatDateKey(
  date: Date,
  timeZone: string = DISPLAY_TIMEZONE
): string {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd')
}

/** Human-readable label for a yyyy-MM-dd key in the display timezone. */
export function dateKeyToLabel(
  dateKey: string,
  timeZone: string = DISPLAY_TIMEZONE
): string {
  return formatInTimeZone(noonInTimeZone(dateKey, timeZone), timeZone, 'EEEE, MMMM d, yyyy')
}

function noonInTimeZone(dateKey: string, timeZone: string): Date {
  return fromZonedTime(`${dateKey} 12:00:00`, timeZone)
}

/**
 * Check if a date is a US stock market holiday (NYC calendar day).
 */
export function isHoliday(date: Date, timeZone: string = DISPLAY_TIMEZONE): boolean {
  return holidaySet.has(formatDateKey(date, timeZone))
}

/**
 * Saturday or Sunday on the NYC calendar (ISO weekday 6 or 7).
 */
export function isWeekend(date: Date, timeZone: string = DISPLAY_TIMEZONE): boolean {
  const isoDow = formatInTimeZone(date, timeZone, 'i')
  return isoDow === '6' || isoDow === '7'
}

/**
 * Check if a date is a valid trading day (not weekend, not holiday).
 */
export function isTradingDay(date: Date, timeZone: string = DISPLAY_TIMEZONE): boolean {
  return !isWeekend(date, timeZone) && !isHoliday(date, timeZone)
}

/**
 * All trading days between two instants (inclusive), stepping NYC calendar days.
 */
export function getTradingDaysBetween(
  startDate: Date,
  endDate: Date,
  timeZone: string = DISPLAY_TIMEZONE
): Date[] {
  const days: Date[] = []
  let currentKey = formatDateKey(startDate, timeZone)
  const endKey = formatDateKey(endDate, timeZone)

  while (currentKey <= endKey) {
    const noon = noonInTimeZone(currentKey, timeZone)
    if (isTradingDay(noon, timeZone)) {
      days.push(noon)
    }
    currentKey = formatDateKey(addDays(noon, 1), timeZone)
  }

  return days
}

/**
 * Find missing trading days from a list of dates with trades
 * Returns an array of date ranges (consecutive missing days grouped together)
 */
export interface DateRange {
  start: Date
  end: Date
  count: number
}

export function findMissingTradingDays(
  tradeDates: Set<string>,
  startDate: Date,
  endDate: Date,
  timeZone: string = DISPLAY_TIMEZONE
): DateRange[] {
  const missingRanges: DateRange[] = []
  const tradingDays = getTradingDaysBetween(startDate, endDate, timeZone)

  let currentRange: DateRange | null = null

  for (const day of tradingDays) {
    const dateKey = formatDateKey(day, timeZone)
    const hasTrades = tradeDates.has(dateKey)

    if (!hasTrades) {
      if (currentRange === null) {
        currentRange = {
          start: new Date(day),
          end: new Date(day),
          count: 1,
        }
      } else {
        currentRange.end = new Date(day)
        currentRange.count++
      }
    } else if (currentRange !== null) {
      missingRanges.push(currentRange)
      currentRange = null
    }
  }

  if (currentRange !== null) {
    missingRanges.push(currentRange)
  }

  return missingRanges
}
