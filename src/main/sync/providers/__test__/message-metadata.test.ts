import { describe, expect, it } from 'vitest'
import {
  chatgptMessageMetadata,
  claudeMessageMetadata,
  perplexityMessageMetadata
} from '../message-metadata'
import { parseMessageMetadata } from '../../../../shared/message-metadata'
import perplexityFixture from '../perplexity/__test__/perplexity-conversation.json'
import claudeFixture from '../claude/__test__/claude-conversation.json'

describe('provider message metadata', () => {
  it('records actual ChatGPT model without assigning a model to a user', () => {
    const result = chatgptMessageMetadata({
      role: 'assistant',
      modelSlug: 'gpt-4o',
      finishReason: 'stop',
      updatedAt: '2026-09-15T12:00:00Z'
    })
    expect(result.model).toBe('gpt-4o')
    expect(result.updatedAt?.toISOString()).toBe('2026-09-15T12:00:00.000Z')
    expect(JSON.parse(result.metadata)).toEqual({ finishReason: 'stop' })
    expect(chatgptMessageMetadata({ role: 'user', modelSlug: 'gpt-4o' }).model).toBeUndefined()
  })

  it('keeps Perplexity display model separate from the selected model', () => {
    const entry = { ...perplexityFixture.entries[0], user_selected_model: 'auto' }
    const result = perplexityMessageMetadata(entry, 'assistant')
    expect(result.model).toBe(entry.display_model)
    expect(JSON.parse(result.metadata)).toEqual({
      selectedModel: 'auto',
      mode: entry.mode,
      searchFocus: entry.search_focus
    })
    expect(
      perplexityMessageMetadata({ user_selected_model: 'auto' }, 'assistant').model
    ).toBeUndefined()
    expect(perplexityMessageMetadata(entry, 'user').model).toBeUndefined()
  })

  it('retains Claude update time and stop reason without inventing a model', () => {
    const message = claudeFixture.chat_messages.find((m) => m.sender === 'assistant')!
    const result = claudeMessageMetadata(message)
    expect(result.model).toBeUndefined()
    expect(result.updatedAt).toEqual(new Date(message.updated_at))
    expect(JSON.parse(result.metadata)).toEqual({ finishReason: message.stop_reason })
    expect(claudeMessageMetadata({ ...message, model: 'claude-example' }).model).toBe(
      'claude-example'
    )
  })

  it('tolerates absent, invalid and unexpected provider values', () => {
    expect(
      chatgptMessageMetadata({ role: 'assistant', modelSlug: {}, updatedAt: 'bad' })
    ).toMatchObject({ model: undefined, updatedAt: undefined, metadata: '{}' })
    for (const value of [null, 'bad json', '[]', '42'])
      expect(parseMessageMetadata(value)).toEqual({})
    expect(
      parseMessageMetadata({ mode: ' COPILOT ', selectedModel: false, read_write_token: 'private' })
    ).toEqual({ mode: 'COPILOT' })
  })
})
