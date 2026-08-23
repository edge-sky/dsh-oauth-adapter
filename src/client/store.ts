/** Browser state machine for the plugin-owned OAuth WebSocket. */

import {
  OAUTH_SOCKET_PATH, OAUTH_SOCKET_PROTOCOL,
} from '../protocol.js'
import type {
  AccountView, ClientCommand, PromptView, ProviderId, ServerMessage,
} from '../protocol.js'

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
}

export interface OAuthAccountsSnapshot {
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed'
  accounts: readonly AccountView[]
  attempt?: AttemptView
  error?: string
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
    const { error: _error, ...current } = this.snapshot
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
      const { error: _error, ...current } = this.snapshot
      this.update({ ...current, connection: 'open' })
      this.send({ type: 'refresh', requestId: crypto.randomUUID() })
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      let value: unknown
      try {
        value = JSON.parse(event.data)
      } catch {
        this.update({ ...this.snapshot, error: 'DSH returned an invalid OAuth message.' })
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
      this.update({
        ...this.snapshot,
        connection: 'reconnecting',
        error: 'The OAuth connection to DSH was interrupted.',
        ...attempt === undefined || attempt.phase === 'authorized' || attempt.phase === 'cancelled'
          ? {}
          : { attempt: { ...attempt, phase: 'failed', error: 'The OAuth connection to DSH was interrupted.' } },
      })
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
      this.update({ ...this.snapshot, error: 'The OAuth connection to DSH is not ready.' })
      return
    }
    this.socket.send(JSON.stringify(command))
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        const accounts = [...message.accounts]
        const reconciled = reconcileAttemptView(this.snapshot.attempt, accounts)
        const nextSnapshot = { ...this.snapshot, accounts }
        if (reconciled === undefined) delete nextSnapshot.attempt
        else nextSnapshot.attempt = reconciled
        this.update(nextSnapshot)
        return
      case 'started':
        const { error: _error, ...current } = this.snapshot
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
          this.update({ ...this.snapshot, attempt: { ...attempt, error: message.message } })
        } else {
          this.update({ ...this.snapshot, error: message.message })
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
