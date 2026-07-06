'use client'

import React from 'react'

type FitImageViewerProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /** Max height for the fitted image (portrait/landscape both scale inside). */
  maxHeight?: string
}

/** Full image in a modal/lightbox — preserves aspect ratio, no cropping. */
export function FitImageViewer({
  maxHeight = 'calc(95vh - 10rem)',
  className = '',
  style,
  alt = '',
  ...props
}: FitImageViewerProps) {
  return (
    <img
      {...props}
      alt={alt}
      className={`block w-auto h-auto max-w-full object-contain select-none ${className}`.trim()}
      style={{ maxHeight, maxWidth: '100%', ...style }}
    />
  )
}

type FitImageThumbnailProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  darkMode?: boolean
}

type FitVideoViewerProps = React.VideoHTMLAttributes<HTMLVideoElement>

/** Inline video in the notes panel — full width, preserves aspect ratio. */
export function FitVideoViewer({
  className = '',
  style,
  ...props
}: FitVideoViewerProps) {
  return (
    <video
      {...props}
      playsInline
      controls
      preload="metadata"
      className={`block w-full h-auto max-w-full object-contain rounded bg-black ${className}`.trim()}
      style={{ maxWidth: '100%', ...style }}
    />
  )
}

/** Grid thumbnail — shows the full frame inside the cell at any aspect ratio. */
export function FitImageThumbnail({
  darkMode = true,
  className = '',
  alt = '',
  ...props
}: FitImageThumbnailProps) {
  return (
    <img
      {...props}
      alt={alt}
      className={`w-full h-full object-contain ${
        darkMode ? 'bg-gray-900' : 'bg-gray-100'
      } ${className}`.trim()}
    />
  )
}
