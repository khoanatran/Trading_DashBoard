import fsSync from 'fs'
import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import path from 'path'
import {
  DASHBOARD_ARCHIVE_EXTENSION,
  DASHBOARD_ARCHIVE_ROOT,
  archiveTitleFromFileName,
  getArchiveFilePath,
} from '@/lib/archive-constants'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey } from '@/utils/tradingDays'
import { getTradeCloseAt, getTradeId, type Trade } from '@/utils/logParser'

const DATA_DIR = path.join(process.cwd(), 'data')

export interface ArchiveManifest {
  version: 1
  title: string
  dateRange: { from: string; to: string }
  createdAt: string
  tradeCount: number
  mediaFileCount: number
}

export interface ArchiveListItem {
  title: string
  filePath: string
  manifest: ArchiveManifest
}

export interface ArchiveBundle {
  manifest: ArchiveManifest
  trades: Trade[]
  tradeJournal: Record<string, unknown>
  tradeTags: Record<string, string[]>
  tradeImages: Record<string, unknown>
  tradeVideos: Record<string, unknown>
  flags: Record<string, unknown>
  dailySummaries: Record<string, unknown>
  weeklyNotes: Record<string, unknown>
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function tradeInDateRange(trade: Trade, from: string, to: string): boolean {
  if (!trade.isClosed) return false
  const closeAt = getTradeCloseAt(trade)
  if (!closeAt) return false
  const dayKey = formatDateKey(closeAt, DISPLAY_TIMEZONE)
  return dayKey >= from && dayKey <= to
}

function filterByTradeIds<T>(record: Record<string, T>, tradeIds: Set<string>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    if (tradeIds.has(key)) out[key] = value
  }
  return out
}

function filterDaysInRange(record: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [dayKey, value] of Object.entries(record)) {
    if (dayKey >= from && dayKey <= to) out[dayKey] = value
  }
  return out
}

function collectMediaFiles(
  tradeImages: Record<string, Array<{ name: string; thumbFileName?: string } | string>>,
  tradeVideos: Record<string, Array<{ mp4FileName: string; thumbFileName?: string }>>
): Set<string> {
  const files = new Set<string>()

  for (const entries of Object.values(tradeImages)) {
    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : entry.name
      if (name) files.add(path.posix.join('trade-images', name))
    }
  }

  for (const entries of Object.values(tradeVideos)) {
    for (const entry of entries) {
      if (entry.mp4FileName) files.add(path.posix.join('trade-videos', entry.mp4FileName))
      if (entry.thumbFileName) files.add(path.posix.join('trade-videos', entry.thumbFileName))
    }
  }

  return files
}

async function ensureArchiveRoot(): Promise<void> {
  await fs.mkdir(DASHBOARD_ARCHIVE_ROOT, { recursive: true })
}

export async function buildDashboardArchive(options: {
  title: string
  dateFrom: string
  dateTo: string
}): Promise<{ filePath: string; manifest: ArchiveManifest }> {
  const { title, dateFrom, dateTo } = options
  await ensureArchiveRoot()

  const snapshot = await readJsonFile<{ trades?: Trade[] } | Trade[]>(
    path.join(DATA_DIR, 'trades-snapshot.json'),
    { trades: [] }
  )
  const allTrades = Array.isArray(snapshot) ? snapshot : snapshot.trades ?? []
  const filteredTrades = allTrades.filter(trade => tradeInDateRange(trade, dateFrom, dateTo))
  const tradeIds = new Set(filteredTrades.map(getTradeId))

  const [
    tradeJournal,
    tradeTags,
    tradeImages,
    tradeVideos,
    flagsRaw,
    dailySummaries,
    weeklyNotes,
  ] = await Promise.all([
    readJsonFile<Record<string, unknown>>(path.join(DATA_DIR, 'trade-journal.json'), {}),
    readJsonFile<Record<string, string[]>>(path.join(DATA_DIR, 'trade-tags.json'), {}),
    readJsonFile<Record<string, unknown>>(path.join(DATA_DIR, 'trade-images.json'), {}),
    readJsonFile<Record<string, unknown>>(path.join(DATA_DIR, 'trade-videos.json'), {}),
    readJsonFile<{ _v?: number; days?: Record<string, boolean>; trades?: Record<string, boolean> }>(
      path.join(DATA_DIR, 'flags.json'),
      { _v: 1, days: {}, trades: {} }
    ),
    readJsonFile<Record<string, unknown>>(path.join(DATA_DIR, 'daily-summaries.json'), {}),
    readJsonFile<Record<string, unknown>>(path.join(DATA_DIR, 'weekly-notes.json'), {}),
  ])

  const filteredJournal = filterByTradeIds(tradeJournal, tradeIds)
  const filteredTags = filterByTradeIds(tradeTags, tradeIds)
  const filteredImages = filterByTradeIds(tradeImages, tradeIds)
  const filteredVideos = filterByTradeIds(tradeVideos, tradeIds)
  const filteredFlags = {
    _v: flagsRaw._v ?? 1,
    days: filterDaysInRange(flagsRaw.days ?? {}, dateFrom, dateTo),
    trades: filterByTradeIds(flagsRaw.trades ?? {}, tradeIds),
  }
  const filteredDailySummaries = filterDaysInRange(dailySummaries, dateFrom, dateTo)

  const mediaPaths = collectMediaFiles(
    filteredImages as Record<string, Array<{ name: string; thumbFileName?: string } | string>>,
    filteredVideos as Record<string, Array<{ mp4FileName: string; thumbFileName?: string }>>
  )

  const manifest: ArchiveManifest = {
    version: 1,
    title,
    dateRange: { from: dateFrom, to: dateTo },
    createdAt: new Date().toISOString(),
    tradeCount: filteredTrades.length,
    mediaFileCount: mediaPaths.size,
  }

  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
  zip.addFile(
    'trades-snapshot.json',
    Buffer.from(JSON.stringify({ version: 1, trades: filteredTrades, updatedAt: manifest.createdAt }, null, 2), 'utf-8')
  )
  zip.addFile('trade-journal.json', Buffer.from(JSON.stringify(filteredJournal, null, 2), 'utf-8'))
  zip.addFile('trade-tags.json', Buffer.from(JSON.stringify(filteredTags, null, 2), 'utf-8'))
  zip.addFile('trade-images.json', Buffer.from(JSON.stringify(filteredImages, null, 2), 'utf-8'))
  zip.addFile('trade-videos.json', Buffer.from(JSON.stringify(filteredVideos, null, 2), 'utf-8'))
  zip.addFile('flags.json', Buffer.from(JSON.stringify(filteredFlags, null, 2), 'utf-8'))
  zip.addFile('daily-summaries.json', Buffer.from(JSON.stringify(filteredDailySummaries, null, 2), 'utf-8'))
  zip.addFile('weekly-notes.json', Buffer.from(JSON.stringify(weeklyNotes, null, 2), 'utf-8'))

  for (const relPath of mediaPaths) {
    const diskPath = path.join(DATA_DIR, relPath.replace(/\//g, path.sep))
    try {
      const buffer = await fs.readFile(diskPath)
      zip.addFile(relPath.replace(/\\/g, '/'), buffer)
    } catch (error) {
      console.warn(`Archive: missing media file ${relPath}`, error)
    }
  }

  const filePath = getArchiveFilePath(title)
  zip.writeZip(filePath)
  return { filePath, manifest }
}

export async function listDashboardArchives(): Promise<ArchiveListItem[]> {
  await ensureArchiveRoot()
  const entries = await fs.readdir(DASHBOARD_ARCHIVE_ROOT)
  const archives: ArchiveListItem[] = []

  for (const entry of entries) {
    if (!entry.endsWith(DASHBOARD_ARCHIVE_EXTENSION)) continue
    const filePath = path.join(DASHBOARD_ARCHIVE_ROOT, entry)
    try {
      const manifest = await readArchiveManifest(filePath)
      archives.push({ title: manifest.title, filePath, manifest })
    } catch (error) {
      console.warn(`Skipping invalid archive ${entry}:`, error)
    }
  }

  return archives.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt))
}

function openArchiveZip(title: string): AdmZip {
  const filePath = getArchiveFilePath(title)
  return new AdmZip(filePath)
}

function readZipJson<T>(zip: AdmZip, entryName: string, fallback: T): T {
  const entry = zip.getEntry(entryName)
  if (!entry) return fallback
  return JSON.parse(entry.getData().toString('utf-8')) as T
}

export async function readArchiveManifest(filePath: string): Promise<ArchiveManifest> {
  const zip = new AdmZip(filePath)
  return readZipJson<ArchiveManifest>(zip, 'manifest.json', null as unknown as ArchiveManifest)
}

export async function loadDashboardArchive(title: string): Promise<ArchiveBundle> {
  const filePath = getArchiveFilePath(title)
  await fs.access(filePath)
  const zip = openArchiveZip(title)

  const manifest = readZipJson<ArchiveManifest>(zip, 'manifest.json', null as unknown as ArchiveManifest)
  const snapshot = readZipJson<{ trades: Trade[] }>(zip, 'trades-snapshot.json', { trades: [] })

  return {
    manifest,
    trades: snapshot.trades ?? [],
    tradeJournal: readZipJson(zip, 'trade-journal.json', {}),
    tradeTags: readZipJson(zip, 'trade-tags.json', {}),
    tradeImages: readZipJson(zip, 'trade-images.json', {}),
    tradeVideos: readZipJson(zip, 'trade-videos.json', {}),
    flags: readZipJson(zip, 'flags.json', { _v: 1, days: {}, trades: {} }),
    dailySummaries: readZipJson(zip, 'daily-summaries.json', {}),
    weeklyNotes: readZipJson(zip, 'weekly-notes.json', {}),
  }
}

export function readArchiveMediaFile(title: string, relPath: string): Buffer | null {
  const zip = openArchiveZip(title)
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const entry = zip.getEntry(normalized)
  if (!entry) return null
  return entry.getData()
}

export function archiveExists(title: string): boolean {
  return fsSync.existsSync(getArchiveFilePath(title))
}

export { archiveTitleFromFileName, getArchiveFilePath }
