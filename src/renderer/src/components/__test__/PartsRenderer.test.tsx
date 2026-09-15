import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PartsRenderer } from '../PartsRenderer'
import type { MessagePart } from '@shared/types'

const render = (parts: MessagePart[]) =>
  renderToStaticMarkup(<PartsRenderer parts={parts} messageId="test" />)
const source: MessagePart = {
  type: 'source-url',
  sourceId: 'source',
  url: 'https://example.com/paper',
  title: 'A paper'
}

describe('PartsRenderer citations', () => {
  it('renders clickable inline sources without breaking Markdown around them', () => {
    const html = render([
      { type: 'text', text: '**Evidence ' },
      source,
      { type: 'text', text: ' continues**.' }
    ])
    expect(html).toMatch(/<strong>Evidence <a[^>]*href="https:\/\/example.com\/paper"/)
    expect(html).toContain(' continues</strong>.')
    expect(html).not.toContain('#ownyourchat-source-')
  })
  it('replaces archived unresolved markers in paragraphs, headings, lists and tables', () => {
    const marker = '\uE200cite\uE202turn608629search0\uE202turn608629search1\uE201'
    const html = render([
      {
        type: 'text',
        text: `# Heading ${marker}\n\nText ${marker}\n\n- Item ${marker}\n\n| Source |\n| --- |\n| ${marker} |`
      }
    ])
    expect(html).not.toContain(marker)
    expect(html).not.toContain('turn608629')
    expect(html.match(/\[Source unavailable\]/g)).toHaveLength(4)
  })
  it('preserves literal markers in inline and fenced code', () => {
    const marker = '\uE200cite\uE202turn608629search0\uE201'
    const html = render([
      { type: 'text', text: `Example: \`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`` }
    ])
    expect(html.split(marker)).toHaveLength(3)
    expect(html).not.toContain('Source unavailable')
  })
  it('renders archived file citations with line ranges alongside web citations', () => {
    const marker = (range: string) => `\uE200filecite\uE202turn0file1\uE202${range}\uE201`
    const html = render([
      {
        type: 'text',
        text: `Results ${marker('L42-L98')} ${marker('L165-L191')} ${marker('L197-L234')}. `
      },
      source
    ])
    expect(html).toContain('File · lines 42–98')
    expect(html).toContain('File · lines 165–191')
    expect(html).toContain('File · lines 197–234')
    expect(html).not.toMatch(/filecite|turn0file1|[\uE200-\uE202]/)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="https://example.com/paper"')
  })
  it('handles file citations without line metadata and preserves literal file markers in code', () => {
    const marker = '\uE200filecite\uE202turn0file1\uE201'
    const html = render([
      {
        type: 'text',
        text: `# Heading ${marker}\n\n- Item ${marker}\n\n| Source |\n| --- |\n| ${marker} |\n\n\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\``
      }
    ])
    expect(html.match(/>File reference<\/span>/g)).toHaveLength(3)
    expect(html.split(marker)).toHaveLength(3)
    expect(html).not.toContain('<a ')
  })
  it('does not create clickable citations for invalid or executable URLs', () => {
    const html = render([{ ...source, url: 'javascript:alert(1)' }])
    expect(html).toContain('[Source unavailable]')
    expect(html).not.toContain('javascript:')
  })
})

describe('file links and embedded content', () => {
  it('makes a saved file reference a named button', () => {
    const marker = '\uE200filecite\uE202turn0file1\uE202L42-L98\uE201'
    const html = render([
      {
        type: 'text',
        text: marker,
        fileCitations: [{ marker, fileId: 'file_test', filename: 'report.pdf' }]
      }
    ])
    expect(html).toContain('<button')
    expect(html).toContain('report.pdf · lines 42–98')
    expect(html).not.toContain('turn0file1')
  })
  it('shows names for entities/products and readable fallbacks for widgets and memory', () => {
    const markers = [
      '\uE200entity\uE202["place","El Pit","cenote"]\uE201',
      '\uE200product_entity\uE202["turn0product0","Skates"]\uE201',
      '\uE200products\uE202{"selections":[["turn0product1","Charger"]]}\uE201',
      '\uE200image_group\uE202{"query":["Dive computer"]}\uE201',
      '\uE200memcite\uE201',
      '\uE200map\uE201',
      '\uE200finance\uE202turn0finance0\uE201',
      '\uE200future_widget\uE202{"payload":"hidden"}\uE201',
      '\uE200genui\uE202{"ask_user_input":{"questions":[{"question":"Which?","options":["A","B"]}]}}\uE201'
    ]
    const html = render([{ type: 'text', text: markers.join(' ') }])
    for (const name of [
      'El Pit',
      'Skates',
      'Charger',
      'Images: Dive computer',
      'Memory reference',
      'Map',
      'Financial chart',
      'Embedded content',
      'Which? / A / B'
    ])
      expect(html).toContain(name)
    expect(html).not.toMatch(/[\uE200-\uE206]|turn0|"payload"/)
  })
  it('removes annotation wrappers and handles older citations without touching code or logos', () => {
    const marker = '\uE600cite\uE602turn2view0\uE601'
    const text = `\uE203Keep **this text**\uE204\uE206 ${marker} \uE142cite\uE142turn6view0\uE141 Apple \uF8FF`
    const html = render([{ type: 'text', text: `${text}\n\n\`${marker}\`` }])
    expect(html).toContain('Keep <strong>this text</strong>')
    expect(html.match(/Source unavailable/g)).toHaveLength(2)
    expect(html).toContain('Apple \uF8FF')
    expect(html).toContain(`<code>${marker}</code>`)
  })
})

it('keeps complete URL widget payloads intact before GFM autolinking', () => {
  const marker =
    '\uE200url\uE202A [useful] **guide**\uE202https://www.example.com/a_b?q=one&x=two\uE201'
  const html = render([{ type: 'text', text: `Text ${marker} after.\n\n\`${marker}\`` }])
  expect(html).toContain('href="https://www.example.com/a_b?q=one&amp;x=two"')
  expect(html).toContain('A [useful] **guide**')
  expect(html).toContain(`after.</p>`)
  expect(html.split('\uE200')).toHaveLength(2) // The literal code example remains.
})
