/** Package-owned invariant companion for `dsh-oauth`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-oauth'

/** Cordis companion plugin name. */
export const name = 'dsh-oauth-invariant'
/** Service required before package ownership is registered. */
export const inject = ['invariants']

/** No runtime invariant: dsh-authorization asserts the registered-flow lifecycle. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
