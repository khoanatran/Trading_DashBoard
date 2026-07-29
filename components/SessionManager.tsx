'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, FileSpreadsheet, FolderOutput, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  clearLiveClientState,
  exportLiveSession,
  fetchLiveSessionInfo,
  startNewLiveSession,
  type LiveSessionInfo,
} from '@/lib/session-client'
import { setActiveArchiveSlug } from '@/utils/mediaCache'

interface SessionManagerProps {
  sidebarCollapsed: boolean
  activeArchive: string | null
  tradeCount: number
  onLiveSessionReset: () => void
  onArchivesRefresh: () => void
  onImportSpreadsheet: () => void
}

function promptTitle(label: string, defaultValue: string): string | null {
  const value = window.prompt(label, defaultValue)
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default function SessionManager({
  sidebarCollapsed,
  activeArchive,
  tradeCount,
  onLiveSessionReset,
  onArchivesRefresh,
  onImportSpreadsheet,
}: SessionManagerProps) {
  const [liveInfo, setLiveInfo] = useState<LiveSessionInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refreshLiveInfo = useCallback(async () => {
    const info = await fetchLiveSessionInfo()
    setLiveInfo(info)
  }, [])

  useEffect(() => {
    if (!activeArchive) void refreshLiveInfo()
  }, [activeArchive, tradeCount, refreshLiveInfo])

  const handleExportLive = useCallback(async () => {
    if (activeArchive) return
    const defaultTitle = `Live Export ${new Date().toISOString().slice(0, 10)}`
    const title = promptTitle(
      'Name this export (saved to Road to $50M as folder + zip, and pushed to GitHub archives/):',
      defaultTitle
    )
    if (!title) return

    setBusy('export')
    try {
      const result = await exportLiveSession(title)
      alert(
        `Exported ${result.manifest.tradeCount} trade(s) and ${result.manifest.mediaFileCount} media file(s).\n\nFolder:\n${result.folderPath}\n\nZip:\n${result.zipPath}`
      )
      onArchivesRefresh()
      await refreshLiveInfo()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }, [activeArchive, onArchivesRefresh, refreshLiveInfo])

  const handleStartNewSession = useCallback(async () => {
    if (activeArchive) return

    const hasTrades = tradeCount > 0
    const defaultTitle = hasTrades
      ? `Live Export ${new Date().toISOString().slice(0, 10)}`
      : 'New Session'

    if (hasTrades) {
      const confirmed = window.confirm(
        `This will:\n1. Export ALL ${tradeCount} live trades + journal + media to Road to $50M\n2. Clear the live dashboard completely\n3. Push the archive and empty live data to GitHub\n\nYou can then import a new spreadsheet into a fresh live session.\n\nContinue?`
      )
      if (!confirmed) return
    } else {
      const confirmed = window.confirm(
        'Start a fresh live dashboard session? Current live data is already empty.'
      )
      if (!confirmed) return
    }

    const archiveTitle = hasTrades
      ? promptTitle('Archive name for current live data before clearing:', defaultTitle)
      : defaultTitle
    if (!archiveTitle) return

    setBusy('new')
    try {
      const result = await startNewLiveSession(archiveTitle)
      setActiveArchiveSlug(null)
      clearLiveClientState()
      onLiveSessionReset()
      onArchivesRefresh()
      await refreshLiveInfo()

      if (hasTrades) {
        alert(
          `Previous live data archived as "${result.title}".\n\nLive dashboard is now empty.\n\nUse Import Spreadsheet to load your new Report History file.`
        )
      } else {
        alert('New live session started. Import a spreadsheet to begin.')
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start new session')
    } finally {
      setBusy(null)
    }
  }, [activeArchive, tradeCount, onLiveSessionReset, onArchivesRefresh, refreshLiveInfo])

  if (activeArchive || sidebarCollapsed) return null

  return (
    <div className="px-3 pb-3 border-b">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2 mt-1">
        <Archive className="h-3.5 w-3.5" />
        Live session
      </p>
      {liveInfo && (
        <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
          {liveInfo.tradeCount} trade{liveInfo.tradeCount === 1 ? '' : 's'} in live data
          {liveInfo.liveSession?.lastImportFile
            ? ` · last import: ${liveInfo.liveSession.lastImportFile}`
            : ''}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={!!busy || tradeCount === 0}
          onClick={() => void handleExportLive()}
        >
          <FolderOutput className="mr-2 h-4 w-4" />
          {busy === 'export' ? 'Exporting…' : 'Export Live Session'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={!!busy}
          onClick={() => void handleStartNewSession()}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {busy === 'new' ? 'Starting…' : 'Start New Session'}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start"
          disabled={!!busy || !!activeArchive}
          onClick={onImportSpreadsheet}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Import Spreadsheet
        </Button>
      </div>
    </div>
  )
}
