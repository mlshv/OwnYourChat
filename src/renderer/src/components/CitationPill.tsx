'use client'

import { memo } from 'react'
import type { SourceUrlPart } from '@shared/types'
import { isWebSourceUrl } from '../../../shared/citations'

interface CitationPillProps {
  reference: Partial<Pick<SourceUrlPart, 'url' | 'title' | 'attribution'>>
}

export const CitationPill = memo(function CitationPill({ reference }: CitationPillProps) {
  const url = isWebSourceUrl(reference.url) ? reference.url : undefined
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (url) {
      await window.api?.shell.openExternal(url)
    }
  }

  // Get display text - prefer attribution (domain), fall back to extracting from URL
  const displayText = reference.attribution || (url ? new URL(url).hostname : 'Source unavailable')

  if (!url) {
    return (
      <span
        className="text-xs text-muted-foreground ms-1"
        title="Source URL was not saved. Reopen this conversation while connected to refresh its sources."
      >
        [Source unavailable]
      </span>
    )
  }

  return (
    <a
      href={url}
      title={reference.title || url}
      onClick={handleClick}
      className="inline-flex h-[18px] overflow-hidden rounded-xl px-2 text-[9px] font-medium text-muted-foreground bg-accent hover:bg-accent active:bg-accent cursor-pointer items-center ms-1 top-[-0.094rem] relative"
    >
      <span className="max-w-[15ch] truncate text-center">{displayText}</span>
    </a>
  )
})
