import crypto from 'crypto'
import type { MessagePart, FileCitation } from '@shared/types'
import { CHATGPT_CITATION_PATTERN, isWebSourceUrl } from '../../../../shared/citations'

type ChatGPTWebSource = {
  title?: string
  url?: string
  snippet?: string
  attribution?: string
  supporting_websites?: ChatGPTWebSource[]
}

export interface ChatGPTContentReference extends ChatGPTWebSource {
  matched_text: string
  type: 'webpage' | 'webpage_extended' | 'image_inline' | 'grouped_webpages' | 'file'
  id?: string
  name?: string
  cloud_doc_url?: string | null
  items?: ChatGPTWebSource[] | null
  fallback_items?: ChatGPTWebSource[] | null
}

export interface ChatGPTMessageInput {
  content: string
  contentReferences?: ChatGPTContentReference[]
}

export function transformChatGPTMessageToParts(input: ChatGPTMessageInput): MessagePart[] {
  const { content, contentReferences } = input

  if (!contentReferences || contentReferences.length === 0) {
    return [{ type: 'text', text: content }]
  }

  const fileCitations: FileCitation[] = contentReferences
    .filter((ref) => ref.type === 'file' && ref.matched_text)
    .map((ref) => ({
      marker: ref.matched_text,
      ...(typeof ref.id === 'string' && /^file[_-][a-zA-Z0-9_-]+$/.test(ref.id)
        ? { fileId: ref.id }
        : {}),
      ...(typeof ref.name === 'string' ? { filename: ref.name } : {}),
      ...(isWebSourceUrl(ref.cloud_doc_url ?? undefined) ? { url: ref.cloud_doc_url! } : {})
    }))
  const parts: MessagePart[] = []
  const citationMap = new Map<string, ChatGPTContentReference>()

  for (const ref of contentReferences) {
    if (ref.matched_text) {
      citationMap.set(ref.matched_text, ref)
    }
  }

  const citationRegex = new RegExp(CHATGPT_CITATION_PATTERN)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = citationRegex.exec(content)) !== null) {
    const matchedText = match[0]
    const startIndex = match.index

    if (startIndex > lastIndex) {
      const textContent = content.slice(lastIndex, startIndex)
      if (textContent) {
        parts.push({ type: 'text', text: textContent })
      }
    }

    const ref = citationMap.get(matchedText)
    const items =
      ref?.type === 'grouped_webpages'
        ? ref.items?.length
          ? ref.items
          : ref.fallback_items || []
        : ref
          ? [ref]
          : []
    const sources = items.flatMap((item) => [item, ...(item.supporting_websites || [])])
    const seenUrls = new Set<string>()
    for (const source of sources) {
      if (!isWebSourceUrl(source.url) || seenUrls.has(source.url)) continue
      seenUrls.add(source.url)
      parts.push({
        type: 'source-url',
        sourceId: crypto.randomUUID(),
        url: source.url,
        title: source.title,
        attribution: source.attribution,
        snippet: source.snippet
      })
    }
    // Keep unresolved modern markers in the archive; the UI shows an honest fallback.
    if (seenUrls.size === 0 && matchedText.startsWith('\uE200')) {
      parts.push({ type: 'text', text: matchedText })
    }

    lastIndex = startIndex + matchedText.length
  }

  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex)
    if (textContent) {
      parts.push({ type: 'text', text: textContent })
    }
  }

  return parts.map((part) => {
    if (part.type !== 'text') return part
    const references = fileCitations.filter((ref) => part.text.includes(ref.marker))
    return references.length ? { ...part, fileCitations: references } : part
  })
}
