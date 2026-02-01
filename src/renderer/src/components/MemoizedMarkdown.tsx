import type { Schema } from 'hast-util-sanitize'
import { marked } from 'marked'
import { memo, useMemo, Children, isValidElement, cloneElement, Fragment } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { CitationPill } from './CitationPill'

type ContentReference = {
  matched_text: string
  type: 'webpage' | 'webpage_extended' | 'image_inline'
  title?: string
  url?: string
  snippet?: string
  attribution?: string
}

// Custom sanitization schema
const sanitizeSchema: Schema = {
  tagNames: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'blockquote',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'hr',
    'br',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  attributes: {
    '*': ['className', 'id', 'data-theme'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    card: ['title', 'subtext', 'largeText', 'id', 'caption'],
    financialchart: ['*']
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https']
  }
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

// Regex to match citation markers like 【69†L143-L148】 or 【70†embed_image】
const CITATION_REGEX = /【(\d+)†[^】]+】/g

// Build a map from matched_text to ContentReference for quick lookup
function buildCitationMap(refs: ContentReference[] | undefined): Map<string, ContentReference> {
  const map = new Map<string, ContentReference>()
  if (!refs) return map
  for (const ref of refs) {
    if (ref.matched_text) {
      map.set(ref.matched_text, ref)
    }
  }
  return map
}

// Process text content to replace citation markers with CitationPill components
function processCitations(
  text: string,
  citationMap: Map<string, ContentReference>
): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  CITATION_REGEX.lastIndex = 0

  while ((match = CITATION_REGEX.exec(text)) !== null) {
    const matchedText = match[0]
    const startIndex = match.index

    // Add text before the match
    if (startIndex > lastIndex) {
      parts.push(text.slice(lastIndex, startIndex))
    }

    // Look up the reference - only render if it has a URL (skip image_inline and others without URLs)
    const ref = citationMap.get(matchedText)
    if (ref?.url) {
      parts.push(<CitationPill key={`citation-${startIndex}`} reference={ref} />)
    }
    // Otherwise, just skip the marker entirely (don't render anything)

    lastIndex = startIndex + matchedText.length
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

interface MemoizedMarkdownBlockProps {
  content: string
  citationMap: Map<string, ContentReference>
}

const MemoizedMarkdownBlock = memo(
  ({ content, citationMap }: MemoizedMarkdownBlockProps) => {
    // Helper to process children and replace citation text with CitationPill
    const processChildren = (children: React.ReactNode): React.ReactNode => {
      return Children.map(children, (child) => {
        if (typeof child === 'string') {
          const processed = processCitations(child, citationMap)
          return processed.length === 1 && typeof processed[0] === 'string' ? (
            processed[0]
          ) : (
            <Fragment>{processed}</Fragment>
          )
        }
        if (isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
          return cloneElement(child, {
            children: processChildren(child.props.children)
          })
        }
        return child
      })
    }

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeKatex, { output: 'html' }]
        ]}
        components={{
          // Process paragraph text for citations
          p: ({ children }) => <p>{processChildren(children)}</p>,
          // Process spans/text in other elements
          span: ({ children }) => <span>{processChildren(children)}</span>,
          strong: ({ children }) => <strong>{processChildren(children)}</strong>,
          em: ({ children }) => <em>{processChildren(children)}</em>,
          ul: ({ children }) => (
            <ul className="list-none pl-0 space-y-1">
              {Children.map(children, (child) =>
                isValidElement(child)
                  ? cloneElement(child, { marker: '-' } as Record<string, unknown>)
                  : child
              )}
            </ul>
          ),
          ol: ({ children }) => {
            let counter = 0
            return (
              <ol className="list-none pl-0 space-y-1">
                {Children.map(children, (child) => {
                  if (isValidElement(child)) {
                    counter++
                    return cloneElement(child, { marker: `${counter}.` } as Record<string, unknown>)
                  }
                  return child
                })}
              </ol>
            )
          },
          li: ({ children, marker }: { children?: React.ReactNode; marker?: string }) => (
            <li className="[&>p]:inline [&>p]:m-0">
              <span className="text-muted-foreground">{marker || '-'}</span>{' '}
              {processChildren(children)}
            </li>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse border border-border rounded-lg">
                {processChildren(children)}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted">{processChildren(children)}</thead>,
          tbody: ({ children }) => <tbody>{processChildren(children)}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border">{processChildren(children)}</tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2 text-left font-semibold border-r border-border last:border-r-0">
              {processChildren(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2 border-r border-border last:border-r-0">
              {processChildren(children)}
            </td>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    )
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false
    if (prevProps.citationMap !== nextProps.citationMap) return false
    return true
  }
)

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock'

interface MemoizedMarkdownProps {
  content: string
  id: string
  contentReferences?: ContentReference[]
}

export const MemoizedMarkdown = memo(
  ({ content, id, contentReferences }: MemoizedMarkdownProps) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content])
    const citationMap = useMemo(() => buildCitationMap(contentReferences), [contentReferences])

    return (
      <>
        {blocks.map((block, index) => (
          <MemoizedMarkdownBlock
            content={block}
            citationMap={citationMap}
            key={`${id}-block_${index}`}
          />
        ))}
      </>
    )
  }
)

MemoizedMarkdown.displayName = 'MemoizedMarkdown'
