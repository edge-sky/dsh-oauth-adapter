/** Shared browser/Host wire vocabulary for the OAuth account surface. */

export const OAUTH_SOCKET_PATH = '/_edge-sky/dsh-oauth'
export const OAUTH_SOCKET_PROTOCOL = 'dsh-oauth-v1'
export const MAX_FRAME_BYTES = 16 * 1024
export const MAX_ANSWER_LENGTH = 8 * 1024

export const PROVIDERS = [
  {
    id: 'openai-codex', key: 'llm-pi-ai/openai-codex', fallbackLabel: 'OpenAI Codex',
    modelGroupLabel: 'OpenAI Codex (OAuth)',
  },
  {
    id: 'github-copilot', key: 'llm-pi-ai/github-copilot', fallbackLabel: 'GitHub Copilot',
    modelGroupLabel: 'GitHub Copilot (OAuth)',
  },
  {
    id: 'anthropic', key: 'llm-pi-ai/anthropic', fallbackLabel: 'Anthropic',
    modelGroupLabel: 'Anthropic (OAuth)',
  },
  {
    id: 'kimi-coding', key: 'llm-pi-ai/kimi-coding', fallbackLabel: 'Kimi For Coding',
    modelGroupLabel: 'Kimi For Coding (OAuth)',
  },
  {
    id: 'openrouter', key: 'llm-pi-ai/openrouter', fallbackLabel: 'OpenRouter',
    modelGroupLabel: 'OpenRouter (OAuth)',
  },
  {
    id: 'xai', key: 'llm-pi-ai/xai', fallbackLabel: 'xAI',
    modelGroupLabel: 'xAI (OAuth)',
  },
] as const

export type ProviderId = (typeof PROVIDERS)[number]['id']

export interface AccountView {
  provider: ProviderId
  label: string
  available: boolean
  configured: boolean
  /** Whether llm-pi-ai currently exposes this OAuth provider as a model route. */
  modelsEnabled: boolean
  writable: boolean
  inFlight: boolean
}

export type PromptView = {
  kind: 'text'
  message: string
  placeholder?: string
  /** Whether an empty response has provider-defined meaning. */
  allowEmpty?: boolean
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly { id: string; label: string; description?: string }[]
}

export type ClientCommand =
  | { type: 'refresh'; requestId: string }
  | { type: 'begin'; requestId: string; provider: ProviderId }
  | { type: 'respond'; requestId: string; attemptId: string; promptId: string; value: string }
  | { type: 'cancel'; requestId: string; attemptId: string }
  | { type: 'forget'; requestId: string; provider: ProviderId }

export type OAuthErrorCode =
  | 'invalid-message'
  | 'unsupported-provider'
  | 'authorization-unavailable'
  | 'busy'
  | 'invalid-attempt'
  | 'invalid-prompt'
  | 'credential-read-only'
  | 'model-route-unavailable'
  | 'sign-in-failed'
  | 'operation-failed'

export type ServerMessage =
  | { type: 'snapshot'; requestId?: string; accounts: readonly AccountView[] }
  | { type: 'started'; requestId: string; attemptId: string; provider: ProviderId }
  | { type: 'notice'; attemptId: string; message: string; url?: string; code?: string }
  | { type: 'prompt'; attemptId: string; promptId: string; prompt: PromptView }
  | { type: 'prompt-withdrawn'; attemptId: string; promptId: string }
  | { type: 'settled'; attemptId: string; status: 'authorized' | 'cancelled' | 'failed' }
  | { type: 'ack'; requestId: string }
  | {
    type: 'error'
    requestId?: string
    attemptId?: string
    code: OAuthErrorCode
    message: string
    /** Bounded, credential-redacted Host diagnostic for optional UI expansion. */
    detail?: string
  }

export type CommandParseResult =
  | { ok: true; value: ClientCommand }
  | { ok: false; requestId?: string; message: string }

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function isProviderId(value: unknown): value is ProviderId {
  return PROVIDERS.some(provider => provider.id === value)
}

/** Parse one untrusted browser frame without retaining its raw text. */
export function parseClientCommand(raw: string): CommandParseResult {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return { ok: false, message: 'message is not valid JSON' }
  }
  if (!isRecord(candidate) || typeof candidate.type !== 'string') {
    return { ok: false, message: 'message must be an object with a type' }
  }
  const requestId = isId(candidate.requestId) ? candidate.requestId : undefined
  if (requestId === undefined) return { ok: false, message: 'requestId is invalid' }

  switch (candidate.type) {
    case 'refresh':
      return exactKeys(candidate, ['requestId', 'type'])
        ? { ok: true, value: { type: 'refresh', requestId } }
        : { ok: false, requestId, message: 'refresh contains unknown fields' }
    case 'begin':
    case 'forget': {
      if (!exactKeys(candidate, ['provider', 'requestId', 'type'])) {
        return { ok: false, requestId, message: `${candidate.type} contains unknown fields` }
      }
      if (!isProviderId(candidate.provider)) {
        return { ok: false, requestId, message: 'provider is unsupported' }
      }
      return { ok: true, value: { type: candidate.type, requestId, provider: candidate.provider } }
    }
    case 'cancel':
      if (!exactKeys(candidate, ['attemptId', 'requestId', 'type']) || !isId(candidate.attemptId)) {
        return { ok: false, requestId, message: 'cancel fields are invalid' }
      }
      return { ok: true, value: { type: 'cancel', requestId, attemptId: candidate.attemptId } }
    case 'respond':
      if (!exactKeys(candidate, ['attemptId', 'promptId', 'requestId', 'type', 'value'])
        || !isId(candidate.attemptId) || !isId(candidate.promptId)
        || typeof candidate.value !== 'string' || candidate.value.length > MAX_ANSWER_LENGTH) {
        return { ok: false, requestId, message: 'respond fields are invalid' }
      }
      return {
        ok: true,
        value: {
          type: 'respond', requestId, attemptId: candidate.attemptId,
          promptId: candidate.promptId, value: candidate.value,
        },
      }
    default:
      return { ok: false, requestId, message: 'message type is unsupported' }
  }
}
