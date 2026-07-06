'use client'

import React, { useState } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CustomCalendar } from './CustomCalendar'
import { Button } from '@/components/ui/button'

interface DatePickerDropdownProps {
  selectedDate?: Date
  onDateSelect: (date: Date | undefined) => void
  placeholder?: string
  className?: string
}

export function DatePickerDropdown({
  selectedDate,
  onDateSelect,
  placeholder = 'Select start date',
  className = ''
}: DatePickerDropdownProps) {
  const [open, setOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date())

  // Sync current month when dropdown opens or selectedDate changes
  React.useEffect(() => {
    if (open || selectedDate) {
      setCurrentMonth(selectedDate || new Date())
    }
  }, [open, selectedDate])

  const handleSelect = (date: Date) => {
    onDateSelect(date)
    setOpen(false)
  }

  const handleClear = () => {
    onDateSelect(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`inline-flex items-center justify-between gap-2 min-w-[200px] ${className}`}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className={selectedDate ? '' : 'text-muted-foreground'}>
            {selectedDate ? `Since ${format(selectedDate, 'MMM d, yyyy')}` : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          {/* Month navigation */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <button
              type="button"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-base font-semibold">{format(currentMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <CustomCalendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            month={currentMonth}
            showNavigation={false}
          />
          <div className="flex gap-2 p-3 border-t">
            <Button variant="outline" size="sm" className="flex-1" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
