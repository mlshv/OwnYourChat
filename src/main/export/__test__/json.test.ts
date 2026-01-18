import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exportToJson } from '../json'
import type { Conversation, Message, ExportOptions, SourceUrlPart } from '@shared/types'

// Helper to create a minimal conversation
function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'test-conv-1',
    title: 'Test Conversation',
    provider: 'chatgpt',
    createdAt: new Date('2026-01-07T10:00:00Z'),
    updatedAt: new Date('2026-01-07T11:00:00Z'),
    syncedAt: new Date('2026-01-07T12:00:00Z'),
    messageCount: 2,
    currentNodeId: null,
    ...overrides
  }
}

// Helper to create a minimal message
function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'test-msg-1',
    conversationId: 'test-conv-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello, world!' }],
    createdAt: new Date('2026-01-07T10:00:00Z'),
    orderIndex: 0,
    parentId: null,
    siblingIds: ['test-msg-1'],
    siblingIndex: 0,
    ...overrides
  }
}

describe('exportToJson', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'))
  })

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should export conversation in OpenAI-compatible format', async () => {
    const conversation = createConversation()
    const messages = [
      createMessage({ id: 'msg-1', role: 'user' }),
      createMessage({
        id: 'msg-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there!' }],
        parentId: 'msg-1',
        orderIndex: 1
      })
    ]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)

    // Verify file was created
    expect(fs.existsSync(exportPath)).toBe(true)

    // Parse the exported JSON
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // Verify top-level fields
    expect(exported.id).toBe(conversation.id)
    expect(exported.title).toBe(conversation.title)
    expect(exported.provider).toBe(conversation.provider)
    expect(exported.created_at).toBe(Math.floor(conversation.createdAt.getTime() / 1000))
    expect(exported.updated_at).toBe(Math.floor(conversation.updatedAt.getTime() / 1000))
    expect(exported.exported_at).toBeDefined()
    expect(exported.message_count).toBe(2)

    // Verify messages array
    expect(exported.messages).toHaveLength(2)

    // Verify first message
    expect(exported.messages[0].id).toBe('msg-1')
    expect(exported.messages[0].role).toBe('user')
    expect(exported.messages[0].content).toBe('Hello, world!')
    expect(exported.messages[0].created_at).toBeTypeOf('number')
    expect(exported.messages[0].parent_id).toBeNull()

    // Verify second message
    expect(exported.messages[1].id).toBe('msg-2')
    expect(exported.messages[1].role).toBe('assistant')
    expect(exported.messages[1].content).toBe('Hi there!')
    expect(exported.messages[1].parent_id).toBe('msg-1')
  })

  it('should flatten parts to content string', async () => {
    const conversation = createConversation()
    const messages = [
      createMessage({
        parts: [
          { type: 'text', text: 'First paragraph.' },
          { type: 'text', text: 'Second paragraph.' }
        ]
      })
    ]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // Content should be flattened with newlines between text parts
    expect(exported.messages[0].content).toBe('First paragraph.\nSecond paragraph.')
  })

  it('should extract sources from source-url parts', async () => {
    const conversation = createConversation()
    const messages = [
      createMessage({
        parts: [
          { type: 'text', text: 'Here is some info' },
          {
            type: 'source-url',
            sourceId: 'src-1',
            url: 'https://example.com/article',
            title: 'Example Article'
          } as SourceUrlPart,
          { type: 'text', text: ' and more info' },
          {
            type: 'source-url',
            sourceId: 'src-2',
            url: 'https://other.com'
          } as SourceUrlPart
        ]
      })
    ]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // Content should only include text parts
    expect(exported.messages[0].content).toBe('Here is some info\n and more info')

    // Sources should be extracted
    expect(exported.messages[0].sources).toHaveLength(2)
    expect(exported.messages[0].sources[0]).toEqual({
      title: 'Example Article',
      url: 'https://example.com/article'
    })
    // Second source has no title
    expect(exported.messages[0].sources[1]).toEqual({
      url: 'https://other.com'
    })
  })

  it('should not include sources field when there are no sources', async () => {
    const conversation = createConversation()
    const messages = [createMessage()]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // sources field should not be present
    expect(exported.messages[0].sources).toBeUndefined()
  })

  it('should use snake_case for field names', async () => {
    const conversation = createConversation()
    const messages = [createMessage()]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // Top-level fields should be snake_case
    expect('created_at' in exported).toBe(true)
    expect('updated_at' in exported).toBe(true)
    expect('exported_at' in exported).toBe(true)
    expect('message_count' in exported).toBe(true)

    // Old camelCase fields should not exist
    expect('createdAt' in exported).toBe(false)
    expect('updatedAt' in exported).toBe(false)
    expect('exportedAt' in exported).toBe(false)
    expect('messageCount' in exported).toBe(false)

    // Message fields should be snake_case
    expect('created_at' in exported.messages[0]).toBe(true)
    expect('parent_id' in exported.messages[0]).toBe(true)

    // Old message camelCase fields should not exist
    expect('createdAt' in exported.messages[0]).toBe(false)
    expect('parentId' in exported.messages[0]).toBe(false)
    expect('orderIndex' in exported.messages[0]).toBe(false)
    expect('parts' in exported.messages[0]).toBe(false)
  })

  it('should include provider field', async () => {
    const conversation = createConversation({ provider: 'perplexity' })
    const messages = [createMessage()]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    expect(exported.provider).toBe('perplexity')
  })

  it('should convert timestamps to Unix seconds', async () => {
    const createdAt = new Date('2026-01-07T10:00:00Z')
    const updatedAt = new Date('2026-01-07T11:00:00Z')
    const msgCreatedAt = new Date('2026-01-07T10:30:00Z')

    const conversation = createConversation({ createdAt, updatedAt })
    const messages = [createMessage({ createdAt: msgCreatedAt })]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // Unix timestamps should be in seconds, not milliseconds
    expect(exported.created_at).toBe(Math.floor(createdAt.getTime() / 1000))
    expect(exported.updated_at).toBe(Math.floor(updatedAt.getTime() / 1000))
    expect(exported.messages[0].created_at).toBe(Math.floor(msgCreatedAt.getTime() / 1000))
  })

  it('should add date prefix to folder name when prefixTimestamp is true', async () => {
    const conversation = createConversation({ createdAt: new Date('2026-01-07T10:00:00Z') })
    const messages = [createMessage()]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      prefixTimestamp: true,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)

    // The folder should have date prefix
    expect(exportPath).toContain('2026-01-07')
  })

  it('should handle messages with null parent_id (root messages)', async () => {
    const conversation = createConversation()
    const messages = [
      createMessage({ id: 'root-msg', parentId: null }),
      createMessage({ id: 'child-msg', parentId: 'root-msg' })
    ]
    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    expect(exported.messages[0].parent_id).toBeNull()
    expect(exported.messages[1].parent_id).toBe('root-msg')
  })
})

describe('JSON export format compatibility', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-compat-'))
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should produce valid JSON that matches spec format', async () => {
    const conversation = createConversation({
      id: 'conv-abc123',
      title: 'My Conversation',
      provider: 'chatgpt',
      createdAt: new Date('2024-01-07T10:00:00Z'),
      updatedAt: new Date('2024-01-07T11:00:00Z')
    })

    const messages = [
      createMessage({
        id: 'msg-xyz789',
        role: 'user',
        parts: [{ type: 'text', text: 'What is the capital of France?' }],
        createdAt: new Date('2024-01-07T10:00:00Z'),
        parentId: null
      }),
      createMessage({
        id: 'msg-abc456',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'The capital of France is Paris.' },
          {
            type: 'source-url',
            sourceId: 'src-1',
            url: 'https://en.wikipedia.org/wiki/Paris',
            title: 'Wikipedia - Paris'
          } as SourceUrlPart
        ],
        createdAt: new Date('2024-01-07T10:00:05Z'),
        parentId: 'msg-xyz789',
        orderIndex: 1
      })
    ]

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false,
      outputPath: tempDir
    }

    const exportPath = await exportToJson(conversation, messages, options)
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))

    // This matches the expected format from the spec:
    // {
    //   "id": "conv-abc123",
    //   "title": "My Conversation",
    //   "provider": "chatgpt",
    //   "created_at": 1704621600,  (Unix timestamp)
    //   "updated_at": 1704621700,
    //   "exported_at": "2026-01-07T10:00:00Z",
    //   "message_count": 10,
    //   "messages": [...]
    // }

    expect(exported).toMatchObject({
      id: 'conv-abc123',
      title: 'My Conversation',
      provider: 'chatgpt',
      message_count: 2
    })

    expect(typeof exported.created_at).toBe('number')
    expect(typeof exported.updated_at).toBe('number')
    expect(typeof exported.exported_at).toBe('string')

    // Verify message format matches spec
    expect(exported.messages[0]).toMatchObject({
      id: 'msg-xyz789',
      role: 'user',
      content: 'What is the capital of France?',
      parent_id: null
    })

    expect(exported.messages[1]).toMatchObject({
      id: 'msg-abc456',
      role: 'assistant',
      content: 'The capital of France is Paris.',
      parent_id: 'msg-xyz789'
    })

    // Sources should be extracted
    expect(exported.messages[1].sources).toEqual([
      { title: 'Wikipedia - Paris', url: 'https://en.wikipedia.org/wiki/Paris' }
    ])
  })
})
