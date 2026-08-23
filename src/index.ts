/**
 * OAuth authorization-flow contributions for DSH LLM providers.
 *
 * The plugin owns only the human authorization interaction. Provider request
 * protocols, token refresh, model conversion, tools, and streaming stay with
 * the adapter family whose credential record the flow writes.
 * @module dsh-oauth
 */

import { Logger, LoggerLevel } from '@deepseek-ai/cordis'
import type { Context, Exporter } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSubjectMap } from '@deepseek-ai/dsh-authorization/types'
import {
  authContextFrom, credentialStoreFrom, piAiOAuthFlow,
} from '@deepseek-ai/dsh-llm-pi-ai'

declare module '@deepseek-ai/dsh-authorization/types' {
  interface AuthorizationSubjectMap {
    /** OAuth flow joined to one DSH LLM provider route. */
    'llm-provider': { kind: 'llm-provider'; provider: string }
  }
}

/** Plugin configuration. */
export interface Config {
  /** Emit redacted OAuth lifecycle diagnostics to stderr at debug level. */
  debug?: boolean
}

/** Runtime-validated plugin configuration. */
export const Config: z<Config> = z.object({
  debug: z.boolean().default(false),
})

/** Cordis plugin name. */
export const name = 'dsh-oauth'
/** Required authorization registry. */
export const inject = ['authorization']

type OAuthContext = Context & { authorization: AuthorizationService }

/** Install the opt-in debug logger and return its secret-free message sink. */
function debugSink(ctx: OAuthContext, enabled: boolean): ((message: string) => void) | undefined {
  if (!enabled) return undefined
  const loggerName = 'dsh-oauth'
  const exporter: Exporter = {
    colors: false,
    levels: { default: -1, [loggerName]: LoggerLevel.DEBUG },
    export: message => void process.stderr.write(
      `[D] ${message.name} ${Logger.format(exporter, message)}\n`,
    ),
  }
  ctx.logger.exporter(exporter)
  const logger = ctx.logger(loggerName)
  return (message) => { logger.debug('%s', message) }
}

/** Register Codex and Copilot OAuth flows. */
export function apply(ctx: OAuthContext, config: Config): void {
  const debug = debugSink(ctx, config.debug === true)
  debug?.('diagnostics enabled; secret values and provider payloads are redacted')
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const diagnosticOptions = debug === undefined ? {} : { debug }
  const register = (provider: string, flow: ReturnType<typeof piAiOAuthFlow>): void => {
    const subject: AuthorizationSubjectMap['llm-provider'] = { kind: 'llm-provider', provider }
    ctx.authorization.registerFlow({ ...flow, subject })
  }
  register('openai-codex', piAiOAuthFlow('openai-codex', auth, diagnosticOptions))
  register('github-copilot', piAiOAuthFlow('github-copilot', auth, diagnosticOptions))
}
