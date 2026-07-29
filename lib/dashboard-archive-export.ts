import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import path from 'path'
import type { ArchiveManifest } from '@/lib/dashboard-archive'
import type { Trade } from '@/utils/logParser'

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
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

/** Write archive bundle to a folder and matching .omen-archive.zip file. */
export async function writeArchiveArtifacts(input: ArchiveArtifactInput): Promise<void> {
  const {
    manifest,
    trades,
    tradeJournal,
    tradeTags,
    tradeImages,
    tradeVideos,
    flags,
    dailySummaries,
    weeklyNotes,
    mediaPaths,
    folderPath,
    zipPath,
    dataDir,
  } = input

  const snapshot = { version: 1, trades, updatedAt: manifest.createdAt }
  const jsonFiles: Record<string, unknown> = {
    'manifest.json': manifest,
    'trades-snapshot.json': snapshot,
    'trade-journal.json': tradeJournal,
    'trade-tags.json': tradeTags,
    'trade-images.json': tradeImages,
    'trade-videos.json': tradeVideos,
    'flags.json': flags,
    'daily-summaries.json': dailySummaries,
    'weekly-notes.json': weeklyNotes,
  }

  await fs.rm(folderPath, { recursive: true, force: true })
  await fs.mkdir(folderPath, { recursive: true })

  for (const [name, value] of Object.entries(jsonFiles)) {
    await writeJsonFile(path.join(folderPath, name), value)
  }

  for (const relPath of mediaPaths) {
    const sourcePath = path.join(dataDir, relPath.replace(/\//g, path.sep))
    const targetPath = path.join(folderPath, relPath.replace(/\//g, path.sep))
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.copyFile(sourcePath, targetPath)
    } catch (error) {
      console.warn(`Archive export: missing media ${relPath}`, error)
    }
  }

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
