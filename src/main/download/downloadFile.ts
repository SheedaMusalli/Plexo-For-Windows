import { createWriteStream, type WriteStream } from 'node:fs'
import { copyFile, lstat, open, rename, rm, stat } from 'node:fs/promises'
import { COPYFILE_EXCL } from 'node:constants'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'

/** The resumable partial file. It can live on a different volume; publish copies it beside the
 * final file first when needed, then atomically renames that complete copy into place. */
export class DownloadFile {
  constructor(
    readonly path: string,
    readonly reservationPath = path
  ) {}

  /** Every writer has its own descriptor and explicit offset. Never use append mode here. */
  writer(position: number): WriteStream {
    return createWriteStream(this.path, { flags: 'r+', start: position })
  }

  async read(position: number, length: number): Promise<Buffer> {
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  /** Flushes the staging file before a recovery checkpoint or final publication. */
  async sync(): Promise<void> {
    const handle = await open(this.path, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async size(): Promise<number> {
    return (await stat(this.path)).size
  }

  async publish(
    destinationPath: string,
    expectedBytes: number,
    beforeAttempt: (candidate: string, publicationTempPath?: string) => Promise<void>
  ): Promise<string> {
    if (expectedBytes > 0 && (await this.size()) !== expectedBytes) {
      throw new Error('Download file size does not match the expected size')
    }
    await this.sync()
    const extension = extname(destinationPath)
    const stem = basename(destinationPath, extension)
    const directory = dirname(destinationPath)
    for (let index = 0; index < 10_000; index += 1) {
      const suffix = index === 0 ? '' : ` (${index})`
      if (Buffer.byteLength(`${suffix}${extension}`) >= 255) {
        throw new Error('The file extension is too long')
      }
      const candidateCharacters = Array.from(stem)
      while (Buffer.byteLength(`${candidateCharacters.join('')}${suffix}${extension}`) > 255) {
        candidateCharacters.pop()
      }
      const candidateStem = candidateCharacters.join('')
      const candidate = join(directory, `${candidateStem}${suffix}${extension}`)
      if (candidate !== destinationPath) {
        const partialExists = await lstat(`${candidate}.plexo`).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          }
        )
        if (partialExists) continue
      }
      const destinationExists = await lstat(candidate).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        }
      )
      if (destinationExists) continue
      let publicationTempPath: string | undefined
      try {
        try {
          // Same-volume staging retains the fast atomic-rename path.
          await beforeAttempt(candidate)
          await rename(this.path, candidate)
          await rm(this.reservationPath, { force: true })
          return candidate
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        }

        // When temporary data is on another volume, copy beside the final file and then rename
        // that complete copy atomically into place.
        publicationTempPath = join(directory, `.${randomUUID()}.plexo-publish`)
        await copyFile(this.path, publicationTempPath, COPYFILE_EXCL)
        if (expectedBytes > 0 && (await stat(publicationTempPath)).size !== expectedBytes) {
          throw new Error('Published download copy does not match the expected size')
        }
        const copied = await open(publicationTempPath, 'r+')
        try {
          await copied.sync()
        } finally {
          await copied.close()
        }
        await beforeAttempt(candidate, publicationTempPath)
        const targetAppeared = await lstat(candidate).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          }
        )
        if (targetAppeared) continue
        await rename(publicationTempPath, candidate)
        publicationTempPath = undefined
        await rm(this.path, { force: true })
        await rm(this.reservationPath, { force: true })
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      } finally {
        if (publicationTempPath) await rm(publicationTempPath, { force: true }).catch(() => {})
      }
    }
    throw new Error('Could not find an unused file name for this download')
  }

  async discard(): Promise<void> {
    await rm(this.path, { force: true })
    await rm(this.reservationPath, { force: true })
  }
}
