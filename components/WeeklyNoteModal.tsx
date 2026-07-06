'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { BookOpen, X, Save } from 'lucide-react'

interface WeeklyNoteModalProps {
  weekKey: string
  initialContent: string
  updatedAt?: string
  darkMode: boolean
  onSave: (weekKey: string, content: string) => Promise<void>
  onClose: () => void
}

export default function WeeklyNoteModal({
  weekKey,
  initialContent,
  updatedAt,
  darkMode,
  onSave,
  onClose
}: WeeklyNoteModalProps) {
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)

  // Reset content when weekKey changes
  useEffect(() => {
    setContent(initialContent)
  }, [weekKey, initialContent])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSave(weekKey, content)
    } finally {
      setIsSaving(false)
    }
  }, [weekKey, content, onSave])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, handleSave])

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div 
        className={`relative w-full max-w-2xl mx-4 rounded-xl shadow-2xl ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-semibold">
              Week {weekKey.split('-W')[1]} Recap
            </h2>
            <span className="text-sm text-muted-foreground">
              ({weekKey})
            </span>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          <label className="block text-sm font-medium mb-2">
            What did you learn this week?
          </label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Summarize key lessons, patterns observed, mistakes made, and improvements for next week..."
            className={`w-full h-48 px-4 py-3 rounded-lg border resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              darkMode 
                ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500' 
                : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400'
            }`}
            autoFocus
          />
          
          <div className="flex items-center justify-between mt-2">
            {updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last updated: {format(new Date(updatedAt), 'MMM d, yyyy h:mm a')}
              </p>
            )}
            <p className="text-xs text-muted-foreground ml-auto">
              Press Ctrl+S to save
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              isSaving
                ? 'bg-indigo-400 cursor-wait'
                : 'bg-indigo-500 hover:bg-indigo-600'
            } text-white`}
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Recap'}
          </button>
        </div>
      </div>
    </div>
  )
}
