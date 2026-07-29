import path from 'path'

/** Folder for single-file dashboard archives (Road to $50M). */
export const DASHBOARD_ARCHIVE_ROOT =
  process.env.DASHBOARD_ARCHIVE_ROOT ?? 'C:\\Omen Trading\\Road to $50M'

export const DASHBOARD_ARCHIVE_EXTENSION = '.omen-archive.zip'

export function getArchiveFolderPath(title: string): string {
  return path.join(DASHBOARD_ARCHIVE_ROOT, title)
}

export function getRepoArchiveFilePath(title: string): string {
  return path.join(process.cwd(), 'archives', `${title}${DASHBOARD_ARCHIVE_EXTENSION}`)
}

export function getArchiveFilePath(title: string): string {
  return path.join(DASHBOARD_ARCHIVE_ROOT, `${title}${DASHBOARD_ARCHIVE_EXTENSION}`)
}

export function archiveTitleFromFileName(fileName: string): string {
  return fileName.endsWith(DASHBOARD_ARCHIVE_EXTENSION)
    ? fileName.slice(0, -DASHBOARD_ARCHIVE_EXTENSION.length)
    : fileName
}
