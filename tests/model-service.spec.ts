import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as Pi from '@deepseek-ai/dsh-llm-pi-ai'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthModelService } from '../lib/model-service.js'
import { credentialBridge } from '../lib/model-auth.js'
import { providerFactories } from '../lib/model-catalog.js'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const run of cleanup.splice(0).reverse()) await run(); vi.unstubAllGlobals() })
const provider = 'github-copilot'
const key = Pi.recordKeyFor(provider)
async function boot(settings: Record<string, unknown> = { 'llm-pi-ai': { providers: { [provider]: { displayName: 'GitHub Copilot (OAuth)' } } } }, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'oauth-model-rc-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'settings.json'), JSON.stringify(settings))
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.json'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, 'credentials.yaml'), watch: false })
  await ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: { type: 'oauth', access: 'fake', refresh: 'fake', expires: Date.now() + 3600000 } }))
  await ctx.plugin(Pi, config)
  let models!: OAuthModelService
  const mount = await ctx.plugin({ name: 'model-test-owner', inject: ['settings','llm','credentials'], apply(ctx: Context) {
    models = new OAuthModelService(ctx, { timeoutMs: 300, maxResponseBytes: 100000, maxPages: 5, codexClientVersion: '0.149.0' }, () => {})
    ctx.effect(() => () => models.dispose())
  } })
  await models.ready
  return { ctx, models, mount }
}
function catalog(data: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })))
}
const known = { id: providerFactories[provider]().getModels()[0]!.id, model_picker_enabled: true }
describe('real DSH 0.1.5-rc.2 model service composition', () => {
  it('resolves every catalog model for the model selector and prepares a Copilot call', async () => {
    const { ctx } = await boot()
    const models = await ctx.llm.listModels(provider)
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      await expect(ctx.llm.resolveModelInfo(provider, model.id)).resolves.toMatchObject({ provider, id: model.id })
    }
    await expect(ctx.llm.prepareCall({ provider, model: models[0]!.id })).resolves.toBeDefined()
  })
  it('releases the old route, retains its ID and persists an empty successful discovery', async () => {
    const { ctx, models } = await boot()
    expect(await models.page(provider, 0)).toMatchObject({ managed: true, source: 'catalog' })
    expect(ctx.settings.get('llm-pi-ai').providers[provider]).toBeUndefined()
    await models.saveManual(provider, { id: 'manual', api: 'openai-completions' }, models.revision())
    catalog([])
    await models.sync(provider, models.revision())
    expect(await ctx.llm.listModels(provider)).toMatchObject([{ id: 'manual' }])
    expect(await models.page(provider, 0)).toMatchObject({ source: 'account', counts: { matched: 0, manual: 1 } })
  })
  it('paginates automatic and manual rows separately without exposing pending rows', async () => {
    const { models } = await boot()
    for (let i = 0; i < 11; i++) await models.saveManual(provider, { id: `manual-${i}`, api: 'openai-completions' }, models.revision())
    const automatic = (await models.page(provider, 0)).counts.matched
    expect(automatic).toBeGreaterThan(10)
    const page = await models.page(provider, 10, 10)
    expect(page.rows.filter(r => r.source === 'manual')).toHaveLength(1)
    expect(page.rows.filter(r => r.source !== 'manual').length).toBeGreaterThan(0)
    catalog([{ id: 'unknown', model_picker_enabled: true }]); await models.sync(provider, models.revision())
    expect(await models.page(provider, 10, 10)).toMatchObject({ offset: 0, manualOffset: 10, total: 11, rows: [{ id: 'manual-10', source: 'manual' }] })
  })
  it('retains the last successful result on malformed data and authentication errors', async () => {
    const { models } = await boot()
    catalog([known]); await models.sync(provider, models.revision())
    const revision = models.revision()
    for (const response of [() => new Response('{}'), () => new Response('private-secret', { status: 401 })]) {
      vi.stubGlobal('fetch', vi.fn(async () => response()))
      await expect(models.sync(provider, models.revision())).rejects.toThrow()
      expect(models.revision()).toBe(revision)
      expect((await models.page(provider, 0)).rows).toMatchObject([{ id: known.id }])
    }
  })
  it('refuses a stale revision and preserves both independent edits', async () => {
    const { models } = await boot()
    const revision = models.revision()
    await models.saveManual(provider, { id: 'one', api: 'openai-completions' }, revision)
    await expect(models.saveManual(provider, { id: 'two', api: 'anthropic-messages' }, revision)).rejects.toMatchObject({ code: 'settings-conflict' })
    await models.saveManual(provider, { id: 'two', api: 'anthropic-messages' }, models.revision())
    expect((await models.page(provider, 0)).counts.manual).toBe(2)
  })
  it('cancels coalesced discovery before logout and prevents credential resurrection', async () => {
    const { ctx, models } = await boot()
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => { started(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }) }))
    vi.stubGlobal('fetch', fetch)
    const first = models.sync(provider, models.revision())
    const second = models.sync(provider, models.revision())
    const settled = Promise.allSettled([first, second])
    await waiting
    await models.forget(provider)
    expect((await settled).every(r => r.status === 'rejected')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(ctx.llm.listProviders().some(p => p.id === provider)).toBe(false)
    expect(await ctx.credentials.readRecord(key)).toBeUndefined()
    expect(await models.page(provider, 10, 10)).toMatchObject({ connected: false, rows: [], offset: 0, manualOffset: 0, counts: { matched: 0, pending: 0, manual: 0 } })
    await expect(credentialBridge(ctx.credentials, () => {}).modify(provider, () => ({ type: 'oauth', access: 'late', refresh: 'late', expires: 1 }))).rejects.toThrow('disconnected')
  })
  it('requires preview for custom profiles and preserves configured capacities on migration', async () => {
    const { ctx, models } = await boot({ 'llm-pi-ai': { providers: { [provider]: { displayName: 'Custom', api: 'openai-completions', models: [{ id: 'custom', contextWindow: 12345, maxTokens: 1000 }] } } } })
    expect(await models.page(provider, 0)).toMatchObject({ managed: false, migration: { models: 1 } })
    await models.migrate(provider, models.revision())
    expect(await ctx.llm.resolveModelInfo(provider, 'custom')).toMatchObject({ context: { contextWindow: 12345 }, defaultMaxTokens: 1000 })
    catalog([]); await models.sync(provider, models.revision())
    expect(await ctx.llm.listModels(provider)).toMatchObject([{ id: 'custom' }])
  })
  it('continues an interrupted migration from its persisted backup', async () => {
    const { models } = await boot({ 'oauth-models': { version: 1, providers: { [provider]: { phase: 'pending', legacy: { displayName: 'GitHub Copilot (OAuth)' }, manual: [], restoredFromLegacy: true } } } })
    expect(await models.page(provider, 0)).toMatchObject({ managed: true })
  })
  it('leaves composition-owned routes intact', async () => {
    const { models, ctx } = await boot({}, { providers: { [provider]: { displayName: 'Base' } } })
    expect(await models.page(provider, 0)).toMatchObject({ managed: false, error: expect.stringContaining('composition-owned') })
    expect(ctx.llm.listProviders().find(p => p.id === provider)?.name).toBe('Base')
  })
  it('drains discovery when unloaded', async () => {
    const { models, mount, ctx } = await boot()
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    vi.stubGlobal('fetch', (_url, options) => new Promise((_resolve, reject) => { started(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }) }))
    const task = models.sync(provider, models.revision()).catch(error => error)
    await waiting
    await mount.dispose()
    expect(await task).toBeInstanceOf(Error)
    expect(ctx.llm.listProviders().some(p => p.id === provider)).toBe(false)
  })
})

describe('offline protocol dispatch through the real rc adapter', () => {
  it('dispatches distinct protocols and keeps a prepared request on its original model snapshot', async () => {
    const { ctx, models } = await boot()
    await models.saveManual(provider, { id: 'future-chat', api: 'openai-completions' }, models.revision())
    await models.saveManual(provider, { id: 'future-claude', api: 'anthropic-messages' }, models.revision())
    const prepared = await ctx.llm.prepareCall({ provider, model: 'future-chat' })
    await models.saveManual(provider, { id: 'future-chat', api: 'anthropic-messages' }, models.revision())
    const requests: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) })
      return new Response(JSON.stringify({ error: { message: 'offline protocol probe', type: 'invalid_request_error' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    }))
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
    async function consume(stream: AsyncIterable<unknown>) { try { for await (const _chunk of stream) {} } catch (error) { expect(String(error)).toContain('offline protocol probe') } }
    await consume(prepared.stream({ provider, model: 'future-chat', messages }))
    await consume(ctx.llm.stream({ provider, model: 'future-claude', messages }))
    await consume(ctx.llm.stream({ provider, model: 'future-chat', messages }))
    expect(requests.map(r => [new URL(r.url).pathname, r.body.model])).toEqual([
      ['/chat/completions','future-chat'], ['/v1/messages','future-claude'], ['/v1/messages','future-chat'],
    ])
  })
})

describe('migration and account changes', () => {
  it('restores the source when destination registration fails, then resumes safely', async () => {
    const { ctx, models } = await boot({ 'llm-pi-ai': { providers: { [provider]: { displayName: 'My custom OAuth' } } } })
    const stub = vi.spyOn(ctx.llm, 'registerAdapter').mockImplementationOnce(() => { throw new Error('registration failure') })
    await expect(models.migrate(provider, models.revision())).rejects.toThrow('registration failure')
    stub.mockRestore()
    expect(ctx.settings.get('llm-pi-ai').providers[provider]).toEqual(expect.objectContaining({ displayName: 'My custom OAuth' }))
    expect(ctx.settings.get('oauth-models').providers[provider].phase).toBe('pending')
    await models.migrate(provider, models.revision())
    expect((await models.page(provider, 0)).managed).toBe(true)
  })
  it('clears prior discovery on a new account even if its first discovery fails', async () => {
    const { ctx, models } = await boot()
    catalog([known]); await models.sync(provider, models.revision())
    await models.saveManual(provider, { id: 'kept', api: 'openai-completions' }, models.revision())
    models.loginStarted(provider)
    await ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: { type: 'oauth', access: 'other', refresh: 'other', expires: Date.now() + 3600000, accountId: 'other-account' } }))
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }))
    await expect(models.loginFinished(provider, true)).rejects.toThrow()
    expect(ctx.settings.get('oauth-models').providers[provider].discovered).toBeUndefined()
    expect((await models.page(provider, 0)).counts.manual).toBe(1)
    expect((await models.page(provider, 0)).source).toBe('catalog')
  })
  it('does not commandeer an explicit API-key route', async () => {
    const { ctx, models } = await boot({ 'llm-pi-ai': { providers: { [provider]: { apiKeyEnv: 'EXPLICIT_TEST_KEY' } } } })
    expect((await models.page(provider, 0)).managed).toBe(false)
    expect(ctx.settings.get('llm-pi-ai').providers[provider].apiKeyEnv).toBe('EXPLICIT_TEST_KEY')
  })
})
