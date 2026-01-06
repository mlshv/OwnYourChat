import { describe, it, expect } from 'vitest'
import { transformPerplexityMessageToParts } from '../utils'
import type { SourceUrlPart, TextPart } from '@shared/types'
import conversationData from './perplexity-conversation.json'

describe('transformPerplexityMessageToParts', () => {
  it('should transform message without citations into single text part', () => {
    const input = {
      markdown: 'This is a simple message without any citations.',
      webResults: []
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: 'text',
      text: 'This is a simple message without any citations.'
    })
  })

  it('should transform message with undefined webResults into single text part', () => {
    const input = {
      markdown: 'Another simple message.'
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
  })

  it('should split text and citations into alternating parts', () => {
    const input = {
      markdown: 'Bengal cats are popular.[1] They have unique markings.',
      webResults: [
        {
          name: 'Bengal Cat Facts',
          url: 'https://example.com/bengals',
          snippet: 'Bengal cats are a popular breed',
          meta_data: {
            citation_domain_name: 'example'
          }
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(3)

    // First text part
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Bengal cats are popular.')

    // Source citation
    expect(result[1].type).toBe('source-url')
    const sourceUrl = result[1] as SourceUrlPart
    expect(sourceUrl.url).toBe('https://example.com/bengals')
    expect(sourceUrl.title).toBe('Bengal Cat Facts')
    expect(sourceUrl.attribution).toBe('example')
    expect(sourceUrl.snippet).toBe('Bengal cats are a popular breed')
    expect(sourceUrl.sourceId).toBeDefined()

    // Final text part
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' They have unique markings.')
  })

  it('should handle multiple citations in sequence', () => {
    const input = {
      markdown: 'First fact.[1] Second fact.[2] Third fact.',
      webResults: [
        {
          name: 'Source One',
          url: 'https://one.com'
        },
        {
          name: 'Source Two',
          url: 'https://two.com'
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(5)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('First fact.')
    expect(result[1].type).toBe('source-url')
    expect((result[1] as SourceUrlPart).url).toBe('https://one.com')
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' Second fact.')
    expect(result[3].type).toBe('source-url')
    expect((result[3] as SourceUrlPart).url).toBe('https://two.com')
    expect(result[4].type).toBe('text')
    expect((result[4] as TextPart).text).toBe(' Third fact.')
  })

  it('should skip citations without URLs', () => {
    const input = {
      markdown: 'Text with citation.[1] More text.',
      webResults: [
        {
          name: 'Invalid Source',
          url: '' // Empty URL
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    // Should only have text parts, citation is skipped
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Text with citation.')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe(' More text.')
  })

  it('should handle citations at the start of content', () => {
    const input = {
      markdown: '[1]Starting with a citation.',
      webResults: [
        {
          name: 'Source',
          url: 'https://example.com'
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('source-url')
    expect(result[1].type).toBe('text')
    expect((result[1] as TextPart).text).toBe('Starting with a citation.')
  })

  it('should handle citations at the end of content', () => {
    const input = {
      markdown: 'Ending with a citation[1]',
      webResults: [
        {
          name: 'Source',
          url: 'https://example.com'
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Ending with a citation')
    expect(result[1].type).toBe('source-url')
  })

  it('should not confuse markdown links with citations', () => {
    const input = {
      markdown: 'Check [this link](https://example.com) and this source.[1]',
      webResults: [
        {
          name: 'Real Source',
          url: 'https://source.com'
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    // Should have: text with markdown link + citation + remaining text
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Check [this link](https://example.com) and this source.')
    expect(result[1].type).toBe('source-url')
    expect((result[1] as SourceUrlPart).url).toBe('https://source.com')
  })

  it('should handle out-of-range citation numbers gracefully', () => {
    const input = {
      markdown: 'Valid citation[1] and invalid[99]',
      webResults: [
        {
          name: 'Only Source',
          url: 'https://example.com'
        }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    // [1] should be converted, [99] should be consumed but not converted
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Valid citation')
    expect(result[1].type).toBe('source-url')
    expect(result[2].type).toBe('text')
    expect((result[2] as TextPart).text).toBe(' and invalid')
  })

  it('should handle real conversation data from first entry (normal query)', () => {
    // Find the first entry
    const firstEntry = conversationData.entries[0]
    const markdownBlock = firstEntry.blocks.find(
      (block) => block.intended_usage === 'ask_text'
    )
    const webResultBlock = firstEntry.blocks.find(
      (block) => block.intended_usage === 'web_results'
    )

    expect(markdownBlock).toBeDefined()
    expect(webResultBlock).toBeDefined()

    const input = {
      markdown: markdownBlock!.markdown_block!.answer,
      webResults: webResultBlock!.web_result_block!.web_results
    }

    const result = transformPerplexityMessageToParts(input)

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

    // Verify content starts with expected text
    expect((textParts[0] as TextPart).text).toContain('Based on the visual evidence')
  })

  it('should handle real conversation data from second entry (deep research)', () => {
    // Find the second entry (deep research)
    const secondEntry = conversationData.entries[1]
    const markdownBlock = secondEntry.blocks.find(
      (block) => block.intended_usage === 'ask_text'
    )
    const webResultBlock = secondEntry.blocks.find(
      (block) => block.intended_usage === 'web_results'
    )

    expect(markdownBlock).toBeDefined()
    expect(webResultBlock).toBeDefined()

    const input = {
      markdown: markdownBlock!.markdown_block!.answer,
      webResults: webResultBlock!.web_result_block!.web_results
    }

    const result = transformPerplexityMessageToParts(input)

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

    // Verify content starts with expected deep research text
    expect((textParts[0] as TextPart).text).toContain('comprehensive overview of Bengal cat history')
  })

  it('should handle multiple consecutive citations', () => {
    const input = {
      markdown: 'Bengal cats are popular.[1][2][3] They are beautiful.',
      webResults: [
        { name: 'Source 1', url: 'https://one.com' },
        { name: 'Source 2', url: 'https://two.com' },
        { name: 'Source 3', url: 'https://three.com' }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    expect(result).toHaveLength(5)
    expect(result[0].type).toBe('text')
    expect((result[0] as TextPart).text).toBe('Bengal cats are popular.')
    expect(result[1].type).toBe('source-url')
    expect(result[2].type).toBe('source-url')
    expect(result[3].type).toBe('source-url')
    expect(result[4].type).toBe('text')
    expect((result[4] as TextPart).text).toBe(' They are beautiful.')
  })

  it('should preserve all markdown formatting except citations', () => {
    const input = {
      markdown: '# Heading\n\n**Bold text** and *italic*.[1]\n\n- List item\n- Another item[2]',
      webResults: [
        { name: 'Source 1', url: 'https://one.com' },
        { name: 'Source 2', url: 'https://two.com' }
      ]
    }

    const result = transformPerplexityMessageToParts(input)

    // Reconstruct the text without source markers
    const reconstructed = result
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')

    expect(reconstructed).toContain('# Heading')
    expect(reconstructed).toContain('**Bold text**')
    expect(reconstructed).toContain('*italic*.')
    expect(reconstructed).toContain('- List item')
    expect(reconstructed).toContain('- Another item')
  })
})
