import { test, expect, chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeDirs, PlexoApp } from './fixtures'
import { createBrowserHost } from './browserHost'

test.skip(process.platform !== 'win32', 'Windows integration')
test('visible buttons, dynamic links, network media, 403 fallback, and unsupported streams', async () => {
  test.setTimeout(90000)
  const root = resolve(__dirname, '..'),
    { dirs, dispose } = await makeDirs()
  const isolated = await createBrowserHost(root, dirs.userData)
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${isolated.hostName}`
  const app = new PlexoApp(dirs, {
    PLEXO_E2E_BROWSER_BRIDGE: '1',
    PLEXO_E2E_BROWSER_PIPE: isolated.pipe,
    PLEXO_E2E_INTERFACES: 'a=127.0.0.1'
  })
  const bytes = Buffer.alloc(256 * 1024, 54)
  let browserOnlyRefused = 0
  const server = createServer((req, res) => {
    if (['/', '/network', '/stream', '/post'].includes(req.url || '')) {
      res.setHeader('Content-Type', 'text/html')
      const content =
        req.url === '/'
          ? '<h1>File downloads</h1><p>Choose a file below. Plexo adds its own download controls.</p><a href="/alpha.zip" download>Download alpha.zip</a><p><a href="/browser-only.zip" download>Download browser-only.zip</a></p><script>setTimeout(()=>{const a=document.createElement("a");a.href="/beta.zip";a.textContent="Download beta.zip";document.body.append(a)},200)</script>'
          : req.url === '/network'
            ? '<h1>Direct media detection</h1><video controls width="560" height="300"></video><script>document.querySelector("video").src=URL.createObjectURL(new Blob(["x"],{type:"video/mp4"}));fetch("/media-endpoint")</script>'
            : req.url === '/post'
              ? '<form method="POST" action="/form-file"><button>Download form result</button></form>'
              : '<h1>Segmented stream</h1><video controls width="560" height="300" src="/stream.m3u8"></video><script>fetch("/chunk.m4s")</script>'
      res.end(
        `<html><head><title>Plexo integration test</title><style>body{font:18px Segoe UI;background:#f2f5fa;color:#172332;padding:60px}a{color:#234777}video{background:#162537;border-radius:12px}</style></head><body>${content}</body></html>`
      )
      return
    }
    if (req.url === '/browser-only.zip' && !req.headers['sec-fetch-mode']) {
      browserOnlyRefused++
      res.writeHead(403, { 'Content-Type': 'text/html' })
      res.end('Browser session required')
      return
    }
    if (req.url === '/stream.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U')
      return
    }
    if (req.headers.cookie !== 'session=page-test') {
      res.writeHead(403)
      res.end()
      return
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Number(range[2]) : bytes.length - 1
    const media = ['/media-endpoint', '/chunk.m4s'].includes(req.url || '')
    const filename = req.url === '/media-endpoint' ? 'clip.mp4' : req.url?.slice(1) || 'file.bin'
    res.writeHead(range ? 206 : 200, {
      'Content-Type': media ? 'video/mp4' : 'application/octet-stream',
      'Content-Length': end - start + 1,
      ...(!media ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {})
    })
    let at = start
    const timer = setInterval(() => {
      const stop = Math.min(at + 4096, end + 1)
      res.write(bytes.subarray(at, stop))
      at = stop
      if (at > end) {
        clearInterval(timer)
        res.end()
      }
    }, 8)
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
    browser = await chromium.launchPersistentContext(join(dirs.userData, 'browser'), {
      channel: 'chromium',
      executablePath: process.env.PLEXO_TEST_BROWSER,
      headless: true,
      env: { ...process.env, PLEXO_TEST_PIPE: isolated.pipe },
      args: [
        `--disable-extensions-except=${isolated.extension}`,
        `--load-extension=${isolated.extension}`
      ],
      acceptDownloads: true
    })
    const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker'))
    await browser.addCookies([{ name: 'session', value: 'page-test', url }])
    const page = await browser.newPage()
    await page.goto(url)
    const dock = page.locator('#plexo-page-tools')
    await expect(dock.locator('#toggle')).toBeVisible()
    await dock.locator('#toggle').click()
    await expect(dock.locator('.item').filter({ hasText: 'beta.zip' })).toBeVisible()
    const alpha = dock
      .locator('.item')
      .filter({ hasText: 'alpha.zip' })
      .getByRole('button', { name: 'Download', exact: true })
    await alpha.evaluate((element: HTMLButtonElement) => element.click())
    await page.waitForTimeout(250)
    expect(await readdir(dirs.dest)).toHaveLength(0)
    await alpha.click()
    await expect(dock.locator('#message')).toContainText('Added to Plexo')
    await expect
      .poll(async () => {
        try {
          return (await readFile(join(dirs.dest, 'alpha.zip'))).equals(bytes)
        } catch {
          return false
        }
      })
      .toBe(true)
    await page.screenshot({ path: join(root, 'release/page-buttons-preview.png') })
    const count = (await readdir(dirs.dest)).length
    // This site serves Chrome but deliberately rejects the standalone preflight.
    const browserDownload = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download browser-only.zip', exact: true }).click()
    const download = await browserDownload,
      downloadedPath = await download.path()
    expect((await readFile(downloadedPath!)).equals(bytes)).toBe(true)
    expect(browserOnlyRefused).toBeGreaterThan(0)
    expect((await readdir(dirs.dest)).length).toBe(count)
    const message = await worker.evaluate(
      "chrome.storage.local.get('lastMessage').then(x=>x.lastMessage)"
    )
    expect(message).toContain('Chrome kept the download')
    // A POST download must remain in Chrome without being replayed as a GET.
    await page.goto(url + '/post')
    const formDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download form result' }).click()
    expect((await readFile((await (await formDownload).path())!)).equals(bytes)).toBe(true)
    await page.goto(url + '/network')
    await expect(dock.locator('#media-tools button')).toBeVisible()
    await dock.locator('#media-tools button').click()
    await expect(dock.locator('.item').filter({ hasText: 'media-endpoint' })).toBeVisible()
    await page.goto(url + '/stream')
    await expect(dock.locator('#media-tools button')).toBeVisible()
    await dock.locator('#media-tools button').click()
    await expect(dock.locator('#hint')).toContainText('segmented streams')
    await expect(dock.locator('.item')).toHaveCount(0)
    const popup = await browser.newPage()
    await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`)
    await popup.locator('#pageButtons').uncheck()
    await expect(dock.locator('#dock')).toBeHidden({ timeout: 6000 })
  } finally {
    await browser?.close()
    if (app.alive) await app.quit()
    try {
      execFileSync('reg.exe', ['delete', key, '/f'], { windowsHide: true, stdio: 'pipe' })
    } catch {
      /* not registered */
    }
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await dispose()
  }
})
