/**
 * Merge trades from ReportHistory-*.xlsx in repo root into data/trades-snapshot.json
 * and push to GitHub. Run when trades were imported but never synced.
 *
 * Usage: npm run sync:report-history
 */
import fs from 'fs/promises'
import path from 'path'
import { mergeImportedTrades } from '../lib/trade-storage'
import { loadTradesSnapshot, saveTradesSnapshot } from '../lib/trades-snapshot-server'
import { parseMt5ReportHistoryBuffer, isMt5ReportHistoryFileName } from '../utils/mt5ReportParser'
import { runGitHubBackup } from '../lib/github-backup-server'

async function findReportHistoryFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root)
  return entries
    .filter(name => isMt5ReportHistoryFileName(name))
    .map(name => path.join(root, name))
}

async function main() {
  const root = process.cwd()
  const reports = await findReportHistoryFiles(root)

  if (reports.length === 0) {
    console.error('No ReportHistory-*.xlsx file found in project root.')
    process.exit(1)
  }

  let existing = await loadTradesSnapshot()
  let totalAdded = 0

  for (const reportPath of reports) {
    const fileName = path.basename(reportPath)
    const buf = await fs.readFile(reportPath)
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const incoming = parseMt5ReportHistoryBuffer(arrayBuffer, fileName)

    if (incoming.length === 0) {
      console.warn(`No trades parsed from ${fileName}`)
      continue
    }

    const { merged, added, skipped } = mergeImportedTrades(existing, incoming)
    existing = merged
    totalAdded += added
    console.log(`${fileName}: parsed ${incoming.length}, added ${added}, skipped ${skipped}`)
  }

  const { tradeCount, updatedAt } = await saveTradesSnapshot(existing)
  console.log(`Snapshot saved: ${tradeCount} trades (updated ${updatedAt})`)

  const backup = await runGitHubBackup('report history sync')
  console.log(backup.ok ? backup.message : `GitHub push issue: ${backup.message}`)

  if (totalAdded === 0) {
    console.log('No new trades were added — snapshot may already be up to date.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
