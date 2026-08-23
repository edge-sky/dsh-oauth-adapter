import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../lib/index.js'
import * as Invariant from '../lib/invariant.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OAuth flow contribution', () => {
  it('registers provider-owned Codex and Copilot flows without deployment credentials', async () => {
    const flows: Array<{
      key: string
      label: string
      subject?: unknown
      methods: readonly { id: string; label: string }[]
    }> = []
    const ctx = {
      get: () => undefined,
      authorization: { registerFlow: (flow: typeof flows[number]) => { flows.push(flow) } },
    }

    await apply(ctx as never, {})

    expect(flows.map(flow => ({
      key: flow.key,
      label: flow.label,
      subject: flow.subject,
      methods: flow.methods.map(method => method.id),
    }))).toEqual([
      {
        key: 'llm-pi-ai/openai-codex',
        label: 'OpenAI Codex',
        subject: { kind: 'llm-provider', provider: 'openai-codex' },
        methods: ['oauth'],
      },
      {
        key: 'llm-pi-ai/github-copilot',
        label: 'GitHub Copilot',
        subject: { kind: 'llm-provider', provider: 'github-copilot' },
        methods: ['oauth'],
      },
    ])
  })

  it('prints only the opt-in redacted diagnostics banner', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const root = new Context()
    const ctx = {
      get: () => undefined,
      logger: root.logger,
      authorization: { registerFlow: () => {} },
    }

    await apply(ctx as never, { debug: true })

    expect(write).toHaveBeenCalledWith(
      '[D] dsh-oauth-adapter diagnostics enabled; secret values and provider payloads are redacted\n',
    )
    expect(write.mock.calls.flat().join('')).not.toContain('client')
    await root.fiber.dispose()
  })

  it('registers its package-owned invariant companion', async () => {
    const disposer = (): void => {}
    const register = vi.fn((_packageName: string, install: () => void) => {
      install()
      return disposer
    })

    await expect(Invariant.apply({ invariants: { register } } as never)).resolves.toBe(disposer)
    expect(register).toHaveBeenCalledWith('@edge-sky/dsh-oauth-adapter', expect.any(Function))
  })
})
