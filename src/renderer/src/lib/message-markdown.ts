import type { MessagePart, SourceUrlPart, FileCitation } from '@shared/types'

// Insert local placeholders, so source titles/URLs cannot change Markdown structure.
// Keeping text around citations in one document preserves lists, tables and emphasis.
export function buildMessageMarkdown(parts: MessagePart[]) {
  const sources = new Map<string, SourceUrlPart>()
  const fileCitations = new Map<string, FileCitation>()
  let content = ''
  for (const [index, part] of parts.entries()) {
    if (part.type === 'text') {
      for (const ref of part.fileCitations || []) fileCitations.set(ref.marker, ref)
      if (parts[index - 1]?.type === 'text') content += '\n'
      content += part.text
    } else {
      const href = `#ownyourchat-source-${index}`
      sources.set(href, part)
      content += `[source](${href})`
    }
  }
  return { content, sources, fileCitations }
}
