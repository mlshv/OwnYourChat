import type { Schema } from 'hast-util-sanitize'
import { memo, Children, isValidElement, cloneElement } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import type { MessagePart } from '../../../shared/types'

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

interface PartsRendererProps {
  parts: MessagePart[]
  messageId: string
}

// Render a single markdown text part
const MarkdownPart = memo(
  ({ content }: { content: string }) => {
    // Helper to process children
    const processChildren = (children: React.ReactNode): React.ReactNode => {
      return Children.map(children, (child) => {
        if (typeof child === 'string') {
          return child
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
            <pre className="bg-accent/50 rounded-md px-1 py-0.5 my-2">
              {processChildren(children)}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse border border-border rounded-lg">
                {processChildren(children)}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{processChildren(children)}</thead>
          ),
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
  (prevProps, nextProps) => prevProps.content === nextProps.content
)

MarkdownPart.displayName = 'MarkdownPart'

export const PartsRenderer = memo(({ parts }: PartsRendererProps) => {
  // First filter out source-url parts, keeping only text parts
  const textParts = parts.filter((part) => part.type === 'text')

  // Join all consecutive text parts into one string with newlines
  const combinedText = textParts.map((part) => part.text).join('\n')

  return <MarkdownPart content={combinedText} />
})

PartsRenderer.displayName = 'PartsRenderer'
