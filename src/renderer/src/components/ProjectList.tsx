'use client'

import { useCallback, useEffect, useState } from 'react'
import { CaretRightIcon, FolderIcon, FolderOpenIcon } from '@phosphor-icons/react'
import type { Conversation, Project } from '@shared/types'
import { cn } from '@/lib/cn'
import { AI_PROVIDERS } from '@/constants'
import { ChatRow } from './ChatList'

interface ProjectListProps {
  projects: Project[]
  selectedId?: string
  onSelect: (conversation: Conversation) => void
  /** Changes after each sync so open folders reload their chats */
  refreshKey: string
}

export function ProjectList({ projects, selectedId, onSelect, refreshKey }: ProjectListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [chats, setChats] = useState<Record<string, Conversation[]>>({})

  const loadChats = useCallback(async (projectId: string) => {
    const result = await window.api.conversations.list({ projectId, limit: 1000 })
    setChats((prev) => ({ ...prev, [projectId]: result.items }))
  }, [])

  // Reload open folders after a sync
  useEffect(() => {
    expanded.forEach((id) => loadChats(id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const toggle = (projectId: string) => {
    const isOpen = expanded.has(projectId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(projectId)
      else next.add(projectId)
      return next
    })
    if (!isOpen && !chats[projectId]) loadChats(projectId)
  }

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No projects yet. They appear after the next sync.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      {projects.map((project) => {
        const ProviderIcon = AI_PROVIDERS[project.provider].icon
        const isOpen = expanded.has(project.id)
        const items = chats[project.id]

        return (
          <div key={project.id}>
            <button
              onClick={() => toggle(project.id)}
              aria-expanded={isOpen}
              title={project.description ?? project.name}
              className="w-full text-left px-3 py-2.5 border-b border-border outline-none focus-visible:bg-accent hover:bg-accent/50 flex items-center gap-1.5"
            >
              <CaretRightIcon
                size={12}
                className={cn(
                  'shrink-0 text-muted-foreground transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
              {isOpen ? (
                <FolderOpenIcon size={16} className="shrink-0" />
              ) : (
                <FolderIcon size={16} className="shrink-0" />
              )}
              <span className="font-medium text-sm truncate flex-1">{project.name}</span>
              <span className="shrink-0 text-muted-foreground" aria-label={project.provider}>
                <ProviderIcon size={14} />
              </span>
              <span className="text-xs text-muted-foreground tabular-nums min-w-5 text-right">
                {project.conversationCount}
              </span>
            </button>

            {isOpen &&
              (!items ? (
                <div className="pl-8 py-2 text-xs text-muted-foreground border-b border-border">
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="pl-8 py-2 text-xs text-muted-foreground border-b border-border">
                  No chats synced into this project yet
                </div>
              ) : (
                items.map((conv) => (
                  <ChatRow
                    key={conv.id}
                    conversation={conv}
                    isSelected={selectedId === conv.id}
                    onSelect={onSelect}
                    indent
                  />
                ))
              ))}
          </div>
        )
      })}
    </div>
  )
}
