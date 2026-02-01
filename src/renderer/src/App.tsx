'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FunnelIcon } from '@phosphor-icons/react'
import { ChatList } from './components/ChatList'
import { ChatView } from './components/ChatView'
import { ConnectionBar } from './components/ConnectionBar'
import { ExportModal } from './components/ExportModal'
import { SettingsModal } from './components/SettingsModal'
import { OnboardingScreen } from './components/OnboardingScreen'
import { SearchInput } from './components/SearchInput'
import { Button } from './components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip'
import type { Conversation, Message, ElectronAPI } from '@shared/types'
import { buildMessageTree, getDisplayPath, updateBranchSelection } from './lib/branch-utils'
import { useAuthState, useProvidersState, useSyncState, useUIState } from './lib/store'
import { AI_PROVIDERS } from './constants'

// Type augmentation for window.api
declare global {
  interface Window {
    api: ElectronAPI
  }
}

export default function App() {
  // Store state
  const authState = useAuthState()
  const providersState = useProvidersState()
  const syncState = useSyncState()
  const uiState = useUIState()

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
  const [exportScope, setExportScope] = useState<'current' | 'all' | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<
    'chatgpt' | 'claude' | 'perplexity' | null
  >(null)
  const [totalProviderCounts, setTotalProviderCounts] = useState<{
    chatgpt: number
    claude: number
    perplexity: number
  }>({ chatgpt: 0, claude: 0, perplexity: 0 })
  // Stores counts from search results (before provider filtering)
  const [searchResultCounts, setSearchResultCounts] = useState<{
    chatgpt: number
    claude: number
    perplexity: number
  } | null>(null)
  const [caseSensitiveSearch, setCaseSensitiveSearch] = useState(false)
  const [searchInMessages, setSearchInMessages] = useState(false)
  const [showProviderFilters, setShowProviderFilters] = useState(false)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [isUserAtTop, setIsUserAtTop] = useState(true)

  // Pagination state
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [oldestLoadedOrderIndex, setOldestLoadedOrderIndex] = useState<number | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const MESSAGES_PAGE_SIZE = 50

  // Get connected providers
  const connectedProviders = useMemo(() => {
    return (Object.keys(AI_PROVIDERS) as Array<'chatgpt' | 'claude' | 'perplexity'>).filter(
      (id) => providersState[id].isOnline
    )
  }, [providersState])

  // Track sync state changes across all providers - stringify to detect any change
  const providersSyncKey = useMemo(() => {
    return `${providersState.chatgpt.lastSyncAt}-${providersState.claude.lastSyncAt}-${providersState.perplexity.lastSyncAt}`
  }, [
    providersState.chatgpt.lastSyncAt,
    providersState.claude.lastSyncAt,
    providersState.perplexity.lastSyncAt
  ])

  // Compute display counts: when searching, show counts from search results (before provider filter)
  // Otherwise show total counts
  const displayCounts = useMemo(() => {
    if (searchQuery.trim() && searchResultCounts) {
      // Use pre-computed counts from search results (not affected by provider filter)
      return searchResultCounts
    }
    return totalProviderCounts
  }, [searchQuery, searchResultCounts, totalProviderCounts])

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
        setShowDebugPanel(prefs.showDebugPanel)

        // Always load conversations from database (regardless of connection state)
        const [result, counts] = await Promise.all([
          window.api!.conversations.list({ limit: 200 }),
          window.api!.conversations.getProviderCounts()
        ])
        setConversations(result)
        setTotalProviderCounts(counts)
      } catch (error) {
        console.error('Failed to initialize:', error)
      } finally {
        setIsLoading(false)
      }
    }

    init()

    // Listen for menu export click
    const unsubscribeMenuExport = window.api!.menu.onExportClick(() => {
      setExportScope(null)
      setShowExportModal(true)
    })

    // Listen for menu settings click
    const unsubscribeMenuSettings = window.api!.menu.onSettingsClick(() => {
      setShowSettingsModal(true)
    })

    // Listen for menu debug panel toggle
    const unsubscribeDebugPanelToggle = window.api!.menu.onDebugPanelToggle(async () => {
      const newValue = !showDebugPanel
      setShowDebugPanel(newValue)
      await window.api!.userPreferences.set({ showDebugPanel: newValue })
    })

    return () => {
      unsubscribeMenuExport()
      unsubscribeMenuSettings()
      unsubscribeDebugPanelToggle()
    }
  }, [isElectron, showDebugPanel]) // Only run once on mount

  // Handle sync completion with scroll-aware updates
  useEffect(() => {
    if (!isElectron) return

    // If user is searching, don't auto-update (would be confusing)
    if (searchQuery.trim()) return

    // If user is at top, fetch fresh conversations and replace state
    if (isUserAtTop) {
      Promise.all([
        window.api!.conversations.list({ limit: 200 }),
        window.api!.conversations.getProviderCounts()
      ]).then(([fresh, counts]) => {
        setConversations(fresh)
        setTotalProviderCounts(counts)
      })
    }
    // If user scrolled down, do nothing (no jarring updates)
  }, [isElectron, isUserAtTop, searchQuery, providersSyncKey])

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

  const handleSearch = async (
    query: string,
    options?: {
      provider?: 'chatgpt' | 'claude' | 'perplexity' | null
      caseSensitive?: boolean
      searchInMessages?: boolean
    }
  ) => {
    setSearchQuery(query)
    if (!isElectron) return

    const providerFilter = options?.provider !== undefined ? options.provider : selectedProvider
    const isCaseSensitive = options?.caseSensitive ?? caseSensitiveSearch
    const includeMessages = options?.searchInMessages ?? searchInMessages
    // Only search messages if query is 3+ chars (performance optimization)
    const shouldSearchMessages = includeMessages && query.trim().length >= 3

    if (query.trim()) {
      // First, get all search results without provider filter to compute counts
      const allResults = await window.api!.conversations.search(query, {
        caseInsensitive: !isCaseSensitive,
        searchInMessages: shouldSearchMessages
      })

      // Compute counts from all search results
      const counts = { chatgpt: 0, claude: 0, perplexity: 0 }
      for (const conv of allResults.items) {
        counts[conv.provider]++
      }
      setSearchResultCounts(counts)

      // Apply provider filter for display if selected
      if (providerFilter) {
        const filteredItems = allResults.items.filter((c) => c.provider === providerFilter)
        setConversations({
          items: filteredItems,
          total: filteredItems.length,
          hasMore: false
        })
      } else {
        setConversations(allResults)
      }
    } else {
      // Clear search result counts when not searching
      setSearchResultCounts(null)
      const result = await window.api!.conversations.list({
        limit: 200,
        provider: providerFilter ?? undefined
      })
      setConversations(result)
    }
  }

  const handleProviderFilter = (provider: 'chatgpt' | 'claude' | 'perplexity') => {
    const newProvider = selectedProvider === provider ? null : provider
    setSelectedProvider(newProvider)
    handleSearch(searchQuery, { provider: newProvider })
  }

  const handleToggleCaseSensitive = (newValue: boolean) => {
    setCaseSensitiveSearch(newValue)
    // Re-run search with new setting if there's a query
    if (searchQuery.trim()) {
      handleSearch(searchQuery, { caseSensitive: newValue })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isElectron) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">OwnYourChat</h1>
          <p className="text-muted-foreground">This app must be run in Electron.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Connection bar - shown when connecting to a provider */}
      {uiState?.connectingProvider && (
        <ConnectionBar
          provider={uiState.connectingProvider}
          onCancel={() => window.api?.auth.cancelConnection()}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div className="w-72 border-r border-border flex flex-col pt-5">
          {/* Search */}
          <div className="py-3 px-2 border-b border-border">
            <div className="flex gap-1.5">
              <SearchInput
                value={searchQuery}
                onChange={handleSearch}
                placeholder="Search conversations..."
                caseSensitive={caseSensitiveSearch}
                onCaseSensitiveChange={handleToggleCaseSensitive}
                searchInMessages={searchInMessages}
                onSearchInMessagesChange={(newValue) => {
                  setSearchInMessages(newValue)
                  if (searchQuery.trim()) {
                    handleSearch(searchQuery, { searchInMessages: newValue })
                  }
                }}
              />
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      onClick={() => setShowProviderFilters(!showProviderFilters)}
                      className="px-1.5"
                    >
                      <FunnelIcon size={14} />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">Toggle filters</TooltipContent>
              </Tooltip>
            </div>
            {/* Provider filters */}
            {showProviderFilters && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(Object.keys(AI_PROVIDERS) as Array<'chatgpt' | 'claude' | 'perplexity'>).map(
                  (providerId) => {
                    const provider = AI_PROVIDERS[providerId]
                    const Icon = provider.icon
                    const count = displayCounts[providerId]
                    const isSelected = selectedProvider === providerId
                    return (
                      <Button
                        key={providerId}
                        onClick={() => handleProviderFilter(providerId)}
                        variant={isSelected ? 'default' : 'outline'}
                        size="xs"
                        title={`Filter by ${provider.name}`}
                      >
                        <Icon size={14} />
                        <span>{count}</span>
                      </Button>
                    )
                  }
                )}
              </div>
            )}
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-auto">
            {conversations.items.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
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

          {/* Sync status */}
          {connectedProviders.length > 0 && (
            <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
              {(() => {
                // Check if any provider is syncing
                const syncingProvider = connectedProviders.find((p) => providersState[p].isSyncing)
                // Get most recent sync time across all providers
                const lastSyncTimes = connectedProviders
                  .map((p) => providersState[p].lastSyncAt)
                  .filter((t): t is Date => t !== null)
                const mostRecentSync =
                  lastSyncTimes.length > 0
                    ? new Date(Math.max(...lastSyncTimes.map((t) => new Date(t).getTime())))
                    : null

                if (syncingProvider || syncState.isRunning) {
                  return (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse corner-shape-round" />
                      Syncing{syncingProvider && ` ${AI_PROVIDERS[syncingProvider].name}`}
                      {syncState.progress && syncState.progress.total > 0 && (
                        <span className="tabular-nums">
                          {syncState.progress.current}/{syncState.progress.total}
                        </span>
                      )}
                      {syncState.progress && syncState.progress.newChatsFound > 0 && (
                        <span className="text-primary">
                          +{syncState.progress.newChatsFound} new
                        </span>
                      )}
                    </span>
                  )
                }

                if (mostRecentSync) {
                  const diff = Date.now() - mostRecentSync.getTime()
                  const mins = Math.floor(diff / 60000)
                  let timeAgo: string
                  if (mins < 1) timeAgo = 'just now'
                  else if (mins === 1) timeAgo = '1 min ago'
                  else if (mins < 60) timeAgo = `${mins} mins ago`
                  else {
                    const hours = Math.floor(mins / 60)
                    timeAgo = hours === 1 ? '1 hour ago' : `${hours} hours ago`
                  }
                  return <span>Last sync: {timeAgo}</span>
                }

                return <span>Waiting to sync...</span>
              })()}
            </div>
          )}
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
              onOpenExport={() => {
                setExportScope('current')
                setShowExportModal(true)
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a conversation to view
            </div>
          )}
        </div>
      </div>

      {/* Debug Toolbar */}
      {showDebugPanel && (
        <div className="h-10 flex items-center justify-between px-4 bg-yellow-700 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Debug Mode</span>
          </div>
          <div className="no-drag flex items-center gap-2">
            <button
              onClick={() => window.api?.debug.toggleChatGPTView()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Toggle ChatGPT WebContentsView visibility"
            >
              View ChatGPT
            </button>
            <button
              onClick={() => window.api?.debug.toggleClaudeView()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Toggle Claude WebContentsView visibility"
            >
              View Claude
            </button>
            <button
              onClick={() => window.api?.debug.togglePerplexityView()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Toggle Perplexity WebContentsView visibility"
            >
              View Perplexity
            </button>

            <button
              onClick={() => window.api?.debug.openChatGPTDevTools()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Open DevTools for ChatGPT WebContentsView"
            >
              DevTools (ChatGPT)
            </button>

            <button
              onClick={() => window.api?.debug.openClaudeDevTools()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Open DevTools for Claude WebContentsView"
            >
              DevTools (Claude)
            </button>
            <button
              onClick={() => window.api?.debug.openPerplexityDevTools()}
              className="text-xs px-2 py-1 bg-foreground text-background rounded active:bg-foreground/90"
              title="Open DevTools for Perplexity WebContentsView"
            >
              DevTools (Perplexity)
            </button>
          </div>
        </div>
      )}

      {/* Export modal */}
      <ExportModal
        conversationId={selectedConversation?.id}
        open={showExportModal}
        onOpenChange={(open) => {
          setShowExportModal(open)
          if (!open) {
            setExportScope(null)
          }
        }}
        preferredScope={exportScope ?? undefined}
      />

      {/* Settings modal */}
      <SettingsModal open={showSettingsModal} onOpenChange={setShowSettingsModal} />

      {/* Onboarding screen */}
      {!hasCompletedOnboarding && <OnboardingScreen onComplete={handleOnboardingComplete} />}
    </div>
  )
}
