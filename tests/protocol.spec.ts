import { describe, expect, it } from 'vitest'
import { MAX_ANSWER_LENGTH, PROVIDERS, parseClientCommand } from '../lib/protocol.js'

describe('OAuth wire parser', () => {
  it('offers every OAuth provider shipped by the supported pi-ai catalog', () => {
    expect(PROVIDERS.map(provider => provider.id)).toEqual([
      'openai-codex',
      'github-copilot',
      'anthropic',
      'kimi-coding',
      'openrouter',
      'xai',
    ])
  })

  it('accepts every command without preserving unrelated fields', () => {
    expect(parseClientCommand(JSON.stringify({ type: 'refresh', requestId: 'r-1' }))).toEqual({
      ok: true, value: { type: 'refresh', requestId: 'r-1' },
    })
    expect(parseClientCommand(JSON.stringify({
      type: 'begin', requestId: 'r-2', provider: 'openai-codex', extra: true,
    }))).toMatchObject({ ok: false, requestId: 'r-2' })
    expect(parseClientCommand(JSON.stringify({
      type: 'respond', requestId: 'r-3', attemptId: 'attempt', promptId: 'prompt', value: 'answer',
    }))).toMatchObject({ ok: true })
  })

  it('rejects unknown providers, malformed ids, and oversized answers', () => {
    expect(parseClientCommand(JSON.stringify({
      type: 'begin', requestId: 'r', provider: 'other',
    }))).toMatchObject({ ok: false, message: 'provider is unsupported' })
    expect(parseClientCommand(JSON.stringify({ type: 'cancel', requestId: '!', attemptId: 'a' })))
      .toMatchObject({ ok: false })
    expect(parseClientCommand(JSON.stringify({
      type: 'respond', requestId: 'r', attemptId: 'a', promptId: 'p', value: 'x'.repeat(MAX_ANSWER_LENGTH + 1),
    }))).toMatchObject({ ok: false })
  })
})
