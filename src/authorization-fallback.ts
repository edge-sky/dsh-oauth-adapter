/**
 * Best-effort authorization provider for DSH Web profiles that do not mount
 * the official service themselves.
 * @module @edge-sky/dsh-oauth-adapter/authorization-fallback
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'

/** Cordis plugin name. */
export const name = 'dsh-oauth-authorization-fallback'

/**
 * Reuse a Host-provided authorization service or mount the official fallback.
 *
 * The microtask yield lets earlier Profile Bundle rows publish their services
 * before this out-of-tree bundle decides whether a fallback is necessary.
 *
 * @param ctx - Loader context used to inspect and extend the Host service set.
 * @returns A promise that settles after the fallback has been mounted or skipped.
 */
export async function apply(ctx: Context): Promise<void> {
  await Promise.resolve()
  if (ctx.get('authorization') !== undefined) return
  await ctx.plugin(AuthorizationService as unknown as Plugin.Constructor<undefined>)
}
