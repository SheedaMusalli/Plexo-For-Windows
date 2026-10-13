import { ColorBadge } from './ColorBadge'
import { ThemeToggle } from './ThemeToggle'
import { UpdateIndicator } from './UpdateIndicator'
import { Button } from './ui/button'
import { ListPlus, PanelBottomClose } from 'lucide-react'

export type TitleBarStatus =
  | { kind: 'none' }
  | { kind: 'combined'; networkCount: number }
  | { kind: 'paused'; networkCount: number }
  | { kind: 'offline' }

const isMac = window.plexo.platform === 'darwin'

const pillClass =
  'h-auto flex items-center gap-[7px] rounded-full px-2.5 py-1 font-mono text-[10px] leading-none font-semibold tracking-[0.08em] uppercase whitespace-nowrap'
const pillDotClass = 'size-1.5 shrink-0 rounded-full'

export function TitleBar({
  status,
  queueCount,
  onOpenQueue
}: {
  status: TitleBarStatus
  queueCount: number
  onOpenQueue: () => void
}): React.JSX.Element {
  const dimmed = status.kind === 'offline'

  return (
    <div
      className={`flex h-11 shrink-0 items-center gap-[13px] border-b-[0.5px] border-border bg-card pr-3.5 [-webkit-app-region:drag] ${
        // Real traffic lights are inset here on macOS (see main/index.ts, trafficLightPosition) —
        // 16px inset + ~52px cluster width + a clear ~26px gap before our own content starts.
        isMac ? 'pl-[94px]' : 'pl-3.5'
      }`}
    >
      <div
        // Matches the "LOCKUP · horizontal" wordmark spec from the final icon design.
        className={`font-sans text-[13px] leading-none font-bold tracking-[-0.02em] ${
          dimmed ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        Plexo
      </div>
      <div className="flex-1" />
      {status.kind === 'combined' && (
        <ColorBadge
          bg="var(--color-wifi-bg)"
          border="var(--color-wifi-border)"
          text="var(--color-wifi-text)"
          className={pillClass}
        >
          <div
            className={`${pillDotClass} bg-[var(--color-wifi)] animate-[plexo-glow_2s_ease-in-out_infinite]`}
          />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} combined
        </ColorBadge>
      )}
      {status.kind === 'paused' && (
        <ColorBadge
          bg="var(--color-usb-bg)"
          border="var(--color-usb-border)"
          text="var(--color-usb-text)"
          className={pillClass}
        >
          <div className={`${pillDotClass} bg-[var(--color-usb)]`} />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} · Paused
        </ColorBadge>
      )}
      {status.kind === 'offline' && (
        <ColorBadge
          bg="var(--color-danger-bg)"
          border="var(--color-danger-border)"
          text="var(--color-danger)"
          className={pillClass}
        >
          <div className={`${pillDotClass} bg-[var(--color-danger)]`} />
          Offline
        </ColorBadge>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-[11px] [-webkit-app-region:no-drag]"
        onClick={onOpenQueue}
        aria-label={`Open download queue${queueCount ? `, ${queueCount} waiting` : ''}`}
      >
        <ListPlus className="size-3.5" />
        Queue
        {queueCount > 0 && (
          <span className="font-mono text-[9px] text-muted-foreground">{queueCount}</span>
        )}
      </Button>
      <div className="hidden font-mono text-[9px] text-muted-foreground sm:block">
        Made by Sheeda Musalli
      </div>
      <UpdateIndicator />
      {window.plexo.platform === 'win32' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-[26px] shrink-0 [-webkit-app-region:no-drag]"
          onClick={() => void window.plexo.minimizeToTray()}
          aria-label="Minimize Plexo to tray"
          title="Minimize to tray"
        >
          <PanelBottomClose className="size-3.5" />
        </Button>
      )}
      <ThemeToggle />
    </div>
  )
}
