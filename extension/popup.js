const $ = (id) => document.getElementById(id)
const call = (message) => chrome.runtime.sendMessage(message)
const tell = (message) => {
  $('message').textContent = message
}
async function refresh() {
  try {
    const result = await call({ action: 'status' })
    if (!result.ok) throw new Error(result.error)
    $('status').textContent = `Connected · Plexo ${result.version}`
    if (!result.capabilities?.preflight)
      $('status').textContent += ' — Update the Windows app to browser.2 for safe capture.'
    $('current').textContent = result.current
      ? `${result.current.fileName} — ${result.current.status}`
      : ''
    $('queue').replaceChildren()
    for (const item of result.queue) {
      const div = document.createElement('div')
      div.className = 'item'
      div.append(
        document.createTextNode(item.filename + (item.downloadId ? ' · current' : ' · waiting'))
      )
      if (item.error) {
        const p = document.createElement('p')
        p.className = 'error'
        p.textContent = item.error
        div.append(p)
      }
      if (!item.downloadId) {
        const button = document.createElement('button')
        button.textContent = 'Remove'
        button.onclick = async () => {
          const r = await call({ action: 'remove', id: item.id })
          if (!r.ok) tell(r.error)
          await refresh()
        }
        div.append(button)
      }
      $('queue').append(div)
    }
    if (!result.queue.length) $('queue').textContent = 'No queued downloads.'
  } catch (error) {
    $('status').textContent =
      `App unavailable: ${error.message}. Install Plexo, then click Open app.`
  }
}
const settings = await chrome.storage.local.get([
  'capture',
  'pageButtons',
  'excluded',
  'lastMessage'
])
$('capture').checked = settings.capture !== false
$('pageButtons').checked = settings.pageButtons !== false
$('excluded').value = settings.excluded || ''
tell(settings.lastMessage || '')
$('capture').onchange = () => chrome.storage.local.set({ capture: $('capture').checked })
$('pageButtons').onchange = () =>
  chrome.storage.local.set({ pageButtons: $('pageButtons').checked })
$('save').onclick = async () => {
  await chrome.storage.local.set({ excluded: $('excluded').value.toLowerCase() })
  tell('Settings saved.')
}
$('open').onclick = async () => {
  const r = await call({ action: 'show' })
  tell(r.ok ? 'Plexo opened.' : r.error)
}
$('send').onsubmit = async (event) => {
  event.preventDefault()
  const r = await call({ action: 'send', url: $('url').value })
  tell(r.ok ? 'Added to Plexo.' : r.error)
  await refresh()
}
$('scan').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab.incognito) throw new Error('Private downloads stay in Chrome.')
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () =>
        [
          ...new Set(
            [...document.querySelectorAll('video,audio,source,a[href]')]
              .map((e) => e.currentSrc || e.src || e.href)
              .filter(
                (url) =>
                  /^https?:/.test(url) &&
                  (/\.(mp4|webm|mp3|m4a|ogg|wav)([?#]|$)/i.test(url) ||
                    [...document.querySelectorAll('video,audio,source')].some(
                      (e) => (e.currentSrc || e.src) === url
                    ))
              )
          )
        ].slice(0, 30)
    })
    const urls = [...new Set(results.flatMap((result) => result.result || []))]
    $('media').replaceChildren()
    if (!urls.length)
      $('media').textContent =
        'No direct media found. Protected or segmented streams cannot be downloaded this way.'
    for (const url of urls) {
      const div = document.createElement('div')
      div.className = 'item'
      const b = document.createElement('button')
      b.textContent = 'Download'
      b.onclick = async () => {
        const r = await call({ action: 'send', url, referrer: tab.url })
        tell(r.ok ? 'Added to Plexo.' : r.error)
        await refresh()
      }
      div.append(b, document.createTextNode(new URL(url).pathname.split('/').pop() || 'Media file'))
      $('media').append(div)
    }
  } catch (error) {
    tell(error.message)
  }
}
await refresh()
