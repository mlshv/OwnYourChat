import { describe, it, expect } from 'vitest'
import { ConversationFetchError, RateLimitGuard, isRateLimit, retryDelayMs } from '../fetch-guard'

const rateLimited = () => new ConversationFetchError(429, 'c1')
const serverError = () => new ConversationFetchError(500, 'c1')

describe('isRateLimit / retryDelayMs', () => {
  it('only treats HTTP 429 fetch errors as rate limits', () => {
    expect(isRateLimit(rateLimited())).toBe(true)
    expect(isRateLimit(serverError())).toBe(false)
    expect(isRateLimit(new Error('429'))).toBe(false)
  })

  it('backs off much longer for rate limits', () => {
    expect([0, 1, 2].map((a) => retryDelayMs(serverError(), a))).toEqual([1000, 2000, 4000])
    expect([0, 1, 2, 5].map((a) => retryDelayMs(rateLimited(), a))).toEqual([
      15_000, 45_000, 90_000, 90_000
    ])
  })

  it('names the status in the message', () => {
    expect(rateLimited().message).toContain('HTTP 429')
    expect(new ConversationFetchError(null, 'c2').message).not.toContain('HTTP')
  })
})

describe('RateLimitGuard', () => {
  it('cools down after the threshold of consecutive rate limits', () => {
    const guard = new RateLimitGuard(3, 60_000)
    expect(guard.recordFailure(rateLimited(), 0)).toBe(false)
    expect(guard.recordFailure(rateLimited(), 0)).toBe(false)
    expect(guard.recordFailure(rateLimited(), 1000)).toBe(true)
    expect(guard.coolingDown(1000)).toBe(true)
    expect(guard.coolingDown(61_000)).toBe(false)
  })

  it('resets the streak on success or a non-rate-limit failure', () => {
    const guard = new RateLimitGuard(2, 60_000)
    guard.recordFailure(rateLimited(), 0)
    guard.recordSuccess()
    expect(guard.recordFailure(rateLimited(), 0)).toBe(false)
    guard.recordFailure(serverError(), 0)
    expect(guard.recordFailure(rateLimited(), 0)).toBe(false)
    expect(guard.coolingDown(0)).toBe(false)
  })
})
