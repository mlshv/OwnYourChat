import { describe, it, expect } from 'vitest'
import {
  toDate,
  getChatGPTProjectId,
  parseChatGPTProjectsPage,
  parseClaudeProject,
  parseClaudeProjectDocs,
  makeGetJsonScript
} from '../projects-utils'

const SYNCED = new Date('2026-11-07T12:00:00Z')

describe('toDate', () => {
  it('parses ISO strings, unix seconds and unix milliseconds', () => {
    expect(toDate('2025-03-01T10:00:00Z')?.toISOString()).toBe('2025-03-01T10:00:00.000Z')
    expect(toDate(1740823200)?.toISOString()).toBe('2025-03-01T10:00:00.000Z')
    expect(toDate(1740823200000)?.toISOString()).toBe('2025-03-01T10:00:00.000Z')
  })

  it('returns null for empty or invalid input', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate(undefined)).toBeNull()
    expect(toDate('')).toBeNull()
    expect(toDate('not a date')).toBeNull()
    expect(toDate({})).toBeNull()
  })
})

describe('getChatGPTProjectId', () => {
  it('uses conversation_template_id when it is a project', () => {
    expect(getChatGPTProjectId({ conversation_template_id: 'g-p-abc', gizmo_id: null })).toBe(
      'g-p-abc'
    )
  })

  it('falls back to gizmo_id when it is a project', () => {
    expect(getChatGPTProjectId({ conversation_template_id: null, gizmo_id: 'g-p-xyz' })).toBe(
      'g-p-xyz'
    )
  })

  it('ignores custom GPT ids and missing values', () => {
    expect(getChatGPTProjectId({ conversation_template_id: 'g-123', gizmo_id: 'g-456' })).toBeNull()
    expect(getChatGPTProjectId({})).toBeNull()
  })

  it('prefers the project id when a project chat also uses a custom GPT', () => {
    expect(getChatGPTProjectId({ conversation_template_id: 'g-p-proj', gizmo_id: 'g-gpt' })).toBe(
      'g-p-proj'
    )
    expect(getChatGPTProjectId({ conversation_template_id: 'g-gpt', gizmo_id: 'g-p-proj' })).toBe(
      'g-p-proj'
    )
  })
})

describe('parseChatGPTProjectsPage', () => {
  const gizmo = {
    id: 'g-p-111',
    instructions: 'Answer in British English',
    created_at: '2025-06-01T09:00:00Z',
    updated_at: '2025-07-01T09:00:00Z',
    display: { name: 'Garden planner', description: 'Seeds and beds' }
  }

  it('parses the nested item.gizmo.gizmo shape and returns the cursor', () => {
    const { projects, cursor } = parseChatGPTProjectsPage(
      { items: [{ gizmo: { gizmo }, conversations: { items: [] } }], cursor: 'next-1' },
      SYNCED
    )
    expect(cursor).toBe('next-1')
    expect(projects).toEqual([
      {
        id: 'g-p-111',
        provider: 'chatgpt',
        name: 'Garden planner',
        description: 'Seeds and beds',
        instructions: 'Answer in British English',
        docsCount: 0,
        createdAt: new Date('2025-06-01T09:00:00Z'),
        updatedAt: new Date('2025-07-01T09:00:00Z'),
        syncedAt: SYNCED
      }
    ])
  })

  it('accepts a flat item.gizmo shape', () => {
    const { projects } = parseChatGPTProjectsPage({ items: [{ gizmo }] }, SYNCED)
    expect(projects.map((p) => p.id)).toEqual(['g-p-111'])
  })

  it('skips non-project gizmos and tolerates missing fields', () => {
    const { projects, cursor } = parseChatGPTProjectsPage(
      {
        items: [
          { gizmo: { gizmo: { id: 'g-custom-gpt', display: { name: 'A GPT' } } } },
          { gizmo: { gizmo: { id: 'g-p-222' } } },
          null
        ]
      },
      SYNCED
    )
    expect(cursor).toBeNull()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      id: 'g-p-222',
      name: 'Untitled project',
      description: null,
      instructions: null
    })
  })

  it('handles empty or malformed bodies', () => {
    expect(parseChatGPTProjectsPage(undefined)).toEqual({ projects: [], cursor: null })
    expect(parseChatGPTProjectsPage({ items: [] })).toEqual({ projects: [], cursor: null })
  })
})

describe('parseClaudeProject', () => {
  it('parses a list entry without touching instructions', () => {
    const project = parseClaudeProject(
      {
        uuid: 'p-1',
        name: 'Recipe notes',
        description: '',
        docs_count: 3,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-02-01T00:00:00Z'
      },
      SYNCED
    )
    expect(project).toEqual({
      id: 'p-1',
      provider: 'claude',
      name: 'Recipe notes',
      description: null,
      instructions: undefined,
      docsCount: 3,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-02-01T00:00:00Z'),
      syncedAt: SYNCED
    })
  })

  it('reads instructions from a detail response, including an empty template', () => {
    expect(parseClaudeProject({ uuid: 'p-1', prompt_template: 'Be terse' })?.instructions).toBe(
      'Be terse'
    )
    expect(parseClaudeProject({ uuid: 'p-1', prompt_template: '' })?.instructions).toBeNull()
  })

  it('leaves docsCount undefined when the list omits it (docs_count: null)', () => {
    expect(parseClaudeProject({ uuid: 'p-1', docs_count: null })?.docsCount).toBeUndefined()
  })

  it('returns null without a uuid', () => {
    expect(parseClaudeProject({ name: 'x' })).toBeNull()
    expect(parseClaudeProject(null)).toBeNull()
  })
})

describe('parseClaudeProjectDocs', () => {
  it('maps docs and skips entries without a uuid', () => {
    const docs = parseClaudeProjectDocs('p-1', [
      {
        uuid: 'd-1',
        file_name: 'brief.md',
        content: '# Brief',
        created_at: '2025-01-02T00:00:00Z'
      },
      { file_name: 'orphan.md', content: 'x' },
      { uuid: 'd-2', content: 42 }
    ])
    expect(docs).toEqual([
      {
        id: 'd-1',
        projectId: 'p-1',
        filename: 'brief.md',
        content: '# Brief',
        createdAt: new Date('2025-01-02T00:00:00Z')
      },
      { id: 'd-2', projectId: 'p-1', filename: 'untitled', content: null, createdAt: null }
    ])
  })

  it('returns an empty list for non-array bodies', () => {
    expect(parseClaudeProjectDocs('p-1', { error: 'x' })).toEqual([])
  })
})

describe('makeGetJsonScript', () => {
  it('embeds the URL and headers as JSON literals so quotes cannot break out', () => {
    const script = makeGetJsonScript("https://x.test/a?b='c'", { authorization: 'Bearer "t"' })
    expect(script).toContain(JSON.stringify("https://x.test/a?b='c'"))
    expect(script).toContain(JSON.stringify({ authorization: 'Bearer "t"' }))
  })
})
