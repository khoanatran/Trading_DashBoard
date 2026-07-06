'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Trade, calculateStats, getARateBreakdown, parseLocalTimestamp, getTradeId, getTradeRMultiple, getPartialExitRMultiple, getTradeResult, classifyTradeResult, isASetupTrade } from '@/utils/logParser'
import { formatUsdPnl, formatUsdPnlOrNa } from '@/lib/format'
import { formatInTimeZone } from 'date-fns-tz'
import { DISPLAY_TIMEZONE, formatWallClockTimeOnly } from '@/lib/timezone'
import { ChevronDown, ChevronRight, ChevronLeft, ImagePlus, X, Trash2, ZoomIn, ZoomOut, RotateCcw, Pen, Eraser, Undo2, Trash, Circle, ChevronsDownUp, ChevronsUpDown, Video, Play, Pause, Scissors, Save, Film } from 'lucide-react'
import { format } from 'date-fns'

interface PerformanceTableProps {
  groupedData: Record<string, Trade[]>
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  darkMode: boolean
  onPeriodClick?: (periodKey: string, period: 'daily' | 'weekly' | 'monthly' | 'yearly') => void
  tradeTags?: Record<string, string[]>
  showTitle?: boolean
}

interface TradeImage {
  name: string
  url: string
  note: string
  drawings?: DrawingStroke[]
}

interface DrawingPoint {
  x: number
  y: number
}

interface DrawingStroke {
  points: DrawingPoint[]
  color: string
  size: number
  tool: 'pen' | 'highlighter' | 'eraser'
}

interface TradeVideo {
  id: string
  originalName: string
  mp4FileName: string
  thumbFileName?: string
  durationSec?: number
  clipStartSec?: number
  clipEndSec?: number
  createdAt: string
  url: string
  thumbUrl: string | null
}

// Format price with commas (e.g., 25720.75 -> 25,720.75)
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return 'N/A'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const COL_TOTAL_GAINS = 'Total Gains'
const COL_TOTAL_LOSSES = 'Total Losses'
const COL_PNL_PCT_GAINS_LOSS = 'P&L % of G+L'

function formatPnLPctOfGainsLoss(pnl: number, gains: number, losses: number): string {
  const gross = gains + losses
  if (gross <= 0) return 'N/A'
  return `${((pnl / gross) * 100).toFixed(1)}%`
}

function pnlPctOfGainsLossColor(pnl: number, gains: number, losses: number): string {
  const gross = gains + losses
  if (gross <= 0) return ''
  const pct = (pnl / gross) * 100
  return pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-muted-foreground'
}

// Helper function to get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// Format period key for display (adds month name to weekly format)
function formatPeriodLabel(periodKey: string): string {
  // Check if it's a weekly format: YYYY-WXX
  const weekMatch = periodKey.match(/^(\d{4})-W(\d{2})$/)
  if (weekMatch) {
    const year = parseInt(weekMatch[1])
    const weekNum = parseInt(weekMatch[2])
    
    // Calculate the date for the start of that week
    const jan4 = new Date(year, 0, 4)
    const jan4Day = jan4.getDay()
    const weekStart = new Date(jan4)
    weekStart.setDate(jan4.getDate() - jan4Day + (weekNum - 1) * 7)
    
    // Get month abbreviation
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = monthNames[weekStart.getMonth()]
    
    return `${month} ${year} - Week ${weekNum}`
  }
  
  // Check if it's a monthly format: YYYY-MM
  const monthMatch = periodKey.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const year = parseInt(monthMatch[1])
    const monthNum = parseInt(monthMatch[2])
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[monthNum - 1]} ${year}`
  }
  
  // Return as-is for other formats
  return periodKey
}

/** NYC calendar date for grouping/sorting (YYYY-MM-DD). */
function getTradeNycDayKey(timestamp: string): string {
  return formatInTimeZone(parseLocalTimestamp(timestamp), DISPLAY_TIMEZONE, 'yyyy-MM-dd')
}

function sortTradesNewestFirst(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    const ta = a.timestamp ? parseLocalTimestamp(a.timestamp).getTime() : 0
    const tb = b.timestamp ? parseLocalTimestamp(b.timestamp).getTime() : 0
    return tb - ta
  })
}

function sortDayKeysNewestFirst(dayKeys: string[]): string[] {
  return [...dayKeys].sort((a, b) => b.localeCompare(a))
}

export default function PerformanceTable({ groupedData, period, darkMode, onPeriodClick, tradeTags, showTitle = true }: PerformanceTableProps) {
  const periods = Object.keys(groupedData).sort().reverse() // Most recent first

  const formatARateCell = (tradeList: Trade[]) => {
    const { decisiveTrades, aRate } = getARateBreakdown(tradeList, tradeTags)
    return decisiveTrades > 0 ? `${aRate.toFixed(1)}%` : 'N/A'
  }
  
  // State for tracking expanded rows at each level
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set())
  
  // State for trade images
  const [tradeImages, setTradeImages] = useState<Record<string, TradeImage[]>>({})
  const [uploadingTrades, setUploadingTrades] = useState<Set<string>>(new Set())
  
  // Slideshow modal state
  const [modalState, setModalState] = useState<{
    tradeId: string
    imageIndex: number
  } | null>(null)
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  // Note editing state
  const [editingNote, setEditingNote] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  
  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [drawingTool, setDrawingTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen')
  const [drawingColor, setDrawingColor] = useState('#ef4444') // Red default
  const [brushSize, setBrushSize] = useState(3)
  const [strokes, setStrokes] = useState<DrawingStroke[]>([])
  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isSavingDrawing, setIsSavingDrawing] = useState(false)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const imageContainerRef = React.useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
  // Video state
  const [tradeVideos, setTradeVideos] = useState<Record<string, TradeVideo[]>>({})
  const [uploadingVideos, setUploadingVideos] = useState<Set<string>>(new Set())
  const [videoModalState, setVideoModalState] = useState<{
    tradeId: string
    videoIndex: number
  } | null>(null)
  
  // Video preview modal state (for trimming before upload)
  const [videoPreviewState, setVideoPreviewState] = useState<{
    tradeId: string
    file: File
    localUrl: string
  } | null>(null)
  
  // Video trimming state
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [isClipping, setIsClipping] = useState(false)
  const [videoZoom, setVideoZoom] = useState(1)
  const [videoPanning, setVideoPanning] = useState(false)
  const [videoPanStart, setVideoPanStart] = useState({ x: 0, y: 0 })
  const videoContainerRef = useRef<HTMLDivElement>(null)
  
  // Video pan handlers
  const handleVideoPanStart = useCallback((e: React.MouseEvent) => {
    if (videoZoom <= 1) return
    setVideoPanning(true)
    setVideoPanStart({ x: e.clientX, y: e.clientY })
  }, [videoZoom])
  
  const handleVideoPanMove = useCallback((e: React.MouseEvent) => {
    if (!videoPanning || !videoContainerRef.current) return
    const dx = videoPanStart.x - e.clientX
    const dy = videoPanStart.y - e.clientY
    videoContainerRef.current.scrollLeft += dx
    videoContainerRef.current.scrollTop += dy
    setVideoPanStart({ x: e.clientX, y: e.clientY })
  }, [videoPanning, videoPanStart])
  
  const handleVideoPanEnd = useCallback(() => {
    setVideoPanning(false)
  }, [])
  
  // Collect all unique tradeIds from the grouped data
  const allTradeIds = React.useMemo(() => {
    const ids = new Set<string>()
    Object.values(groupedData).forEach(trades => {
      trades.forEach(trade => {
        ids.add(getTradeId(trade))
      })
    })
    return Array.from(ids)
  }, [groupedData])
  
  // Fetch images for all trades on mount/when trades change
  useEffect(() => {
    const fetchAllImages = async () => {
      const newImages: Record<string, TradeImage[]> = {}
      
      await Promise.all(
        allTradeIds.map(async (tradeId) => {
          try {
            const res = await fetch(`/api/trade-images?tradeId=${encodeURIComponent(tradeId)}`)
            if (res.ok) {
              const data = await res.json()
              if (data.images && data.images.length > 0) {
                newImages[tradeId] = data.images
              }
            }
          } catch (err) {
            console.error('Failed to fetch images for trade:', tradeId, err)
          }
        })
      )
      
      setTradeImages(newImages)
    }
    
    if (allTradeIds.length > 0) {
      fetchAllImages()
    }
  }, [allTradeIds])
  
  // Fetch videos for all trades
  useEffect(() => {
    const fetchAllVideos = async () => {
      const newVideos: Record<string, TradeVideo[]> = {}
      
      await Promise.all(
        allTradeIds.map(async (tradeId) => {
          try {
            const res = await fetch(`/api/trade-videos?tradeId=${encodeURIComponent(tradeId)}`)
            if (res.ok) {
              const data = await res.json()
              if (data.videos && data.videos.length > 0) {
                newVideos[tradeId] = data.videos
              }
            }
          } catch (err) {
            console.error('Failed to fetch videos for trade:', tradeId, err)
          }
        })
      )
      
      setTradeVideos(newVideos)
    }
    
    if (allTradeIds.length > 0) {
      fetchAllVideos()
    }
  }, [allTradeIds])
  
  // Open preview modal when user selects a video
  const handleVideoSelect = useCallback((tradeId: string, files: FileList) => {
    if (files.length === 0) return
    const file = files[0]
    const localUrl = URL.createObjectURL(file)
    setVideoPreviewState({ tradeId, file, localUrl })
    setTrimStart(0)
    setTrimEnd(0)
    setVideoCurrentTime(0)
    setIsVideoPlaying(false)
  }, [])
  
  // Close preview modal
  const closeVideoPreview = useCallback(() => {
    if (videoPreviewState?.localUrl) {
      URL.revokeObjectURL(videoPreviewState.localUrl)
    }
    setVideoPreviewState(null)
    setTrimStart(0)
    setTrimEnd(0)
    setVideoCurrentTime(0)
    setIsVideoPlaying(false)
  }, [videoPreviewState])
  
  // Upload trimmed clip
  const uploadTrimmedClip = useCallback(async () => {
    if (!videoPreviewState) return
    const { tradeId, file } = videoPreviewState
    const clipDuration = trimEnd - trimStart
    
    if (clipDuration <= 0 || clipDuration > 600) {
      alert('Clip must be between 0 and 10 minutes')
      return
    }
    
    setIsClipping(true)
    setUploadingVideos(prev => new Set(prev).add(tradeId))
    
    try {
      const formData = new FormData()
      formData.append('tradeId', tradeId)
      formData.append('file0', file)
      formData.append('trimStart', trimStart.toString())
      formData.append('trimEnd', trimEnd.toString())
      
      // Use XMLHttpRequest for progress
      const uploadPromise = new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            console.log(`Upload progress: ${Math.round((e.loaded / e.total) * 100)}%`)
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(new Response(xhr.responseText, { status: xhr.status }))
          } else {
            reject(new Error(xhr.responseText))
          }
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('POST', '/api/trade-videos/upload')
        xhr.send(formData)
      })
      
      const res = await uploadPromise
      
      if (res.ok) {
        const data = await res.json()
        setTradeVideos(prev => ({
          ...prev,
          [tradeId]: [...(prev[tradeId] || []), ...data.videos]
        }))
        closeVideoPreview()
      } else {
        const error = await res.json()
        alert(error.error || 'Failed to upload video')
      }
    } catch (err) {
      console.error('Video upload error:', err)
      alert('Failed to upload video')
    } finally {
      setIsClipping(false)
      setUploadingVideos(prev => {
        const next = new Set(prev)
        next.delete(tradeId)
        return next
      })
    }
  }, [videoPreviewState, trimStart, trimEnd, closeVideoPreview])
  
  // Delete a video
  const deleteVideo = useCallback(async (tradeId: string, videoId: string) => {
    try {
      const res = await fetch(`/api/trade-videos?tradeId=${encodeURIComponent(tradeId)}&videoId=${encodeURIComponent(videoId)}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setTradeVideos(prev => {
          const updated = (prev[tradeId] || []).filter(v => v.id !== videoId)
          return { ...prev, [tradeId]: updated }
        })
        
        if (videoModalState?.tradeId === tradeId) {
          const videos = tradeVideos[tradeId] || []
          if (videos.length <= 1) {
            closeVideoModal()
          } else if (videoModalState.videoIndex >= videos.length - 1) {
            setVideoModalState(prev => prev ? { ...prev, videoIndex: Math.max(0, prev.videoIndex - 1) } : null)
          }
        }
      }
    } catch (err) {
      console.error('Delete video error:', err)
    }
  }, [videoModalState, tradeVideos])
  
  // Create video clip
  const createVideoClip = useCallback(async () => {
    if (!videoModalState) return
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    const currentVideo = videos[videoModalState.videoIndex]
    if (!currentVideo) return
    
    if (trimEnd <= trimStart) {
      alert('End time must be after start time')
      return
    }
    
    setIsClipping(true)
    
    try {
      const res = await fetch('/api/trade-videos/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: videoModalState.tradeId,
          videoId: currentVideo.id,
          startSec: trimStart,
          endSec: trimEnd
        })
      })
      
      if (res.ok) {
        const data = await res.json()
        setTradeVideos(prev => ({
          ...prev,
          [videoModalState.tradeId]: [...(prev[videoModalState.tradeId] || []), data.clip]
        }))
        alert('Clip created successfully!')
      } else {
        const error = await res.json()
        alert(error.error || 'Failed to create clip')
      }
    } catch (err) {
      console.error('Clip error:', err)
      alert('Failed to create clip')
    } finally {
      setIsClipping(false)
    }
  }, [videoModalState, tradeVideos, trimStart, trimEnd])
  
  // Open video modal
  const openVideoModal = useCallback((tradeId: string, videoIndex: number = 0) => {
    const videos = tradeVideos[tradeId] || []
    const currentVideo = videos[videoIndex]
    setVideoModalState({ tradeId, videoIndex })
    setTrimStart(0)
    setTrimEnd(currentVideo?.durationSec || 0)
    setIsVideoPlaying(false)
    setVideoCurrentTime(0)
  }, [tradeVideos])
  
  // Close video modal
  const closeVideoModal = useCallback(() => {
    setVideoModalState(null)
    setIsVideoPlaying(false)
    setVideoCurrentTime(0)
    setTrimStart(0)
    setTrimEnd(0)
  }, [])
  
  // Navigate video slideshow
  const navigateVideoSlideshow = useCallback((direction: 'prev' | 'next') => {
    if (!videoModalState) return
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    if (videos.length === 0) return
    
    let newIndex = videoModalState.videoIndex
    if (direction === 'prev') {
      newIndex = (newIndex - 1 + videos.length) % videos.length
    } else {
      newIndex = (newIndex + 1) % videos.length
    }
    
    const newVideo = videos[newIndex]
    setVideoModalState({ ...videoModalState, videoIndex: newIndex })
    setTrimStart(0)
    setTrimEnd(newVideo?.durationSec || 0)
    setIsVideoPlaying(false)
    setVideoCurrentTime(0)
  }, [videoModalState, tradeVideos])
  
  // Format time to mm:ss
  const formatVideoTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Upload images for a trade
  const uploadImages = useCallback(async (tradeId: string, files: FileList) => {
    setUploadingTrades(prev => new Set(prev).add(tradeId))
    
    try {
      const formData = new FormData()
      formData.append('tradeId', tradeId)
      
      for (let i = 0; i < files.length; i++) {
        formData.append(`file${i}`, files[i])
      }
      
      const res = await fetch('/api/trade-images/upload', {
        method: 'POST',
        body: formData
      })
      
      if (res.ok) {
        const data = await res.json()
        // Update local state with new images
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: [...(prev[tradeId] || []), ...data.files]
        }))
      } else {
        console.error('Upload failed')
      }
    } catch (err) {
      console.error('Upload error:', err)
    } finally {
      setUploadingTrades(prev => {
        const next = new Set(prev)
        next.delete(tradeId)
        return next
      })
    }
  }, [])
  
  // Delete an image
  const deleteImage = useCallback(async (tradeId: string, imageName: string) => {
    try {
      const res = await fetch(`/api/trade-images?tradeId=${encodeURIComponent(tradeId)}&name=${encodeURIComponent(imageName)}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setTradeImages(prev => {
          const updated = (prev[tradeId] || []).filter(img => img.name !== imageName)
          return {
            ...prev,
            [tradeId]: updated
          }
        })
        
        // Handle modal state after deletion
        if (modalState?.tradeId === tradeId) {
          const images = tradeImages[tradeId] || []
          if (images.length <= 1) {
            // Close modal if this was the last image
            closeModal()
          } else if (modalState.imageIndex >= images.length - 1) {
            // Move to previous image if we deleted the last one
            setModalState(prev => prev ? { ...prev, imageIndex: Math.max(0, prev.imageIndex - 1) } : null)
          }
        }
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }, [modalState, tradeImages])
  
  // Save note for current image
  const saveNote = useCallback(async (tradeId: string, imageName: string, note: string) => {
    setIsSavingNote(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, note })
      })
      
      if (res.ok) {
        // Update local state
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: (prev[tradeId] || []).map(img => 
            img.name === imageName ? { ...img, note } : img
          )
        }))
      }
    } catch (err) {
      console.error('Failed to save note:', err)
    } finally {
      setIsSavingNote(false)
    }
  }, [])
  
  // Save drawings for current image
  const saveDrawings = useCallback(async (tradeId: string, imageName: string, drawings: DrawingStroke[]) => {
    setIsSavingDrawing(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, drawings })
      })
      
      if (res.ok) {
        // Update local state
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: (prev[tradeId] || []).map(img => 
            img.name === imageName ? { ...img, drawings } : img
          )
        }))
      }
    } catch (err) {
      console.error('Failed to save drawings:', err)
    } finally {
      setIsSavingDrawing(false)
    }
  }, [])
  
  // Render all strokes on canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw all strokes
    const allStrokes = [...strokes, ...(currentStroke ? [currentStroke] : [])]
    
    allStrokes.forEach(stroke => {
      if (stroke.points.length < 2) return
      
      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.lineWidth = stroke.size * 3
      } else if (stroke.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply'
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.size * 4
        ctx.globalAlpha = 0.4
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.size
        ctx.globalAlpha = 1
      }
      
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    })
  }, [strokes, currentStroke])
  
  // Effect to render canvas whenever strokes change
  React.useEffect(() => {
    renderCanvas()
  }, [renderCanvas])
  
  // Get mouse position relative to canvas
  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): DrawingPoint => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    }
  }, [])
  
  // Drawing event handlers
  const handleDrawStart = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode) return
    
    const point = getCanvasPoint(e)
    setIsDrawing(true)
    setCurrentStroke({
      points: [point],
      color: drawingColor,
      size: brushSize,
      tool: drawingTool
    })
  }, [isDrawingMode, getCanvasPoint, drawingColor, brushSize, drawingTool])
  
  const handleDrawMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke) return
    
    const point = getCanvasPoint(e)
    setCurrentStroke(prev => prev ? {
      ...prev,
      points: [...prev.points, point]
    } : null)
  }, [isDrawing, currentStroke, getCanvasPoint])
  
  const handleDrawEnd = useCallback(() => {
    if (!isDrawing || !currentStroke) return
    
    if (currentStroke.points.length > 1) {
      setStrokes(prev => [...prev, currentStroke])
    }
    setCurrentStroke(null)
    setIsDrawing(false)
  }, [isDrawing, currentStroke])
  
  // Undo last stroke
  const undoStroke = useCallback(() => {
    setStrokes(prev => prev.slice(0, -1))
  }, [])
  
  // Clear all strokes
  const clearStrokes = useCallback(() => {
    setStrokes([])
  }, [])
  
  // Open modal with slideshow
  const openModal = useCallback((tradeId: string, imageIndex: number = 0) => {
    const images = tradeImages[tradeId] || []
    const currentImage = images[imageIndex]
    setModalState({ tradeId, imageIndex })
    setEditingNote(currentImage?.note || '')
    setStrokes(currentImage?.drawings || [])
    setIsDrawingMode(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [tradeImages])
  
  // Close modal (auto-save note and drawings if changed)
  const closeModal = useCallback(async () => {
    // Save note and drawings before closing if modified
    if (modalState) {
      const images = tradeImages[modalState.tradeId] || []
      const currentImage = images[modalState.imageIndex]
      if (currentImage) {
        if (editingNote !== currentImage.note) {
          await saveNote(modalState.tradeId, currentImage.name, editingNote)
        }
        // Check if drawings changed
        const currentDrawings = currentImage.drawings || []
        if (JSON.stringify(strokes) !== JSON.stringify(currentDrawings)) {
          await saveDrawings(modalState.tradeId, currentImage.name, strokes)
        }
      }
    }
    
    setModalState(null)
    setEditingNote('')
    setStrokes([])
    setIsDrawingMode(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Navigate slideshow (save current note/drawings, load new)
  const navigateSlideshow = useCallback(async (direction: 'prev' | 'next') => {
    if (!modalState) return
    
    const images = tradeImages[modalState.tradeId] || []
    if (images.length === 0) return
    
    // Save current note and drawings if changed
    const currentImage = images[modalState.imageIndex]
    if (currentImage) {
      if (editingNote !== currentImage.note) {
        await saveNote(modalState.tradeId, currentImage.name, editingNote)
      }
      const currentDrawings = currentImage.drawings || []
      if (JSON.stringify(strokes) !== JSON.stringify(currentDrawings)) {
        await saveDrawings(modalState.tradeId, currentImage.name, strokes)
      }
    }
    
    let newIndex = modalState.imageIndex
    if (direction === 'prev') {
      newIndex = (newIndex - 1 + images.length) % images.length
    } else {
      newIndex = (newIndex + 1) % images.length
    }
    
    // Load note and drawings for new image
    const newImage = images[newIndex]
    setEditingNote(newImage?.note || '')
    setStrokes(newImage?.drawings || [])
    
    setModalState({ ...modalState, imageIndex: newIndex })
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev * 1.5, 5))
  }, [])
  
  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev / 1.5, 0.5))
  }, [])
  
  const resetZoom = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])
  
  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [zoom, pan])
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }, [isDragging, zoom, dragStart])
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])
  
  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) {
      setZoom(prev => Math.min(prev * 1.1, 5))
    } else {
      setZoom(prev => Math.max(prev / 1.1, 0.5))
    }
  }, [])
  
  // Keyboard navigation
  useEffect(() => {
    if (!modalState) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          navigateSlideshow('prev')
          break
        case 'ArrowRight':
          navigateSlideshow('next')
          break
        case 'Escape':
          closeModal()
          break
        case '+':
        case '=':
          handleZoomIn()
          break
        case '-':
          handleZoomOut()
          break
        case '0':
          resetZoom()
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalState, navigateSlideshow, closeModal, handleZoomIn, handleZoomOut, resetZoom])
  
  // Toggle year expansion
  const toggleYear = (yearKey: string) => {
    const newExpanded = new Set(expandedYears)
    if (newExpanded.has(yearKey)) {
      newExpanded.delete(yearKey)
      // Collapse all nested levels
      const newExpandedMonths = new Set(expandedMonths)
      const newExpandedWeeks = new Set(expandedWeeks)
      const newExpandedDays = new Set(expandedDays)
      Array.from(expandedMonths).forEach(key => { if (key.startsWith(yearKey)) newExpandedMonths.delete(key) })
      Array.from(expandedWeeks).forEach(key => { if (key.startsWith(yearKey)) newExpandedWeeks.delete(key) })
      Array.from(expandedDays).forEach(key => { if (key.startsWith(yearKey)) newExpandedDays.delete(key) })
      setExpandedMonths(newExpandedMonths)
      setExpandedWeeks(newExpandedWeeks)
      setExpandedDays(newExpandedDays)
    } else {
      newExpanded.add(yearKey)
    }
    setExpandedYears(newExpanded)
  }
  
  // Toggle month expansion
  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths)
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey)
      // Collapse all nested levels
      const newExpandedWeeks = new Set(expandedWeeks)
      const newExpandedDays = new Set(expandedDays)
      Array.from(expandedWeeks).forEach(key => { if (key.startsWith(monthKey)) newExpandedWeeks.delete(key) })
      Array.from(expandedDays).forEach(key => { if (key.startsWith(monthKey)) newExpandedDays.delete(key) })
      setExpandedWeeks(newExpandedWeeks)
      setExpandedDays(newExpandedDays)
    } else {
      newExpanded.add(monthKey)
    }
    setExpandedMonths(newExpanded)
  }
  
  // Toggle week expansion
  const toggleWeek = (weekKey: string) => {
    const newExpanded = new Set(expandedWeeks)
    if (newExpanded.has(weekKey)) {
      newExpanded.delete(weekKey)
      // Also collapse all days in this week
      const newExpandedDays = new Set(expandedDays)
      Array.from(expandedDays).forEach(dayKey => {
        if (dayKey.startsWith(weekKey)) {
          newExpandedDays.delete(dayKey)
        }
      })
      setExpandedDays(newExpandedDays)
    } else {
      newExpanded.add(weekKey)
    }
    setExpandedWeeks(newExpanded)
  }
  
  // Toggle day expansion
  const toggleDay = (dayKey: string) => {
    const newExpanded = new Set(expandedDays)
    if (newExpanded.has(dayKey)) {
      newExpanded.delete(dayKey)
    } else {
      newExpanded.add(dayKey)
    }
    setExpandedDays(newExpanded)
  }
  
  // Toggle trade expansion (for partial exits)
  const toggleTrade = (tradeKey: string) => {
    const newExpanded = new Set(expandedTrades)
    if (newExpanded.has(tradeKey)) {
      newExpanded.delete(tradeKey)
    } else {
      newExpanded.add(tradeKey)
    }
    setExpandedTrades(newExpanded)
  }
  
  // Check if everything is expanded
  const [isAllExpanded, setIsAllExpanded] = useState(false)
  
  // Expand all rows
  const expandAll = useCallback(() => {
    const allYears = new Set<string>()
    const allMonths = new Set<string>()
    const allWeeks = new Set<string>()
    const allDays = new Set<string>()
    const allTrades = new Set<string>()
    
    // Iterate through all periods and collect all possible keys
    Object.entries(groupedData).forEach(([periodKey, trades]) => {
      if (period === 'yearly') {
        allYears.add(periodKey)
        // Group by months
        const monthGroups: Record<string, Trade[]> = {}
        trades.forEach(trade => {
          if (trade.timestamp) {
            const date = parseLocalTimestamp(trade.timestamp)
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            if (!monthGroups[monthKey]) monthGroups[monthKey] = []
            monthGroups[monthKey].push(trade)
          }
        })
        
        Object.entries(monthGroups).forEach(([monthKey, monthTrades]) => {
          const monthUniqueKey = `${periodKey}-${monthKey}`
          allMonths.add(monthUniqueKey)
          
          // Group by weeks
          const weekGroups: Record<string, Trade[]> = {}
          monthTrades.forEach(trade => {
            if (trade.timestamp) {
              const date = parseLocalTimestamp(trade.timestamp)
              const weekNum = getWeekNumber(date)
              const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
              if (!weekGroups[weekKey]) weekGroups[weekKey] = []
              weekGroups[weekKey].push(trade)
            }
          })
          
          Object.entries(weekGroups).forEach(([weekKey, weekTrades]) => {
            const weekUniqueKey = `${monthUniqueKey}-${weekKey}`
            allWeeks.add(weekUniqueKey)
            
            // Group by days
            const dayGroups: Record<string, Trade[]> = {}
            weekTrades.forEach(trade => {
              if (!trade.timestamp) return
              const dayKey = getTradeNycDayKey(trade.timestamp)
              if (!dayGroups[dayKey]) dayGroups[dayKey] = []
              dayGroups[dayKey].push(trade)
            })
            
            Object.entries(dayGroups).forEach(([dayKey, dayTrades]) => {
              const dayUniqueKey = `${weekUniqueKey}-${dayKey}`
              allDays.add(dayUniqueKey)
              
              sortTradesNewestFirst(dayTrades).forEach((trade, idx) => {
                const tradeKey = `${dayUniqueKey}-trade-${idx}`
                if (trade.partialExits && trade.partialExits.length > 0) {
                  allTrades.add(tradeKey)
                }
              })
            })
          })
        })
      } else if (period === 'monthly') {
        allMonths.add(periodKey)
        
        // Group by weeks
        const weekGroups: Record<string, Trade[]> = {}
        trades.forEach(trade => {
          if (trade.timestamp) {
            const date = parseLocalTimestamp(trade.timestamp)
            const weekNum = getWeekNumber(date)
            const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
            if (!weekGroups[weekKey]) weekGroups[weekKey] = []
            weekGroups[weekKey].push(trade)
          }
        })
        
        Object.entries(weekGroups).forEach(([weekKey, weekTrades]) => {
          const weekUniqueKey = `${periodKey}-${weekKey}`
          allWeeks.add(weekUniqueKey)
          
          // Group by days
          const dayGroups: Record<string, Trade[]> = {}
          weekTrades.forEach(trade => {
            if (!trade.timestamp) return
            const dayKey = getTradeNycDayKey(trade.timestamp)
            if (!dayGroups[dayKey]) dayGroups[dayKey] = []
            dayGroups[dayKey].push(trade)
          })
          
          Object.entries(dayGroups).forEach(([dayKey, dayTrades]) => {
            const dayUniqueKey = `${weekUniqueKey}-${dayKey}`
            allDays.add(dayUniqueKey)
            
            sortTradesNewestFirst(dayTrades).forEach((trade, idx) => {
              const tradeKey = `${dayUniqueKey}-trade-${idx}`
              if (trade.partialExits && trade.partialExits.length > 0) {
                allTrades.add(tradeKey)
              }
            })
          })
        })
      } else if (period === 'weekly') {
        allWeeks.add(periodKey)
        
        // Group by days
        const dayGroups: Record<string, Trade[]> = {}
        trades.forEach(trade => {
          if (!trade.timestamp) return
          const dayKey = getTradeNycDayKey(trade.timestamp)
          if (!dayGroups[dayKey]) dayGroups[dayKey] = []
          dayGroups[dayKey].push(trade)
        })
        
        Object.entries(dayGroups).forEach(([dayKey, dayTrades]) => {
          const dayUniqueKey = `${periodKey}-${dayKey}`
          allDays.add(dayUniqueKey)
          
          sortTradesNewestFirst(dayTrades).forEach((trade, idx) => {
            const tradeKey = `${dayUniqueKey}-trade-${idx}`
            if (trade.partialExits && trade.partialExits.length > 0) {
              allTrades.add(tradeKey)
            }
          })
        })
      }
    })
    
    setExpandedYears(allYears)
    setExpandedMonths(allMonths)
    setExpandedWeeks(allWeeks)
    setExpandedDays(allDays)
    setExpandedTrades(allTrades)
    setIsAllExpanded(true)
  }, [groupedData, period])
  
  // Collapse all rows
  const collapseAll = useCallback(() => {
    setExpandedYears(new Set())
    setExpandedMonths(new Set())
    setExpandedWeeks(new Set())
    setExpandedDays(new Set())
    setExpandedTrades(new Set())
    setIsAllExpanded(false)
  }, [])
  
  // Group trades by week (for monthly view)
  const groupTradesByWeek = (monthTrades: Trade[]) => {
    const grouped: Record<string, Trade[]> = {}
    monthTrades.forEach(trade => {
      if (trade.timestamp) {
        const date = parseLocalTimestamp(trade.timestamp)
        const year = date.getFullYear()
        const weekNum = getWeekNumber(date)
        const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`
        if (!grouped[weekKey]) {
          grouped[weekKey] = []
        }
        grouped[weekKey].push(trade)
      }
    })
    return grouped
  }
  
  // Group trades by month (for yearly view)
  const groupTradesByMonth = (yearTrades: Trade[]) => {
    const grouped: Record<string, Trade[]> = {}
    yearTrades.forEach(trade => {
      if (trade.timestamp) {
        const date = parseLocalTimestamp(trade.timestamp)
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        if (!grouped[monthKey]) {
          grouped[monthKey] = []
        }
        grouped[monthKey].push(trade)
      }
    })
    return grouped
  }
  
  // Group trades by NYC calendar day for a given week (days and trades newest first)
  const groupTradesByDay = (weekTrades: Trade[]) => {
    const grouped: Record<string, Trade[]> = {}
    weekTrades.forEach(trade => {
      if (!trade.timestamp) return
      const dateKey = getTradeNycDayKey(trade.timestamp)
      if (!grouped[dateKey]) {
        grouped[dateKey] = []
      }
      grouped[dateKey].push(trade)
    })
    Object.keys(grouped).forEach(key => {
      grouped[key] = sortTradesNewestFirst(grouped[key])
    })
    return grouped
  }
  
  const tableClass = darkMode
    ? 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-gray-800 border border-gray-700'
    : 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-white border border-gray-200'

  const thClass = darkMode
    ? 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-700 text-gray-300'
    : 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-100 text-gray-700'

  const tdClass = darkMode
    ? 'px-4 py-3 border-t border-gray-700'
    : 'px-4 py-3 border-t border-gray-200'

  // Render a partial exit row
  const renderPartialExitRow = (exit: { contracts: number; exitPrice: number; entryPrice: number; reward: number | null; rrRatio: number | null; pnl: number; cumulativePnl: number; timestamp: string | null; isFinal: boolean; estRisk: number | null }, parentTrade: Trade, tradeKey: string, exitIndex: number, indentLevel: number = 5) => {
    const tradeResult = classifyTradeResult(
      getPartialExitRMultiple(exit) ?? 0,
      tradeTags?.[getTradeId(parentTrade)]
    )
    const paddingLeft = 8 + (indentLevel * 8)
    const exitType = exit.isFinal ? 'Final' : 'Partial'
    
    return (
      <tr 
        key={`${tradeKey}-exit-${exitIndex}`}
        className={darkMode ? 'bg-gray-950' : 'bg-gray-100'}
      >
        <td className={`${tdClass} text-xs`} style={{ paddingLeft: `${paddingLeft}px` }}>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">└─</span>
            <span className={exit.isFinal ? 'text-blue-400' : 'text-purple-400'}>
              {exitType} ({exit.contracts} contracts)
            </span>
            {exit.timestamp && <span className="text-muted-foreground text-xs">@ {exit.timestamp}</span>}
          </div>
        </td>
        <td className={`${tdClass} text-xs`}>{exit.contracts}</td>
        <td className={`${tdClass} text-xs ${tradeResult === 'WIN' ? 'text-green-400' : ''}`}>{tradeResult === 'WIN' ? '1' : '0'}</td>
        <td className={`${tdClass} text-xs ${tradeResult === 'LOSS' ? 'text-red-400' : ''}`}>{tradeResult === 'LOSS' ? '1' : '0'}</td>
        <td className={`${tdClass} text-xs ${tradeResult === 'BE' ? 'text-amber-400' : ''}`}>{tradeResult === 'BE' ? '1' : '0'}</td>
        <td className={`${tdClass} text-xs ${tradeResult === 'WIN' ? 'text-green-400' : tradeResult === 'LOSS' ? 'text-red-400' : 'text-amber-400'}`}>
          {getPartialExitRMultiple(exit) !== null ? `${getPartialExitRMultiple(exit)!.toFixed(1)}R` : 'N/A'}
        </td>
        <td className={`${tdClass} text-xs text-green-400`}>
          {exit.pnl > 0 ? formatUsdPnl(exit.pnl) : '-'}
        </td>
        <td className={`${tdClass} text-xs text-red-400`}>
          {exit.pnl < 0 ? formatUsdPnl(Math.abs(exit.pnl)) : '-'}
        </td>
        <td className={`${tdClass} text-xs ${exit.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatUsdPnl(exit.pnl)}
        </td>
        <td
          className={`${tdClass} text-xs ${pnlPctOfGainsLossColor(
            exit.pnl,
            exit.pnl > 0 ? exit.pnl : 0,
            exit.pnl < 0 ? Math.abs(exit.pnl) : 0
          )}`}
        >
          {formatPnLPctOfGainsLoss(
            exit.pnl,
            exit.pnl > 0 ? exit.pnl : 0,
            exit.pnl < 0 ? Math.abs(exit.pnl) : 0
          )}
        </td>
        <td className={`${tdClass} text-xs text-muted-foreground`}>
          E: {formatPrice(exit.entryPrice)} / X: {formatPrice(exit.exitPrice)}
        </td>
      </tr>
    )
  }

  // Render a trade row with dynamic indentation
  const renderTradeRow = (trade: Trade, parentKey: string, index: number, indentLevel: number = 4) => {
    const rr = getTradeRMultiple(trade) ?? 0
    const tradeResult = getTradeResult(trade, tradeTags)
    const direction = trade.direction ? 
      (trade.direction.toLowerCase() === 'long' ? 'Long' : 'Short') : 
      'N/A'
    const paddingLeft = 8 + (indentLevel * 8) // 8px base + 8px per level
    const tradeKey = `${parentKey}-trade-${index}`
    const hasPartialExits = trade.partialExits && trade.partialExits.length > 0
    const isExpanded = expandedTrades.has(tradeKey)
    
    // Get trade ID for image attachments
    const tradeId = getTradeId(trade)
    const images = tradeImages[tradeId] || []
    const videos = tradeVideos[tradeId] || []
    const isUploading = uploadingTrades.has(tradeId)
    const isUploadingVideo = uploadingVideos.has(tradeId)
    
    // Handle file input change
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.target.files && e.target.files.length > 0) {
        uploadImages(tradeId, e.target.files)
      }
      // Reset input value to allow re-uploading same file
      e.target.value = ''
    }
    
    // Handle video file input change
    const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.target.files && e.target.files.length > 0) {
        handleVideoSelect(tradeId, e.target.files)
      }
      e.target.value = ''
    }
    
    return (
      <React.Fragment key={tradeKey}>
        <tr 
          onClick={hasPartialExits ? () => toggleTrade(tradeKey) : undefined}
          className={`${darkMode ? 'bg-gray-900' : 'bg-gray-50'} ${hasPartialExits ? 'cursor-pointer hover:bg-gray-800' : ''}`}
        >
          <td className={`${tdClass} text-sm`} style={{ paddingLeft: `${paddingLeft}px` }}>
            <div className="flex items-center gap-2">
              {hasPartialExits ? (
                isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
              ) : (
                <span className="text-muted-foreground">└─</span>
              )}
              <span className={direction === 'Long' ? 'text-green-500' : direction === 'Short' ? 'text-red-500' : ''}>
                {direction}
              </span>
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                tradeResult === 'WIN' 
                  ? 'bg-green-500/20 text-green-400' 
                  : tradeResult === 'LOSS'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {tradeResult}
              </span>
              {hasPartialExits && (
                <span className="text-xs text-purple-400">({trade.partialExits!.length} exits)</span>
              )}
              {trade.entryTime && <span className="text-muted-foreground text-xs">@ {formatWallClockTimeOnly(trade.entryTime ?? trade.timestamp)}</span>}
              
              {/* Image attachment section */}
              <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                {/* Upload button */}
                <label 
                  className={`p-1 rounded cursor-pointer transition-colors ${
                    isUploading 
                      ? 'opacity-50 cursor-wait' 
                      : darkMode 
                        ? 'hover:bg-gray-700' 
                        : 'hover:bg-gray-200'
                  }`}
                  title="Attach images"
                >
                  <ImagePlus className="h-4 w-4 text-blue-400" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    multiple 
                    className="hidden" 
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                </label>
                
                {/* Thumbnails */}
                {images.length > 0 && (
                  <div className="flex items-center gap-1">
                    {images.slice(0, 3).map((img, imgIdx) => (
                      <button
                        key={imgIdx}
                        onClick={(e) => {
                          e.stopPropagation()
                          openModal(tradeId, imgIdx)
                        }}
                        className={`w-6 h-6 rounded overflow-hidden border ${
                          darkMode ? 'border-gray-600 hover:border-blue-400' : 'border-gray-300 hover:border-blue-500'
                        } transition-colors`}
                        title={img.name}
                      >
                        <img 
                          src={img.url} 
                          alt={img.name}
                          className="w-full h-full object-cover" loading="lazy"
                        />
                      </button>
                    ))}
                    {images.length > 3 && (
                      <span className="text-xs text-muted-foreground">+{images.length - 3}</span>
                    )}
                  </div>
                )}
                
                {isUploading && (
                  <span className="text-xs text-blue-400 animate-pulse">Uploading...</span>
                )}
                
                {/* Video section */}
                <div className="flex items-center gap-1 ml-2">
                  {/* Video upload button */}
                  <label 
                    className={`p-1 rounded cursor-pointer transition-colors ${
                      isUploadingVideo 
                        ? 'opacity-50 cursor-wait' 
                        : darkMode 
                          ? 'hover:bg-gray-700' 
                          : 'hover:bg-gray-200'
                    }`}
                    title="Attach video"
                  >
                    <Video className="h-4 w-4 text-purple-400" />
                    <input 
                      type="file" 
                      accept="video/*,.mkv,.mp4,.webm,.mov,.avi" 
                      className="hidden" 
                      onChange={handleVideoFileChange}
                      disabled={isUploadingVideo}
                    />
                  </label>
                  
                  {/* Video thumbnails */}
                  {videos.length > 0 && (
                    <div className="flex items-center gap-1">
                      {videos.slice(0, 2).map((vid, vidIdx) => (
                        <button
                          key={vid.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            openVideoModal(tradeId, vidIdx)
                          }}
                          className={`w-8 h-6 rounded overflow-hidden border relative ${
                            darkMode ? 'border-gray-600 hover:border-purple-400' : 'border-gray-300 hover:border-purple-500'
                          } transition-colors`}
                          title={vid.originalName}
                        >
                          {vid.thumbUrl ? (
                            <img src={vid.thumbUrl} alt={vid.originalName} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-700">
                              <Film className="h-3 w-3 text-gray-400" />
                            </div>
                          )}
                          {vid.clipStartSec !== undefined && (
                            <div className="absolute bottom-0 left-0 right-0 bg-purple-500/80 text-[5px] text-center text-white">
                              Clip
                            </div>
                          )}
                        </button>
                      ))}
                      {videos.length > 2 && (
                        <span className="text-xs text-muted-foreground">+{videos.length - 2}</span>
                      )}
                    </div>
                  )}
                  
                  {isUploadingVideo && (
                    <span className="text-xs text-purple-400 animate-pulse">Converting...</span>
                  )}
                </div>
              </div>
            </div>
          </td>
          <td className={`${tdClass} text-sm`}>1</td>
          <td className={`${tdClass} text-sm ${tradeResult === 'WIN' ? 'text-green-400' : ''}`}>{tradeResult === 'WIN' ? '1' : '0'}</td>
          <td className={`${tdClass} text-sm ${tradeResult === 'LOSS' ? 'text-red-400' : ''}`}>{tradeResult === 'LOSS' ? '1' : '0'}</td>
          <td className={`${tdClass} text-sm ${tradeResult === 'BE' ? 'text-amber-400' : ''}`}>{tradeResult === 'BE' ? '1' : '0'}</td>
          <td className={`${tdClass} text-sm ${tradeResult === 'WIN' ? 'text-green-400' : tradeResult === 'LOSS' ? 'text-red-400' : 'text-amber-400'}`}>
            {tradeResult === 'WIN' ? '100%' : tradeResult === 'LOSS' ? '0%' : 'N/A'}
          </td>
          <td className={`${tdClass} text-sm ${tradeResult === 'WIN' ? 'text-green-400' : tradeResult === 'LOSS' ? 'text-red-400' : 'text-amber-400'}`}>
            {getTradeRMultiple(trade) !== null ? `${getTradeRMultiple(trade)!.toFixed(1)}R` : 'N/A'}
          </td>
          <td className={`${tdClass} text-sm text-green-400`}>
            {(trade.pnl ?? 0) > 0 ? formatUsdPnl(trade.pnl) : '-'}
          </td>
          <td className={`${tdClass} text-sm text-red-400`}>
            {(trade.pnl ?? 0) < 0 ? formatUsdPnl(Math.abs(trade.pnl ?? 0)) : '-'}
          </td>
          <td className={`${tdClass} text-sm ${(trade.pnl ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUsdPnlOrNa(trade.pnl)}
          </td>
          <td
            className={`${tdClass} text-sm ${pnlPctOfGainsLossColor(
              trade.pnl ?? 0,
              (trade.pnl ?? 0) > 0 ? trade.pnl ?? 0 : 0,
              (trade.pnl ?? 0) < 0 ? Math.abs(trade.pnl ?? 0) : 0
            )}`}
          >
            {formatPnLPctOfGainsLoss(
              trade.pnl ?? 0,
              (trade.pnl ?? 0) > 0 ? trade.pnl ?? 0 : 0,
              (trade.pnl ?? 0) < 0 ? Math.abs(trade.pnl ?? 0) : 0
            )}
          </td>
          <td className={`${tdClass} text-sm ${isASetupTrade(trade, tradeTags) ? 'text-teal-400' : ''}`}>
            {isASetupTrade(trade, tradeTags) ? 'A' : '-'}
          </td>
        </tr>
        {isExpanded && hasPartialExits && trade.partialExits!.map((exit, exitIdx) => 
          renderPartialExitRow(exit, trade, tradeKey, exitIdx, indentLevel + 1)
        )}
      </React.Fragment>
    )
  }
  
  // Render a day row with trades (supports dynamic indentation)
  const renderDayRow = (dayKey: string, dayTrades: Trade[], parentKey: string, indentLevel: number = 2) => {
    const dayStats = calculateStats(dayTrades, tradeTags)
    const tradesWithRR = dayTrades.filter(t => getTradeRMultiple(t) !== null)
    const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
    const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
    const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
    const decisiveTrades = wins.length + losses.length
    const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0
    const uniqueKey = `${parentKey}-${dayKey}`
    const isExpanded = expandedDays.has(uniqueKey)
    // Parse dayKey manually to avoid UTC interpretation
    // dayKey format: "YYYY-MM-DD"
    const [year, month, day] = dayKey.split('-').map(Number)
    const dayDate = new Date(year, month - 1, day) // Local time, not UTC
    const dayLabel = format(dayDate, 'EEE, MMM d')
    const paddingLeft = 8 + (indentLevel * 8)
    
    return (
      <React.Fragment key={uniqueKey}>
        <tr 
          onClick={() => toggleDay(uniqueKey)}
          className={`${darkMode ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-100 hover:bg-gray-200'} cursor-pointer`}
        >
          <td className={tdClass} style={{ paddingLeft: `${paddingLeft}px` }}>
            <div className="flex items-center gap-2">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>{dayLabel}</span>
            </div>
          </td>
          <td className={tdClass}>{dayTrades.length}</td>
          <td className={`${tdClass} text-green-400`}>{wins.length}</td>
          <td className={`${tdClass} text-red-400`}>{losses.length}</td>
          <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
          <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
          </td>
          <td className={`${tdClass} ${dayStats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${dayStats.avgRR.toFixed(1)}R` : 'N/A'}
          </td>
          <td className={`${tdClass} text-green-400`}>
            {dayStats.totalGains > 0 ? formatUsdPnl(dayStats.totalGains) : '-'}
          </td>
          <td className={`${tdClass} text-red-400`}>
            {dayStats.totalLosses > 0 ? formatUsdPnl(dayStats.totalLosses) : '-'}
          </td>
          <td className={`${tdClass} ${dayStats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUsdPnl(dayStats.totalPnL)}
          </td>
          <td
            className={`${tdClass} ${pnlPctOfGainsLossColor(dayStats.totalPnL, dayStats.totalGains, dayStats.totalLosses)}`}
          >
            {formatPnLPctOfGainsLoss(dayStats.totalPnL, dayStats.totalGains, dayStats.totalLosses)}
          </td>
          <td className={`${tdClass} text-teal-400`}>
            {formatARateCell(dayTrades)}
          </td>
        </tr>
        {isExpanded && sortTradesNewestFirst(dayTrades).map((trade, idx) => renderTradeRow(trade, uniqueKey, idx, indentLevel + 1))}
      </React.Fragment>
    )
  }
  
  // Render a week row with days (for monthly view)
  const renderWeekRow = (weekKey: string, weekTrades: Trade[], parentKey: string, indentLevel: number = 1) => {
    const weekStats = calculateStats(weekTrades, tradeTags)
    const tradesWithRR = weekTrades.filter(t => getTradeRMultiple(t) !== null)
    const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
    const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
    const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
    const decisiveTrades = wins.length + losses.length
    const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0
    const uniqueKey = `${parentKey}-${weekKey}`
    const isExpanded = expandedWeeks.has(uniqueKey)
    const dayGroups = groupTradesByDay(weekTrades)
    const sortedDays = sortDayKeysNewestFirst(Object.keys(dayGroups))
    const paddingLeft = 8 + (indentLevel * 8)
    
    return (
      <React.Fragment key={uniqueKey}>
        <tr 
          onClick={() => toggleWeek(uniqueKey)}
          className={`${darkMode ? 'bg-gray-850 hover:bg-gray-800' : 'bg-gray-50 hover:bg-gray-100'} cursor-pointer`}
        >
          <td className={tdClass} style={{ paddingLeft: `${paddingLeft}px` }}>
            <div className="flex items-center gap-2">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>{formatPeriodLabel(weekKey)}</span>
            </div>
          </td>
          <td className={tdClass}>{weekTrades.length}</td>
          <td className={`${tdClass} text-green-400`}>{wins.length}</td>
          <td className={`${tdClass} text-red-400`}>{losses.length}</td>
          <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
          <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
          </td>
          <td className={`${tdClass} ${weekStats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${weekStats.avgRR.toFixed(1)}R` : 'N/A'}
          </td>
          <td className={`${tdClass} text-green-400`}>
            {weekStats.totalGains > 0 ? formatUsdPnl(weekStats.totalGains) : '-'}
          </td>
          <td className={`${tdClass} text-red-400`}>
            {weekStats.totalLosses > 0 ? formatUsdPnl(weekStats.totalLosses) : '-'}
          </td>
          <td className={`${tdClass} ${weekStats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUsdPnl(weekStats.totalPnL)}
          </td>
          <td
            className={`${tdClass} ${pnlPctOfGainsLossColor(weekStats.totalPnL, weekStats.totalGains, weekStats.totalLosses)}`}
          >
            {formatPnLPctOfGainsLoss(weekStats.totalPnL, weekStats.totalGains, weekStats.totalLosses)}
          </td>
          <td className={`${tdClass} text-teal-400`}>
            {formatARateCell(weekTrades)}
          </td>
        </tr>
        {isExpanded && sortedDays.map(dayKey => 
          renderDayRow(dayKey, dayGroups[dayKey], uniqueKey, indentLevel + 1)
        )}
      </React.Fragment>
    )
  }
  
  // Render a month row with weeks (for yearly view)
  const renderMonthRow = (monthKey: string, monthTrades: Trade[], parentKey: string) => {
    const monthStats = calculateStats(monthTrades, tradeTags)
    const tradesWithRR = monthTrades.filter(t => getTradeRMultiple(t) !== null)
    const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
    const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
    const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
    const decisiveTrades = wins.length + losses.length
    const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0
    const uniqueKey = `${parentKey}-${monthKey}`
    const isExpanded = expandedMonths.has(uniqueKey)
    const weekGroups = groupTradesByWeek(monthTrades)
    const sortedWeeks = Object.keys(weekGroups).sort()
    // Format month label
    const [year, month] = monthKey.split('-')
    const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1)
    const monthLabel = format(monthDate, 'MMMM yyyy')
    
    return (
      <React.Fragment key={uniqueKey}>
        <tr 
          onClick={() => toggleMonth(uniqueKey)}
          className={`${darkMode ? 'bg-gray-850 hover:bg-gray-800' : 'bg-gray-50 hover:bg-gray-100'} cursor-pointer`}
        >
          <td className={tdClass} style={{ paddingLeft: '16px' }}>
            <div className="flex items-center gap-2">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>{monthLabel}</span>
            </div>
          </td>
          <td className={tdClass}>{monthTrades.length}</td>
          <td className={`${tdClass} text-green-400`}>{wins.length}</td>
          <td className={`${tdClass} text-red-400`}>{losses.length}</td>
          <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
          <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
          </td>
          <td className={`${tdClass} ${monthStats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {decisiveTrades > 0 ? `${monthStats.avgRR.toFixed(1)}R` : 'N/A'}
          </td>
          <td className={`${tdClass} text-green-400`}>
            {monthStats.totalGains > 0 ? formatUsdPnl(monthStats.totalGains) : '-'}
          </td>
          <td className={`${tdClass} text-red-400`}>
            {monthStats.totalLosses > 0 ? formatUsdPnl(monthStats.totalLosses) : '-'}
          </td>
          <td className={`${tdClass} ${monthStats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUsdPnl(monthStats.totalPnL)}
          </td>
          <td
            className={`${tdClass} ${pnlPctOfGainsLossColor(monthStats.totalPnL, monthStats.totalGains, monthStats.totalLosses)}`}
          >
            {formatPnLPctOfGainsLoss(monthStats.totalPnL, monthStats.totalGains, monthStats.totalLosses)}
          </td>
          <td className={`${tdClass} text-teal-400`}>
            {formatARateCell(monthTrades)}
          </td>
        </tr>
        {isExpanded && sortedWeeks.map(weekKey => 
          renderWeekRow(weekKey, weekGroups[weekKey], uniqueKey, 2)
        )}
      </React.Fragment>
    )
  }

  // Render image modal with slideshow, zoom, and pan
  const renderImageModal = () => {
    if (!modalState) return null
    
    const images = tradeImages[modalState.tradeId] || []
    if (images.length === 0) return null
    
    const currentImage = images[modalState.imageIndex]
    if (!currentImage) return null
    
    const hasMultipleImages = images.length > 1
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
        onClick={closeModal}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Main container */}
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with filename, counter, and actions */}
          <div className={`flex items-center justify-between px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <span className="text-sm truncate max-w-[300px]">{currentImage.name}</span>
              {hasMultipleImages && (
                <span className="text-xs text-muted-foreground">
                  {modalState.imageIndex + 1} / {images.length}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              {/* Zoom controls */}
              <button
                onClick={handleZoomOut}
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} transition-colors`}
                title="Zoom out (-)"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button
                onClick={handleZoomIn}
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} transition-colors`}
                title="Zoom in (+)"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={resetZoom}
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} transition-colors`}
                title="Reset zoom (0)"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              {/* Drawing tools */}
              <button
                onClick={() => setIsDrawingMode(!isDrawingMode)}
                className={`p-1.5 rounded transition-colors ${
                  isDrawingMode 
                    ? 'bg-blue-500 text-white' 
                    : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                }`}
                title={isDrawingMode ? 'Exit drawing mode' : 'Enter drawing mode'}
              >
                <Pen className="h-4 w-4" />
              </button>
              
              {isDrawingMode && (
                <>
                  {/* Tool selection */}
                  <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <button
                      onClick={() => setDrawingTool('pen')}
                      className={`p-1 rounded transition-colors ${drawingTool === 'pen' ? 'bg-blue-500 text-white' : ''}`}
                      title="Pen"
                    >
                      <Pen className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setDrawingTool('highlighter')}
                      className={`p-1 rounded transition-colors ${drawingTool === 'highlighter' ? 'bg-yellow-500 text-white' : ''}`}
                      title="Highlighter"
                    >
                      <Circle className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setDrawingTool('eraser')}
                      className={`p-1 rounded transition-colors ${drawingTool === 'eraser' ? 'bg-gray-500 text-white' : ''}`}
                      title="Eraser"
                    >
                      <Eraser className="h-3 w-3" />
                    </button>
                  </div>
                  
                  {/* Color picker */}
                  {drawingTool !== 'eraser' && (
                    <div className="flex items-center gap-0.5">
                      {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'].map(color => (
                        <button
                          key={color}
                          onClick={() => setDrawingColor(color)}
                          className={`w-5 h-5 rounded-full border-2 transition-transform ${
                            drawingColor === color ? 'scale-125 border-white' : 'border-transparent hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  )}
                  
                  {/* Brush size */}
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-16 h-1 accent-blue-500"
                    title={`Brush size: ${brushSize}`}
                  />
                  
                  {/* Undo */}
                  <button
                    onClick={undoStroke}
                    disabled={strokes.length === 0}
                    className={`p-1.5 rounded transition-colors ${
                      strokes.length === 0 
                        ? 'opacity-50 cursor-not-allowed' 
                        : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                    }`}
                    title="Undo"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                  
                  {/* Clear all */}
                  <button
                    onClick={clearStrokes}
                    disabled={strokes.length === 0}
                    className={`p-1.5 rounded transition-colors ${
                      strokes.length === 0 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'hover:bg-red-500/20 text-red-400'
                    }`}
                    title="Clear all drawings"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                  
                  {isSavingDrawing && (
                    <span className="text-xs text-blue-400 animate-pulse">Saving...</span>
                  )}
                </>
              )}
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              {/* Delete */}
              <button
                onClick={() => {
                  if (confirm('Delete this image?')) {
                    deleteImage(modalState.tradeId, currentImage.name)
                  }
                }}
                className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                title="Delete image"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              
              {/* Close */}
              <button
                onClick={closeModal}
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} transition-colors`}
                title="Close (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Image container with zoom, pan, and drawing canvas */}
          <div 
            ref={imageContainerRef}
            className="flex-1 overflow-hidden relative flex items-center justify-center"
            onWheel={!isDrawingMode ? handleWheel : undefined}
            onMouseDown={!isDrawingMode ? handleMouseDown : undefined}
            onMouseMove={!isDrawingMode ? handleMouseMove : undefined}
            onMouseUp={!isDrawingMode ? handleMouseUp : undefined}
            style={{ cursor: isDrawingMode ? 'crosshair' : (zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default') }}
          >
            <div className="relative" style={{ 
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}>
              <img 
                src={currentImage.url} 
                alt={currentImage.name}
                className="max-w-full max-h-full object-contain select-none"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight })
                }}
              />
              
              {/* Drawing canvas overlay */}
              {canvasSize.width > 0 && (
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className="absolute inset-0 w-full h-full"
                  style={{ 
                    pointerEvents: isDrawingMode ? 'auto' : 'none',
                    cursor: isDrawingMode ? 'crosshair' : 'default'
                  }}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                />
              )}
            </div>
            
            {/* Navigation arrows */}
            {hasMultipleImages && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigateSlideshow('prev')
                  }}
                  className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${
                    darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'
                  } shadow-lg transition-colors`}
                  title="Previous (←)"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigateSlideshow('next')
                  }}
                  className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${
                    darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'
                  } shadow-lg transition-colors`}
                  title="Next (→)"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          
          {/* Note text area */}
          <div className={`shrink-0 px-4 py-3 ${darkMode ? 'bg-gray-850 border-t border-gray-700' : 'bg-gray-50 border-t border-gray-200'}`}>
            <div className="flex items-start gap-3">
              <label className="text-sm font-medium text-muted-foreground shrink-0 pt-2">
                Notes:
              </label>
              <div className="flex-1 relative">
                <textarea
                  value={editingNote}
                  onChange={(e) => setEditingNote(e.target.value)}
                  onBlur={async () => {
                    // Auto-save on blur
                    if (currentImage && editingNote !== currentImage.note) {
                      await saveNote(modalState.tradeId, currentImage.name, editingNote)
                    }
                  }}
                  placeholder="Add notes about this trade screenshot..."
                  className={`w-full px-3 py-2 rounded-lg resize-none text-sm ${
                    darkMode 
                      ? 'bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500 focus:border-blue-500' 
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                  } border focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors`}
                  rows={2}
                />
                {isSavingNote && (
                  <span className="absolute right-2 top-2 text-xs text-blue-400 animate-pulse">
                    Saving...
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {/* Thumbnail strip for slideshow */}
          {hasMultipleImages && (
            <div className={`shrink-0 px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} overflow-x-auto`}>
              <div className="flex items-center gap-2 justify-center">
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={async () => {
                      // Save current note before switching
                      if (currentImage && editingNote !== currentImage.note) {
                        await saveNote(modalState.tradeId, currentImage.name, editingNote)
                      }
                      // Load new image's note
                      setEditingNote(images[idx]?.note || '')
                      setModalState({ ...modalState, imageIndex: idx })
                      setZoom(1)
                      setPan({ x: 0, y: 0 })
                    }}
                    className={`w-12 h-12 rounded overflow-hidden border-2 transition-colors shrink-0 ${
                      idx === modalState.imageIndex
                        ? 'border-blue-500'
                        : darkMode 
                          ? 'border-gray-600 hover:border-gray-400' 
                          : 'border-gray-300 hover:border-gray-500'
                    }`}
                  >
                    <img 
                      src={img.url} 
                      alt={img.name}
                      className="w-full h-full object-cover" loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
  
  // Render video preview modal (for trimming before upload)
  const renderVideoPreviewModal = () => {
    if (!videoPreviewState) return null
    const clipDuration = trimEnd - trimStart
    const isValidClip = clipDuration > 0 && clipDuration <= 600
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={closeVideoPreview}>
        <div className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`} onClick={(e) => e.stopPropagation()}>
          <div className={`flex items-center justify-between px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-purple-400" />
              <span className="text-sm font-medium">Preview & Trim Before Saving</span>
              <span className="text-xs text-muted-foreground">{videoPreviewState.file.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setVideoZoom(prev => Math.max(0.5, prev - 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(videoZoom * 100)}%</span>
              <button onClick={() => setVideoZoom(prev => Math.min(3, prev + 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={() => setVideoZoom(1)} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset zoom">
                <RotateCcw className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-gray-600 mx-1" />
              <button onClick={closeVideoPreview} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 flex flex-col min-h-0">
            <div 
              ref={videoContainerRef}
              className={`flex-1 flex items-center justify-center bg-black p-4 min-h-0 overflow-auto ${videoZoom > 1 ? (videoPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onMouseDown={handleVideoPanStart}
              onMouseMove={handleVideoPanMove}
              onMouseUp={handleVideoPanEnd}
              onMouseLeave={handleVideoPanEnd}
            >
              <video ref={videoRef} src={videoPreviewState.localUrl} 
                className="rounded transition-transform select-none"
                style={{ 
                  transform: `scale(${videoZoom})`,
                  maxWidth: videoZoom <= 1 ? '100%' : 'none',
                  maxHeight: videoZoom <= 1 ? '100%' : 'none',
                  pointerEvents: videoZoom > 1 ? 'none' : 'auto'
                }}
                onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => { setVideoDuration(e.currentTarget.duration); setTrimEnd(Math.min(e.currentTarget.duration, 600)) }}
                onPlay={() => setIsVideoPlaying(true)} onPause={() => setIsVideoPlaying(false)} />
            </div>
            
            <div className={`px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className="flex items-center gap-4">
                <button onClick={() => { const v = videoRef.current; if (v) isVideoPlaying ? v.pause() : v.play() }}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
                  {isVideoPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                <span className="text-sm font-mono w-24">{formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}</span>
                <div className="flex-1">
                  <input type="range" min={0} max={videoDuration} step={0.1} value={videoCurrentTime}
                    onChange={(e) => { const t = parseFloat(e.target.value); setVideoCurrentTime(t); if (videoRef.current) videoRef.current.currentTime = t }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-600" />
                </div>
              </div>
            </div>
            
            <div className={`px-4 py-4 border-t ${darkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-4">
                <Scissors className="h-5 w-5 text-purple-400" />
                <span className="font-medium">Set Clip Range (max 10 min)</span>
              </div>
              <div className="flex flex-wrap items-center gap-6 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm w-12">Start:</span>
                  <input type="number" min={0} max={trimEnd - 1} step={0.1} value={trimStart.toFixed(1)}
                    onChange={(e) => setTrimStart(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-24 px-3 py-2 rounded ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border text-center`} />
                  <button onClick={() => setTrimStart(videoCurrentTime)} className="px-3 py-2 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30">Use Current</button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm w-12">End:</span>
                  <input type="number" min={trimStart + 1} max={videoDuration} step={0.1} value={trimEnd.toFixed(1)}
                    onChange={(e) => setTrimEnd(Math.min(videoDuration, parseFloat(e.target.value) || videoDuration))}
                    className={`w-24 px-3 py-2 rounded ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border text-center`} />
                  <button onClick={() => setTrimEnd(videoCurrentTime)} className="px-3 py-2 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30">Use Current</button>
                </div>
              </div>
              <div className="relative h-8 bg-gray-700 rounded overflow-hidden mb-4">
                <div className="absolute h-full bg-purple-500/50 border-l-2 border-r-2 border-purple-400"
                  style={{ left: `${(trimStart / videoDuration) * 100}%`, width: `${((trimEnd - trimStart) / videoDuration) * 100}%` }} />
                <div className="absolute h-full w-1 bg-white shadow-lg" style={{ left: `${(videoCurrentTime / videoDuration) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isValidClip ? 'text-green-400' : 'text-red-400'}`}>
                  Clip Duration: {formatVideoTime(clipDuration)}{clipDuration > 600 && ' (exceeds 10 min limit)'}
                </span>
                <div className="flex items-center gap-3">
                  <button onClick={closeVideoPreview} className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>Cancel</button>
                  <button onClick={uploadTrimmedClip} disabled={!isValidClip || isClipping}
                    className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium ${!isValidClip || isClipping ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-purple-500 hover:bg-purple-600 text-white'}`}>
                    {isClipping ? <><span className="animate-spin">⏳</span>Processing...</> : <><Save className="h-4 w-4" />Save Clip</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // Render video modal
  const renderVideoModal = () => {
    if (!videoModalState) return null
    
    const videos = tradeVideos[videoModalState.tradeId] || []
    if (videos.length === 0) return null
    
    const currentVideo = videos[videoModalState.videoIndex]
    if (!currentVideo) return null
    
    const hasMultipleVideos = videos.length > 1
    const vidDuration = videoDuration || currentVideo.durationSec || 0
    
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
        onClick={closeVideoModal}
      >
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} shrink-0`}>
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-purple-400" />
              <span className="text-sm truncate max-w-[300px]">{currentVideo.originalName}</span>
              {hasMultipleVideos && (
                <span className="text-xs text-muted-foreground">
                  {videoModalState.videoIndex + 1} / {videos.length}
                </span>
              )}
              {currentVideo.clipStartSec !== undefined && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  Clip
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <button onClick={() => setVideoZoom(prev => Math.max(0.5, prev - 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(videoZoom * 100)}%</span>
              <button onClick={() => setVideoZoom(prev => Math.min(3, prev + 0.25))} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={() => setVideoZoom(1)} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset zoom">
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-1" />
              
              <button
                onClick={() => deleteVideo(videoModalState.tradeId, currentVideo.id)}
                className="p-1.5 rounded text-red-400 hover:bg-red-500/20"
                title="Delete video"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button 
                onClick={closeVideoModal} 
                className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Video player */}
          <div className="flex-1 flex flex-col min-h-0">
            <div 
              ref={videoContainerRef}
              className={`flex-1 flex items-center justify-center bg-black p-4 min-h-0 overflow-auto ${videoZoom > 1 ? (videoPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              onMouseDown={handleVideoPanStart}
              onMouseMove={handleVideoPanMove}
              onMouseUp={handleVideoPanEnd}
              onMouseLeave={handleVideoPanEnd}
            >
              <video
                ref={videoRef}
                src={currentVideo.url}
                className="rounded transition-transform select-none"
                style={{ 
                  transform: `scale(${videoZoom})`,
                  maxWidth: videoZoom <= 1 ? '100%' : 'none',
                  maxHeight: videoZoom <= 1 ? '100%' : 'none',
                  pointerEvents: videoZoom > 1 ? 'none' : 'auto'
                }}
                onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  const vid = e.currentTarget
                  setVideoDuration(vid.duration)
                  setTrimEnd(vid.duration)
                }}
                onPlay={() => setIsVideoPlaying(true)}
                onPause={() => setIsVideoPlaying(false)}
                onEnded={() => setIsVideoPlaying(false)}
              />
            </div>
            
            {/* Playback controls */}
            <div className={`px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    const vid = videoRef.current
                    if (vid) {
                      if (isVideoPlaying) {
                        vid.pause()
                      } else {
                        vid.play()
                      }
                    }
                  }}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  {isVideoPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                
                <span className="text-sm font-mono w-20">
                  {formatVideoTime(videoCurrentTime)} / {formatVideoTime(vidDuration)}
                </span>
                
                {/* Timeline scrubber */}
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={vidDuration}
                    step={0.1}
                    value={videoCurrentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value)
                      setVideoCurrentTime(time)
                      if (videoRef.current) {
                        videoRef.current.currentTime = time
                      }
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-600"
                  />
                </div>
              </div>
            </div>
            
            {/* Trimming controls */}
            <div className={`px-4 py-4 border-t ${darkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Scissors className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-medium">Trim & Save Clip</span>
              </div>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Start:</span>
                  <input
                    type="number"
                    min={0}
                    max={trimEnd - 0.1}
                    step={0.1}
                    value={trimStart.toFixed(1)}
                    onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button
                    onClick={() => setTrimStart(videoCurrentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Set Current
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">End:</span>
                  <input
                    type="number"
                    min={trimStart + 0.1}
                    max={vidDuration}
                    step={0.1}
                    value={trimEnd.toFixed(1)}
                    onChange={(e) => setTrimEnd(parseFloat(e.target.value) || vidDuration)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button
                    onClick={() => setTrimEnd(videoCurrentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    Set Current
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Duration: {formatVideoTime(Math.max(0, trimEnd - trimStart))}
                  </span>
                </div>
                
                <button
                  onClick={createVideoClip}
                  disabled={isClipping || trimEnd <= trimStart}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    isClipping || trimEnd <= trimStart
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-500 hover:bg-purple-600 text-white'
                  }`}
                >
                  {isClipping ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Clip
                    </>
                  )}
                </button>
              </div>
              
              {/* Trim range visualization */}
              <div className="mt-3 relative h-4 bg-gray-700 rounded overflow-hidden">
                <div
                  className="absolute h-full bg-purple-500/40"
                  style={{
                    left: `${(trimStart / vidDuration) * 100}%`,
                    width: `${((trimEnd - trimStart) / vidDuration) * 100}%`
                  }}
                />
                <div
                  className="absolute h-full w-0.5 bg-blue-400"
                  style={{ left: `${(videoCurrentTime / vidDuration) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Navigation arrows */}
          {hasMultipleVideos && (
            <>
              <button
                onClick={() => navigateVideoSlideshow('prev')}
                className={`absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={() => navigateVideoSlideshow('next')}
                className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          
          {/* Video thumbnails strip */}
          {hasMultipleVideos && (
            <div className={`px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {videos.map((vid, idx) => (
                  <button
                    key={vid.id}
                    onClick={() => {
                      setVideoModalState({ ...videoModalState, videoIndex: idx })
                      setTrimStart(0)
                      setTrimEnd(vid.durationSec || 0)
                      setIsVideoPlaying(false)
                      setVideoCurrentTime(0)
                    }}
                    className={`w-16 h-12 rounded overflow-hidden border-2 shrink-0 relative ${idx === videoModalState.videoIndex ? 'border-purple-500' : darkMode ? 'border-gray-600 hover:border-gray-400' : 'border-gray-300 hover:border-gray-500'}`}
                  >
                    {vid.thumbUrl ? (
                      <img src={vid.thumbUrl} alt={vid.originalName} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-700">
                        <Film className="h-4 w-4 text-gray-400" />
                      </div>
                    )}
                    {vid.clipStartSec !== undefined && (
                      <div className="absolute bottom-0 left-0 right-0 bg-purple-500/80 text-[8px] text-center text-white">
                        Clip
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <div className={`flex items-center mb-4 ${showTitle ? 'justify-between' : 'justify-end'}`}>
        {showTitle ? (
          <h2 className="text-2xl font-bold">
            Performance by {period === 'weekly' ? 'Week' : period === 'daily' ? 'Day' : period === 'monthly' ? 'Month' : 'Year'}
          </h2>
        ) : (
          <div />
        )}
        {period !== 'daily' && (
          <button
            onClick={isAllExpanded ? collapseAll : expandAll}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              darkMode 
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' 
                : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            {isAllExpanded ? (
              <>
                <ChevronsDownUp className="h-4 w-4" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronsUpDown className="h-4 w-4" />
                Expand All
              </>
            )}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Period</th>
              <th className={thClass}>Trades</th>
              <th className={thClass}>Wins</th>
              <th className={thClass}>Losses</th>
              <th className={thClass}>BE</th>
              <th className={thClass}>Win Rate</th>
              <th className={thClass}>Avg R:R</th>
              <th className={thClass}>{COL_TOTAL_GAINS}</th>
              <th className={thClass}>{COL_TOTAL_LOSSES}</th>
              <th className={thClass}>P&L</th>
              <th className={thClass}>{COL_PNL_PCT_GAINS_LOSS}</th>
              <th className={thClass}>A Rate</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(periodKey => {
              const trades = groupedData[periodKey]
              const stats = calculateStats(trades, tradeTags)
              const tradesWithRR = trades.filter(t => getTradeRMultiple(t) !== null)
              const wins = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'WIN')
              const losses = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'LOSS')
              const breakevens = tradesWithRR.filter(t => getTradeResult(t, tradeTags) === 'BE')
              const decisiveTrades = wins.length + losses.length
              const winRate = decisiveTrades > 0 ? (wins.length / decisiveTrades) * 100 : 0
              
              // For weekly period, show expandable nested view
              if (period === 'weekly') {
                const isExpanded = expandedWeeks.has(periodKey)
                const dayGroups = groupTradesByDay(trades)
                const sortedDays = sortDayKeysNewestFirst(Object.keys(dayGroups))
                return (
                  <React.Fragment key={periodKey}>
                    <tr 
                      onClick={() => toggleWeek(periodKey)}
                      className={`${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} cursor-pointer font-semibold`}
                    >
                      <td className={tdClass}>
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{formatPeriodLabel(periodKey)}</span>
                        </div>
                      </td>
                      <td className={tdClass}>{trades.length}</td>
                      <td className={`${tdClass} text-green-400`}>{wins.length}</td>
                      <td className={`${tdClass} text-red-400`}>{losses.length}</td>
                      <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
                      <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className={`${tdClass} ${stats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${stats.avgRR.toFixed(1)}R` : 'N/A'}
                      </td>
                      <td className={`${tdClass} text-green-400`}>
                        {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '-'}
                      </td>
                      <td className={`${tdClass} text-red-400`}>
                        {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '-'}
                      </td>
                      <td className={`${tdClass} ${stats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatUsdPnl(stats.totalPnL)}
                      </td>
                      <td
                        className={`${tdClass} ${pnlPctOfGainsLossColor(stats.totalPnL, stats.totalGains, stats.totalLosses)}`}
                      >
                        {formatPnLPctOfGainsLoss(stats.totalPnL, stats.totalGains, stats.totalLosses)}
                      </td>
                      <td className={`${tdClass} text-teal-400`}>
                        {formatARateCell(trades)}
                      </td>
                    </tr>
                    {isExpanded && sortedDays.map(dayKey => 
                      renderDayRow(dayKey, dayGroups[dayKey], periodKey)
                    )}
                  </React.Fragment>
                )
              } else if (period === 'monthly') {
                // For monthly period, show expandable nested view with weeks
                const isExpanded = expandedMonths.has(periodKey)
                const weekGroups = groupTradesByWeek(trades)
                const sortedWeeks = Object.keys(weekGroups).sort()
                // Format month label
                const [year, month] = periodKey.split('-')
                const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1)
                const monthLabel = format(monthDate, 'MMMM yyyy')
                
                return (
                  <React.Fragment key={periodKey}>
                    <tr 
                      onClick={() => toggleMonth(periodKey)}
                      className={`${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} cursor-pointer font-semibold`}
                    >
                      <td className={tdClass}>
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{monthLabel}</span>
                        </div>
                      </td>
                      <td className={tdClass}>{trades.length}</td>
                      <td className={`${tdClass} text-green-400`}>{wins.length}</td>
                      <td className={`${tdClass} text-red-400`}>{losses.length}</td>
                      <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
                      <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className={`${tdClass} ${stats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${stats.avgRR.toFixed(1)}R` : 'N/A'}
                      </td>
                      <td className={`${tdClass} text-green-400`}>
                        {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '-'}
                      </td>
                      <td className={`${tdClass} text-red-400`}>
                        {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '-'}
                      </td>
                      <td className={`${tdClass} ${stats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatUsdPnl(stats.totalPnL)}
                      </td>
                      <td
                        className={`${tdClass} ${pnlPctOfGainsLossColor(stats.totalPnL, stats.totalGains, stats.totalLosses)}`}
                      >
                        {formatPnLPctOfGainsLoss(stats.totalPnL, stats.totalGains, stats.totalLosses)}
                      </td>
                      <td className={`${tdClass} text-teal-400`}>
                        {formatARateCell(trades)}
                      </td>
                    </tr>
                    {isExpanded && sortedWeeks.map(weekKey => 
                      renderWeekRow(weekKey, weekGroups[weekKey], periodKey, 1)
                    )}
                  </React.Fragment>
                )
              } else if (period === 'yearly') {
                // For yearly period, show expandable nested view with months
                const isExpanded = expandedYears.has(periodKey)
                const monthGroups = groupTradesByMonth(trades)
                const sortedMonths = Object.keys(monthGroups).sort()
                return (
                  <React.Fragment key={periodKey}>
                    <tr 
                      onClick={() => toggleYear(periodKey)}
                      className={`${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} cursor-pointer font-semibold`}
                    >
                      <td className={tdClass}>
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{formatPeriodLabel(periodKey)}</span>
                        </div>
                      </td>
                      <td className={tdClass}>{trades.length}</td>
                      <td className={`${tdClass} text-green-400`}>{wins.length}</td>
                      <td className={`${tdClass} text-red-400`}>{losses.length}</td>
                      <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
                      <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className={`${tdClass} ${stats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {decisiveTrades > 0 ? `${stats.avgRR.toFixed(1)}R` : 'N/A'}
                      </td>
                      <td className={`${tdClass} text-green-400`}>
                        {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '-'}
                      </td>
                      <td className={`${tdClass} text-red-400`}>
                        {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '-'}
                      </td>
                      <td className={`${tdClass} ${stats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatUsdPnl(stats.totalPnL)}
                      </td>
                      <td
                        className={`${tdClass} ${pnlPctOfGainsLossColor(stats.totalPnL, stats.totalGains, stats.totalLosses)}`}
                      >
                        {formatPnLPctOfGainsLoss(stats.totalPnL, stats.totalGains, stats.totalLosses)}
                      </td>
                      <td className={`${tdClass} text-teal-400`}>
                        {formatARateCell(trades)}
                      </td>
                    </tr>
                    {isExpanded && sortedMonths.map(monthKey => 
                      renderMonthRow(monthKey, monthGroups[monthKey], periodKey)
                    )}
                  </React.Fragment>
                )
              } else {
                // For daily period, non-expandable rows with click handler
                return (
                  <tr 
                    key={periodKey} 
                    onClick={() => onPeriodClick && onPeriodClick(periodKey, period)}
                    className={`${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} ${onPeriodClick ? 'cursor-pointer' : ''}`}
                  >
                    <td className={tdClass}>{formatPeriodLabel(periodKey)}</td>
                    <td className={tdClass}>{trades.length}</td>
                    <td className={`${tdClass} text-green-400`}>{wins.length}</td>
                    <td className={`${tdClass} text-red-400`}>{losses.length}</td>
                    <td className={`${tdClass} text-amber-400`}>{breakevens.length}</td>
                    <td className={`${tdClass} ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                      {decisiveTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className={`${tdClass} ${stats.avgRR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {decisiveTrades > 0 ? `${stats.avgRR.toFixed(1)}R` : 'N/A'}
                    </td>
                    <td className={`${tdClass} text-green-400`}>
                      {stats.totalGains > 0 ? formatUsdPnl(stats.totalGains) : '-'}
                    </td>
                    <td className={`${tdClass} text-red-400`}>
                      {stats.totalLosses > 0 ? formatUsdPnl(stats.totalLosses) : '-'}
                    </td>
                    <td className={`${tdClass} ${stats.totalPnL > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatUsdPnl(stats.totalPnL)}
                    </td>
                    <td
                      className={`${tdClass} ${pnlPctOfGainsLossColor(stats.totalPnL, stats.totalGains, stats.totalLosses)}`}
                    >
                      {formatPnLPctOfGainsLoss(stats.totalPnL, stats.totalGains, stats.totalLosses)}
                    </td>
                    <td className={`${tdClass} text-teal-400`}>
                      {formatARateCell(trades)}
                    </td>
                  </tr>
                )
              }
            })}
          </tbody>
        </table>
      </div>
      
      {/* Image Modal */}
      {renderImageModal()}
      
      {/* Video Preview Modal */}
      {renderVideoPreviewModal()}
      
      {/* Video Modal */}
      {renderVideoModal()}
    </div>
  )
}

