/** Build immutable pi-ai profiles from account discovery and explicitly authored models. */
import { createProvider } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import { xaiProvider } from '@earendil-works/pi-ai/providers/xai'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PROVIDERS, type ProviderId } from './protocol.js'
import { MODEL_PROTOCOLS, modelText, validManual, type ManualModel, type DiscoveredModel, type ModelRow } from './model-types.js'
import { ModelOperationError } from './model-discovery.js'

export const providerFactories: Record<ProviderId, () => Provider> = {
  'github-copilot': githubCopilotProvider, 'openai-codex': openaiCodexProvider,
  anthropic: anthropicProvider, 'kimi-coding': kimiCodingProvider,
  openrouter: openrouterProvider, xai: xaiProvider,
}
export interface ProviderModels {
  phase: 'pending' | 'managed'
  restoredFromLegacy?: boolean
  legacy: PiAiProviderProfile
  manual: ManualModel[]
  discovered?: DiscoveredModel[]
  syncedAt?: string
  /** A hash of a stable provider account identity; never an access/refresh token. */
  account?: string
}
export interface ModelStore { version: 1; providers: Partial<Record<ProviderId, ProviderModels>> }

/** Validate data loaded from the settings file, including the opaque legacy profile. */
export function validateModelStore(value: unknown): ModelStore {
  if (!value || typeof value !== 'object') throw new Error('Invalid oauth-models settings')
  const store = value as ModelStore
  if (store.version !== 1 || !store.providers || typeof store.providers !== 'object' || Array.isArray(store.providers)) throw new Error('Unsupported oauth-models format')
  for (const [id, entry] of Object.entries(store.providers)) {
    if (!PROVIDERS.some(p => p.id === id) || !entry || !['pending', 'managed'].includes(entry.phase)) throw new Error('Invalid OAuth model provider')
    if (!Array.isArray(entry.manual) || entry.manual.some(m => !validManual(id as ProviderId, m))) throw new Error('Invalid manual OAuth model')
    if (new Set(entry.manual.map(m => m.id)).size !== entry.manual.length) throw new Error('Duplicate manual OAuth model')
    if (entry.discovered !== undefined && (!Array.isArray(entry.discovered) || entry.discovered.some(m => !m || !modelText(m.id) || (m.name !== undefined && !modelText(m.name))))) throw new Error('Invalid discovered OAuth model')
    if (entry.syncedAt !== undefined && (typeof entry.syncedAt !== 'string' || !Number.isFinite(Date.parse(entry.syncedAt)))) throw new Error('Invalid synchronization time')
    if (entry.account !== undefined && (typeof entry.account !== 'string' || !/^[a-f0-9]{64}$/.test(entry.account))) throw new Error('Invalid account identity')
    if (!entry.legacy || typeof entry.legacy !== 'object' || Array.isArray(entry.legacy)) throw new Error('Invalid legacy profile')
    PiConfig({ providers: { [id]: entry.legacy } })
  }
  return store
}

/** Exact IDs only: unrelated providers and display-name similarities confer no compatibility. */
export function materialize(provider: ProviderId, state: ProviderModels, catalog: Provider = providerFactories[provider]()): { profile: ResolvedPiAiProviderProfile; rows: ModelRow[] } {
  const defaults = new Map(catalog.getModels().map(m => [m.id, m]))
  const parsed = PiConfig({ providers: { [provider]: state.legacy } }).providers?.[provider]
  if (!parsed) throw new Error('Missing provider profile')
  const manual = new Map(state.manual.map(m => [m.id, m]))
  const configured = new Map((parsed.models ?? []).map(m => [m.id, m]))
  const candidates = state.discovered ?? (configured.size ? [...configured.values()] : [...defaults.values()])
  const ids = new Set([...candidates.map(m => m.id), ...manual.keys()])
  const rows: ModelRow[] = []
  const models: Model<Api>[] = []
  const caps = new Map<string, number>()
  for (const id of ids) {
    const base = defaults.get(id)
    const authored = manual.get(id)
    const previous = configured.get(id) ?? parsed.modelOverrides?.[id]
    const candidate = candidates.find(m => m.id === id)
    if (!base && !authored) {
      rows.push({ id, name: candidate?.name ?? id, source: 'pending' })
      continue
    }
    const choices: readonly string[] = MODEL_PROTOCOLS[provider]
    const api = authored ? authored.api ?? (choices.length === 1 ? choices[0] : base?.api) : parsed.api ?? base?.api
    if (!api) throw new ModelOperationError('model-protocol', `Model ${id} needs a protocol.`)
    const peers = [...defaults.values()].filter(m => m.api === api)
    // Only provider-wide shared transport metadata can default an unknown model.
    const shared = <T extends Record<string, unknown>>(items: (T | undefined)[]): T | undefined => {
      const first = items[0]
      if (!first) return undefined
      return Object.fromEntries(Object.entries(first).filter(([k,v]) => items.every(item => item && JSON.stringify(item[k]) === JSON.stringify(v)))) as T
    }
    const headers = shared(peers.map(m => m.headers))
    const compat = shared(peers.map(m => m.compat as Record<string, unknown> | undefined))
    const generic: Model<Api> = {
      id, name: id, provider, api: api as Api, baseUrl: parsed.baseURL ?? (provider === 'openrouter' && api === 'anthropic-messages' ? 'https://openrouter.ai/api' : catalog.baseUrl) ?? '',
      reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: parsed.defaultContextWindow ?? 262144, maxTokens: parsed.defaultMaxTokens ?? 32768,
      ...(headers ? { headers } : {}), ...(compat ? { compat } : {}),
    }
    const model = {
      ...(base?.api === api ? base : { ...generic, ...(base ? { input: base.input, reasoning: base.reasoning, contextWindow: base.contextWindow, maxTokens: base.maxTokens, cost: base.cost } : {}) }), ...previous, id, provider, api: api as Api,
      name: authored ? authored.name ?? id : previous?.name ?? base?.name ?? candidate?.name ?? id,
      ...(parsed.baseURL === undefined ? {} : { baseUrl: parsed.baseURL }),
    } as Model<Api>
    const accepted = api === 'openai-completions' ? ['supportsStore','supportsDeveloperRole','supportsReasoningEffort','supportsUsageInStreaming','supportsFinishReason','maxTokensField','requiresToolResultName','requiresAssistantAfterToolResult','requiresThinkingAsText','requiresReasoningContentOnAssistantMessages','thinkingFormat','chatTemplateKwargs','chatTemplateArgs','supportsThinkingTokenBudget','supportsStrictMode','cacheControlFormat','supportsLongCacheRetention'] : api === 'anthropic-messages' ? ['supportsEagerToolInputStreaming','supportsLongCacheRetention','supportsCacheControlOnTools','supportsTemperature','forceAdaptiveThinking','allowEmptySignature','supportsStrictTools'] : ['supportsDeveloperRole','supportsStrictMode','supportsLongCacheRetention']
    const routeCompat = Object.fromEntries(Object.entries(parsed.compat ?? {}).filter(([key]) => accepted.includes(key)))
    for (const key of Object.keys(previous?.compat ?? {})) if (!accepted.includes(key)) throw new ModelOperationError('model-compat', `Model ${id} has an incompatible ${key} option.`)
    if (Object.keys(routeCompat).length || previous?.compat) model.compat = { ...(base?.api === api ? base.compat : generic.compat), ...routeCompat, ...previous?.compat }
    if (previous?.reasoningEfforts !== undefined) {
      model.reasoning = previous.reasoningEfforts !== false
      if (previous.reasoningEfforts !== false) {
        const efforts = previous.reasoningEfforts
        if (!Object.entries(efforts).some(([level, value]) => level !== 'off' && typeof value === 'string' && value.length)) throw new ModelOperationError('model-reasoning', `Model ${id} needs explicit reasoning levels.`)
        model.thinkingLevelMap = Object.fromEntries(['off','minimal','low','medium','high','xhigh','max'].flatMap(level => level === 'off' && efforts.off === null ? [] : [[level, efforts[level as keyof typeof efforts] ?? null]]))
      }
    }
    if (!model.baseUrl) throw new ModelOperationError('model-endpoint', `Provider ${provider} has no endpoint.`)
    if (previous?.maxTokens !== undefined) caps.set(id, previous.maxTokens)
    models.push(freezeModel(model))
    rows.push({ id, name: model.name, api, source: authored ? 'manual' : state.discovered ? 'matched' : 'catalog' })
  }
  const { models: _models, displayName: _displayName, apiKeyEnv: _key, retryPolicy: _retry, ...rest } = parsed
  const piProvider = provider === 'openrouter' ? createProvider({
    id: provider, name: catalog.name, baseUrl: catalog.baseUrl!, auth: catalog.auth, models,
    api: { 'openai-completions': openAICompletionsApi(), 'anthropic-messages': anthropicMessagesApi() },
  }) : { ...catalog, getModels: () => models, filterModels: (current: readonly Model<Api>[]) => current }
  return {
    rows,
    profile: {
      ...rest, provider, displayName: parsed.displayName ?? PROVIDERS.find(p => p.id === provider)!.modelGroupLabel,
      streamIdleTimeoutMs: parsed.streamIdleTimeoutMs ?? 300000,
      maxRequestImageBytes: parsed.maxRequestImageBytes ?? 20971520,
      requestImagePixelBudget: parsed.requestImagePixelBudget ?? 4194304,
      requestImageMaxBytes: parsed.requestImageMaxBytes ?? 1048576,
      retryPolicy: resolveRetryPolicy(parsed.retryPolicy, `oauth-models/${provider}`),
      configuredMaxTokens: caps,
      piProvider,
    },
  }
}

/** Freeze JSON model metadata recursively; prepared calls retain their captured descriptions. */
function freezeModel<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeModel(child)
    Object.freeze(value)
  }
  return value
}
