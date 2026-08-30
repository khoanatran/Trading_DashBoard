import fs from 'fs/promises'
import path from 'path'
import type { LiveSessionManifest } from '@/lib/live-session-utils'

export type { LiveSessionManifest } from '@/lib/live-session-utils'
export {
  isIntentionalLiveSessionReset,
  isFirstImportAfterReset,
  isStaleLiveDataAfterReset,
  shouldBlockRemoteLiveDataMerge,
} from '@/lib/live-session-utils'

const DATA_DIR = path.join(process.cwd(), 'data')
const LIVE_SESSION_FILE = path.join(DATA_DIR, 'live-session.json')

export async function readLiveSessionManifest(): Promise<LiveSessionManifest | null> {
  try {
    const raw = await fs.readFile(LIVE_SESSION_FILE, 'utf-8')
    return JSON.parse(raw) as LiveSessionManifest
  } catch {
    return null
  }
}

export async function writeLiveSessionManifest(
  patch: Partial<LiveSessionManifest> & { previousArchiveTitle?: string | null }
): Promise<LiveSessionManifest> {
  const existing = await readLiveSessionManifest()
  const now = new Date().toISOString()
  const manifest: LiveSessionManifest = {
    version: 1,
    sessionId: patch.sessionId ?? existing?.sessionId ?? now,
    startedAt: patch.startedAt ?? existing?.startedAt ?? now,
    label: patch.label ?? existing?.label,
    lastImportFile: patch.lastImportFile ?? existing?.lastImportFile ?? null,
    previousArchiveTitle:
      patch.previousArchiveTitle !== undefined
        ? patch.previousArchiveTitle
        : existing?.previousArchiveTitle ?? null,
  }
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(LIVE_SESSION_FILE, JSON.stringify(manifest, null, 2), 'utf-8')
  return manifest
}
