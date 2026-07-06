const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const usdPnlFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Round P&L up to the nearest whole dollar. */
export function roundPnlUp(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  return Math.ceil(value)
}

/** USD with thousands separators, e.g. $2,930.40 (non-P&L amounts). */
export function formatUsd(value: number | null | undefined): string {
  return usdFormatter.format(value ?? 0)
}

/** P&L in whole dollars, rounded up, e.g. $2,931 */
export function formatUsdPnl(value: number | null | undefined): string {
  return usdPnlFormatter.format(roundPnlUp(value ?? 0))
}

/** Negative P&L with minus before the dollar sign, e.g. -$527 */
export function formatUsdPnlSigned(value: number | null | undefined): string {
  const v = roundPnlUp(value ?? 0)
  if (v < 0) return `-${formatUsdPnl(Math.abs(v))}`
  return formatUsdPnl(v)
}

export function formatUsdPnlOrNa(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return formatUsdPnl(value)
}

/** Negative values prefixed with minus before the dollar sign, e.g. -$527.40 */
export function formatUsdSigned(value: number | null | undefined): string {
  const v = value ?? 0
  if (v < 0) return `-${formatUsd(Math.abs(v))}`
  return formatUsd(v)
}

export function formatUsdOrNa(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return formatUsd(value)
}
