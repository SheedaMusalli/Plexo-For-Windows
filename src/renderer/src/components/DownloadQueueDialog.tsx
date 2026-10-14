import type { QueuedDownload } from '@shared/types'
import { CalendarClock, Clock3, ListPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { useAppStore } from '../store/useAppStore'

export function DownloadQueueDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const destinationDir = useAppStore((store) => store.destinationDir)
  const [urls, setUrls] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [queue, setQueue] = useState<QueuedDownload[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void window.plexo.getQueuedDownloads().then((items) => mounted && setQueue(items))
    const unsubscribe = window.plexo.onDownloadQueueChanged(setQueue)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const parsedUrls = useMemo(
    () =>
      urls
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    [urls]
  )

  const addToQueue = async (): Promise<void> => {
    setError(null)
    if (parsedUrls.length === 0) {
      setError('Paste one or more download links, one per line.')
      return
    }
    if (parsedUrls.length > 50) {
      setError('Add up to 50 links at a time.')
      return
    }
    let scheduledAt: number | null = null
    if (scheduledFor) {
      scheduledAt = new Date(scheduledFor).getTime()
      if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
        setError('Choose a date and time in the future.')
        return
      }
    }
    setBusy(true)
    try {
      await window.plexo.queueDownloads(parsedUrls, destinationDir, scheduledAt)
      setUrls('')
      setScheduledFor('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add these links to the queue.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string): Promise<void> => {
    setError(null)
    try {
      await window.plexo.cancelQueuedDownload(id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this queued download.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-2 p-5 pb-4">
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
            <ListPlus className="size-3.5 text-primary" />
            Plexo queue
          </div>
          <DialogTitle className="text-base">Schedule and batch downloads</DialogTitle>
          <DialogDescription>
            Add links one per line. Plexo downloads them in order, one at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4">
          <label className="block space-y-1.5">
            <span className="font-mono text-[9px] tracking-[0.13em] text-muted-foreground uppercase">
              Download links
            </span>
            <textarea
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder={'https://example.com/file.zip\nhttps://example.com/video.mp4'}
              rows={4}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="font-mono text-[9px] tracking-[0.13em] text-muted-foreground uppercase">
              Start at (optional)
            </span>
            <div className="relative">
              <CalendarClock className="pointer-events-none absolute top-2 left-3 size-4 text-muted-foreground" />
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 font-mono text-[11px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </div>
          </label>

          <div className="text-[10px] text-muted-foreground">
            {parsedUrls.length} {parsedUrls.length === 1 ? 'link' : 'links'} · saved to{' '}
            <span className="break-all text-foreground">{destinationDir}</span>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
              Waiting ({queue.length})
            </div>
            {queue.length > 0 && (
              <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
                <Clock3 className="size-3" /> Serial queue
              </span>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No queued downloads.</p>
          ) : (
            <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
              {queue.map((item, index) => (
                <div
                  key={item.id}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2"
                >
                  <span className="size-5 shrink-0 rounded-full bg-muted text-center font-mono text-[10px] leading-5 text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{item.fileName}</div>
                    <div
                      className={`truncate font-mono text-[9px] ${item.error ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {item.error ||
                        (item.scheduledAt
                          ? `Starts ${new Date(item.scheduledAt).toLocaleString()}`
                          : item.url)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Cancel ${item.fileName}`}
                    title="Cancel queued download"
                    onClick={() => void cancel(item.id)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 px-5 py-3">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            disabled={busy || parsedUrls.length === 0}
            onClick={() => void addToQueue()}
          >
            <ListPlus data-icon="inline-start" />
            {busy ? 'Adding…' : 'Add to queue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
