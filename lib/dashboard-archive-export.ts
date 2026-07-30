import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import path from 'path'
import type { ArchiveManifest } from '@/lib/dashboard-archive'
import type { Trade } from '@/utils/logParser'

export type ArchiveWriteMode = 'both' | 'zip-only' | 'folder-only'

export interface ArchiveArtifactInput {
  manifest: ArchiveManifest
  trades: Trade[]
  tradeJournal: Record<string, unknown>
  tradeTags: Record<string, string[]>
  tradeImages: Record<string, unknown>
  tradeVideos: Record<string, unknown>
  flags: Record<string, unknown>
  dailySummaries: Record<string, unknown>
  weeklyNotes: Record<string, unknown>
  mediaPaths: Set<string>
  folderPath: string
  zipPath: string
  dataDir: string
  mode?: ArchiveWriteMode
}

function buildJsonFiles(input: Omit<ArchiveArtifactInput, 'mode'>): Record<string, unknown> {
  const snapshot = { version: 1, trades: input.trades, updatedAt: input.manifest.createdAt }
  return {
    'manifest.json': input.manifest,
    'trades-snapshot.json': snapshot,
    'trade-journal.json': input.tradeJournal,
    'trade-tags.json': input.tradeTags,
    'trade-images.json': input.tradeImages,
    'trade-videos.json': input.tradeVideos,
    'flags.json': input.flags,
    'daily-summaries.json': input.dailySummaries,
    'weekly-notes.json': input.weeklyNotes,
  }
}

/** Build zip from live data dir (single read pass per media file). */
async function writeZipFromLiveData(
  jsonFiles: Record<string, unknown>,
  mediaPaths: Set<string>,
  dataDir: string,
  zipPath: string
): Promise<void> {
  const zip = new AdmZip()
  for (const [name, value] of Object.entries(jsonFiles)) {
    zip.addFile(name, Buffer.from(JSON.stringify(value, null, 2), 'utf-8'))
  }
  for (const relPath of mediaPaths) {
    const sourcePath = path.join(dataDir, relPath.replace(/\//g, path.sep))
    try {
      const buffer = await fs.readFile(sourcePath)
      zip.addFile(relPath.replace(/\\/g, '/'), buffer)
    } catch (error) {
      console.warn(`Archive zip: missing media ${relPath}`, error)
    }
  }
  await fs.mkdir(path.dirname(zipPath), { recursive: true })
  zip.writeZip(zipPath)
}

/** Expand zip into Road to $50M folder (used after zip is written). */
export async function extractArchiveZipToFolder(zipPath: string, folderPath: string): Promise<void> {
  await fs.rm(folderPath, { recursive: true, force: true })
  await fs.mkdir(folderPath, { recursive: true })
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(folderPath, true)
}

/**
 * Write archive bundle.
 * Default `both`: write zip first, then extract folder from zip (avoids double-reading media).
 */
export async function writeArchiveArtifacts(input: ArchiveArtifactInput): Promise<void> {
  const mode = input.mode ?? 'both'
  const jsonFiles = buildJsonFiles(input)

  if (mode === 'folder-only') {
    await fs.rm(input.folderPath, { recursive: true, force: true })
    await fs.mkdir(input.folderPath, { recursive: true })
    for (const [name, value] of Object.entries(jsonFiles)) {
      const filePath = path.join(input.folderPath, name)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
    }
    for (const relPath of input.mediaPaths) {
      const sourcePath = path.join(input.dataDir, relPath.replace(/\//g, path.sep))
      const targetPath = path.join(input.folderPath, relPath.replace(/\//g, path.sep))
      try {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.copyFile(sourcePath, targetPath)
      } catch (error) {
        console.warn(`Archive export: missing media ${relPath}`, error)
      }
    }
    return
  }

  await writeZipFromLiveData(jsonFiles, input.mediaPaths, input.dataDir, input.zipPath)

  if (mode === 'both') {
    await extractArchiveZipToFolder(input.zipPath, input.folderPath)
  }
}
