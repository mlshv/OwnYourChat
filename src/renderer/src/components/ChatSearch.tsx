import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { findTextRanges } from '../lib/find-text-ranges'
import { Button } from './ui/button'

interface ChatSearchProps {
  children: ReactNode
  hasMore: boolean
  loading: boolean
  onLoadMore?: () => void | Promise<void>
  onClose: () => void
}

// Search the rendered text, including words split by Markdown emphasis/links.
// A non-virtualized view keeps every loaded match available for highlighting.
export function ChatSearch({ children, hasMore, loading, onLoadMore, onClose }: ChatSearchProps) {
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [active, setActive] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const requesting = useRef(false)

  useEffect(() => {
    input.current?.focus()
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    if (!hasMore || loading || !onLoadMore || loadError || requesting.current) return
    requesting.current = true
    Promise.resolve()
      .then(onLoadMore)
      .catch(() => setLoadError(true))
      .finally(() => {
        requesting.current = false
      })
  }, [hasMore, loading, onLoadMore, loadError])

  useEffect(() => {
    if (!container.current) return
    const found = findTextRanges(container.current, query)
    setRanges(found)
    setActive(0)
    CSS.highlights.set('chat-search', new Highlight(...found))
    return () => {
      CSS.highlights.delete('chat-search')
      CSS.highlights.delete('chat-search-active')
    }
  }, [query, children])

  useEffect(() => {
    const range = ranges[active]
    CSS.highlights.set('chat-search-active', new Highlight(...(range ? [range] : [])))
    const pane = container.current
    if (!range || !pane) return
    const rect = range.getBoundingClientRect()
    const bounds = pane.getBoundingClientRect()
    pane.scrollBy({ top: rect.top - bounds.top - pane.clientHeight / 2 + rect.height / 2 })
  }, [active, ranges])

  const move = useCallback(
    (direction: number) => {
      setActive((index) =>
        ranges.length ? (index + direction + ranges.length) % ranges.length : 0
      )
    },
    [ranges.length]
  )

  return (
    <>
      <div
        className="flex items-center gap-2 px-4 py-2 border-b"
        role="search"
        aria-label="Search this conversation"
      >
        <input
          ref={input}
          type="search"
          aria-label="Find in conversation"
          placeholder="Find in this branch…"
          className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm bg-transparent"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              move(event.shiftKey ? -1 : 1)
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          }}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap" role="status">
          {(hasMore || loading) && !loadError
            ? 'Loading history…'
            : query
              ? ranges.length
                ? `${active + 1} / ${ranges.length}`
                : 'No matches'
              : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!ranges.length}
          onClick={() => move(-1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={!ranges.length}
          onClick={() => move(1)}
        >
          ↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close conversation search"
          title="Close (Escape)"
          onClick={onClose}
        >
          ×
        </Button>
      </div>
      {loadError && (
        <div className="px-4 py-2 text-sm" role="alert">
          Could not load older messages. Results cover loaded messages only.{' '}
          <button className="underline" onClick={() => setLoadError(false)}>
            Retry
          </button>
        </div>
      )}
      <div ref={container} className="flex-1 min-h-0 overflow-auto px-4">
        {children}
      </div>
    </>
  )
}
