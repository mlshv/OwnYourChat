import type { NewProject, NewProjectDoc } from '../../db/schema'

// Parsing helpers for provider "Projects" APIs. Kept free of Electron so they can be unit tested.

/** Accepts ISO strings, unix seconds or unix milliseconds. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

// ----------------------------------------------------------------------------
// ChatGPT
// ----------------------------------------------------------------------------

/** ChatGPT project ids are gizmo ids that start with "g-p-" (plain "g-" ids are custom GPTs). */
export function getChatGPTProjectId(item: {
  conversation_template_id?: string | null
  gizmo_id?: string | null
}): string | null {
  for (const id of [item.conversation_template_id, item.gizmo_id]) {
    if (typeof id === 'string' && id.startsWith('g-p-')) return id
  }
  return null
}

/** Parse one page of GET /backend-api/gizmos/snorlax/sidebar */
export function parseChatGPTProjectsPage(
  body: unknown,
  syncedAt: Date = new Date()
): { projects: NewProject[]; cursor: string | null } {
  const page = (body ?? {}) as { items?: unknown[]; cursor?: unknown }
  const projects: NewProject[] = []

  for (const item of page.items ?? []) {
    const wrapper = (item ?? {}) as { gizmo?: Record<string, unknown> }
    // The sidebar nests the gizmo as item.gizmo.gizmo; tolerate a flat item.gizmo too
    const outer = wrapper.gizmo ?? {}
    const gizmo = ((outer.gizmo as Record<string, unknown> | undefined) ?? outer) as Record<
      string,
      unknown
    >
    const id = str(gizmo.id)
    if (!id || !id.startsWith('g-p-')) continue

    const display = (gizmo.display ?? {}) as Record<string, unknown>
    projects.push({
      id,
      provider: 'chatgpt',
      name: str(display.name) ?? 'Untitled project',
      description: str(display.description),
      instructions: str(gizmo.instructions),
      docsCount: 0,
      createdAt: toDate(gizmo.created_at),
      updatedAt: toDate(gizmo.updated_at),
      syncedAt
    })
  }

  return { projects, cursor: str(page.cursor) }
}

// ----------------------------------------------------------------------------
// Claude
// ----------------------------------------------------------------------------

/**
 * Parse a Claude project from GET /projects (list) or /projects/{id} (detail).
 * The list omits prompt_template, so instructions stay undefined there and the DB keeps its value.
 */
export function parseClaudeProject(raw: unknown, syncedAt: Date = new Date()): NewProject | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const id = str(p.uuid)
  if (!id) return null

  return {
    id,
    provider: 'claude',
    name: str(p.name) ?? 'Untitled project',
    description: str(p.description),
    instructions: 'prompt_template' in p ? str(p.prompt_template) : undefined,
    // The list endpoint returns docs_count: null; leave it undefined so the stored count is kept
    docsCount: typeof p.docs_count === 'number' ? p.docs_count : undefined,
    createdAt: toDate(p.created_at),
    updatedAt: toDate(p.updated_at),
    syncedAt
  }
}

/** Parse GET /projects/{id}/docs */
export function parseClaudeProjectDocs(projectId: string, body: unknown): NewProjectDoc[] {
  if (!Array.isArray(body)) return []
  const docs: NewProjectDoc[] = []
  for (const raw of body) {
    const d = (raw ?? {}) as Record<string, unknown>
    const id = str(d.uuid)
    if (!id) continue
    docs.push({
      id,
      projectId,
      filename: str(d.file_name) ?? 'untitled',
      content: typeof d.content === 'string' ? d.content : null,
      createdAt: toDate(d.created_at)
    })
  }
  return docs
}

/** Build a self-contained page script that GETs a same-origin JSON endpoint. */
export function makeGetJsonScript(url: string, headers: Record<string, string>): string {
  return `
(async function() {
  const response = await fetch(${JSON.stringify(url)}, {
    credentials: 'include',
    headers: ${JSON.stringify(headers)},
  });
  if (!response.ok) return { error: response.status };
  return { data: await response.json() };
})();
`
}
