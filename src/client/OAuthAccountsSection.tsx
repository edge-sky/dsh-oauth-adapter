/** OAuth account settings page. */

import { useState, useSyncExternalStore } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { PROVIDERS } from '../protocol.js'
import type { OAuthLocaleKey } from './locales.js'
import type { ActivePromptView, AttemptView, OAuthAccountsController } from './store.js'

export interface OAuthAccountsInjected {
  controller: OAuthAccountsController
  t: (key: OAuthLocaleKey) => string
}

export type OAuthAccountsSectionProps = Partial<InjectFace<OAuthAccountsInjected>>

function safeHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function AuthorizationLink(props: {
  url: string
  t: OAuthAccountsInjected['t']
}): JSX.Element {
  const host = new URL(props.url).host
  return (
    <a className="dsh-oauth-link" href={props.url} target="_blank" rel="noreferrer noopener">
      <span className="dsh-oauth-link-label">{props.t('openLink')}</span>
      <span className="dsh-oauth-link-host">{host}</span>
      <span className="dsh-oauth-link-icon" aria-label={props.t('externalLink')}>↗</span>
    </a>
  )
}

function PromptForm(props: {
  attemptId: string
  active: ActivePromptView
  controller: OAuthAccountsController
  t: OAuthAccountsInjected['t']
}): JSX.Element {
  const { prompt } = props.active
  const [value, setValue] = useState(prompt.kind === 'select' ? prompt.options[0]?.id ?? '' : '')
  const canSubmit = value.length > 0 || (prompt.kind === 'text' && prompt.allowEmpty === true)
  const submit = (): void => {
    if (!canSubmit) return
    props.controller.respond(props.attemptId, props.active.id, value)
    setValue('')
  }
  return (
    <div className="dsh-oauth-prompt">
      <span>{prompt.kind === 'text' && prompt.allowEmpty === true ? props.t('githubDomainPrompt') : prompt.message}</span>
      {prompt.kind === 'text' && prompt.allowEmpty === true && (
        <span className="dsh-oauth-muted">{props.t('githubDomainHint')}</span>
      )}
      {prompt.kind === 'select'
        ? (
          <select className="dsh-oauth-select" value={value} onChange={event => { setValue(event.target.value) }}>
            {prompt.options.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )
        : (
          <input
            className="dsh-oauth-input"
            type={prompt.kind === 'secret' ? 'password' : 'text'}
            value={value}
            placeholder={prompt.placeholder}
            autoComplete="off"
            onChange={event => { setValue(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') submit() }}
          />
        )}
      <button className="dsh-oauth-button" data-variant="primary" type="button" disabled={!canSubmit} onClick={submit}>
        {props.t('submit')}
      </button>
    </div>
  )
}

function ErrorPanel(props: {
  message: string
  detail?: string
  t: OAuthAccountsInjected['t']
}): JSX.Element {
  const collapsible = props.detail !== undefined && (props.detail.includes('\n') || props.detail.length > 240)
  return (
    <div className="dsh-oauth-error">
      <p>{props.message}</p>
      {props.detail !== undefined && (collapsible
        ? (
          <details className="dsh-oauth-error-details">
            <summary>{props.t('technicalDetails')}</summary>
            <pre>{props.detail}</pre>
          </details>
        )
        : <pre>{props.detail}</pre>)}
    </div>
  )
}

function AttemptPanel(props: {
  attempt: AttemptView
  controller: OAuthAccountsController
  t: OAuthAccountsInjected['t']
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const url = safeHttpUrl(props.attempt.notice?.url)
  const code = props.attempt.notice?.code
  const status = props.attempt.phase === 'authorized'
    ? props.t('authorized')
    : props.attempt.phase === 'cancelled'
      ? props.t('cancelled')
      : props.attempt.phase === 'failed'
        ? props.t('failed')
        : props.attempt.phase === 'starting'
          ? props.t('starting')
          : props.attempt.prompt !== undefined
            ? props.t('awaitingAction')
            : props.t('waitingProvider')
  return (
    <div className="dsh-oauth-flow">
      <span>{status}</span>
      {props.attempt.notice !== undefined && <span>{props.attempt.notice.message}</span>}
      {url !== undefined && <AuthorizationLink url={url} t={props.t} />}
      {code !== undefined && (
        <div className="dsh-oauth-code">
          <code>{code}</code>
          <button
            className="dsh-oauth-button"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => { setCopied(true) })
            }}
          >
            {copied ? props.t('copied') : props.t('copy')}
          </button>
        </div>
      )}
      {props.attempt.id !== undefined && props.attempt.prompt !== undefined && (
        <PromptForm
          key={props.attempt.prompt.id}
          attemptId={props.attempt.id}
          active={props.attempt.prompt}
          controller={props.controller}
          t={props.t}
        />
      )}
      {props.attempt.error !== undefined && (
        <ErrorPanel
          message={props.attempt.phase === 'authorized' ? props.t('loginSyncFailed') : props.attempt.error}
          {...props.attempt.errorDetail === undefined ? {} : { detail: props.attempt.errorDetail }}
          t={props.t}
        />
      )}
      {props.attempt.id !== undefined && (props.attempt.phase === 'running' || props.attempt.phase === 'starting') && (
        <button className="dsh-oauth-button" type="button" onClick={() => { props.controller.cancel(props.attempt.id!) }}>
          {props.t('cancel')}
        </button>
      )}
    </div>
  )
}

/** Render the standalone OAuth Accounts settings section. */
export function OAuthAccountsSection(props: OAuthAccountsSectionProps): JSX.Element | null {
  const controller = props.controller
  const t = props.t
  if (controller === undefined || t === undefined) return null
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const accountByProvider = new Map(snapshot.accounts.map(account => [account.provider, account]))
  return (
    <section className="dsh-oauth-section">
      <h2 className="dsh-oauth-title">{t('title')}</h2>
      <p className="dsh-oauth-intro">{t('intro')}</p>
      {snapshot.error !== undefined && (
        <ErrorPanel
          message={snapshot.error}
          {...snapshot.errorDetail === undefined ? {} : { detail: snapshot.errorDetail }}
          t={t}
        />
      )}
      {snapshot.connection !== 'open' && (
        <button className="dsh-oauth-button" data-variant="secondary" type="button" onClick={() => { controller.retry() }}>{t('retry')}</button>
      )}
      {snapshot.accounts.length === 0 && <p className="dsh-oauth-muted">{t('loading')}</p>}
      <ul className="dsh-oauth-list">
        {PROVIDERS.map(({ id: provider }) => {
          const account = accountByProvider.get(provider)
          const attempt = snapshot.attempt?.provider === provider ? snapshot.attempt : undefined
          const busy = account?.inFlight === true || attempt?.phase === 'running' || attempt?.phase === 'starting'
          const state = busy
            ? 'authorizing'
            : account?.configured === true
              ? account.modelsEnabled ? 'ready' : 'warning'
              : 'disconnected'
          const stateText = busy
            ? t('authorizing')
            : account?.configured === true
              ? account.modelsEnabled ? t('ready') : t('connectedNoModels')
              : t('disconnected')
          return (
            <li className="dsh-oauth-card" key={provider}>
              <div className="dsh-oauth-head">
                <span className="dsh-oauth-name">{account?.label ?? provider}</span>
                <span className="dsh-oauth-state" data-state={state}>
                  <span className="dsh-oauth-dot" />
                  {stateText}
                </span>
                <div className="dsh-oauth-actions">
                  <button
                    className="dsh-oauth-button"
                    data-variant="primary"
                    type="button"
                    disabled={snapshot.connection !== 'open' || busy || account?.available !== true}
                    onClick={() => { controller.begin(provider) }}
                  >
                    {account?.configured === true ? t('reconnect') : t('connect')}
                  </button>
                  {account?.configured === true && (
                    <button
                      className="dsh-oauth-button"
                      data-variant="danger"
                      type="button"
                      disabled={snapshot.connection !== 'open' || busy || account.writable !== true}
                      onClick={() => { controller.forget(provider) }}
                    >
                      {t('forget')}
                    </button>
                  )}
                </div>
              </div>
              {account !== undefined && !account.available && <p className="dsh-oauth-muted">{t('unavailable')}</p>}
              {attempt !== undefined && <AttemptPanel attempt={attempt} controller={controller} t={t} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
