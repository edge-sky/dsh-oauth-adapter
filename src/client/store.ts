/** Browser state machine for the plugin-owned OAuth WebSocket. */

import {
  OAUTH_SOCKET_PATH, OAUTH_SOCKET_PROTOCOL,
} from '../protocol.js'
import type {
  AccountView, ClientCommand, PromptView, ProviderId, ServerMessage,
} from '../protocol.js'

import type { ModelPage, ModelCommand, ManualModel } from '../model-types.js'

export interface NoticeView {
  message: string
  url?: string
  code?: string
}

export interface ActivePromptView {
  id: string
  prompt: PromptView
}

export interface AttemptView {
  id?: string
  provider: ProviderId
  phase: 'starting' | 'running' | 'authorized' | 'cancelled' | 'failed'
  notice?: NoticeView
  prompt?: ActivePromptView
  error?: string
  errorDetail?: string
}

export interface OAuthAccountsSnapshot {
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed'
  accounts: readonly AccountView[]
  modelPages?: Partial<Record<ProviderId, ModelPage>>
  modelBusy?: Partial<Record<ProviderId, boolean>>
  modelErrors?: Partial<Record<ProviderId, { code: string; message: string }>>
  attempt?: AttemptView
  error?: string
  errorDetail?: string
}

type Listener = () => void

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${OAUTH_SOCKET_PATH}`
}

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/** Remove interaction-only content once an authorization attempt settles. */
export function settleAttemptView(
  attempt: AttemptView,
  status: Extract<ServerMessage, { type: 'settled' }>['status'],
): AttemptView {
  const next = { ...attempt, phase: status } as AttemptView
  delete next.prompt
  delete next.notice
  return next
}

/** Hide a successful attempt after the account snapshot confirms its model route. */
export function reconcileAttemptView(
  attempt: AttemptView | undefined,
  accounts: readonly AccountView[],
): AttemptView | undefined {
  if (attempt?.phase !== 'authorized' || attempt.error !== undefined) return attempt
  const account = accounts.find(candidate => candidate.provider === attempt.provider)
  return account?.configured === true && account.modelsEnabled ? undefined : attempt
}

/** App-lifetime controller; reconnects without persisting provider messages or answers. */
export class OAuthAccountsController {
  private snapshot: OAuthAccountsSnapshot = { connection: 'connecting', accounts: [] }
  private readonly listeners = new Set<Listener>()
  private socket: WebSocket | undefined
  private reconnectTimer: number | undefined
  private reconnectDelay = 500
  private disposed = false
  private modelsVisible = false
  private readonly modelRequests = new Map<string, { provider: ProviderId; write: boolean }>()
  private readonly latestModelReads = new Map<ProviderId, string>()

  constructor() {
    this.connect()
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): OAuthAccountsSnapshot => this.snapshot

  begin(provider: ProviderId): void {
    if (this.snapshot.attempt?.phase === 'starting' || this.snapshot.attempt?.phase === 'running') return
    const { error: _error, errorDetail: _errorDetail, ...current } = this.snapshot
    this.update({
      ...current,
      attempt: { provider, phase: 'starting' },
    })
    this.send({ type: 'begin', requestId: crypto.randomUUID(), provider })
  }

  respond(attemptId: string, promptId: string, value: string): void {
    this.send({ type: 'respond', requestId: crypto.randomUUID(), attemptId, promptId, value })
    const attempt = this.snapshot.attempt
    if (attempt?.id === attemptId && attempt.prompt?.id === promptId) {
      const next = { ...attempt }
      delete next.prompt
      this.update({ ...this.snapshot, attempt: next })
    }
  }

  cancel(attemptId: string): void {
    this.send({ type: 'cancel', requestId: crypto.randomUUID(), attemptId })
  }

  forget(provider: ProviderId): void {
    this.send({ type: 'forget', requestId: crypto.randomUUID(), provider })
  }

  loadModels(): void {
    this.modelsVisible = true
    for (const provider of this.snapshot.accounts) this.readModels(provider.provider)
  }

  readModels(provider: ProviderId, offset = 0): void {
    if (this.snapshot.connection !== 'open') return
    const requestId = crypto.randomUUID()
    this.latestModelReads.set(provider, requestId)
    this.modelRequests.set(requestId, { provider, write: false })
    this.send({ type: 'models-list', requestId, provider, offset })
  }

  syncModels(provider: ProviderId): void { this.writeModels(provider, { type: 'models-sync' }) }
  migrateModels(provider: ProviderId): void { this.writeModels(provider, { type: 'models-migrate' }) }
  saveModel(provider: ProviderId, model: ManualModel): void { this.writeModels(provider, { type: 'models-save', model }) }
  deleteModel(provider: ProviderId, id: string): void { this.writeModels(provider, { type: 'models-delete', id }) }

  private writeModels(provider: ProviderId, operation: { type: 'models-sync' | 'models-migrate' } | { type: 'models-save'; model: ManualModel } | { type: 'models-delete'; id: string }): void {
    const page = this.snapshot.modelPages?.[provider]
    if (!page || this.snapshot.modelBusy?.[provider] || this.snapshot.connection !== 'open') return
    const requestId = crypto.randomUUID()
    this.modelRequests.set(requestId, { provider, write: true })
    this.update({ ...this.snapshot, modelBusy: { ...this.snapshot.modelBusy, [provider]: true }, modelErrors: { ...this.snapshot.modelErrors, [provider]: undefined } })
    this.send({ ...operation, requestId, provider, revision: page.revision } as ModelCommand)
  }

  retry(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.connect()
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close(1000, 'client plugin disposed')
    this.socket = undefined
    this.listeners.clear()
  }

  private connect(): void {
    if (this.disposed) return
    this.update({ ...this.snapshot, connection: this.socket === undefined ? 'connecting' : 'reconnecting' })
    const socket = new WebSocket(socketUrl(), OAUTH_SOCKET_PROTOCOL)
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.reconnectDelay = 500
      const { error: _error, errorDetail: _errorDetail, ...current } = this.snapshot
      this.update({ ...current, connection: 'open' })
      this.modelRequests.clear()
      this.latestModelReads.clear()
      this.update({ ...this.snapshot, modelBusy: {} })
      this.send({ type: 'refresh', requestId: crypto.randomUUID() })
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      let value: unknown
      try {
        value = JSON.parse(event.data)
      } catch {
        const next = { ...this.snapshot, error: 'DSH returned an invalid OAuth message.' }
        delete next.errorDetail
        this.update(next)
        return
      }
      if (isServerMessage(value)) this.receive(value)
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      if (this.disposed) {
        this.update({ ...this.snapshot, connection: 'closed' })
        return
      }
      const attempt = this.snapshot.attempt
      const interrupted = {
        ...this.snapshot,
        connection: 'reconnecting',
        error: 'The OAuth connection to DSH was interrupted.',
        ...attempt === undefined || attempt.phase === 'authorized' || attempt.phase === 'cancelled'
          ? {}
          : { attempt: { ...attempt, phase: 'failed', error: 'The OAuth connection to DSH was interrupted.' } },
      } satisfies OAuthAccountsSnapshot
      delete interrupted.errorDetail
      if (interrupted.attempt?.error === 'The OAuth connection to DSH was interrupted.') {
        delete interrupted.attempt.errorDetail
      }
      this.update(interrupted)
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000)
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = undefined
        this.connect()
      }, delay)
    })
    socket.addEventListener('error', () => {
      // `close` owns retry and presentation; browser WebSocket errors expose no safe detail.
    })
  }

  private send(command: ClientCommand): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      const next = { ...this.snapshot, error: 'The OAuth connection to DSH is not ready.' }
      delete next.errorDetail
      this.update(next)
      return
    }
    this.socket.send(JSON.stringify(command))
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'models-changed':
        if (this.modelsVisible) this.readModels(message.provider, this.snapshot.modelPages?.[message.provider]?.offset ?? 0)
        return
      case 'models-page': {
        const request = this.modelRequests.get(message.requestId)
        this.modelRequests.delete(message.requestId)
        if (!request) return
        if (!request.write && this.latestModelReads.get(request.provider) !== message.requestId) return
        const current = this.snapshot.modelPages?.[request.provider]
        if (current && message.page.revision < current.revision) {
          if (request.write) this.update({ ...this.snapshot, modelBusy: { ...this.snapshot.modelBusy, [request.provider]: false } })
          return
        }
        this.update({ ...this.snapshot, modelPages: { ...this.snapshot.modelPages, [request.provider]: message.page },
          modelBusy: { ...this.snapshot.modelBusy, ...(request.write ? { [request.provider]: false } : {}) } })
        return
      }
      case 'models-error': {
        const request = this.modelRequests.get(message.requestId)
        this.modelRequests.delete(message.requestId)
        if (!request) return
        if (!request.write && this.latestModelReads.get(request.provider) !== message.requestId) return
        this.update({ ...this.snapshot, modelBusy: { ...this.snapshot.modelBusy, ...(request.write ? { [request.provider]: false } : {}) },
          modelErrors: { ...this.snapshot.modelErrors, [request.provider]: { code: message.code, message: message.message } } })
        if (request.write) this.readModels(request.provider)
        return
      }
      case 'snapshot':
        const accounts = [...message.accounts]
        const reconciled = reconcileAttemptView(this.snapshot.attempt, accounts)
        const nextSnapshot = { ...this.snapshot, accounts }
        if (reconciled === undefined) delete nextSnapshot.attempt
        else nextSnapshot.attempt = reconciled
        this.update(nextSnapshot)
        if (this.modelsVisible) for (const account of accounts) this.readModels(account.provider, this.snapshot.modelPages?.[account.provider]?.offset ?? 0)
        return
      case 'started':
        const { error: _error, errorDetail: _errorDetail, ...current } = this.snapshot
        this.update({
          ...current,
          attempt: { id: message.attemptId, provider: message.provider, phase: 'running' },
        })
        return
      case 'notice': {
        const attempt = this.snapshot.attempt
        if (attempt?.id !== message.attemptId) return
        this.update({
          ...this.snapshot,
          attempt: {
            ...attempt,
            notice: {
              message: message.message,
              ...message.url === undefined ? {} : { url: message.url },
              ...message.code === undefined ? {} : { code: message.code },
            },
          },
        })
        return
      }
      case 'prompt': {
        const attempt = this.snapshot.attempt
        if (attempt?.id !== message.attemptId) return
        this.update({
          ...this.snapshot,
          attempt: { ...attempt, prompt: { id: message.promptId, prompt: message.prompt } },
        })
        return
      }
      case 'prompt-withdrawn': {
        const attempt = this.snapshot.attempt
        if (attempt?.id !== message.attemptId || attempt.prompt?.id !== message.promptId) return
        const next = { ...attempt }
        delete next.prompt
        this.update({ ...this.snapshot, attempt: next })
        return
      }
      case 'settled': {
        const attempt = this.snapshot.attempt
        if (attempt?.id !== message.attemptId) return
        this.update({ ...this.snapshot, attempt: settleAttemptView(attempt, message.status) })
        return
      }
      case 'error': {
        const attempt = this.snapshot.attempt
        if (message.attemptId !== undefined && attempt?.id === message.attemptId) {
          const nextAttempt = { ...attempt, error: message.message }
          if (message.detail === undefined) delete nextAttempt.errorDetail
          else nextAttempt.errorDetail = message.detail
          this.update({ ...this.snapshot, attempt: nextAttempt })
        } else {
          const next = { ...this.snapshot, error: message.message }
          if (message.detail === undefined) delete next.errorDetail
          else next.errorDetail = message.detail
          this.update(next)
        }
        return
      }
      case 'ack':
        return
    }
  }

  private update(snapshot: OAuthAccountsSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
