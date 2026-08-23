import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OAuthAccountsSection } from '../src/client/OAuthAccountsSection.tsx'
import { en } from '../src/client/locales.ts'
import type { OAuthAccountsSnapshot } from '../src/client/store.ts'

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
  it('renders connected and unavailable account states', () => {
    const html = render({
      connection: 'open',
      accounts: [
        {
          provider: 'openai-codex', label: 'OpenAI Codex', available: true,
          configured: true, writable: true, inFlight: false,
        },
        {
          provider: 'github-copilot', label: 'GitHub Copilot', available: false,
          configured: false, writable: true, inFlight: false,
        },
      ],
    })
    expect(html).toContain('OpenAI Codex')
    expect(html).toContain('Connected')
    expect(html).toContain('Sign out')
    expect(html).toContain('OAuth is unavailable')
  })

  it('renders device instructions and a masked prompt', () => {
    const html = render({
      connection: 'open',
      accounts: [{
        provider: 'openai-codex', label: 'OpenAI Codex', available: true,
        configured: false, writable: true, inFlight: true,
      }],
      attempt: {
        id: 'attempt', provider: 'openai-codex', phase: 'running',
        notice: { message: 'Open the page', url: 'https://example.test/login', code: 'ABCD' },
        prompt: { id: 'prompt', prompt: { kind: 'secret', message: 'Paste code' } },
      },
    })
    expect(html).toContain('https://example.test/login')
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
        configured: false, writable: true, inFlight: false,
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
        configured: false, writable: true, inFlight: true,
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
})
