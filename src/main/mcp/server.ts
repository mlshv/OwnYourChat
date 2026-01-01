import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import * as db from '../db/operations'
import { createServer } from 'http'
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'http'

let httpServer: HttpServer | null = null
let isRunning = false

const transports: Map<string, StreamableHTTPServerTransport> = new Map()

const TOOLS: Tool[] = [
  {
    name: 'list_conversations',
    description:
      'List conversations from the local database. Returns a paginated list of ChatGPT and Claude conversations synced to the local database.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of conversations to return (default: 50)'
        },
        offset: {
          type: 'number',
          description: 'Number of conversations to skip for pagination (default: 0)'
        }
      }
    }
  },
  {
    name: 'get_conversation_with_messages',
    description:
      'Get a specific conversation with all its messages. Returns detailed conversation data including the full message history with attachments.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the conversation to retrieve'
        },
        limit: {
          type: 'number',
          description: 'Optional limit on number of messages to return'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'search_conversations',
    description:
      'Search conversations by keywords in their titles. Returns conversations where the title contains ANY of the provided keywords (case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of keywords to search for in conversation titles'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)'
        }
      },
      required: ['keywords']
    }
  },
  {
    name: 'search_messages',
    description:
      'Search messages by keywords in their content. Returns messages where the content contains ANY of the provided keywords (case-insensitive). Each result includes the message, its parent conversation, and which keywords matched.',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of keywords to search for in message content'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)'
        }
      },
      required: ['keywords']
    }
  }
]

const createMcpServer = () => {
  const server = new Server(
    { name: 'ownyourchat', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'list_conversations': {
          const options = {
            limit: typeof args?.limit === 'number' ? args.limit : 50,
            offset: typeof args?.offset === 'number' ? args.offset : 0
          }
          const result = await db.listConversations(options)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }

        case 'get_conversation_with_messages': {
          if (!args?.id || typeof args.id !== 'string') {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: id' }) }],
              isError: true
            }
          }

          const options = typeof args.limit === 'number' ? { limit: args.limit } : undefined
          const result = await db.getConversationWithMessages(args.id, options)

          if (!result) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }],
              isError: true
            }
          }

          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }

        case 'search_conversations': {
          if (!args?.keywords || !Array.isArray(args.keywords)) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: keywords (array)' }) }],
              isError: true
            }
          }

          const keywords = args.keywords.filter((k): k is string => typeof k === 'string')
          const searchOptions = typeof args.limit === 'number' ? { limit: args.limit } : undefined
          const result = await db.searchConversationsByKeywords(keywords, searchOptions)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }

        case 'search_messages': {
          if (!args?.keywords || !Array.isArray(args.keywords)) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: keywords (array)' }) }],
              isError: true
            }
          }

          const keywords = args.keywords.filter((k): k is string => typeof k === 'string')
          const searchOptions = typeof args.limit === 'number' ? { limit: args.limit } : undefined
          const result = await db.searchMessagesByKeywords(keywords, searchOptions)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }

        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true
          }
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
        isError: true
      }
    }
  })

  return server
}

const parseBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })

export async function startMcpServer(port: number = 3000): Promise<void> {
  if (isRunning) {
    console.log('[MCP] Server already running')
    return
  }

  try {
    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id')
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')

      if (req.method === 'OPTIONS') {
        res.writeHead(200)
        res.end()
        return
      }

      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', server: 'ownyourchat-mcp' }))
        return
      }

      if (req.url !== '/mcp') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined

      try {
        if (req.method === 'POST') {
          const body = await parseBody(req)

          if (sessionId && transports.has(sessionId)) {
            const transport = transports.get(sessionId)!
            await transport.handleRequest(req, res, body)
            return
          }

          if (!sessionId && isInitializeRequest(body)) {
            console.log('[MCP] New initialization request')
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (newSessionId) => {
                console.log(`[MCP] Session initialized: ${newSessionId}`)
                transports.set(newSessionId, transport)
              }
            })

            transport.onclose = () => {
              const sid = transport.sessionId
              if (sid && transports.has(sid)) {
                console.log(`[MCP] Transport closed for session ${sid}`)
                transports.delete(sid)
              }
            }

            const server = createMcpServer()
            await server.connect(transport)
            await transport.handleRequest(req, res, body)
            return
          }

          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
              id: null
            })
          )
          return
        }

        if (req.method === 'GET') {
          if (!sessionId || !transports.has(sessionId)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Invalid or missing session ID')
            return
          }
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          return
        }

        if (req.method === 'DELETE') {
          if (!sessionId || !transports.has(sessionId)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Invalid or missing session ID')
            return
          }
          console.log(`[MCP] Session termination request for ${sessionId}`)
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          return
        }

        res.writeHead(405)
        res.end('Method not allowed')
      } catch (error) {
        console.error('[MCP] Error handling request:', error)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null
            })
          )
        }
      }
    })

    await new Promise<void>((resolve) => {
      httpServer!.listen(port, 'localhost', () => {
        console.log(`[MCP] Server started on http://localhost:${port}`)
        resolve()
      })
    })

    isRunning = true
  } catch (error) {
    console.error('[MCP] Failed to start server:', error)
    httpServer = null
    isRunning = false
    throw error
  }
}

export async function stopMcpServer(): Promise<void> {
  if (!isRunning) {
    console.log('[MCP] Server not running')
    return
  }

  try {
    for (const [sessionId, transport] of transports) {
      try {
        console.log(`[MCP] Closing transport for session ${sessionId}`)
        await transport.close()
      } catch (error) {
        console.error(`[MCP] Error closing transport for session ${sessionId}:`, error)
      }
    }
    transports.clear()

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    httpServer = null
    isRunning = false
    console.log('[MCP] Server stopped successfully')
  } catch (error) {
    console.error('[MCP] Failed to stop server:', error)
    throw error
  }
}

export function isMcpServerRunning(): boolean {
  return isRunning
}
