// Shared handling for failed conversation downloads.
// Before this, a refused download (e.g. HTTP 429) was saved as an empty chat and
// counted as success, which silently lost most of a ChatGPT history.

/** sync_retry_count value meaning "fetched fine and genuinely has no messages" */
export const VERIFIED_EMPTY = -1

export class ConversationFetchError extends Error {
  constructor(
    readonly status: number | null,
    conversationId: string
  ) {
    super(`Fetching conversation ${conversationId} failed${status ? ` (HTTP ${status})` : ''}`)
    this.name = 'ConversationFetchError'
  }
}

/** Thrown to stop the current sync while the provider cools down after repeated 429s */
export class RateLimitedError extends Error {
  constructor(readonly untilMs: number) {
    super(`Rate limited; pausing until ${new Date(untilMs).toLocaleTimeString()}`)
    this.name = 'RateLimitedError'
  }
}

export const isRateLimit = (error: unknown): boolean =>
  error instanceof ConversationFetchError && error.status === 429

/** Delay before retry number `attempt` (0-based). Rate limits wait much longer. */
export function retryDelayMs(error: unknown, attempt: number): number {
  if (isRateLimit(error)) return [15_000, 45_000, 90_000][Math.min(attempt, 2)]
  return 2 ** attempt * 1000
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Counts consecutive rate-limited failures and starts a cool-down past a threshold. */
export class RateLimitGuard {
  private consecutive = 0
  until = 0

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 15 * 60_000
  ) {}

  coolingDown(now = Date.now()): boolean {
    return now < this.until
  }

  recordSuccess(): void {
    this.consecutive = 0
  }

  /** Returns true when this failure starts a cool-down. */
  recordFailure(error: unknown, now = Date.now()): boolean {
    if (!isRateLimit(error)) {
      this.consecutive = 0
      return false
    }
    this.consecutive++
    if (this.consecutive >= this.threshold) {
      this.until = now + this.cooldownMs
      this.consecutive = 0
      return true
    }
    return false
  }
}
