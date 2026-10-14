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
  pauseStartedAt: number | null
  pausedTotalMs: number
  controllers: Set<AbortController>
  resume: (() => void) | null
}

const WARMUP_BYTES = 250_000
const STREAMS_PER_SAMPLE = 4
const MAX_BYTES_PER_STREAM = 8_000_000
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

function getUploadPayload(bytes: number): string {
  let payload = uploadPayloads.get(bytes)
  if (!payload) {
    payload = '0'.repeat(bytes)
    uploadPayloads.set(bytes, payload)
  }
  return payload
}

function activeElapsedMs(session: TestSession, startedAt: number, pausedAtStart: number): number {
  const now = performance.now()
  const pausedDuringSample =
    session.pausedTotalMs -
    pausedAtStart +
    (session.pauseStartedAt === null ? 0 : now - session.pauseStartedAt)
  return Math.max(0, now - startedAt - pausedDuringSample)
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
    session.controllers.add(controller)
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
      // Measure the complete network operation. Server-Timing describes work inside
      // Cloudflare and cannot be subtracted from elapsed time to estimate bandwidth.
      const durationMs = Math.max(1, elapsedMs)
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
      session.controllers.delete(controller)
    }
  }
}

async function measureParallelSample(
  session: TestSession,
  direction: Direction,
  bytesPerStream: number
): Promise<Sample> {
  const startedAt = performance.now()
  const pausedAtStart = session.pausedTotalMs
  const samples = await Promise.all(
    Array.from({ length: STREAMS_PER_SAMPLE }, () =>
      measureRequest(session, direction, bytesPerStream)
    )
  )
  return {
    bytes: samples.reduce((total, sample) => total + sample.bytes, 0),
    // Requests overlap, so use wall time for the group instead of summing durations.
    durationMs: Math.max(1, activeElapsedMs(session, startedAt, pausedAtStart))
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
  const [durationSeconds, setDurationSeconds] = useState(20)
  const [progress, setProgress] = useState(0)

  const cancelSession = (session = sessionRef.current): void => {
    if (!session) return
    session.cancelled = true
    session.controllers.forEach((controller) => controller.abort('Plexo cancelled'))
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
      setProgress(0)
    }
    onOpenChange(nextOpen)
  }

  const updateIfCurrent = (session: TestSession, update: () => void): void => {
    if (sessionRef.current === session && !session.cancelled) update()
  }

  const run = async (session: TestSession, totalDurationSeconds: number): Promise<void> => {
    const pingSamples: number[] = []
    updateIfCurrent(session, () => setPhase('latency'))
    for (let index = 0; index < 6; index += 1) {
      const sample = await measureRequest(session, 'download', 0)
      // Ignore the first connection setup so ping is based on a warmed-up route.
      if (index > 0) pingSamples.push(sample.durationMs)
      updateIfCurrent(session, () => {
        setProgress(((index + 1) / 6) * 10)
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

    const directionDurationMs = (totalDurationSeconds * 1000) / 2
    for (const [directionIndex, direction] of (['download', 'upload'] as const).entries()) {
      const progressStart = directionIndex === 0 ? 10 : 55
      const progressSpan = 45
      updateIfCurrent(session, () => {
        setPhase(direction)
        setProgress(progressStart)
      })
      const warmup = await measureRequest(session, direction, WARMUP_BYTES)
      const initialSpeed = (warmup.bytes * 8 * 1000) / warmup.durationMs
      // Four simultaneous requests use the available bandwidth more effectively than
      // one short request. Size each stream for roughly a second of the warm-up rate,
      // with a strict per-stream cap to keep the test's data use bounded.
      let sampleBytes = Math.round(
        Math.min(
          MAX_BYTES_PER_STREAM,
          Math.max(WARMUP_BYTES, initialSpeed / 8 / STREAMS_PER_SAMPLE)
        )
      )
      const samples: Sample[] = []
      const directionStartedAt = performance.now()
      const pausedAtDirectionStart = session.pausedTotalMs
      while (
        activeElapsedMs(session, directionStartedAt, pausedAtDirectionStart) < directionDurationMs
      ) {
        samples.push(await measureParallelSample(session, direction, sampleBytes))
        const speed = sampleSpeed(samples)
        updateIfCurrent(session, () => {
          const elapsed = activeElapsedMs(session, directionStartedAt, pausedAtDirectionStart)
          setProgress(progressStart + Math.min(1, elapsed / directionDurationMs) * progressSpan)
          setMetrics((previous) => ({ ...previous, [direction]: speed }))
        })
        if (speed) {
          sampleBytes = Math.round(
            Math.min(MAX_BYTES_PER_STREAM, Math.max(WARMUP_BYTES, speed / 8 / STREAMS_PER_SAMPLE))
          )
        }
      }
    }

    updateIfCurrent(session, () => {
      setPhase('complete')
      setStatus('complete')
      setProgress(100)
    })
  }

  const start = (): void => {
    cancelSession()
    const session: TestSession = {
      cancelled: false,
      paused: false,
      pauseGeneration: 0,
      pauseStartedAt: null,
      pausedTotalMs: 0,
      controllers: new Set(),
      resume: null
    }
    sessionRef.current = session
    setStatus('running')
    setPhase('latency')
    setMetrics({})
    setError(null)
    setProgress(0)
    void run(session, durationSeconds).catch((reason: unknown) => {
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
      session.pauseStartedAt = performance.now()
      session.controllers.forEach((controller) => controller.abort('Plexo paused'))
      setStatus('paused')
    } else {
      session.paused = false
      if (session.pauseStartedAt !== null) {
        session.pausedTotalMs += performance.now() - session.pauseStartedAt
        session.pauseStartedAt = null
      }
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
    setProgress(0)
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
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 p-3">
              <div>
                <div className="text-sm font-medium">Measurement duration</div>
                <div className="text-xs text-muted-foreground">
                  Split evenly between download and upload
                </div>
              </div>
              <select
                aria-label="Speed test duration"
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                disabled={status === 'running' || status === 'paused'}
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
              >
                <option value={10}>10 seconds</option>
                <option value={20}>20 seconds</option>
                <option value={30}>30 seconds</option>
              </select>
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
                aria-valuenow={Math.round(progress)}
              >
                <div
                  className="h-full rounded-full bg-[var(--color-wifi)] transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
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
          Plexo does not upload test results. Longer tests transfer more data; usage varies with
          your connection speed and selected duration. Pause other downloads for the most accurate
          reading.
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
