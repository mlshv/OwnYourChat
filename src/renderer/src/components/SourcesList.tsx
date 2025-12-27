'use client'

import { memo, useState, useMemo } from 'react'
import { CaretDownIcon, CaretUpIcon, LinkIcon } from '@phosphor-icons/react'

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
    <div className="mt-4 border-t border-b3 pt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-f2 hover:text-f1 active:text-f1"
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
              className="flex items-start gap-2 w-full text-left p-2 rounded-lg bg-b2 hover:bg-b3 active:bg-b3 cursor-pointer"
            >
              <LinkIcon className="h-4 w-4 mt-0.5 text-f3 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-f1 line-clamp-1">{source.title}</div>
                <div className="text-xs text-f3 truncate">{source.attribution}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
