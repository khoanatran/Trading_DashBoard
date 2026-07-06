'use client'

import React, { useMemo } from 'react'
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  addDays, 
  isSameMonth, 
  isSameDay,
  isWithinInterval,
  addMonths,
  subMonths
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CustomCalendarProps {
  mode: 'single' | 'range'
  selected?: Date
  dateRange?: { from?: Date; to?: Date }
  onSelect?: (date: Date) => void
  onRangeSelect?: (range: { from?: Date; to?: Date }) => void
  className?: string
  month?: Date
  showNavigation?: boolean
}

export function CustomCalendar({
  mode,
  selected,
  dateRange,
  onSelect,
  onRangeSelect,
  className = '',
  month,
  showNavigation = true
}: CustomCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(month || new Date())
  
  // Update currentMonth when month prop changes
  React.useEffect(() => {
    if (month) {
      setCurrentMonth(month)
    }
  }, [month])
  
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const startDate = startOfWeek(monthStart)
  const endDate = endOfWeek(monthEnd)

  const days = useMemo(() => {
    const days = []
    let day = startDate
    while (day <= endDate) {
      days.push(day)
      day = addDays(day, 1)
    }
    return days
  }, [startDate, endDate])

  const handleDateClick = (date: Date) => {
    if (mode === 'single' && onSelect) {
      onSelect(date)
    } else if (mode === 'range' && onRangeSelect) {
      if (!dateRange?.from || (dateRange.from && dateRange.to)) {
        // Start new range
        onRangeSelect({ from: date, to: undefined })
      } else {
        // Complete the range
        if (date < dateRange.from) {
          onRangeSelect({ from: date, to: dateRange.from })
        } else {
          onRangeSelect({ from: dateRange.from, to: date })
        }
      }
    }
  }

  const isInRange = (date: Date) => {
    if (mode !== 'range' || !dateRange?.from || !dateRange?.to) return false
    return isWithinInterval(date, { start: dateRange.from, end: dateRange.to })
  }

  const isRangeStart = (date: Date) => {
    if (mode !== 'range' || !dateRange?.from) return false
    return isSameDay(date, dateRange.from)
  }

  const isRangeEnd = (date: Date) => {
    if (mode !== 'range' || !dateRange?.to) return false
    return isSameDay(date, dateRange.to)
  }

  const isToday = (date: Date) => isSameDay(date, new Date())
  const isSelected = (date: Date) => selected ? isSameDay(date, selected) : false
  const isCurrentMonth = (date: Date) => isSameMonth(date, currentMonth)

  return (
    <div className={`p-6 ${className}`}>
      {/* Header */}
      {showNavigation ? (
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-accent rounded-md transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="mb-6 text-center">
          <h2 className="text-lg font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <div
            key={day}
            className="h-10 w-12 flex items-center justify-center text-sm font-semibold text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          const today = isToday(day)
          const selected = isSelected(day)
          const inRange = isInRange(day)
          const rangeStart = isRangeStart(day)
          const rangeEnd = isRangeEnd(day)
          const currentMonth = isCurrentMonth(day)

          let buttonClasses = 'h-11 w-12 flex items-center justify-center text-base rounded-md transition-all relative '
          
          if (!currentMonth) {
            buttonClasses += 'text-muted-foreground opacity-40 '
          }
          
          if (mode === 'single') {
            if (selected) {
              buttonClasses += 'bg-primary text-primary-foreground font-bold '
            } else if (today) {
              buttonClasses += 'ring-2 ring-primary ring-inset font-bold bg-accent text-accent-foreground '
            } else {
              buttonClasses += 'hover:bg-accent hover:text-accent-foreground '
            }
          } else if (mode === 'range') {
            if (rangeStart || rangeEnd) {
              buttonClasses += 'bg-primary text-primary-foreground font-bold z-10 '
              if (rangeStart && rangeEnd) {
                buttonClasses += 'rounded-md '
              } else if (rangeStart) {
                buttonClasses += 'rounded-r-none '
              } else if (rangeEnd) {
                buttonClasses += 'rounded-l-none '
              }
            } else if (inRange) {
              buttonClasses += 'bg-primary/30 text-primary-foreground rounded-none '
            } else if (today) {
              buttonClasses += 'ring-2 ring-primary ring-inset font-bold bg-accent text-accent-foreground '
            } else {
              buttonClasses += 'hover:bg-accent hover:text-accent-foreground '
            }
          }

          // Background for range
          let containerClasses = 'relative '
          if (mode === 'range' && inRange && !rangeStart && !rangeEnd) {
            containerClasses += 'before:absolute before:inset-y-0 before:inset-x-0 before:bg-primary/20 '
          } else if (rangeStart && !rangeEnd && dateRange?.from) {
            containerClasses += 'before:absolute before:inset-y-0 before:right-0 before:left-1/2 before:bg-primary/20 '
          } else if (rangeEnd && !rangeStart && dateRange?.to) {
            containerClasses += 'before:absolute before:inset-y-0 before:left-0 before:right-1/2 before:bg-primary/20 '
          }

          return (
            <div key={index} className={containerClasses}>
              <button
                onClick={() => handleDateClick(day)}
                className={buttonClasses}
                disabled={!currentMonth}
              >
                {format(day, 'd')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

