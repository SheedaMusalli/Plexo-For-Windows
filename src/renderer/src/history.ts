import type { DownloadState } from '@shared/types'
export type Entry = Pick<
  DownloadState,
  | 'id'
  | 'fileName'
  | 'url'
  | 'destinationPath'
  | 'status'
  | 'totalBytes'
  | 'bytesDownloaded'
  | 'startedAt'
  | 'completedAt'
>
export const key = 'plexo-download-history-v1'
export function read(): Entry[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
let lastSaved = { id: '', status: '', at: 0 }
export function rememberDownload(download: DownloadState): void {
  if (download.destinationPath.includes('.plexo-youtube-')) return
  if (
    lastSaved.id === download.id &&
    lastSaved.status === download.status &&
    Date.now() - lastSaved.at < 2000
  )
    return
  lastSaved = { id: download.id, status: download.status, at: Date.now() }
  const {
    id,
    fileName,
    url,
    destinationPath,
    status,
    totalBytes,
    bytesDownloaded,
    startedAt,
    completedAt
  } = download
  const entries = read().filter((entry) => entry.id !== id)
  entries.unshift({
    id,
    fileName,
    url,
    destinationPath,
    status,
    totalBytes,
    bytesDownloaded,
    startedAt,
    completedAt
  })
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, 2000)))
  } catch {
    /* Preserve app operation if storage is full. */
  }
}
