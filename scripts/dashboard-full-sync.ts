import { runDashboardFullSync } from '../lib/dashboard-sync-server'

async function main() {
  const result = await runDashboardFullSync('cli full sync')
  console.log(result.message)
  if (result.tradesAdded > 0) {
    console.log(`Trades: ${result.tradeCount} (+${result.tradesAdded} new)`)
  } else {
    console.log(`Trades: ${result.tradeCount}`)
  }
  if (result.mediaCopied.length > 0) {
    console.log(`Media copied: ${result.mediaCopied.length} file(s)`)
  }
  if (result.changedFiles.length > 0) {
    console.log('Changed:', result.changedFiles.join(', '))
  }
  if (!result.ok) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
