/** Persistent OAuth model management and reversible ownership of existing provider routes. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createModels } from '@earendil-works/pi-ai'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, recordKeyFor } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PROVIDERS, type ProviderId } from './protocol.js'
import { MODEL_PAGE_SIZE, MODEL_PROTOCOLS, validManual, type ModelPage, type ManualModel } from './model-types.js'
import { accountIdentity, credentialBridge, fromRecord } from './model-auth.js'
import { materialize, providerFactories, validateModelStore, type ModelStore, type ProviderModels } from './model-catalog.js'
import { discoverAccountModels, ModelOperationError } from './model-discovery.js'

export interface ModelServiceOptions { timeoutMs: number; maxResponseBytes: number; maxPages: number; codexClientVersion: string }
export type ModelContext = Context & { settings: SettingsProvider; credentials: CredentialProvider; llm: LlmRuntime }
const NS = 'oauth-models' as SettingsNamespace
const LEGACY_NS = 'llm-pi-ai' as SettingsNamespace
const Schema = z.object({ version: z.const(1).default(1), providers: z.dict(z.any()).default({}) }) as z<ModelStore>
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function failure(code: string, message: string): never { throw new ModelOperationError(code, message) }

export class OAuthModelService {
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()
  private handle: AdapterRegistrationHandle | undefined
  private readonly queues = new Map<ProviderId, Promise<unknown>>()
  private readonly syncs = new Map<ProviderId, Promise<void>>()
  private readonly controllers = new Map<ProviderId, AbortController>()
  private readonly generations = new Map<ProviderId, number>()
  private readonly loggingIn = new Set<ProviderId>()
  private readonly errors = new Map<ProviderId, { code: string; message: string }>()
  private readonly disposers: (() => void)[] = []
  private closed = false
  private readonly stop = new AbortController()
  private readonly signedOut = new Set<ProviderId>()
  private readonly adapter: PiAiAdapter
  readonly ready: Promise<void>

  constructor(private readonly ctx: ModelContext, private readonly options: ModelServiceOptions, private readonly changed: (provider: ProviderId) => void) {
    const scope = ctx.settings.register(NS, Schema, { base: { version: 1, providers: {} }, validate: value => { validateModelStore(value) } })
    this.adapter = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async () => undefined,
      auth: { credentials: credentialBridge(ctx.credentials, provider => { if (this.closed) failure('disposed', 'OAuth models have stopped.'); if (this.signedOut.has(provider as ProviderId)) failure('not-connected', 'This account was disconnected.'); if (this.loggingIn.has(provider as ProviderId)) failure('busy', 'Account reconnection is in progress.') }), authContext: { env: async () => undefined, fileExists: async () => false } },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    })
    this.ready = this.initialize()
    this.disposers.push(scope.watch(() => {
      if (this.closed) return
      for (const p of PROVIDERS) void this.enqueue(p.id, async () => { await this.reconcile(p.id) }).catch(error => this.report(p.id, error))
    }))
    this.disposers.push(ctx.on('credentials/record-updated', key => {
      const provider = PROVIDERS.find(p => p.key === key)?.id
      if (!provider || this.closed || this.loggingIn.has(provider)) return
      void this.enqueue(provider, async () => { await this.reconcile(provider) }).catch(error => this.report(provider, error))
    }))
  }

  private state(): ModelStore { return validateModelStore(this.ctx.settings.get(NS)) }
  revision(): number { return this.ctx.settings.describe().find(s => s.ns === NS)?.revision ?? 0 }
  isManaged(provider: ProviderId): boolean { return this.profiles.has(provider) }
  private checkRevision(revision: number): void { if (revision !== this.revision()) failure('settings-conflict', 'Models changed in another operation. Refresh and retry.') }
  private checkOpen(): void { if (this.closed) failure('disposed', 'OAuth models have stopped.') }
  private async save(provider: ProviderId, state: ProviderModels, revision = this.revision()): Promise<void> {
    this.checkOpen()
    materialize(provider, state)
    try { await this.ctx.settings.mutate(NS, [{ op: 'set', path: ['providers', provider], value: state }], revision) } catch (error) {
      if (error instanceof SettingsConflictError) failure('settings-conflict', 'Models changed in another operation. Refresh and retry.')
      throw error
    }
  }
  private report(provider: ProviderId, error: unknown): void {
    this.errors.set(provider, error instanceof ModelOperationError ? { code: error.code, message: error.message } : { code: 'operation-failed', message: 'Model operation failed. The previous configuration was retained.' })
    this.changed(provider)
  }
  private enqueue<T>(provider: ProviderId, action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ModelOperationError('disposed', 'OAuth models have stopped.'))
    const previous = this.queues.get(provider) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(() => { this.checkOpen(); return action() })
    this.queues.set(provider, task)
    void task.finally(() => { if (this.queues.get(provider) === task) this.queues.delete(provider) }).catch(() => {})
    return task
  }
  private async initialize(): Promise<void> {
    for (const p of PROVIDERS) {
      try { await this.enqueue(p.id, async () => { await this.ensureManaged(p.id, false) }) } catch (error) { this.report(p.id, error) }
    }
  }
  private legacy(provider: ProviderId): { profile: PiAiProviderProfile | undefined; revision: number; custom: boolean; blocked: boolean } {
    const descriptor = this.ctx.settings.describe().find(s => s.ns === LEGACY_NS)
    if (!descriptor) failure('model-host', 'The DSH pi-ai settings namespace is unavailable.')
    const profile = object(object(descriptor.user)?.providers)?.[provider]
    const base = object(object(descriptor.base)?.providers)?.[provider]
    const value = object(profile)
    const label = PROVIDERS.find(p => p.id === provider)!.modelGroupLabel
    return { profile: value as PiAiProviderProfile | undefined, revision: descriptor.revision,
      custom: value !== undefined && !(Object.keys(value).length === 1 && value.displayName === label),
      blocked: base !== undefined || (value !== undefined && value.apiKeyEnv !== undefined) }
  }
  private async connected(provider: ProviderId): Promise<boolean> { return !this.signedOut.has(provider) && fromRecord(await this.ctx.credentials.readRecord(recordKeyFor(provider)))?.type === 'oauth' }
  private async publish(provider: ProviderId, state: ProviderModels | undefined): Promise<void> {
    this.checkOpen()
    const next = new Map(this.profiles)
    if (state && await this.connected(provider)) next.set(provider, materialize(provider, state).profile)
    else next.delete(provider)
    this.checkOpen()
    const old = this.profiles
    this.profiles = next
    try {
      if (this.handle) this.handle.replace([...next.keys()])
      else if (next.size) this.handle = this.ctx.llm.registerAdapter([...next.keys()], this.adapter)
    } catch (error) { this.profiles = old; throw error }
    this.changed(provider)
  }
  private async reconcile(provider: ProviderId): Promise<void> {
    if (this.loggingIn.has(provider)) return
    const state = this.state().providers[provider]
    await this.publish(provider, state?.phase === 'managed' ? state : undefined)
  }

  /** Wait on the actual route registry; settings persistence alone does not imply adapter release. */
  private async releaseLegacy(provider: ProviderId, revision: number): Promise<void> {
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(this.options.timeoutMs)])
    let wake: (() => void) | undefined
    const dispose = this.ctx.on('llm/adapters-updated', () => { wake?.() })
    try {
      await this.ctx.settings.mutate(LEGACY_NS, [{ op: 'unset', path: ['providers', provider] }], revision)
      while (this.ctx.llm.listProviders().some(p => p.id === provider)) {
        signal.throwIfAborted()
        await new Promise<void>((resolve, reject) => {
          const abort = (): void => { cleanup(); reject(new ModelOperationError('route-conflict', 'The previous model adapter did not release this provider.')) }
          const cleanup = (): void => { signal.removeEventListener('abort', abort); wake = undefined }
          wake = () => { cleanup(); resolve() }
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          else if (!this.ctx.llm.listProviders().some(p => p.id === provider)) wake()
        })
      }
    } finally { dispose() }
  }
  private async ensureManaged(provider: ProviderId, approve: boolean): Promise<void> {
    if (!await this.connected(provider)) return
    let state = this.state().providers[provider]
    if (state?.phase === 'managed') { await this.publish(provider, state); return }
    const legacy = this.legacy(provider)
    if (legacy.blocked) failure('route-conflict', 'This provider has an API-key reference or a composition-owned profile; it was not changed.')
    if (!state && legacy.custom && !approve) failure('migration-required', 'Review and migrate the existing custom OAuth configuration before managing models.')
    if (!state) {
      state = { phase: 'pending', legacy: legacy.profile ?? { displayName: PROVIDERS.find(p => p.id === provider)!.modelGroupLabel }, manual: [], restoredFromLegacy: legacy.profile !== undefined }
      const choices: readonly string[] = MODEL_PROTOCOLS[provider]
      if (state.legacy.api && !choices.includes(state.legacy.api)) failure('route-conflict', 'The existing protocol is not supported by this OAuth provider.')
      state.manual = (state.legacy.models ?? []).map(model => {
        const api = state!.legacy.api ?? providerFactories[provider]().getModels().find(m => m.id === model.id)?.api ?? (choices.length === 1 ? choices[0] : undefined)
        if (!api) failure('model-protocol', `Existing model ${model.id} needs an explicit protocol.`)
        return { id: model.id, ...(model.name ? { name: model.name } : {}), ...(choices.length > 1 ? { api: api as NonNullable<ManualModel['api']> } : {}) }
      })
      await this.save(provider, state)
    }
    try {
      if (legacy.profile) await this.releaseLegacy(provider, legacy.revision)
      else if (this.ctx.llm.listProviders().some(p => p.id === provider) && !this.profiles.has(provider)) failure('route-conflict', 'Another adapter owns this provider; it was not changed.')
      const managed = { ...state, phase: 'managed' } as const
      await this.publish(provider, managed)
      await this.save(provider, managed)
      this.errors.delete(provider)
    } catch (error) {
      await this.publish(provider, undefined)
      // Restore only if the source is still absent. Never overwrite a concurrent profile edit.
      const source = this.legacy(provider)
      if (!source.profile && state.restoredFromLegacy) await this.ctx.settings.mutate(LEGACY_NS, [{ op: 'set', path: ['providers', provider], value: state.legacy }], source.revision)
      throw error
    }
  }

  async page(provider: ProviderId, offset: number, manualOffset = 0): Promise<ModelPage> {
    await this.ready
    const state = this.state().providers[provider]
    const fallback: ProviderModels = { phase: 'pending', legacy: this.legacy(provider).profile ?? {}, manual: [] }
    const connected = await this.connected(provider)
    const rows = connected ? materialize(provider, state ?? fallback).rows : []
    const automatic = rows.filter(row => row.source === 'catalog' || row.source === 'matched')
    const manual = rows.filter(row => row.source === 'manual')
    const legacy = this.legacy(provider)
    offset = Math.min(offset, Math.max(0, Math.floor((automatic.length - 1) / MODEL_PAGE_SIZE) * MODEL_PAGE_SIZE))
    manualOffset = Math.min(manualOffset, Math.max(0, Math.floor((manual.length - 1) / MODEL_PAGE_SIZE) * MODEL_PAGE_SIZE))
    return {
      provider, revision: this.revision(), offset, manualOffset, total: automatic.length + manual.length,
      rows: [...automatic.slice(offset, offset + MODEL_PAGE_SIZE), ...manual.slice(manualOffset, manualOffset + MODEL_PAGE_SIZE)],
      source: state?.discovered ? 'account' : 'catalog',
      counts: { matched: rows.filter(r => r.source === 'matched' || r.source === 'catalog').length, pending: rows.filter(r => r.source === 'pending').length, manual: rows.filter(r => r.source === 'manual').length },
      connected, writable: this.ctx.settings.writable,
      managed: this.isManaged(provider), busy: this.syncs.has(provider),
      ...(!connected || state?.syncedAt === undefined ? {} : { syncedAt: state.syncedAt }),
      ...(this.errors.has(provider) ? { error: this.errors.get(provider)!.message, errorCode: this.errors.get(provider)!.code } : {}),
      ...((state?.phase === 'pending' || !state && legacy.custom) && !legacy.blocked ? { migration: { fields: Object.keys(state?.legacy ?? legacy.profile ?? {}), models: (state?.legacy ?? legacy.profile)?.models?.length ?? 0 } } : {}),
    }
  }
  async migrate(provider: ProviderId, revision: number): Promise<void> {
    await this.ready
    return this.enqueue(provider, async () => { this.checkRevision(revision); await this.ensureManaged(provider, true) })
  }
  async saveManual(provider: ProviderId, model: ManualModel, revision: number): Promise<void> {
    if (!validManual(provider, model)) failure('invalid-model', 'Model fields or protocol are invalid.')
    await this.ready
    return this.enqueue(provider, async () => {
      this.checkRevision(revision)
      await this.ensureManaged(provider, false)
      const state = this.state().providers[provider]
      if (!state || !await this.connected(provider)) failure('not-connected', 'Connect this provider before editing models.')
      const next = { ...state, manual: [...state.manual.filter(m => m.id !== model.id), model] }
      await this.save(provider, next)
      await this.publish(provider, next)
    })
  }
  async deleteManual(provider: ProviderId, id: string, revision: number): Promise<void> {
    await this.ready
    return this.enqueue(provider, async () => {
      this.checkRevision(revision)
      const state = this.state().providers[provider]
      if (!state) failure('not-connected', 'This provider has no managed models.')
      const next = { ...state, manual: state.manual.filter(m => m.id !== id) }
      await this.save(provider, next)
      await this.publish(provider, next)
    })
  }

  async sync(provider: ProviderId, revision: number): Promise<void> {
    await this.ready
    const running = this.syncs.get(provider)
    if (running) return running
    const generation = this.generations.get(provider) ?? 0
    const controller = new AbortController()
    this.controllers.set(provider, controller)
    const task = this.enqueue(provider, async () => {
      this.checkRevision(revision)
      await this.ensureManaged(provider, false)
      const state = this.state().providers[provider]
      if (!state || !await this.connected(provider)) failure('not-connected', 'Connect this provider before synchronizing models.')
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.options.timeoutMs)])
      const check = (): void => { this.checkOpen(); signal.throwIfAborted(); if ((this.generations.get(provider) ?? 0) !== generation) failure('cancelled', 'The account changed during synchronization.') }
      const collection = createModels({ credentials: credentialBridge(this.ctx.credentials, check), authContext: { env: async () => undefined, fileExists: async () => false } })
      collection.setProvider(providerFactories[provider]())
      const resolved = await collection.getAuth(provider, { signal })
      check()
      if (!resolved) failure('not-connected', 'The provider has no usable OAuth credential.')
      const credential = fromRecord(await this.ctx.credentials.readRecord(recordKeyFor(provider)))
      const accountId = credential?.type === 'oauth' && typeof credential.accountId === 'string' ? credential.accountId : undefined
      const discovered = await discoverAccountModels(provider, { auth: resolved.auth, ...(accountId ? { accountId } : {}) }, {
        signal, maxBytes: this.options.maxResponseBytes, maxPages: this.options.maxPages, codexClientVersion: this.options.codexClientVersion,
      })
      check()
      const next: ProviderModels = { ...state, discovered, syncedAt: new Date().toISOString() }
      const identity = accountIdentity(provider, credential)
      if (identity) next.account = identity
      const expected = this.revision()
      // External edits while a network request was pending must not be overwritten.
      if (JSON.stringify(this.state().providers[provider]) !== JSON.stringify(state)) failure('settings-conflict', 'Models changed during synchronization. Refresh and retry.')
      await this.save(provider, next, expected)
      check()
      await this.publish(provider, next)
      this.errors.delete(provider)
    }).catch(error => {
      const failure = error instanceof ModelOperationError ? error : error instanceof Error && error.name === 'TimeoutError' ? new ModelOperationError('discovery-timeout', 'Model discovery timed out; the previous list was retained.') : controller.signal.aborted ? new ModelOperationError('cancelled', 'Model synchronization was cancelled.') : new ModelOperationError('discovery-failed', 'Model discovery failed; the previous list was retained.')
      this.report(provider, failure); throw failure
    }).finally(() => {
      if (this.controllers.get(provider) === controller) this.controllers.delete(provider)
      this.syncs.delete(provider)
      if (!this.closed) this.changed(provider)
    })
    this.syncs.set(provider, task)
    this.changed(provider)
    return task
  }

  loginStarted(provider: ProviderId): void {
    this.loggingIn.add(provider)
    this.generations.set(provider, (this.generations.get(provider) ?? 0) + 1)
    this.controllers.get(provider)?.abort()
  }
  async loginFinished(provider: ProviderId, authorized: boolean): Promise<void> {
    if (authorized) this.signedOut.delete(provider)
    this.loggingIn.delete(provider)
    await this.ready
    await this.enqueue(provider, async () => {
      if (authorized) {
        const state = this.state().providers[provider]
        const identity = accountIdentity(provider, fromRecord(await this.ctx.credentials.readRecord(recordKeyFor(provider))))
        if (state && (!identity || identity !== state.account)) {
          const { discovered: _discovered, syncedAt: _time, account: _account, ...rest } = state
          await this.save(provider, { ...rest, ...(identity ? { account: identity } : {}) })
        }
        await this.ensureManaged(provider, false)
      } else await this.reconcile(provider)
    })
    if (authorized) await this.sync(provider, this.revision())
  }
  async forget(provider: ProviderId): Promise<void> {
    this.signedOut.add(provider)
    this.generations.set(provider, (this.generations.get(provider) ?? 0) + 1)
    this.controllers.get(provider)?.abort()
    await this.ready
    await this.enqueue(provider, async () => {
      await this.ctx.credentials.deleteRecord(recordKeyFor(provider))
      await this.publish(provider, undefined)
      this.errors.delete(provider)
    })
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.stop.abort()
    for (const dispose of this.disposers) dispose()
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled([...this.queues.values()])
    this.handle?.()
    this.profiles = new Map()
  }
}
