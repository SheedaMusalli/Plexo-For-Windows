import { Settings2, FolderOpen, Palette, RefreshCw, ListPlus, Gauge } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

export function SettingsDialog({
  open,
  onOpenChange,
  onOpenQueue,
  onOpenSpeedTest
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenQueue: () => void
  onOpenSpeedTest: () => void
}): React.JSX.Element {
  const destinationDir = useAppStore((s) => s.destinationDir)
  const downloadsDir = useAppStore((s) => s.downloadsDir)
  const theme = useAppStore((s) => s.themeSource)
  const setTheme = useAppStore((s) => s.setThemeSource)
  const checkForUpdate = useAppStore((s) => s.checkForUpdate)
  const chooseFolder = async (): Promise<void> => {
    const chosen = await window.plexo.chooseDestinationFolder(destinationDir || downloadsDir)
    if (chosen) useAppStore.getState().setDestinationDir(chosen)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" /> Plexo settings
          </DialogTitle>
        </DialogHeader>
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Downloads
          </h3>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium">Default save location</div>
            <div className="mb-3 break-all text-xs text-muted-foreground">{destinationDir}</div>
            <Button variant="outline" size="sm" onClick={() => void chooseFolder()}>
              <FolderOpen /> Change folder
            </Button>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium">Queue and scheduling</div>
            <p className="mb-3 text-xs text-muted-foreground">
              Add multiple links and schedule or download them one at a time.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false)
                onOpenQueue()
              }}
            >
              <ListPlus /> Open download queue
            </Button>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium">Internet speed test</div>
            <p className="mb-3 text-xs text-muted-foreground">
              Measure ping, download, and upload speeds with OpenSpeedTest.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false)
                onOpenSpeedTest()
              }}
            >
              <Gauge /> Test internet speed
            </Button>
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Appearance and updates
          </h3>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="flex items-center gap-2 text-sm">
              <Palette className="size-4" /> Theme
            </span>
            <select
              aria-label="Theme"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-sm font-medium">Software updates</div>
            <p className="mb-3 text-xs text-muted-foreground">
              Plexo checks GitHub at startup, when restored, and every six hours.
            </p>
            <Button variant="outline" size="sm" onClick={() => void checkForUpdate()}>
              <RefreshCw /> Check now
            </Button>
          </div>
        </section>
        <p className="text-xs text-muted-foreground">
          Download confirmation appears before browser downloads. Network controls and stream counts
          are available while preparing each download.
        </p>
      </DialogContent>
    </Dialog>
  )
}
