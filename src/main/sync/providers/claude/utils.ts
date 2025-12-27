import type { MessagePart } from '@shared/types'

export interface ClaudeMdCitation {
  uuid: string
  title: string
  url: string
  start_index: number
  end_index: number
  metadata?: {
    type?: string
    preview_title?: string
    icon_url?: string
    source?: string
    content_body?: string
  }
}

export interface ClaudeContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface ClaudeToolUseContent {
  type: 'tool_use'
  name: string
  input?: {
    content?: string
    md_citations?: ClaudeMdCitation[]
  }
}

export interface ClaudeMessageInput {
  content: ClaudeContentBlock[]
}

export function transformClaudeMessageToParts(input: ClaudeMessageInput): MessagePart[] {
  const { content } = input
  const parts: MessagePart[] = []

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      const toolUse = block as unknown as ClaudeToolUseContent

      if (toolUse.name === 'artifacts' && toolUse.input?.content) {
        const markdown = toolUse.input.content
        const citations = toolUse.input.md_citations || []

        if (citations.length === 0) {
          parts.push({ type: 'text', text: markdown })
        } else {
          const sortedCitations = [...citations].sort((a, b) => a.start_index - b.start_index)

          let lastIndex = 0

          for (const citation of sortedCitations) {
            // Include text up to and INCLUDING the cited portion
            const textContent = markdown.slice(lastIndex, citation.end_index)
            if (textContent) {
              parts.push({ type: 'text', text: textContent })
            }

            parts.push({
              type: 'source-url',
              sourceId: citation.uuid,
              url: citation.url,
              title: citation.title || citation.metadata?.preview_title,
              attribution: citation.metadata?.source,
              icon_url: citation.metadata?.icon_url,
              snippet: citation.metadata?.content_body
            })

            lastIndex = citation.end_index
          }

          if (lastIndex < markdown.length) {
            const textContent = markdown.slice(lastIndex)
            if (textContent) {
              parts.push({ type: 'text', text: textContent })
            }
          }
        }
      }
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: '' })
  }

  return parts
}
