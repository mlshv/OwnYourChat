'use client'

import { memo, useState, useMemo } from 'react'
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'

interface SourcesListProps {
  references: {
    matched_text: string
    type: 'webpage' | 'webpage_extended' | 'image_inline'
    title?: string
    url?: string
    snippet?: string
    attribution?: string
  }[]
}

interface UniqueSource {
  url: string
  title: string
  attribution: string
}

export const SourcesList = memo(function SourcesList({ references }: SourcesListProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Get unique sources by URL
  const uniqueSources = useMemo(() => {
    const seen = new Map<string, UniqueSource>()
    for (const ref of references) {
      if (ref.url && !seen.has(ref.url)) {
        seen.set(ref.url, {
          url: ref.url,
          title: ref.title || ref.attribution || new URL(ref.url).hostname,
          attribution: ref.attribution || new URL(ref.url).hostname
        })
      }
    }
    return Array.from(seen.values())
  }, [references])

  if (uniqueSources.length === 0) return null

  const handleSourceClick = async (url: string) => {
    await window.api?.shell.openExternal(url)
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground active:text-foreground"
      >
        {isExpanded ? <CaretUpIcon className="h-4 w-4" /> : <CaretDownIcon className="h-4 w-4" />}
        <span className="font-medium">Sources ({uniqueSources.length})</span>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {uniqueSources.map((source, index) => (
            <button
              key={index}
              onClick={() => handleSourceClick(source.url)}
              className="flex items-start gap-2 w-full text-left px-4 py-2 rounded-lg bg-muted/50 hover:bg-accent active:bg-accent cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground line-clamp-1">{source.title}</div>
                <div className="text-xs text-muted-foreground truncate">{source.attribution}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
