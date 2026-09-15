import type { Processor } from 'unified'
import type { Tokenizer, Extension as MicromarkExtension } from 'micromark-util-types'
import type { Extension } from 'mdast-util-from-markdown'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    chatgptMarker: 'chatgptMarker'
  }
}

declare module 'unified' {
  interface Data {
    micromarkExtensions?: MicromarkExtension[]
    fromMarkdownExtensions?: Extension[]
  }
}

declare module 'mdast' {
  interface RootContentMap {
    chatgptMarker: PhrasingContentMap['chatgptMarker']
  }
  interface PhrasingContentMap {
    chatgptMarker: {
      type: 'chatgptMarker'
      value: string
      data: { hName: string; hChildren: { type: 'text'; value: string }[] }
    }
  }
}

// Consume a complete marker before Markdown can interpret URLs, underscores or
// brackets inside its payload. Code spans and fenced code keep their own parser.
const tokenize: Tokenizer = function (effects, ok, nok) {
  let startCode: number
  let endCode: number
  return start
  function start(code: number | null) {
    if (code === null) return nok(code)
    startCode = code
    endCode = code === 0xe200 ? 0xe201 : code === 0xe600 ? 0xe601 : 0xe141
    effects.enter('chatgptMarker')
    effects.consume(code)
    return inside
  }
  function inside(code: number | null): ReturnType<ReturnType<Tokenizer>> {
    if (code === null || (code === startCode && code !== 0xe142)) return nok(code)
    effects.consume(code)
    if (code === endCode) {
      effects.exit('chatgptMarker')
      return ok
    }
    return inside
  }
}

const fromMarkdown: Extension = {
  exit: {
    chatgptMarker(token) {
      const value = this.sliceSerialize(token)
      this.enter(
        {
          type: 'chatgptMarker',
          value,
          data: { hName: 'span', hChildren: [{ type: 'text', value }] }
        },
        token
      )
      this.exit(token)
    }
  }
}

export function remarkChatGPTMarkers(this: Processor) {
  const data = this.data()
  const construct = { tokenize }
  const extensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  extensions.push({ text: { [0xe200]: construct, [0xe600]: construct, [0xe142]: construct } })
  const fromExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  fromExtensions.push(fromMarkdown)
}
