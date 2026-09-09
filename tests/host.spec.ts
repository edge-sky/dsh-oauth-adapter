import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { recordKeyFor } from '@deepseek-ai/dsh-llm-pi-ai'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptsBrowserUpgrade, apply, formatErrorDetail, isLoopbackAddress, safeNoticeUrl } from '../lib/index.js'
import { MAX_FRAME_BYTES, OAUTH_SOCKET_PATH, OAUTH_SOCKET_PROTOCOL, PROVIDERS } from '../lib/protocol.js'
import type { ServerMessage } from '../lib/protocol.js'

interface Harness {
  client: WebSocket
  messages: ServerMessage[]
  configured: Map<string, boolean>
  deleted: string[]
  modelProfiles: Map<string, Record<string, unknown>>
  aborts: { count: number }
  port: number
  connect(): Promise<{ client: WebSocket; messages: ServerMessage[] }>
  close(): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition did not settle')
}

async function connect(port: number): Promise<{ client: WebSocket; messages: ServerMessage[] }> {
  const client = new WebSocket(`ws://127.0.0.1:${port}${OAUTH_SOCKET_PATH}`, OAUTH_SOCKET_PROTOCOL, {
    origin: `http://127.0.0.1:${port}`,
  })
  const messages: ServerMessage[] = []
  client.on('message', data => { messages.push(JSON.parse(data.toString()) as ServerMessage) })
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => { resolve() })
    client.once('error', reject)
  })
  await waitFor(() => messages.find(message => message.type === 'snapshot'))
  return { client, messages }
}

async function harness(mode: 'prompt' | 'cancel' | 'withdraw' | 'github-domain' | 'failure' = 'prompt'): Promise<Harness> {
  const root = new Context()
  const configured = new Map<string, boolean>()
  const deleted: string[] = []
  const modelProfiles = new Map<string, Record<string, unknown>>()
  const managedProfiles = new Map<string, Record<string, unknown>>()
  let modelRevision = 0
  const routes = new Set<string>()
  const aborts = { count: 0 }
  const inFlight = new Set<string>()
  let upgrade: ((...args: any[]) => void) | undefined
  const listeners = new Map<string, Array<(...args: any[]) => void>>()
  const ctx = {
    logger: root.logger,
    authorization: {
      describe(key: string) {
        return {
          key, label: key.endsWith('openai-codex') ? 'OpenAI Codex' : 'GitHub Copilot',
          methods: [{ id: 'oauth', label: 'OAuth' }], inFlight: inFlight.has(key),
        }
      },
      async begin(request: any) {
        inFlight.add(request.key)
        try {
          request.interaction.notify({
            message: 'Continue in the browser', url: 'https://example.test/login', code: 'ABCD',
          })
          if (mode === 'failure') {
            const cause = new Error('429 Too Many Requests; Authorization: Bearer secret-token-value')
            Object.assign(cause, { code: 'COPILOT_RATE_LIMITED', status: 429 })
            throw new Error('GitHub Copilot login failed', { cause })
          }
          if (mode === 'cancel') {
            await new Promise<void>((resolve) => {
              request.signal.addEventListener('abort', () => { aborts.count += 1; resolve() }, { once: true })
            })
            return { status: 'cancelled' as const }
          }
          const promptController = new AbortController()
          const answerPromise = request.interaction.prompt(mode === 'github-domain'
            ? {
              kind: 'text', message: 'GitHub Enterprise URL/domain (blank for github.com)',
              placeholder: 'company.ghe.com', signal: promptController.signal,
            }
            : { kind: 'secret', message: 'Paste code', signal: promptController.signal })
          if (mode === 'withdraw') {
            promptController.abort()
            await expect(answerPromise).rejects.toThrow('withdrawn')
            return { status: 'cancelled' as const }
          }
          const answer = await answerPromise
          expect(answer).toBe(mode === 'github-domain' ? 'github.com' : 'private-answer')
          configured.set(request.key, true)
          for (const listener of listeners.get('credentials/record-updated') ?? []) listener(request.key)
          return { status: 'authorized' as const }
        } finally {
          inFlight.delete(request.key)
        }
      },
    },
    get() { return undefined },
    llm: {
      listProviders() { return [...routes].map(id => ({ id })) },
      registerAdapter(ids: string[]) {
        let current = ids; current.forEach(id => routes.add(id))
        const dispose = () => { current.forEach(id => routes.delete(id)) }
        return Object.assign(dispose, { replace(ids: string[]) { dispose(); current = ids; ids.forEach(id => routes.add(id)) } })
      },
    },
    credentials: {
      async readRecord(key: string) { return configured.get(key) ? { kind: 'grant', payload: { type: 'oauth', access: 'fake', refresh: 'fake', expires: Date.now() + 3600000 } } : undefined },
      async describeRecord(key: string) {
        return { configured: configured.get(key) === true, writable: true }
      },
      async deleteRecord(key: string) {
        deleted.push(key)
        configured.delete(key)
        for (const listener of listeners.get('credentials/record-updated') ?? []) listener(key)
      },
    },
    settings: {
      writable: true,
      register() { return { watch() { return () => {} } } },
      get(namespace: string) {
        if (namespace === 'oauth-models') return { version: 1, providers: Object.fromEntries(managedProfiles) }
        if (namespace !== 'llm-pi-ai') return undefined
        return { providers: Object.fromEntries(modelProfiles) }
      },
      describe() {
        return [{ ns: 'oauth-models', revision: modelRevision }, {
          ns: 'llm-pi-ai', schema: {}, value: { providers: Object.fromEntries(modelProfiles) },
          revision: 0, user: { providers: Object.fromEntries(modelProfiles) }, applies: 'live',
        }]
      },
      async mutate(namespace: string, ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) {
        if (namespace === 'oauth-models') {
          for (const op of ops) managedProfiles.set(op.path[1]!, op.value as Record<string, unknown>)
          modelRevision++
          return
        }
        expect(namespace).toBe('llm-pi-ai')
        for (const op of ops) {
          expect(op.path.slice(0, 1)).toEqual(['providers'])
          const provider = op.path[1]
          if (provider === undefined) throw new Error('missing provider')
          if (op.op === 'unset') modelProfiles.delete(provider)
          else modelProfiles.set(provider, op.value as Record<string, unknown>)
        }
      },
    },
    webServer: {
      registerUpgrade(route: { handler: (...args: any[]) => void }) {
        upgrade = route.handler
        return () => { upgrade = undefined }
      },
    },
    on(event: string, listener: (...args: any[]) => void) {
      const rows = listeners.get(event) ?? []
      rows.push(listener)
      listeners.set(event, rows)
      return () => { listeners.set(event, rows.filter(row => row !== listener)) }
    },
  }
  const disposePlugin = apply(ctx as never, {})
  const http = createServer((_request, response) => { response.writeHead(404); response.end() })
  http.on('upgrade', (request, socket, head) => { upgrade?.(request, socket, head) })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => { resolve() })
  })
  const port = (http.address() as AddressInfo).port
  const primary = await connect(port)

  const close = async (): Promise<void> => {
    primary.client.close()
    await new Promise<void>(resolve => http.close(() => { resolve() }))
    await disposePlugin()
    await root.fiber.dispose()
  }
  cleanups.push(close)
  return {
    ...primary, configured, deleted, modelProfiles, aborts, port,
    connect: () => connect(port),
    close,
  }
}

function send(client: WebSocket, value: object): void {
  client.send(JSON.stringify(value))
}

describe('OAuth Host surface', () => {
  it('projects every supported pi-ai OAuth provider', async () => {
    const test = await harness()
    const snapshot = test.messages.find(message => message.type === 'snapshot')
    if (snapshot?.type !== 'snapshot') throw new Error('missing snapshot')
    expect(snapshot.accounts.map(account => account.provider)).toEqual(PROVIDERS.map(provider => provider.id))
  })

  it('projects status, relays a secret prompt, settles, and signs out without echoing the answer', async () => {
    const test = await harness()
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'openai-codex' })
    const started = await waitFor(() => test.messages.find(message => message.type === 'started'))
    const prompt = await waitFor(() => test.messages.find(message => message.type === 'prompt'))
    expect(test.messages).toContainEqual(expect.objectContaining({ type: 'notice', code: 'ABCD' }))
    if (started.type !== 'started' || prompt.type !== 'prompt') throw new Error('unexpected messages')
    send(test.client, {
      type: 'respond', requestId: 'respond', attemptId: started.attemptId,
      promptId: prompt.promptId, value: 'private-answer',
    })
    await waitFor(() => test.messages.find(message => message.type === 'settled' && message.status === 'authorized'))
    expect(JSON.stringify(test.messages)).not.toContain('private-answer')
    expect(recordKeyFor('openai-codex')).toBe('llm-pi-ai/openai-codex')
    expect(test.configured.get(recordKeyFor('openai-codex'))).toBe(true)
    expect(test.modelProfiles.has('openai-codex')).toBe(false)
    expect(test.messages).toContainEqual(expect.objectContaining({
      type: 'snapshot',
      accounts: expect.arrayContaining([expect.objectContaining({
        provider: 'openai-codex', configured: true, modelsEnabled: true,
      })]),
    }))

    send(test.client, { type: 'forget', requestId: 'forget', provider: 'openai-codex' })
    await waitFor(() => test.deleted[0])
    expect(test.deleted).toEqual(['llm-pi-ai/openai-codex'])
    await waitFor(() => test.modelProfiles.has('openai-codex') ? undefined : true)
    expect(test.modelProfiles.has('openai-codex')).toBe(false)
  })

  it('cancels only the attempt owned by the requesting socket', async () => {
    const test = await harness('cancel')
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'github-copilot' })
    const started = await waitFor(() => test.messages.find(message => message.type === 'started'))
    if (started.type !== 'started') throw new Error('unexpected message')
    const second = await test.connect()
    send(second.client, { type: 'cancel', requestId: 'cross-cancel', attemptId: started.attemptId })
    await waitFor(() => second.messages.find(message => message.type === 'error' && message.code === 'invalid-attempt'))
    second.client.close()
    send(test.client, { type: 'cancel', requestId: 'cancel', attemptId: 'another-attempt' })
    await waitFor(() => test.messages.find(message => message.type === 'error' && message.code === 'invalid-attempt'))
    send(test.client, { type: 'cancel', requestId: 'cancel-own', attemptId: started.attemptId })
    await waitFor(() => test.messages.find(message => message.type === 'settled' && message.status === 'cancelled'))
  })

  it('turns a blank GitHub domain into the JSON-safe github.com default', async () => {
    const test = await harness('github-domain')
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'github-copilot' })
    const started = await waitFor(() => test.messages.find(message => message.type === 'started'))
    const prompt = await waitFor(() => test.messages.find(message => message.type === 'prompt'))
    if (started.type !== 'started' || prompt.type !== 'prompt') throw new Error('unexpected messages')
    expect(prompt.prompt).toEqual({
      kind: 'text', message: 'GitHub Enterprise URL/domain (blank for github.com)',
      placeholder: 'company.ghe.com', allowEmpty: true,
    })
    send(test.client, {
      type: 'respond', requestId: 'respond', attemptId: started.attemptId,
      promptId: prompt.promptId, value: '',
    })
    await waitFor(() => test.messages.find(message => message.type === 'settled' && message.status === 'authorized'))
    expect(test.configured.get(recordKeyFor('github-copilot'))).toBe(true)
  })

  it('preserves an existing user-configured OAuth route when signing out', async () => {
    const test = await harness()
    const profile = { displayName: 'Codex team route', modelOverrides: { 'gpt-5': { maxTokens: 8192 } } }
    test.modelProfiles.set('openai-codex', profile)
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'openai-codex' })
    const started = await waitFor(() => test.messages.find(message => message.type === 'started'))
    const prompt = await waitFor(() => test.messages.find(message => message.type === 'prompt'))
    if (started.type !== 'started' || prompt.type !== 'prompt') throw new Error('unexpected messages')
    send(test.client, {
      type: 'respond', requestId: 'respond', attemptId: started.attemptId,
      promptId: prompt.promptId, value: 'private-answer',
    })
    await waitFor(() => test.messages.find(message => message.type === 'settled' && message.status === 'authorized'))
    expect(test.modelProfiles.get('openai-codex')).toEqual(profile)

    send(test.client, { type: 'forget', requestId: 'forget', provider: 'openai-codex' })
    await waitFor(() => test.deleted[0])
    expect(test.modelProfiles.get('openai-codex')).toEqual(profile)
  })

  it('rejects duplicate starts, unknown prompts, and sign-out while a flow is active', async () => {
    const test = await harness('cancel')
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'openai-codex' })
    const started = await waitFor(() => test.messages.find(message => message.type === 'started'))
    if (started.type !== 'started') throw new Error('unexpected message')
    send(test.client, { type: 'begin', requestId: 'duplicate', provider: 'github-copilot' })
    send(test.client, {
      type: 'respond', requestId: 'expired-prompt', attemptId: started.attemptId,
      promptId: 'unknown', value: 'unused',
    })
    send(test.client, { type: 'forget', requestId: 'busy-forget', provider: 'openai-codex' })
    await waitFor(() => test.messages.find(message => message.type === 'error' && message.requestId === 'duplicate'))
    expect(test.messages).toContainEqual(expect.objectContaining({
      type: 'error', requestId: 'expired-prompt', code: 'invalid-prompt',
    }))
    expect(test.messages).toContainEqual(expect.objectContaining({
      type: 'error', requestId: 'busy-forget', code: 'busy',
    }))
    send(test.client, { type: 'cancel', requestId: 'cancel', attemptId: started.attemptId })
    await waitFor(() => test.aborts.count === 1 ? true : undefined)
  })

  it('withdraws an aborted prompt and aborts an attempt when its browser disconnects', async () => {
    const withdrawn = await harness('withdraw')
    send(withdrawn.client, { type: 'begin', requestId: 'begin', provider: 'openai-codex' })
    await waitFor(() => withdrawn.messages.find(message => message.type === 'prompt-withdrawn'))
    await waitFor(() => withdrawn.messages.find(message => message.type === 'settled' && message.status === 'cancelled'))

    const disconnected = await harness('cancel')
    send(disconnected.client, { type: 'begin', requestId: 'begin', provider: 'github-copilot' })
    await waitFor(() => disconnected.messages.find(message => message.type === 'started'))
    disconnected.client.close()
    await waitFor(() => disconnected.aborts.count === 1 ? true : undefined)
  })

  it('rejects unknown fields before dispatch', async () => {
    const test = await harness()
    send(test.client, { type: 'begin', requestId: 'invalid', provider: 'openai-codex', extra: true })
    await waitFor(() => test.messages.find(message => message.type === 'error' && message.code === 'invalid-message'))
    expect(test.messages.some(message => message.type === 'started')).toBe(false)
  })

  it('returns a bounded redacted provider error detail to the owning browser', async () => {
    const test = await harness('failure')
    send(test.client, { type: 'begin', requestId: 'begin', provider: 'github-copilot' })
    const failure = await waitFor(() => test.messages.find(message => message.type === 'error'))
    expect(failure).toMatchObject({
      type: 'error', code: 'sign-in-failed', message: 'sign-in failed',
    })
    if (failure.type !== 'error') throw new Error('unexpected message')
    expect(failure.detail).toContain('GitHub Copilot login failed')
    expect(failure.detail).toContain('429 Too Many Requests')
    expect(failure.detail).toContain('code: COPILOT_RATE_LIMITED, status: 429')
    expect(failure.detail).toContain('Authorization: [REDACTED]')
    expect(failure.detail).not.toContain('secret-token-value')
  })

  it('closes oversized frames and refuses an attacker Origin', async () => {
    const test = await harness()
    const closed = new Promise<number>(resolve => test.client.once('close', code => { resolve(code) }))
    test.client.send('x'.repeat(MAX_FRAME_BYTES + 1))
    await expect(closed).resolves.toBe(1009)

    const attacker = new WebSocket(
      `ws://127.0.0.1:${test.port}${OAUTH_SOCKET_PATH}`,
      OAUTH_SOCKET_PROTOCOL,
      { origin: 'https://attacker.example' },
    )
    const refused = new Promise<string>(resolve => attacker.once('error', error => { resolve(error.message) }))
    await expect(refused).resolves.toContain('403')
  })
})

describe('loopback handshake fence', () => {
  it('recognizes only loopback addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.2')).toBe(false)
  })

  it('requires matching Host, Origin, and subprotocol', () => {
    const request = {
      headers: {
        host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080',
        'sec-websocket-protocol': OAUTH_SOCKET_PROTOCOL,
      },
      socket: { remoteAddress: '127.0.0.1' },
    }
    expect(acceptsBrowserUpgrade(request as never)).toBe(true)
    expect(acceptsBrowserUpgrade({
      ...request, headers: { ...request.headers, origin: 'https://attacker.example' },
    } as never)).toBe(false)
  })

  it('forwards only HTTP navigation targets', () => {
    expect(safeNoticeUrl('https://example.test/login')).toBe('https://example.test/login')
    expect(safeNoticeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeNoticeUrl('not a URL')).toBeUndefined()
  })
})

describe('Host error diagnostics', () => {
  it('redacts credential forms and truncates oversized details', () => {
    const detail = formatErrorDetail(new Error(
      `access_token=oauth-secret api_key: sk-${'x'.repeat(32)} ${'z'.repeat(20_000)}`,
    ))
    expect(detail).toContain('access_token=[REDACTED]')
    expect(detail).toContain('api_key: [REDACTED]')
    expect(detail).not.toContain('oauth-secret')
    expect(detail).not.toContain(`sk-${'x'.repeat(32)}`)
    expect(detail).toContain('[diagnostic truncated]')
    expect(detail.length).toBeLessThan(13 * 1024)
  })
})
