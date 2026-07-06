'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { FitImageViewer, FitImageThumbnail } from '@/components/FitImage'

interface DailyImage {
  name: string
  url: string
  note: string
}

export interface DailySummaryPanelProps {
  dateKey: string
  dateLabel: string
  darkMode: boolean
}

export default function DailySummaryPanel({
  dateKey,
  dateLabel,
  darkMode,
}: DailySummaryPanelProps) {
  const [note, setNote] = useState('')
  const [images, setImages] = useState<DailyImage[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [uploading, setUploading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [editingImageNote, setEditingImageNote] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    try {
      const [noteRes, imgRes] = await Promise.all([
        fetch(`/api/daily-summary?dateKey=${encodeURIComponent(dateKey)}`),
        fetch(`/api/daily-summary/images?dateKey=${encodeURIComponent(dateKey)}`),
      ])
      if (noteRes.ok) {
        const data = await noteRes.json()
        setNote(data.note ?? '')
      }
      if (imgRes.ok) {
        const data = await imgRes.json()
        setImages(data.images ?? [])
      }
    } catch (err) {
      console.error('Failed to load daily summary:', err)
    }
  }, [dateKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const saveNote = useCallback(
    async (content: string) => {
      setSaveStatus('saving')
      try {
        const res = await fetch('/api/daily-summary', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateKey, note: content }),
        })
        setSaveStatus(res.ok ? 'saved' : 'error')
        if (res.ok) {
          setTimeout(() => setSaveStatus('idle'), 2000)
        }
      } catch {
        setSaveStatus('error')
      }
    },
    [dateKey]
  )

  const scheduleNoteSave = useCallback(
    (content: string) => {
      setNote(content)
      if (noteTimer.current) clearTimeout(noteTimer.current)
      noteTimer.current = setTimeout(() => {
        void saveNote(content)
      }, 500)
    },
    [saveNote]
  )

  const uploadImages = useCallback(
    async (files: FileList) => {
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('dateKey', dateKey)
        for (let i = 0; i < files.length; i++) {
          formData.append(`file${i}`, files[i])
        }
        const res = await fetch('/api/daily-summary/images/upload', {
          method: 'POST',
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          setImages(prev => [...prev, ...(data.files || [])])
        }
      } finally {
        setUploading(false)
      }
    },
    [dateKey]
  )

  const saveImageNote = useCallback(
    async (imageName: string, imageNote: string) => {
      await fetch('/api/daily-summary/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey, name: imageName, note: imageNote }),
      })
      setImages(prev =>
        prev.map(img => (img.name === imageName ? { ...img, note: imageNote } : img))
      )
    },
    [dateKey]
  )

  const handlePaste = (e: React.ClipboardEvent) => {
    const data = e.clipboardData
    if (!data) return
    const files: File[] = []
    if (data.files?.length) {
      for (let i = 0; i < data.files.length; i++) {
        const f = data.files[i]
        if (f.type?.startsWith('image/')) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      const dt = new DataTransfer()
      files.forEach(f => dt.items.add(f))
      void uploadImages(dt.files)
    }
  }

  const lightboxImage = lightboxIndex !== null ? images[lightboxIndex] : null

  const shell = darkMode
    ? 'bg-indigo-950/70 border-indigo-500/35 shadow-indigo-950/40 ring-1 ring-indigo-400/20'
    : 'bg-indigo-50/90 border-indigo-300 shadow-indigo-200/50 ring-1 ring-indigo-200/80'

  const header = darkMode
    ? 'border-indigo-500/30 bg-indigo-900/40'
    : 'border-indigo-200 bg-indigo-100/60'

  const panel = darkMode
    ? 'bg-indigo-950/50 border-indigo-600/40'
    : 'bg-white/80 border-indigo-200'

  const input = darkMode
    ? 'bg-indigo-950/80 border-indigo-600/50 text-indigo-50 placeholder:text-indigo-300/50'
    : 'bg-white border-indigo-200 text-gray-900 placeholder:text-indigo-400/60'

  const dashedBtn = darkMode
    ? 'border-indigo-500/40 text-indigo-300 hover:border-indigo-400 hover:text-indigo-200 hover:bg-indigo-900/30'
    : 'border-indigo-300 text-indigo-700 hover:border-indigo-500 hover:text-indigo-800 hover:bg-indigo-50'

  const thumbBorder = darkMode
    ? 'border-indigo-600/60 hover:border-indigo-400'
    : 'border-indigo-200 hover:border-indigo-500'

  return (
    <div
      className={`rounded-xl border-l-4 border-l-indigo-500 border shadow-lg ${shell}`}
      onPasteCapture={handlePaste}
    >
      <div className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-2 ${header}`}>
        <div>
          <h3 className={`text-xl font-semibold ${darkMode ? 'text-indigo-100' : 'text-indigo-950'}`}>
            Daily Summary
          </h3>
          <p className={`text-sm mt-0.5 ${darkMode ? 'text-indigo-300/90' : 'text-indigo-700'}`}>
            {dateLabel} (ET)
          </p>
          <p className={`text-xs mt-1 ${darkMode ? 'text-indigo-400/80' : 'text-indigo-600/90'}`}>
            Day-level recap — separate from individual trade journal entries below.
          </p>
        </div>
        <span className={`text-xs ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </span>
      </div>

      <div className="p-6 space-y-6">
        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              darkMode ? 'text-indigo-200' : 'text-indigo-800'
            }`}
          >
            Images
          </label>
          <p className={`text-xs mb-3 ${darkMode ? 'text-indigo-400/90' : 'text-indigo-600'}`}>
            Paste screenshots with Ctrl+V or add files below.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files?.length) {
                void uploadImages(e.target.files)
              }
              e.target.value = ''
            }}
            disabled={uploading}
          />
          <div className={`min-h-[160px] rounded-lg border overflow-auto p-4 ${panel}`}>
            {images.length === 0 && !uploading ? (
              <div
                className={`min-h-[120px] flex items-center justify-center text-sm text-center px-4 ${
                  darkMode ? 'text-indigo-400/80' : 'text-indigo-600/90'
                }`}
              >
                No images yet — paste or upload screenshots for today.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {images.map((img, idx) => (
                  <button
                    key={img.name}
                    type="button"
                    onClick={() => {
                      setLightboxIndex(idx)
                      setEditingImageNote(img.note || '')
                    }}
                    className={`aspect-square rounded-lg overflow-hidden border-2 ${thumbBorder}`}
                  >
                    <FitImageThumbnail src={img.url} alt={img.name} darkMode={darkMode} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`mt-3 flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg border-2 border-dashed text-sm font-medium transition-all ${
              uploading ? 'opacity-50 cursor-not-allowed' : dashedBtn
            }`}
          >
            <Plus className="h-4 w-4" />
            Add image
          </button>
        </div>

        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              darkMode ? 'text-indigo-200' : 'text-indigo-800'
            }`}
          >
            Note
          </label>
          <textarea
            value={note}
            onChange={e => scheduleNoteSave(e.target.value)}
            placeholder="Write your daily summary, lessons, and reflections..."
            className={`min-h-[200px] w-full px-4 py-3 rounded-lg resize-y text-base border focus:outline-none focus:ring-2 focus:ring-indigo-500/70 ${input}`}
            rows={8}
          />
        </div>
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className={`relative max-w-4xl w-full max-h-[90vh] flex flex-col rounded-lg overflow-hidden ${
              darkMode ? 'bg-gray-900' : 'bg-white'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-2 right-2 z-10 p-2 rounded-lg bg-black/50 text-white"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4">
              <FitImageViewer
                src={lightboxImage.url}
                alt={lightboxImage.name}
                maxHeight="calc(90vh - 12rem)"
              />
            </div>
            <div className={`p-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <label className="text-sm text-muted-foreground">Image caption</label>
              <textarea
                value={editingImageNote}
                onChange={e => setEditingImageNote(e.target.value)}
                onBlur={() => void saveImageNote(lightboxImage.name, editingImageNote)}
                className={`mt-2 w-full px-3 py-2 rounded-lg text-sm border resize-none ${
                  darkMode ? 'bg-gray-800 border-gray-600' : 'bg-gray-50 border-gray-300'
                }`}
                rows={2}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
