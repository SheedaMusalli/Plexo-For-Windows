import { test, expect, chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeDirs, PlexoApp } from './fixtures'
import { createBrowserHost } from './browserHost'
import type { DownloadState } from '../src/shared/types'
interface HostResponse {
  ok?: boolean
  rejected?: boolean
  error?: string
  current: DownloadState
  queue: { id: string; error?: string }[]
}

test.describe.configure({ mode: 'serial' })
test.skip(process.platform !== 'win32', 'The compiled native helper requires Windows')
test('compiled host, encrypted queue, authenticated transfers, restart and redirect isolation', async () => {
  test.setTimeout(90000)
  const root = resolve(__dirname, '..')
  const { dirs, dispose } = await makeDirs()
  const isolated = await createBrowserHost(root, dirs.userData)
  const extensionId = (await readFile(join(root, 'native-host/extension-id.txt'), 'utf8')).trim()
  async function native(
    message: object,
    origin = `chrome-extension://${extensionId}/`
  ): Promise<HostResponse> {
    const child = spawn(isolated.executable, [origin], {
      env: { ...process.env, PLEXO_TEST_PIPE: isolated.pipe },
      windowsHide: true
    })
    const payload = Buffer.from(JSON.stringify(message)),
      prefix = Buffer.alloc(4)
    prefix.writeUInt32LE(payload.length)
    // Deliberately fragment the native message to exercise exact reads.
    child.stdin.write(prefix.subarray(0, 2))
    child.stdin.write(Buffer.concat([prefix.subarray(2), payload]))
    child.stdin.end()
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', () => resolve())
    })
    const result = Buffer.concat(chunks)
    if (!result.length) return { rejected: true } as HostResponse
    expect(result.readUInt32LE(0)).toBe(result.length - 4)
    return JSON.parse(result.subarray(4).toString())
  }
  const data = Buffer.alloc(2 * 1024 * 1024, 73)
  let leaked = false
  const other = createServer((req, res) => {
    leaked ||= !!req.headers.cookie || !!req.headers.authorization
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 3 })
    res.end('abc')
  })
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
  const port2 = (other.address() as { port: number }).port
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port2}/other` })
      res.end()
      return
    }
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h1>Sign in</h1>')
      return
    }
    if (req.headers.cookie !== 'session=secret' || req.headers.authorization !== 'Bearer secret') {
      res.writeHead(403)
      res.end()
      return
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Number(range[2]) : data.length - 1
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
      ETag: '"test"'
    })
    let at = start
    const timer = setInterval(() => {
      const stop = Math.min(at + 4096, end + 1)
      res.write(data.subarray(at, stop))
      at = stop
      if (at > end) {
        clearInterval(timer)
        res.end()
      }
    }, 5)
    res.on('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = new PlexoApp(dirs, {
    PLEXO_E2E_BROWSER_BRIDGE: '1',
    PLEXO_E2E_BROWSER_PIPE: isolated.pipe,
    PLEXO_E2E_INTERFACES: 'a=127.0.0.1'
  })
  try {
    await app.launch()
    await app.api.updateSettings({ destinationDir: dirs.dest })
    await expect.poll(async () => (await native({ action: 'status' })).ok).toBe(true)
    expect(
      (await native({ action: 'status' }, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'))
        .rejected
    ).toBe(true)
    expect((await native({ action: 'download', url: 'file:///C:/Windows/win.ini' })).ok).toBe(false)
    const message = {
      action: 'download',
      id: 'auth-one',
      url: `${url}/file`,
      filename: 'auth.bin',
      headers: { cookie: 'session=secret', authorization: 'Bearer secret' }
    }
    expect((await native(message)).ok).toBe(true)
    expect((await native(message)).ok).toBe(true)
    await expect
      .poll(async () => (await native({ action: 'status' })).current?.status)
      .toBe('downloading')
    let status = await native({ action: 'status' })
    expect(status.queue.length).toBe(1)
    await app.api.pauseDownload(status.current.id)
    expect((await native({ ...message, id: 'auth-two', filename: 'second.bin' })).ok).toBe(true)
    expect(
      (await readFile(join(dirs.userData, 'browser-queue.bin'))).includes(
        Buffer.from('session=secret')
      )
    ).toBe(false)
    const manifests = await readdir(join(dirs.userData, 'downloads'))
    for (const id of manifests) {
      const saved = await readFile(join(dirs.userData, 'downloads', id, 'manifest.json'), 'utf8')
      expect(saved).not.toContain('session=secret')
    }
    await app.relaunch()
    await expect.poll(async () => (await native({ action: 'status' })).queue?.length).toBe(2)
    status = await native({ action: 'status' })
    await app.api.resumeDownload(status.current.id)
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(join(dirs.dest, 'second.bin'))).equals(data)
          } catch {
            return false
          }
        },
        { timeout: 30000 }
      )
      .toBe(true)
    expect((await readFile(join(dirs.dest, 'auth.bin'))).equals(data)).toBe(true)
    await expect.poll(async () => (await native({ action: 'status' })).queue.length).toBe(0)
    expect(
      (
        await native({
          ...message,
          id: 'redirect',
          url: `${url}/redirect`,
          filename: 'redirect.bin'
        })
      ).ok
    ).toBe(true)
    await expect
      .poll(async () => {
        try {
          return await readFile(join(dirs.dest, 'redirect.bin'), 'utf8')
        } catch {
          return ''
        }
      })
      .toBe('abc')
    expect(leaked).toBe(false)
    await native({ action: 'download', id: 'page', url: `${url}/page` })
    await expect
      .poll(
        async () =>
          (await native({ action: 'status' })).queue.find((item) => item.id === 'page')?.error
      )
      .toContain('web page')
    expect((await native({ action: 'remove', id: 'page' })).ok).toBe(true)
  } finally {
    if (app.alive) await app.quit()
    server.closeAllConnections()
    other.closeAllConnections()
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => other.close(() => resolve()))
    ])
    await dispose()
  }
})

test('real Chromium extension captures files, shows its queue, and falls back when host is unavailable', async () => {
  test.setTimeout(90000)
  const root = resolve(__dirname, '..')
  const { dirs, dispose } = await makeDirs()
  const isolated = await createBrowserHost(root, dirs.userData)
  const key = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + isolated.hostName
  const backup = join(dirs.userData, 'host-registry.reg')
  let hadRegistration = false
  try {
    execFileSync('reg.exe', ['export', key, backup, '/y'], { windowsHide: true, stdio: 'pipe' })
    hadRegistration = true
  } catch {
    /* no previous registration */
  }
  const app = new PlexoApp(dirs, {
    PLEXO_E2E_BROWSER_BRIDGE: '1',
    PLEXO_E2E_BROWSER_PIPE: isolated.pipe,
    PLEXO_E2E_INTERFACES: 'a=127.0.0.1'
  })
  const data = Buffer.alloc(1024 * 1024, 88)
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<a href="/file" download>Download file</a>')
      return
    }
    if (!req.headers.cookie?.includes('auth=extension-secret')) {
      res.writeHead(403)
      res.end()
      return
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Number(range[2]) : data.length - 1
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="browser.bin"',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {})
    })
    let at = start
    const timer = setInterval(() => {
      const stop = Math.min(at + 4096, end + 1)
      res.write(data.subarray(at, stop))
      at = stop
      if (at > end) {
        clearInterval(timer)
        res.end()
      }
    }, 10)
    res.on('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined
  try {
    execFileSync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', isolated.manifest, '/f'], {
      windowsHide: true,
      stdio: 'pipe'
    })
    await app.launch()
    await app.api.updateSettings({ destinationDir: dirs.dest })
    browser = await chromium.launchPersistentContext(join(dirs.userData, 'chrome-test'), {
      env: { ...process.env, PLEXO_TEST_PIPE: isolated.pipe },
      channel: 'chromium',
      executablePath: process.env.PLEXO_TEST_BROWSER,
      headless: true,
      args: [
        `--disable-extensions-except=${isolated.extension}`,
        `--load-extension=${isolated.extension}`
      ],
      acceptDownloads: true
    })
    const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker'))
    const extensionId = new URL(worker.url()).hostname
    const errors: string[] = []
    const popup = await browser.newPage()
    await popup.setViewportSize({ width: 410, height: 760 })
    popup.on('pageerror', (error) => errors.push(error.message))
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(popup.locator('#status')).toContainText('Connected')
    await browser.addCookies([{ name: 'auth', value: 'extension-secret', url }])
    const page = await browser.newPage()
    await page.goto(url)
    await page.getByText('Download file').click()
    await expect
      .poll(
        async () => {
          try {
            const files = await readdir(dirs.dest)
            const file = files.find((name) => !name.endsWith('.plexo'))
            return !!file && (await readFile(join(dirs.dest, file))).equals(data)
          } catch {
            return false
          }
        },
        { timeout: 20000 }
      )
      .toBe(true)
    await popup.reload()
    await expect(popup.locator('#message')).toContainText('Added to Plexo')
    await expect(popup.locator('#current')).toContainText('completed')
    await app.page.screenshot({ path: join(root, 'release/windows-preview.png') })
    await popup.screenshot({ path: join(root, 'release/extension-preview.png') })
    // Leave the app running but unregister the host: Chrome must resume its own transfer.
    execFileSync('reg.exe', ['delete', key, '/f'], { windowsHide: true, stdio: 'pipe' })
    const downloadPromise = page.waitForEvent('download')
    await page.getByText('Download file').click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).toBeTruthy()
    expect((await readFile(path!)).equals(data)).toBe(true)
    await popup.reload()
    await expect(popup.locator('#message')).toContainText('Chrome kept the download')
    expect(errors).toEqual([])
  } finally {
    await browser?.close()
    if (app.alive) await app.quit()
    if (hadRegistration)
      execFileSync('reg.exe', ['import', backup], { windowsHide: true, stdio: 'pipe' })
    else {
      try {
        execFileSync('reg.exe', ['delete', key, '/f'], { windowsHide: true, stdio: 'pipe' })
      } catch {
        /* already removed */
      }
    }
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await dispose()
  }
})
