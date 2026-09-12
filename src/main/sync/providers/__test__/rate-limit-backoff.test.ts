import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BaseProvider } from '../base'
import type { ProviderName, SyncResult } from '../base'
import type { IStorage } from '../../../storage/interface'

// runSync() pushes state into the main-process Zustand store, which pulls in
// Electron; stub it out so the backoff logic can be tested in isolation.
vi.mock('../../../store.js', () => ({
  store: { getState: () => ({ updateProviderState: () => {} }) }
}))

/**
 * Minimal concrete provider so the abstract backoff logic can be exercised
 * without pulling in Electron.
 */
/* eslint-disable @typescript-eslint/no-empty-function -- stub implementations of the abstract provider surface */
class TestProvider extends BaseProvider {
  readonly name: ProviderName = 'claude'

  async sync(): Promise<SyncResult> {
    return { success: true }
  }
  showLogin(): void {}
  async logout(): Promise<void> {}
  getView(): null {
    return null
  }
  getHeaders(): null {
    return null
  }
  hideView(): void {}
  toggleView(): boolean {
    return false
  }
  isConnected(): boolean {
    return true
  }
  async restoreConnection(): Promise<void> {}
  async refreshAndPersistConversation(): Promise<null> {
    return null
  }
  async downloadAttachment(): Promise<string> {
    return ''
  }
  protected getDefaultMetadata(): Record<string, unknown> {
    return {}
  }

  // Expose protected members for assertions
  callIsRateLimitError(error: string | undefined): boolean {
    return this.isRateLimitError(error)
  }
  callApplyRateLimitBackoff(): number {
    return this.applyRateLimitBackoff()
  }
  get rateLimitedUntil(): number | null {
    return this._rateLimitedUntil
  }
}

const makeProvider = (): TestProvider => new TestProvider({} as IStorage)

const MINUTE = 60 * 1000

describe('isRateLimitError', () => {
  it('detects a 429 embedded in a provider error string', () => {
    const provider = makeProvider()
    expect(provider.callIsRateLimitError('Failed to fetch total count: 429')).toBe(true)
  })

  it('detects a textual rate limit message', () => {
    const provider = makeProvider()
    expect(provider.callIsRateLimitError('Rate limit exceeded')).toBe(true)
  })

  it('does not treat undefined or unrelated errors as rate limits', () => {
    const provider = makeProvider()
    expect(provider.callIsRateLimitError(undefined)).toBe(false)
    expect(provider.callIsRateLimitError('Request timed out')).toBe(false)
  })

  it('does not match a 429 that is part of a larger number', () => {
    const provider = makeProvider()
    expect(provider.callIsRateLimitError('Synced 4291 conversations')).toBe(false)
  })
})

describe('applyRateLimitBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('doubles the backoff on each consecutive rate limit', () => {
    const provider = makeProvider()

    expect(provider.callApplyRateLimitBackoff()).toBe(5 * MINUTE)
    expect(provider.callApplyRateLimitBackoff()).toBe(10 * MINUTE)
    expect(provider.callApplyRateLimitBackoff()).toBe(20 * MINUTE)
    expect(provider.callApplyRateLimitBackoff()).toBe(40 * MINUTE)
  })

  it('caps the backoff at 60 minutes', () => {
    const provider = makeProvider()

    for (let i = 0; i < 6; i++) {
      provider.callApplyRateLimitBackoff()
    }

    expect(provider.callApplyRateLimitBackoff()).toBe(60 * MINUTE)
  })

  it('sets the retry deadline relative to now', () => {
    const provider = makeProvider()

    provider.callApplyRateLimitBackoff()

    expect(provider.rateLimitedUntil).toBe(Date.now() + 5 * MINUTE)
  })
})

describe('runSync while rate limited', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Provider that always reports a 429, so repeated polls can be counted.
   */
  class RateLimitedProvider extends TestProvider {
    syncCalls = 0

    async sync(): Promise<SyncResult> {
      this.syncCalls++
      return { success: false, error: 'Failed to fetch total count: 429' }
    }

    async poll(): Promise<void> {
      await this.runSync()
    }
  }

  const makeRateLimited = (): RateLimitedProvider =>
    new RateLimitedProvider({ setProviderState: async () => {} } as unknown as IStorage)

  it('skips polls that land inside the backoff window', async () => {
    const provider = makeRateLimited()

    await provider.poll()
    expect(provider.syncCalls).toBe(1)

    // Four more one-minute polls, all inside the initial 5 minute backoff
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + MINUTE)
      await provider.poll()
    }

    expect(provider.syncCalls).toBe(1)
  })

  it('retries once the backoff window elapses', async () => {
    const provider = makeRateLimited()

    await provider.poll()
    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000)
    await provider.poll()

    expect(provider.syncCalls).toBe(2)
  })

  it('widens the window after each consecutive rate limit', async () => {
    const provider = makeRateLimited()

    await provider.poll()
    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000)
    await provider.poll()
    expect(provider.syncCalls).toBe(2)

    // Second failure escalates to a 10 minute window, so a 6 minute wait is short
    vi.setSystemTime(Date.now() + 6 * MINUTE)
    await provider.poll()
    expect(provider.syncCalls).toBe(2)

    vi.setSystemTime(Date.now() + 5 * MINUTE)
    await provider.poll()
    expect(provider.syncCalls).toBe(3)
  })

  it('resets the backoff after a successful sync', async () => {
    const provider = makeRateLimited()

    await provider.poll()
    expect(provider.rateLimitedUntil).not.toBeNull()

    provider.sync = async () => ({ success: true, newChatsFound: 0 })
    vi.setSystemTime(Date.now() + 5 * MINUTE + 1000)
    await provider.poll()

    expect(provider.rateLimitedUntil).toBeNull()
  })
})
