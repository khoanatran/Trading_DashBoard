export interface HeatmapYearPrefs {
  autoFollowCurrentYear: boolean
  manualYear: number
}

const STORAGE_KEY = 'heatmapCalendarYearPrefs'

export function getCurrentCalendarYear(): number {
  return new Date().getFullYear()
}

export function loadHeatmapYearPrefs(): HeatmapYearPrefs {
  if (typeof window === 'undefined') {
    const year = getCurrentCalendarYear()
    return { autoFollowCurrentYear: true, manualYear: year }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const year = getCurrentCalendarYear()
      return { autoFollowCurrentYear: true, manualYear: year }
    }
    const parsed = JSON.parse(raw) as Partial<HeatmapYearPrefs>
    const manualYear =
      typeof parsed.manualYear === 'number' && Number.isFinite(parsed.manualYear)
        ? parsed.manualYear
        : getCurrentCalendarYear()
    return {
      autoFollowCurrentYear: parsed.autoFollowCurrentYear !== false,
      manualYear,
    }
  } catch {
    const year = getCurrentCalendarYear()
    return { autoFollowCurrentYear: true, manualYear: year }
  }
}

export function saveHeatmapYearPrefs(prefs: HeatmapYearPrefs): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}
