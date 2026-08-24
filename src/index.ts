/**
 * DSH Web surface for authorization flows owned by the official
 * `dsh-llm-pi-ai` plugin.
 * @module @edge-sky/dsh-oauth-adapter
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { inspect } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationPrompt, AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import WebSocket, { WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import {
  MAX_FRAME_BYTES, OAUTH_SOCKET_PATH, OAUTH_SOCKET_PROTOCOL, PROVIDERS, parseClientCommand,
} from './protocol.js'
import type {
  AccountView, ClientCommand, OAuthErrorCode, PromptView, ProviderId, ServerMessage,
} from './protocol.js'

/** Plugin configuration. */
export interface Config {
  /** Emit secret-free transport lifecycle diagnostics. */
  debug?: boolean
}

/** Runtime-validated plugin configuration. */
export const Config: z<Config> = z.object({
  debug: z.boolean().default(false),
})

/** Cordis plugin name. */
export const name = 'dsh-oauth-adapter'
/** Official services required by the OAuth account surface. */
export const inject = ['authorization', 'credentials', 'settings', 'webServer']

const MODEL_SETTINGS_NS = settingsNamespace('llm-pi-ai')

type OAuthContext = Context & {
  authorization: AuthorizationService
  credentials: CredentialProvider
  settings: SettingsProvider
  webServer: WebServer
}

interface ActiveAttempt {
  id: string
  provider: ProviderId
  key: string
  controller: AbortController
  prompts: Map<string, PendingPrompt>
}

interface PendingPrompt {
  resolve(value: string): void
  reject(reason: Error): void
}

function providerMeta(providerId: ProviderId): (typeof PROVIDERS)[number] {
  const provider = PROVIDERS.find(candidate => candidate.id === providerId)
  if (provider === undefined) throw new Error(`unsupported provider: ${providerId}`)
  return provider
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function modelRouteEnabled(settings: SettingsProvider, provider: ProviderId): boolean {
  const section = settings.get(MODEL_SETTINGS_NS)
  if (!isRecord(section) || !isRecord(section.providers)) return false
  return Object.hasOwn(section.providers, provider)
}

function pluginOwnsModelRoute(settings: SettingsProvider, provider: (typeof PROVIDERS)[number]): boolean {
  const descriptor = settings.describe().find(candidate => candidate.ns === MODEL_SETTINGS_NS)
  if (!isRecord(descriptor?.user) || !isRecord(descriptor.user.providers)) return false
  const profile = descriptor.user.providers[provider.id]
  return isRecord(profile)
    && Object.keys(profile).length === 1
    && profile.displayName === provider.modelGroupLabel
}

const GITHUB_DOMAIN_PROMPT = 'GitHub Enterprise URL/domain (blank for github.com)'

function promptView(prompt: AuthorizationPrompt, provider: ProviderId): PromptView {
  if (prompt.kind === 'select') {
    return { kind: 'select', message: prompt.message, options: prompt.options.map(option => ({ ...option })) }
  }
  return {
    kind: prompt.kind,
    message: prompt.message,
    ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
    ...provider === 'github-copilot' && prompt.kind === 'text' && prompt.message === GITHUB_DOMAIN_PROMPT
      ? { allowEmpty: true }
      : {},
  }
}

function providerPromptAnswer(prompt: AuthorizationPrompt, provider: ProviderId, value: string): string {
  if (provider === 'github-copilot' && prompt.kind === 'text'
    && prompt.message === GITHUB_DOMAIN_PROMPT && value.trim().length === 0) {
    return 'github.com'
  }
  return value
}

/** Whether a socket address belongs to the local host. */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Keep provider-supplied navigation targets inside browser-safe URL schemes. */
export function safeNoticeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Validate the browser handshake before `ws` takes ownership of the socket. */
export function acceptsBrowserUpgrade(request: IncomingMessage): boolean {
  const host = request.headers.host
  const origin = request.headers.origin
  if (host === undefined || origin === undefined || !isLoopbackAddress(request.socket.remoteAddress)) return false
  if (request.headers['sec-websocket-protocol'] !== OAUTH_SOCKET_PROTOCOL) return false
  let hostUrl: URL
  let originUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (originUrl.protocol !== 'http:' || originUrl.host !== hostUrl.host) return false
  return hostUrl.hostname === '127.0.0.1' || hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]'
}

function rejectUpgrade(socket: Duplex): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  socket.destroy()
}

function rawLength(raw: RawData): number {
  if (Array.isArray(raw)) return raw.reduce((total, chunk) => total + chunk.byteLength, 0)
  return raw.byteLength
}

const MAX_ERROR_DETAIL_LENGTH = 12 * 1024
const MAX_ERROR_CAUSE_DEPTH = 6

function redactErrorDetail(value: string): string {
  return value
    .replace(
      /(\bAuthorization\b\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?([^"'\s,}&]+)/giu,
      '$1[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(
      /(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key)\b\s*["']?\s*[:=]\s*["']?)([^"'\s,}&]+)/giu,
      '$1[REDACTED]',
    )
    .replace(/\b(?:github_pat_|gh[opusr]_|sk-)[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED]')
}

function errorProperties(value: object): string | undefined {
  const record = value as Record<string, unknown>
  const properties = ['code', 'status', 'statusCode']
    .flatMap((key) => {
      const entry = record[key]
      return typeof entry === 'string' || typeof entry === 'number' ? [`${key}: ${String(entry)}`] : []
    })
  return properties.length === 0 ? undefined : properties.join(', ')
}

/** Format one Host failure for browser diagnostics without forwarding credentials or unbounded data. */
export function formatErrorDetail(error: unknown): string {
  const sections: string[] = []
  const seen = new Set<object>()
  let current: unknown = error
  for (let depth = 0; current !== undefined && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        sections.push('Caused by: [circular error cause]')
        current = undefined
        break
      }
      seen.add(current)
    }
    const prefix = depth === 0 ? '' : 'Caused by: '
    if (current instanceof Error) {
      const properties = errorProperties(current)
      const rendered = current.stack ?? `${current.name}: ${current.message}`
      sections.push(`${prefix}${rendered}${properties === undefined ? '' : `\n${properties}`}`)
      current = current.cause
      continue
    }
    sections.push(prefix + (typeof current === 'string'
      ? current
      : inspect(current, {
        breakLength: 120,
        compact: false,
        customInspect: false,
        depth: 4,
        maxArrayLength: 40,
        maxStringLength: 4096,
        sorted: true,
      })))
    current = undefined
    break
  }
  if (current !== undefined) sections.push('Caused by: [additional causes omitted]')
  const redacted = redactErrorDetail(sections.join('\n'))
  if (redacted.length <= MAX_ERROR_DETAIL_LENGTH) return redacted
  return `${redacted.slice(0, MAX_ERROR_DETAIL_LENGTH)}\n[diagnostic truncated]`
}

/** One ownership-scoped browser authorization connection. */
class OAuthConnection {
  private active: ActiveAttempt | undefined
  private queue = Promise.resolve()
  private closed = false

  constructor(
    private readonly ctx: OAuthContext,
    private readonly socket: WebSocket,
    private readonly debug: (message: string) => void,
    private readonly changed: () => void,
  ) {
    socket.on('message', (raw, isBinary) => {
      if (isBinary || rawLength(raw) > MAX_FRAME_BYTES) {
        this.sendError('invalid-message', 'message must be bounded UTF-8 JSON')
        socket.close(1009, 'invalid message')
        return
      }
      this.queue = this.queue.then(() => this.receive(raw.toString())).catch((error: unknown) => {
        this.ctx.logger.warn('dsh-oauth-adapter: command handling failed')
        this.ctx.logger.warn(error)
        this.sendError('operation-failed', 'the OAuth operation failed', undefined, undefined, formatErrorDetail(error))
      })
    })
    socket.on('close', () => {
      this.closed = true
      this.withdrawActive('browser connection closed')
      this.debug('connection=closed')
    })
    socket.on('error', (error) => {
      this.ctx.logger.debug('dsh-oauth-adapter: browser socket failed: %s', error.message)
    })
    this.debug('connection=opened')
    void this.sendSnapshot()
  }

  refresh(): void {
    void this.sendSnapshot()
  }

  dispose(): void {
    this.closed = true
    this.withdrawActive('OAuth surface stopped')
    this.socket.terminate()
  }

  private send(message: ServerMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private sendError(
    code: OAuthErrorCode,
    message: string,
    requestId?: string,
    attemptId?: string,
    detail?: string,
  ): void {
    this.send({
      type: 'error', code, message,
      ...requestId === undefined ? {} : { requestId },
      ...attemptId === undefined ? {} : { attemptId },
      ...detail === undefined ? {} : { detail },
    })
  }

  private async receive(raw: string): Promise<void> {
    const parsed = parseClientCommand(raw)
    if (!parsed.ok) {
      this.sendError(
        parsed.message === 'provider is unsupported' ? 'unsupported-provider' : 'invalid-message',
        parsed.message,
        parsed.requestId,
      )
      return
    }
    await this.handle(parsed.value)
  }

  private async handle(command: ClientCommand): Promise<void> {
    switch (command.type) {
      case 'refresh':
        await this.sendSnapshot(command.requestId)
        return
      case 'begin':
        this.begin(command)
        return
      case 'respond':
        this.respond(command)
        return
      case 'cancel':
        this.cancel(command)
        return
      case 'forget':
        await this.forget(command)
    }
  }

  private async account(provider: (typeof PROVIDERS)[number]): Promise<AccountView> {
    const entry = this.ctx.authorization.describe(provider.key as never)
    const credential = await this.ctx.credentials.describeRecord(provider.key as never)
    let modelsEnabled = modelRouteEnabled(this.ctx.settings, provider.id)
    if (credential.configured && !modelsEnabled && this.ctx.settings.writable) {
      try {
        modelsEnabled = await this.enableModelRoute(provider)
      } catch (error) {
        this.ctx.logger.warn('dsh-oauth-adapter: model route activation failed for %s', provider.id)
        this.ctx.logger.warn(error)
      }
    }
    return {
      provider: provider.id,
      label: entry?.label ?? provider.fallbackLabel,
      available: entry?.methods.some(method => method.id === 'oauth') === true,
      configured: credential.configured,
      modelsEnabled,
      writable: credential.writable,
      inFlight: entry?.inFlight ?? false,
    }
  }

  private async enableModelRoute(provider: (typeof PROVIDERS)[number]): Promise<boolean> {
    if (modelRouteEnabled(this.ctx.settings, provider.id)) return true
    if (!this.ctx.settings.writable) return false
    await this.ctx.settings.mutate(MODEL_SETTINGS_NS, [{
      op: 'set',
      path: ['providers', provider.id],
      value: { displayName: provider.modelGroupLabel },
    }])
    return modelRouteEnabled(this.ctx.settings, provider.id)
  }

  private async sendSnapshot(requestId?: string): Promise<void> {
    try {
      const accounts = await Promise.all(PROVIDERS.map(provider => this.account(provider)))
      this.send({ type: 'snapshot', accounts, ...requestId === undefined ? {} : { requestId } })
    } catch (error) {
      this.ctx.logger.warn('dsh-oauth-adapter: credential status read failed')
      this.ctx.logger.warn(error)
      this.sendError('operation-failed', 'account status is unavailable', requestId, undefined, formatErrorDetail(error))
    }
  }

  private begin(command: Extract<ClientCommand, { type: 'begin' }>): void {
    if (this.active !== undefined) {
      this.sendError('busy', 'this browser already owns an OAuth attempt', command.requestId, this.active.id)
      return
    }
    const provider = providerMeta(command.provider)
    const entry = this.ctx.authorization.describe(provider.key as never)
    if (entry === undefined || !entry.methods.some(method => method.id === 'oauth')) {
      this.sendError('authorization-unavailable', 'this provider has no OAuth flow', command.requestId)
      return
    }
    if (entry.inFlight) {
      this.sendError('busy', 'an OAuth attempt for this provider is already running', command.requestId)
      return
    }

    const attempt: ActiveAttempt = {
      id: randomUUID(), provider: command.provider, key: provider.key,
      controller: new AbortController(), prompts: new Map(),
    }
    this.active = attempt
    this.changed()
    this.send({ type: 'started', requestId: command.requestId, attemptId: attempt.id, provider: attempt.provider })
    this.debug(`provider=${attempt.provider} stage=started`)
    void this.ctx.authorization.begin({
      key: attempt.key as never,
      method: 'oauth',
      signal: attempt.controller.signal,
      interaction: {
        notify: notice => {
          const url = safeNoticeUrl(notice.url)
          this.send({
            type: 'notice', attemptId: attempt.id, message: notice.message,
            ...url === undefined ? {} : { url },
            ...notice.code === undefined ? {} : { code: notice.code },
          })
        },
        prompt: prompt => this.openPrompt(attempt, prompt),
      },
    }).then(async (outcome) => {
      if (outcome.status === 'authorized') {
        try {
          const enabled = await this.enableModelRoute(provider)
          if (!enabled) {
            this.sendError(
              'model-route-unavailable',
              'sign-in completed, but the OAuth model route could not be enabled',
              undefined,
              attempt.id,
            )
          }
        } catch (error) {
          this.ctx.logger.warn('dsh-oauth-adapter: model route activation failed for %s', provider.id)
          this.ctx.logger.warn(error)
          this.sendError(
            'model-route-unavailable',
            'sign-in completed, but the OAuth model route could not be enabled',
            undefined,
            attempt.id,
            formatErrorDetail(error),
          )
        }
      }
      this.finish(attempt, outcome.status)
    }, (error: unknown) => {
      this.ctx.logger.warn('dsh-oauth-adapter: provider sign-in failed for %s', attempt.provider)
      this.ctx.logger.warn(error)
      this.sendError('sign-in-failed', 'sign-in failed', undefined, attempt.id, formatErrorDetail(error))
      this.finish(attempt, 'failed')
    })
  }

  private openPrompt(attempt: ActiveAttempt, prompt: AuthorizationPrompt): Promise<string> {
    if (this.active !== attempt || this.closed) return Promise.reject(new Error('OAuth connection is closed'))
    const promptId = randomUUID()
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        prompt.signal?.removeEventListener('abort', withdraw)
        attempt.prompts.delete(promptId)
        callback()
      }
      const withdraw = (): void => {
        finish(() => {
          this.send({ type: 'prompt-withdrawn', attemptId: attempt.id, promptId })
          reject(new Error('authorization prompt was withdrawn'))
        })
      }
      attempt.prompts.set(promptId, {
        resolve: value => { finish(() => { resolve(providerPromptAnswer(prompt, attempt.provider, value)) }) },
        reject: reason => { finish(() => { reject(reason) }) },
      })
      prompt.signal?.addEventListener('abort', withdraw, { once: true })
      if (prompt.signal?.aborted === true) {
        withdraw()
        return
      }
      this.send({
        type: 'prompt', attemptId: attempt.id, promptId,
        prompt: promptView(prompt, attempt.provider),
      })
    })
  }

  private respond(command: Extract<ClientCommand, { type: 'respond' }>): void {
    const active = this.active
    if (active?.id !== command.attemptId) {
      this.sendError('invalid-attempt', 'attempt does not belong to this browser', command.requestId)
      return
    }
    const prompt = active.prompts.get(command.promptId)
    if (prompt === undefined) {
      this.sendError('invalid-prompt', 'prompt is expired or unknown', command.requestId, active.id)
      return
    }
    prompt.resolve(command.value)
    this.send({ type: 'ack', requestId: command.requestId })
  }

  private cancel(command: Extract<ClientCommand, { type: 'cancel' }>): void {
    if (this.active?.id !== command.attemptId) {
      this.sendError('invalid-attempt', 'attempt does not belong to this browser', command.requestId)
      return
    }
    this.withdrawActive('authorization cancelled by browser')
    this.send({ type: 'ack', requestId: command.requestId })
  }

  private async forget(command: Extract<ClientCommand, { type: 'forget' }>): Promise<void> {
    const provider = providerMeta(command.provider)
    if (this.ctx.authorization.describe(provider.key as never)?.inFlight === true) {
      this.sendError('busy', 'cancel the active attempt before signing out', command.requestId)
      return
    }
    const current = await this.ctx.credentials.describeRecord(provider.key as never)
    if (!current.writable) {
      this.sendError('credential-read-only', 'this credential store is read-only', command.requestId)
      return
    }
    try {
      await this.ctx.credentials.deleteRecord(provider.key as never)
      if (pluginOwnsModelRoute(this.ctx.settings, provider)) {
        await this.ctx.settings.mutate(MODEL_SETTINGS_NS, [{
          op: 'unset', path: ['providers', provider.id],
        }])
      }
      this.send({ type: 'ack', requestId: command.requestId })
      await this.sendSnapshot()
    } catch (error) {
      this.ctx.logger.warn('dsh-oauth-adapter: sign-out failed for %s', provider.id)
      this.ctx.logger.warn(error)
      this.sendError('operation-failed', 'sign-out failed', command.requestId, undefined, formatErrorDetail(error))
    }
  }

  private finish(attempt: ActiveAttempt, status: 'authorized' | 'cancelled' | 'failed'): void {
    if (this.active !== attempt) return
    this.rejectPrompts(attempt, new Error(`authorization ${status}`))
    this.active = undefined
    this.changed()
    this.send({ type: 'settled', attemptId: attempt.id, status })
    this.debug(`provider=${attempt.provider} stage=settled status=${status}`)
    void this.sendSnapshot()
  }

  private withdrawActive(reason: string): void {
    const active = this.active
    if (active === undefined) return
    active.controller.abort(new Error(reason))
    this.rejectPrompts(active, new Error(reason))
  }

  private rejectPrompts(attempt: ActiveAttempt, reason: Error): void {
    for (const prompt of [...attempt.prompts.values()]) prompt.reject(reason)
    attempt.prompts.clear()
  }
}

/** Mount the loopback-only OAuth WebSocket over official rc2 services. */
export function apply(ctx: OAuthContext, config: Config): () => Promise<void> {
  const debug = config.debug === true
    ? (message: string): void => { ctx.logger.debug('dsh-oauth-adapter: %s', message) }
    : (): void => {}
  const connections = new Set<OAuthConnection>()
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    handleProtocols: protocols => protocols.has(OAUTH_SOCKET_PROTOCOL) ? OAUTH_SOCKET_PROTOCOL : false,
  })
  server.on('connection', (socket) => {
    const connection = new OAuthConnection(ctx, socket, debug, refresh)
    connections.add(connection)
    socket.once('close', () => { connections.delete(connection) })
  })
  server.on('error', (error) => {
    ctx.logger.warn('dsh-oauth-adapter: WebSocket server failed')
    ctx.logger.warn(error)
  })

  const unregister = ctx.webServer.registerUpgrade({
    path: OAUTH_SOCKET_PATH,
    handler(request, socket, head) {
      if (!acceptsBrowserUpgrade(request)) {
        rejectUpgrade(socket)
        return
      }
      server.handleUpgrade(request, socket, head, (webSocket) => {
        server.emit('connection', webSocket, request)
      })
    },
  })
  const refresh = (): void => { for (const connection of connections) connection.refresh() }
  const credentialDisposer = ctx.on('credentials/record-updated', (key) => {
    if (PROVIDERS.some(provider => provider.key === key)) refresh()
  })
  return async () => {
    credentialDisposer()
    unregister()
    for (const connection of connections) connection.dispose()
    connections.clear()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}
