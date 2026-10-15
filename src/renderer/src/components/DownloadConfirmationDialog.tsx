import type { DownloadConfirmationRequest } from '@shared/types'
import { Download, FolderOpen, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

export function DownloadConfirmationDialog(): React.JSX.Element {
  const [request, setRequest] = useState<DownloadConfirmationRequest | null>(null)
  const [destinationDir, setDestinationDir] = useState('')
  const [temporaryDir, setTemporaryDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resolving = useRef(false)

  const respond = useCallback(
    async (accepted: boolean): Promise<void> => {
      if (!request || resolving.current) return
      resolving.current = true
      try {
        await window.plexo.respondDownloadConfirmation(
          request.requestId,
          accepted ? { accepted, destinationDir, temporaryDir } : { accepted }
        )
        setRequest(null)
        setError(null)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Plexo could not answer the request.')
      } finally {
        resolving.current = false
      }
    },
    [request, destinationDir, temporaryDir]
  )

  const chooseFolder = async (kind: 'destination' | 'temporary'): Promise<void> => {
    const current = kind === 'destination' ? destinationDir : temporaryDir
    try {
      const chosen = await window.plexo.chooseDestinationFolder(current)
      if (!chosen) return
      if (kind === 'destination') setDestinationDir(chosen)
      else setTemporaryDir(chosen)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Plexo could not choose that folder.')
    }
  }

  useEffect(
    () =>
      window.plexo.onDownloadConfirmation((next) => {
        resolving.current = false
        setError(null)
        setRequest(next)
        setDestinationDir(next.defaultDestinationDir)
        setTemporaryDir(next.defaultTemporaryDir)
      }),
    []
  )

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-3rem)] max-w-[500px] gap-0 overflow-x-hidden overflow-y-auto p-0"
      >
        <DialogHeader className="gap-2 p-5 pb-4">
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5 text-primary" />
            Plexo download
          </div>
          <DialogTitle className="pr-5 text-base">Download this file?</DialogTitle>
          <DialogDescription>
            Review the file before Plexo starts transferring it.
          </DialogDescription>
        </DialogHeader>
        <div className="mx-5 mb-5 min-w-0 rounded-lg border border-border bg-background/60 p-3">
          <div className="max-h-16 overflow-y-auto break-all font-sans text-[13px] leading-relaxed font-semibold text-foreground">
            {request?.fileName}
          </div>
          <div className="mt-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
            {request?.details}
          </div>
        </div>
        <div className="mx-5 mb-4 grid min-w-0 gap-3">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="mb-1 text-xs font-medium">Save file to</div>
            <div className="mb-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
              {destinationDir}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void chooseFolder('destination')}
            >
              <FolderOpen data-icon="inline-start" /> Change file location
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="mb-1 text-xs font-medium">Temporary download data</div>
            <div className="mb-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
              Partial download data is kept here until the file is complete.
              <br />
              {temporaryDir}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void chooseFolder('temporary')}
            >
              <FolderOpen data-icon="inline-start" /> Change temp folder
            </Button>
          </div>
        </div>
        {error && (
          <div role="alert" className="mx-5 mb-4 text-xs text-destructive">
            {error}
          </div>
        )}
        <DialogFooter className="-mx-0 -mb-0 rounded-b-xl px-5 py-3">
          <Button
            type="button"
            variant="secondary"
            disabled={!request}
            onClick={() => void respond(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!request} onClick={() => void respond(true)}>
            <Download data-icon="inline-start" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
