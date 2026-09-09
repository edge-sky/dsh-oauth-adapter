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

describe('model management wire validation', () => {
  it.each(PROVIDERS.map(p => [p.id]))('rejects protocol injection and unrelated fields for %s', provider => {
    expect(parseClientCommand(JSON.stringify({ type: 'models-save', requestId: 'test', provider, revision: 1, model: { id: 'new', api: 'unknown-protocol' } }))).toMatchObject({ ok: false })
    expect(parseClientCommand(JSON.stringify({ type: 'models-sync', requestId: 'test', provider, revision: 1, token: 'not-accepted' }))).toMatchObject({ ok: false })
  })
  it.each(['xai','openai-codex','anthropic','kimi-coding'])('refuses even a valid protocol override on fixed provider %s', provider => {
    const command = { type: 'models-save', requestId: 'test', provider, revision: 1, model: { id: 'new' } }
    expect(parseClientCommand(JSON.stringify(command))).toMatchObject({ ok: true })
    expect(parseClientCommand(JSON.stringify({ ...command, model: { id: 'new', api: provider === 'xai' ? 'openai-responses' : provider === 'openai-codex' ? 'openai-codex-responses' : 'anthropic-messages' } }))).toMatchObject({ ok: false })
  })
  it('requires a finite revision and bounded valid pagination', () => {
    for (const revision of [-1, 1.5, '1', null]) expect(parseClientCommand(JSON.stringify({ type: 'models-sync', requestId: 'test', provider: 'xai', revision }))).toMatchObject({ ok: false })
    for (const manualOffset of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseClientCommand(JSON.stringify({ type: 'models-list', requestId: 'test', provider: 'xai', offset: 0, manualOffset }))).toMatchObject({ ok: false })
    }
    expect(parseClientCommand(JSON.stringify({ type: 'models-list', requestId: 'test', provider: 'xai', offset: 10, manualOffset: 20 }))).toMatchObject({ ok: true, value: { offset: 10, manualOffset: 20 } })
    expect(parseClientCommand(JSON.stringify({ type: 'models-list', requestId: 'test', provider: 'xai', offset: -1 }))).toMatchObject({ ok: false })
  })
})
