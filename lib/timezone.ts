import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/** MT5 Report History exports wall-clock times in broker server time (UTC+3 for this account). */
export const MT5_REPORT_TIMEZONE = 'Etc/GMT-3'

/** Dashboard display and chart grouping use US Eastern Time. */
export const DISPLAY_TIMEZONE = 'America/New_York'

const NYC_ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ss"

/**
 * Convert MT5 report wall-clock (UTC+3) to NYC wall-clock ISO string for storage.
 * Example: 16:30 broker → 09:30 America/New_York (EDT).
 */
export function mt5WallClockToNycIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): string {
  const wall = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  const instant = fromZonedTime(wall, MT5_REPORT_TIMEZONE)
  return formatInTimeZone(instant, DISPLAY_TIMEZONE, NYC_ISO_FORMAT)
}

/**
 * Extract wall-clock time for display (HH:mm:ss).
 * Handles ISO (`2026-05-14T09:42:55`), space-separated, and bare time strings.
 */
export function formatWallClockTimeOnly(timeStr: string | null | undefined): string {
  if (!timeStr) return 'N/A'
  const raw = String(timeStr).trim().replace(/\u00a0/g, ' ')

  // Strip YYYY-MM-DD prefix (ISO "T" or space-separated, including double spaces)
  let timePart = raw.replace(/^\d{4}-\d{2}-\d{2}[T\s]+/i, '')
  if (timePart === raw) {
    if (raw.includes('T')) {
      timePart = raw.split('T').pop() ?? raw
    } else {
      const spaceDateMatch = raw.match(/^\d{4}-\d{2}-\d{2}\s+(.+)$/)
      if (spaceDateMatch) {
        timePart = spaceDateMatch[1]
      }
    }
  }

  timePart = timePart.replace(/\.\d+.*$/, '').replace(/[Zz]$/, '').trim()

  const match = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`
  }

  return raw
}

/** Format an NYC wall-clock timestamp for UI (e.g. "Apr 30, 9:40 AM ET"). */
export function formatNycDateTime(
  timestamp: string | null | undefined,
  options?: { dateStyle?: 'short' | 'medium'; showTime?: boolean }
): string {
  if (!timestamp) return 'N/A'
  const instant = fromZonedTime(
    timestamp.replace('T', ' ').replace(/[,\.]\d+.*$/, '').trim(),
    DISPLAY_TIMEZONE
  )
  return formatInTimeZone(instant, DISPLAY_TIMEZONE, options?.showTime === false ? 'MMM d, yyyy' : 'MMM d, h:mm a') + ' ET'
}
