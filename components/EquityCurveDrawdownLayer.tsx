'use client'

import React from 'react'
import { formatUsdPnl } from '@/lib/format'

export interface DrawdownHighlight {
  amount: number
  peakIndex: number
  troughIndex: number
  peakPnl: number
  troughPnl: number
  peakSeriesPosition: number
  troughSeriesPosition: number
  /** Strongest styling (max drawdown). */
  isPrimary?: boolean
  /** Stable id for linking chart zones to Timeline recap rows. */
  episodeKey?: string
}

interface CurvePoint {
  index: number
  seriesPosition?: number
  pnl: number
}

interface LineChartPoint {
  x: number
  y: number
  value?: number
  payload?: CurvePoint
}

interface FormattedGraphicalItem {
  props?: {
    dataKey?: string | number
    points?: LineChartPoint[]
  }
}

interface LayerProps {
  formattedGraphicalItems?: FormattedGraphicalItem[]
  xAxisMap?: Record<string, { scale: (v: number) => number; bandwidth?: () => number }>
  yAxisMap?: Record<string, { scale: (v: number) => number }>
  offset?: { left: number; top: number }
  data?: CurvePoint[]
  highlights?: DrawdownHighlight[]
  highlight?: DrawdownHighlight | null
  darkMode?: boolean
  activeEpisodeKey?: string | null
  onHighlightClick?: (highlight: DrawdownHighlight) => void
}

function getPnlLinePoints(items?: FormattedGraphicalItem[]): LineChartPoint[] | null {
  if (!items?.length) return null
  for (const entry of items) {
    if (entry?.props?.dataKey === 'pnl' && entry.props.points?.length) {
      return entry.props.points
    }
  }
  return null
}

function scaleX(
  tradeIndex: number,
  xAxis: { scale: (v: number) => number; bandwidth?: () => number } | undefined
): number {
  if (!xAxis?.scale) return 0
  let pos = xAxis.scale(tradeIndex)
  if (typeof pos !== 'number' || Number.isNaN(pos)) {
    pos = Number(xAxis.scale(Number(tradeIndex)))
  }
  if (typeof pos !== 'number' || Number.isNaN(pos)) return 0
  const bw = xAxis.bandwidth?.() ?? 0
  return pos + (bw > 0 ? bw / 2 : 0)
}

function scaleY(
  pnl: number,
  yAxis: { scale: (v: number) => number } | undefined
): number {
  if (!yAxis?.scale) return 0
  return yAxis.scale(pnl)
}

function resolveLinePoint(
  linePoints: LineChartPoint[],
  seriesPosition: number,
  tradeIndex: number
): LineChartPoint | undefined {
  const byPos = linePoints[seriesPosition]
  if (byPos && byPos.payload?.index === tradeIndex) return byPos
  return linePoints.find(p => p.payload?.index === tradeIndex)
}

function renderEpisode(
  highlight: DrawdownHighlight,
  linePoints: LineChartPoint[] | null,
  xAxis: { scale: (v: number) => number; bandwidth?: () => number } | undefined,
  yAxis: { scale: (v: number) => number } | undefined,
  data: CurvePoint[],
  darkMode: boolean,
  activeEpisodeKey: string | null | undefined,
  onHighlightClick: ((highlight: DrawdownHighlight) => void) | undefined
): React.ReactNode {
  const {
    amount,
    peakIndex,
    troughIndex,
    peakPnl,
    troughPnl,
    peakSeriesPosition,
    troughSeriesPosition,
    isPrimary,
  } = highlight

  const lo = Math.min(peakSeriesPosition, troughSeriesPosition)
  const hi = Math.max(peakSeriesPosition, troughSeriesPosition)

  let peakCoord: { x: number; y: number }
  let troughCoord: { x: number; y: number }
  let segmentCoords: Array<{ x: number; y: number }>

  if (linePoints?.length) {
    const peakPt =
      resolveLinePoint(linePoints, peakSeriesPosition, peakIndex) ?? linePoints[lo]
    const troughPt =
      resolveLinePoint(linePoints, troughSeriesPosition, troughIndex) ?? linePoints[hi]
    if (!peakPt || !troughPt) return null

    peakCoord = { x: peakPt.x, y: peakPt.y }
    troughCoord = { x: troughPt.x, y: troughPt.y }
    segmentCoords = linePoints
      .filter((_, i) => i >= lo && i <= hi)
      .map(p => ({ x: p.x, y: p.y }))
  } else if (xAxis && yAxis) {
    const peakPoint = data[peakSeriesPosition] ?? data.find(p => p.index === peakIndex)
    const troughPoint = data[troughSeriesPosition] ?? data.find(p => p.index === troughIndex)
    peakCoord = {
      x: scaleX(peakPoint?.index ?? peakIndex, xAxis),
      y: scaleY(peakPnl, yAxis),
    }
    troughCoord = {
      x: scaleX(troughPoint?.index ?? troughIndex, xAxis),
      y: scaleY(troughPnl, yAxis),
    }
    segmentCoords = data
      .filter(
        p =>
          p.seriesPosition != null && p.seriesPosition >= lo && p.seriesPosition <= hi
      )
      .map(p => ({ x: scaleX(p.index, xAxis), y: scaleY(p.pnl, yAxis) }))
  } else {
    return null
  }

  if (segmentCoords.length === 0) return null

  const { x: xPeak, y: yPeak } = peakCoord
  const { x: xTrough, y: yTrough } = troughCoord
  const curve = segmentCoords.map(p => `${p.x},${p.y}`).join(' L ')
  const fillPath = `M ${xPeak},${yPeak} L ${curve} L ${xTrough},${yPeak} Z`
  const strokePath = `M ${curve}`
  const labelX = (xPeak + xTrough) / 2
  const labelY = (yPeak + yTrough) / 2
  const isActive =
    highlight.episodeKey != null && highlight.episodeKey === activeEpisodeKey
  const fillOpacity = isActive
    ? darkMode
      ? 0.29
      : 0.25
    : isPrimary
      ? darkMode
        ? 0.23
        : 0.19
      : darkMode
        ? 0.13
        : 0.11
  const strokeWidth = isActive ? (isPrimary ? 4 : 3) : isPrimary ? 3 : 2
  const strokeColor = isActive ? '#3b82f6' : '#EF4444'
  const label = formatUsdPnl(amount)

  return (
    <g
      key={`dd-${peakIndex}-${troughIndex}-${amount}`}
      className={isPrimary ? 'equity-drawdown-layer-primary' : 'equity-drawdown-layer'}
    >
      <path d={fillPath} fill="#EF4444" fillOpacity={fillOpacity} stroke="none" pointerEvents="none" />
      <path
        d={strokePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity={isActive ? 1 : isPrimary ? 1 : 0.75}
        pointerEvents="none"
      />
      <line
        x1={xPeak}
        y1={yPeak}
        x2={xTrough}
        y2={yPeak}
        stroke={strokeColor}
        strokeWidth={isActive ? 2.5 : isPrimary ? 2 : 1.5}
        strokeDasharray="6 4"
        strokeOpacity={isActive ? 1 : isPrimary ? 1 : 0.7}
        pointerEvents="none"
      />
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={isActive ? '#3b82f6' : '#EF4444'}
        fontSize={isPrimary ? 12 : 11}
        fontWeight={700}
        stroke={darkMode ? '#111827' : '#ffffff'}
        strokeWidth={3}
        paintOrder="stroke"
        pointerEvents="none"
      >
        {label}
      </text>
      {onHighlightClick && (
        <path
          d={fillPath}
          fill="transparent"
          stroke="none"
          className="cursor-pointer"
          pointerEvents="all"
          role="button"
          tabIndex={0}
          aria-label={`Open ${label} drawdown recap on Timeline`}
          onClick={() => onHighlightClick(highlight)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onHighlightClick(highlight)
            }
          }}
        >
          <title>{`Open ${label} drawdown recap on Timeline`}</title>
        </path>
      )}
    </g>
  )
}

/** SVG overlay for one or more drawdown segments on the equity curve. */
export function EquityCurveDrawdownLayer({
  formattedGraphicalItems,
  xAxisMap,
  yAxisMap,
  data,
  highlights,
  highlight,
  darkMode = true,
  activeEpisodeKey = null,
  onHighlightClick,
}: LayerProps) {
  const episodeList =
    highlights?.length ? highlights : highlight ? [highlight] : []
  if (!episodeList.length || !data?.length) return null

  const linePoints = getPnlLinePoints(formattedGraphicalItems)
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : undefined
  const yAxis = yAxisMap ? Object.values(yAxisMap)[0] : undefined

  const sorted = [...episodeList].sort((a, b) => {
    if (a.isPrimary) return 1
    if (b.isPrimary) return -1
    return a.amount - b.amount
  })

  return (
    <g className="equity-drawdown-layers">
      {sorted.map(ep =>
        renderEpisode(
          ep,
          linePoints,
          xAxis,
          yAxis,
          data,
          darkMode,
          activeEpisodeKey,
          onHighlightClick
        )
      )}
    </g>
  )
}
