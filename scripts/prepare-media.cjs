const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  AdmZip = require('adm-zip')
const root = path.join(process.cwd(), 'media-tools')
fs.mkdirSync(root, { recursive: true })
;(async () => {
  const lock = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'media-tools.lock.json'), 'utf8')
  )
  if (
    Object.entries(lock.files).every(
      ([name, hash]) =>
        fs.existsSync(path.join(root, name)) &&
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(root, name)))
          .digest('hex') === hash
    )
  ) {
    console.log('Pinned media tools verified')
    return
  }
  const records = []
  for (const record of lock.records) {
    const { repo, version } = record
    const asset = {
      name: new URL(record.url).pathname.split('/').pop(),
      browser_download_url: record.url,
      digest: record.sha256
    }
    console.log('Downloading ' + asset.name)
    const bytes = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
    if ('sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') !== asset.digest)
      throw Error('Digest mismatch')
    if (asset.name.endsWith('.exe')) fs.writeFileSync(path.join(root, asset.name), bytes)
    else {
      const zip = new AdmZip(bytes)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        if (/(?:\.exe|\.dll|LICENSE.*|COPYING.*)$/i.test(entry.entryName))
          fs.writeFileSync(path.join(root, path.basename(entry.entryName)), entry.getData())
      }
    }
    records.push({
      repo,
      version,
      url: asset.browser_download_url,
      sha256: asset.digest
    })
  }
  fs.writeFileSync(path.join(root, 'versions.json'), JSON.stringify(records, null, 2))
  for (const [name, url] of [
    ['yt-dlp-LICENSE.txt', 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/LICENSE'],
    ['deno-LICENSE.txt', 'https://raw.githubusercontent.com/denoland/deno/v2.9.7/LICENSE.md']
  ]) {
    const r = await fetch(url)
    if (!r.ok) throw Error(url)
    fs.writeFileSync(path.join(root, name), await r.text())
  }
  console.log('Media tools ready')
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
