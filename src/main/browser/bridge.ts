import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { DownloadManager } from '../download/downloadManager'
import { probeUrl } from '../download/probe'
import { listActiveInterfaces } from '../network/interfaces'
import { loadSettings } from '../settings'
import { browserHeaders, httpUrl, type BrowserContext } from './headers'
import type { ProbeResult } from '../../shared/types'
import { testKnobs } from '../testKnobs'
import { YoutubeDownloads } from './youtube'

interface Entry {
  id: string
  url: string
  filename: string
  context: BrowserContext
  error?: string
  downloadId?: string
  probe?: ProbeResult
  probedAt?: number
}

async function checkFile(url: string, context: BrowserContext): Promise<ProbeResult> {
  const probe = await probeUrl(url, context)
  if (/text\/html|application\/xhtml/i.test(probe.contentType ?? '')) {
    throw new Error(
      'The server returned a web page or sign-in challenge. Use the website’s original Download button.'
    )
  }
  if (/mpegurl|dash\+xml/i.test(probe.contentType ?? '')) {
    throw new Error('This is a segmented streaming playlist, not a standalone file.')
  }
  return probe
}

/** A local named pipe, never an HTTP server accessible to websites. */
export async function startBrowserBridge(
  manager: DownloadManager,
  show: () => void
): Promise<Server> {
  const confirmDownload = async (fileName: string, details: string): Promise<boolean> => {
    if (testKnobs.userDataDir) return true
    show()
    return manager.confirmExternalDownload(fileName, details)
  }
  const youtube = new YoutubeDownloads(manager, show, confirmDownload)
  const suffix =
    testKnobs.browserPipe ||
    createHash('sha256').update(app.getPath('home').toLowerCase()).digest('hex').slice(0, 16)
  const pipe = `\\\\.\\pipe\\plexo-browser-${suffix}`
  const queuePath = join(app.getPath('userData'), 'browser-queue.bin')
  let entries: Entry[] = []
  try {
    entries = JSON.parse(safeStorage.decryptString(await readFile(queuePath)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Could not restore browser queue', error)
  }
  async function save(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Windows credential encryption unavailable')
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(`${queuePath}.tmp`, safeStorage.encryptString(JSON.stringify(entries)))
    await rename(`${queuePath}.tmp`, queuePath)
  }
  // One transaction at a time, including scheduler ticks and multiple browser windows.
  let chain: Promise<unknown> = Promise.resolve()
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn)
    chain = result.catch(() => {})
    return result
  }
  async function tick(): Promise<void> {
    const current = await manager.getCurrentDownload()
    // Recover a crash between the manager committing the download and the queue saving its ID.
    const adopted = entries.find((entry) => entry.id === current?.state.browserRequestId)
    if (adopted && !adopted.downloadId && current) {
      adopted.downloadId = current.state.id
      await save()
    }
    const tracked = entries.find((entry) => entry.downloadId)
    if (tracked) {
      if (current && current.state.id === tracked.downloadId) {
        if (['downloading', 'paused', 'error'].includes(current.state.status)) return
      }
      entries = entries.filter((entry) => entry !== tracked)
      await save()
    }
    if (current && ['downloading', 'paused', 'error'].includes(current.state.status)) return
    // A video and its audio are separate native transfers. Keep the browser queue from taking
    // the single Plexo transfer slot between those two streams.
    if (youtube.isBusy()) return
    const next = entries.find((entry) => !entry.error && !entry.downloadId)
    if (!next) return
    try {
      const probe =
        next.probe && Date.now() - (next.probedAt || 0) < 30000
          ? next.probe
          : await checkFile(next.url, next.context)
      const settings = await loadSettings()
      next.downloadId = await manager.start({
        browserRequestId: next.id,
        url: probe.finalUrl,
        destinationDir: settings.destinationDir || app.getPath('downloads'),
        suggestedFileName: next.filename || probe.suggestedFileName,
        totalBytes: probe.totalBytes ?? 0,
        supportsRanges: probe.supportsRanges,
        interfaceIds: (await listActiveInterfaces()).map((network) => network.id),
        etag: probe.etag,
        lastModified: probe.lastModified,
        browserContext: next.context
      })
      show()
    } catch (error) {
      next.error = error instanceof Error ? error.message : 'Download could not start'
    }
    await save()
  }
  async function dispatch(
    message: Record<string, unknown>,
    isConnected: () => boolean
  ): Promise<unknown> {
    if (String(message.action).startsWith('youtube')) return youtube.dispatch(message)
    if (message.action === 'status') {
      const current = await manager.getCurrentDownload()
      return {
        ok: true,
        version: app.getVersion(),
        capabilities: { preflight: true, youtube: true },
        current: current?.state,
        queue: entries.map(({ id, filename, url, error, downloadId }) => ({
          id,
          filename: filename || new URL(url).pathname.split('/').pop() || 'download',
          error,
          downloadId
        }))
      }
    }
    if (message.action === 'show') {
      show()
      return { ok: true }
    }
    if (message.action === 'remove') {
      const found = entries.find((entry) => entry.id === message.id)
      if (found?.downloadId) throw new Error('Cancel or remove the current download in Plexo first')
      entries = entries.filter((entry) => entry.id !== message.id)
      await save()
      return { ok: true }
    }
    if (message.action !== 'download') throw new Error('Unknown browser command')
    const url = httpUrl(message.url)
    if (/\.(m3u8|mpd)(?:$|\?)/i.test(url.href))
      throw new Error('Streaming playlists are not supported')
    if (entries.length >= 100)
      throw new Error('Queue is full. Remove or finish queued downloads first.')
    const id =
      typeof message.id === 'string' && /^[\w-]{1,100}$/.test(message.id)
        ? message.id
        : randomUUID()
    if (entries.some((entry) => entry.id === id)) return { ok: true, id }
    const context = {
      origin: url.origin,
      headers: browserHeaders(url, {
        origin: url.origin,
        headers:
          typeof message.headers === 'object' && message.headers
            ? (message.headers as Record<string, string>)
            : {}
      })
    }
    const entry: Entry = {
      id,
      url: url.href,
      context,
      filename: typeof message.filename === 'string' ? message.filename.slice(0, 240) : ''
    }
    // Don't tell Chrome to cancel its working transfer until this client has fetched a
    // usable response. Challenge pages and 403s must stay in the browser's own session.
    if (message.preflight === true) {
      entry.probe = await checkFile(entry.url, entry.context)
      entry.probedAt = Date.now()
    }
    const displayName = entry.filename || entry.probe?.suggestedFileName || 'download'
    const size = entry.probe?.totalBytes
    if (
      !(await confirmDownload(displayName, `From ${url.origin}${size ? ` · ${size} bytes` : ''}`))
    )
      return { ok: true, cancelled: true }
    if (!isConnected()) return { ok: true, cancelled: true }
    entries.push(entry)
    try {
      await save()
    } catch (error) {
      entries.pop()
      throw error
    }
    show()
    return { ok: true, id, queued: true }
  }
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0)
    socket.setTimeout(5 * 60_000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 1024 * 1024) {
        socket.destroy()
        return
      }
      const end = buffer.indexOf(10)
      if (end < 0) return
      socket.pause()
      void serial(async () => {
        try {
          return await dispatch(
            JSON.parse(buffer.subarray(0, end).toString('utf8')),
            () => !socket.destroyed
          )
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Browser request failed'
          }
        }
      }).then((response) => socket.end(`${JSON.stringify(response)}\n`))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipe, resolve)
  })
  const timer = setInterval(() => {
    void serial(tick).catch((error) => console.error('Browser queue:', error))
  }, 1500)
  server.on('close', () => clearInterval(timer))
  return server
}
