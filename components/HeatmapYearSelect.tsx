'use client'

interface HeatmapYearSelectProps {
  calendarYear: number
  availableYears: number[]
  autoFollowCurrentYear: boolean
  onCalendarYearChange: (year: number) => void
  onAutoFollowCurrentYearChange: (auto: boolean) => void
  darkMode: boolean
}

export default function HeatmapYearSelect({
  calendarYear,
  availableYears,
  autoFollowCurrentYear,
  onCalendarYearChange,
  onAutoFollowCurrentYearChange,
  darkMode,
}: HeatmapYearSelectProps) {
  const years =
    availableYears.includes(calendarYear)
      ? availableYears
      : [calendarYear, ...availableYears].sort((a, b) => b - a)

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={calendarYear}
        onChange={event => onCalendarYearChange(Number(event.target.value))}
        className={`h-7 rounded-full border px-2 text-xs font-medium ${
          darkMode
            ? 'border-gray-600 bg-gray-800/60 text-foreground'
            : 'border-border bg-muted/40 text-foreground'
        }`}
        aria-label="Calendar year"
      >
        {years.map(year => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onAutoFollowCurrentYearChange(!autoFollowCurrentYear)}
        className={`px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
          autoFollowCurrentYear
            ? darkMode
              ? 'bg-gray-700 text-foreground'
              : 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        } ${darkMode ? 'border border-gray-600' : 'border border-border'}`}
        title="Follow the current calendar year automatically"
      >
        Auto
      </button>
    </div>
  )
}
