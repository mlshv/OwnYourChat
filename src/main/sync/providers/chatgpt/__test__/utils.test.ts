import { describe, it, expect } from 'vitest'
import { transformChatGPTMessageToParts } from '../utils'
import type { SourceUrlPart, TextPart } from '@shared/types'
import conversationData from './chatgpt-conversation.json'

describe('transformChatGPTMessageToParts', () => {
  it('preserves all sources in current grouped citations, including supporting websites', () => {
    const marker = '\uE200cite\uE202turn608629search0\uE202turn608629search1\uE201'
    const result = transformChatGPTMessageToParts({
      content: `Evidence ${marker}.`,
      contentReferences: [
        {
          type: 'grouped_webpages',
          matched_text: marker,
          items: [
            {
              title: 'Primary',
              url: 'https://example.com/primary',
              supporting_websites: [
                { title: 'Supporting', url: 'https://example.com/supporting' },
                { url: 'https://example.com/primary' }
              ]
            }
          ]
        }
      ]
    })
    expect(result.filter((p) => p.type === 'source-url').map((p) => p.url)).toEqual([
      'https://example.com/primary',
      'https://example.com/supporting'
    ])
    expect(result.filter((p) => p.type === 'text')).toEqual([
      { type: 'text', text: 'Evidence ' },
      { type: 'text', text: '.' }
    ])
  })

  it('supports fallback items and repeated current markers', () => {
    const marker = '\uE200cite\uE202turn608629search0\uE201'
    const result = transformChatGPTMessageToParts({
      content: `${marker} and ${marker}`,
      contentReferences: [
        {
          type: 'grouped_webpages',
          matched_text: marker,
          items: [],
          fallback_items: [{ url: 'https://example.com/source' }]
        }
      ]
    })
    expect(result.filter((p) => p.type === 'source-url')).toHaveLength(2)
    expect(result.filter((p) => p.type === 'text')).toEqual([{ type: 'text', text: ' and ' }])
  })

  it('retains unresolved modern citations and rejects non-web URLs', () => {
    const marker = '\uE200cite\uE202turn608629search0\uE201'
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a URL']) {
      const result = transformChatGPTMessageToParts({
        content: marker,
        contentReferences: [{ type: 'grouped_webpages', matched_text: marker, items: [{ url }] }]
      })
      expect(result).toEqual([{ type: 'text', text: marker }])
    }
    expect(transformChatGPTMessageToParts({ content: marker })).toEqual([
      { type: 'text', text: marker }
    ])
  })

  it('should transform message without citations into single text part', () => {
    const input = {
      content: 'This is a simple message without any citations.',
      contentReferences: []
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: 'text',
      text: 'This is a simple message without any citations.'
    })
  })

  it('should transform message with undefined contentReferences into single text part', () => {
    const input = {
      content: 'Another simple message.'
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
  })

  it('should split text and citations into alternating parts', () => {
    const input = {
      content: 'Bengal cats appeared in films【19†L313-L316】 and became popular.',
      contentReferences: [
        {
          matched_text: '【19†L313-L316】',
          type: 'webpage_extended' as const,
          title: 'Bengal Cats in Movies',
          url: 'https://example.com/bengals',
          snippet: 'Bengal cats in film history',
          attribution: 'example.com'
        }
      ]
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(3)

    // First text part
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Bengal cats appeared in films')

    // Source citation
    expect(result[1].type).toBe('source-url')
    const sourceUrl = result[1] as SourceUrlPart
    expect(sourceUrl.url).toBe('https://example.com/bengals')
    expect(sourceUrl.title).toBe('Bengal Cats in Movies')
    expect(sourceUrl.attribution).toBe('example.com')
    expect(sourceUrl.sourceId).toBeDefined()

    // Final text part
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' and became popular.')
  })

  it('should handle multiple citations in sequence', () => {
    const input = {
      content: 'First【1†source】 second【2†source】 third.',
      contentReferences: [
        {
          matched_text: '【1†source】',
          type: 'webpage' as const,
          url: 'https://one.com'
        },
        {
          matched_text: '【2†source】',
          type: 'webpage' as const,
          url: 'https://two.com'
        }
      ]
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(5)
    expect(result[0].type).toBe('text')
    expect(result[1].type).toBe('source-url')
    expect(result[2].type).toBe('text')
    expect(result[3].type).toBe('source-url')
    expect(result[4].type).toBe('text')
  })

  it('should skip citations without URLs', () => {
    const input = {
      content: 'Text with【1†image】 inline image.',
      contentReferences: [
        {
          matched_text: '【1†image】',
          type: 'image_inline' as const
          // No url field
        }
      ]
    }

    const result = transformChatGPTMessageToParts(input)

    // Should only have text parts, citation is skipped
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Text with')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe(' inline image.')
  })

  it('should handle real conversation data from Bengal cat discussion', () => {
    // Find the message with content_references
    const messageNode = conversationData.mapping['7eddf1cd-58b1-4fe7-928a-f39157dd4bc2']
    const message = messageNode.message
    const content = message.content.parts[0]
    const contentReferences = message.metadata.content_references as {
      matched_text: string
      type: 'webpage' | 'webpage_extended' | 'image_inline'
      title?: string
      url?: string
      snippet?: string
      attribution?: string
    }[]

    const input = {
      content,
      contentReferences
    }

    const result = transformChatGPTMessageToParts(input)

    // Should have mixed text and source-url parts
    expect(result.length).toBeGreaterThan(1)

    // Check we have both types
    const textParts = result.filter((p) => p.type === 'text')
    const sourceParts = result.filter((p) => p.type === 'source-url')

    expect(textParts.length).toBeGreaterThan(0)
    expect(sourceParts.length).toBeGreaterThan(0)

    // Verify source parts have proper structure
    sourceParts.forEach((part) => {
      const source = part as SourceUrlPart
      expect(source.sourceId).toBeDefined()
      expect(source.url).toBeDefined()
      expect(source.url).toMatch(/^https?:\/\//)
    })

    // Verify content is split correctly - first part should start with "# Cultural"
    expect((textParts[0] as TextPart).text).toContain('# Cultural and Media Appearances')
  })

  it('should handle citations at the start of content', () => {
    const input = {
      content: '【1†source】Starting with a citation.',
      contentReferences: [
        {
          matched_text: '【1†source】',
          type: 'webpage' as const,
          url: 'https://example.com'
        }
      ]
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('source-url')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe('Starting with a citation.')
  })

  it('should handle citations at the end of content', () => {
    const input = {
      content: 'Ending with a citation【1†source】',
      contentReferences: [
        {
          matched_text: '【1†source】',
          type: 'webpage' as const,
          url: 'https://example.com'
        }
      ]
    }

    const result = transformChatGPTMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Ending with a citation')
    expect(result[1].type).toBe('source-url')
  })
})

describe('file citation metadata', () => {
  it('preserves exact file IDs on text without guessing from turn IDs', () => {
    const marker = '\uE200filecite\uE202turn0file1\uE202L42-L98\uE201'
    const parts = transformChatGPTMessageToParts({
      content: `Result ${marker}`,
      contentReferences: [
        { type: 'file', matched_text: marker, id: 'file_test', name: 'report.pdf' }
      ]
    })
    expect(parts).toEqual([
      {
        type: 'text',
        text: `Result ${marker}`,
        fileCitations: [{ marker, fileId: 'file_test', filename: 'report.pdf' }]
      }
    ])
  })
})
