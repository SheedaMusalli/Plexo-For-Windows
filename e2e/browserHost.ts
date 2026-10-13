import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Separate registry namespace and pipe: tests never redirect the user's installed extension. */
export async function createBrowserHost(
  root: string,
  destination: string
): Promise<{
  executable: string
  manifest: string
  extension: string
  pipe: string
  hostName: string
}> {
  const pipe = `test-${randomUUID()}`
  const hostName = `com.plexo.test_${pipe.replace(/-/g, '_')}`
  const hostDir = join(destination, 'test-native-host')
  await mkdir(hostDir, { recursive: true })
  const executable = join(hostDir, 'Plexo.BrowserHost.exe')
  execFileSync(
    join(process.env.WINDIR!, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/define:PLEXO_TEST_HOST',
      '/r:System.Web.Extensions.dll',
      `/out:${executable}`,
      join(root, 'native-host/Program.cs')
    ],
    { windowsHide: true, stdio: 'pipe' }
  )
  const id = (await readFile(join(root, 'native-host/extension-id.txt'), 'utf8')).trim()
  await writeFile(join(hostDir, 'extension-id.txt'), id)
  const manifest = join(hostDir, 'host.json')
  await writeFile(
    manifest,
    JSON.stringify({
      name: hostName,
      description: 'Plexo isolated test host',
      path: executable,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${id}/`]
    })
  )
  const extension = join(destination, 'test-extension')
  await cp(join(root, 'extension'), extension, { recursive: true })
  const background = join(extension, 'background.js')
  await writeFile(
    background,
    (await readFile(background, 'utf8')).replace("'com.plexo.browser'", `'${hostName}'`)
  )
  return { executable, manifest, extension, pipe, hostName }
}
