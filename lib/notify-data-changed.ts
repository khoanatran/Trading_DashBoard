import { scheduleGitHubBackup } from '@/lib/github-backup-server'

/** Debounced GitHub backup after any dashboard data write (trades, tags, media, notes). */
export function notifyDataChanged(reason: string): void {
  scheduleGitHubBackup(reason)
}
