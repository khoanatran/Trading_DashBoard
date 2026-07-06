import fs from 'fs/promises'
import path from 'path'
import type { Trade } from '@/utils/logParser'
import {
  buildTradeLookupMaps,
  resolveTradeId,
  resolveTradeIdFromMediaFilename,
} from '@/lib/trade-id-resolver'
import { notifyDataChanged } from '@/lib/notify-data-changed'

const DATA_DIR = path.join(process.cwd(), 'data')
const IMAGES_DIR = path.join(DATA_DIR, 'trade-images')
const VIDEOS_DIR = path.join(DATA_DIR, 'trade-videos')
const IMAGES_FILE = path.join(DATA_DIR, 'trade-images.json')
const VIDEOS_FILE = path.join(DATA_DIR, 'trade-videos.json')
const JOURNAL_FILE = path.join(DATA_DIR, 'trade-journal.json')
const TAGS_FILE = path.join(DATA_DIR, 'trade-tags.json')
const FLAGS_FILE = path.join(DATA_DIR, 'flags.json')
const TRADES_SNAPSHOT_FILE = path.join(DATA_DIR, 'trades-snapshot.json')

interface ImageData {
  name: string
  note?: string
  drawings?: unknown[]
  section?: string
}

interface VideoData {
  id: string
  originalName: string
  mp4FileName: string
  thumbFileName?: string
  durationSec?: number
  clipStartSec?: number
  clipEndSec?: number
  createdAt: string
}

interface FlagsData {
  days: Record<string, boolean>
  trades: Record<string, boolean>
}

export interface RemigrateResult {
  images: { remappedKeys: number; recoveredFiles: number; totalEntries: number }
  videos: { remappedKeys: number; recoveredFiles: number; totalEntries: number }
  journal: { remappedKeys: number; totalEntries: number }
  tags: { remappedKeys: number; totalEntries: number }
  flags: { remappedTrades: number }
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function remapStringKeyedRecord<T>(
  mapping: Record<string, T>,
  maps: ReturnType<typeof buildTradeLookupMaps>
): { result: Record<string, T>; remappedKeys: number } {
  const result: Record<string, T> = {}
  let remappedKeys = 0

  for (const [legacyId, value] of Object.entries(mapping)) {
    const resolved = resolveTradeId(legacyId, maps) ?? legacyId
    if (resolved !== legacyId) remappedKeys++

    if (result[resolved] === undefined) {
      result[resolved] = value
    } else if (typeof value === 'object' && value !== null) {
      // Prefer the entry with more content (e.g. longer note)
      const existing = result[resolved]
      if (JSON.stringify(value).length > JSON.stringify(existing).length) {
        result[resolved] = value
      }
    }
  }

  return { result, remappedKeys }
}

function mergeImageLists(existing: ImageData[], incoming: ImageData[]): ImageData[] {
  const byName = new Map<string, ImageData>()
  for (const img of [...existing, ...incoming]) {
    const prev = byName.get(img.name)
    if (!prev || JSON.stringify(img).length > JSON.stringify(prev).length) {
      byName.set(img.name, img)
    }
  }
  return Array.from(byName.values())
}

function remapImageMapping(
  mapping: Record<string, ImageData[]>,
  maps: ReturnType<typeof buildTradeLookupMaps>
): { result: Record<string, ImageData[]>; remappedKeys: number } {
  const result: Record<string, ImageData[]> = {}
  let remappedKeys = 0

  for (const [legacyId, images] of Object.entries(mapping)) {
    if (!Array.isArray(images) || images.length === 0) continue
    const resolved = resolveTradeId(legacyId, maps) ?? legacyId
    if (resolved !== legacyId) remappedKeys++
    result[resolved] = mergeImageLists(result[resolved] ?? [], images)
  }

  return { result, remappedKeys }
}

function mergeVideoLists(existing: VideoData[], incoming: VideoData[]): VideoData[] {
  const byId = new Map<string, VideoData>()
  for (const vid of [...existing, ...incoming]) {
    byId.set(vid.id, vid)
  }
  return Array.from(byId.values())
}

function remapVideoMapping(
  mapping: Record<string, VideoData[]>,
  maps: ReturnType<typeof buildTradeLookupMaps>
): { result: Record<string, VideoData[]>; remappedKeys: number } {
  const result: Record<string, VideoData[]> = {}
  let remappedKeys = 0

  for (const [legacyId, videos] of Object.entries(mapping)) {
    if (!Array.isArray(videos) || videos.length === 0) continue
    const resolved = resolveTradeId(legacyId, maps) ?? legacyId
    if (resolved !== legacyId) remappedKeys++
    result[resolved] = mergeVideoLists(result[resolved] ?? [], videos)
  }

  return { result, remappedKeys }
}

async function recoverOrphanImages(
  mapping: Record<string, ImageData[]>,
  maps: ReturnType<typeof buildTradeLookupMaps>
): Promise<{ mapping: Record<string, ImageData[]>; recoveredFiles: number }> {
  let recoveredFiles = 0

  try {
    const files = await fs.readdir(IMAGES_DIR)
    const referenced = new Set(
      Object.values(mapping)
        .flat()
        .map(img => img.name)
    )

    for (const file of files) {
      if (referenced.has(file)) continue
      const tradeId = resolveTradeIdFromMediaFilename(file, maps)
      if (!tradeId) continue

      if (!mapping[tradeId]) mapping[tradeId] = []
      if (!mapping[tradeId].some(img => img.name === file)) {
        mapping[tradeId].push({
          name: file,
          note: '',
          drawings: [],
          section: 'before',
        })
        recoveredFiles++
      }
    }
  } catch {
    // images dir may not exist yet
  }

  return { mapping, recoveredFiles }
}

async function recoverOrphanVideos(
  mapping: Record<string, VideoData[]>,
  maps: ReturnType<typeof buildTradeLookupMaps>
): Promise<{ mapping: Record<string, VideoData[]>; recoveredFiles: number }> {
  let recoveredFiles = 0

  try {
    const files = await fs.readdir(VIDEOS_DIR)
    const referencedMp4 = new Set(
      Object.values(mapping)
        .flat()
        .map(vid => vid.mp4FileName)
    )
    const referencedThumbs = new Set(
      Object.values(mapping)
        .flat()
        .map(vid => vid.thumbFileName)
        .filter((v): v is string => Boolean(v))
    )

    for (const file of files) {
      if (file.endsWith('_thumb.jpg')) {
        if (referencedThumbs.has(file)) continue
        // thumb orphans are linked when mp4 is recovered
        continue
      }
      if (!file.endsWith('.mp4')) continue
      if (referencedMp4.has(file)) continue

      const tradeId = resolveTradeIdFromMediaFilename(file, maps)
      if (!tradeId) continue

      const thumbCandidate = file.replace(/\.mp4$/i, '_thumb.jpg')
      const thumbFileName = files.includes(thumbCandidate) ? thumbCandidate : undefined

      const video: VideoData = {
        id: `vid_recovered_${file}`,
        originalName: file,
        mp4FileName: file,
        thumbFileName,
        createdAt: new Date().toISOString(),
      }

      if (!mapping[tradeId]) mapping[tradeId] = []
      if (!mapping[tradeId].some(v => v.mp4FileName === file)) {
        mapping[tradeId].push(video)
        recoveredFiles++
      }
    }
  } catch {
    // videos dir may not exist yet
  }

  return { mapping, recoveredFiles }
}

export async function remigrateTradeMetadata(trades: Trade[]): Promise<RemigrateResult> {
  const maps = buildTradeLookupMaps(trades)

  const [imagesRaw, videosRaw, journalRaw, tagsRaw, flagsRaw] = await Promise.all([
    readJson<Record<string, ImageData[]>>(IMAGES_FILE, {}),
    readJson<Record<string, VideoData[]>>(VIDEOS_FILE, {}),
    readJson<Record<string, unknown>>(JOURNAL_FILE, {}),
    readJson<Record<string, string[]>>(TAGS_FILE, {}),
    readJson<FlagsData>(FLAGS_FILE, { days: {}, trades: {} }),
  ])

  const imagesRemapped = remapImageMapping(imagesRaw, maps)
  const imagesRecovered = await recoverOrphanImages(imagesRemapped.result, maps)

  const videosRemapped = remapVideoMapping(videosRaw, maps)
  const videosRecovered = await recoverOrphanVideos(videosRemapped.result, maps)

  const journalRemapped = remapStringKeyedRecord(journalRaw, maps)
  const tagsRemapped = remapStringKeyedRecord(tagsRaw, maps)

  const remappedFlags: Record<string, boolean> = {}
  let remappedFlagTrades = 0
  for (const [legacyId, flagged] of Object.entries(flagsRaw.trades ?? {})) {
    if (!flagged) continue
    const resolved = resolveTradeId(legacyId, maps) ?? legacyId
    if (resolved !== legacyId) remappedFlagTrades++
    remappedFlags[resolved] = true
  }

  await Promise.all([
    writeJson(IMAGES_FILE, imagesRecovered.mapping),
    writeJson(VIDEOS_FILE, videosRecovered.mapping),
    writeJson(JOURNAL_FILE, journalRemapped.result),
    writeJson(TAGS_FILE, tagsRemapped.result),
    writeJson(FLAGS_FILE, { days: flagsRaw.days ?? {}, trades: remappedFlags }),
    writeJson(TRADES_SNAPSHOT_FILE, trades),
  ])

  notifyDataChanged('trade metadata remigrate')

  return {
    images: {
      remappedKeys: imagesRemapped.remappedKeys,
      recoveredFiles: imagesRecovered.recoveredFiles,
      totalEntries: Object.keys(imagesRecovered.mapping).length,
    },
    videos: {
      remappedKeys: videosRemapped.remappedKeys,
      recoveredFiles: videosRecovered.recoveredFiles,
      totalEntries: Object.keys(videosRecovered.mapping).length,
    },
    journal: {
      remappedKeys: journalRemapped.remappedKeys,
      totalEntries: Object.keys(journalRemapped.result).length,
    },
    tags: {
      remappedKeys: tagsRemapped.remappedKeys,
      totalEntries: Object.keys(tagsRemapped.result).length,
    },
    flags: { remappedTrades: remappedFlagTrades },
  }
}
