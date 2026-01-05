'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { VList, VListHandle } from 'virtua'
import type { Conversation, Message } from '@shared/types'
import { UserMessageBubble } from './UserMessageBubble'
import { AssistantMessage } from './AssistantMessage'
import { BranchNavigation } from './BranchNavigation'
import { AI_PROVIDERS } from '@/constants'

const LOAD_MORE_THRESHOLD = 200 // pixels from top to trigger loading more

interface ChatViewProps {
  conversation: Conversation
  messages: Message[]
  onBranchSelect?: (parentId: string, selectedChildId: string) => void
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function ChatView({
  conversation,
  messages,
  onBranchSelect,
  hasMoreMessages = false,
  isLoadingMore = false,
  onLoadMore
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-b3">
        <h2 className="font-semibold text-lg">{conversation.title}</h2>
      </div>

      {/* Messages */}
      <VList ref={listRef} className="flex-1 px-4" onScroll={handleScroll} shift={true}>
        {/* Loading indicator at top */}
        {hasMoreMessages && (
          <div className="py-4 text-center max-w-3xl mx-auto">
            {isLoadingMore ? (
              <span className="text-sm text-f2">Loading older messages...</span>
            ) : (
              <button onClick={onLoadMore} className="text-sm text-f2 hover:text-f1">
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
          <button
            onClick={() => AI_PROVIDERS[conversation.provider].openConversation(conversation.id)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-b4 bg-b2 active:bg-b3 text-sm"
          >
            <Icon size={24} />
            <span>Continue conversation in {AI_PROVIDERS[conversation.provider].name}</span>
          </button>
        </div>
      </VList>
    </div>
  )
}
