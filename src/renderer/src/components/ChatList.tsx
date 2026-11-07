'use client'

import { useRef } from 'react'
import { VList } from 'virtua'
import type { VListHandle } from 'virtua'
import { FolderIcon } from '@phosphor-icons/react'
import type { Conversation } from '@shared/types'
import { cn } from '@/lib/cn'
import { AI_PROVIDERS } from '@/constants'

interface ChatListProps {
  conversations: Conversation[]
  selectedId?: string
  onSelect: (conversation: Conversation) => void
  onScrollPositionChange: (isAtTop: boolean) => void
  onLoadMore: () => void
  projectNames?: Map<string, string>
}

const formatChatDate = (date: Date) => {
  const now = new Date()
  const d = new Date(date)
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return 'Yesterday'
  } else if (days < 7) {
    return d.toLocaleDateString([], { weekday: 'short' })
  } else {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

interface ChatRowProps {
  conversation: Conversation
  isSelected: boolean
  onSelect: (conversation: Conversation) => void
  projectName?: string
  indent?: boolean
}

export function ChatRow({
  conversation: conv,
  isSelected,
  onSelect,
  projectName,
  indent
}: ChatRowProps) {
  const Icon = AI_PROVIDERS[conv.provider].icon

  return (
    <button
      onClick={() => onSelect(conv)}
      className={cn(
        'w-full text-left p-3 border-b border-border outline-none focus-visible:bg-accent focus-visible:border-transparent',
        indent && 'pl-8',
        isSelected && 'bg-accent border-transparent'
      )}
    >
      <div className="flex items-center gap-1 w-full">
        <Icon size={16} />
        <h3 className="font-medium text-sm truncate flex-1 text-ellipsis">
          {conv.title || 'Untitled'}
        </h3>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatChatDate(conv.updatedAt)}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 min-w-0">
        {projectName && (
          <>
            <FolderIcon size={12} className="shrink-0" />
            <span className="truncate">{projectName}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="whitespace-nowrap">{conv.messageCount} messages</span>
      </div>
    </button>
  )
}

export function ChatList({
  conversations,
  selectedId,
  onSelect,
  onScrollPositionChange,
  onLoadMore,
  projectNames
}: ChatListProps) {
  const listRef = useRef<VListHandle>(null)

  const handleScroll = () => {
    if (!listRef.current) return

    const scrollOffset = listRef.current.scrollOffset
    const viewportSize = listRef.current.viewportSize

    // Check if user is at top (within 100px)
    const isAtTop = scrollOffset < 100
    onScrollPositionChange(isAtTop)

    // Check if near bottom (within 200px) to trigger load more
    const bottomItemIndex = listRef.current.findItemIndex(scrollOffset + viewportSize)
    if (bottomItemIndex + 10 > conversations.length) {
      onLoadMore()
    }
  }

  return (
    <VList ref={listRef} className="flex-1" onScroll={handleScroll}>
      {conversations.map((conv) => (
        <ChatRow
          key={conv.id}
          conversation={conv}
          isSelected={selectedId === conv.id}
          onSelect={onSelect}
          projectName={conv.projectId ? projectNames?.get(conv.projectId) : undefined}
        />
      ))}
    </VList>
  )
}
