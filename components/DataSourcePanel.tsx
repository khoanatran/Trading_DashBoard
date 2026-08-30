'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Archive,
  ChevronDown,
  Circle,
  Database,
  FileDown,
  FileSpreadsheet,
  FileUp,
  FolderOutput,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  deleteDashboardArchiveClient,
  type DashboardArchiveSummary,
} from '@/lib/archive-client'
import {
  clearLiveClientState,
  exportLiveSession,
  fetchLiveSessionInfo,
  startNewLiveSession,
  type LiveSessionInfo,
} from '@/lib/session-client'
import { setActiveArchiveSlug } from '@/utils/mediaCache'

interface DataSourcePanelProps {
  sidebarCollapsed: boolean
  activeArchive: string | null
  archives: DashboardArchiveSummary[]
  tradeCount: number
  onSelectSource: (value: string) => void | Promise<void>
  onArchivesRefresh: () => void
  onLiveSessionReset: () => void
  onImportSpreadsheet: () => void
  onImportTradeFile: () => void
  onExportSc: () => void
}

function promptTitle(label: string, defaultValue: string): string | null {
  const value = window.prompt(label, defaultValue)
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatArchiveDate(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso.slice(0, 10)
  }
}

function formatRange(range: { from: string; to: string }): string {
  if (range.from === 'N/A' || range.to === 'N/A') return 'All dates'
  if (range.from === range.to) return range.from
  return `${range.from} → ${range.to}`
}

export default function DataSourcePanel({
  sidebarCollapsed,
  activeArchive,
  archives,
  tradeCount,
  onSelectSource,
  onArchivesRefresh,
  onLiveSessionReset,
  onImportSpreadsheet,
  onImportTradeFile,
  onExportSc,
}: DataSourcePanelProps) {
  const [liveInfo, setLiveInfo] = useState<LiveSessionInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [statusHint, setStatusHint] = useState<string | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(true)

  const isLive = !activeArchive
  const liveSelected = isLive

  const refreshLiveInfo = useCallback(async () => {
    const info = await fetchLiveSessionInfo()
    setLiveInfo(info)
  }, [])

  useEffect(() => {
    if (isLive) void refreshLiveInfo()
  }, [isLive, tradeCount, refreshLiveInfo])

  const handleSelect = useCallback(
    async (value: string) => {
      if (value === (activeArchive ?? '__live__')) return
      setSwitchingTo(value)
      try {
        await onSelectSource(value)
      } finally {
        setSwitchingTo(null)
      }
    },
    [activeArchive, onSelectSource]
  )

  const handleDeleteArchive = useCallback(
    async (title: string) => {
      const confirmed = window.confirm(
        `Delete "${title}" permanently?\n\nThis removes the zip, folder under Road to $50M, and the GitHub archive copy. This cannot be undone.`
      )
      if (!confirmed) return

      setDeletingTitle(title)
      try {
        await deleteDashboardArchiveClient(title)
        if (activeArchive === title) {
          await onSelectSource('__live__')
        }
        onArchivesRefresh()
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to delete archive')
      } finally {
        setDeletingTitle(null)
      }
    },
    [activeArchive, onArchivesRefresh, onSelectSource]
  )

  const handleExportLive = useCallback(async () => {
    if (!isLive) return
    const defaultTitle = `Live Export ${new Date().toISOString().slice(0, 10)}`
    const title = promptTitle('Name for this export (saved to Road to $50M):', defaultTitle)
    if (!title) return

    setBusy('export')
    setStatusHint('Creating archive zip…')
    try {
      const result = await exportLiveSession(title)
      alert(
        `Exported ${result.manifest.tradeCount} trades, ${result.manifest.mediaFileCount} media files.\n\n${result.github?.message ?? 'GitHub sync runs in background.'}`
      )
      onArchivesRefresh()
      await refreshLiveInfo()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(null)
      setStatusHint(null)
    }
  }, [isLive, onArchivesRefresh, refreshLiveInfo])

  const handleStartNewSession = useCallback(async () => {
    if (!isLive) return

    const hasTrades = tradeCount > 0
    const defaultTitle = hasTrades
      ? `Live Export ${new Date().toISOString().slice(0, 10)}`
      : 'New Session'

    if (hasTrades) {
      if (
        !window.confirm(
          `Archive ${tradeCount} live trades + journal + media, then clear the dashboard for a fresh import?\n\nOld data stays in Road to $50M — new imports won't mix with it.`
        )
      ) {
        return
      }
    } else if (!window.confirm('Start a fresh live session?')) {
      return
    }

    const archiveTitle = hasTrades
      ? promptTitle('Name for the archive of current live data:', defaultTitle)
      : defaultTitle
    if (!archiveTitle) return

    setBusy('new')
    setStatusHint('Archiving, then clearing live data…')
    try {
      const result = await startNewLiveSession(archiveTitle)
      setActiveArchiveSlug(null)
      clearLiveClientState()
      onLiveSessionReset()
      onArchivesRefresh()
      await refreshLiveInfo()
      alert(
        hasTrades
          ? `Archived as "${result.title}". Live dashboard is empty — use Import Spreadsheet for your new data.`
          : 'New live session ready. Import a spreadsheet to begin.'
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start new session')
    } finally {
      setBusy(null)
      setStatusHint(null)
    }
  }, [isLive, tradeCount, onLiveSessionReset, onArchivesRefresh, refreshLiveInfo])

  if (sidebarCollapsed) return null

  return (
    <div className="px-2.5 py-2.5 border-b max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain">
      <div className="flex items-center gap-2 px-0.5 mb-2">
        <Database className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold">Dashboard Data</span>
      </div>

      {/* —— Data sources —— */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground px-0.5">
          Open
        </p>

        <SourceRow
          selected={liveSelected}
          loading={switchingTo === '__live__'}
          title="Live Dashboard"
          subtitle={
            liveInfo
              ? `${liveInfo.tradeCount} trade${liveInfo.tradeCount === 1 ? '' : 's'}${liveInfo.liveSession?.lastImportFile ? ` · ${liveInfo.liveSession.lastImportFile}` : ''}`
              : `${tradeCount} trade${tradeCount === 1 ? '' : 's'}`
          }
          badge={isLive ? 'Active' : undefined}
          onClick={() => void handleSelect('__live__')}
        />

        {archives.length > 0 && (
          <div className="max-h-28 overflow-y-auto space-y-1 pr-0.5">
            {archives.map(archive => {
              const selected = activeArchive === archive.title
              return (
                <SourceRow
                  key={archive.title}
                  selected={selected}
                  loading={switchingTo === archive.title}
                  title={archive.title}
                  subtitle={`${archive.tradeCount} trades · ${formatRange(archive.dateRange)}`}
                  meta={formatArchiveDate(archive.createdAt)}
                  badge={selected ? 'Viewing' : undefined}
                  archive
                  onClick={() => void handleSelect(archive.title)}
                  onDelete={() => void handleDeleteArchive(archive.title)}
                  deleting={deletingTitle === archive.title}
                />
              )
            })}
          </div>
        )}

        {archives.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-1 py-0.5 leading-snug">
            No saved archives yet.
          </p>
        )}
      </div>

      {statusHint && (
        <p className="text-[11px] text-amber-500 flex items-center gap-1.5 mt-2 px-0.5">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span className="leading-snug">{statusHint}</span>
        </p>
      )}

      {/* —— Live workspace actions —— */}
      {isLive ? (
        <div className="mt-2 rounded-lg border border-border/60 bg-muted/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setWorkspaceOpen(open => !open)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/40 transition-colors"
          >
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Live workspace
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                workspaceOpen && 'rotate-180'
              )}
            />
          </button>

          {workspaceOpen && (
            <div className="px-1.5 pb-1.5 space-y-1 border-t border-border/40">
              <Button
                size="sm"
                className="w-full h-8 justify-start text-xs mt-1.5"
                disabled={!!busy}
                onClick={onImportSpreadsheet}
              >
                <FileSpreadsheet className="mr-2 h-3.5 w-3.5 shrink-0" />
                Import Spreadsheet
              </Button>

              <div className="rounded-md border border-border/40 bg-background/50 divide-y divide-border/40">
                <WorkspaceAction
                  icon={FileUp}
                  label="Import trade file"
                  disabled={!!busy}
                  onClick={onImportTradeFile}
                />
                <WorkspaceAction
                  icon={FileDown}
                  label="Export to Sierra Chart"
                  disabled={!!busy || tradeCount === 0}
                  onClick={onExportSc}
                />
                <WorkspaceAction
                  icon={FolderOutput}
                  label="Export Excel"
                  disabled={!!busy || tradeCount === 0}
                  busy={busy === 'export'}
                  onClick={() => void handleExportLive()}
                />
                <WorkspaceAction
                  icon={RotateCcw}
                  label="New session"
                  disabled={!!busy}
                  busy={busy === 'new'}
                  onClick={() => void handleStartNewSession()}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 space-y-2">
          <div className="flex items-start gap-2">
            <Archive className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Read-only archive</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                View-only. Switch to Live to import or edit.
              </p>
            </div>
          </div>
          <div className="rounded-md border border-border/40 bg-background/50 divide-y divide-border/40">
            <WorkspaceAction
              icon={FileDown}
              label="Export to Sierra Chart"
              disabled={!!busy || tradeCount === 0}
              onClick={onExportSc}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => void handleSelect('__live__')}
          >
            Switch to Live
          </Button>
        </div>
      )}
    </div>
  )
}

interface WorkspaceActionProps {
  icon: ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  busy?: boolean
  onClick: () => void
}

function WorkspaceAction({ icon: Icon, label, disabled, busy, onClick }: WorkspaceActionProps) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
        'hover:bg-muted/60 disabled:opacity-40 disabled:pointer-events-none'
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}

interface SourceRowProps {
  selected: boolean
  loading?: boolean
  title: string
  subtitle: string
  meta?: string
  badge?: string
  archive?: boolean
  deleting?: boolean
  onClick: () => void
  onDelete?: () => void
}

function SourceRow({
  selected,
  loading,
  title,
  subtitle,
  meta,
  badge,
  archive,
  deleting,
  onClick,
  onDelete,
}: SourceRowProps) {
  return (
    <div
      className={cn(
        'group flex items-stretch rounded-lg border transition-colors',
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-border/60 hover:border-border hover:bg-muted/40'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={loading || deleting}
        className="flex-1 min-w-0 text-left px-2.5 py-2 flex items-start gap-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-primary" />
        ) : (
          <Circle
            className={cn(
              'h-4 w-4 shrink-0 mt-0.5',
              selected ? 'fill-primary text-primary' : 'text-muted-foreground/40'
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">{title}</span>
            {badge && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
          {meta && archive && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">Saved {meta}</p>
          )}
        </div>
      </button>
      {archive && onDelete && (
        <button
          type="button"
          title={`Delete ${title}`}
          disabled={deleting || loading}
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          className={cn(
            'shrink-0 px-2 flex items-center justify-center border-l border-border/40',
            'text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors',
            selected ? 'opacity-70' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            deleting && 'opacity-100'
          )}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  )
}
