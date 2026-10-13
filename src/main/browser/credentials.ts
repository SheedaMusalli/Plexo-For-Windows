import { safeStorage } from 'electron'
import type { StartDownloadRequest } from '../../shared/types'

export function sealRequest(request: StartDownloadRequest): StartDownloadRequest {
  const { browserContext, ...rest } = request
  if (!browserContext) return rest
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Windows credential encryption unavailable')
  return {
    ...rest,
    encryptedBrowserContext: safeStorage
      .encryptString(JSON.stringify(browserContext))
      .toString('base64')
  }
}

export function unsealRequest(request: StartDownloadRequest): StartDownloadRequest {
  if (!request.encryptedBrowserContext) return request
  const { encryptedBrowserContext, ...rest } = request
  return {
    ...rest,
    browserContext: JSON.parse(
      safeStorage.decryptString(Buffer.from(encryptedBrowserContext, 'base64'))
    )
  }
}
