const http = (value) => {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      value.length <= 32768
    )
  } catch {
    return false
  }
}
const segmented = (url) => /\.(m3u8|mpd|m4s|ts)(?:[?#]|$)|[?&](?:range|segment|sq)=/i.test(url)
let chain = Promise.resolve()
const serial = (work) => {
  const result = chain.then(work)
  chain = result.catch(() => {})
  return result
}
const documentKey = (sender) => `page-files-${sender.tab.id}-${sender.documentId || sender.frameId}`

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (
      details.incognito ||
      details.tabId < 0 ||
      details.method !== 'GET' ||
      details.statusCode < 200 ||
      details.statusCode >= 300 ||
      segmented(details.url)
    )
      return
    const headers = Object.fromEntries(
      (details.responseHeaders || []).map((header) => [
        header.name.toLowerCase(),
        header.value || ''
      ])
    )
    const type = headers['content-type'] || ''
    if (!/^(video|audio)\//i.test(type) || /mpegurl|mp2t/i.test(type)) return
    void serial(async () => {
      const key = `page-network-${details.tabId}`
      const saved = await chrome.storage.session.get(key)
      const media = (saved[key] || []).filter(
        (item) => item.url !== details.url && Date.now() - item.time < 300000
      )
      media.push({
        url: details.url,
        name: new URL(details.url).pathname.split('/').pop() || 'Media file',
        kind: 'media',
        time: Date.now(),
        frameId: details.frameId,
        documentId: details.documentId
      })
      await chrome.storage.session.set({ [key]: media.slice(-40) })
    })
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['responseHeaders']
)

chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    const data = await chrome.storage.session.get(null)
    await chrome.storage.session.remove(
      Object.keys(data).filter(
        (key) => key === `page-network-${tabId}` || key.startsWith(`page-files-${tabId}-`)
      )
    )
  })
})

export async function pageRequest(message, sender, sendDownload) {
  if (!sender.tab || sender.tab.incognito || !http(sender.url) || !sender.documentId)
    throw new Error('This page cannot send downloads')
  if (message.action === 'pageScan')
    return serial(async () => {
      const settings = await chrome.storage.local.get(['pageButtons', 'excluded'])
      const host = new URL(sender.url).hostname
      const excluded = (settings.excluded || '')
        .toLowerCase()
        .split(/[\s,]+/)
        .some((site) => site && (host === site || host.endsWith('.' + site)))
      if (settings.pageButtons === false || excluded) return { ok: true, enabled: false, files: [] }
      const key = documentKey(sender)
      const stored = await chrome.storage.session.get(`page-network-${sender.tab.id}`)
      const observed = (stored[`page-network-${sender.tab.id}`] || []).filter(
        (item) =>
          Date.now() - item.time < 300000 &&
          item.frameId === sender.frameId &&
          (!item.documentId || item.documentId === sender.documentId)
      )
      const files = new Map()
      for (const candidate of [
        ...(Array.isArray(message.files) ? message.files.slice(0, 80) : []),
        ...observed
      ]) {
        if (
          !candidate ||
          typeof candidate.url !== 'string' ||
          !http(candidate.url) ||
          segmented(candidate.url)
        )
          continue
        files.set(candidate.url, {
          url: candidate.url,
          name: String(candidate.name || 'Download').slice(0, 140),
          kind: candidate.kind === 'media' ? 'media' : 'file'
        })
      }
      const result = [...files.values()].slice(0, 80)
      await chrome.storage.session.set({
        [key]: { files: result, time: Date.now(), pageUrl: sender.url }
      })
      return { ok: true, enabled: true, files: result }
    })
  if (!['pageDownload', 'pageBrowserDownload'].includes(message.action))
    throw new Error('Unknown page command')
  await chain
  const key = documentKey(sender),
    stored = (await chrome.storage.session.get(key))[key]
  if (
    !stored ||
    stored.pageUrl !== sender.url ||
    Date.now() - stored.time > 30000 ||
    !stored.files.some((file) => file.url === message.url)
  )
    throw new Error('This file is no longer on the page. Refresh the page and try again.')
  if (message.action === 'pageBrowserDownload') {
    const downloadId = await chrome.downloads.download({ url: message.url })
    return { ok: true, browser: true, downloadId }
  }
  return sendDownload(message.url, '', sender.url)
}
