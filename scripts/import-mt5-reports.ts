import { importMt5ReportsIntoSnapshot } from '../lib/mt5-snapshot-import'

async function main() {
  const result = await importMt5ReportsIntoSnapshot()
  console.log(result.message)
  if (result.files.length > 0) {
    console.log('Files:', result.files.join(', '))
  }
  console.log(`Trades: ${result.total} (${result.added} added, ${result.skipped} skipped)`)
  if (!result.ok) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
