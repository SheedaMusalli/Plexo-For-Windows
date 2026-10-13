const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = ts.transpileModule(readFileSync('src/main/browser/youtube.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }
}).outputText
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
function fixture() {
  const children = [],
    calls = [],
    app = new EventEmitter(),
    exported = {}
  Object.assign(app, {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => 'test-downloads'
  })
  const context = {
    exports: exported,
    process,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === 'electron') return { app }
      if (name === '../settings')
        return { loadSettings: async () => ({ destinationDir: 'test-downloads' }) }
      if (name === 'node:fs/promises') return { mkdir: async () => {} }
      if (name === 'node:child_process')
        return {
          execFileSync(_exe, args) {
            children.find((child) => String(child.pid) === args[1])?.kill()
          },
          spawn(exe, args, options) {
            calls.push({ exe, args, options })
            const child = new EventEmitter()
            Object.assign(child, {
              stdout: new EventEmitter(),
              stderr: new EventEmitter(),
              pid: 90000 + children.length,
              exitCode: null,
              kill() {
                child.exitCode = 1
                child.emit('close', 1)
              }
            })
            children.push(child)
            return child
          }
        }
      return require(name)
    }
  }
  vm.runInNewContext(source, context)
  return { engine: new exported.YoutubeDownloads(), children, calls, app }
}
const next = () => new Promise((resolve) => setImmediate(resolve))
async function ready(f) {
  const { job } = await f.engine.dispatch({ action: 'youtubeInspect', url })
  const child = f.children[0]
  child.stdout.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        title: 'Test',
        formats: [
          { height: 720, vcodec: 'avc1', acodec: 'none' },
          { height: 2160, vcodec: 'avc1', acodec: 'none', has_drm: true },
          { vcodec: 'none', acodec: 'opus' }
        ]
      }) + '\n'
    )
  )
  child.exitCode = 0
  child.emit('close', 0)
  await next()
  return job.id
}
test('rejects other origins and format injection; only enumerated formats reach a shell-free process', async () => {
  const f = fixture()
  await assert.rejects(
    f.engine.dispatch({
      action: 'youtubeInspect',
      url: 'https://youtube.com.evil.example/watch?v=jNQXAC9IVRw'
    })
  )
  const id = await ready(f)
  const response = await f.engine.dispatch({ action: 'youtubeStatus', id, url })
  assert.equal(response.job.choices.length, 2)
  await assert.rejects(
    f.engine.dispatch({ action: 'youtubeDownload', url, id, choice: '--exec calc.exe' })
  )
  await f.engine.dispatch({ action: 'youtubeDownload', url, id, choice: 'audio' })
  await next()
  assert.equal(f.calls[1].options.shell, false)
  assert.equal(f.calls[1].args[f.calls[1].args.indexOf('--format') + 1], 'ba')
  assert.equal(f.calls[1].args.at(-1), url)
  await f.engine.dispatch({ action: 'youtubeCancel', url, id })
  assert.equal(f.children[1].exitCode, 1)
})
test('cancellation before asynchronous folder preparation never starts a download', async () => {
  const f = fixture(),
    id = await ready(f)
  await f.engine.dispatch({ action: 'youtubeDownload', url, id, choice: 'h720' })
  await f.engine.dispatch({ action: 'youtubeCancel', url, id })
  await next()
  assert.equal(f.children.length, 1)
  const response = await f.engine.dispatch({ action: 'youtubeStatus', url, id })
  assert.equal(response.job.state, 'cancelled')
})
test('completed path, progress, duplicate inspection and shutdown cancellation', async () => {
  const f = fixture(),
    id = await ready(f)
  assert.equal((await f.engine.dispatch({ action: 'youtubeInspect', url })).job.id, id)
  await f.engine.dispatch({ action: 'youtubeDownload', url, id, choice: 'h720' })
  await next()
  const child = f.children[1]
  child.stdout.emit('data', Buffer.from('PLEXO_PROGRESS:50% 1MiB/s ETA 00:01\n'))
  assert.match((await f.engine.dispatch({ action: 'youtubeStatus', url, id })).job.message, /50%/)
  child.stdout.emit('data', Buffer.from('PLEXO_FILE:C:\\Downloads\\video.webm\n'))
  child.exitCode = 0
  child.emit('close', 0)
  await next()
  assert.equal(
    (await f.engine.dispatch({ action: 'youtubeStatus', url, id })).job.state,
    'complete'
  )
  await f.engine.dispatch({ action: 'youtubeInspect', url })
  f.app.emit('before-quit')
  assert.equal(f.children[2].exitCode, 1)
})
