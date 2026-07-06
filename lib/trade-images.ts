export type TradeImageSection = 'before' | 'after'

export const TRADE_IMAGE_SECTION_LABELS: Record<TradeImageSection, string> = {
  before: 'Entry',
  after: 'Heatmap & Delta',
}

export function normalizeTradeImageSection(
  section?: string | null
): TradeImageSection {
  return section === 'after' ? 'after' : 'before'
}

export function tradeImageSectionLabel(
  section?: string | null | TradeImageSection
): string {
  return TRADE_IMAGE_SECTION_LABELS[normalizeTradeImageSection(section)]
}

export function imagesForTradeSection<T extends { section?: string | null; name: string }>(
  images: T[],
  section: TradeImageSection
): T[] {
  return images.filter(
    img => normalizeTradeImageSection(img.section) === section
  )
}

/** Reorder images within one section while preserving other sections' positions. */
export function reorderSectionImages<T extends { name: string; section?: string | null }>(
  images: T[],
  section: TradeImageSection,
  orderedNames: string[]
): T[] | null {
  const sectionImages = imagesForTradeSection(images, section)
  if (orderedNames.length !== sectionImages.length) return null

  const sectionNameSet = new Set(sectionImages.map(img => img.name))
  if (!orderedNames.every(name => sectionNameSet.has(name))) return null

  const nameToImage = new Map(images.map(img => [img.name, img]))
  const queue = orderedNames.map(name => nameToImage.get(name)!)

  return images.map(img => {
    if (normalizeTradeImageSection(img.section) === section) {
      return queue.shift()!
    }
    return img
  })
}

export function swapSectionImageOrder<T extends { name: string; section?: string | null }>(
  images: T[],
  section: TradeImageSection,
  localIndex: number,
  direction: 'up' | 'down'
): T[] | null {
  const sectionImages = imagesForTradeSection(images, section)
  const targetIndex = direction === 'up' ? localIndex - 1 : localIndex + 1
  if (targetIndex < 0 || targetIndex >= sectionImages.length) return null

  const names = sectionImages.map(img => img.name)
  ;[names[localIndex], names[targetIndex]] = [names[targetIndex], names[localIndex]]
  return reorderSectionImages(images, section, names)
}
