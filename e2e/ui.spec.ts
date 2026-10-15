import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { BLOCK, expect, interfacesEnv, NETWORKS, test } from './fixtures'

// G. A handful of journeys through the real UI, to prove the screens are wired to the main
// process. Download correctness is covered far more thoroughly by the API-level specs; these
// only need to show that clicking the buttons drives it.

const SIZE = 24 * BLOCK

/** The destination picker and "Reveal in Finder" go through native OS UI — replace both. */
async function stubNativeUi(
  plexo: import('./fixtures').PlexoApp,
  destination: string
): Promise<void> {
  await plexo.evaluateMain(({ dialog, shell }, dest) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dest] })) as never
    const revealed: string[] = []
    ;(globalThis as Record<string, unknown>).__revealed = revealed
    shell.showItemInFolder = (path: string) => void revealed.push(path)
    const opened: string[] = []
    ;(globalThis as Record<string, unknown>).__opened = opened
    shell.openPath = async (path: string) => {
      opened.push(path)
      return ''
    }
  }, destination)
}

async function openAddUrl(page: Page): Promise<void> {
  const addUrl = page.getByRole('button', { name: '+ Add URL', exact: true })
  if (await addUrl.isVisible()) await addUrl.click()
}

test.describe('UI journeys @smoke', () => {
  test('starts a real Cloudflare speed test only after the user chooses to', async ({ plexo }) => {
    const page = plexo.page
    let requests = 0
    await page.route('https://speed.cloudflare.com/**', async (route) => {
      requests += 1
      await route.abort()
    })

    await page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Plexo internet speed test' })).toBeVisible()
    await expect(dialog.getByText('Ready when you are')).toBeVisible()
    await expect(dialog.getByLabel('Ping result')).toHaveText('—')
    await expect(dialog.getByLabel('Jitter result')).toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText('—')
    await expect(dialog.getByLabel('Upload result')).toHaveText('—')
    expect(requests).toBe(0)

    await dialog.getByRole('button', { name: 'Start test' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect.poll(() => requests).toBeGreaterThan(0)
    await expect(dialog.getByRole('button', { name: 'Run again' })).toBeVisible()
    await expect(dialog.getByLabel('Ping result')).toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText('—')
    await expect(dialog.getByLabel('Upload result')).toHaveText('—')

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })

  test('speed test dialog stays inside the safe area in a compact window', async ({ plexo }) => {
    await plexo.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(720, 650)
    }, null)

    const page = plexo.page
    await page.getByRole('button', { name: 'Speed test' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Plexo internet speed test' })).toBeVisible()
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width
      }
    })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const platform = await page.evaluate(() => window.plexo.platform)

    expect(bounds.width).toBeGreaterThan(600)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    if (platform === 'win32') expect(bounds.top).toBeGreaterThanOrEqual(44)
    const closeBounds = await dialog.locator('[data-slot="dialog-close"]').boundingBox()
    expect(closeBounds).not.toBeNull()
    if (platform === 'win32' && closeBounds) expect(closeBounds.y).toBeGreaterThanOrEqual(44)
    await expect(dialog.getByLabel('Speed test duration')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start test' })).toBeInViewport()
    for (const label of ['Ping result', 'Jitter result', 'Download result', 'Upload result']) {
      await expect(dialog.getByLabel(label)).toBeVisible()
    }
  })

  test('double-clicking a completed history item opens its file', async ({ plexo, dirs }) => {
    await stubNativeUi(plexo, dirs.dest)
    const filePath = join(dirs.dest, 'finished.zip')
    await writeFile(filePath, 'finished')
    await plexo.page.evaluate((path) => {
      localStorage.setItem(
        'plexo-download-history-v1',
        JSON.stringify([
          {
            id: 'finished-download',
            fileName: 'finished.zip',
            url: 'https://example.com/finished.zip',
            destinationPath: path,
            status: 'completed',
            totalBytes: 8,
            bytesDownloaded: 8,
            startedAt: Date.now() - 1000,
            completedAt: Date.now(),
            peakSpeedBytesPerSec: 3 * 1048576,
            avgSpeedBytesPerSec: 2.5 * 1048576
          }
        ])
      )
    }, filePath)
    await plexo.page.reload()
    await plexo.page.getByRole('row', { name: /finished\.zip/ }).dblclick()
    await expect
      .poll(() => plexo.evaluateMain(() => (globalThis as Record<string, unknown>).__opened, null))
      .toEqual([filePath])
    await expect(
      plexo.page.getByText(/Last download · Peak 3\.0 MB\/s · Avg 2\.5 MB\/s/)
    ).toBeVisible()
  })

  test('lets users select combined networks in the speed test', async ({ plexo }) => {
    await plexo.page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = plexo.page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Plexo internet speed test' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Internet' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await dialog.getByRole('button', { name: 'Combined networks' }).click()
    await expect(
      dialog.getByRole('heading', { name: 'Plexo combined network speed test' })
    ).toBeVisible()
    const networkGroup = dialog.getByLabel('Networks to test')
    await expect(networkGroup.getByText(/\d+ selected/)).toBeVisible()
    await expect(networkGroup.getByRole('checkbox').first()).toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Internet' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('shows measured speed results after download and upload samples complete', async ({
    plexo
  }) => {
    test.setTimeout(60_000)
    let inFlight = 0
    let maxInFlight = 0
    let downloadRequests = 0
    let uploadRequests = 0
    await plexo.page.route('https://speed.cloudflare.com/**', async (route) => {
      const bytes = Number(new URL(route.request().url()).searchParams.get('bytes') ?? 0)
      if (bytes > 100_000) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (route.request().method() === 'GET') downloadRequests += 1
        else uploadRequests += 1
      }
      await new Promise((resolve) => setTimeout(resolve, bytes > 100_000 ? 1_050 : 40))
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
          'access-control-allow-origin': '*',
          'timing-allow-origin': '*',
          'access-control-expose-headers': 'Server-Timing',
          'server-timing': 'cfRequestDuration;dur=10'
        },
        body: route.request().method() === 'GET' ? Buffer.alloc(bytes) : ''
      })
      if (bytes > 100_000) inFlight -= 1
    })
    const page = plexo.page
    await page.getByRole('button', { name: 'Speed test' }).click()
    const dialog = page.getByRole('dialog')
    const duration = dialog.getByLabel('Speed test duration')
    await expect(duration).toHaveValue('20')
    await duration.selectOption('10')
    await expect(dialog.getByText('Split evenly between download and upload')).toBeVisible()
    await dialog.getByRole('button', { name: 'Start test' }).click()
    await expect(duration).toBeDisabled()
    await expect(dialog.getByText('Test complete')).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByLabel('Ping result')).toHaveText(/\d+ ms|<1 ms/)
    await expect(dialog.getByLabel('Jitter result')).not.toHaveText('—')
    await expect(dialog.getByLabel('Download result')).toHaveText(/\d+(\.\d+)? Mbps|\d+\.\d+ Gbps/)
    await expect(dialog.getByLabel('Upload result')).toHaveText(/\d+(\.\d+)? Mbps|\d+\.\d+ Gbps/)
    expect(maxInFlight).toBeGreaterThanOrEqual(4)
    expect(downloadRequests).toBeGreaterThanOrEqual(17)
    expect(uploadRequests).toBeGreaterThanOrEqual(17)
  })

  test('schedule a linear batch and cancel one queued link', async ({ plexo }) => {
    const page = plexo.page
    await page.getByRole('button', { name: /^Open download queue/ }).click()
    await expect(page.getByRole('heading', { name: 'Schedule and batch downloads' })).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Download links' })
      .fill('https://example.com/alpha.zip\nhttps://example.com/beta.zip')
    await page.locator('input[type="datetime-local"]').fill('2099-01-01T12:00')
    await page.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.getByText('Waiting (2)')).toBeVisible()
    await expect(page.getByText('alpha.zip')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel alpha.zip' }).click()
    await expect(page.getByText('Waiting (1)')).toBeVisible()
    await expect(page.getByText('beta.zip')).toBeVisible()
  })

  test('queue actions stay visible in a short window', async ({ plexo }) => {
    await plexo.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(500, 420)
    }, null)
    const page = plexo.page
    await page.getByRole('button', { name: /^Open download queue/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Schedule and batch downloads' })
    ).toBeVisible()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true }).first()
    ).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Add to queue' })).toBeInViewport()
  })

  test('paste a link, start, pause, resume, finish, reveal the file', async ({
    plexo,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(plexo, dirs.dest)
    const page = plexo.page

    await openAddUrl(page)
    await page.getByRole('button', { name: 'Browse…' }).click()
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())
    const start = page.getByRole('button', { name: 'Start' })
    await expect(start).toBeEnabled()

    const reached = origin.hold(6 * BLOCK)
    await plexo.expectNextDownload(origin.sha256)
    await start.click()
    await reached

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    origin.release()
    await page.getByRole('button', { name: 'Resume' }).click()

    const reveal = page.getByRole('button', { name: /Reveal in Finder|Show in folder/ })
    await expect(reveal).toBeVisible()
    await reveal.click()
    const { destinationPath } = (await plexo.current())!
    await expect
      .poll(() =>
        plexo.evaluateMain(() => (globalThis as Record<string, unknown>).__revealed, null)
      )
      .toEqual([destinationPath])
  })

  test('cancel through the confirmation dialog, then "Download Again"', async ({
    plexo,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(plexo, dirs.dest)
    const page = plexo.page
    await openAddUrl(page)
    await page.getByRole('button', { name: 'Browse…' }).click()
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())

    const reached = origin.hold(6 * BLOCK)
    await page.getByRole('button', { name: 'Start' }).click()
    await reached
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const alert = page.getByRole('alertdialog')
    const alertBounds = await alert.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(alertBounds).not.toBeNull()
    if (alertBounds) {
      expect(alertBounds.x).toBeGreaterThanOrEqual(0)
      expect(alertBounds.y).toBeGreaterThanOrEqual(0)
      expect(alertBounds.x + alertBounds.width).toBeLessThanOrEqual(viewport.width)
      expect(alertBounds.y + alertBounds.height).toBeLessThanOrEqual(viewport.height)
    }
    await page.getByRole('button', { name: 'Cancel download' }).click()
    origin.release()

    await page.getByRole('button', { name: 'Download Again' }).click()
    await plexo.expectNextDownload(origin.sha256)
    await page.getByRole('button', { name: 'Start' }).click({ timeout: 5000 })
    await expect(
      page.getByRole('button', { name: /Reveal in Finder|Show in folder/ })
    ).toBeVisible()
  })

  test('a link the server rejects shows the error and keeps Start disabled', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(() => ({ status: 404 }))
    const page = plexo.page
    await openAddUrl(page)
    await page.getByRole('textbox', { name: 'LINK' }).fill(origin.url())
    await expect(page.getByText(/could not be found/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  test('a completed download is shown again after a restart', async ({ plexo, serve }) => {
    const origin = await serve({ size: SIZE })
    await plexo.start(origin.url(), origin.sha256)
    await plexo.waitForStatus('completed')
    await plexo.relaunch()
    await expect(
      plexo.page.getByRole('button', { name: /Reveal in Finder|Show in folder/ })
    ).toBeVisible()
  })
})

// What a user sets is still set after they reload or restart — checked only through what they see.
test.describe('settings @smoke', () => {
  test('settings stays inside a short window and scrolls to its last option', async ({ plexo }) => {
    await plexo.evaluateMain((_electron) => {
      _electron.BrowserWindow.getAllWindows()[0].setSize(700, 480)
    }, null)
    const page = plexo.page
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Plexo settings' })).toBeVisible()
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)
    await dialog.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect(dialog.getByRole('button', { name: 'Check now' })).toBeInViewport()
  })

  test.describe('with an update available', () => {
    test.use({ appEnv: { PLEXO_FORCE_UPDATE_VERSION: '9.9.9' } })

    test('every choice survives a reload and a restart, even made right before', async ({
      plexo,
      dirs
    }) => {
      const page = (): Page => plexo.page
      await page().getByRole('button', { name: 'Not now' }).click()

      const themeToggle = page().getByRole('button', { name: /^Switch to (dark|light) theme$/ })
      // After switching, the toggle offers to switch back.
      const labelAfterSwitch = (await themeToggle.getAttribute('aria-label'))!.includes('dark')
        ? 'Switch to light theme'
        : 'Switch to dark theme'
      await themeToggle.click()

      await stubNativeUi(plexo, dirs.dest)
      await openAddUrl(page())
      await page().getByRole('button', { name: 'Browse…' }).click()

      await page().getByRole('button', { name: 'Edit network' }).first().click()
      await page().getByRole('textbox', { name: 'Name' }).fill('Office fibre')
      await page().getByRole('button', { name: 'Violet' }).click()
      await page().getByRole('button', { name: 'Done' }).click()

      const expectAllKept = async (): Promise<void> => {
        // Waiting on the titlebar indicator first means the update check has answered, so the
        // dialog's absence below is a real "stayed dismissed", not "not checked yet".
        await expect(page().getByRole('link', { name: 'Update available: 9.9.9' })).toBeVisible()
        await expect(page().getByRole('alertdialog')).toBeHidden()
        await expect(page().getByRole('button', { name: labelAfterSwitch })).toBeVisible()
        await expect(page().getByText(dirs.dest)).toBeVisible()
        await expect(page().getByText('Office fibre')).toBeVisible()
        await page().getByRole('button', { name: 'Edit network' }).first().click()
        await expect(page().getByRole('button', { name: 'Violet' })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await page().keyboard.press('Escape')
      }

      // No waiting for saves: a user doesn't either.
      await page().reload()
      await expectAllKept()
      await plexo.relaunch()
      await expectAllKept()
    })
  })

  test('a broken settings file falls back to what a fresh install shows', async ({
    plexo,
    dirs
  }) => {
    const settingsPath = join(dirs.userData, 'app-settings.json')
    // The TO row, as the user sees it — compared whole, so no platform's idea of the default
    // folder is baked into the test.
    const choices = (): Promise<string> =>
      plexo.page.getByText('TO', { exact: true }).locator('..').innerText()
    const fresh = await choices()

    await plexo.quit()
    await writeFile(settingsPath, '{"destinationDir": "/')
    await plexo.launch()
    expect(await choices()).toEqual(fresh)

    await plexo.quit()
    await writeFile(settingsPath, JSON.stringify({ destinationDir: join(dirs.dest, 'unplugged') }))
    await plexo.launch()
    expect(await choices()).toEqual(fresh)
  })
})

test.describe('no networks', () => {
  test.use({ appEnv: { PLEXO_E2E_INTERFACES: '' } })

  test('a network appearing takes you back to the start screen @smoke', async ({ plexo }) => {
    await expect(plexo.page.getByText('No networks to combine')).toBeVisible()
    await plexo.evaluateMain(
      (_electron, value) => {
        process.env['PLEXO_E2E_INTERFACES'] = value
      },
      interfacesEnv({ a: NETWORKS['a'] })
    )
    await plexo.page.getByRole('button', { name: 'Scan Again' }).click()
    await expect(plexo.page.getByRole('textbox', { name: 'LINK' })).toBeVisible()
  })
})
