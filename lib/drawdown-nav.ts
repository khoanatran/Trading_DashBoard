import type { DrawdownEpisode } from '@/utils/logParser'
import { getDrawdownEpisodeKey } from '@/utils/logParser'

export const PENDING_DRAWDOWN_RECAP_KEY = 'pendingDrawdownRecapKey'
export const PENDING_EQUITY_DRAWDOWN_KEY = 'pendingEquityDrawdownKey'

export const NAVIGATE_DRAWDOWN_RECAP_EVENT = 'navigate-drawdown-recap'
export const NAVIGATE_EQUITY_DRAWDOWN_EVENT = 'navigate-equity-drawdown'

export function requestNavigateToDrawdownRecap(ep: DrawdownEpisode): string {
  const key = getDrawdownEpisodeKey(ep)
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PENDING_DRAWDOWN_RECAP_KEY, key)
  }
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_DRAWDOWN_RECAP_EVENT, { detail: { key } })
  )
  return key
}

export function requestNavigateToEquityDrawdown(ep: DrawdownEpisode): string {
  const key = getDrawdownEpisodeKey(ep)
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PENDING_EQUITY_DRAWDOWN_KEY, key)
  }
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_EQUITY_DRAWDOWN_EVENT, { detail: { key } })
  )
  return key
}

export function consumePendingDrawdownRecapKey(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const key = sessionStorage.getItem(PENDING_DRAWDOWN_RECAP_KEY)
  if (key) sessionStorage.removeItem(PENDING_DRAWDOWN_RECAP_KEY)
  return key
}

export function consumePendingEquityDrawdownKey(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const key = sessionStorage.getItem(PENDING_EQUITY_DRAWDOWN_KEY)
  if (key) sessionStorage.removeItem(PENDING_EQUITY_DRAWDOWN_KEY)
  return key
}
