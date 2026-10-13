// Runs in Chrome's isolated content-script world. Page scripts never receive native messages.
;(() => {
  if (chrome.extension.inIncognitoContext) return
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(location.hostname)) return
  const filePattern =
    /\.(zip|rar|7z|exe|msi|iso|dmg|apk|pak|pdf|epub|mp4|mkv|webm|mp3|m4a|ogg|wav)(?:[?#]|$)/i
  const streamPattern = /\.(m3u8|mpd|m4s|ts)(?:[?#]|$)/i
  const host = document.createElement('div')
  host.id = 'plexo-page-tools'
  // Reset the host as well as using Shadow DOM so site styles don't break the controls.
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    #dock,#media-tools{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#edf3ff;color-scheme:dark}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #53729f;border-radius:8px;background:#234777;color:#fff;padding:9px 12px}button:hover{background:#315f99}button:disabled{opacity:.65;cursor:wait}
    #dock{position:fixed;right:18px;bottom:18px;pointer-events:auto;max-width:calc(100vw - 36px)}
    #toggle{box-shadow:0 4px 20px #0005;font-weight:600;background:#17385f}#panel{width:345px;max-width:calc(100vw - 36px);max-height:65vh;overflow:auto;background:#172332;border:1px solid #4e6481;border-radius:12px;box-shadow:0 8px 28px #0008;padding:14px;margin-bottom:8px}
    [hidden]{display:none!important}.top,.item{display:flex;align-items:center;gap:10px}.top strong{flex:1;font-size:15px}#close{padding:3px 9px;background:transparent}.hint{font-size:12px;color:#b8c9df;margin:9px 0;white-space:normal}.item{border-top:1px solid #3b4b60;padding:10px 0}.name{flex:1;min-width:0;overflow-wrap:anywhere}.item button{padding:6px 9px;font-size:12px}.item small{display:block;color:#a7bdd7}.message{white-space:normal;overflow-wrap:anywhere;color:#ffd49a;margin-top:8px}#media-tools button{position:fixed;pointer-events:auto;box-shadow:0 2px 12px #0007;padding:7px 10px;font-size:12px}
  </style><div id="media-tools"></div><div id="dock" hidden><section id="panel" hidden aria-label="Plexo downloads"><div class="top"><strong>Download with Plexo</strong><button id="close" aria-label="Close download panel">×</button></div><p class="hint" id="hint"></p><div id="files"></div><div class="message" id="message" role="status"></div></section><button id="toggle">↓ Download with Plexo</button></div>`
  const $ = (id) => shadow.getElementById(id)
  let files = [],
    links = [],
    enabled = true,
    pending = false,
    scheduled = false,
    lastSignature = ''
  let stopped = false
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
  function label(url, element) {
    const custom = element?.getAttribute('download')
    if (custom) return custom.slice(0, 140)
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Download').slice(0, 140)
    } catch {
      return 'Download'
    }
  }
  function showPanel() {
    $('panel').hidden = false
  }
  $('toggle').addEventListener('click', (event) => {
    if (event.isTrusted) $('panel').hidden = !$('panel').hidden
  })
  $('close').addEventListener('click', (event) => {
    if (event.isTrusted) $('panel').hidden = true
  })
  async function download(file, button, browser = false) {
    button.disabled = true
    $('message').textContent = browser
      ? 'Starting browser download…'
      : 'Checking this file with Plexo…'
    try {
      const response = await send({
        action: browser ? 'pageBrowserDownload' : 'pageDownload',
        url: file.url
      })
      if (!response?.ok)
        throw new Error(response?.error || 'Reload this page after reloading the extension.')
      $('message').textContent = browser
        ? 'Download started in your browser.'
        : 'Added to Plexo. Open the app to see progress.'
    } catch (error) {
      $('message').textContent =
        `${error.message} You can use the website’s original Download button or “Browser” below.`
    } finally {
      button.disabled = false
    }
  }
  function render() {
    const signature = JSON.stringify(files)
    if (signature === lastSignature) return
    lastSignature = signature
    $('files').replaceChildren()
    for (const file of files.slice(0, 40)) {
      const row = document.createElement('div')
      row.className = 'item'
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = file.name
      const detail = document.createElement('small')
      detail.textContent = file.kind === 'media' ? 'Direct media file' : 'File link'
      name.append(detail)
      const button = document.createElement('button')
      button.textContent = 'Download'
      button.addEventListener('click', (event) => {
        if (event.isTrusted) void download(file, button)
      })
      const fallback = document.createElement('button')
      fallback.textContent = 'Browser'
      fallback.title = 'Download using your browser session'
      fallback.addEventListener('click', (event) => {
        if (event.isTrusted) void download(file, fallback, true)
      })
      row.append(name, button, fallback)
      $('files').append(row)
    }
  }
  function positionMediaButtons() {
    for (const [element, button] of mediaButtons) {
      const rect = element.getBoundingClientRect()
      button.hidden =
        !enabled ||
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
      const candidates = new Map()
      const elements = [...document.querySelectorAll('video,audio')].slice(0, 30)
      for (const element of elements) {
        const sources = [
          element.currentSrc,
          element.src,
          ...[...element.querySelectorAll('source')].map((source) => source.src)
        ]
        for (const source of sources) {
          const url = source && safeUrl(source)
          if (url && !streamPattern.test(url))
            candidates.set(url, { url, name: label(url), kind: 'media' })
        }
        if (!mediaButtons.has(element)) {
          const button = document.createElement('button')
          button.textContent = '↓ Download with Plexo'
          button.addEventListener('click', (event) => {
            if (event.isTrusted) {
              showPanel()
              $('dock').hidden = false
              void scan()
            }
          })
          mediaButtons.set(element, button)
          $('media-tools').append(button)
        }
      }
      for (const [element, button] of mediaButtons)
        if (!element.isConnected) {
          button.remove()
          mediaButtons.delete(element)
        }
      links = [...document.querySelectorAll('a[href]')]
        .filter((anchor) => {
          const url = safeUrl(anchor.href)
          return (
            url &&
            !streamPattern.test(url) &&
            (anchor.hasAttribute('download') ||
              filePattern.test(url) ||
              /\/downloads?(?:\/|\?|$)/i.test(new URL(url).pathname) ||
              /^download(?:\s|$)/i.test(anchor.textContent.trim()))
          )
        })
        .slice(0, 80)
      for (const element of links) {
        const url = safeUrl(element.href)
        candidates.set(url, {
          url,
          name: label(url, element),
          kind:
            filePattern.test(url) && /\.(mp4|webm|mp3|m4a|ogg|wav)(?:[?#]|$)/i.test(url)
              ? 'media'
              : 'file'
        })
      }
      const response = await send({ action: 'pageScan', files: [...candidates.values()] })
      if (!response?.ok) return
      enabled = response.enabled
      files = response.files
      const downloadControl = [...document.querySelectorAll('button,[role="button"]')]
        .slice(0, 300)
        .some((element) => /\bdownload\b/i.test(element.textContent))
      $('dock').hidden = !enabled || (!files.length && !elements.length && !downloadControl)
      $('toggle').textContent = files.length
        ? `↓ Download with Plexo · ${files.length}`
        : '↓ Download with Plexo'
      $('hint').textContent = files.length
        ? 'Choose a detected file. If a site refuses Plexo, use Browser or the site’s own download button.'
        : elements.length
          ? 'No standalone media file detected yet. Start playback and try again. Protected or segmented streams are not supported.'
          : 'Use this site’s Download button. Plexo will capture supported files automatically and keep refused transfers in your browser.'
      render()
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
