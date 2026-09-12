import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IStorage } from '../../../storage/interface'

// claude-provider pulls in Electron and the main-process entrypoint; stub the
// whole chain so fullSync's pagination logic can be exercised in isolation.
vi.mock('electron', () => ({
  WebContentsView: class {},
  session: { fromPartition: () => ({ setPermissionRequestHandler: () => {} }) }
}))
vi.mock('../../../index.js', () => ({ getMainWindow: () => null }))
vi.mock('../../../view-bounds-manager', () => ({
  viewBoundsManager: { register: () => {}, unregister: () => {}, updateBounds: () => {} }
}))
vi.mock('../../../settings.js', () => ({ getAttachmentsPath: () => '/tmp' }))
vi.mock('../../../store.js', () => ({
  store: {
    getState: () => ({ updateProviderState: () => {}, updateSyncState: () => {} })
  }
}))

const { ClaudeProvider } = await import('../claude-provider')

type PageResult = { items: unknown[]; has_more: boolean; error?: number }

/**
 * Builds a provider wired to a fake WebContentsView that replays `pages` in
 * order, recording every URL the injected script would have hit.
 */
const makeProvider = (
  pages: PageResult[]
): {
  provider: InstanceType<typeof ClaudeProvider>
  requestedUrls: string[]
  metadata: Record<string, unknown>
} => {
  const requestedUrls: string[] = []
  let pageIndex = 0

  const metadata: Record<string, unknown> = {
    lastCompletedOffset: 0,
    isFullSyncComplete: false
  }

  const storage = {
    getProviderState: async () => ({ metadata }),
    setProviderState: async (state: { metadata?: Record<string, unknown> }) => {
      if (state.metadata) Object.assign(metadata, state.metadata)
    },
    updateConversationSyncError: async () => {},
    getMaxUpdatedAt: async () => null
  } as unknown as IStorage

  const provider = new ClaudeProvider(storage)

  const view = {
    webContents: {
      getURL: () => 'https://claude.ai/',
      loadURL: async () => {},
      executeJavaScript: async (script: string) => {
        const url = script.match(/'(https:\/\/claude\.ai\/api\/[^']+)'/)?.[1]
        if (url) requestedUrls.push(url)
        return pages[pageIndex++] ?? { items: [], has_more: false }
      }
    }
  }

  // Stand in for a live login session
  Object.assign(provider, {
    view,
    capturedHeaders: { cookie: 'x' },
    organizationId: 'org-1'
  })
  // Conversation bodies are out of scope here; only pagination is under test
  Object.assign(provider, { syncConversation: async () => {} })

  return { provider, requestedUrls, metadata }
}

const makeItems = (count: number, offset: number): unknown[] =>
  Array.from({ length: count }, (_, i) => ({
    uuid: `conv-${offset + i}`,
    name: `Conversation ${offset + i}`,
    summary: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    current_leaf_message_uuid: null
  }))

describe('ClaudeProvider full sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never calls the rate-limited count_all endpoint', async () => {
    const { provider, requestedUrls } = makeProvider([{ items: makeItems(5, 0), has_more: false }])

    await provider.sync()

    expect(requestedUrls.length).toBeGreaterThan(0)
    expect(requestedUrls.some((url) => url.includes('count_all'))).toBe(false)
  })

  it('stops paginating when has_more is false', async () => {
    const { provider, requestedUrls, metadata } = makeProvider([
      { items: makeItems(30, 0), has_more: true },
      { items: makeItems(30, 30), has_more: true },
      { items: makeItems(12, 60), has_more: false }
    ])

    const result = await provider.sync()

    expect(result).toEqual({ success: true, newChatsFound: 72 })
    expect(requestedUrls).toHaveLength(3)
    expect(requestedUrls[0]).toContain('offset=0')
    expect(requestedUrls[1]).toContain('offset=30')
    expect(requestedUrls[2]).toContain('offset=60')
    expect(metadata.isFullSyncComplete).toBe(true)
  })

  it('surfaces a page-level 429 as a retryable error the backoff can detect', async () => {
    const { provider } = makeProvider([{ items: [], has_more: false, error: 429 }])

    const result = await provider.sync()

    expect(result.success).toBe(false)
    expect(result.error).toContain('429')
  })
})
