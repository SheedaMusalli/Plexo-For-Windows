const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const AdmZip = require('adm-zip')
const root = path.resolve(__dirname, '..')
const bytes = fs.readFileSync(path.join(root, 'release/Plexo-Chrome.crx'))
assert.equal(bytes.subarray(0, 4).toString(), 'Cr24')
assert.equal(bytes.readUInt32LE(4), 3)
const length = bytes.readUInt32LE(8)
function parse(buffer) {
  let offset = 0
  const result = new Map()
  function integer() {
    let value = 0,
      shift = 0
    while (offset < buffer.length) {
      const byte = buffer[offset++]
      value |= (byte & 127) << shift
      if (!(byte & 128)) return value
      shift += 7
    }
    throw new Error('Truncated protobuf')
  }
  while (offset < buffer.length) {
    const tag = integer(),
      size = integer()
    assert.equal(tag & 7, 2)
    assert.ok(offset + size <= buffer.length)
    result.set(tag >>> 3, buffer.subarray(offset, offset + size))
    offset += size
  }
  return result
}
const fields = parse(bytes.subarray(12, 12 + length))
const proof = parse(fields.get(2)),
  signed = fields.get(10000)
const publicKey = proof.get(1),
  signature = proof.get(2)
const prefix = Buffer.alloc(4)
prefix.writeUInt32LE(signed.length)
const archiveBytes = bytes.subarray(12 + length)
assert.ok(
  crypto.verify(
    'sha256',
    Buffer.concat([Buffer.from('CRX3 SignedData\0'), prefix, signed, archiveBytes]),
    crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
    signature
  )
)
const idBytes = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16)
assert.deepEqual(parse(signed).get(1), idBytes)
const id = [...idBytes.toString('hex')]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('')
const archive = new AdmZip(archiveBytes)
const manifest = JSON.parse(archive.readAsText('manifest.json'))
assert.equal(manifest.key, publicKey.toString('base64'))
assert.equal(manifest.manifest_version, 3)
const native = JSON.parse(fs.readFileSync(path.join(root, 'native-host/com.plexo.browser.json')))
assert.deepEqual(native.allowed_origins, [`chrome-extension://${id}/`])
assert.equal(fs.readFileSync(path.join(root, 'native-host/extension-id.txt'), 'utf8'), id)
assert.deepEqual(archiveBytes, fs.readFileSync(path.join(root, 'release/Plexo-Chrome.zip')))
console.log('PASS: CRX3 RSA signature, embedded ZIP, manifest key and native-host ID:', id)
