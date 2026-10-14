import { Gauge, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

const OPEN_SPEED_TEST_URL = 'https://openspeedtest.com/speedtest'

export function SpeedTestDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) setLoaded(false)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-3xl gap-3 p-4 sm:p-5">
        <DialogHeader className="pr-7">
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="size-4" /> Internet speed test
          </DialogTitle>
          <DialogDescription>
            OpenSpeedTest measures latency, download speed, and upload speed.
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-6 text-center">
            <p className="max-w-lg text-sm text-muted-foreground">
              Loading the test connects to OpenSpeedTest&apos;s servers. It transfers test data in
              both directions. Pause Plexo downloads first for a more accurate result.
            </p>
            <Button onClick={() => setLoaded(true)}>
              <Gauge /> Load speed test
            </Button>
          </div>
        ) : (
          <iframe
            key="openspeedtest"
            title="OpenSpeedTest internet speed test"
            src={OPEN_SPEED_TEST_URL}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            className="h-[min(55vh,440px)] min-h-72 w-full rounded-lg border border-border bg-white"
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Provided by OpenSpeedTest.com</span>
          <a
            href="https://openspeedtest.com/speedtest"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            OpenSpeedTest details <ExternalLink className="size-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
