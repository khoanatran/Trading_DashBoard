'use client'

import React, { useState } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { Calendar as CalendarIcon, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { CustomCalendar } from './CustomCalendar'

interface DateRange {
  from?: Date
  to?: Date
}

interface CustomDateRangePickerProps {
  dateRange?: DateRange
  onDateRangeChange: (range: DateRange | undefined) => void
  className?: string
}

export function CustomDateRangePicker({
  dateRange,
  onDateRangeChange,
  className = ''
}: CustomDateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const handleRangeSelect = (range: DateRange) => {
    onDateRangeChange(range)
    // Close when both dates are selected
    if (range.from && range.to) {
      setTimeout(() => setIsOpen(false), 200)
    }
  }

  const handlePreset = (days: number) => {
    const today = new Date()
    const pastDate = new Date()
    pastDate.setDate(today.getDate() - days)
    onDateRangeChange({ from: pastDate, to: today })
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-start gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 w-[350px] text-left"
      >
        <CalendarIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {dateRange?.from ? (
            dateRange.to ? (
              <>
                {format(dateRange.from, 'LLL dd, y')} - {format(dateRange.to, 'LLL dd, y')}
              </>
            ) : (
              format(dateRange.from, 'LLL dd, y')
            )
          ) : (
            <span className="text-muted-foreground">Pick a date range</span>
          )}
        </span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            {/* Navigation Header */}
            <div className="flex items-center justify-center gap-10 px-6 py-4 border-b bg-card">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-2.5 hover:bg-accent rounded-lg transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-10 text-base font-semibold min-w-[420px] justify-center">
                <span>{format(currentMonth, 'MMMM yyyy')}</span>
                <span className="text-muted-foreground">—</span>
                <span>{format(addMonths(currentMonth, 1), 'MMMM yyyy')}</span>
              </div>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-2.5 hover:bg-accent rounded-lg transition-colors"
                aria-label="Next month"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="flex">
              <CustomCalendar
                mode="range"
                dateRange={dateRange}
                onRangeSelect={handleRangeSelect}
                month={currentMonth}
                showNavigation={false}
                className="border-r"
              />
              <CustomCalendar
                mode="range"
                dateRange={dateRange}
                onRangeSelect={handleRangeSelect}
                month={addMonths(currentMonth, 1)}
                showNavigation={false}
              />
            </div>
            <div className="px-6 py-5 border-t flex gap-4 bg-card">
              <button
                onClick={() => {
                  onDateRangeChange(undefined)
                  setIsOpen(false)
                }}
                className="flex-1 px-5 py-3 text-sm font-medium rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  handlePreset(7)
                  setIsOpen(false)
                }}
                className="flex-1 px-5 py-3 text-sm font-medium rounded-lg bg-accent hover:bg-accent/80 transition-colors"
              >
                Last 7 Days
              </button>
              <button
                onClick={() => {
                  handlePreset(30)
                  setIsOpen(false)
                }}
                className="flex-1 px-5 py-3 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Last 30 Days
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

