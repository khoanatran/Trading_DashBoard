import { buildDashboardArchive } from '../lib/dashboard-archive'

async function main() {
  const title = process.argv[2] ?? 'May - July 2026'
  const dateFrom = process.argv[3] ?? '2026-05-01'
  const dateTo = process.argv[4] ?? '2026-07-31'

  console.log(`Building dashboard archive "${title}" (${dateFrom} to ${dateTo})...`)
  const { filePath, manifest } = await buildDashboardArchive({ title, dateFrom, dateTo })

  console.log('Archive created:')
  console.log(`  File: ${filePath}`)
  console.log(`  Trades: ${manifest.tradeCount}`)
  console.log(`  Media files: ${manifest.mediaFileCount}`)
  console.log(`  Created: ${manifest.createdAt}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
