'use client'

import { memo } from 'react'

interface CitationPillProps {
  reference: {
    matched_text: string
    type: 'webpage' | 'webpage_extended' | 'image_inline'
    title?: string
    url?: string
    snippet?: string
    attribution?: string
  }
}

export const CitationPill = memo(function CitationPill({ reference }: CitationPillProps) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (reference.url) {
      await window.api?.shell.openExternal(reference.url)
    }
  }

  // Get display text - prefer attribution (domain), fall back to extracting from URL
  const displayText =
    reference.attribution || (reference.url ? new URL(reference.url).hostname : 'source')

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
      className="inline-flex h-[18px] overflow-hidden rounded-xl px-2 text-[9px] font-medium text-muted-foreground bg-accent hover:bg-accent active:bg-accent cursor-pointer items-center ms-1 top-[-0.094rem] relative"
    >
      <span className="max-w-[15ch] truncate text-center">{displayText}</span>
    </span>
  )
})
