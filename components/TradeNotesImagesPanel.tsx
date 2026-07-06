'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Trade,
  getTradeId,
  getTradeRMultiple,
  parseLocalTimestamp,
  getTradeEntryTimeMs,
} from '@/utils/logParser'
import { formatUsdPnl } from '@/lib/format'
import { formatWallClockTimeOnly } from '@/lib/timezone'
import {
  normalizeTradeImageSection,
  tradeImageSectionLabel,
  type TradeImageSection,
} from '@/lib/trade-images'
import { SETUP_RATING_TAGS, SETUP_TAG_NAMES, countSetupTagRating } from '@/lib/setup-tags'
import { patchTradeJournal } from '@/lib/trade-journal'
import { useLazyMedia } from '@/hooks/useLazyMedia'
import { format } from 'date-fns'
import { Plus, X, Star } from 'lucide-react'
import { FitImageViewer, FitImageThumbnail } from '@/components/FitImage'

interface TradeImage {
  name: string
  url: string
  note: string
  section?: TradeImageSection
}

function imagesForSection(images: TradeImage[], section: TradeImageSection): TradeImage[] {
  return images.filter(img => normalizeTradeImageSection(img.section) === section)
}

function globalImageIndex(
  images: TradeImage[],
  section: TradeImageSection,
  localIndex: number
): number {
  const sectionImages = imagesForSection(images, section)
  const target = sectionImages[localIndex]
  if (!target) return 0
  const idx = images.findIndex(img => img.name === target.name)
  return idx >= 0 ? idx : 0
}

function StarRatingReadOnly({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map(starIndex => {
        const fillAmount = Math.max(0, Math.min(1, rating - starIndex))
        return (
          <div key={starIndex} className="relative" style={{ width: size, height: size }}>
            <Star className="absolute text-gray-500" size={size} strokeWidth={1.5} />
            <div className="absolute overflow-hidden" style={{ width: `${fillAmount * 100}%` }}>
              <Star className="text-amber-400 fill-amber-400" size={size} strokeWidth={1.5} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export interface TradeNotesImagesPanelProps {
  trade: Trade
  darkMode: boolean
  /** Compact layout for timeline week lists */
  embedded?: boolean
}

export default function TradeNotesImagesPanel({
  trade,
  darkMode,
  embedded = false,
}: TradeNotesImagesPanelProps) {
  const tradeId = getTradeId(trade)
  const [note, setNote] = useState('')
  const [setupTags, setSetupTags] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [activeImageSection, setActiveImageSection] = useState<TradeImageSection>('before')
  const [uploading, setUploading] = useState(false)
  const [tradeImages, setTradeImages] = useState<TradeImage[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [editingImageNote, setEditingImageNote] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beforeInputRef = useRef<HTMLInputElement>(null)
  const afterInputRef = useRef<HTMLInputElement>(null)

  const { loadBatch, updateImages } = useLazyMedia({ tradeIds: [tradeId], batchSize: 1 })

  useEffect(() => {
    void loadBatch([tradeId]).then(({ journal }) => {
      const entry = journal[tradeId]
      if (entry) {
        setNote(entry.note ?? '')
        setSetupTags(entry.setupTags ?? [])
      }
    })
  }, [tradeId, loadBatch])

  useEffect(() => {
    const loadImages = async () => {
      const res = await fetch(`/api/trade-images?tradeId=${encodeURIComponent(tradeId)}`)
      if (res.ok) {
        const data = await res.json()
        setTradeImages(data.images || [])
      }
    }
    void loadImages()
  }, [tradeId])

  const saveJournal = useCallback(
    async (patch: { note?: string; setupTags?: string[]; rating?: number }) => {
      setSaveStatus('saving')
      const result = await patchTradeJournal(tradeId, patch)
      setSaveStatus(result.ok ? 'saved' : 'error')
      if (result.ok) {
        setTimeout(() => setSaveStatus('idle'), 2000)
      }
    },
    [tradeId]
  )

  const scheduleNoteSave = useCallback(
    (content: string) => {
      setNote(content)
      if (noteTimer.current) clearTimeout(noteTimer.current)
      noteTimer.current = setTimeout(() => {
        void saveJournal({ note: content })
      }, 500)
    },
    [saveJournal]
  )

  const toggleSetupTag = useCallback(
    (tagName: string) => {
      if (!SETUP_TAG_NAMES.has(tagName)) return
      setSetupTags(prev => {
        const current = prev.includes(tagName)
          ? prev.filter(t => t !== tagName)
          : [...prev, tagName]
        const rating = countSetupTagRating(current)
        void saveJournal({ setupTags: current, rating })
        return current
      })
    },
    [saveJournal]
  )

  const uploadImages = useCallback(
    async (files: FileList, section: TradeImageSection) => {
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append('tradeId', tradeId)
        formData.append('section', section)
        for (let i = 0; i < files.length; i++) {
          formData.append(`file${i}`, files[i])
        }
        const res = await fetch('/api/trade-images/upload', { method: 'POST', body: formData })
        if (res.ok) {
          const data = await res.json()
          const merged = [...tradeImages, ...(data.files || [])]
          setTradeImages(merged)
          updateImages(tradeId, merged)
        }
      } finally {
        setUploading(false)
      }
    },
    [tradeId, tradeImages, updateImages]
  )

  const saveImageNote = useCallback(
    async (imageName: string, imageNote: string) => {
      await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, note: imageNote }),
      })
      setTradeImages(prev =>
        prev.map(img => (img.name === imageName ? { ...img, note: imageNote } : img))
      )
    },
    [tradeId]
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
      void uploadImages(dt.files, activeImageSection)
    }
  }

  const beforeImages = imagesForSection(tradeImages, 'before')
  const afterImages = imagesForSection(tradeImages, 'after')
  const setupRating = countSetupTagRating(setupTags)

  const selDate = trade.timestamp
    ? format(parseLocalTimestamp(trade.timestamp), 'MMM d, yyyy')
    : 'N/A'
  const entryTime = formatWallClockTimeOnly(trade.entryTime ?? trade.timestamp)
  const pnl = trade.pnl != null ? formatUsdPnl(trade.pnl) : 'N/A'
  const rr = getTradeRMultiple(trade)
  const isWin = (trade.pnl ?? 0) > 0

  const renderImageSection = (
    section: TradeImageSection,
    title: string,
    sectionImages: TradeImage[],
    inputRef: React.RefObject<HTMLInputElement | null>
  ) => (
    <div
      className="flex flex-col min-h-0"
      onMouseEnter={() => setActiveImageSection(section)}
      onFocusCapture={() => setActiveImageSection(section)}
    >
      <label
        className={`block text-sm font-bold mb-2 ${
          section === 'after' ? 'text-purple-400' : 'text-blue-400'
        }`}
      >
        {title}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) {
            void uploadImages(e.target.files, section)
          }
          e.target.value = ''
        }}
        disabled={uploading}
      />
      <div
        className={`min-h-[100px] rounded-lg border overflow-auto p-3 ${
          activeImageSection === section
            ? darkMode
              ? 'bg-gray-900/80 border-blue-500/50 ring-1 ring-blue-500/30'
              : 'bg-white border-blue-400/60 ring-1 ring-blue-400/30'
            : darkMode
              ? 'bg-gray-900/50 border-gray-600'
              : 'bg-gray-50 border-gray-200'
        }`}
      >
        {sectionImages.length === 0 && !uploading ? (
          <div className="min-h-[80px] flex items-center justify-center text-xs text-muted-foreground text-center px-2">
            Paste (Ctrl+V) or add below
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {sectionImages.map((img, idx) => (
              <button
                key={img.name}
                type="button"
                onClick={() => {
                  setLightboxIndex(globalImageIndex(tradeImages, section, idx))
                  setEditingImageNote(img.note || '')
                }}
                className={`aspect-square rounded-lg overflow-hidden border-2 ${
                  darkMode
                    ? 'border-gray-600 hover:border-blue-400'
                    : 'border-gray-300 hover:border-blue-500'
                }`}
              >
                <FitImageThumbnail src={img.url} alt={img.name} darkMode={darkMode} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setActiveImageSection(section)
          inputRef.current?.click()
        }}
        disabled={uploading}
        className={`mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border-2 border-dashed text-xs font-medium ${
          uploading
            ? 'opacity-50 cursor-not-allowed'
            : darkMode
              ? 'border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-400'
              : 'border-gray-300 text-gray-500 hover:border-blue-500 hover:text-blue-500'
        }`}
      >
        <Plus className="h-4 w-4" />
        Add {title.toLowerCase()} image
      </button>
    </div>
  )

  const lightboxImage = lightboxIndex !== null ? tradeImages[lightboxIndex] : null

  return (
    <div
      className={`rounded-xl border ${
        embedded
          ? darkMode
            ? 'bg-gray-900/40 border-gray-700'
            : 'bg-gray-50 border-gray-200'
          : darkMode
            ? 'bg-gray-800 border-gray-700 shadow-lg'
            : 'bg-white border-gray-200 shadow-lg'
      }`}
      onPasteCapture={handlePaste}
    >
      <div
        className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div>
          <h4 className={`font-semibold ${embedded ? 'text-base' : 'text-lg'}`}>
            {selDate} · {entryTime}
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {trade.direction?.toUpperCase() ?? '—'} ·{' '}
            <span className={isWin ? 'text-green-400' : 'text-red-400'}>{pnl}</span>
            {rr !== null && ` · ${rr.toFixed(1)}R`}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </span>
      </div>

      <div className={`p-4 space-y-5 ${embedded ? '' : 'p-6'}`}>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label className="text-sm font-medium text-muted-foreground">Setup tags</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{setupRating}/5 stars</span>
              <StarRatingReadOnly rating={setupRating} size={16} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {SETUP_RATING_TAGS.map(tag => {
              const isSelected = setupTags.includes(tag.name)
              return (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => toggleSetupTag(tag.name)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    isSelected
                      ? `${tag.color} ring-2 ring-amber-400/70`
                      : darkMode
                        ? 'bg-gray-900/60 text-gray-400 border-gray-600 hover:border-gray-500'
                        : 'bg-gray-100 text-gray-600 border-gray-300'
                  }`}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className={`pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <label className="block text-sm font-medium text-muted-foreground mb-2">Notes</label>
          <textarea
            value={note}
            onChange={e => scheduleNoteSave(e.target.value)}
            placeholder="Add notes about this trade..."
            className={`min-h-[120px] w-full px-3 py-2 rounded-lg resize-y text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              darkMode
                ? 'bg-gray-900 border-gray-600 text-gray-100'
                : 'bg-white border-gray-300'
            }`}
            rows={5}
          />
        </div>

        <div className={`pt-4 border-t space-y-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <p className="text-xs text-muted-foreground">
            Paste screenshots with Ctrl+V into the highlighted{' '}
            {tradeImageSectionLabel('before')} or {tradeImageSectionLabel('after')} section.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderImageSection(
              'before',
              tradeImageSectionLabel('before'),
              beforeImages,
              beforeInputRef
            )}
            {renderImageSection(
              'after',
              tradeImageSectionLabel('after'),
              afterImages,
              afterInputRef
            )}
          </div>
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
              <label className="text-sm text-muted-foreground">Screenshot note</label>
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
