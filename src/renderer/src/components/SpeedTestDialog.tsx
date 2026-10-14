import { Activity, Gauge, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

type TestStatus = 'ready' | 'running' | 'paused' | 'complete' | 'error'
type TestPhase = 'latency' | 'download' | 'upload' | 'complete'
type Direction = 'download' | 'upload'

interface Metrics {
  ping?: number
  jitter?: number
  download?: number
  upload?: number
}

interface Sample {
  bytes: number
  durationMs: number
}

interface TestSession {
  cancelled: boolean
  paused: boolean
  pauseGeneration: number
  controller: AbortController | null
  resume: (() => void) | null
}

const WARMUP_BYTES = 250_000
const MAX_SAMPLE_BYTES = 12_000_000
const SAMPLES_PER_DIRECTION = 3
let requestSequence = 0
const uploadPayloads = new Map<number, string>()

function formatSpeed(bitsPerSecond: number | undefined): string {
  if (typeof bitsPerSecond !== 'number' || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0)
    return '—'
  const mbps = bitsPerSecond / 1_000_000
  if (mbps < 0.05) return '<0.1 Mbps'
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(2)} Gbps` : `${mbps.toFixed(1)} Mbps`
}

function formatLatency(milliseconds: number | null | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0)
    return '—'
  if (milliseconds < 1) return '<1 ms'
  return `${Math.round(milliseconds)} ms`
}

function formatJitter(milliseconds: number | undefined): string {
  if (milliseconds === 0) return '0 ms'
  return formatLatency(milliseconds)
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function readServerDuration(header: string | null): number {
  if (!header) return 0
  const requestDuration = header.match(/(?:^|,\s*)cfRequest(?:uest)?Duration;\s*dur=([0-9.]+)/i)
  if (requestDuration && Number(requestDuration[1]) > 0) return Number(requestDuration[1])
  return [...header.matchAll(/(?:^|,\s*)cfSpeed[a-zA-Z]*;\s*dur=([0-9.]+)/gi)].reduce(
    (total, match) => total + Number(match[1]),
    0
  )
}

function getUploadPayload(bytes: number): string {
  let payload = uploadPayloads.get(bytes)
  if (!payload) {
    payload = '0'.repeat(bytes)
    uploadPayloads.set(bytes, payload)
  }
  return payload
}

async function waitUntilResumed(session: TestSession): Promise<void> {
  while (session.paused && !session.cancelled) {
    await new Promise<void>((resolve) => {
      session.resume = resolve
    })
    session.resume = null
  }
  if (session.cancelled) throw new Error('Speed test cancelled')
}

async function measureRequest(
  session: TestSession,
  direction: Direction,
  bytes: number
): Promise<Sample> {
  while (true) {
    await waitUntilResumed(session)
    const controller = new AbortController()
    const pauseGeneration = session.pauseGeneration
    session.controller = controller
    const startedAt = performance.now()
    const url = new URL(
      direction === 'download'
        ? 'https://speed.cloudflare.com/__down'
        : 'https://speed.cloudflare.com/__up'
    )
    url.searchParams.set('bytes', String(bytes))
    url.searchParams.set('plexo', String(++requestSequence))

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        ...(direction === 'upload' && bytes > 0
          ? { method: 'POST', body: getUploadPayload(bytes) }
          : {})
      })
      if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}.`)
      const body = await response.arrayBuffer()
      const elapsedMs = performance.now() - startedAt
      const serverMs = Math.min(
        readServerDuration(response.headers.get('server-timing')),
        elapsedMs * 0.8
      )
      const durationMs = Math.max(1, elapsedMs - serverMs)
      const transferredBytes = direction === 'upload' ? bytes : body.byteLength
      if (bytes > 0 && transferredBytes <= 0) {
        throw new Error('Cloudflare returned an empty speed-test sample.')
      }
      return { bytes: transferredBytes, durationMs }
    } catch (reason) {
      if (session.cancelled) throw new Error('Speed test cancelled')
      if (session.paused || session.pauseGeneration !== pauseGeneration) continue
      throw reason instanceof Error ? reason : new Error('The speed-test request failed.')
    } finally {
      if (session.controller === controller) session.controller = null
    }
  }
}

function sampleSpeed(samples: Sample[]): number | undefined {
  const bytes = samples.reduce((total, sample) => total + sample.bytes, 0)
  const durationMs = samples.reduce((total, sample) => total + sample.durationMs, 0)
  return bytes > 0 && durationMs > 0 ? (bytes * 8 * 1000) / durationMs : undefined
}

function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: Direction
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </div>
      <output
        aria-label={`${label} result`}
        className={`mt-1 block truncate font-mono text-lg font-semibold ${
          tone === 'download'
            ? 'text-[var(--color-wifi)]'
            : tone === 'upload'
              ? 'text-[var(--color-usb)]'
              : 'text-foreground'
        }`}
      >
        {value}
      </output>
    </div>
  )
}

export function SpeedTestDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const sessionRef = useRef<TestSession | null>(null)
  const [status, setStatus] = useState<TestStatus>('ready')
  const [phase, setPhase] = useState<TestPhase>('latency')
  const [metrics, setMetrics] = useState<Metrics>({})
  const [error, setError] = useState<string | null>(null)

  const cancelSession = (session = sessionRef.current): void => {
    if (!session) return
    session.cancelled = true
    session.controller?.abort('Plexo cancelled')
    session.resume?.()
    if (sessionRef.current === session) sessionRef.current = null
  }

  const close = (nextOpen: boolean): void => {
    if (!nextOpen) {
      cancelSession()
      setStatus('ready')
      setPhase('latency')
      setMetrics({})
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  const updateIfCurrent = (session: TestSession, update: () => void): void => {
    if (sessionRef.current === session && !session.cancelled) update()
  }

  const run = async (session: TestSession): Promise<void> => {
    const pingSamples: number[] = []
    updateIfCurrent(session, () => setPhase('latency'))
    for (let index = 0; index < 6; index += 1) {
      const sample = await measureRequest(session, 'download', 0)
      // Ignore the first connection setup so ping is based on a warmed-up route.
      if (index > 0) pingSamples.push(sample.durationMs)
      updateIfCurrent(session, () => {
        setMetrics((previous) => ({
          ...previous,
          ping: median(pingSamples),
          jitter:
            pingSamples.length > 1
              ? pingSamples
                  .slice(1)
                  .reduce((total, value, i) => total + Math.abs(value - pingSamples[i]), 0) /
                (pingSamples.length - 1)
              : undefined
        }))
      })
    }

    for (const direction of ['download', 'upload'] as const) {
      updateIfCurrent(session, () => setPhase(direction))
      const warmup = await measureRequest(session, direction, WARMUP_BYTES)
      const initialSpeed = (warmup.bytes * 8 * 1000) / warmup.durationMs
      const sampleBytes = Math.round(
        Math.min(MAX_SAMPLE_BYTES, Math.max(WARMUP_BYTES, (initialSpeed / 8) * 1.25))
      )
      const samples: Sample[] = []
      for (let index = 0; index < SAMPLES_PER_DIRECTION; index += 1) {
        samples.push(await measureRequest(session, direction, sampleBytes))
        const speed = sampleSpeed(samples)
        updateIfCurrent(session, () =>
          setMetrics((previous) => ({ ...previous, [direction]: speed }))
        )
      }
    }

    updateIfCurrent(session, () => {
      setPhase('complete')
      setStatus('complete')
    })
  }

  const start = (): void => {
    cancelSession()
    const session: TestSession = {
      cancelled: false,
      paused: false,
      pauseGeneration: 0,
      controller: null,
      resume: null
    }
    sessionRef.current = session
    setStatus('running')
    setPhase('latency')
    setMetrics({})
    setError(null)
    void run(session).catch((reason: unknown) => {
      if (session.cancelled || sessionRef.current !== session) return
      setStatus('error')
      setError(
        reason instanceof Error
          ? reason.message
          : 'Cloudflare could not complete the speed test. Check your connection and try again.'
      )
      sessionRef.current = null
    })
  }

  const pauseOrResume = (): void => {
    const session = sessionRef.current
    if (!session) return
    if (!session.paused) {
      session.paused = true
      session.pauseGeneration += 1
      session.controller?.abort('Plexo paused')
      setStatus('paused')
    } else {
      session.paused = false
      session.resume?.()
      setStatus('running')
    }
  }

  const cancel = (): void => {
    cancelSession()
    setStatus('ready')
    setPhase('latency')
    setMetrics({})
    setError(null)
  }

  const displayPhase =
    status === 'complete'
      ? 'Test complete'
      : status === 'paused'
        ? 'Test paused'
        : status === 'error'
          ? 'Test could not finish'
          : status === 'ready'
            ? 'Ready when you are'
            : phase === 'latency'
              ? 'Measuring latency'
              : phase === 'download'
                ? 'Measuring download'
                : 'Measuring upload'

  const mainMetric =
    phase === 'download'
      ? formatSpeed(metrics.download)
      : phase === 'upload'
        ? formatSpeed(metrics.upload)
        : formatLatency(metrics.ping)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto overscroll-contain p-4 sm:p-5">
        <DialogHeader className="pr-7">
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="size-4" /> Plexo internet speed test
          </DialogTitle>
          <DialogDescription>
            A real connection test against Cloudflare&apos;s edge network.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Activity className="size-3.5 text-[var(--color-wifi)]" /> Cloudflare edge
              </div>
              <div className="text-xs text-muted-foreground" aria-live="polite">
                {displayPhase}
              </div>
            </div>
            <div className="mt-7 flex min-h-36 flex-col items-center justify-center gap-3">
              <div className="font-mono text-4xl font-light tabular-nums sm:text-5xl">
                {status === 'ready' || status === 'error' ? '—' : mainMetric}
              </div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {phase === 'download'
                  ? 'Download'
                  : phase === 'upload'
                    ? 'Upload'
                    : phase === 'complete'
                      ? 'Results ready'
                      : 'Latency'}
              </div>
              <div
                className={`h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted ${
                  status === 'running' ? 'opacity-100' : 'opacity-40'
                }`}
                role="progressbar"
                aria-label="Speed test progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  status === 'complete'
                    ? 100
                    : phase === 'upload'
                      ? 70
                      : phase === 'download'
                        ? 35
                        : 5
                }
              >
                <div
                  className={`h-full rounded-full bg-[var(--color-wifi)] transition-[width] duration-500 ${
                    status === 'complete'
                      ? 'w-full'
                      : phase === 'upload'
                        ? 'w-[70%]'
                        : phase === 'download'
                          ? 'w-[35%]'
                          : 'w-[5%]'
                  }`}
                />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {status === 'running' || status === 'paused' ? (
                <>
                  <Button onClick={pauseOrResume}>
                    {status === 'running' ? <Pause /> : <Play />}
                    {status === 'running' ? 'Pause test' : 'Resume test'}
                  </Button>
                  <Button variant="outline" onClick={cancel}>
                    <X /> Cancel
                  </Button>
                </>
              ) : (
                <Button onClick={start}>
                  {status === 'complete' || status === 'error' ? <RotateCcw /> : <Play />}
                  {status === 'complete' || status === 'error' ? 'Run again' : 'Start test'}
                </Button>
              )}
            </div>
            {error && (
              <p className="mt-3 text-center text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            <Metric label="Ping" value={formatLatency(metrics.ping)} />
            <Metric label="Jitter" value={formatJitter(metrics.jitter)} />
            <Metric label="Download" value={formatSpeed(metrics.download)} tone="download" />
            <Metric label="Upload" value={formatSpeed(metrics.upload)} tone="upload" />
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          The test sends and receives data from Cloudflare, which can see your public IP address.
          Plexo does not upload test results. A full run can use up to about 73 MB; pause other
          downloads for the most accurate reading.
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Interface inspired by Silizium by TechnoHoschi (MIT).</span>
          <a
            href="https://github.com/TechnoHoschi/openspeedtest-openwrt"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Source project
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
