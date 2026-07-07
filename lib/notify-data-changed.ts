import { scheduleGitHubBackup } from '@/lib/github-backup-server'

let notifySuppressed = false

export function setNotifySuppressed(value: boolean): void {
  notifySuppressed = value
}

/** Debounced GitHub backup after any dashboard data write (trades, tags, media, notes). */
export function notifyDataChanged(reason: string): void {
  if (notifySuppressed) return
  scheduleGitHubBackup(reason)
}
