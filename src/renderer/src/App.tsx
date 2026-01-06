'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChatList } from './components/ChatList'
import { ChatView } from './components/ChatView'
import { ExportModal } from './components/ExportModal'
import { SettingsModal } from './components/SettingsModal'
import { OnboardingScreen } from './components/OnboardingScreen'
import type { Conversation, Message, ElectronAPI } from '@shared/types'
import { buildMessageTree, getDisplayPath, updateBranchSelection } from './lib/branch-utils'
import { useAuthState } from './lib/store'

// Type augmentation for window.api
declare global {
  interface Window {
    api: ElectronAPI
  }
}

export default function App() {
  // Store state
  const authState = useAuthState()

  // Local state
  const [conversations, setConversations] = useState<{
    items: Conversation[]
    total: number
    hasMore: boolean
  }>({ items: [], total: 0, hasMore: false })
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [allMessages, setAllMessages] = useState<Message[]>([]) // Full message tree
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({}) // parentId -> selected childId
  const [isLoading, setIsLoading] = useState(true)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)
  const [isUserAtTop, setIsUserAtTop] = useState(true)

  // Pagination state
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [oldestLoadedOrderIndex, setOldestLoadedOrderIndex] = useState<number | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const MESSAGES_PAGE_SIZE = 50

  // Build message tree and compute display path
  const messageTree = useMemo(() => buildMessageTree(allMessages), [allMessages])
  const displayedMessages = useMemo(
    () =>
      getDisplayPath(messageTree, branchSelections, selectedConversation?.currentNodeId ?? null),
    [messageTree, branchSelections, selectedConversation?.currentNodeId]
  )

  // Handle branch selection changes
  const handleBranchSelect = useCallback(
    (parentId: string, selectedChildId: string) => {
      setBranchSelections((prev) =>
        updateBranchSelection(prev, parentId, selectedChildId, messageTree)
      )
    },
    [messageTree]
  )

  // Handle loading more messages (older messages when scrolling up)
  const handleLoadMoreMessages = useCallback(async () => {
    if (
      !selectedConversation ||
      isLoadingMore ||
      !hasMoreMessages ||
      oldestLoadedOrderIndex === null
    ) {
      return
    }

    setIsLoadingMore(true)
    try {
      const result = await window.api!.conversations.getMessagesPage(selectedConversation.id, {
        limit: MESSAGES_PAGE_SIZE,
        beforeOrderIndex: oldestLoadedOrderIndex
      })

      if (result) {
        // Prepend older messages to existing array
        setAllMessages((prev) => [...result.messages, ...prev])
        setHasMoreMessages(result.hasMore)
        setOldestLoadedOrderIndex(result.oldestOrderIndex)
      }
    } finally {
      setIsLoadingMore(false)
    }
  }, [selectedConversation, isLoadingMore, hasMoreMessages, oldestLoadedOrderIndex])

  // Ref to track selected conversation ID for use in sync callback
  const selectedConversationIdRef = useRef<string | null>(null)
  // Ref to track the latest requested conversation ID for race condition prevention
  const pendingConversationIdRef = useRef<string | null>(null)

  // Keep ref in sync with selected conversation
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.id ?? null
  }, [selectedConversation?.id])

  // Check if we're in Electron
  const isElectron = typeof window !== 'undefined' && window.api

  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false)
      return
    }

    // Initial load - load user preferences and conversations
    async function init() {
      try {
        // Load user preferences from database
        const prefs = await window.api!.userPreferences.get()
        setHasCompletedOnboarding(prefs.hasCompletedOnboarding)

        // Always load conversations from database (regardless of connection state)
        const result = await window.api!.conversations.list({ limit: 200 })
        setConversations(result)
      } catch (error) {
        console.error('Failed to initialize:', error)
      } finally {
        setIsLoading(false)
      }
    }

    init()

    // Listen for menu export click
    const unsubscribeMenuExport = window.api!.menu.onExportClick(() => {
      setShowExportModal(true)
    })

    // Listen for menu settings click
    const unsubscribeMenuSettings = window.api!.menu.onSettingsClick(() => {
      setShowSettingsModal(true)
    })

    return () => {
      unsubscribeMenuExport()
      unsubscribeMenuSettings()
    }
  }, [isElectron]) // Only run once on mount

  // Handle sync completion with scroll-aware updates
  useEffect(() => {
    if (!isElectron) return

    // If user is searching, don't auto-update (would be confusing)
    if (searchQuery.trim()) return

    // If user is at top, fetch fresh conversations and replace state
    if (isUserAtTop) {
      window.api!.conversations.list({ limit: 200 }).then((fresh) => {
        setConversations(fresh)
      })
    }
    // If user scrolled down, do nothing (no jarring updates)
  }, [isElectron, isUserAtTop, searchQuery])

  const handleOnboardingComplete = async () => {
    if (!isElectron) return
    try {
      // Save onboarding completion to database
      await window.api!.userPreferences.set({ hasCompletedOnboarding: true })
      setHasCompletedOnboarding(true)

      // Load conversations
      const result = await window.api!.conversations.list({ limit: 200 })
      setConversations(result)
    } catch (error) {
      console.error('Failed to complete onboarding:', error)
    }
  }

  const handleLoadMoreConversations = useCallback(async () => {
    if (!isElectron || !conversations.hasMore) return

    const result = await window.api!.conversations.list({
      limit: 200,
      offset: conversations.items.length
    })

    setConversations((prev) => ({
      items: [...prev.items, ...result.items],
      total: result.total,
      hasMore: result.hasMore
    }))
  }, [isElectron, conversations.hasMore, conversations.items.length])

  const handleSelectConversation = async (conv: Conversation) => {
    if (!isElectron) return

    // Track this request to prevent race conditions
    const requestId = conv.id
    pendingConversationIdRef.current = requestId
    setSelectedConversation(conv)
    // Fetch data first with pagination (load most recent MESSAGES_PAGE_SIZE messages)
    const data = await window.api!.conversations.get(conv.id, { limit: MESSAGES_PAGE_SIZE })

    // Check if this request is still the latest one
    if (pendingConversationIdRef.current !== requestId) {
      // A newer request was made, discard this result
      return
    }

    if (data) {
      setAllMessages(data.messages)
      setBranchSelections({}) // Reset branch selections when switching conversations
      setHasMoreMessages(data.hasMoreMessages)
      setOldestLoadedOrderIndex(data.oldestLoadedOrderIndex)

      // Refresh from API in background to get latest messages
      window.api!.conversations.refresh(conv.id).then((refreshed) => {
        // Check if we're still viewing this conversation before updating
        if (pendingConversationIdRef.current !== requestId) {
          return
        }
        if (refreshed && refreshed.messages.length !== data.messages.length) {
          // Only update if message count changed (new messages)
          // Note: refresh returns all messages, so we need to slice to keep pagination
          setSelectedConversation(refreshed.conversation)
          // Keep only the recent messages + any we've already loaded
          const currentMessageIds = new Set(data.messages.map((m) => m.id))
          const newMessages = refreshed.messages.filter((m) => !currentMessageIds.has(m.id))
          if (newMessages.length > 0) {
            // Append new messages to the end
            setAllMessages((prev) => [
              ...prev,
              ...newMessages.filter((m) => m.orderIndex > (prev[prev.length - 1]?.orderIndex ?? -1))
            ])
          }
        }
      })
    }
  }

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (!isElectron) return

    if (query.trim()) {
      const results = await window.api!.conversations.search(query)
      setConversations(results)
    } else {
      const result = await window.api!.conversations.list({ limit: 200 })
      setConversations(result)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-f2">Loading...</div>
      </div>
    )
  }

  if (!isElectron) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">OwnYourChat</h1>
          <p className="text-f2">This app must be run in Electron.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 border-r border-b3 flex flex-col">
          {/* Search */}
          <div className="p-3 border-b border-b3">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-b4 rounded-lg bg-b1 focus:outline-none focus:ring-2 focus:ring-f1"
            />
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-auto">
            {conversations.items.length === 0 ? (
              <div className="p-4 text-center text-f2 text-sm">
                {!authState.isLoggedIn
                  ? 'Connect a provider to sync your chats'
                  : 'No conversations yet.'}
              </div>
            ) : (
              <ChatList
                conversations={conversations.items}
                selectedId={selectedConversation?.id}
                onSelect={handleSelectConversation}
                onScrollPositionChange={setIsUserAtTop}
                onLoadMore={handleLoadMoreConversations}
              />
            )}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <ChatView
              key={selectedConversation.id}
              conversation={selectedConversation}
              messages={displayedMessages}
              onBranchSelect={handleBranchSelect}
              hasMoreMessages={hasMoreMessages}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMoreMessages}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-f2">
              Select a conversation to view
            </div>
          )}
        </div>
      </div>

      {/* Debug Toolbar */}
      <div className="h-10 flex items-center justify-between px-4 bg-yellow-700 border-b border-b3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Debug Mode</span>
        </div>
        <div className="no-drag flex items-center gap-2">
          <button
            onClick={() => setShowExportModal(true)}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
          >
            Export
          </button>
          <button
            onClick={() => window.api?.debug.toggleChatGPTView()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Toggle ChatGPT WebContentsView visibility"
          >
            View ChatGPT
          </button>
          <button
            onClick={() => window.api?.debug.toggleClaudeView()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Toggle Claude WebContentsView visibility"
          >
            View Claude
          </button>
          <button
            onClick={() => window.api?.debug.togglePerplexityView()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Toggle Perplexity WebContentsView visibility"
          >
            View Perplexity
          </button>

          <button
            onClick={() => window.api?.debug.openChatGPTDevTools()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Open DevTools for ChatGPT WebContentsView"
          >
            DevTools (ChatGPT)
          </button>

          <button
            onClick={() => window.api?.debug.openClaudeDevTools()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Open DevTools for Claude WebContentsView"
          >
            DevTools (Claude)
          </button>
          <button
            onClick={() => window.api?.debug.openPerplexityDevTools()}
            className="text-xs px-2 py-1 bg-f1 text-b1 rounded active:bg-f2"
            title="Open DevTools for Perplexity WebContentsView"
          >
            DevTools (Perplexity)
          </button>
        </div>
      </div>

      {/* Export modal */}
      {showExportModal && (
        <ExportModal
          conversationId={selectedConversation?.id}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Settings modal */}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}

      {/* Onboarding screen */}
      {!hasCompletedOnboarding && <OnboardingScreen onComplete={handleOnboardingComplete} />}
    </div>
  )
}
