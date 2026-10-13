function videoUrl(value) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
  )
    throw new Error('Open a YouTube video first.')
  const id =
    url.pathname === '/watch'
      ? url.searchParams.get('v')
      : /^\/(?:shorts|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1]
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Open a YouTube video first.')
  return `https://www.youtube.com/watch?v=${id}`
}

export async function youtubeRequest(message, sender, native) {
  if (!sender.tab || sender.tab.incognito || sender.frameId !== 0 || !sender.documentId)
    throw new Error('Unavailable in this page.')
  const settings = await chrome.storage.local.get(['pageButtons', 'excluded'])
  const host = new URL(sender.url).hostname
  const excluded = (settings.excluded || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .some((site) => site && (host === site || host.endsWith('.' + site)))
  if (message.action === 'youtubeEnabled')
    return { ok: true, enabled: settings.pageButtons !== false && !excluded }
  if (settings.pageButtons === false || excluded)
    throw new Error('Media download buttons are disabled for this site.')
  // Re-read the tab: YouTube changes videos without creating a new document.
  const tab = await chrome.tabs.get(sender.tab.id)
  const url = videoUrl(tab.url)
  if (url !== videoUrl(message.url))
    throw new Error('The video changed. Open its download menu again.')
  if (
    !['youtubeInspect', 'youtubeStatus', 'youtubeDownload', 'youtubeCancel'].includes(
      message.action
    )
  )
    throw new Error('Unknown YouTube command')
  if (message.action === 'youtubeInspect') {
    const status = await native({ action: 'status' })
    if (!status.capabilities?.youtube)
      throw new Error(
        'Install the new Plexo Windows app (1.0.0-browser.3 or newer) to download YouTube videos.'
      )
  }
  let cookies
  let userAgent
  if (message.action === 'youtubeDownload' && message.withCookies === true) {
    const list = await chrome.cookies.getAll({ url: 'https://www.youtube.com' })
    cookies = list
      .filter(
        (cookie) =>
          (cookie.domain === 'youtube.com' || cookie.domain.endsWith('.youtube.com')) &&
          cookie.value &&
          !cookie.partitionKey
      )
      .map(({ domain, name, value, path, secure, httpOnly, expirationDate }) => ({
        domain,
        name,
        value,
        path,
        secure,
        httpOnly,
        expirationDate
      }))
    const size = new TextEncoder().encode(JSON.stringify(cookies)).length
    if (!cookies.length)
      throw new Error(
        'No YouTube sign-in cookies found. Sign in to YouTube in this browser, then retry.'
      )
    if (
      !cookies.some((cookie) => /^(SID|SAPISID|__Secure-1PSID|__Secure-3PSID)$/.test(cookie.name))
    )
      throw new Error(
        'Plexo did not find a signed-in YouTube session. Sign in to YouTube in this browser, refresh the video page, then retry.'
      )
    if (size > 256 * 1024)
      throw new Error('YouTube’s cookie list is too large to pass to Plexo safely.')
    if (typeof message.userAgent === 'string' && /^Mozilla\/5\.0 /.test(message.userAgent))
      userAgent = message.userAgent.slice(0, 512)
  }
  return native({
    action: message.action,
    url,
    id: String(message.id || '').slice(0, 80),
    choice: String(message.choice || '').slice(0, 30),
    cookies,
    userAgent
  })
}
