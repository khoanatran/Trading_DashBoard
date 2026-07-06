'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { getTradeCloseAt, type Trade } from '@/utils/logParser'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import {
  getCurrentCalendarYear,
  loadHeatmapYearPrefs,
  saveHeatmapYearPrefs,
} from '@/lib/heatmap-year-storage'

function tradeCloseYear(trade: Trade): number | null {
  const closedAt = getTradeCloseAt(trade)
  if (!closedAt) return null
  return Number(formatInTimeZone(closedAt, DISPLAY_TIMEZONE, 'yyyy'))
}

export function getAvailableTradeYears(trades: Trade[]): number[] {
  const years = new Set<number>([getCurrentCalendarYear()])
  for (const trade of trades) {
    const year = tradeCloseYear(trade)
    if (year != null) years.add(year)
  }
  return Array.from(years).sort((a, b) => b - a)
}

export function useHeatmapYear(trades: Trade[]) {
  const [prefs, setPrefs] = useState(loadHeatmapYearPrefs)
  const currentYear = getCurrentCalendarYear()

  const availableYears = useMemo(() => getAvailableTradeYears(trades), [trades])

  const calendarYear = prefs.autoFollowCurrentYear ? currentYear : prefs.manualYear

  useEffect(() => {
    saveHeatmapYearPrefs(prefs)
  }, [prefs])

  const setCalendarYear = useCallback(
    (year: number) => {
      setPrefs({
        autoFollowCurrentYear: year === getCurrentCalendarYear(),
        manualYear: year,
      })
    },
    []
  )

  const setAutoFollowCurrentYear = useCallback((auto: boolean) => {
    setPrefs(prev => ({
      autoFollowCurrentYear: auto,
      manualYear: auto ? getCurrentCalendarYear() : prev.manualYear,
    }))
  }, [])

  return {
    calendarYear,
    availableYears,
    autoFollowCurrentYear: prefs.autoFollowCurrentYear,
    setCalendarYear,
    setAutoFollowCurrentYear,
  }
}
