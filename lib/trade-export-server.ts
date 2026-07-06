import fs from 'fs/promises'
import path from 'path'
import { buildTradesExportTxt, type TradeExportContext } from '@/lib/export-trades-txt'
import { getTradeExportDir, getTradeExportFilePath } from '@/lib/trade-export-path'
import type { TradeJournalEntry } from '@/lib/trade-journal'
import type { Trade } from '@/utils/logParser'

const DATA_DIR = path.join(process.cwd(), 'data')
const JOURNAL_FILE = path.join(DATA_DIR, 'trade-journal.json')
const TAGS_FILE = path.join(DATA_DIR, 'trade-tags.json')
const FLAGS_FILE = path.join(DATA_DIR, 'flags.json')

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

export async function loadTradeExportContext(): Promise<TradeExportContext> {
  const [journal, tradeTags, flags] = await Promise.all([
    readJsonFile<Record<string, TradeJournalEntry>>(JOURNAL_FILE, {}),
    readJsonFile<Record<string, string[]>>(TAGS_FILE, {}),
    readJsonFile<{ trades?: Record<string, boolean> }>(FLAGS_FILE, {}),
  ])

  return {
    journal,
    tradeTags,
    flaggedTrades: flags.trades ?? {},
  }
}

export async function writeTradeExportFile(trades: Trade[]): Promise<{
  filePath: string
  tradeCount: number
}> {
  const content = buildTradesExportTxt(trades, await loadTradeExportContext())
  const filePath = getTradeExportFilePath()
  await fs.mkdir(getTradeExportDir(), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  return { filePath, tradeCount: trades.length }
}
