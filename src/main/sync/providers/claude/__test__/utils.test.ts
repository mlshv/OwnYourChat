import { describe, it, expect } from 'vitest'
import { transformClaudeMessageToParts } from '../utils'
import type { SourceUrlPart, TextPart } from '@shared/types'
import conversationData from './claude-conversation.json'

describe('transformClaudeMessageToParts', () => {
  it('should transform regular text block into single text part', () => {
    const input = {
      content: [
        {
          type: 'text',
          text: 'This is a simple text message.'
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: 'text',
      text: 'This is a simple text message.'
    })
  })

  it('should handle multiple text blocks', () => {
    const input = {
      content: [
        {
          type: 'text',
          text: 'First paragraph.'
        },
        {
          type: 'text',
          text: 'Second paragraph.'
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('First paragraph.')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe('Second paragraph.')
  })

  it('should handle artifacts without citations', () => {
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: 'This is markdown content without citations.'
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('This is markdown content without citations.')
  })

  it('should split markdown and citations using start_index and end_index', () => {
    const markdown = 'Bengal cats are popular. They appeared in films and became famous.'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              {
                uuid: 'citation-1',
                title: 'Bengal Cat History',
                url: 'https://example.com/bengals',
                start_index: 25,
                end_index: 48,
                metadata: {
                  source: 'Example Source',
                  icon_url: 'https://example.com/icon.png'
                }
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(3)

    // First text part (0-48) - includes cited text "They appeared in films " (note trailing space)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Bengal cats are popular. They appeared in films ')

    // Source citation marker after cited text
    expect(result[1].type).toBe('source-url')
    const source = result[1] as SourceUrlPart
    expect(source.sourceId).toBe('citation-1')
    expect(source.url).toBe('https://example.com/bengals')
    expect(source.title).toBe('Bengal Cat History')
    expect(source.attribution).toBe('Example Source')
    expect(source.icon_url).toBe('https://example.com/icon.png')

    // Final text part (48-end) - "and became famous."
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe('and became famous.')
  })

  it('should handle multiple citations in artifacts', () => {
    const markdown = 'First second third.'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              {
                uuid: 'cite-1',
                title: 'Source One',
                url: 'https://one.com',
                start_index: 6,
                end_index: 12
              },
              {
                uuid: 'cite-2',
                title: 'Source Two',
                url: 'https://two.com',
                start_index: 13,
                end_index: 18
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    // 'First second' + citation + 'third' + citation + '.'
    expect(result).toHaveLength(5)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('First second')
    expect(result[1].type).toBe('source-url')
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' third')
    expect(result[3].type).toBe('source-url')
    expect(result[4].type).toBe('text')
    expect((result[4] as TextPart).text).toBe('.')
  })

  it('should ignore non-artifacts tool_use blocks', () => {
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'some_other_tool',
          input: {
            data: 'some data'
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    // Should return empty text part since no processable content
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('')
  })

  it('should handle mix of text and artifacts blocks', () => {
    const input = {
      content: [
        {
          type: 'text',
          text: 'Introduction text.'
        },
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: 'Artifact content.'
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Introduction text.')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe('Artifact content.')
  })

  it('should use preview_title as fallback for title', () => {
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: 'Some content with citation.',
            md_citations: [
              {
                uuid: 'cite-1',
                title: '',
                url: 'https://example.com',
                start_index: 13,
                end_index: 26,
                metadata: {
                  preview_title: 'Preview Title from Metadata'
                }
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    const sourceUrl = result.find((p) => p.type === 'source-url') as SourceUrlPart
    expect(sourceUrl.title).toBe('Preview Title from Metadata')
  })

  it('should handle real conversation data from Bengal cat deep research', () => {
    // Find the assistant message with artifacts
    const assistantMessage = conversationData.chat_messages.find(
      (msg) =>
        msg.sender === 'assistant' &&
        msg.content.some(
          (block) => block.type === 'tool_use' && 'name' in block && block.name === 'artifacts'
        )
    )

    expect(assistantMessage).toBeDefined()

    const input = {
      content: assistantMessage!.content
    }

    const result = transformClaudeMessageToParts(input)

    // Should have mixed text and source-url parts
    expect(result.length).toBeGreaterThan(1)

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

    // The artifact should contain the deep research report about Bengal cats
    const artifactBlock = assistantMessage!.content.find(
      (block) => block.type === 'tool_use' && 'name' in block && block.name === 'artifacts'
    ) as { type: 'tool_use'; name: string; input: { content: string; md_citations: unknown[] } }

    expect(artifactBlock.input.content).toContain('Bengal cats have carved a distinctive niche')

    // Verify we have citations
    expect(artifactBlock.input.md_citations).toBeDefined()
    expect(artifactBlock.input.md_citations.length).toBeGreaterThan(0)
  })

  it('should sort citations by start_index before processing', () => {
    const markdown = 'ABC DEF GHI'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              // Intentionally out of order
              {
                uuid: 'cite-2',
                title: 'Second',
                url: 'https://two.com',
                start_index: 8,
                end_index: 11
              },
              {
                uuid: 'cite-1',
                title: 'First',
                url: 'https://one.com',
                start_index: 4,
                end_index: 7
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    // Should process in correct order despite unsorted input
    expect(result).toHaveLength(4)
    expect((result[0] as TextPart).text).toBe('ABC DEF')
    expect((result[1] as SourceUrlPart).url).toBe('https://one.com')
    expect((result[2] as TextPart).text).toBe(' GHI')
    expect((result[3] as SourceUrlPart).url).toBe('https://two.com')
  })

  it('should handle citation at start of markdown', () => {
    const markdown = 'Starting text and more.'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              {
                uuid: 'cite-1',
                title: 'Source',
                url: 'https://example.com',
                start_index: 0,
                end_index: 13
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Starting text')
    expect(result[1].type).toBe('source-url')
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' and more.')
  })

  it('should handle citation at end of markdown', () => {
    const markdown = 'Text ending with citation'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              {
                uuid: 'cite-1',
                title: 'Source',
                url: 'https://example.com',
                start_index: 17,
                end_index: 25
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Text ending with citation')
    expect(result[1].type).toBe('source-url')
  })

  it('should preserve cited text in output', () => {
    // This test verifies the cited text itself appears in the output
    // Problem: current implementation skips from start_index to end_index
    const markdown =
      'Bengals have achieved remarkable visibility. Their striking leopard-like appearance and personalities have made them famous.'
    const input = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          input: {
            content: markdown,
            md_citations: [
              {
                uuid: 'cite-1',
                title: 'Cat Browser',
                url: 'https://example.com/bengals',
                start_index: 46, // Start of "Their striking leopard-like appearance"
                end_index: 84 // End of "Their striking leopard-like appearance"
              }
            ]
          }
        }
      ]
    }

    const result = transformClaudeMessageToParts(input)

    // Reconstruct full text from parts
    const fullText = result
      .map((part) => {
        if (part.type === 'text') return part.text
        return ''
      })
      .join('')

    // The cited text "Their striking leopard-like appearance" MUST appear in output
    expect(fullText).toContain('Their striking leopard-like appearance')

    // Full text should be complete
    expect(fullText).toBe(markdown)
  })
})
