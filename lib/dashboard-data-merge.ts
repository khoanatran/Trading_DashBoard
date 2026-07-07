import fs from 'fs/promises'
import path from 'path'
import { mergeImportedTrades } from '@/lib/trade-storage'
import {
  loadTradesSnapshot,
  saveTradesSnapshot,
  loadTradesSnapshotData,
} from '@/lib/trades-snapshot-server'
import {
  listRemoteFiles,
  readRemoteBinaryFile,
  readRemoteFile,
  REPO_ROOT,
  resolveGitExecutable,
  runGit,
  BRANCH,
} from '@/lib/git-repo'
import type { Trade } from '@/utils/logParser'

const DATA_DIR = path.join(REPO_ROOT, 'data')

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function asStringArrayMap(value: unknown): Record<string, string[]> {
  const record = asObjectRecord(value)
  const result: Record<string, string[]> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (Array.isArray(entry)) {
      result[key] = entry.filter((item): item is string => typeof item === 'string')
    }
  }
  return result
}

function unionTags(local: string[], remote: string[]): string[] {
  return [...new Set([...local, ...remote])]
}

function mergeStringArrayMaps(
  local: Record<string, string[]>,
  remote: Record<string, string[]>
): Record<string, string[]> {
  const merged = { ...local }
  for (const [key, remoteTags] of Object.entries(remote)) {
    const localTags = merged[key] ?? []
    merged[key] = unionTags(localTags, remoteTags)
  }
  return merged
}

interface JournalEntry {
  note?: string
  setupTags?: string[]
  rating?: number
  ratingManual?: boolean
  updatedAt?: string
}

function mergeJournalMaps(
  local: Record<string, JournalEntry>,
  remote: Record<string, JournalEntry>
): Record<string, JournalEntry> {
  const merged = { ...local }
  for (const [key, remoteEntry] of Object.entries(remote)) {
    const localEntry = merged[key]
    if (!localEntry) {
      merged[key] = remoteEntry
      continue
    }
    const localAt = localEntry.updatedAt ?? ''
    const remoteAt = remoteEntry.updatedAt ?? ''
    if (remoteAt > localAt) {
      merged[key] = {
        ...localEntry,
        ...remoteEntry,
        note: remoteEntry.note || localEntry.note,
        setupTags: unionTags(localEntry.setupTags ?? [], remoteEntry.setupTags ?? []),
      }
    } else {
      merged[key] = {
        ...remoteEntry,
        ...localEntry,
        note: localEntry.note || remoteEntry.note,
        setupTags: unionTags(localEntry.setupTags ?? [], remoteEntry.setupTags ?? []),
      }
    }
  }
  return merged
}

function mergeStringMaps(
  local: Record<string, string>,
  remote: Record<string, string>
): Record<string, string> {
  const merged = { ...local }
  for (const [key, value] of Object.entries(remote)) {
    if (!merged[key] || value.length > merged[key].length) {
      merged[key] = value
    }
  }
  return merged
}

function mergeFlags(
  local: { _v?: number; days?: Record<string, boolean>; trades?: Record<string, boolean> },
  remote: { _v?: number; days?: Record<string, boolean>; trades?: Record<string, boolean> }
) {
  return {
    _v: 1,
    days: { ...remote.days, ...local.days },
    trades: { ...remote.trades, ...local.trades },
  }
}

interface MediaMeta {
  name: string
  note?: string
  drawings?: unknown[]
  section?: string
  [key: string]: unknown
}

function mergeMediaManifest(
  local: unknown,
  remote: unknown
): Record<string, MediaMeta[]> {
  const safeLocal = asObjectRecord(local) as Record<string, MediaMeta[]>
  const safeRemote = asObjectRecord(remote) as Record<string, MediaMeta[]>
  const merged: Record<string, MediaMeta[]> = { ...safeLocal }
  for (const [tradeId, remoteItems] of Object.entries(safeRemote)) {
    if (!Array.isArray(remoteItems)) continue
    const localItems = merged[tradeId] ?? []
    if (!Array.isArray(localItems)) {
      merged[tradeId] = remoteItems
      continue
    }
    const byName = new Map<string, MediaMeta>()
    for (const item of localItems) byName.set(item.name, item)
    for (const item of remoteItems) {
      const existing = byName.get(item.name)
      if (!existing) {
        byName.set(item.name, item)
        continue
      }
      const localNote = (existing.note ?? '').trim()
      const remoteNote = (item.note ?? '').trim()
      byName.set(item.name, {
        ...existing,
        ...item,
        note: localNote.length >= remoteNote.length ? existing.note : item.note,
        drawings:
          (existing.drawings?.length ?? 0) >= (item.drawings?.length ?? 0)
            ? existing.drawings
            : item.drawings,
      })
    }
    merged[tradeId] = Array.from(byName.values())
  }
  return merged
}

async function readLocalJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(path.join(DATA_DIR, fileName), 'utf-8')
    return parseJson(content, fallback)
  } catch {
    return fallback
  }
}

async function readLocalTrades(): Promise<Trade[]> {
  return loadTradesSnapshot()
}

function parseTradesFromSnapshotRaw(raw: string | null): Trade[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed as Trade[]
    if (parsed && typeof parsed === 'object' && 'trades' in parsed) {
      const trades = (parsed as { trades?: unknown }).trades
      return Array.isArray(trades) ? (trades as Trade[]) : []
    }
  } catch {
    // invalid JSON
  }
  return []
}

async function parseRemoteTrades(git: string): Promise<Trade[]> {
  const remoteTradesRaw = await readRemoteFile(git, 'data/trades-snapshot.json')
  return parseTradesFromSnapshotRaw(remoteTradesRaw)
}

async function writeJsonIfChanged(fileName: string, value: unknown): Promise<boolean> {
  const filePath = path.join(DATA_DIR, fileName)
  const next = `${JSON.stringify(value, null, 2)}\n`
  try {
    const current = await fs.readFile(filePath, 'utf-8')
    if (current === next) return false
  } catch {
    // file missing
  }
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(filePath, next, 'utf-8')
  return true
}

async function copyMissingRemoteMedia(
  git: string,
  subDir: string
): Promise<string[]> {
  const copied: string[] = []
  const remoteFiles = await listRemoteFiles(git, `data/${subDir}`)
  for (const remotePath of remoteFiles) {
    const relative = remotePath.replace(/^data[\\/]/, '')
    const localPath = path.join(DATA_DIR, relative)
    try {
      await fs.access(localPath)
      continue
    } catch {
      // missing locally
    }

    const content = await readRemoteBinaryFile(git, remotePath)
    if (!content) continue

    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await fs.writeFile(localPath, content)
    copied.push(relative)
  }
  return copied
}

export interface DataMergeResult {
  changedFiles: string[]
  tradesAdded: number
  tradeCount: number
  mediaCopied: string[]
}

/** Merge remote GitHub data/ into local without losing either machine's changes. */
export async function mergeRemoteDashboardData(git: string): Promise<DataMergeResult> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const changedFiles: string[] = []
  let tradesAdded = 0

  const localTrades = await readLocalTrades()
  const remoteTrades = await parseRemoteTrades(git)
  if (remoteTrades.length > 0 || localTrades.length > 0) {
    const { merged, added } = mergeImportedTrades(localTrades, remoteTrades)
    if (added > 0 || merged.length !== localTrades.length) {
      const before = await loadTradesSnapshotData()
      const changed =
        added > 0 ||
        merged.length !== before.trades.length ||
        JSON.stringify(merged) !== JSON.stringify(before.trades)
      if (changed) {
        await saveTradesSnapshot(merged, { skipBackup: true })
        changedFiles.push('data/trades-snapshot.json')
        tradesAdded = Math.max(added, merged.length - localTrades.length)
      }
    }
  }

  const jsonMerges: Array<{
    file: string
    merge: (local: unknown, remote: unknown) => unknown
    fallback: unknown
  }> = [
    {
      file: 'trade-tags.json',
      fallback: {},
      merge: (l, r) => mergeStringArrayMaps(asStringArrayMap(l), asStringArrayMap(r)),
    },
    {
      file: 'trade-journal.json',
      fallback: {},
      merge: (l, r) => mergeJournalMaps(l as Record<string, JournalEntry>, r as Record<string, JournalEntry>),
    },
    {
      file: 'weekly-notes.json',
      fallback: {},
      merge: (l, r) => mergeStringMaps(l as Record<string, string>, r as Record<string, string>),
    },
    {
      file: 'daily-summaries.json',
      fallback: {},
      merge: (l, r) => mergeStringMaps(l as Record<string, string>, r as Record<string, string>),
    },
    {
      file: 'daily-images.json',
      fallback: {},
      merge: (l, r) => {
        const local = l as Record<string, MediaMeta[]>
        const remote = r as Record<string, MediaMeta[]>
        return mergeMediaManifest(local, remote)
      },
    },
    {
      file: 'trade-images.json',
      fallback: {},
      merge: (l, r) => mergeMediaManifest(l as Record<string, MediaMeta[]>, r as Record<string, MediaMeta[]>),
    },
    {
      file: 'trade-videos.json',
      fallback: {},
      merge: (l, r) => mergeMediaManifest(l as Record<string, MediaMeta[]>, r as Record<string, MediaMeta[]>),
    },
    {
      file: 'flags.json',
      fallback: { _v: 1, days: {}, trades: {} },
      merge: (l, r) =>
        mergeFlags(
          l as { days?: Record<string, boolean>; trades?: Record<string, boolean> },
          r as { days?: Record<string, boolean>; trades?: Record<string, boolean> }
        ),
    },
  ]

  for (const { file, merge, fallback } of jsonMerges) {
    const local = await readLocalJson(file, fallback)
    const remoteRaw = await readRemoteFile(git, `data/${file}`)
    const remote = parseJson(remoteRaw, fallback)
    let merged: unknown
    try {
      merged = merge(local, remote)
    } catch (error) {
      console.warn(`Skip merge for ${file}:`, error)
      continue
    }
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      if (await writeJsonIfChanged(file, merged)) {
        changedFiles.push(`data/${file}`)
      }
    }
  }

  const mediaCopied: string[] = []
  for (const subDir of ['trade-images', 'trade-videos', 'daily-images']) {
    const copied = await copyMissingRemoteMedia(git, subDir)
    mediaCopied.push(...copied)
    changedFiles.push(...copied.map(f => `data/${f.replace(/\\/g, '/')}`))
  }

  const finalTrades = await readLocalTrades()

  return {
    changedFiles,
    tradesAdded,
    tradeCount: finalTrades.length,
    mediaCopied,
  }
}

export async function fetchAndMergeFromGitHub(): Promise<DataMergeResult | null> {
  const git = resolveGitExecutable()
  if (!git) return null

  await runGit(git, ['fetch', 'origin', BRANCH])
  return mergeRemoteDashboardData(git)
}
