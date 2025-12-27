'use client'

import { useRef } from 'react'
import { VList } from 'virtua'
import type { VListHandle } from 'virtua'
import type { Conversation } from '@shared/types'
import { cn } from '@/lib/cn'
import { AI_PROVIDERS } from '@/constants'

interface ChatListProps {
  conversations: Conversation[]
  selectedId?: string
  onSelect: (conversation: Conversation) => void
  onScrollPositionChange: (isAtTop: boolean) => void
  onLoadMore: () => void
}

export function ChatList({
  conversations,
  selectedId,
  onSelect,
  onScrollPositionChange,
  onLoadMore
}: ChatListProps) {
  const listRef = useRef<VListHandle>(null)

  const formatDate = (date: Date) => {
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
      {conversations.map((conv) => {
        const Icon = AI_PROVIDERS[conv.provider].icon

        return (
          <button
            key={conv.id}
            onPointerDown={() => onSelect(conv)}
            className={cn(
              'w-full text-left p-3 border-b border-b3',
              selectedId === conv.id && 'bg-b3'
            )}
          >
            <div className="flex items-center gap-1 w-full">
              <Icon size={16} />
              <h3 className="font-medium text-sm truncate flex-1 text-ellipsis">
                {conv.title || 'Untitled'}
              </h3>

              <span className="text-xs text-f2 whitespace-nowrap">
                {formatDate(conv.updatedAt)}
              </span>
            </div>
            <div className="text-xs text-f2 mt-1">{conv.messageCount} messages</div>
          </button>
        )
      })}
    </VList>
  )
}
