import { useEffect, useState } from 'react'
import { read, key, type Entry } from '../history'
import { Button } from '../components/ui/button'

const size = (bytes: number): string => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '—')
export function HistoryScreen({
  onAdd,
  onQueue,
  onRetry
}: {
  onAdd: () => void
  onQueue: () => void
  onRetry: (url: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState(read)
  const [filter, setFilter] = useState('All downloads')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Entry | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [properties, setProperties] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [])
  const action = async (kind: 'open' | 'folder'): Promise<void> => {
    if (!selected) return
    try {
      await (kind === 'open'
        ? window.plexo.openFile(selected.destinationPath)
        : window.plexo.revealInFolder(selected.destinationPath))
    } catch (e) {
      setError(String(e))
    }
  }
  const rows = entries.filter(
    (entry) =>
      entry.fileName.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All downloads' ||
        (filter === 'Finished' ? entry.status === 'completed' : entry.status !== 'completed'))
  )
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Button onClick={onAdd}>+ Add URL</Button>
        <Button variant="outline" onClick={onQueue}>
          Queue & schedule
        </Button>
        <input
          aria-label="Search downloads"
          placeholder="Search downloads…"
          className="ml-auto min-w-0 rounded-md border border-border bg-card px-3 py-2 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-40 shrink-0 border-r border-border bg-card p-3">
          <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">Library</p>
          {['All downloads', 'Finished', 'Unfinished'].map((label) => (
            <button
              key={label}
              onClick={() => setFilter(label)}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${filter === label ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>
                {['File name', 'Size', 'Status', 'Added'].map((label) => (
                  <th className="border-b border-border p-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  onClick={() => setSelected(entry)}
                  onDoubleClick={() => {
                    setSelected(entry)
                    setProperties(true)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setSelected(entry)
                    setMenu({
                      x: Math.min(event.clientX, window.innerWidth - 210),
                      y: Math.min(event.clientY, window.innerHeight - 240)
                    })
                  }}
                  className={`cursor-default border-b border-border ${selected?.id === entry.id ? 'bg-secondary' : 'hover:bg-card'}`}
                >
                  <td className="max-w-72 truncate p-3" title={entry.fileName}>
                    {entry.fileName}
                  </td>
                  <td className="whitespace-nowrap p-3 font-mono text-xs">
                    {size(entry.totalBytes)}
                  </td>
                  <td className="p-3 capitalize">{entry.status}</td>
                  <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                    {new Date(entry.startedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">
              <p>No downloads here yet</p>
              <p className="mt-2 text-sm">Add a URL or send a download from your browser.</p>
            </div>
          )}
        </div>
      </div>
      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {rows.length} downloads · Right-click a download for actions
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </footer>
      {menu && selected && (
        <div
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 w-52 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {[
            ['Open file', () => void action('open'), selected.status !== 'completed'],
            ['Open folder', () => void action('folder'), false],
            ['Download again', () => onRetry(selected.url), false],
            ['Properties', () => setProperties(true), false],
            [
              'Remove from history',
              () => {
                const next = entries.filter((e) => e.id !== selected.id)
                localStorage.setItem(key, JSON.stringify(next))
                setEntries(next)
                setSelected(null)
              },
              false
            ]
          ].map(([label, callback, disabled]) => (
            <button
              role="menuitem"
              key={String(label)}
              disabled={Boolean(disabled)}
              onClick={callback as () => void}
              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-secondary disabled:opacity-40"
            >
              {String(label)}
            </button>
          ))}
        </div>
      )}
      {properties && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setProperties(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Download properties"
            className="mx-6 w-full max-w-lg rounded-xl border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">Download properties</h2>
            <dl className="space-y-3 text-sm">
              {Object.entries({
                File: selected.fileName,
                Status: selected.status,
                Size: size(selected.totalBytes),
                Downloaded: size(selected.bytesDownloaded),
                Location: selected.destinationPath,
                URL: selected.url,
                Added: new Date(selected.startedAt).toLocaleString()
              }).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="break-all select-text">{value}</dd>
                </div>
              ))}
            </dl>
            <Button className="mt-5" onClick={() => setProperties(false)}>
              Close
            </Button>
          </section>
        </div>
      )}
    </div>
  )
}
