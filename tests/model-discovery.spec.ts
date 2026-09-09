import { describe, expect, it, vi } from 'vitest'
import { discoverAccountModels } from '../lib/model-discovery.js'
import { PROVIDERS } from '../lib/protocol.js'

const auth = { auth: { apiKey: 'test-only', baseUrl: 'https://copilot-api.enterprise.test' }, accountId: 'test-account' }
const options = (fetch: typeof globalThis.fetch) => ({ fetch, signal: new AbortController().signal, maxBytes: 8192, maxPages: 5, codexClientVersion: '0.149.0' })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
describe('account model discovery', () => {
  it.each(PROVIDERS.map(p => [p.id]))('reads %s with provider-specific authentication and endpoint', async provider => {
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only')
      if (provider === 'github-copilot') expect(url.origin).toBe('https://copilot-api.enterprise.test')
      if (provider === 'openai-codex') {
        expect(new Headers(init.headers).get('chatgpt-account-id')).toBe('test-account')
        expect(url.pathname).toBe('/backend-api/codex/models')
      }
      if (provider === 'openrouter') expect(url.pathname).toBe('/api/v1/models/user')
      if (provider === 'anthropic') expect(new Headers(init.headers).get('anthropic-version')).toBe('2023-06-01')
      return json(provider === 'openai-codex' ? { models: [{ slug: 'new-model', display_name: 'New model', visibility: 'list' }] } : { data: [{ id: 'new-model', name: 'New model', model_picker_enabled: true }] })
    })
    await expect(discoverAccountModels(provider, auth, options(fetch as typeof globalThis.fetch))).resolves.toEqual([{ id: 'new-model', name: 'New model' }])
  })
  it('filters disabled, hidden and non-tool Copilot models without enabling policies', async () => {
    const fetch = vi.fn(async () => json({ data: [
      { id: 'enabled', model_picker_enabled: true }, { id: 'disabled', model_picker_enabled: true, policy: { state: 'disabled' } },
      { id: 'hidden', model_picker_enabled: false }, { id: 'non-tool', model_picker_enabled: true, capabilities: { supports: { tool_calls: false } } },
    ] }))
    expect(await discoverAccountModels('github-copilot', auth, options(fetch))).toEqual([{ id: 'enabled' }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('collects every page and deduplicates IDs', async () => {
    const fetch = vi.fn(async (url: URL) => url.searchParams.has('after_id') ? json({ data: [{ id: 'a' }, { id: 'b' }], has_more: false }) : json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }))
    expect(await discoverAccountModels('anthropic', auth, options(fetch as typeof globalThis.fetch))).toEqual([{ id: 'a' }, { id: 'b' }])
  })
  it('accepts authoritative empty lists', async () => {
    expect(await discoverAccountModels('xai', auth, options(async () => json({ data: [] })))).toEqual([])
  })
  it.each([401,403,404,405,429,500])('reports HTTP %s without leaking provider response bodies', async status => {
    await expect(discoverAccountModels('xai', auth, options(async () => new Response('secret-body', { status })))).rejects.toThrow(`HTTP ${status}`)
  })
  it.each([{}, { data: null }, { data: [{ id: 1 }] }, { data: [{ id: '' }] }, { data: [], has_more: true }])('rejects malformed data rather than treating it as an empty list', async body => {
    await expect(discoverAccountModels('anthropic', auth, options(async () => json(body)))).rejects.toThrow('invalid model catalog')
  })
  it('bounds streamed response bytes', async () => {
    await expect(discoverAccountModels('xai', auth, { ...options(async () => json({ data: [{ id: 'x'.repeat(9000) }] })), maxBytes: 100 })).rejects.toThrow('response limit')
  })
  it('rejects repeated pagination cursors', async () => {
    await expect(discoverAccountModels('anthropic', auth, options(async () => json({ data: [], has_more: true, last_id: 'same' })))).rejects.toThrow('invalid model catalog')
  })
  it('honors cancellation before calling an endpoint', async () => {
    const fetch = vi.fn()
    await expect(discoverAccountModels('xai', auth, { ...options(fetch), signal: AbortSignal.abort() })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('complete provider responses', () => {
  it.each(PROVIDERS.map(p => [p.id]))('%s accepts empty and rejects incomplete/auth/aborted results', async provider => {
    const empty = provider === 'openai-codex' ? { models: [] } : { data: [] }
    await expect(discoverAccountModels(provider, auth, options(async () => json(empty)))).resolves.toEqual([])
    await expect(discoverAccountModels(provider, auth, options(async () => json({})))).rejects.toThrow()
    await expect(discoverAccountModels(provider, auth, options(async () => new Response('', { status: 403 })))).rejects.toMatchObject({ code: 'discovery-auth' })
    const signal = AbortSignal.timeout(5)
    const timeout = (_url: unknown, request: RequestInit) => new Promise<Response>((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(request.signal!.reason), { once: true }))
    await expect(discoverAccountModels(provider, auth, { ...options(timeout as typeof fetch), signal })).rejects.toThrow()
  })
  it('uses OpenRouter offset pagination and rejects a repeated page', async () => {
    const fetch = vi.fn(async (url: URL) => json({ total_count: 2, data: [{ id: url.searchParams.get('offset') === '0' ? 'one' : 'two' }] }))
    expect(await discoverAccountModels('openrouter', auth, options(fetch as typeof globalThis.fetch))).toEqual([{ id: 'one' }, { id: 'two' }])
    expect(fetch.mock.calls.map(([url]) => url.searchParams.get('offset'))).toEqual(['0','1'])
    await expect(discoverAccountModels('openrouter', auth, options(async () => json({ total_count: 100, data: [{ id: 'same' }] })))).rejects.toThrow()
  })
  it('never publishes the first page when a later page fails', async () => {
    const fetch = vi.fn(async (url: URL) => url.searchParams.has('after_id') ? new Response('', { status: 500 }) : json({ data: [{ id: 'first' }], has_more: true, last_id: 'first' }))
    await expect(discoverAccountModels('anthropic', auth, options(fetch as typeof globalThis.fetch))).rejects.toThrow('HTTP 500')
  })
})
