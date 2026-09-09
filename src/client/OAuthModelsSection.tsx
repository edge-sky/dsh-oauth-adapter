/** OAuth-specific model management mounted inside the existing Models settings page. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { MODEL_PROTOCOLS, MODEL_PAGE_SIZE, validManual, type ManualModel, type ModelPage } from '../model-types.js'
import { PROVIDERS, type ProviderId } from '../protocol.js'
import type { OAuthAccountsController } from './store.js'
import type { OAuthLocaleKey } from './locales.js'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

export interface OAuthModelsInjected { controller: OAuthAccountsController; t: (key: OAuthLocaleKey) => string }
type Props = InjectFace<OAuthModelsInjected>

function ModelForm({ provider, initial, busy, t, save, close }: {
  provider: ProviderId; initial?: ManualModel; busy: boolean; t: OAuthModelsInjected['t']; save: (model: ManualModel) => void; close: () => void
}): JSX.Element {
  const [id, setId] = useState(initial?.id ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const choices: readonly string[] = MODEL_PROTOCOLS[provider]
  const [api, setApi] = useState(initial?.api ?? choices[0]!)
  const model = { id: id.trim(), ...(name.trim() ? { name: name.trim() } : {}), ...(choices.length > 1 ? { api } : {}) }
  return <form className="dsh-oauth-model-form" onSubmit={event => { event.preventDefault(); if (validManual(provider, model)) save(model) }}>
    <label>{t('modelId')}<input required maxLength={256} value={id} readOnly={initial !== undefined} onChange={event => setId(event.target.value)} /></label>
    <label>{t('modelName')}<input maxLength={256} value={name} onChange={event => setName(event.target.value)} placeholder={id} /></label>
    {choices.length > 1 && <label>{t('modelProtocol')}<select value={api} onChange={event => setApi(event.target.value as typeof api)}>
      {choices.map(choice => <option key={choice} value={choice}>{choice === 'openai-completions' ? 'Chat Completions' : choice === 'openai-responses' ? 'Responses' : choice === 'openai-codex-responses' ? 'Codex Responses' : 'Anthropic Messages'}</option>)}
    </select></label>}
    <p className="dsh-oauth-muted">{t('manualModelHint')}</p>
    <button type="submit" disabled={busy || !validManual(provider, model)}>{t('saveModel')}</button>
    <button type="button" disabled={busy} onClick={close}>{t('cancel')}</button>
  </form>
}
function ProviderModels({ page, controller, busy, error, t }: { page: ModelPage; controller: OAuthAccountsController; busy: boolean; error?: { code: string; message: string }; t: OAuthModelsInjected['t'] }): JSX.Element {
  const [editing, setEditing] = useState<ManualModel | null | undefined>()
  const [submitted, setSubmitted] = useState(false)
  const [confirmMigration, setConfirmMigration] = useState(false)
  useEffect(() => { if (submitted && !busy) { if (!error) setEditing(undefined); setSubmitted(false) } }, [busy, error, submitted])
  const errorCode = error?.code ?? page.errorCode
  const errorLabel = errorCode === 'settings-conflict' ? 'modelConflict' : errorCode === 'discovery-unsupported' ? 'modelUnsupported' : errorCode === 'discovery-auth' ? 'modelAuthFailed' : errorCode === 'discovery-timeout' ? 'modelTimedOut' : errorCode === 'route-conflict' ? 'modelRouteConflict' : 'modelOperationFailed'
  const disabled = busy || !page.connected || !page.writable
  return <article className="dsh-oauth-model-provider">
    <h3>{PROVIDERS.find(p => p.id === page.provider)?.modelGroupLabel}</h3>
    <p>{page.connected ? t('modelConnected') : t('disconnected')} · {page.source === 'account' ? t('accountCatalog') : t('builtinCatalog')}</p>
    {page.syncedAt && <p>{t('lastModelSync')}: <time dateTime={page.syncedAt}>{new Date(page.syncedAt).toLocaleString()}</time></p>}
    <p>{t('matchedModels')}: {page.counts.matched} · {t('pendingModels')}: {page.counts.pending} · {t('manualModels')}: {page.counts.manual}</p>
    {(error || page.error) && <div role="alert"><p>{t(errorLabel)}</p>
      <details><summary>{t('technicalDetails')}</summary>{error?.message ?? page.error}</details></div>}
    {page.migration ? <>
      <button disabled={disabled} onClick={() => setConfirmMigration(!confirmMigration)}>{t('reviewMigration')}</button>
      {confirmMigration && <div><p>{t('migrationDescription')}</p><p>{page.migration.fields.join(', ')} · {page.migration.models} {t('modelsTitle')}</p>
        <button disabled={disabled} onClick={() => controller.migrateModels(page.provider)}>{t('confirmMigration')}</button></div>}
    </> : <>
      <button disabled={disabled || !page.managed} onClick={() => controller.syncModels(page.provider)}>{busy ? t('modelWorking') : t('syncModels')}</button>
      <button disabled={disabled || !page.managed} onClick={() => setEditing(null)}>{t('addModel')}</button>
    </>}
    {editing !== undefined && <ModelForm key={editing?.id ?? 'new'} provider={page.provider} {...(editing === null ? {} : { initial: editing })} busy={busy} t={t}
      save={model => { setSubmitted(true); controller.saveModel(page.provider, model) }} close={() => setEditing(undefined)} />}
    {(['matched', 'pending', 'manual'] as const).map(source => {
      const rows = page.rows.filter(row => (row.source === 'catalog' ? 'matched' : row.source) === source)
      if (!rows.length) return null
      return <section key={source} aria-label={t(source === 'pending' ? 'pendingModels' : source === 'manual' ? 'manualModels' : 'matchedModels')}>
        <h4>{t(source === 'pending' ? 'pendingModels' : source === 'manual' ? 'manualModels' : 'matchedModels')}</h4>
        <ul className="dsh-oauth-model-list">{rows.map(row => <li key={row.id}>
      <div><strong>{row.name}</strong> <code>{row.id}</code> <span>{t(row.source === 'pending' ? 'pendingModels' : row.source === 'manual' ? 'manualModels' : 'matchedModels')}</span></div>
      {row.source === 'pending' && <button disabled={disabled || !page.managed} onClick={() => setEditing({ id: row.id, name: row.name })}>{t('configureModel')}</button>}
      {row.source === 'manual' && <><button disabled={disabled} onClick={() => setEditing({ id: row.id, name: row.name, ...(MODEL_PROTOCOLS[page.provider].length > 1 ? { api: row.api as ManualModel['api'] } : {}) } as ManualModel)}>{t('editModel')}</button>
        <button disabled={disabled} onClick={() => controller.deleteModel(page.provider, row.id)}>{t('deleteModel')}</button></>}
    </li>)}</ul></section>
    })}
    {page.total === 0 && <p>{t('noModels')}</p>}
    {page.total > MODEL_PAGE_SIZE && <nav aria-label={t('modelsPagination')}>
      <button disabled={page.offset === 0 || busy} onClick={() => controller.readModels(page.provider, Math.max(0, page.offset - MODEL_PAGE_SIZE))}>{t('previousModels')}</button>
      <span>{page.offset + 1}–{Math.min(page.offset + MODEL_PAGE_SIZE, page.total)} / {page.total}</span>
      <button disabled={page.offset + MODEL_PAGE_SIZE >= page.total || busy} onClick={() => controller.readModels(page.provider, page.offset + MODEL_PAGE_SIZE)}>{t('nextModels')}</button>
    </nav>}
  </article>
}

export function OAuthModelsSection(props: Props): JSX.Element | null {
  const { controller, t } = props
  if (!controller || !t) return null
  return <OAuthModels controller={controller} t={t} />
}
function OAuthModels({ controller, t }: OAuthModelsInjected): JSX.Element {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { controller.loadModels() }, [controller])
  return <section className="dsh-oauth-section"><h2>{t('modelsTitle')}</h2><p>{t('modelsIntro')}</p>
    {snapshot.connection !== 'open' && <p role="status">{t('hostDisconnected')}</p>}
    {PROVIDERS.map(provider => {
      const page = snapshot.modelPages?.[provider.id]
      if (!page) return null
      if (!page.connected && !page.managed && page.counts.manual === 0) return null
      const error = snapshot.modelErrors?.[provider.id]
      return <ProviderModels key={provider.id} page={page} controller={controller} t={t} busy={snapshot.connection !== 'open' || snapshot.modelBusy?.[provider.id] === true || page.busy} {...(error ? { error } : {})} />
    })}
  </section>
}
