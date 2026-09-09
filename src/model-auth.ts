/** Bridge public pi-ai authentication to DSH's existing credential records. */
import { createHash } from 'node:crypto'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { recordKeyFor } from '@deepseek-ai/dsh-llm-pi-ai'
import { ModelOperationError } from './model-discovery.js'

export function fromRecord(record: CredentialRecord | undefined): Credential | undefined {
  if (!record) return undefined
  if (record.kind === 'api-key') return { type: 'api_key', ...(record.key === undefined ? {} : { key: record.key }), ...(record.env === undefined ? {} : { env: record.env }) }
  const value = record.payload
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('type' in value) || value.type !== 'oauth') throw new ModelOperationError('credential-format', 'The stored OAuth credential is not supported; reconnect this account.')
  return value as unknown as Credential
}
function toRecord(value: Credential): CredentialRecord {
  if (value.type === 'api_key') return { kind: 'api-key', ...(value.key === undefined ? {} : { key: value.key }), ...(value.env === undefined ? {} : { env: value.env }) }
  // pi-ai includes undefined optional properties; the durable record is JSON.
  return { kind: 'grant', payload: JSON.parse(JSON.stringify(value)) }
}
/** Every refresh checks its cancellation generation while holding the credential writer lock. */
export function credentialBridge(credentials: CredentialProvider, check: (provider: string) => void): CredentialStore {
  return {
    async read(provider) { check(provider); return fromRecord(await credentials.readRecord(recordKeyFor(provider))) },
    async list() { return [] },
    async modify(provider, mutate) {
      check(provider)
      return fromRecord(await credentials.modifyRecord(recordKeyFor(provider), async current => {
        check(provider)
        if (!current) throw new ModelOperationError('not-connected', 'This account was disconnected.')
        const next = await mutate(fromRecord(current))
        check(provider)
        return next === undefined ? undefined : toRecord(next)
      }))
    },
    async delete(provider) { check(provider); await credentials.deleteRecord(recordKeyFor(provider)) },
  }
}
/** Only provider-authored stable account identifiers are persisted, as a one-way hash. */
export function accountIdentity(provider: string, credential: Credential | undefined): string | undefined {
  if (credential?.type !== 'oauth') return undefined
  const value = credential as unknown as Record<string, unknown>
  const id = value.accountId ?? value.userId ?? value.email
  return typeof id === 'string' && id.length > 0 ? createHash('sha256').update(`${provider}:${id}`).digest('hex') : undefined
}
