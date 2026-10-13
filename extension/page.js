// Place small controls on directly downloadable media, never a floating browser-corner button.
;(() => {
  if (chrome.extension.inIncognitoContext) return
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(location.hostname)) return
  const streamPattern = /\.(m3u8|mpd|m4s|ts)(?:[?#]|$)/i
  const host = document.createElement('div')
  host.id = 'plexo-page-tools'
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    #media-tools{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#edf3ff;color-scheme:dark}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #53729f;border-radius:8px;background:#234777;color:#fff;padding:7px 10px}button:hover{background:#315f99}button:disabled{opacity:.65;cursor:wait}
    #media-tools button{position:fixed;pointer-events:auto;box-shadow:0 2px 12px #0007;font-size:12px;white-space:nowrap}
  </style><div id="media-tools"></div>`
  const mediaTools = shadow.getElementById('media-tools')
  let enabled = true,
    pending = false,
    scheduled = false,
    stopped = false
  const mediaButtons = new Map()

  function send(message) {
    return chrome.runtime.sendMessage(message)
  }
  function safeUrl(value) {
    try {
      const url = new URL(value, location.href)
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null
    } catch {
      return null
    }
  }
  function mediaUrl(element) {
    const sources = [
      element.currentSrc,
      element.src,
      ...[...element.querySelectorAll('source')].map((source) => source.src)
    ]
    return sources
      .map((source) => source && safeUrl(source))
      .find((url) => url && !streamPattern.test(url))
  }
  function label(url) {
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Media file').slice(
        0,
        140
      )
    } catch {
      return 'Media file'
    }
  }
  async function download(element, button) {
    const url = mediaUrl(element)
    if (!url) {
      button.textContent = 'Direct link unavailable'
      setTimeout(() => (button.textContent = '↓ Download with Plexo'), 2500)
      return
    }
    button.disabled = true
    button.textContent = 'Checking with Plexo…'
    try {
      const scanned = await send({
        action: 'pageScan',
        files: [{ url, name: label(url), kind: 'media' }]
      })
      if (!scanned?.ok || !scanned.files?.some((file) => file.url === url))
        throw new Error(scanned?.error || 'This media link is no longer available.')
      const response = await send({ action: 'pageDownload', url })
      if (!response?.ok) throw new Error(response?.error || 'Plexo could not accept this file.')
      button.textContent = response.cancelled ? 'Download cancelled' : 'Added to Plexo'
    } catch (error) {
      button.textContent = error instanceof Error ? error.message.slice(0, 70) : 'Download failed'
    } finally {
      button.disabled = false
      setTimeout(() => {
        if (button.isConnected) button.textContent = '↓ Download with Plexo'
      }, 3000)
    }
  }
  function positionMediaButtons() {
    for (const [element, button] of mediaButtons) {
      const rect = element.getBoundingClientRect()
      button.hidden =
        !enabled ||
        !mediaUrl(element) ||
        rect.width < 120 ||
        rect.height < 50 ||
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        !element.isConnected
      button.style.left = `${Math.max(8, Math.min(innerWidth - 180, rect.left + 8))}px`
      button.style.top = `${Math.max(8, rect.top + 8)}px`
    }
  }
  async function scan() {
    scheduled = false
    if (pending || stopped || document.hidden) return
    pending = true
    try {
      const elements = [...document.querySelectorAll('video,audio')].slice(0, 30)
      const files = []
      for (const element of elements) {
        const url = mediaUrl(element)
        if (url) files.push({ url, name: label(url), kind: 'media' })
        if (mediaButtons.has(element)) continue
        const button = document.createElement('button')
        button.textContent = '↓ Download with Plexo'
        button.title = 'Send this direct media file to Plexo'
        button.addEventListener('click', (event) => {
          if (event.isTrusted) void download(element, button)
        })
        mediaButtons.set(element, button)
        mediaTools.append(button)
      }
      for (const [element, button] of mediaButtons)
        if (!element.isConnected) {
          button.remove()
          mediaButtons.delete(element)
        }
      const response = await send({ action: 'pageScan', files })
      if (!response?.ok) return
      enabled = response.enabled
      positionMediaButtons()
    } catch (error) {
      if (/context invalidated/i.test(error.message)) {
        stopped = true
        host.remove()
        clearInterval(timer)
        observer.disconnect()
      }
    } finally {
      pending = false
    }
  }
  function schedule() {
    if (!scheduled && !stopped) {
      scheduled = true
      setTimeout(() => void scan(), 350)
    }
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'download']
  })
  const timer = setInterval(() => void scan(), 2500)
  document.addEventListener('play', schedule, true)
  document.addEventListener('loadedmetadata', schedule, true)
  addEventListener('scroll', positionMediaButtons, { passive: true })
  addEventListener('resize', positionMediaButtons, { passive: true })
  document.documentElement.append(host)
  void scan()
})()
