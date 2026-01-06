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

  // Regex to match citations like [1], [2], etc., but not markdown links
  // Negative lookahead (?!\() ensures we don't match [text](url) patterns
  const CITATION_REGEX = /\[(\d+)\](?!\()/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  CITATION_REGEX.lastIndex = 0

  while ((match = CITATION_REGEX.exec(markdown)) !== null) {
    const citationNumber = parseInt(match[1], 10)
    const startIndex = match.index

    // Add text before citation
    if (startIndex > lastIndex) {
      const textContent = markdown.slice(lastIndex, startIndex)
      if (textContent) {
        parts.push({ type: 'text', text: textContent })
      }
    }

    // Map citation number (1-indexed) to webResults array (0-indexed)
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
