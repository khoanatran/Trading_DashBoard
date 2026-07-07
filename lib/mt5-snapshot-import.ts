import fs from 'fs/promises'
import path from 'path'
import { mergeImportedTrades } from '@/lib/trade-storage'
import { loadTradesSnapshot, saveTradesSnapshot } from '@/lib/trades-snapshot-server'
import {
  isMt5ReportHistoryFileName,
  parseMt5ReportHistoryBuffer,
} from '@/utils/mt5ReportParser'
import type { Trade } from '@/utils/logParser'

export interface Mt5SnapshotImportResult {
  ok: boolean
  files: string[]
  added: number
  skipped: number
  total: number
  message: string
}

/** Merge trades from ReportHistory-*.xlsx in the project root into trades-snapshot.json */
export async function importMt5ReportsIntoSnapshot(): Promise<Mt5SnapshotImportResult> {
  const root = process.cwd()
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return {
      ok: false,
      files: [],
      added: 0,
      skipped: 0,
      total: 0,
      message: 'Could not read project directory',
    }
  }

  const xlsxFiles = entries.filter(name => isMt5ReportHistoryFileName(name))
  if (xlsxFiles.length === 0) {
    const existing = await loadTradesSnapshot()
    return {
      ok: true,
      files: [],
      added: 0,
      skipped: 0,
      total: existing.length,
      message: 'No ReportHistory-*.xlsx files found',
    }
  }

  const incoming: Trade[] = []
  for (const fileName of xlsxFiles.sort()) {
    try {
      const filePath = path.join(root, fileName)
      const buffer = await fs.readFile(filePath)
      const parsed = parseMt5ReportHistoryBuffer(buffer, fileName)
      incoming.push(...parsed)
    } catch (error) {
      console.warn(`Failed to parse ${fileName}:`, error)
    }
  }

  if (incoming.length === 0) {
    const existing = await loadTradesSnapshot()
    return {
      ok: true,
      files: xlsxFiles,
      added: 0,
      skipped: 0,
      total: existing.length,
      message: 'MT5 report files contained no trades',
    }
  }

  const existing = await loadTradesSnapshot()
  const { merged, added, skipped } = mergeImportedTrades(existing, incoming)

  if (added > 0 || merged.length !== existing.length) {
    await saveTradesSnapshot(merged)
    return {
      ok: true,
      files: xlsxFiles,
      added,
      skipped,
      total: merged.length,
      message: `Imported ${added} new trade(s) from MT5 report`,
    }
  }

  return {
    ok: true,
    files: xlsxFiles,
    added: 0,
    skipped,
    total: existing.length,
    message: 'MT5 report already synced — no new trades',
  }
}
