import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import {
  DASHBOARD_ARCHIVE_EXTENSION,
  DASHBOARD_ARCHIVE_ROOT,
  getArchiveFilePath,
  getArchiveFolderPath,
  getRepoArchiveFilePath,
} from '@/lib/archive-constants'
import type { ArchiveManifest } from '@/lib/dashboard-archive'
import { extractArchiveZipToFolder, writeArchiveArtifacts } from '@/lib/dashboard-archive-export'
import { setNotifySuppressed } from '@/lib/notify-data-changed'
import { runGitHubBackup } from '@/lib/github-backup-server'
import { clearLiveDashboardData } from '@/lib/live-dashboard-clear'
import { writeLiveSessionManifest } from '@/lib/live-session-server'
import { loadTradesSnapshot } from '@/lib/trades-snapshot-server'
import { DISPLAY_TIMEZONE } from '@/lib/timezone'
import { formatDateKey } from '@/utils/tradingDays'
import { getTradeCloseAt, getTradeId, type Trade } from '@/utils/logParser'

const DATA_DIR = path.join(process.cwd(), 'data')
const REPO_ARCHIVES_DIR = path.join(process.cwd(), 'archives')

export interface SessionExportResult {
  title: string
  folderPath: string
  zipPath: string
  repoZipPath: string
  manifest: ArchiveManifest
}

export interface NewLiveSessionResult extends SessionExportResult {
  cleared: true
  github: { ok: boolean; message: string; background: boolean }
  liveSession: Awaited<ReturnType<typeof writeLiveSessionManifest>>
}

function computeTradeDateRange(trades: Trade[]): { from: string; to: string } {
  let min = ''
  let max = ''
  for (const trade of trades) {
    const closeAt = getTradeCloseAt(trade)
    if (!closeAt) continue
    const key = formatDateKey(closeAt, DISPLAY_TIMEZONE)
    if (!min || key < min) min = key
    if (!max || key > max) max = key
  }
  return { from: min || 'N/A', to: max || 'N/A' }
}

async function gatherAllLiveData(): Promise<{
  trades: Trade[]
  tradeJournal: Record<string, unknown>
  tradeTags: Record<string, string[]>
  tradeImages: Record<string, unknown>
  tradeVideos: Record<string, unknown>
  flags: Record<string, unknown>
  dailySummaries: Record<string, unknown>
  weeklyNotes: Record<string, unknown>
  mediaPaths: Set<string>
}> {
  const trades = await loadTradesSnapshot()
  const tradeIds = new Set(trades.map(getTradeId))

  const readJson = async <T>(name: string, fallback: T): Promise<T> => {
    try {
      return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), 'utf-8')) as T
    } catch {
      return fallback
    }
  }

  const tradeJournal = await readJson('trade-journal.json', {})
  const tradeTags = await readJson('trade-tags.json', {})
  const tradeImages = await readJson('trade-images.json', {})
  const tradeVideos = await readJson('trade-videos.json', {})
  const flagsRaw = await readJson('flags.json', { _v: 1, days: {}, trades: {} })
  const dailySummaries = await readJson('daily-summaries.json', {})
  const weeklyNotes = await readJson('weekly-notes.json', {})

  const filterByIds = <T,>(record: Record<string, T>) => {
    const out: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) {
      if (tradeIds.has(key)) out[key] = value
    }
    return out
  }

  const filteredImages = filterByIds(tradeImages)
  const filteredVideos = filterByIds(tradeVideos)

  const mediaPaths = new Set<string>()
  for (const entries of Object.values(filteredImages) as Array<Array<{ name: string } | string>>) {
    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : entry.name
      if (name) mediaPaths.add(path.posix.join('trade-images', name))
    }
  }
  for (const entries of Object.values(filteredVideos) as Array<Array<{ mp4FileName?: string; thumbFileName?: string }>>) {
    for (const entry of entries) {
      if (entry.mp4FileName) mediaPaths.add(path.posix.join('trade-videos', entry.mp4FileName))
      if (entry.thumbFileName) mediaPaths.add(path.posix.join('trade-videos', entry.thumbFileName))
    }
  }

  return {
    trades,
    tradeJournal: filterByIds(tradeJournal),
    tradeTags: filterByIds(tradeTags),
    tradeImages: filteredImages,
    tradeVideos: filteredVideos,
    flags: flagsRaw,
    dailySummaries,
    weeklyNotes,
    mediaPaths,
  }
}

async function copyFileToRepoArchive(zipPath: string, title: string): Promise<string> {
  await fs.mkdir(REPO_ARCHIVES_DIR, { recursive: true })
  const repoZipPath = getRepoArchiveFilePath(title)
  await fs.copyFile(zipPath, repoZipPath)
  return repoZipPath
}

export function scheduleSessionBackgroundTasks(
  exported: SessionExportResult,
  githubReason: string,
  extractFolder: boolean,
  skipGitHub = false
): void {
  void (async () => {
    try {
      if (extractFolder) {
        console.log(`[session] Extracting archive folder: ${exported.folderPath}`)
        await extractArchiveZipToFolder(exported.zipPath, exported.folderPath)
      }
      if (!skipGitHub) {
        console.log(`[session] GitHub backup: ${githubReason}`)
        const github = await runGitHubBackup(githubReason)
        console.log(`[session] GitHub backup finished: ${github.message}`)
      }
    } catch (error) {
      console.error('[session] Background finalize failed:', error)
    }
  })()
}

/** Export ALL current live dashboard data to Road to $50M folder + zip + repo archives/. */
export async function exportLiveDashboardSession(title: string): Promise<SessionExportResult> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Archive title is required')

  const data = await gatherAllLiveData()
  if (data.trades.length === 0) {
    throw new Error('No live trades to export')
  }
  const dateRange = computeTradeDateRange(data.trades)
  const manifest: ArchiveManifest = {
    version: 1,
    title: trimmed,
    dateRange,
    createdAt: new Date().toISOString(),
    tradeCount: data.trades.length,
    mediaFileCount: data.mediaPaths.size,
    kind: 'live-export',
  }

  await fs.mkdir(DASHBOARD_ARCHIVE_ROOT, { recursive: true })
  const folderPath = getArchiveFolderPath(trimmed)
  const zipPath = getArchiveFilePath(trimmed)

  await writeArchiveArtifacts({
    manifest,
    trades: data.trades,
    tradeJournal: data.tradeJournal,
    tradeTags: data.tradeTags,
    tradeImages: data.tradeImages,
    tradeVideos: data.tradeVideos,
    flags: data.flags,
    dailySummaries: data.dailySummaries,
    weeklyNotes: data.weeklyNotes,
    mediaPaths: data.mediaPaths,
    folderPath,
    zipPath,
    dataDir: DATA_DIR,
    mode: 'zip-only',
  })

  const repoZipPath = await copyFileToRepoArchive(zipPath, trimmed)

  return { title: trimmed, folderPath, zipPath, repoZipPath, manifest }
}

/**
 * Export current live data, clear live dashboard, start fresh session, push to GitHub.
 * Old data lives in Road to $50M + repo archives/ — new imports stay in data/ only.
 */
export async function startNewLiveSession(archiveTitle: string): Promise<NewLiveSessionResult> {
  const trades = await loadTradesSnapshot()

  setNotifySuppressed(true)
  try {
    let exported: SessionExportResult

    if (trades.length > 0) {
      exported = await exportLiveDashboardSession(archiveTitle)
    } else {
      const trimmed = archiveTitle.trim()
      exported = {
        title: trimmed,
        folderPath: getArchiveFolderPath(trimmed),
        zipPath: getArchiveFilePath(trimmed),
        repoZipPath: getRepoArchiveFilePath(trimmed),
        manifest: {
          version: 1,
          title: trimmed,
          dateRange: { from: 'N/A', to: 'N/A' },
          createdAt: new Date().toISOString(),
          tradeCount: 0,
          mediaFileCount: 0,
          kind: 'live-export',
        },
      }
    }

    await clearLiveDashboardData()
    const liveSession = await writeLiveSessionManifest({
      sessionId: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      label: 'Live Dashboard',
      lastImportFile: null,
      previousArchiveTitle: trades.length > 0 ? exported.title : null,
    })
    setNotifySuppressed(false)

    const clearedGithub = await runGitHubBackup(
      trades.length > 0
        ? `new live session - cleared (archived: ${exported.title})`
        : 'new empty live session'
    )

    if (trades.length > 0) {
      scheduleSessionBackgroundTasks(
        exported,
        `archived live session: ${exported.title}`,
        true
      )
    }

    return {
      ...exported,
      cleared: true,
      github: {
        ok: clearedGithub.ok,
        message: clearedGithub.ok
          ? trades.length > 0
            ? 'Live data cleared and synced. Archive folder sync continues in background.'
            : clearedGithub.message
          : clearedGithub.message,
        background: trades.length > 0,
      },
      liveSession,
    }
  } catch (error) {
    setNotifySuppressed(false)
    throw error
  }
}

export function liveDashboardHasData(): boolean {
  try {
    const snapshotPath = path.join(DATA_DIR, 'trades-snapshot.json')
    if (!fsSync.existsSync(snapshotPath)) return false
    const parsed = JSON.parse(fsSync.readFileSync(snapshotPath, 'utf-8'))
    const trades = Array.isArray(parsed) ? parsed : parsed.trades ?? []
    return trades.length > 0
  } catch {
    return false
  }
}
