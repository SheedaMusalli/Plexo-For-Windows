import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { DownloadManager } from '../download/downloadManager'
import { listActiveInterfaces } from '../network/interfaces'
import { probeUrl } from '../download/probe'
import { loadSettings } from '../settings'
import type { DownloadConfirmationResponse, StartDownloadRequest } from '../../shared/types'
import { getDefaultTemporaryDir, getSuggestedDownloadDir } from '../download/paths'

export function youtubeUrl(value: unknown): string {
  const url = new URL(String(value))
  if (
    url.protocol !== 'https:' ||
    !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Choose a video on YouTube first.')
  const id =
    url.pathname === '/watch'
      ? url.searchParams.get('v')
      : /^\/(?:shorts|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1]
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Open a YouTube video first.')
  return `https://www.youtube.com/watch?v=${id}`
}

interface Choice {
  id: string
  label: string
  height?: number
  audioOnly?: boolean
}
interface YoutubeFormat {
  format_id?: string
  url?: string
  ext?: string
  height?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  has_drm?: boolean
  http_headers?: Record<string, string>
}
interface VideoInfo {
  title?: string
  id?: string
  is_live?: boolean
  formats?: YoutubeFormat[]
}
interface YouTubeCookie {
  domain: string
  name: string
  value: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}
interface Job {
  id: string
  url: string
  state: 'loading' | 'ready' | 'downloading' | 'complete' | 'error' | 'cancelled'
  title: string
  message: string
  choices: Choice[]
  formats: YoutubeFormat[]
  path?: string
  child?: ChildProcess
  activeDownloadId?: string
  startedAt?: number
  lastProgressAt?: number
}

function validCookies(value: unknown): YouTubeCookie[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error('The browser cookie list is invalid.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('The browser cookie list is invalid.')
    const cookie = item as YouTubeCookie
    if (
      typeof cookie.domain !== 'string' ||
      !(cookie.domain === 'youtube.com' || cookie.domain.endsWith('.youtube.com')) ||
      typeof cookie.name !== 'string' ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,200}$/.test(cookie.name) ||
      typeof cookie.value !== 'string' ||
      cookie.value.length > 8192 ||
      [...cookie.value].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 0x20 || code === 0x7f || character === ';' || character === ','
      }) ||
      typeof cookie.path !== 'string' ||
      !cookie.path.startsWith('/') ||
      /[\t\r\n]/.test(cookie.path)
    )
      throw new Error('The browser cookie list is invalid.')
    return cookie
  })
}

function cookieJar(cookies: YouTubeCookie[]): string {
  const rows = cookies
    .filter((cookie) => !cookie.expirationDate || cookie.expirationDate > Date.now() / 1000)
    .map((cookie) => {
      const domain = cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain
      const includeSubdomains = cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE'
      const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0
      return [
        domain,
        includeSubdomains,
        cookie.path,
        cookie.secure ? 'TRUE' : 'FALSE',
        expires,
        cookie.name,
        cookie.value
      ].join('\t')
    })
  return `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`
}

/** Only canonical YouTube URLs and internally generated format selectors reach the CLI. */
function stop(child?: ChildProcess): void {
  if (!child || child.exitCode !== null || !child.pid) return
  try {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5000
    })
  } catch {
    child.kill()
  }
}

export class YoutubeDownloads {
  private jobs = new Map<string, Job>()
  private tools = app.isPackaged
    ? join(process.resourcesPath, 'media-tools')
    : join(app.getAppPath(), 'media-tools')

  constructor(
    private readonly manager: DownloadManager,
    private readonly show: () => void,
    private readonly confirmDownload: (
      fileName: string,
      details: string
    ) => Promise<DownloadConfirmationResponse>
  ) {
    void this.removeAbandonedCookieFiles().catch(() => {})
    app.once('before-quit', () => {
      for (const job of this.jobs.values()) stop(job.child)
    })
  }

  isBusy(): boolean {
    return [...this.jobs.values()].some((job) => job.state === 'downloading')
  }

  private async removeAbandonedCookieFiles(): Promise<void> {
    const temp = app.getPath('temp')
    for (const name of await readdir(temp)) {
      if (!name.startsWith('plexo-youtube-cookie-')) continue
      await rm(join(temp, name), { recursive: true, force: true })
    }
  }

  private view(job: Job): unknown {
    const { id, url, state, title, message, path } = job
    let visibleMessage = message
    if (state === 'downloading' && job.startedAt) {
      const idle = Math.floor((Date.now() - (job.lastProgressAt || job.startedAt)) / 1000)
      const elapsed = Math.floor((Date.now() - job.startedAt) / 1000)
      if (idle >= 90) {
        visibleMessage = `No new video data for ${idle}s. You can wait, or cancel and choose a lower quality.`
      } else if (idle >= 15 && /^Starting download/.test(message)) {
        visibleMessage = `Connecting to YouTube… (${elapsed}s). Large or high-quality videos may take longer to start.`
      }
    }
    return {
      ok: true,
      job: {
        id,
        url,
        state,
        title,
        message: visibleMessage,
        path,
        choices: job.choices.map(({ id, label }) => ({ id, label }))
      }
    }
  }

  private async run(
    job: Job,
    args: string[],
    timeout: number,
    line: (line: string) => void,
    cookies: YouTubeCookie[] = []
  ): Promise<void> {
    let cookieDirectory: string | undefined
    let cookieFile: string | undefined
    try {
      if (cookies.length) {
        cookieDirectory = await mkdtemp(
          join(app.getPath('temp'), `plexo-youtube-cookie-${randomUUID()}-`)
        )
        cookieFile = join(cookieDirectory, 'cookies.txt')
        const contents = cookieJar(cookies)
        await writeFile(cookieFile, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        args = ['--cookies', cookieFile, ...args]
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          join(this.tools, 'yt-dlp.exe'),
          [
            '--ignore-config',
            '--no-playlist',
            '--no-colors',
            '--newline',
            '--no-cache-dir',
            '--no-js-runtimes',
            '--js-runtimes',
            `deno:${join(this.tools, 'deno.exe')}`,
            '--ffmpeg-location',
            this.tools,
            '--socket-timeout',
            '20',
            '--retries',
            '2',
            ...args,
            '--',
            job.url
          ],
          { windowsHide: true, shell: false }
        )
        job.child = child
        let pending = '',
          errors = '',
          total = 0,
          overflow = false
        const timer = setTimeout(() => {
          overflow = true
          stop(child)
        }, timeout)
        child.stdout.on('data', (data: Buffer) => {
          total += data.length
          if (total > 32 * 1024 * 1024) {
            overflow = true
            stop(child)
            return
          }
          pending += data.toString()
          const lines = pending.split(/\r?\n/)
          pending = lines.pop() || ''
          for (const value of lines) line(value)
        })
        child.stderr.on('data', (data: Buffer) => {
          let text = data.toString()
          for (const cookie of cookies) {
            if (cookie.value.length >= 6) text = text.replaceAll(cookie.value, '[redacted]')
          }
          errors = (errors + text).slice(-6000)
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          job.child = undefined
          reject(error)
        })
        child.once('close', (code) => {
          clearTimeout(timer)
          job.child = undefined
          if (pending) line(pending)
          if (job.state === 'cancelled') {
            reject(new Error('Cancelled'))
            return
          }
          if (code === 0 && !overflow) {
            resolve()
            return
          }
          const reason = errors.split(/\r?\n/).findLast((value) => value.startsWith('ERROR:'))
          reject(
            new Error(
              overflow
                ? 'YouTube took too long to respond. Try again.'
                : (
                    reason ||
                    'YouTube download failed. This video may require sign-in or be unavailable.'
                  )
                    .replace(/https?:\/\/\S+/g, '[link]')
                    .slice(0, 600)
            )
          )
        })
      })
    } finally {
      if (cookieFile && cookieDirectory) {
        try {
          const contents = cookieJar(cookies)
          await writeFile(cookieFile, Buffer.alloc(Buffer.byteLength(contents)))
          await rm(cookieDirectory, { recursive: true, force: true })
        } catch {
          await rm(cookieDirectory, { recursive: true, force: true }).catch(() => {})
        }
      }
    }
  }

  async dispatch(message: Record<string, unknown>): Promise<unknown> {
    const url = youtubeUrl(message.url)
    if (message.action === 'youtubeInspect') {
      const existing = [...this.jobs.values()].findLast(
        (job) => job.url === url && !['error', 'cancelled', 'complete'].includes(job.state)
      )
      if (existing) return this.view(existing)
      if ([...this.jobs.values()].filter((job) => job.child).length >= 3)
        throw new Error('Please finish or cancel another YouTube request first.')
      if (this.jobs.size >= 30) {
        for (const [id, job] of this.jobs)
          if (!job.child) {
            this.jobs.delete(id)
            break
          }
      }
      const job: Job = {
        id: randomUUID(),
        url,
        state: 'loading',
        title: 'YouTube video',
        message: 'Finding available qualities…',
        choices: [],
        formats: []
      }
      this.jobs.set(job.id, job)
      void this.inspect(job)
      return this.view(job)
    }
    const job = this.jobs.get(String(message.id))
    if (!job || job.url !== url) throw new Error('Open the download menu again.')
    if (message.action === 'youtubeStatus') return this.view(job)
    if (message.action === 'youtubeCancel') {
      job.state = 'cancelled'
      job.message = 'Cancelled. Partial files may remain in the download folder.'
      stop(job.child)
      if (job.activeDownloadId) void this.manager.cancel(job.activeDownloadId)
      return this.view(job)
    }
    if (message.action !== 'youtubeDownload') throw new Error('Unknown YouTube command')
    const withCookies = message.cookies !== undefined
    if (
      withCookies &&
      (job.state !== 'error' || !/sign in|not a bot|cookies-from-browser/i.test(job.message))
    )
      throw new Error('Retry with sign-in is offered only when YouTube requests authentication.')
    if (job.state !== 'ready' && !withCookies)
      throw new Error('This video is already downloading or needs a fresh quality check.')
    const choice = job.choices.find((choice) => choice.id === message.choice)
    if (!choice) throw new Error('Choose an available quality.')
    if ([...this.jobs.values()].some((other) => other.state === 'downloading'))
      throw new Error('Finish or cancel the current YouTube download first.')
    const cookies = withCookies ? validCookies(message.cookies) : []
    const userAgent =
      withCookies &&
      typeof message.userAgent === 'string' &&
      message.userAgent.length <= 512 &&
      message.userAgent.startsWith('Mozilla/5.0 ')
        ? message.userAgent
        : undefined
    job.state = 'downloading'
    job.message = 'Starting download…'
    job.startedAt = Date.now()
    job.lastProgressAt = job.startedAt
    void this.download(job, choice, cookies, userAgent)
    return this.view(job)
  }

  private async inspect(job: Job): Promise<void> {
    try {
      const info = await this.extractInfo(job)
      if (info.is_live)
        throw new Error(
          'Live broadcasts are not supported. Try the archived video after the stream ends.'
        )
      job.title = String(info.title || 'YouTube video').slice(0, 200)
      job.formats = (info.formats || []).filter(
        (format) => !format.has_drm && this.validMediaUrl(format.url)
      )
      const heights = [
        ...new Set(
          job.formats
            .filter(
              (format) =>
                format.vcodec && format.vcodec !== 'none' && Number.isFinite(format.height)
            )
            .map((format) => Math.floor(format.height!))
        )
      ]
        .sort((a, b) => b - a)
        .slice(0, 12)
      job.choices = heights.map((height) => ({
        id: `h${height}`,
        label: `${height}p · Video + audio`,
        height
      }))
      if (
        job.formats.some(
          (format) => format.vcodec === 'none' && format.acodec && format.acodec !== 'none'
        )
      )
        job.choices.push({ id: 'audio', label: 'Audio only · Original format', audioOnly: true })
      if (!job.choices.length)
        throw new Error('No downloadable formats are available for this video.')
      job.state = 'ready'
      job.message = 'Choose a quality. Files save to your Plexo download folder.'
    } catch (error) {
      this.fail(job, error)
    }
  }

  private validMediaUrl(raw?: string): boolean {
    if (!raw || raw.length > 32768) return false
    try {
      const url = new URL(raw)
      return (
        url.protocol === 'https:' &&
        (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'))
      )
    } catch {
      return false
    }
  }

  private async extractInfo(
    job: Job,
    cookies: YouTubeCookie[] = [],
    userAgent?: string
  ): Promise<VideoInfo> {
    let info: VideoInfo | undefined
    const args = ['--dump-single-json', '--skip-download']
    if (userAgent) args.push('--user-agent', userAgent)
    await this.run(
      job,
      args,
      120000,
      (value) => {
        try {
          info = JSON.parse(value) as VideoInfo
        } catch {
          /* Ignore non-JSON output. */
        }
      },
      cookies
    )
    if (!info) throw new Error('YouTube did not return video formats. Try again.')
    return info
  }

  private async download(
    job: Job,
    choice: Choice,
    cookies: YouTubeCookie[],
    userAgent?: string
  ): Promise<void> {
    let temporaryFolder: string | undefined
    let reservedOutput: string | undefined
    const childJobs: string[] = []
    try {
      if (this.isCancelled(job)) return
      // yt-dlp only resolves signed formats. It never transfers the media bytes.
      const info = await this.extractInfo(job, cookies, userAgent)
      const formats = (info.formats || []).filter(
        (format) => !format.has_drm && this.validMediaUrl(format.url)
      )
      const selected = this.selectFormats(formats, choice)
      if (!selected.video && !selected.audio)
        throw new Error('That YouTube quality is no longer available. Reopen the quality menu.')
      const finalExtension = selected.video ? 'mp4' : selected.audio?.ext || 'm4a'
      const finalFileName = `${this.safeStem(job.title)}.${finalExtension}`
      job.message = 'Waiting for your confirmation…'
      const confirmation = await this.confirmDownload(finalFileName, `YouTube · ${choice.label}`)
      if (!confirmation.accepted) {
        job.state = 'cancelled'
        job.message = 'Download cancelled before any video data was transferred.'
        return
      }
      const settings = await loadSettings()
      const baseDir = settings.destinationDir || app.getPath('downloads')
      const destination =
        confirmation.destinationDir || getSuggestedDownloadDir(baseDir, finalFileName)
      const temporaryDir = confirmation.temporaryDir || getDefaultTemporaryDir()
      await mkdir(destination, { recursive: true })
      await mkdir(temporaryDir, { recursive: true })
      temporaryFolder = await mkdtemp(join(temporaryDir, `.plexo-youtube-${randomUUID()}-`))
      const names: string[] = []
      if (selected.video)
        names.push(
          await this.downloadStream(
            job,
            selected.video,
            temporaryFolder,
            'video',
            childJobs,
            finalFileName
          )
        )
      if (this.isCancelled(job)) return
      if (selected.audio)
        names.push(
          await this.downloadStream(
            job,
            selected.audio,
            temporaryFolder,
            'audio',
            childJobs,
            finalFileName
          )
        )
      if (job.state === 'cancelled') return
      if (selected.video && selected.audio) {
        job.message = 'Combining video and audio in Plexo…'
        const output = await this.uniquePath(destination, this.safeStem(job.title), 'mp4')
        reservedOutput = output
        await this.muxVideo(names[0], names[1], output)
        job.path = output
        reservedOutput = undefined
      } else if (names[0]) {
        const source = names[0]
        const isVideo = Boolean(selected.video)
        const ext = isVideo ? 'mp4' : selected.audio?.ext || 'm4a'
        const output = await this.uniquePath(destination, this.safeStem(job.title), ext)
        reservedOutput = output
        if (isVideo) {
          job.message = 'Preparing MP4 in Plexo…'
          await this.muxVideo(source, undefined, output)
        } else {
          await rename(source, output)
        }
        job.path = output
        reservedOutput = undefined
      }
      job.state = 'complete'
      job.message = `Saved with Plexo${job.path ? ': ' + job.path : ' to your Plexo download folder'}`
      if (job.path) {
        await this.manager.publishMergedFile(childJobs, job.path, job.url)
        this.manager.notifyExternalCompletion(job.path.split(/[\\/]/).pop() || job.path)
      }
    } catch (error) {
      if (reservedOutput) await rm(reservedOutput, { force: true }).catch(() => {})
      const reason = error instanceof Error ? error.message : String(error)
      if (cookies.length && /sign in|not a bot|cookies-from-browser/i.test(reason))
        this.fail(
          job,
          new Error(
            'YouTube rejected this browser session even with its cookies and browser identity. Sign in to YouTube in this browser, refresh the video page, and retry once. If it still fails, YouTube may have expired the cookies or blocked this network; repeated retries may put the account at risk.'
          )
        )
      else this.fail(job, error)
    } finally {
      for (const id of childJobs) await this.manager.remove(id).catch(() => {})
      job.activeDownloadId = undefined
      if (temporaryFolder)
        await rm(temporaryFolder, { recursive: true, force: true }).catch(() => {})
    }
  }

  private selectFormats(
    formats: YoutubeFormat[],
    choice: Choice
  ): { video?: YoutubeFormat; audio?: YoutubeFormat } {
    const audio = formats
      .filter((f) => f.acodec && f.acodec !== 'none' && f.vcodec === 'none')
      .sort(
        (a, b) => (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
      )[0]
    if (choice.audioOnly) return { audio }
    const videos = formats.filter(
      (f) => f.vcodec && f.vcodec !== 'none' && (f.height || 0) <= (choice.height || 0)
    )
    const combined = videos
      .filter((f) => f.acodec && f.acodec !== 'none')
      .sort(
        (a, b) =>
          (b.height || 0) - (a.height || 0) ||
          (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
      )[0]
    if (combined) return { video: combined }
    const video = videos.sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.filesize || b.filesize_approx || 0) - (a.filesize || a.filesize_approx || 0)
    )[0]
    return { video, audio }
  }

  private async downloadStream(
    job: Job,
    format: YoutubeFormat,
    folder: string,
    kind: string,
    ids: string[],
    displayFileName: string
  ): Promise<string> {
    if (!format.url || !this.validMediaUrl(format.url))
      throw new Error('YouTube returned an unsupported media stream URL.')
    const url = new URL(format.url)
    const streamContext = {
      origin: url.origin,
      headers: this.safeFormatHeaders(format.http_headers)
    }
    // YouTube's `filesize_approx` is not safe for Plexo's exact-size validation. Probe the
    // signed stream itself and use the server's real Content-Range length when available.
    const probe = await probeUrl(url.href, streamContext)
    const request: StartDownloadRequest = {
      url: url.href,
      destinationDir: folder,
      temporaryDir: folder,
      suggestedFileName: `${kind}.${(format.ext || 'bin').replace(/[^a-z0-9]/gi, '')}`,
      displayFileName,
      displayLocation: 'YouTube · preparing final file',
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: (await listActiveInterfaces()).map((network) => network.id),
      etag: null,
      lastModified: null,
      browserContext: streamContext,
      suppressNotifications: true
    }
    job.message = `Plexo is downloading ${kind}…`
    job.lastProgressAt = Date.now()
    let current = await this.manager.getCurrentDownload()
    while (current && ['downloading', 'paused', 'error'].includes(current.state.status)) {
      if (this.isCancelled(job)) throw new Error('Cancelled')
      job.message =
        current.state.status === 'downloading'
          ? 'Waiting for the current Plexo download to finish…'
          : 'Waiting for the current Plexo download to resume or be removed…'
      await new Promise((resolve) => setTimeout(resolve, 1000))
      current = await this.manager.getCurrentDownload()
    }
    if (this.isCancelled(job)) throw new Error('Cancelled')
    const id = await this.manager.start(request)
    job.activeDownloadId = id
    ids.push(id)
    this.show()
    while (true) {
      if (this.isCancelled(job)) {
        await this.manager.cancel(id)
        throw new Error('Cancelled')
      }
      current = await this.manager.getCurrentDownload()
      if (current?.state.id === id) {
        const state = current.state
        job.message = `Plexo ${kind}: ${state.totalBytes > 0 ? Math.min(99, Math.floor((state.bytesDownloaded / state.totalBytes) * 100)) : '—'}% · ${(state.speedBytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
        job.lastProgressAt = Date.now()
        if (state.status === 'completed') return state.destinationPath
        if (state.status === 'error')
          throw new Error(state.error || `Plexo could not download the ${kind} stream.`)
        if (state.status === 'cancelled') throw new Error('Cancelled')
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  private safeFormatHeaders(source?: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(source || {})) {
      if (
        /^(user-agent|accept|accept-language)$/i.test(key) &&
        typeof value === 'string' &&
        !/[\r\n\0]/.test(value)
      )
        result[key.toLowerCase()] = value
    }
    return result
  }

  private isCancelled(job: Job): boolean {
    return job.state === 'cancelled'
  }

  private safeStem(value: string): string {
    const safe = [...value].map((character) => {
      const code = character.charCodeAt(0)
      return '<>:"/\\|?*'.includes(character) || code < 32 ? '_' : character
    })
    return (
      safe
        .join('')
        .replace(/[. ]+$/g, '')
        .slice(0, 150) || 'YouTube video'
    )
  }

  private async uniquePath(folder: string, stem: string, ext: string): Promise<string> {
    for (let i = 0; i < 10000; i++) {
      const suffix = i ? ` (${i})` : ''
      const path = join(folder, `${stem}${suffix}.${ext}`)
      try {
        const handle = await open(path, 'wx')
        await handle.close()
        return path
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
    }
    throw new Error('Could not choose an unused output file name.')
  }

  private async muxVideo(video: string, audio: string | undefined, output: string): Promise<void> {
    const run = (transcode: boolean): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video]
        if (audio) args.push('-i', audio)
        args.push('-map', '0:v:0')
        if (audio) args.push('-map', '1:a:0')
        else args.push('-map', '0:a?')
        if (transcode)
          args.push(
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '18',
            '-c:a',
            'aac',
            '-b:a',
            '192k'
          )
        else args.push('-c', 'copy')
        args.push('-movflags', '+faststart')
        args.push(output)
        const child = spawn(join(this.tools, 'ffmpeg.exe'), args, {
          windowsHide: true,
          shell: false
        })
        let errors = ''
        child.stderr.on('data', (chunk: Buffer) => {
          errors = (errors + chunk.toString()).slice(-2000)
        })
        child.once('error', reject)
        child.once('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(errors.trim() || 'Plexo could not combine these YouTube streams.'))
        )
      })
    try {
      await run(false)
    } catch {
      await run(true)
    }
  }

  private fail(job: Job, error: unknown): void {
    if (job.state === 'cancelled') return
    job.state = 'error'
    job.message = error instanceof Error ? error.message : 'YouTube request failed'
  }
}
