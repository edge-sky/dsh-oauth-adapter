/** Browser half of the standalone DSH OAuth Accounts page. */

import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { OAuthModelsSection } from './OAuthModelsSection.js'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { OAuthAccountsSection } from './OAuthAccountsSection.js'
import type { OAuthAccountsInjected } from './OAuthAccountsSection.js'
import { en, zh, type OAuthLocaleKey } from './locales.js'
import { OAuthAccountsController } from './store.js'
import { styles } from './styles.js'

export { OAuthAccountsSection } from './OAuthAccountsSection.js'
export { OAuthAccountsController } from './store.js'
export type { OAuthAccountsSnapshot, AttemptView } from './store.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oauth-accounts': OAuthLocaleKey
  }
}

const NS = 'settings.oauth-accounts'
/** Required browser services for settings placement and localized copy. */
export const inject = ['slots', 'locale']

/** Register the OAuth account page and its app-lifetime connection controller. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-oauth-adapter: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@edge-sky/dsh-oauth-adapter'
    style.textContent = styles
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-oauth-adapter: styles')

  const controller = new OAuthAccountsController()
  ctx.effect(() => () => { controller.dispose() }, 'dsh-oauth-adapter: controller')
  const t = ctx.locale.bind(NS) as OAuthAccountsInjected['t']
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'oauth-models', order: 10,
    inject: () => ({ controller, t }),
  }, OAuthModelsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oauth-accounts',
    order: 15,
    label: () => t('nav'),
    inject: (): OAuthAccountsInjected => ({ controller, t }),
  }, OAuthAccountsSection))
}
