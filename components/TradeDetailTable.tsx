'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Trade, PartialExit, parseLocalTimestamp, getTradeEntryTimeMs, getTradeId, getTradeRMultiple, getPartialExitRMultiple, getTradeDollarRisk } from '@/utils/logParser'
import { formatUsd, formatUsdPnl, formatUsdPnlOrNa } from '@/lib/format'
import { formatWallClockTimeOnly } from '@/lib/timezone'
import { ChevronDown, ChevronRight, ChevronLeft, ImagePlus, X, Trash2, ZoomIn, ZoomOut, RotateCcw, Pen, Eraser, Undo2, Trash, Circle, Video, Play, Pause, Scissors, Save, Film } from 'lucide-react'
import { useLazyMedia } from '@/hooks/useLazyMedia'

// Format price with commas (e.g., 25720.75 -> 25,720.75)
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return 'N/A'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface TradeDetailTableProps {
  trades: Trade[]
  darkMode: boolean
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

export default function TradeDetailTable({ trades, darkMode }: TradeDetailTableProps) {
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set())
  
  // Get all trade IDs for lazy loading
  const allTradeIds = useMemo(() => trades.map(trade => getTradeId(trade)), [trades])
  
  // Use lazy loading hook for images and videos
  const {
    images: lazyImages,
    videos: lazyVideos,
    loadBatch,
    updateImages: updateCachedImages,
    updateVideos: updateCachedVideos
  } = useLazyMedia({ tradeIds: allTradeIds, batchSize: 20 })

  // Image state
  const [tradeImages, setTradeImages] = useState<Record<string, TradeImage[]>>({})
  const [uploadingTrades, setUploadingTrades] = useState<Set<string>>(new Set())

  // Sync lazy loaded data to local state
  useEffect(() => {
    setTradeImages(prev => ({ ...prev, ...lazyImages }))
  }, [lazyImages])
  
  // Modal state
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
  const [drawingColor, setDrawingColor] = useState('#ef4444')
  const [brushSize, setBrushSize] = useState(3)
  const [strokes, setStrokes] = useState<DrawingStroke[]>([])
  const [currentStroke, setCurrentStroke] = useState<DrawingStroke | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isSavingDrawing, setIsSavingDrawing] = useState(false)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
  // Video state
  const [tradeVideos, setTradeVideos] = useState<Record<string, TradeVideo[]>>({})
  const [uploadingVideos, setUploadingVideos] = useState<Set<string>>(new Set())
  const [videoModalState, setVideoModalState] = useState<{
    tradeId: string
    videoIndex: number
  } | null>(null)
  
  // Sync lazy loaded videos to local state
  useEffect(() => {
    setTradeVideos(prev => ({ ...prev, ...lazyVideos }))
  }, [lazyVideos])
  
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
  
  const sortedTrades = [...trades].sort(
    (a, b) => getTradeEntryTimeMs(a) - getTradeEntryTimeMs(b)
  )
  
  // Images and videos are now loaded via useLazyMedia hook
  
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

  // Delete a video
  const deleteVideo = useCallback(async (tradeId: string, videoId: string) => {
    if (!confirm('Remove this video? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/trade-videos?tradeId=${encodeURIComponent(tradeId)}&videoId=${encodeURIComponent(videoId)}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to delete video')
        return
      }

      const updated = (tradeVideos[tradeId] || []).filter(v => v.id !== videoId)
      setTradeVideos(prev => ({ ...prev, [tradeId]: updated }))
      updateCachedVideos(tradeId, updated)

      if (videoModalState?.tradeId === tradeId) {
        if (updated.length === 0) {
          closeVideoModal()
        } else if (videoModalState.videoIndex >= updated.length) {
          setVideoModalState(prev => prev ? { ...prev, videoIndex: updated.length - 1 } : null)
        }
      }
    } catch (err) {
      console.error('Delete video error:', err)
      alert('Failed to delete video')
    }
  }, [videoModalState, tradeVideos, updateCachedVideos, closeVideoModal])
  
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
  
  // Upload images
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
        setTradeImages(prev => ({
          ...prev,
          [tradeId]: [...(prev[tradeId] || []), ...data.files]
        }))
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
          return { ...prev, [tradeId]: updated }
        })
        
        if (modalState?.tradeId === tradeId) {
          const images = tradeImages[tradeId] || []
          if (images.length <= 1) {
            closeModal()
          } else if (modalState.imageIndex >= images.length - 1) {
            setModalState(prev => prev ? { ...prev, imageIndex: Math.max(0, prev.imageIndex - 1) } : null)
          }
        }
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }, [modalState, tradeImages])
  
  // Save note
  const saveNote = useCallback(async (tradeId: string, imageName: string, note: string) => {
    setIsSavingNote(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, note })
      })
      
      if (res.ok) {
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
  
  // Save drawings
  const saveDrawings = useCallback(async (tradeId: string, imageName: string, drawings: DrawingStroke[]) => {
    setIsSavingDrawing(true)
    try {
      const res = await fetch('/api/trade-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, name: imageName, drawings })
      })
      
      if (res.ok) {
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
  
  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
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
  
  React.useEffect(() => {
    renderCanvas()
  }, [renderCanvas])
  
  // Get canvas point
  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): DrawingPoint => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    }
  }, [])
  
  // Drawing handlers
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
    setCurrentStroke(prev => prev ? { ...prev, points: [...prev.points, point] } : null)
  }, [isDrawing, currentStroke, getCanvasPoint])
  
  const handleDrawEnd = useCallback(() => {
    if (!isDrawing || !currentStroke) return
    if (currentStroke.points.length > 1) {
      setStrokes(prev => [...prev, currentStroke])
    }
    setCurrentStroke(null)
    setIsDrawing(false)
  }, [isDrawing, currentStroke])
  
  const undoStroke = useCallback(() => setStrokes(prev => prev.slice(0, -1)), [])
  const clearStrokes = useCallback(() => setStrokes([]), [])
  
  // Open modal
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
  
  // Close modal
  const closeModal = useCallback(async () => {
    if (modalState) {
      const images = tradeImages[modalState.tradeId] || []
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
    }
    
    setModalState(null)
    setEditingNote('')
    setStrokes([])
    setIsDrawingMode(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Navigate slideshow
  const navigateSlideshow = useCallback(async (direction: 'prev' | 'next') => {
    if (!modalState) return
    
    const images = tradeImages[modalState.tradeId] || []
    if (images.length === 0) return
    
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
    
    const newImage = images[newIndex]
    setEditingNote(newImage?.note || '')
    setStrokes(newImage?.drawings || [])
    setModalState({ ...modalState, imageIndex: newIndex })
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [modalState, tradeImages, editingNote, strokes, saveNote, saveDrawings])
  
  // Zoom/pan handlers
  const handleZoomIn = useCallback(() => setZoom(prev => Math.min(prev * 1.5, 5)), [])
  const handleZoomOut = useCallback(() => setZoom(prev => Math.max(prev / 1.5, 0.5)), [])
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [zoom, pan])
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
    }
  }, [isDragging, zoom, dragStart])
  
  const handleMouseUp = useCallback(() => setIsDragging(false), [])
  
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
        case 'ArrowLeft': navigateSlideshow('prev'); break
        case 'ArrowRight': navigateSlideshow('next'); break
        case 'Escape': closeModal(); break
        case '+': case '=': handleZoomIn(); break
        case '-': handleZoomOut(); break
        case '0': resetZoom(); break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalState, navigateSlideshow, closeModal, handleZoomIn, handleZoomOut, resetZoom])
  
  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedTrades)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedTrades(newExpanded)
  }
  
  const tableClass = darkMode
    ? 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-gray-800 border border-gray-700'
    : 'w-full border-collapse rounded-xl overflow-hidden shadow-lg bg-white border border-gray-200'

  const thClass = darkMode
    ? 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-700 text-gray-300'
    : 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider bg-gray-100 text-gray-700'

  const tdClass = darkMode
    ? 'px-4 py-3 border-t border-gray-700 text-sm'
    : 'px-4 py-3 border-t border-gray-200 text-sm'
  
  const renderPartialExitRow = (exit: PartialExit, tradeIndex: number, exitIndex: number) => {
    const exitType = exit.isFinal ? 'Final Exit' : 'Partial Exit'
    
    return (
      <tr 
        key={`trade-${tradeIndex}-exit-${exitIndex}`}
        className={darkMode ? 'bg-gray-900' : 'bg-gray-50'}
      >
        <td className={`${tdClass} pl-8`}>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">└─</span>
            <span className={exit.isFinal ? 'text-blue-400' : 'text-yellow-400'}>
              {exitType}
            </span>
            <span className="text-muted-foreground text-xs">
              ({exit.contracts} contract{exit.contracts > 1 ? 's' : ''})
            </span>
          </div>
        </td>
        <td className={tdClass}>
          {exit.reward !== null && exit.reward !== undefined 
            ? `${exit.reward.toFixed(2)} pts`
            : '-'}
        </td>
        <td className={tdClass}>-</td>
        <td className={tdClass}>{exit.entryPrice ? formatPrice(exit.entryPrice) : '-'}</td>
        <td className={tdClass}>{exit.exitPrice ? formatPrice(exit.exitPrice) : '-'}</td>
        <td className={tdClass}>{exit.contracts}</td>
        <td className={tdClass}>-</td>
        <td className={tdClass}>
          {exit.estRisk !== null && exit.estRisk !== undefined 
            ? formatUsd(exit.estRisk)
            : '-'}
        </td>
        <td className={tdClass}>-</td>
        <td className={`${tdClass} ${(getPartialExitRMultiple(exit) ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {getPartialExitRMultiple(exit) !== null 
            ? `${getPartialExitRMultiple(exit)!.toFixed(1)}R` 
            : '-'}
        </td>
        <td className={`${tdClass} ${exit.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatUsdPnl(exit.pnl)}
        </td>
      </tr>
    )
  }
  
  // Render image modal
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
        <div 
          className={`relative w-[95vw] h-[95vh] ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-lg overflow-hidden shadow-2xl flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
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
              <button onClick={handleZoomOut} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={resetZoom} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Reset">
                <RotateCcw className="h-4 w-4" />
              </button>
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              {/* Drawing tools */}
              <button
                onClick={() => setIsDrawingMode(!isDrawingMode)}
                className={`p-1.5 rounded transition-colors ${isDrawingMode ? 'bg-blue-500 text-white' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                title={isDrawingMode ? 'Exit drawing mode' : 'Enter drawing mode'}
              >
                <Pen className="h-4 w-4" />
              </button>
              
              {isDrawingMode && (
                <>
                  <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <button onClick={() => setDrawingTool('pen')} className={`p-1 rounded ${drawingTool === 'pen' ? 'bg-blue-500 text-white' : ''}`} title="Pen">
                      <Pen className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDrawingTool('highlighter')} className={`p-1 rounded ${drawingTool === 'highlighter' ? 'bg-yellow-500 text-white' : ''}`} title="Highlighter">
                      <Circle className="h-3 w-3" />
                    </button>
                    <button onClick={() => setDrawingTool('eraser')} className={`p-1 rounded ${drawingTool === 'eraser' ? 'bg-gray-500 text-white' : ''}`} title="Eraser">
                      <Eraser className="h-3 w-3" />
                    </button>
                  </div>
                  
                  {drawingTool !== 'eraser' && (
                    <div className="flex items-center gap-0.5">
                      {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'].map(color => (
                        <button
                          key={color}
                          onClick={() => setDrawingColor(color)}
                          className={`w-5 h-5 rounded-full border-2 ${drawingColor === color ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                  
                  <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-16 h-1 accent-blue-500" />
                  <button onClick={undoStroke} disabled={strokes.length === 0} className={`p-1.5 rounded ${strokes.length === 0 ? 'opacity-50' : darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Undo">
                    <Undo2 className="h-4 w-4" />
                  </button>
                  <button onClick={clearStrokes} disabled={strokes.length === 0} className={`p-1.5 rounded ${strokes.length === 0 ? 'opacity-50' : 'hover:bg-red-500/20 text-red-400'}`} title="Clear">
                    <Trash className="h-4 w-4" />
                  </button>
                  {isSavingDrawing && <span className="text-xs text-blue-400 animate-pulse">Saving...</span>}
                </>
              )}
              
              <div className="w-px h-5 bg-gray-600 mx-2" />
              
              <button onClick={() => { if (confirm('Delete?')) deleteImage(modalState.tradeId, currentImage.name) }} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={closeModal} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          
          {/* Image container */}
          <div 
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
              
              {canvasSize.width > 0 && (
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className="absolute inset-0 w-full h-full"
                  style={{ pointerEvents: isDrawingMode ? 'auto' : 'none' }}
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                />
              )}
            </div>
            
            {hasMultipleImages && (
              <>
                <button onClick={(e) => { e.stopPropagation(); navigateSlideshow('prev') }} className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); navigateSlideshow('next') }} className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          
          {/* Note text area */}
          <div className={`shrink-0 px-4 py-3 ${darkMode ? 'bg-gray-850 border-t border-gray-700' : 'bg-gray-50 border-t border-gray-200'}`}>
            <div className="flex items-start gap-3">
              <label className="text-sm font-medium text-muted-foreground shrink-0 pt-2">Notes:</label>
              <div className="flex-1 relative">
                <textarea
                  value={editingNote}
                  onChange={(e) => setEditingNote(e.target.value)}
                  onBlur={async () => {
                    if (currentImage && editingNote !== currentImage.note) {
                      await saveNote(modalState.tradeId, currentImage.name, editingNote)
                    }
                  }}
                  placeholder="Add notes..."
                  className={`w-full px-3 py-2 rounded-lg resize-none text-sm ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-300'} border focus:outline-none focus:ring-1 focus:ring-blue-500`}
                  rows={2}
                />
                {isSavingNote && <span className="absolute right-2 top-2 text-xs text-blue-400 animate-pulse">Saving...</span>}
              </div>
            </div>
          </div>
          
          {/* Thumbnail strip */}
          {hasMultipleImages && (
            <div className={`shrink-0 px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} overflow-x-auto`}>
              <div className="flex items-center gap-2 justify-center">
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={async () => {
                      if (currentImage && editingNote !== currentImage.note) {
                        await saveNote(modalState.tradeId, currentImage.name, editingNote)
                      }
                      setEditingNote(images[idx]?.note || '')
                      setStrokes(images[idx]?.drawings || [])
                      setModalState({ ...modalState, imageIndex: idx })
                      setZoom(1)
                      setPan({ x: 0, y: 0 })
                    }}
                    className={`w-12 h-12 rounded overflow-hidden border-2 shrink-0 ${idx === modalState.imageIndex ? 'border-blue-500' : darkMode ? 'border-gray-600 hover:border-gray-400' : 'border-gray-300 hover:border-gray-500'}`}
                  >
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
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
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={closeVideoModal} className={`p-1.5 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
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
              />
            </div>
            
            {/* Controls */}
            <div className={`px-4 py-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    const vid = videoRef.current
                    if (vid) {
                      if (isVideoPlaying) vid.pause()
                      else vid.play()
                    }
                  }}
                  className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  {isVideoPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
                
                <span className="text-sm font-mono w-20">
                  {formatVideoTime(videoCurrentTime)} / {formatVideoTime(vidDuration)}
                </span>
                
                <div className="flex-1">
                  <input
                    type="range" min={0} max={vidDuration} step={0.1} value={videoCurrentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value)
                      setVideoCurrentTime(time)
                      if (videoRef.current) videoRef.current.currentTime = time
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-600"
                  />
                </div>
              </div>
            </div>
            
            {/* Trim controls */}
            <div className={`px-4 py-4 border-t ${darkMode ? 'bg-gray-850 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Scissors className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-medium">Trim & Save Clip</span>
              </div>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Start:</span>
                  <input type="number" min={0} max={trimEnd - 0.1} step={0.1} value={trimStart.toFixed(1)}
                    onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button onClick={() => setTrimStart(videoCurrentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
                    Set
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">End:</span>
                  <input type="number" min={trimStart + 0.1} max={vidDuration} step={0.1} value={trimEnd.toFixed(1)}
                    onChange={(e) => setTrimEnd(parseFloat(e.target.value) || vidDuration)}
                    className={`w-20 px-2 py-1 rounded text-sm ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'} border`}
                  />
                  <button onClick={() => setTrimEnd(videoCurrentTime)}
                    className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
                    Set
                  </button>
                </div>
                
                <button onClick={createVideoClip} disabled={isClipping || trimEnd <= trimStart}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
                    isClipping || trimEnd <= trimStart ? 'bg-gray-600 text-gray-400' : 'bg-purple-500 hover:bg-purple-600 text-white'
                  }`}>
                  {isClipping ? 'Creating...' : <><Save className="h-4 w-4" />Save Clip</>}
                </button>
              </div>
            </div>
          </div>
          
          {hasMultipleVideos && (
            <>
              <button onClick={() => navigateVideoSlideshow('prev')}
                className={`absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button onClick={() => navigateVideoSlideshow('next')}
                className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full ${darkMode ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-white/80 hover:bg-gray-100'} shadow-lg`}>
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className={tableClass}>
          <thead className="sticky top-0">
            <tr>
              <th className={thClass}>Date</th>
              <th className={thClass}>Entry Time</th>
              <th className={thClass}>Direction</th>
              <th className={thClass}>Entry</th>
              <th className={thClass}>Exit</th>
              <th className={thClass}>Qty</th>
              <th className={thClass}>Risk</th>
              <th className={thClass}>Est Risked</th>
              <th className={thClass}>SL Points</th>
              <th className={thClass}>R:R</th>
              <th className={thClass}>P&L</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade, index) => {
              const date = trade.timestamp ? parseLocalTimestamp(trade.timestamp).toLocaleDateString() : 'N/A'
              const entryTime = formatWallClockTimeOnly(trade.entryTime ?? trade.timestamp)
              const isWin = (trade.pnl ?? 0) > 0
              const hasPartialExits = trade.partialExits && trade.partialExits.length > 0
              const isExpanded = expandedTrades.has(index)
              
              // Image attachment
              const tradeId = getTradeId(trade)
              const images = tradeImages[tradeId] || []
              const videos = tradeVideos[tradeId] || []
              const isUploading = uploadingTrades.has(tradeId)
              const isUploadingVideo = uploadingVideos.has(tradeId)
              
              const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                e.stopPropagation()
                if (e.target.files && e.target.files.length > 0) {
                  uploadImages(tradeId, e.target.files)
                }
                e.target.value = ''
              }
              
              const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                e.stopPropagation()
                if (e.target.files && e.target.files.length > 0) {
                  handleVideoSelect(tradeId, e.target.files)
                }
                e.target.value = ''
              }
              
              return (
                <React.Fragment key={index}>
                  <tr 
                    onClick={() => hasPartialExits && toggleExpanded(index)}
                    className={`${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} ${hasPartialExits ? 'cursor-pointer' : ''}`}
                  >
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        {hasPartialExits && (
                          isExpanded 
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> 
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{date}</span>
                        {hasPartialExits && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
                            {trade.partialExits!.length} exits
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={tdClass}>{entryTime}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <span className={trade.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
                          {trade.direction?.toUpperCase() || 'N/A'}
                        </span>
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isWin ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {isWin ? 'WIN' : 'LOSS'}
                        </span>
                        
                        {/* Image attachment */}
                        <div className="flex items-center gap-1 ml-1" onClick={(e) => e.stopPropagation()}>
                          <label className={`p-1 rounded cursor-pointer ${isUploading ? 'opacity-50' : darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}>
                            <ImagePlus className="h-4 w-4 text-blue-400" />
                            <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} disabled={isUploading} />
                          </label>
                          {images.length > 0 && (
                            <div className="flex items-center gap-1">
                              {images.slice(0, 3).map((img, imgIdx) => (
                                <button
                                  key={imgIdx}
                                  onClick={(e) => { e.stopPropagation(); openModal(tradeId, imgIdx) }}
                                  className={`w-6 h-6 rounded overflow-hidden border ${darkMode ? 'border-gray-600 hover:border-blue-400' : 'border-gray-300 hover:border-blue-500'}`}
                                >
                                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" loading="lazy" />
                                </button>
                              ))}
                              {images.length > 3 && <span className="text-xs text-muted-foreground">+{images.length - 3}</span>}
                            </div>
                          )}
                          {isUploading && <span className="text-xs text-blue-400 animate-pulse">...</span>}
                        </div>
                        
                        {/* Video attachment */}
                        <div className="flex items-center gap-1 ml-1">
                          <label className={`p-1 rounded cursor-pointer ${isUploadingVideo ? 'opacity-50' : darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}>
                            <Video className="h-4 w-4 text-purple-400" />
                            <input type="file" accept="video/*,.mkv,.mp4,.webm,.mov,.avi" className="hidden" onChange={handleVideoFileChange} disabled={isUploadingVideo} />
                          </label>
                          {videos.length > 0 && (
                            <div className="flex items-center gap-1">
                              {videos.slice(0, 2).map((vid, vidIdx) => (
                                <button
                                  key={vid.id}
                                  onClick={(e) => { e.stopPropagation(); openVideoModal(tradeId, vidIdx) }}
                                  className={`w-8 h-6 rounded overflow-hidden border relative ${darkMode ? 'border-gray-600 hover:border-purple-400' : 'border-gray-300 hover:border-purple-500'}`}
                                >
                                  {vid.thumbUrl ? (
                                    <img src={vid.thumbUrl} alt={vid.originalName} className="w-full h-full object-cover" loading="lazy" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-700">
                                      <Film className="h-3 w-3 text-gray-400" />
                                    </div>
                                  )}
                                </button>
                              ))}
                              {videos.length > 2 && <span className="text-xs text-muted-foreground">+{videos.length - 2}</span>}
                            </div>
                          )}
                          {isUploadingVideo && <span className="text-xs text-purple-400 animate-pulse">Converting...</span>}
                        </div>
                      </div>
                    </td>
                    <td className={tdClass}>{formatPrice(trade.entryPrice)}</td>
                    <td className={tdClass}>{formatPrice(trade.exitPrice)}</td>
                    <td className={tdClass}>{trade.orderQty || 'N/A'}</td>
                    <td className={tdClass}>{formatUsd(getTradeDollarRisk(trade))}</td>
                    <td className={tdClass}>{formatUsd(getTradeDollarRisk(trade))}</td>
                    <td className={tdClass}>{trade.slPoints?.toFixed(2) || 'N/A'}</td>
                    <td className={`${tdClass} ${(getTradeRMultiple(trade) ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {getTradeRMultiple(trade) !== null ? `${getTradeRMultiple(trade)!.toFixed(2)}R` : 'N/A'}
                    </td>
                    <td className={`${tdClass} ${(trade.pnl ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatUsdPnlOrNa(trade.pnl)}
                    </td>
                  </tr>
                  {isExpanded && hasPartialExits && trade.partialExits!.map((exit, exitIndex) => 
                    renderPartialExitRow(exit, index, exitIndex)
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      
      {renderImageModal()}
      {renderVideoPreviewModal()}
      {renderVideoModal()}
    </div>
  )
}
