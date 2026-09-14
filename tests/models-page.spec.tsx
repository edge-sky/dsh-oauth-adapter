// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
// Published DSH UI modules leave browser libraries external; devDependencies supply them for this page test.
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as Cordis from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PROVIDERS } from '../src/protocol.ts'
import type { ModelPage } from '../src/model-types.ts'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const run of cleanups.splice(0).reverse()) await run(); vi.unstubAllGlobals() })
async function boot(provider = 'github-copilot', localeId = 'en', paginated = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const requests: any[] = []
  let page: ModelPage = { provider: provider as never, revision: 1, offset: 0, manualOffset: 0, total: 1, rows: [{ id: 'future-model', name: 'Future model', source: 'pending' }], source: 'account', counts: { matched: 0, pending: 1, manual: 0 }, connected: true, writable: true, managed: true, busy: false }
  let connected = true
  const allRows = paginated ? [...Array.from({ length: 12 }, (_, i) => ({ id: `auto-${i}`, name: `Auto ${i}`, source: 'matched' as const })), ...Array.from({ length: 11 }, (_, i) => ({ id: `manual-${i}`, name: `Manual ${i}`, source: 'manual' as const, api: 'openai-completions' }))] : undefined
  class Socket extends EventTarget {
    static OPEN = 1; static CONNECTING = 0
    readyState = 1
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
    send(raw: string) {
      const command = JSON.parse(raw); requests.push(command)
      queueMicrotask(() => {
        const reply = (message: object) => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
        if (command.type === 'forget') connected = false
        if (command.type === 'refresh' || command.type === 'forget') reply({ type: 'snapshot', accounts: PROVIDERS.map(p => ({ provider: p.id, label: p.fallbackLabel, available: true, configured: connected && p.id === provider, modelsEnabled: connected && p.id === provider, writable: true, inFlight: false })) })
        if (command.type === 'models-save') {
          page = { ...page, revision: page.revision + 1, rows: [{ ...command.model, name: command.model.name ?? command.model.id, source: 'manual' }], counts: { matched: 0, pending: 0, manual: 1 } }
        }
        if (command.type === 'models-sync') page = { ...page, revision: page.revision + 1, error: 'Model discovery returned HTTP 403.' }
        if (command.type === 'models-list' && allRows) page = { ...page, offset: command.offset, manualOffset: command.manualOffset, total: 23, counts: { matched: 12, pending: 0, manual: 11 }, rows: [...allRows.slice(0, 12).slice(command.offset, command.offset + 10), ...allRows.slice(12).slice(command.manualOffset, command.manualOffset + 10)] }
        if (command.type.startsWith('models-')) reply({ type: 'models-page', requestId: command.requestId, page: command.provider === provider ? page : { ...page, provider: command.provider, rows: [], total: 0, connected: false, managed: false, counts: { matched: 0, pending: 0, manual: 0 } } })
      })
    }
    close() { this.readyState = 3 }
  }
  vi.stubGlobal('WebSocket', Socket)
  const ctx = new Cordis.Context()
  const loaded = new Map<string, any>([['@deepseek-ai/cordis', Cordis], ['@deepseek-ai/dsh-client-ui-primitives', Primitives]])
  async function bundle(name: string) {
    const path = createRequire(import.meta.url).resolve(`${name}/client`)
    const code = readFileSync(path, 'utf8')
    const require = createRequire(path)
    for (const [, dependency] of code.matchAll(/require\("([^"\n]+)"\)/g)) {
      if (!loaded.has(dependency)) loaded.set(dependency, await import((() => { try { return require.resolve(dependency) } catch { return createRequire(import.meta.url).resolve(dependency) } })()))
    }
    let result: any
    new Function('window', code)(Object.assign(window, { __ModuleLoader__: { load(entry: any) { result = entry.factory((id: string) => loaded.get(id)) } } }))
    return result
  }
  const Renderer = await bundle('@deepseek-ai/dsh-client-ui-renderer')
  const Locale = await bundle('@deepseek-ai/dsh-client-locale')
  const Settings = await bundle('@deepseek-ai/dsh-client-ui-settings')
  const Models = await bundle('@deepseek-ai/dsh-client-ui-settings-models')
  const OAuth = await bundle('@edge-sky/dsh-oauth-adapter')
  await ctx.plugin(Renderer)
  const absent = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  await ctx.plugin({ inject: ['slots'], apply(ctx: any) { ctx.slots.installScope('session', { current: { getSnapshot: () => absent, subscribe: () => () => {} }, resolve: () => undefined }) } })
  const locale = new Locale.LocaleRuntime(ctx); locale.setLocale(localeId); ctx.provide('locale', locale)
  const subscriptions = new Map<string, Function[]>()
  const namespaces = {
    credentials: { describe: async () => ({ ok: true, value: {} }) },
    llm: { listProviders: async () => ({ ok: true, value: [] }), listConfigurableProviders: async () => ({ ok: true, value: [] }) },
    settings: { describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }) },
  }
  ctx.provide('remote', { ...namespaces, $host: { isLoopback: true }, $on(event: string, callback: Function) { subscriptions.set(event, [...subscriptions.get(event) ?? [], callback]); return () => {} } })
  for (const [key, value] of Object.entries(namespaces)) ctx.provide(`remote.${key}`, value)
  await ctx.plugin(Settings)
  await ctx.plugin({ inject: ['slots'], apply(ctx: any) {
    ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' }, 'settings.onboarding': { kind: 'list', scope: 'root' } } }, (props: any) => props.renderSlot('settings.section', {}))
  } })
  await ctx.plugin(Models)
  const oauth = await ctx.plugin(OAuth)
  const container = document.createElement('div'); document.body.append(container)
  let unmount!: () => void
  await act(async () => { unmount = ctx.uiRenderer.mount(container) })
  const runtime = { slots: ctx.slots, async flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) } }
  const view = { container, getByText(text: string) { const result = [...container.querySelectorAll('button')].find(node => node.textContent === text); if (!result) throw new Error(`Missing ${text}: ${container.textContent}`); return result } }
  cleanups.push(async () => { await act(async () => { unmount(); await ctx.fiber.dispose() }); container.remove() })
  await runtime.flush()
  return { runtime, view, requests, oauth }
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
describe('OAuth footer in the actual DSH rc Models page', () => {
  it('registers once, hides pending models and saves a manual model with its selected protocol', async () => {
    const { runtime, view, requests, oauth } = await boot()
    expect(runtime.slots.entries('settings.models.footer')).toHaveLength(1)
    const toggle = view.container.querySelector<HTMLButtonElement>('.dsh-oauth-model-header button')!
    const details = view.container.querySelector<HTMLElement>('.dsh-oauth-model-details')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(details.hidden).toBe(true)
    click(toggle); await runtime.flush()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(details.hidden).toBe(false)
    click(toggle); await runtime.flush()
    expect(details.hidden).toBe(true)
    click(toggle); await runtime.flush()
    expect(view.container.textContent).not.toContain('Future model')
    const configure = view.getByText('Add model')
    click(configure)
    await runtime.flush()
    const input = view.container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'future-model')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(view.container.querySelector('select')?.options.length).toBe(3)
    act(() => view.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await runtime.flush()
    expect(requests.find(c => c.type === 'models-save')).toMatchObject({ provider: 'github-copilot', revision: 1, model: { id: 'future-model', api: 'openai-completions' } })
    expect([...view.container.querySelectorAll('.dsh-oauth-model-group')].map(group => group.getAttribute('aria-label'))).toEqual(['Manual', 'Automatic matches'])
    const row = view.container.querySelector('.dsh-oauth-model-group[aria-label="Manual"] li')!
    click(row.querySelector('button')!); await runtime.flush()
    expect(row.querySelector('form')).not.toBeNull()
    expect(row.querySelector('.dsh-oauth-model-identity')).toBeNull()
    expect(view.container.querySelector('.dsh-oauth-model-details > form')).toBeNull()
    expect(row.querySelector('input')?.readOnly).toBe(true)
    click(view.getByText('Cancel')); await runtime.flush()
    expect(row.querySelector('form')).toBeNull()
    expect(row.querySelector('.dsh-oauth-model-identity')).not.toBeNull()
    click(row.querySelector('button')!); await runtime.flush()
    act(() => row.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await runtime.flush()
    expect(row.querySelector('form')).toBeNull()
    expect(row.querySelector('.dsh-oauth-model-identity')).not.toBeNull()
    expect(view.container.querySelector('.dsh-oauth-model-provider')?.outerHTML).toMatchSnapshot()
    await oauth.dispose()
    expect(runtime.slots.entries('settings.models.footer')).toHaveLength(0)
  })
  it.each(['xai','openai-codex','anthropic','kimi-coding'])('hides the protocol selector for %s', async provider => {
    const { runtime, view } = await boot(provider)
    click(view.getByText('Edit')); await runtime.flush()
    click(view.getByText('Add model')); await runtime.flush()
    expect(view.container.querySelector('.dsh-oauth-model-form select')).toBeNull()
  })
  it('paginates automatic and manual groups independently and clears a signed-out provider', async () => {
    const { runtime, view, requests } = await boot('github-copilot', 'en', true)
    click(view.container.querySelector('.dsh-oauth-model-header button')!); await runtime.flush()
    const group = (label: string) => view.container.querySelector(`section[aria-label="${label}"]`)!
    const next = (label: string) => [...group(label).querySelectorAll('button')].find(b => b.textContent === 'Next')!
    click(next('Automatic matches')); await runtime.flush()
    expect(group('Automatic matches').textContent).toContain('Auto 10')
    expect(group('Manual').textContent).toContain('Manual 0')
    click(next('Manual')); await runtime.flush()
    expect(group('Automatic matches').textContent).toContain('Auto 10')
    expect(group('Manual').textContent).toContain('Manual 10')
    expect(requests.at(-1)).toMatchObject({ offset: 10, manualOffset: 10 })
    click(view.getByText('Sign out')); await runtime.flush()
    expect(view.container.querySelector('.dsh-oauth-model-provider')).toBeNull()
  })
  it('renders Chinese discovery failure independently from the connected account state', async () => {
    const { runtime, view } = await boot('github-copilot', 'zh')
    click(view.getByText('编辑')); await runtime.flush()
    click(view.getByText('同步模型')); await runtime.flush()
    expect(view.container.querySelector('.dsh-oauth-model-provider')?.outerHTML).toMatchSnapshot()
  })
})
