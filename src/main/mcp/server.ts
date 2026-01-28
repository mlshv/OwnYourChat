import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import * as db from '../db/operations'
import { createServer } from 'http'
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'http'

let httpServer: HttpServer | null = null
let isRunning = false

const transports: Map<string, StreamableHTTPServerTransport> = new Map()

const createMcpServer = () => {
  const server = new McpServer({ name: 'ownyourchat', version: '1.0.0' })

  server.registerTool(
    'list_conversations',
    {
      description:
        'List conversations from the local database. Returns a paginated list of ChatGPT and Claude conversations synced to the local database.',
      inputSchema: {
        limit: z.number().optional().describe('Maximum number of conversations to return (default: 50)'),
        offset: z.number().optional().describe('Number of conversations to skip for pagination (default: 0)')
      }
    },
    async ({ limit, offset }) => {
      console.log('[MCP] Tool call: list_conversations', JSON.stringify({ limit, offset }))
      const result = await db.listConversations({ limit: limit ?? 50, offset: offset ?? 0 })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.registerTool(
    'get_conversation_with_messages',
    {
      description:
        'Get a specific conversation with all its messages. Returns detailed conversation data including the full message history with attachments.',
      inputSchema: {
        id: z.string().describe('The unique ID of the conversation to retrieve'),
        limit: z.number().optional().describe('Optional limit on number of messages to return')
      }
    },
    async ({ id, limit }) => {
      console.log('[MCP] Tool call: get_conversation_with_messages', JSON.stringify({ id, limit }))
      const result = await db.getConversationWithMessages(id, limit ? { limit } : undefined)
      if (!result) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }], isError: true }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.registerTool(
    'search_conversations',
    {
      description:
        'Search conversations by keywords in their titles. Returns conversations where the title contains ANY of the provided keywords.',
      inputSchema: {
        keywords: z.array(z.string()).describe('Array of keywords to search for in conversation titles'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 50)'),
        caseInsensitive: z
          .boolean()
          .optional()
          .describe('Whether to perform case-insensitive search (default: true)')
      }
    },
    async ({ keywords, limit, caseInsensitive }) => {
      console.log('[MCP] Tool call: search_conversations', JSON.stringify({ keywords, limit, caseInsensitive }))
      const result = await db.searchConversationsByKeywords(keywords, { limit, caseInsensitive })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.registerTool(
    'search_messages',
    {
      description:
        'Search messages by keywords in their content. Returns messages where the content contains ANY of the provided keywords. Each result includes the message, its parent conversation, and which keywords matched.',
      inputSchema: {
        keywords: z.array(z.string()).describe('Array of keywords to search for in message content'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 50)'),
        caseInsensitive: z
          .boolean()
          .optional()
          .describe('Whether to perform case-insensitive search (default: true)')
      }
    },
    async ({ keywords, limit, caseInsensitive }) => {
      console.log('[MCP] Tool call: search_messages', JSON.stringify({ keywords, limit, caseInsensitive }))
      const result = await db.searchMessagesByKeywords(keywords, { limit, caseInsensitive })
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

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

export async function startMcpServer(port: number = 37777): Promise<void> {
  if (isRunning) {
    console.log('[MCP] Server already running')
    return
  }

  try {
    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      // Log all incoming requests
      console.log(`[MCP] <- ${req.method} ${req.url} session=${sessionId ?? 'none'}`)

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

      // handle OAuth discovery - return 404 JSON to indicate no auth server
      if (req.url?.startsWith('/.well-known/')) {
        console.log(`[MCP] -> 404 ${req.url} (OAuth not configured)`)
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not_found', error_description: 'OAuth not configured' }))
        return
      }

      if (req.url !== '/mcp') {
        console.log(`[MCP] -> 404 ${req.url}`)
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not_found' }))
        return
      }

      try {
        if (req.method === 'POST') {
          const body = await parseBody(req)

          // Log JSON-RPC method details
          const jsonRpcBody = body as { method?: string; id?: unknown }
          console.log(`[MCP]    method=${jsonRpcBody.method ?? 'unknown'} id=${jsonRpcBody.id ?? '-'}`)

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

          console.log(`[MCP] -> 400 Bad Request: No valid session ID`)
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
            console.log(`[MCP] -> 404 Session not found: ${sessionId ?? 'none'}`)
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found. Please reinitialize.' },
              id: null
            }))
            return
          }
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          return
        }

        if (req.method === 'DELETE') {
          if (!sessionId || !transports.has(sessionId)) {
            console.log(`[MCP] -> 200 Session already terminated: ${sessionId ?? 'none'}`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok' }))
            return
          }
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          return
        }

        console.log(`[MCP] -> 405 Method not allowed: ${req.method}`)
        res.writeHead(405)
        res.end('Method not allowed')
      } catch (error) {
        console.error(`[MCP] -> 500 Internal server error:`, error)
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

    await new Promise<void>((resolve, reject) => {
      httpServer!.once('error', reject)

      httpServer!.listen(port, 'localhost', () => {
        httpServer!.removeListener('error', reject)
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
