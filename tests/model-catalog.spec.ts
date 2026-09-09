import { describe, expect, it } from 'vitest'
import { materialize, providerFactories, validateModelStore } from '../lib/model-catalog.js'
import { validManual } from '../lib/model-types.js'
import type { ProviderModels } from '../lib/model-catalog.js'
const state = (patch: Partial<ProviderModels> = {}): ProviderModels => ({ phase: 'managed', legacy: {}, manual: [], ...patch })
describe('model catalog reconciliation', () => {
  it('matches IDs only within the selected provider and keeps native metadata', () => {
    const model = providerFactories['github-copilot']().getModels()[0]!
    const result = materialize('github-copilot', state({ discovered: [{ id: model.id, name: 'remote label' }, { id: 'unknown', name: model.name }] }))
    expect(result.rows.map(r => r.source)).toEqual(['matched','pending'])
    expect(result.profile.piProvider.getModels()[0]).toMatchObject(model)
  })
  it('keeps manual entries when the account list is empty', () => {
    const result = materialize('github-copilot', state({ discovered: [], manual: [{ id: 'new', api: 'openai-completions', name: 'Custom' }] }))
    expect(result.rows).toEqual([{ id: 'new', name: 'Custom', api: 'openai-completions', source: 'manual' }])
    expect(result.profile.piProvider.getModels()[0]).toMatchObject({ reasoning: false, input: ['text'] })
  })
  it('does not turn an empty successful sync back into the built-in catalog', () => {
    expect(materialize('github-copilot', state({ discovered: [] })).rows).toEqual([])
    expect(materialize('github-copilot', state()).rows.length).toBeGreaterThan(0)
  })
  it('deduplicates matched manual overrides and preserves the chosen name', () => {
    const id = providerFactories.anthropic().getModels()[0]!.id
    const rows = materialize('anthropic', state({ discovered: [{ id }], manual: [{ id, name: 'My model' }] })).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'My model', source: 'manual' })
  })
  it('matches a cached remote ID after a catalog upgrade', () => {
    const original = providerFactories['github-copilot']()
    const discovered = state({ discovered: [{ id: 'future-model' }] })
    expect(materialize('github-copilot', discovered).rows[0]?.source).toBe('pending')
    const upgraded = { ...original, getModels: () => [{ ...original.getModels()[0]!, id: 'future-model' }] }
    expect(materialize('github-copilot', discovered, upgraded).rows[0]?.source).toBe('matched')
  })
  it('supports independent protocols in one Copilot route', () => {
    const result = materialize('github-copilot', state({ discovered: [], manual: [
      { id: 'new-chat', api: 'openai-completions' }, { id: 'new-claude', api: 'anthropic-messages' },
    ] }))
    expect(result.profile.piProvider.getModels().map(m => m.api)).toEqual(['openai-completions','anthropic-messages'])
  })
  it('refuses fixed-provider protocol overrides at wire and storage boundaries', () => {
    expect(validManual('xai', { id: 'future', api: 'anthropic-messages' })).toBe(false)
    expect(validManual('xai', { id: 'future' })).toBe(true)
    expect(() => validateModelStore({ version: 1, providers: { xai: state({ manual: [{ id: 'future', api: 'anthropic-messages' }] }) } })).toThrow()
  })
})
