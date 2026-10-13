;(() => {
  if (chrome.extension.inIncognitoContext || window !== window.top) return
  const host = document.createElement('div')
  host.id = 'plexo-youtube-tools'
  host.style.cssText =
    'all:initial!important;position:fixed!important;z-index:2147483647!important;display:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    #panel,#toggle{font:12px/1.4 "Segoe UI",Arial,sans-serif;color:#f1f5fa;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}
    button{font:inherit;color:inherit;cursor:pointer;border:1px solid #526374;background:#233446;border-radius:5px;padding:5px 8px}button:hover{background:#365775}button:disabled{opacity:.6;cursor:wait}
    #toggle{font-size:11px;padding:4px 7px;box-shadow:0 2px 7px #0007;background:#203749eF;white-space:nowrap}
    #panel{position:absolute;right:0;top:30px;width:290px;max-width:calc(100vw - 24px);max-height:60vh;overflow:auto;border:1px solid #526374;background:#17232f;border-radius:8px;box-shadow:0 5px 24px #0009;padding:11px}
    .top{display:flex;gap:8px;align-items:center}strong{flex:1;overflow-wrap:anywhere}#close{border:0;background:transparent;padding:0 4px;font-size:17px}.choice{display:block;width:100%;text-align:left;margin:5px 0}#status{margin:9px 0;font-size:11px;color:#c6d6e6;overflow-wrap:anywhere;white-space:normal}#retry,#cancel{margin-top:4px}.privacy{font-size:10px;color:#b5c4d3;line-height:1.35}
  </style><button id="toggle" aria-expanded="false" title="Download this YouTube video with Plexo">↓ Download this video</button><section id="panel" hidden aria-label="YouTube download qualities"><div class="top"><strong id="title">Download with Plexo</strong><button id="close" aria-label="Close">×</button></div><div id="status" role="status"></div><div id="choices"></div><p class="privacy" id="cookie-note" hidden>Only for this retry, Plexo sends cookies for youtube.com to the local download app. The app deletes its temporary cookie file when the request ends.</p><button id="retry" hidden>Try again</button><button id="cancel" hidden>Cancel download</button></section>`
  const $ = (id) => shadow.getElementById(id)
  let url = '',
    job = null,
    enabled = true,
    busy = false,
    stopped = false,
    polling = false,
    generation = 0,
    signature = ''
  const send = (message) => chrome.runtime.sendMessage(message)
  function currentUrl() {
    const current = new URL(location.href)
    const id =
      current.pathname === '/watch'
        ? current.searchParams.get('v')
        : /^\/shorts\/([\w-]{11})/.exec(current.pathname)?.[1]
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : ''
  }
  function open(value) {
    $('panel').hidden = !value
    $('toggle').setAttribute('aria-expanded', String(value))
  }
  function render() {
    if (!job) return
    $('title').textContent = job.title
    $('status').textContent = job.message
    $('cancel').hidden = !['loading', 'downloading'].includes(job.state)
    $('retry').hidden = !['error', 'cancelled', 'complete'].includes(job.state)
    $('retry').textContent = job.state === 'complete' ? 'Download another quality' : 'Try again'
    const needsSignIn =
      job.state === 'error' && /sign in|not a bot|cookies-from-browser/i.test(job.message)
    $('cookie-note').hidden = !needsSignIn
    const next = JSON.stringify([job.state, job.choices])
    if (next === signature) return
    signature = next
    $('choices').replaceChildren()
    if (job.state === 'ready' || needsSignIn)
      for (const choice of job.choices) {
        const button = document.createElement('button')
        button.className = 'choice'
        button.textContent = needsSignIn
          ? `Retry ${choice.label} with YouTube sign-in`
          : choice.label
        button.addEventListener('click', (event) => {
          if (event.isTrusted) void request('youtubeDownload', choice.id, needsSignIn)
        })
        $('choices').append(button)
      }
  }
  async function request(action, choice, withCookies = false) {
    if (busy || !url) return
    busy = true
    const token = generation
    $('status').textContent =
      action === 'youtubeInspect' ? 'Finding available qualities…' : 'Contacting Plexo…'
    $('choices')
      .querySelectorAll('button')
      .forEach((button) => {
        button.disabled = true
      })
    try {
      const response = await send({ action, url, id: job?.id, choice, withCookies })
      if (token !== generation) return
      if (!response?.ok)
        throw new Error(
          response?.error || 'Plexo is unavailable. Reload the extension and this page.'
        )
      job = response.job
      signature = ''
      render()
    } catch (error) {
      if (token !== generation) return
      $('status').textContent = error.message
      if (action === 'youtubeDownload') {
        job = { ...job, state: 'error', message: error.message }
        signature = ''
        render()
      }
      $('retry').hidden = false
    } finally {
      busy = false
      $('choices')
        .querySelectorAll('button')
        .forEach((button) => {
          button.disabled = false
        })
    }
  }
  $('toggle').addEventListener('click', (event) => {
    if (!event.isTrusted) return
    open($('panel').hidden)
    if (!$('panel').hidden && !job) void request('youtubeInspect')
  })
  $('close').addEventListener('click', (event) => {
    if (event.isTrusted) open(false)
  })
  $('retry').addEventListener('click', (event) => {
    if (event.isTrusted) void request('youtubeInspect')
  })
  $('cancel').addEventListener('click', (event) => {
    if (event.isTrusted) void request('youtubeCancel')
  })
  document.addEventListener('keydown', (event) => {
    if (event.isTrusted && event.key === 'Escape') open(false)
  })
  function position() {
    const next = currentUrl()
    if (next !== url) {
      url = next
      job = null
      generation++
      signature = ''
      open(false)
      $('choices').replaceChildren()
      $('status').textContent = ''
      $('retry').hidden = true
      $('cancel').hidden = true
    }
    const player =
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-reel-video-renderer[is-active] video') ||
      document.querySelector('video')
    const rect = player?.getBoundingClientRect()
    const visible =
      enabled &&
      url &&
      rect &&
      rect.width > 120 &&
      rect.height > 80 &&
      rect.bottom > 30 &&
      rect.top < innerHeight - 30
    host.style.setProperty('display', visible ? 'block' : 'none', 'important')
    if (!visible) return
    host.style.setProperty(
      'left',
      `${Math.max(8, Math.min(innerWidth - 160, rect.right - 153))}px`,
      'important'
    )
    host.style.setProperty('top', `${Math.max(8, rect.top + 7)}px`, 'important')
    const parent = document.fullscreenElement || document.documentElement
    if (host.parentElement !== parent) parent.append(host)
  }
  async function tick() {
    if (stopped || polling) return
    position()
    polling = true
    const token = generation
    try {
      const settings = await send({ action: 'youtubeEnabled' })
      if (settings?.ok) enabled = settings.enabled
      position()
      if (job && ['loading', 'downloading'].includes(job.state) && !busy && token === generation) {
        const response = await send({ action: 'youtubeStatus', url, id: job.id })
        if (token === generation) {
          if (!response?.ok) throw new Error(response?.error || 'Plexo disconnected')
          job = response.job
          render()
        }
      }
    } catch (error) {
      if (/context invalidated/i.test(error.message)) {
        stopped = true
        host.remove()
        clearInterval(timer)
      } else if (token === generation && job) {
        job.state = 'error'
        job.message = error.message
        render()
      }
    } finally {
      polling = false
    }
  }
  document.documentElement.append(host)
  const timer = setInterval(() => void tick(), 1000)
  addEventListener('scroll', position, { passive: true })
  addEventListener('resize', position)
  document.addEventListener('yt-navigate-finish', position)
  document.addEventListener('fullscreenchange', position)
  void tick()
})()
