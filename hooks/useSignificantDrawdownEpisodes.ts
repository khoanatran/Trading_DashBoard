import { useMemo } from 'react'
import {
  computeMaxDrawdownSeries,
  computeDrawdownEpisodes,
  filterOverlappingDrawdownEpisodes,
  maxDrawdownSeriesToEpisode,
  dedupeDrawdownEpisodes,
  SIGNIFICANT_DRAWDOWN_MIN,
  type DrawdownEpisode,
  type MaxDrawdownSeriesResult,
  type Trade,
} from '@/utils/logParser'

export function useSignificantDrawdownEpisodes(trades: Trade[]): {
  drawdownSeries: MaxDrawdownSeriesResult
  episodes: DrawdownEpisode[]
} {
  const drawdownSeries = useMemo(
    () => computeMaxDrawdownSeries(trades ?? []),
    [trades]
  )

  const episodes = useMemo(() => {
    const candidates = computeDrawdownEpisodes(
      drawdownSeries.points,
      SIGNIFICANT_DRAWDOWN_MIN
    )
    const maxEpisode = maxDrawdownSeriesToEpisode(
      drawdownSeries,
      SIGNIFICANT_DRAWDOWN_MIN
    )
    const merged = maxEpisode
      ? dedupeDrawdownEpisodes([...candidates, maxEpisode])
      : candidates
    return filterOverlappingDrawdownEpisodes(merged)
  }, [drawdownSeries])

  return { drawdownSeries, episodes }
}
