import crypto from 'crypto'
import type { MessagePart } from '@shared/types'

export interface PerplexityWebResult {
  name: string
  url: string
  snippet?: string
  meta_data?: {
    citation_domain_name?: string
  }
}

export interface PerplexityMessageInput {
  markdown: string
  webResults?: PerplexityWebResult[]
}

export function transformPerplexityMessageToParts(input: PerplexityMessageInput): MessagePart[] {
  const { markdown, webResults } = input

  if (!webResults || webResults.length === 0) {
    return [{ type: 'text', text: markdown }]
  }

  const parts: MessagePart[] = []

  // Regex to match one or more consecutive citations, optionally followed by punctuation
  // Pattern: optional space + citations + optional punctuation
  // Captures: (space?)(citations)(punctuation?)
  const CITATION_GROUP_REGEX = /( ?)((?:\[\d+\](?!\())+)([.,!?])?/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  CITATION_GROUP_REGEX.lastIndex = 0

  while ((match = CITATION_GROUP_REGEX.exec(markdown)) !== null) {
    const spaceBefore = match[1]
    const citationGroup = match[2]
    const punctuationAfter = match[3] || ''
    const startIndex = match.index

    // Add text before citation group
    if (startIndex > lastIndex) {
      let textContent = markdown.slice(lastIndex, startIndex)
      // If there's a space before citations and punctuation after, add punctuation to text
      if (spaceBefore && punctuationAfter) {
        textContent += punctuationAfter
      }
      if (textContent) {
        parts.push({ type: 'text', text: textContent })
      }
    }

    // Extract individual citations from the group
    const INDIVIDUAL_CITATION_REGEX = /\[(\d+)\]/g
    let citationMatch: RegExpExecArray | null
    INDIVIDUAL_CITATION_REGEX.lastIndex = 0

    while ((citationMatch = INDIVIDUAL_CITATION_REGEX.exec(citationGroup)) !== null) {
      const citationNumber = parseInt(citationMatch[1], 10)
      const resultIndex = citationNumber - 1
      const result = webResults[resultIndex]

      if (result?.url) {
        parts.push({
          type: 'source-url',
          sourceId: crypto.randomUUID(),
          url: result.url,
          title: result.name,
          attribution: result.meta_data?.citation_domain_name,
          snippet: result.snippet
        })
      }
    }

    lastIndex = startIndex + match[0].length
  }

  // Add remaining text after last citation
  if (lastIndex < markdown.length) {
    const textContent = markdown.slice(lastIndex)
    if (textContent) {
      parts.push({ type: 'text', text: textContent })
    }
  }

  return parts
}
