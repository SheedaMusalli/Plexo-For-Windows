import { test, expect, chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeDirs, PlexoApp } from './fixtures'
import { createBrowserHost } from './browserHost'

test.skip(process.platform !== 'win32', 'Windows integration')
test('YouTube compact control, trusted clicks, real quality discovery and merged download', async () => {
  test.setTimeout(180000)
  const root = resolve(__dirname, '..'),
    { dirs, dispose } = await makeDirs()
  const isolated = await createBrowserHost(root, dirs.userData)
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${isolated.hostName}`
  const app = new PlexoApp(dirs, {
    PLEXO_E2E_BROWSER_BRIDGE: '1',
    PLEXO_E2E_BROWSER_PIPE: isolated.pipe,
    PLEXO_E2E_INTERFACES: 'a=127.0.0.1'
  })
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
      ]
    })
    const worker = browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker'))
    // A deterministic player layout at the real origin; metadata/media are fetched by the real native engine.
    await browser.route('https://www.youtube.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta charset="utf-8"><title>YouTube player layout fixture</title><style>body{margin:0;background:#0f0f0f;color:white;font:16px Segoe UI}header{padding:22px;font-size:22px}#movie_player{margin:20px 70px;width:850px;height:478px;background:linear-gradient(140deg,#172f43,#233b32);display:grid;place-items:center}video{width:100%;height:100%}h2,p{margin-left:70px}</style></head><body><header>YouTube · Plexo integration test</header><div id="movie_player"><video></video></div><h2>Me at the zoo</h2><p>Deterministic player fixture · real YouTube format discovery</p></body></html>'
      })
    )
    const page = await browser.newPage()
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw')
    const ui = page.locator('#plexo-youtube-tools')
    await expect(ui.locator('#toggle')).toBeVisible()
    await expect(page.locator('#plexo-page-tools')).toHaveCount(0)
    await ui.locator('#toggle').evaluate((button: HTMLElement) => button.click())
    await expect(ui.locator('#panel')).toBeHidden()
    await ui.locator('#toggle').click()
    await expect(ui.locator('.choice').first()).toBeVisible({ timeout: 125000 })
    await expect(ui.locator('#title')).toHaveText('Me at the zoo')
    await page.screenshot({ path: join(root, 'release/youtube-preview.png') })
    const first = ui.locator('.choice').filter({ hasText: 'Video + audio' }).last()
    await first.click()
    await expect(ui.locator('#status')).toContainText('Saved', { timeout: 120000 })
    const files = (await readdir(dirs.dest)).filter((file) => /\.(mp4|mkv|webm)$/.test(file))
    expect(files.length).toBe(1)
    expect((await stat(join(dirs.dest, files[0]))).size).toBeGreaterThan(10000)
    const probe = JSON.parse(
      execFileSync(
        join(root, 'media-tools/ffprobe.exe'),
        ['-v', 'error', '-show_streams', '-of', 'json', join(dirs.dest, files[0])],
        { windowsHide: true, encoding: 'utf8' }
      )
    )
    expect(
      probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'video')
    ).toBe(true)
    expect(
      probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')
    ).toBe(true)
    const response = await worker.evaluate(
      async ({ hostName }) => {
        const api = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                sendNativeMessage: (host: string, message: unknown) => Promise<{ ok: boolean }>
              }
            }
          }
        ).chrome
        return api.runtime.sendNativeMessage(hostName, {
          action: 'youtubeInspect',
          url: 'https://youtube.com.evil.example/watch?v=jNQXAC9IVRw'
        })
      },
      { hostName: isolated.hostName }
    )
    expect(response.ok).toBe(false)
    await page.evaluate(() => {
      history.pushState({}, '', '/')
      document.dispatchEvent(new Event('yt-navigate-finish'))
    })
    await expect(ui.locator('#toggle')).toBeHidden()
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=jNQXAC9IVRw')
      document.dispatchEvent(new Event('yt-navigate-finish'))
    })
    await expect(ui.locator('#toggle')).toBeVisible()
    await expect(ui.locator('#panel')).toBeHidden()
    await worker.evaluate(async () => {
      await (
        globalThis as unknown as {
          chrome: { storage: { local: { set: (value: unknown) => Promise<void> } } }
        }
      ).chrome.storage.local.set({ pageButtons: false })
    })
    await expect(ui.locator('#toggle')).toBeHidden()
  } finally {
    await browser?.close()
    await app.quit()
    execFileSync('reg.exe', ['delete', key, '/f'], { windowsHide: true, stdio: 'pipe' })
    await dispose()
  }
})
