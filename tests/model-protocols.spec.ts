import { zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { materialize } from '../lib/model-catalog.js'
import { MODEL_PROTOCOLS } from '../lib/model-types.js'
import type { ProviderId } from '../lib/protocol.js'
afterEach(() => vi.unstubAllGlobals())
describe('manual model request protocols', () => {
  it.each([
    ['github-copilot','openai-completions','/chat/completions'],
    ['github-copilot','openai-responses','/responses'],
    ['github-copilot','anthropic-messages','/v1/messages'],
    ['openrouter','openai-completions','/api/v1/chat/completions'],
    ['openrouter','anthropic-messages','/api/v1/messages'],
    ['anthropic','anthropic-messages','/v1/messages'],
    ['kimi-coding','anthropic-messages','/coding/v1/messages'],
    ['xai','openai-responses','/v1/responses'],
    ['openai-codex','openai-codex-responses','/backend-api/codex/responses'],
  ])('%s %s constructs the expected endpoint and literal ID', async (provider, api, path) => {
    const requests: { path: string; id: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const body = new Headers(options.headers).get('content-encoding') === 'zstd' ? zstdDecompressSync(options.body).toString() : typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body)
      requests.push({ path: new URL(String(url)).pathname, id: JSON.parse(body).model })
      return new Response(JSON.stringify({ error: { message: 'offline-test', type: 'invalid_request_error' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    }))
    const jwt = 'test.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url') + '.test'
    const { profile } = materialize(provider as ProviderId, { phase: 'managed', legacy: { transport: 'sse' }, discovered: [], manual: [{ id: 'literal-future-id', ...(MODEL_PROTOCOLS[provider as ProviderId].length > 1 ? { api: api as never } : {}) }] })
    const adapter = new PiAiAdapter({ profiles: () => new Map([[provider, profile]]), resolveApiKey: async () => jwt, auth: { credentials: { read: async () => ({ type: 'oauth', access: jwt, refresh: 'test', expires: Date.now() + 3600000 }), list: async () => [], modify: async () => undefined, delete: async () => {} }, authContext: { env: async () => undefined, fileExists: async () => false } } })
    const chunks: unknown[] = []
    try {
      for await (const _chunk of adapter.stream({ provider, model: 'literal-future-id', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] })) { chunks.push(_chunk) }
    } catch (error) { expect(String(error)).toContain('offline-test') }
    expect(requests, JSON.stringify(chunks)).toEqual([{ path, id: 'literal-future-id' }])
  })
})
