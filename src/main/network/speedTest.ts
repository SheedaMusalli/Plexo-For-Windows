import type {
  NetworkInterfaceInfo,
  NetworkSpeedSample,
  SpeedTestDirection
} from '../../shared/types'
import { StreamConnection } from './routes'

const SAMPLE_TIMEOUT_MS = 20_000
const MAX_SAMPLE_BYTES = 8_000_000

export function createNetworkSpeedConnection(
  network: () => NetworkInterfaceInfo | undefined
): StreamConnection {
  return new StreamConnection(network, {
    timeoutMs: SAMPLE_TIMEOUT_MS,
    connectTimeoutMs: 8_000
  })
}

/** Transfers one bounded Cloudflare sample through exactly one selected network interface. */
export async function measureNetworkSpeedSample(
  network: NetworkInterfaceInfo,
  direction: SpeedTestDirection,
  bytes: number,
  signal: AbortSignal,
  options: { connection?: StreamConnection; endpoint?: string } = {}
): Promise<NetworkSpeedSample> {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SAMPLE_BYTES) {
    throw new Error('The speed-test sample size is invalid.')
  }

  const connection = options.connection ?? createNetworkSpeedConnection(() => network)
  const timedOut = new AbortController()
  const timeout = setTimeout(
    () => timedOut.abort(new Error('Speed-test sample timed out.')),
    SAMPLE_TIMEOUT_MS
  )
  const requestSignal = AbortSignal.any([signal, timedOut.signal])
  const url = new URL(
    direction === 'download' ? '/__down' : '/__up',
    options.endpoint ?? 'https://speed.cloudflare.com'
  )
  url.searchParams.set('bytes', String(bytes))
  url.searchParams.set('plexo', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const body = direction === 'upload' && bytes > 0 ? Buffer.alloc(bytes) : undefined
  const startedAt = Date.now()

  try {
    const { req, res } = await connection.request(
      url,
      {
        'cache-control': 'no-store',
        ...(body ? { 'content-type': 'application/octet-stream' } : {})
      },
      requestSignal,
      { method: body ? 'POST' : 'GET', body }
    )

    if (res.statusCode !== 200) {
      res.resume()
      throw new Error(`Cloudflare returned HTTP ${res.statusCode ?? 0}.`)
    }

    let receivedBytes = 0
    const abort = (): void => {
      req.destroy(new Error('Speed-test sample cancelled.'))
    }
    await new Promise<void>((resolve, reject) => {
      requestSignal.addEventListener('abort', abort, { once: true })
      res.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
      })
      res.once('end', resolve)
      res.once('error', reject)
      req.once('error', reject)
      if (requestSignal.aborted) abort()
    }).finally(() => requestSignal.removeEventListener('abort', abort))

    const transferredBytes = body ? bytes : receivedBytes
    if (bytes > 0 && transferredBytes <= 0) {
      throw new Error('Cloudflare returned an empty speed-test sample.')
    }
    return { bytes: transferredBytes, durationMs: Math.max(1, Date.now() - startedAt) }
  } finally {
    clearTimeout(timeout)
    if (!options.connection) connection.close()
  }
}
