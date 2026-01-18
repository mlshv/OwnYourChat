import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ExportProgress, Conversation, Message, ExportOptions } from '@shared/types'
import type { ExportContext } from '../index'

// Mock database operations - use the correct path that matches how it's imported in index.ts
vi.mock('../../db/operations.js', () => ({
  getConversationWithMessages: vi.fn(),
  listConversations: vi.fn(),
  updateAttachmentLocalPath: vi.fn()
}))

// Mock markdown and json exports
vi.mock('../markdown.js', () => ({
  exportToMarkdown: vi.fn().mockResolvedValue('/path/to/export.md')
}))

vi.mock('../json.js', () => ({
  exportToJson: vi.fn().mockResolvedValue('/path/to/export.json')
}))

// Import after mocks are set up
import * as dbOps from '../../db/operations.js'
import { exportConversation, exportAllConversations } from '../index'

const db = dbOps as unknown as {
  getConversationWithMessages: MockedFunction<typeof dbOps.getConversationWithMessages>
  listConversations: MockedFunction<typeof dbOps.listConversations>
  updateAttachmentLocalPath: MockedFunction<typeof dbOps.updateAttachmentLocalPath>
}

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

// Helper to create a minimal message with attachments
function createMessageWithAttachment(
  id: string,
  attachmentId: string,
  hasLocalPath: boolean
): Message {
  return {
    id,
    conversationId: 'test-conv-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    createdAt: new Date('2026-01-07T10:00:00Z'),
    orderIndex: 0,
    parentId: null,
    siblingIds: [id],
    siblingIndex: 0,
    attachments: [
      {
        id: attachmentId,
        messageId: id,
        type: 'file',
        filename: `file-${attachmentId}.txt`,
        fileId: `file-id-${attachmentId}`,
        localPath: hasLocalPath ? `/path/to/cached/${attachmentId}.txt` : '',
        originalUrl: '',
        mimeType: 'text/plain',
        size: 100
      }
    ]
  }
}

function createMessageWithoutAttachment(id: string): Message {
  return {
    id,
    conversationId: 'test-conv-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    createdAt: new Date('2026-01-07T10:00:00Z'),
    orderIndex: 0,
    parentId: null,
    siblingIds: [id],
    siblingIndex: 0,
    attachments: []
  }
}

describe('Cumulative progress tracking in batch export', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-progress-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should track cumulative progress across multiple conversations', async () => {
    // Set up 3 conversations with varying attachment counts
    // Conv 1: 2 missing attachments
    // Conv 2: 1 missing attachment
    // Conv 3: 3 missing attachments
    // Total: 6 missing attachments

    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const conv2 = createConversation({ id: 'conv-2', title: 'Conv 2' })
    const conv3 = createConversation({ id: 'conv-3', title: 'Conv 3' })

    // Messages with missing attachments (localPath = false means missing)
    const conv1Messages = [
      createMessageWithAttachment('msg-1-1', 'att-1', false),
      createMessageWithAttachment('msg-1-2', 'att-2', false)
    ]
    const conv2Messages = [createMessageWithAttachment('msg-2-1', 'att-3', false)]
    const conv3Messages = [
      createMessageWithAttachment('msg-3-1', 'att-4', false),
      createMessageWithAttachment('msg-3-2', 'att-5', false),
      createMessageWithAttachment('msg-3-3', 'att-6', false)
    ]

    // Mock listConversations
    db.listConversations.mockResolvedValue({
      items: [conv1, conv2, conv3],
      total: 3,
      hasMore: false
    })

    // Mock getConversationWithMessages - called twice per conversation
    // (once for counting, once for export)
    const makeResult = (conv: Conversation, msgs: Message[]) => ({
      conversation: conv,
      messages: msgs,
      hasMoreMessages: false,
      oldestLoadedOrderIndex: null
    })
    db.getConversationWithMessages
      .mockResolvedValueOnce(makeResult(conv1, conv1Messages)) // counting
      .mockResolvedValueOnce(makeResult(conv2, conv2Messages)) // counting
      .mockResolvedValueOnce(makeResult(conv3, conv3Messages)) // counting
      .mockResolvedValueOnce(makeResult(conv1, conv1Messages)) // export
      .mockResolvedValueOnce(makeResult(conv2, conv2Messages)) // export
      .mockResolvedValueOnce(makeResult(conv3, conv3Messages)) // export

    // Collect progress events
    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    await exportAllConversations(options, context)

    // Filter for download phase progress events
    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')

    // All download progress events should have total = 6
    // The actual count is 6 (2 + 1 + 3 missing attachments)
    expect(downloadProgress.length).toBeGreaterThan(0)

    // All download events should have the same total
    const uniqueTotals = new Set(downloadProgress.map((p) => p.total))
    expect(uniqueTotals.size).toBe(1)
    expect(uniqueTotals.has(6)).toBe(true)

    // Current should increment across all conversations
    const currents = downloadProgress.map((p) => p.current)
    // Each download emits progress before downloading, so currents start at 0
    // and increment up to 5 (0, 1, 2, 3, 4, 5)
    expect(currents).toContain(0)
    expect(Math.max(...currents)).toBeLessThanOrEqual(5)
  })

  it('should not reset progress total per conversation', async () => {
    // This is the bug we're fixing: progress should not reset per conversation
    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const conv2 = createConversation({ id: 'conv-2', title: 'Conv 2' })

    const conv1Messages = [
      createMessageWithAttachment('msg-1-1', 'att-1', false),
      createMessageWithAttachment('msg-1-2', 'att-2', false),
      createMessageWithAttachment('msg-1-3', 'att-3', false)
    ]
    const conv2Messages = [
      createMessageWithAttachment('msg-2-1', 'att-4', false),
      createMessageWithAttachment('msg-2-2', 'att-5', false)
    ]

    db.listConversations.mockResolvedValue({
      items: [conv1, conv2],
      total: 2,
      hasMore: false
    })

    const makeResult2 = (conv: Conversation, msgs: Message[]) => ({
      conversation: conv,
      messages: msgs,
      hasMoreMessages: false,
      oldestLoadedOrderIndex: null
    })
    db.getConversationWithMessages
      .mockResolvedValueOnce(makeResult2(conv1, conv1Messages)) // counting
      .mockResolvedValueOnce(makeResult2(conv2, conv2Messages)) // counting
      .mockResolvedValueOnce(makeResult2(conv1, conv1Messages)) // export
      .mockResolvedValueOnce(makeResult2(conv2, conv2Messages)) // export

    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    await exportAllConversations(options, context)

    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')

    // The bug was: total would reset from 3 to 2 when moving to conv2
    // After fix: total should stay at 5 throughout
    for (const progress of downloadProgress) {
      expect(progress.total).toBe(5)
    }

    // Verify current never exceeds what we've actually downloaded
    for (const progress of downloadProgress) {
      expect(progress.current).toBeLessThanOrEqual(progress.total)
    }
  })

  it('should skip attachments that are already downloaded', async () => {
    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })

    // 2 attachments: one already downloaded, one missing
    const messages = [
      createMessageWithAttachment('msg-1', 'att-1', true), // already downloaded
      createMessageWithAttachment('msg-2', 'att-2', false) // needs download
    ]

    // Mock fs.existsSync for cached attachments
    const originalExistsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      const pathStr = p.toString()
      if (pathStr.includes('att-1')) return true
      if (pathStr.includes('att-2')) return false
      return originalExistsSync(p)
    })

    db.listConversations.mockResolvedValue({
      items: [conv1],
      total: 1,
      hasMore: false
    })

    db.getConversationWithMessages
      .mockResolvedValueOnce({
        conversation: conv1,
        messages,
        hasMoreMessages: false,
        oldestLoadedOrderIndex: null
      }) // counting
      .mockResolvedValueOnce({
        conversation: conv1,
        messages,
        hasMoreMessages: false,
        oldestLoadedOrderIndex: null
      }) // export

    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    await exportAllConversations(options, context)

    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')

    // Only 1 attachment needs downloading
    for (const progress of downloadProgress) {
      expect(progress.total).toBe(1)
    }

    // downloadAttachment should only be called once
    expect(mockProvider.downloadAttachment).toHaveBeenCalledTimes(1)
  })

  it('should not count attachments when includeAttachments is false', async () => {
    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const messages = [
      createMessageWithAttachment('msg-1', 'att-1', false),
      createMessageWithAttachment('msg-2', 'att-2', false)
    ]

    db.listConversations.mockResolvedValue({
      items: [conv1],
      total: 1,
      hasMore: false
    })

    db.getConversationWithMessages.mockResolvedValue({
      conversation: conv1,
      messages,
      hasMoreMessages: false,
      oldestLoadedOrderIndex: null
    })

    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: false, // Not including attachments
      outputPath: tempDir
    }

    await exportAllConversations(options, context)

    // Should only have exporting progress, no downloading
    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')
    expect(downloadProgress).toHaveLength(0)

    // downloadAttachment should never be called
    expect(mockProvider.downloadAttachment).not.toHaveBeenCalled()
  })

  it('should handle conversations with no attachments gracefully', async () => {
    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const conv2 = createConversation({ id: 'conv-2', title: 'Conv 2' })

    // Conv1 has no attachments, conv2 has 2
    const conv1Messages = [createMessageWithoutAttachment('msg-1')]
    const conv2Messages = [
      createMessageWithAttachment('msg-2-1', 'att-1', false),
      createMessageWithAttachment('msg-2-2', 'att-2', false)
    ]

    db.listConversations.mockResolvedValue({
      items: [conv1, conv2],
      total: 2,
      hasMore: false
    })

    const makeResult3 = (conv: Conversation, msgs: Message[]) => ({
      conversation: conv,
      messages: msgs,
      hasMoreMessages: false,
      oldestLoadedOrderIndex: null
    })
    db.getConversationWithMessages
      .mockResolvedValueOnce(makeResult3(conv1, conv1Messages)) // counting
      .mockResolvedValueOnce(makeResult3(conv2, conv2Messages)) // counting
      .mockResolvedValueOnce(makeResult3(conv1, conv1Messages)) // export
      .mockResolvedValueOnce(makeResult3(conv2, conv2Messages)) // export

    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    await exportAllConversations(options, context)

    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')

    // Total should be 2 (only from conv2)
    for (const progress of downloadProgress) {
      expect(progress.total).toBe(2)
    }
  })

  it('should abort counting when signal is aborted', async () => {
    const conv1 = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const conv2 = createConversation({ id: 'conv-2', title: 'Conv 2' })

    const controller = new AbortController()

    db.listConversations.mockResolvedValue({
      items: [conv1, conv2],
      total: 2,
      hasMore: false
    })

    // Abort during counting of conv1
    db.getConversationWithMessages.mockImplementation(async () => {
      controller.abort()
      return {
        conversation: conv1,
        messages: [createMessageWithAttachment('msg-1', 'att-1', false)],
        hasMoreMessages: false,
        oldestLoadedOrderIndex: null
      }
    })

    const context: ExportContext = {
      provider: null,
      signal: controller.signal
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    await expect(exportAllConversations(options, context)).rejects.toThrow('Export cancelled')
  })
})

describe('exportConversation with cumulative progress', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-conv-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should use cumulative progress when provided', async () => {
    const conv = createConversation({ id: 'conv-1', title: 'Conv 1' })
    const messages = [
      createMessageWithAttachment('msg-1', 'att-1', false),
      createMessageWithAttachment('msg-2', 'att-2', false)
    ]

    db.getConversationWithMessages.mockResolvedValue({
      conversation: conv,
      messages,
      hasMoreMessages: false,
      oldestLoadedOrderIndex: null
    })

    const progressEvents: ExportProgress[] = []
    const mockProvider = {
      downloadAttachment: vi.fn().mockResolvedValue('/path/to/downloaded.txt')
    }

    const context: ExportContext = {
      provider: mockProvider as unknown as ExportContext['provider'],
      onProgress: (progress) => progressEvents.push({ ...progress })
    }

    const options: ExportOptions = {
      format: 'json',
      includeAttachments: true,
      outputPath: tempDir
    }

    // Simulate being part of a batch with 10 total attachments, 5 already done
    const cumulativeProgress = { downloaded: 5, total: 10 }

    await exportConversation('conv-1', options, context, cumulativeProgress)

    const downloadProgress = progressEvents.filter((p) => p.phase === 'downloading')

    // Should use the cumulative total of 10
    for (const progress of downloadProgress) {
      expect(progress.total).toBe(10)
    }

    // Current should start from 5 and increment
    expect(downloadProgress[0].current).toBe(5)
    expect(downloadProgress[1].current).toBe(6)

    // Cumulative progress should be updated
    expect(cumulativeProgress.downloaded).toBe(7) // 5 + 2 attachments
  })
})
