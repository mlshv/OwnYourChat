'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { VList, VListHandle } from 'virtua'
import type { Conversation, Message, MessagePart, SourceUrlPart } from '@shared/types'
import { UserMessageBubble } from './UserMessageBubble'
import { AssistantMessage } from './AssistantMessage'
import { BranchNavigation } from './BranchNavigation'
import { AI_PROVIDERS } from '@/constants'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Copy01Icon,
  Copy02Icon,
  FileExportIcon,
  MoreVerticalCircle01Icon
} from '@hugeicons/core-free-icons'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

const LOAD_MORE_THRESHOLD = 200 // pixels from top to trigger loading more

interface ChatViewProps {
  conversation: Conversation
  messages: Message[]
  onBranchSelect?: (parentId: string, selectedChildId: string) => void
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  onOpenExport?: () => void
}

const formatDateTime = (date: Date | string | null | undefined): string => {
  if (!date) return 'Unknown'
  const parsedDate = new Date(date)
  if (Number.isNaN(parsedDate.getTime())) return 'Unknown'
  return parsedDate.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const flattenPartsToContent = (parts: MessagePart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')

const extractSources = (parts: MessagePart[]): Array<{ title?: string; url: string }> =>
  parts
    .filter((part): part is SourceUrlPart => part.type === 'source-url')
    .map((part) => ({
      ...(part.title && { title: part.title }),
      url: part.url
    }))

const toUnixTimestamp = (date: Date | string | undefined | null): number | null => {
  if (!date) return null
  const parsedDate = new Date(date)
  if (Number.isNaN(parsedDate.getTime())) return null
  return Math.floor(parsedDate.getTime() / 1000)
}

const buildMarkdownExport = (conversation: Conversation, messages: Message[]): string => {
  const headerLines = [
    `# ${conversation.title}`,
    '',
    `**Created:** ${formatDateTime(conversation.createdAt)}  `,
    `**Last updated:** ${formatDateTime(conversation.updatedAt)}  `,
    `**Exported:** ${formatDateTime(new Date())}`,
    ''
  ]

  const messageLines = messages.flatMap((msg) => {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant'
    const content = msg.parts
      .map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'source-url') {
          return part.title ? `[${part.title}](${part.url})` : part.url
        }
        return ''
      })
      .join('')

    return [`## ${roleLabel}`, '', ...(content ? [content, ''] : [])]
  })

  return [...headerLines, ...messageLines].join('\n')
}

const buildJsonExport = (conversation: Conversation, messages: Message[]): string => {
  const processedMessages = messages.map((msg) => {
    const sources = extractSources(msg.parts)
    const messageObj: Record<string, unknown> = {
      id: msg.id,
      role: msg.role,
      content: flattenPartsToContent(msg.parts),
      created_at: toUnixTimestamp(msg.createdAt),
      parent_id: msg.parentId
    }

    if (sources.length > 0) {
      messageObj.sources = sources
    }

    return messageObj
  })

  const exportData = {
    id: conversation.id,
    title: conversation.title,
    provider: conversation.provider,
    created_at: toUnixTimestamp(conversation.createdAt),
    updated_at: toUnixTimestamp(conversation.updatedAt),
    exported_at: new Date().toISOString(),
    message_count: messages.length,
    messages: processedMessages
  }

  return JSON.stringify(exportData, null, 2)
}

export function ChatView({
  conversation,
  messages,
  onBranchSelect,
  hasMoreMessages = false,
  isLoadingMore = false,
  onLoadMore,
  onOpenExport
}: ChatViewProps) {
  const listRef = useRef<VListHandle>(null)
  // Track downloaded attachment paths: { attachmentId: localPath }
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string>>({})

  // Track which attachment IDs are currently being downloaded to prevent duplicate requests
  const downloadingRef = useRef<Set<string>>(new Set())

  // Reset downloaded paths when conversation changes
  useEffect(() => {
    // eslint-disable-next-line
    setDownloadedPaths({})
    downloadingRef.current.clear()
  }, [conversation.id])

  // Download images when messages change
  // The backend handles filesystem-based caching, so we just need to prevent concurrent requests
  useEffect(() => {
    for (const msg of messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          // Skip if not an image or no fileId
          if (att.type !== 'image' || !att.fileId) continue

          // Skip if already downloaded this session
          if (downloadedPaths[att.id]) continue

          // Skip if currently downloading
          if (downloadingRef.current.has(att.id)) continue

          // Mark as downloading
          downloadingRef.current.add(att.id)

          const attId = att.id
          window.api?.attachments.download(attId, conversation.id).then((result) => {
            downloadingRef.current.delete(attId)
            if (result.success && result.localPath) {
              setDownloadedPaths((prev) => ({
                ...prev,
                [attId]: result.localPath!
              }))
            }
          })
        }
      }
    }
  }, [conversation.id, messages, downloadedPaths])

  // Handle scroll events
  const handleScroll = useCallback(
    (offset: number) => {
      // Trigger load more when scrolled near top
      if (offset < LOAD_MORE_THRESHOLD && hasMoreMessages && !isLoadingMore && onLoadMore) {
        onLoadMore()
      }
    },
    [hasMoreMessages, isLoadingMore, onLoadMore]
  )

  const handleDownloaded = useCallback((attId: string, path: string) => {
    setDownloadedPaths((prev) => ({ ...prev, [attId]: path }))
  }, [])

  const Icon = AI_PROVIDERS[conversation.provider].icon

  const handleCopy = useCallback(
    async (format: 'markdown' | 'json') => {
      const text =
        format === 'markdown'
          ? buildMarkdownExport(conversation, messages)
          : buildJsonExport(conversation, messages)
      try {
        await navigator.clipboard.writeText(text)
      } catch (error) {
        console.error('Failed to copy export text:', error)
      }
    },
    [conversation, messages]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center">
        <h2 className="font-semibold text-lg truncate-gradient flex-1" title={conversation.title}>
          {conversation.title}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Options"
            className="focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-[3px] aria-invalid:ring-[3px] [&_svg:not([class*='size-'])]:size-4 inline-flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none group/button select-none aria-expanded:bg-popover aria-expanded:text-foreground transition-none active:bg-muted active:text-foreground dark:active:bg-muted/50 size-8"
          >
            <HugeiconsIcon size={16} icon={MoreVerticalCircle01Icon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="w-44">
            <DropdownMenuItem onClick={() => onOpenExport?.()}>
              <HugeiconsIcon icon={FileExportIcon} />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCopy('markdown')}>
              <HugeiconsIcon icon={Copy01Icon} />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCopy('json')}>
              <HugeiconsIcon icon={Copy02Icon} />
              Copy as JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <VList ref={listRef} className="flex-1 px-4" onScroll={handleScroll} shift={true}>
        {/* Loading indicator at top */}
        {hasMoreMessages && (
          <div className="py-4 text-center max-w-3xl mx-auto">
            {isLoadingMore ? (
              <span className="text-sm text-muted-foreground">Loading older messages...</span>
            ) : (
              <button
                onClick={onLoadMore}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Load more messages
              </button>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="py-3 max-w-3xl mx-auto">
            {msg.role === 'user' ? (
              <>
                <UserMessageBubble
                  message={msg}
                  conversationId={conversation.id}
                  downloadedPaths={downloadedPaths}
                  onDownloaded={handleDownloaded}
                />
                {msg.siblingIds && msg.siblingIds.length > 1 && onBranchSelect && (
                  <div className="mt-1 flex justify-end">
                    <BranchNavigation
                      message={msg}
                      onSelectSibling={(siblingId) => {
                        if (msg.parentId) {
                          onBranchSelect(msg.parentId, siblingId)
                        }
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <AssistantMessage
                message={msg}
                conversationId={conversation.id}
                downloadedPaths={downloadedPaths}
                onDownloaded={handleDownloaded}
              />
            )}
          </div>
        ))}
        <div className="max-w-3xl mx-auto pt-4 pb-12 flex justify-center">
          <Button
            onClick={() => AI_PROVIDERS[conversation.provider].openConversation(conversation.id)}
            variant="outline"
            className="gap-2 rounded-xl "
          >
            <Icon size={24} />
            <span>Continue conversation in {AI_PROVIDERS[conversation.provider].name}</span>
          </Button>
        </div>
      </VList>
    </div>
  )
}
