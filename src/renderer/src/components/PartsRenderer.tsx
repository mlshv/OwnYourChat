import type { Schema } from 'hast-util-sanitize'
import { memo, useMemo, Children, isValidElement, cloneElement } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import type { MessagePart, SourceUrlPart, FileCitation } from '../../../shared/types'
import { CHATGPT_DISPLAY_CITATION_PATTERN } from '../../../shared/citations'
import { buildMessageMarkdown } from '../lib/message-markdown'
import { CitationPill } from './CitationPill'
import { FileCitationPill } from './FileCitationPill'
import { remarkChatGPTMarkers } from '../lib/remark-chatgpt-markers'
import { describeChatGPTMarker } from '../lib/chatgpt-markers'

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
    'span',
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

interface PartsRendererProps {
  parts: MessagePart[]
  messageId: string
}

// Render a single markdown text part
const MarkdownPart = memo(
  ({
    content,
    sources,
    fileCitations,
    messageId
  }: {
    content: string
    sources: Map<string, SourceUrlPart>
    fileCitations: Map<string, FileCitation>
    messageId: string
  }) => {
    // Helper to process children
    const processChildren = (children: React.ReactNode): React.ReactNode => {
      return Children.map(children, (child) => {
        if (typeof child === 'string') {
          const nodes: React.ReactNode[] = []
          let offset = 0
          for (const match of child.matchAll(new RegExp(CHATGPT_DISPLAY_CITATION_PATTERN))) {
            nodes.push(child.slice(offset, match.index))
            const description = describeChatGPTMarker(match[0])
            nodes.push(
              match[0].startsWith('\uE200filecite\uE202') ? (
                <FileCitationPill
                  key={`file-${match.index}`}
                  marker={match[0]}
                  reference={fileCitations.get(match[0])}
                  messageId={messageId}
                />
              ) : description.kind === 'citation' ? (
                <CitationPill key={`missing-${match.index}`} reference={{}} />
              ) : description.url ? (
                <a
                  key={`marker-${match.index}`}
                  href={description.url}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void window.api?.shell.openExternal(description.url!)
                  }}
                >
                  {description.label}
                </a>
              ) : (
                <span key={`marker-${match.index}`}>{description.label}</span>
              )
            )
            offset = match.index + match[0].length
          }
          return offset ? [...nodes, child.slice(offset)] : child
        }
        // Literal code and links must not be rewritten as citations.
        if (isValidElement(child) && ['code', 'pre', 'a'].includes(child.type as string))
          return child
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
        remarkPlugins={[
          remarkChatGPTMarkers,
          remarkGfm,
          [remarkMath, { singleDollarTextMath: false }]
        ]}
        rehypePlugins={[
          [rehypeSanitize, sanitizeSchema],
          [rehypeKatex, { output: 'html' }]
        ]}
        components={{
          a: ({ href, children }) => {
            const source = href ? sources.get(href) : undefined
            return source ? <CitationPill reference={source} /> : <a href={href}>{children}</a>
          },
          h1: ({ children }) => <h1>{processChildren(children)}</h1>,
          h2: ({ children }) => <h2>{processChildren(children)}</h2>,
          h3: ({ children }) => <h3>{processChildren(children)}</h3>,
          h4: ({ children }) => <h4>{processChildren(children)}</h4>,
          h5: ({ children }) => <h5>{processChildren(children)}</h5>,
          h6: ({ children }) => <h6>{processChildren(children)}</h6>,
          p: ({ children }) => <p>{processChildren(children)}</p>,
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
          pre: ({ children }) => (
            <pre className="bg-accent/50 rounded-md px-1 py-0.5 my-2">{children}</pre>
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
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.sources === nextProps.sources &&
    prevProps.fileCitations === nextProps.fileCitations &&
    prevProps.messageId === nextProps.messageId
)

MarkdownPart.displayName = 'MarkdownPart'

export const PartsRenderer = memo(({ parts, messageId }: PartsRendererProps) => {
  const { content, sources, fileCitations } = useMemo(() => buildMessageMarkdown(parts), [parts])
  return (
    <MarkdownPart
      content={content}
      sources={sources}
      fileCitations={fileCitations}
      messageId={messageId}
    />
  )
})

PartsRenderer.displayName = 'PartsRenderer'
