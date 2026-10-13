import { youtubeRequest } from './youtube-background.js'
import { pageRequest } from './page-discovery.js'
const HOST = 'com.plexo.browser'
const allowedHeaders = /^(cookie|authorization|referer|user-agent|origin|accept|accept-language)$/i
let requests = new Map()
let historyReady = chrome.storage.session.get('requests').then((value) => {
  requests = new Map(value.requests || [])
})
let historyChain = historyReady
const http = (url) => /^https?:\/\//i.test(url || '')

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.incognito) return
    historyChain = historyChain
      .then(async () => {
        const headers = {}
        for (const header of details.requestHeaders || []) {
          if (allowedHeaders.test(header.name) && header.value)
            headers[header.name.toLowerCase()] = header.value
        }
        requests.delete(details.url)
        requests.set(details.url, { method: details.method, headers, time: Date.now() })
        for (const [url, request] of requests)
          if (Date.now() - request.time > 120000) requests.delete(url)
        while (requests.size > 150) requests.delete(requests.keys().next().value)
        await chrome.storage.session.set({ requests: [...requests] })
      })
      .catch(() => {})
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['requestHeaders', 'extraHeaders']
)

async function native(message) {
  if (message.action === 'download') {
    const status = await chrome.runtime.sendNativeMessage(HOST, { action: 'status' })
    if (!status?.capabilities?.preflight)
      throw new Error(
        'Update the Plexo Windows app to 1.0.0-browser.2 or newer. This download will stay in your browser.'
      )
  }
  const result = await chrome.runtime.sendNativeMessage(HOST, message)
  if (!result?.ok) throw new Error(result?.error || 'Plexo did not accept the download')
  return result
}
async function report(message, failed = false) {
  await chrome.storage.local.set({ lastMessage: message })
  await chrome.action.setBadgeText({ text: failed ? '!' : '' })
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' })
}
async function makeDownload(url, filename = '', referrer = '', id = crypto.randomUUID()) {
  if (!http(url)) throw new Error('Only direct HTTP/HTTPS links can be sent to Plexo')
  await historyChain
  const recent = requests.get(url)
  const headers = recent && Date.now() - recent.time < 120000 ? { ...recent.headers } : {}
  if (recent && recent.method !== 'GET')
    throw new Error('This download needs a form submission. Keep it in Chrome.')
  if (!headers.cookie) {
    const cookies = await chrome.cookies.getAll({ url })
    if (cookies.length)
      headers.cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  }
  if (!headers.referer && http(referrer)) {
    const source = new URL(referrer),
      target = new URL(url)
    // Match Chrome's default strict-origin-when-cross-origin policy.
    if (!(source.protocol === 'https:' && target.protocol === 'http:')) {
      headers.referer = source.origin === target.origin ? source.href : source.origin + '/'
    }
  }
  headers['user-agent'] ||= navigator.userAgent
  return {
    action: 'download',
    preflight: true,
    url,
    filename: filename.split(/[\\/]/).pop(),
    headers,
    id
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: 'send',
    title: 'Download with Plexo',
    contexts: ['link', 'video', 'audio', 'image'],
    targetUrlPatterns: ['http://*/*', 'https://*/*']
  })
  const settings = await chrome.storage.local.get('capture')
  if (settings.capture === undefined) await chrome.storage.local.set({ capture: true })
  await chrome.alarms.create('recover', { periodInMinutes: 1 })
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.incognito) {
    void report('Private downloads stay in Chrome.', true)
    return
  }
  void makeDownload(info.linkUrl || info.srcUrl, '', info.pageUrl)
    .then(native)
    .then((result) => {
      if (!result.cancelled) return report('Added to Plexo’s download queue.')
    })
    .catch((error) => report(error.message, true))
})

// Pause Chrome first; cancel it only after Plexo has durably accepted the item.
// If the native host is unavailable, resume the original Chrome download.
chrome.downloads.onCreated.addListener((item) => {
  void capture(item)
})
async function capture(item) {
  if (
    item.incognito ||
    item.byExtensionId ||
    item.state !== 'in_progress' ||
    item.paused ||
    item.danger !== 'safe'
  )
    return
  const url = item.finalUrl || item.url
  if (!http(url) || /\.(m3u8|mpd)(?:$|\?)/i.test(url)) return
  const { capture = true, excluded = '' } = await chrome.storage.local.get(['capture', 'excluded'])
  const host = new URL(url).hostname
  if (
    !capture ||
    excluded
      .split(/[\s,]+/)
      .some((domain) => domain && (host === domain || host.endsWith('.' + domain)))
  )
    return
  await historyChain
  const request = requests.get(url)
  // Unknown methods, POST responses and one-shot form submissions remain in Chrome.
  if (!request || request.method !== 'GET' || Date.now() - request.time > 120000) return
  const key = `pending-${item.id}`
  let accepted = false,
    paused = false
  try {
    await chrome.storage.local.set({ [key]: { id: item.id, time: Date.now(), accepted: false } })
    await chrome.downloads.pause(item.id)
    paused = true
    const [latest] = await chrome.downloads.search({ id: item.id })
    if (!latest || latest.state !== 'in_progress') return
    const result = await native(
      await makeDownload(
        url,
        latest.filename,
        item.referrer,
        `chrome-${item.id}-${Date.parse(item.startTime)}`
      )
    )
    accepted = true
    await chrome.storage.local.set({ [key]: { id: item.id, time: Date.now(), accepted: true } })
    await chrome.downloads.cancel(item.id)
    await report(result.cancelled ? 'Download cancelled.' : 'Added to Plexo’s download queue.')
  } catch (error) {
    if (paused && !accepted) await chrome.downloads.resume(item.id).catch(() => {})
    await report(
      accepted
        ? 'Plexo accepted this download. Check Chrome for a duplicate paused download.'
        : `Chrome kept the download: ${error.message}`,
      true
    )
  } finally {
    await chrome.storage.local.remove(key)
  }
}
chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== 'recover') return
  const stored = await chrome.storage.local.get(null)
  for (const [key, pending] of Object.entries(stored)) {
    if (!key.startsWith('pending-') || Date.now() - pending.time < 90000) continue
    if (pending.accepted) await chrome.downloads.cancel(pending.id).catch(() => {})
    else await chrome.downloads.resume(pending.id).catch(() => {})
    await chrome.storage.local.remove(key)
  }
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return
  if (sender.tab && /^youtube/.test(message.action || '')) {
    void youtubeRequest(message, sender, native)
      .then(respond)
      .catch((error) => respond({ ok: false, error: error.message }))
    return true
  }
  if (sender.tab && /^page/.test(message.action || '')) {
    void pageRequest(message, sender, async (url, filename, referrer) =>
      native(await makeDownload(url, filename, referrer))
    )
      .then(respond)
      .catch((error) => respond({ ok: false, error: error.message }))
    return true
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return
  ;(async () => {
    if (message.action === 'send')
      return native(await makeDownload(message.url, '', message.referrer))
    if (['status', 'show', 'remove'].includes(message.action)) return native(message)
    throw new Error('Unknown action')
  })()
    .then(respond)
    .catch((error) => respond({ ok: false, error: error.message }))
  return true
})
