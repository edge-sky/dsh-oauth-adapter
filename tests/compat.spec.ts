import { describe, expect, it, vi } from 'vitest'
import { resolvePiAiOAuthBridge } from '../lib/compat.js'

function bridge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authContextFrom: vi.fn(),
    credentialStoreFrom: vi.fn(),
    piAiOAuthFlow: vi.fn(),
    piAiOAuthProviderIds: () => ['openai-codex', 'github-copilot'],
    ...overrides,
  }
}

describe('DSH compatibility', () => {
  it('accepts the complete provider bridge', () => {
    const candidate = bridge()
    expect(resolvePiAiOAuthBridge(candidate)).toBe(candidate)
  })

  it('rejects a bridge missing an exported function', () => {
    expect(() => resolvePiAiOAuthBridge(bridge({ piAiOAuthFlow: undefined })))
      .toThrow('does not provide piAiOAuthFlow')
  })

  it('rejects a bridge missing a required provider', () => {
    expect(() => resolvePiAiOAuthBridge(bridge({ piAiOAuthProviderIds: () => ['openai-codex'] })))
      .toThrow('does not support OAuth provider(s) github-copilot')
  })

  it('classifies provider enumeration failures as incompatibility', () => {
    expect(() => resolvePiAiOAuthBridge(bridge({
      piAiOAuthProviderIds: () => { throw new Error('provider catalog failure') },
    }))).toThrow('cannot enumerate OAuth providers')
  })

  it('rejects an invalid provider directory', () => {
    expect(() => resolvePiAiOAuthBridge(bridge({ piAiOAuthProviderIds: () => null })))
      .toThrow('returned an invalid OAuth provider directory')
  })
})
