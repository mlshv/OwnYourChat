import { describe, it, expect, vi } from 'vitest'
import { openFileCitation } from '../file-citations'
import type { MessagePart } from '../../shared/types'

const marker = '\uE200filecite\uE202turn0file1\uE202L42-L98\uE201'
const reference = { marker, fileId: 'file_test', filename: 'report.pdf' }
const makeDeps = (
  parts: MessagePart[] = [{ type: 'text', text: marker, fileCitations: [reference] }]
) => ({
  loadMessage: vi.fn(async () => ({ provider: 'chatgpt', conversationId: 'conversation', parts })),
  downloadFile: vi.fn(async () => '/cached/report.pdf'),
  openPath: vi.fn(async () => ''),
  openExternal: vi.fn(async () => {})
})

describe('openFileCitation', () => {
  it('resolves the stored file ID, uses the provider cache/download, and opens the returned path', async () => {
    const deps = makeDeps()
    expect(await openFileCitation('message', marker, deps)).toEqual({ success: true })
    expect(deps.downloadFile).toHaveBeenCalledWith('file_test', 'report.pdf', 'conversation')
    expect(deps.openPath).toHaveBeenCalledWith('/cached/report.pdf')
  })
  it('rejects forged references and executable cloud URLs', async () => {
    const deps = makeDeps()
    expect((await openFileCitation('message', 'file_forged', deps)).success).toBe(false)
    expect(deps.downloadFile).not.toHaveBeenCalled()
    const unsafe = makeDeps([
      { type: 'text', text: marker, fileCitations: [{ marker, url: 'javascript:alert(1)' }] }
    ])
    expect((await openFileCitation('message', marker, unsafe)).success).toBe(false)
    expect(unsafe.openExternal).not.toHaveBeenCalled()
  })
  it('allows a saved HTTPS cloud document and surfaces download/open failures', async () => {
    const cloud = makeDeps([
      {
        type: 'text',
        text: marker,
        fileCitations: [{ marker, url: 'https://example.com/document' }]
      }
    ])
    expect((await openFileCitation('message', marker, cloud)).success).toBe(true)
    expect(cloud.openExternal).toHaveBeenCalledWith('https://example.com/document')
    const failing = makeDeps()
    failing.downloadFile.mockRejectedValueOnce(new Error('Offline'))
    expect(await openFileCitation('message', marker, failing)).toEqual({
      success: false,
      error: 'Offline'
    })
    expect(failing.openPath).not.toHaveBeenCalled()
    failing.openPath.mockResolvedValueOnce('Could not open document')
    expect((await openFileCitation('message', marker, failing)).error).toBe(
      'Could not open document'
    )
  })
  it('does not accept filename paths or traversal in file IDs', async () => {
    const deps = makeDeps([
      {
        type: 'text',
        text: marker,
        fileCitations: [{ ...reference, filename: '../../report.pdf' }]
      }
    ])
    await openFileCitation('message', marker, deps)
    expect(deps.downloadFile).toHaveBeenCalledWith('file_test', 'report.pdf', 'conversation')
    const invalid = makeDeps([
      { type: 'text', text: marker, fileCitations: [{ ...reference, fileId: '../../file' }] }
    ])
    expect((await openFileCitation('message', marker, invalid)).success).toBe(false)
    expect(invalid.downloadFile).not.toHaveBeenCalled()
  })
})
