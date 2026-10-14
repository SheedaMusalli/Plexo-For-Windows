import SpeedTest, { type MeasurementSummary } from '@cloudflare/speedtest'
import { Activity, Gauge, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

type TestStatus = 'ready' | 'running' | 'paused' | 'complete' | 'error'
type TestPhase = 'latency' | 'download' | 'upload' | 'complete'

const TEST_MEASUREMENTS = [
  { type: 'latency', numPackets: 10 },
  { type: 'download', bytes: 100_000, count: 3, bypassMinDuration: true },
  { type: 'download', bytes: 1_000_000, count: 3 },
  { type: 'download', bytes: 10_000_000, count: 3 },
  { type: 'download', bytes: 25_000_000, count: 2 },
  { type: 'latency', numPackets: 10 },
  { type: 'upload', bytes: 100_000, count: 3, bypassMinDuration: true },
  { type: 'upload', bytes: 1_000_000, count: 3 },
  { type: 'upload', bytes: 10_000_000, count: 3 },
  { type: 'upload', bytes: 25_000_000, count: 2 }
] as const

function formatSpeed(bitsPerSecond: number | undefined): string {
  if (bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return '—'
  const mbps = bitsPerSecond / 1_000_000
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(2)} Gbps` : `${mbps.toFixed(1)} Mbps`
}

function formatLatency(milliseconds: number | undefined): string {
  return milliseconds === undefined || !Number.isFinite(milliseconds)
    ? '—'
    : `${Math.round(milliseconds)} ms`
}

function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'download' | 'upload'
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-lg font-semibold ${
          tone === 'download'
            ? 'text-[var(--color-wifi)]'
            : tone === 'upload'
              ? 'text-[var(--color-usb)]'
              : 'text-foreground'
        }`}
      >
        {value}
      </div>
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
  const engineRef = useRef<SpeedTest | null>(null)
  const [status, setStatus] = useState<TestStatus>('ready')
  const [phase, setPhase] = useState<TestPhase>('latency')
  const [metrics, setMetrics] = useState<MeasurementSummary>({})
  const [error, setError] = useState<string | null>(null)

  const close = (nextOpen: boolean): void => {
    if (!nextOpen) {
      engineRef.current?.pause()
      engineRef.current = null
      setStatus('ready')
      setPhase('latency')
      setMetrics({})
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  const start = (): void => {
    engineRef.current?.pause()
    setStatus('running')
    setPhase('latency')
    setMetrics({})
    setError(null)

    const engine = new SpeedTest({
      autoStart: false,
      logMeasurementApiUrl: null,
      logAimApiUrl: null,
      measurements: [...TEST_MEASUREMENTS],
      measureDownloadLoadedLatency: true,
      measureUploadLoadedLatency: true
    })
    engineRef.current = engine

    engine.onPhaseChange = ({ measurement }) => {
      if (engineRef.current !== engine) return
      if (measurement.type === 'latency') setPhase('latency')
      else if (measurement.type === 'download') setPhase('download')
      else if (measurement.type === 'upload') setPhase('upload')
    }
    engine.onResultsChange = () => {
      if (engineRef.current === engine) setMetrics(engine.results.getSummary())
    }
    engine.onRunningChange = (running) => {
      if (engineRef.current === engine) setStatus(running ? 'running' : 'paused')
    }
    engine.onFinish = (results) => {
      if (engineRef.current !== engine) return
      setMetrics(results.getSummary())
      setPhase('complete')
      setStatus('complete')
      engineRef.current = null
    }
    engine.onError = () => {
      if (engineRef.current !== engine) return
      setError('Cloudflare could not complete the speed test. Check your connection and try again.')
      setStatus('error')
      engineRef.current = null
    }
    engine.play()
  }

  const pauseOrResume = (): void => {
    if (status === 'running') engineRef.current?.pause()
    else if (status === 'paused') engineRef.current?.play()
  }

  const cancel = (): void => {
    engineRef.current?.pause()
    engineRef.current = null
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
        : formatLatency(metrics.latency)

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
            <Metric label="Ping" value={formatLatency(metrics.latency)} />
            <Metric label="Jitter" value={formatLatency(metrics.jitter)} />
            <Metric label="Download" value={formatSpeed(metrics.download)} tone="download" />
            <Metric label="Upload" value={formatSpeed(metrics.upload)} tone="upload" />
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          The test sends and receives data from Cloudflare, which can see your public IP address.
          Plexo does not upload test results. A full run can use up to about 167 MB; pause other
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
