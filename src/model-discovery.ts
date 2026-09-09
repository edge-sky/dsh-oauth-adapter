/** Account-scoped model discovery. Each provider owns its endpoint and response parser. */
import type { ModelAuth } from '@earendil-works/pi-ai'
import type { ProviderId } from './protocol.js'
import { modelText, type DiscoveredModel } from './model-types.js'

export class ModelOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export interface DiscoveryOptions {
  signal: AbortSignal
  maxBytes: number
  maxPages: number
  codexClientVersion: string
  fetch?: typeof globalThis.fetch
}
export interface DiscoveryAuth { auth: ModelAuth; accountId?: string }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function invalid(): never { throw new ModelOperationError('invalid-catalog', 'The provider returned an invalid model catalog.') }

/** Read a bounded page; errors never include response bodies or token-bearing URLs. */
async function readPage(url: URL, headers: Headers, options: DiscoveryOptions): Promise<Record<string, unknown>> {
  const response = await (options.fetch ?? globalThis.fetch)(url, { headers, signal: options.signal, redirect: 'error' })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ModelOperationError(response.status === 401 || response.status === 403 ? 'discovery-auth' : response.status === 404 || response.status === 405 ? 'discovery-unsupported' : 'discovery-failed', `Model discovery returned HTTP ${response.status}.`)
  }
  if (!response.body) invalid()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > options.maxBytes) throw new ModelOperationError('catalog-too-large', 'The model catalog exceeds the configured response limit.')
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => { /* The response stream may already have failed or been aborted. */ })
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { invalid() }
  return record(value) ?? invalid()
}

/** Fetch complete account-visible results; never substitute the public OpenRouter catalog. */
export async function discoverAccountModels(provider: ProviderId, resolved: DiscoveryAuth, options: DiscoveryOptions): Promise<DiscoveredModel[]> {
  const headers = new Headers(resolved.auth.headers as HeadersInit | undefined)
  headers.set('accept', 'application/json')
  if (resolved.auth.apiKey) headers.set('authorization', `Bearer ${resolved.auth.apiKey}`)
  let url: URL
  switch (provider) {
    case 'github-copilot':
      url = new URL(`${(resolved.auth.baseUrl ?? 'https://api.individual.githubcopilot.com').replace(/\/+$/, '')}/models`)
      headers.set('editor-version', 'vscode/1.107.0')
      headers.set('editor-plugin-version', 'copilot-chat/0.35.0')
      headers.set('copilot-integration-id', 'vscode-chat')
      headers.set('user-agent', 'GitHubCopilotChat/0.35.0')
      headers.set('x-github-api-version', '2026-06-01')
      break
    case 'openai-codex':
      if (!resolved.accountId) throw new ModelOperationError('discovery-auth', 'The Codex credential has no account ID; reconnect this account.')
      url = new URL('https://chatgpt.com/backend-api/codex/models')
      url.searchParams.set('client_version', options.codexClientVersion)
      headers.set('chatgpt-account-id', resolved.accountId)
      headers.set('originator', 'pi')
      break
    case 'anthropic':
      url = new URL('https://api.anthropic.com/v1/models?limit=1000')
      headers.set('anthropic-version', '2023-06-01')
      headers.set('anthropic-beta', 'oauth-2025-04-20')
      break
    case 'kimi-coding': url = new URL('https://api.kimi.com/coding/v1/models'); break
    case 'openrouter':
      url = new URL('https://openrouter.ai/api/v1/models/user?limit=500&offset=0'); break
    case 'xai': url = new URL('https://api.x.ai/v1/models'); break
  }
  const results = new Map<string, DiscoveredModel>()
  const cursors = new Set<string>()
  for (let page = 0; page < options.maxPages; page += 1) {
    options.signal.throwIfAborted()
    const body = await readPage(url, headers, options)
    const data = provider === 'openai-codex' ? body.models : body.data
    if (!Array.isArray(data)) invalid()
    for (const raw of data) {
      const item = record(raw) ?? invalid()
      const id = provider === 'openai-codex' ? item.slug : item.id
      if (!modelText(id)) invalid()
      if (provider === 'github-copilot') {
        const capabilities = record(item.capabilities)
        if (record(capabilities?.supports)?.tool_calls === false) continue
        if (item.model_picker_enabled !== true || record(item.policy)?.state === 'disabled') continue
      }
      if (provider === 'openai-codex' && item.visibility !== 'list') continue
      const name = item.display_name ?? item.name
      if (name !== undefined && !modelText(name)) invalid()
      results.set(id, { id, ...(name === undefined ? {} : { name }) })
    }
    if (provider === 'openrouter') {
      if (body.total_count !== undefined && (!Number.isSafeInteger(body.total_count) || (body.total_count as number) < 0)) invalid()
      const consumed = Number(url.searchParams.get('offset')) + data.length
      const more = body.total_count !== undefined ? consumed < (body.total_count as number) : data.length === 500
      if (more) {
        if (data.length === 0 || cursors.has(JSON.stringify(data))) invalid()
        cursors.add(JSON.stringify(data))
        url = new URL(url)
        url.searchParams.set('offset', String(consumed))
        continue
      }
      return [...results.values()]
    }
    if (body.has_more === undefined || body.has_more === false) return [...results.values()]
    if (provider !== 'anthropic') invalid()
    if (body.has_more !== true || !modelText(body.last_id) || cursors.has(body.last_id)) invalid()
    cursors.add(body.last_id)
    url = new URL(url)
    url.searchParams.set('after_id', body.last_id)
  }
  throw new ModelOperationError('catalog-too-large', 'The model catalog exceeds the configured page limit.')
}
