import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OAuthAccountsSection } from '../src/client/OAuthAccountsSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import {
  reconcileAttemptView, settleAttemptView, type OAuthAccountsSnapshot,
} from '../src/client/store.ts'

function render(snapshot: OAuthAccountsSnapshot): string {
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    begin: () => {},
    cancel: () => {},
    forget: () => {},
    respond: () => {},
    retry: () => {},
  }
  return renderToStaticMarkup(<OAuthAccountsSection controller={controller as never} t={key => en[key]} />)
}

describe('OAuth Accounts settings page', () => {
  it('keeps English and Chinese status presets aligned', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(zh.ready).toBe('已连接 · 模型可用')
    expect(zh.awaitingAction).toBe('需要完成操作以继续登录。')
  })

  it('renders connected and unavailable account states', () => {
    const html = render({
      connection: 'open',
      accounts: [
        {
          provider: 'openai-codex', label: 'OpenAI Codex', available: true,
          configured: true, modelsEnabled: true, writable: true, inFlight: false,
        },
        {
          provider: 'github-copilot', label: 'GitHub Copilot', available: false,
          configured: false, modelsEnabled: false, writable: true, inFlight: false,
        },
      ],
    })
    expect(html).toContain('OpenAI Codex')
    expect(html).toContain('Connected · Models ready')
    expect(html).toContain('Sign out')
    expect(html).toContain('OAuth is unavailable')
  })

  it('renders device instructions and a masked prompt', () => {
    const html = render({
      connection: 'open',
      accounts: [{
        provider: 'openai-codex', label: 'OpenAI Codex', available: true,
        configured: false, modelsEnabled: false, writable: true, inFlight: true,
      }],
      attempt: {
        id: 'attempt', provider: 'openai-codex', phase: 'running',
        notice: { message: 'Open the page', url: 'https://example.test/login', code: 'ABCD' },
        prompt: { id: 'prompt', prompt: { kind: 'secret', message: 'Paste code' } },
      },
    })
    expect(html).toContain('class="dsh-oauth-link"')
    expect(html).toContain('Open authorization page')
    expect(html).toContain('example.test')
    expect(html).not.toContain('>https://example.test/login<')
    expect(html).toContain('Action required to continue sign-in.')
    expect(html).toContain('ABCD')
    expect(html).toContain('type="password"')
  })

  it('renders reconnect, cancellation, and failure states', () => {
    const reconnecting = render({
      connection: 'reconnecting', accounts: [], error: 'Connection interrupted',
      attempt: {
        id: 'attempt', provider: 'github-copilot', phase: 'failed',
        error: 'Sign-in failed safely',
      },
    })
    expect(reconnecting).toContain('Retry connection')
    expect(reconnecting).toContain('Sign-in failed.')
    expect(reconnecting).toContain('Sign-in failed safely')

    const cancelled = render({
      connection: 'open',
      accounts: [{
        provider: 'github-copilot', label: 'GitHub Copilot', available: true,
        configured: false, modelsEnabled: false, writable: true, inFlight: false,
      }],
      attempt: { id: 'attempt', provider: 'github-copilot', phase: 'cancelled' },
    })
    expect(cancelled).toContain('Sign-in was cancelled.')
  })

  it('renders a select prompt and an active-flow cancel action', () => {
    const html = render({
      connection: 'open',
      accounts: [{
        provider: 'github-copilot', label: 'GitHub Copilot', available: true,
        configured: false, modelsEnabled: false, writable: true, inFlight: true,
      }],
      attempt: {
        id: 'attempt', provider: 'github-copilot', phase: 'running',
        prompt: {
          id: 'prompt',
          prompt: {
            kind: 'select', message: 'Choose an account',
            options: [
              { id: 'personal', label: 'Personal' },
              { id: 'business', label: 'Business', description: 'Organization account' },
            ],
          },
        },
      },
    })
    expect(html).toContain('<select')
    expect(html).toContain('Personal')
    expect(html).toContain('Business')
    expect(html).toContain('Cancel')
  })

  it('allows a blank GitHub domain and explains the github.com default', () => {
    const html = render({
      connection: 'open',
      accounts: [{
        provider: 'github-copilot', label: 'GitHub Copilot', available: true,
        configured: false, modelsEnabled: false, writable: true, inFlight: true,
      }],
      attempt: {
        id: 'attempt', provider: 'github-copilot', phase: 'running',
        prompt: {
          id: 'prompt',
          prompt: {
            kind: 'text', message: 'GitHub Enterprise URL/domain (blank for github.com)',
            placeholder: 'company.ghe.com', allowEmpty: true,
          },
        },
      },
    })
    expect(html).toContain('GitHub Enterprise domain')
    expect(html).toContain('Leave blank to use github.com.')
    const continueButton = html.match(/<button[^>]*>Continue<\/button>/u)?.[0]
    expect(continueButton).toBeDefined()
    expect(continueButton).not.toContain('disabled')
  })

  it('clears completed-flow details after the ready account snapshot arrives', () => {
    const settled = settleAttemptView({
      id: 'attempt', provider: 'github-copilot', phase: 'running',
      notice: { message: 'Enabling models...' },
      prompt: { id: 'prompt', prompt: { kind: 'text', message: 'Old prompt' } },
    }, 'authorized')
    expect(settled.notice).toBeUndefined()
    expect(settled.prompt).toBeUndefined()
    expect(reconcileAttemptView(settled, [{
      provider: 'github-copilot', label: 'GitHub Copilot', available: true,
      configured: true, modelsEnabled: true, writable: true, inFlight: false,
    }])).toBeUndefined()
  })

  it('distinguishes a stored account whose model route is unavailable', () => {
    const html = render({
      connection: 'open',
      accounts: [{
        provider: 'openai-codex', label: 'OpenAI Codex', available: true,
        configured: true, modelsEnabled: false, writable: true, inFlight: false,
      }],
    })
    expect(html).toContain('Connected · Model route unavailable')
    expect(html).toContain('data-state="warning"')
  })
})
