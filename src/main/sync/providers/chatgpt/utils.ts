import crypto from 'crypto'
import type { MessagePart } from '@shared/types'

export interface ChatGPTContentReference {
  matched_text: string
  type: 'webpage' | 'webpage_extended' | 'image_inline'
  title?: string
  url?: string
  snippet?: string
  attribution?: string
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

  const parts: MessagePart[] = []
  const citationMap = new Map<string, ChatGPTContentReference>()

  for (const ref of contentReferences) {
    if (ref.matched_text) {
      citationMap.set(ref.matched_text, ref)
    }
  }

  const CITATION_REGEX = /【(\d+)†[^】]+】/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  CITATION_REGEX.lastIndex = 0

  while ((match = CITATION_REGEX.exec(content)) !== null) {
    const matchedText = match[0]
    const startIndex = match.index

    if (startIndex > lastIndex) {
      const textContent = content.slice(lastIndex, startIndex)
      if (textContent) {
        parts.push({ type: 'text', text: textContent })
      }
    }

    const ref = citationMap.get(matchedText)
    if (ref?.url) {
      parts.push({
        type: 'source-url',
        sourceId: crypto.randomUUID(),
        url: ref.url,
        title: ref.title,
        attribution: ref.attribution,
        snippet: ref.snippet
      })
    }

    lastIndex = startIndex + matchedText.length
  }

  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex)
    if (textContent) {
      parts.push({ type: 'text', text: textContent })
    }
  }

  return parts
}
