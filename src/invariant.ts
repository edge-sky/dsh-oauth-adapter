/** Package-owned invariant companion for `@edge-sky/dsh-oauth-adapter`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@edge-sky/dsh-oauth-adapter'

/** Cordis companion plugin name. */
export const name = 'dsh-oauth-adapter-invariant'
/** Service required before package ownership is registered. */
export const inject = ['invariants']

/** No runtime invariant: the Host owns and tears down every socket and attempt directly. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
