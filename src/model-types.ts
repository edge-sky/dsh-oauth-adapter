/** Model-management messages shared by the browser and Host. No credentials travel here. */
import type { ProviderId } from './protocol.js'

export const MODEL_PAGE_SIZE = 10
export const MODEL_PROTOCOLS = {
  'github-copilot': ['openai-completions', 'openai-responses', 'anthropic-messages'],
  openrouter: ['openai-completions', 'anthropic-messages'],
  'openai-codex': ['openai-codex-responses'],
  xai: ['openai-responses'],
  anthropic: ['anthropic-messages'],
  'kimi-coding': ['anthropic-messages'],
} as const
export type ModelProtocol = (typeof MODEL_PROTOCOLS)[ProviderId][number]
export interface ManualModel { id: string; name?: string; api?: ModelProtocol }
export interface DiscoveredModel { id: string; name?: string }
export interface ModelRow { id: string; name: string; source: 'catalog' | 'matched' | 'pending' | 'manual'; api?: string }
export interface ModelPage {
  provider: ProviderId
  revision: number
  offset: number
  manualOffset: number
  total: number
  rows: ModelRow[]
  source: 'catalog' | 'account'
  counts: { matched: number; pending: number; manual: number }
  connected: boolean
  writable: boolean
  managed: boolean
  busy: boolean
  syncedAt?: string
  error?: string
  errorCode?: string
  migration?: { fields: string[]; models: number }
}
export type ModelCommand =
  | { type: 'models-list'; requestId: string; provider: ProviderId; offset: number; manualOffset: number }
  | { type: 'models-sync' | 'models-migrate'; requestId: string; provider: ProviderId; revision: number }
  | { type: 'models-save'; requestId: string; provider: ProviderId; revision: number; model: ManualModel }
  | { type: 'models-delete'; requestId: string; provider: ProviderId; revision: number; id: string }
export type ModelMessage =
  | { type: 'models-page'; requestId: string; page: ModelPage }
  | { type: 'models-changed'; provider: ProviderId }
  | { type: 'models-error'; requestId: string; provider: ProviderId; code: string; message: string }

export function modelText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}
/** Validate at the wire and durable-data boundaries; fixed-protocol routes accept no override. */
export function validManual(provider: ProviderId, value: unknown): value is ManualModel {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const m = value as Record<string, unknown>
  if (Object.keys(m).some(k => !['id', 'name', 'api'].includes(k)) || !modelText(m.id)) return false
  if (m.name !== undefined && !modelText(m.name)) return false
  const choices: readonly string[] = MODEL_PROTOCOLS[provider]
  return choices.length === 1 ? m.api === undefined : typeof m.api === 'string' && choices.includes(m.api)
}
