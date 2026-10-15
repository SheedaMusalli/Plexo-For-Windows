const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const AdmZip = require('adm-zip')
const root = path.resolve(__dirname, '..')
const keyDir = path.join(root, '.signing')
fs.mkdirSync(keyDir, { recursive: true })
const keyFile = path.join(keyDir, 'extension.pem')
if (!fs.existsSync(keyFile))
  fs.writeFileSync(
    keyFile,
    crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    }).privateKey
  )
const key = fs.readFileSync(keyFile)
const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' })
const idBytes = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16)
const id = [...idBytes.toString('hex')]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('')
const manifestFile = path.join(root, 'extension', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestFile))
manifest.key = publicKey.toString('base64')
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'extension', 'icon.png'))
fs.writeFileSync(path.join(root, 'native-host', 'extension-id.txt'), id)
fs.writeFileSync(
  path.join(root, 'native-host', 'com.plexo.browser.json'),
  `${JSON.stringify(
    {
      name: 'com.plexo.browser',
      description: 'Plexo browser integration',
      path: 'Plexo.BrowserHost.exe',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`]
    },
    null,
    2
  )}\n`
)
// Keep generated metadata in the same format enforced by `npm run format:check`.
execFileSync(
  process.execPath,
  [
    require.resolve('prettier/bin/prettier.cjs'),
    '--write',
    manifestFile,
    path.join(root, 'native-host', 'com.plexo.browser.json')
  ],
  { stdio: 'inherit' }
)
const out = path.join(root, 'release')
fs.mkdirSync(out, { recursive: true })
const zipFile = path.join(out, 'Plexo-Chrome.zip')
if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile)
const archive = new AdmZip()
archive.addLocalFolder(path.join(root, 'extension'))
archive.writeZip(zipFile)
const zip = fs.readFileSync(path.join(out, 'Plexo-Chrome.zip'))
function varint(n) {
  const bytes = []
  while (n > 127) {
    bytes.push((n & 127) | 128)
    n >>>= 7
  }
  bytes.push(n)
  return Buffer.from(bytes)
}
function field(n, data) {
  return Buffer.concat([varint((n << 3) | 2), varint(data.length), data])
}
function uint32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const signedHeader = field(1, idBytes)
const signature = crypto.sign(
  'sha256',
  Buffer.concat([Buffer.from('CRX3 SignedData\0'), uint32(signedHeader.length), signedHeader, zip]),
  key
)
const header = Buffer.concat([
  field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
  field(10000, signedHeader)
])
fs.writeFileSync(
  path.join(out, 'Plexo-Chrome.crx'),
  Buffer.concat([Buffer.from('Cr24'), uint32(3), uint32(header.length), header, zip])
)
console.log('Extension ID:', id)
