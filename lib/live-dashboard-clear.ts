import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

const LIVE_JSON_DEFAULTS: Record<string, unknown> = {
  'trades-snapshot.json': { version: 1, trades: [], updatedAt: null },
  'trade-journal.json': {},
  'trade-tags.json': {},
  'trade-images.json': {},
  'trade-videos.json': {},
  'daily-summaries.json': {},
  'daily-images.json': {},
  'weekly-notes.json': {},
  'flags.json': { _v: 1, days: {}, trades: {} },
}

const LIVE_MEDIA_DIRS = ['trade-images', 'trade-videos', 'daily-images'] as const

/** Wipe live dashboard JSON + media (does not touch Road to $50M archives or live-session.json). */
export async function clearLiveDashboardData(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const now = new Date().toISOString()

  for (const [fileName, fallback] of Object.entries(LIVE_JSON_DEFAULTS)) {
    const payload =
      fileName === 'trades-snapshot.json'
        ? { version: 1, trades: [], updatedAt: now }
        : fallback
    await fs.writeFile(
      path.join(DATA_DIR, fileName),
      JSON.stringify(payload, null, 2),
      'utf-8'
    )
  }

  for (const dirName of LIVE_MEDIA_DIRS) {
    const dirPath = path.join(DATA_DIR, dirName)
    await fs.rm(dirPath, { recursive: true, force: true })
    await fs.mkdir(dirPath, { recursive: true })
  }
}
