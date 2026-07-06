export const SETUP_RATING_TAGS = [
  { name: 'LVN', color: 'bg-sky-500/20 text-sky-300 border-sky-500/40', stars: 1 },
  { name: 'Heatmap Limit Order', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40', stars: 1 },
  { name: 'Heatmap Traps', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40', stars: 1 },
  { name: 'Candle PA', color: 'bg-violet-500/20 text-violet-300 border-violet-500/40', stars: 1 },
  { name: 'SC Dot/ Zone', color: 'bg-teal-500/20 text-teal-300 border-teal-500/40', stars: 1 },
  {
    name: 'Final Retest at Recent Level',
    color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    stars: 1,
  },
] as const

export const SETUP_TAG_NAMES: Set<string> = new Set(
  SETUP_RATING_TAGS.map(t => t.name)
)

export function countSetupTagRating(selected: string[]): number {
  const total = SETUP_RATING_TAGS.filter(t => selected.includes(t.name)).reduce(
    (sum, t) => sum + t.stars,
    0
  )
  return Math.min(total, 5)
}
