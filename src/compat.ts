/** Runtime compatibility checks for the DSH-provided pi-ai OAuth bridge. */

type PiAiModule = typeof import('@deepseek-ai/dsh-llm-pi-ai')

/** The pi-ai exports this plugin consumes from the active DSH installation. */
export type PiAiOAuthBridge = Pick<
  PiAiModule,
  'authContextFrom' | 'credentialStoreFrom' | 'piAiOAuthFlow' | 'piAiOAuthProviderIds'
>

const BRIDGE_PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'
const PACKAGE_NAME = '@edge-sky/dsh-oauth-adapter'
const REQUIRED_EXPORTS = [
  'authContextFrom',
  'credentialStoreFrom',
  'piAiOAuthFlow',
  'piAiOAuthProviderIds',
] as const
const REQUIRED_PROVIDERS = ['openai-codex', 'github-copilot'] as const

/** Whether a dynamically loaded module exposes a callable property. */
function hasFunction(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>)[key] === 'function'
}

/**
 * Validate the bridge exported by the active DSH installation.
 * @param candidate - dynamically imported module namespace.
 * @returns the compatible OAuth bridge.
 */
export function resolvePiAiOAuthBridge(candidate: unknown): PiAiOAuthBridge {
  const missing = REQUIRED_EXPORTS.filter(key => !hasFunction(candidate, key))
  if (missing.length > 0) {
    throw new Error(
      `${PACKAGE_NAME}: incompatible DSH installation: ${BRIDGE_PACKAGE} does not provide `
      + `${missing.join(', ')}; install a DSH version with the pi-ai OAuth bridge`,
    )
  }
  const bridge = candidate as PiAiOAuthBridge
  let providers: unknown
  try {
    providers = bridge.piAiOAuthProviderIds()
  } catch (cause) {
    throw new Error(
      `${PACKAGE_NAME}: incompatible DSH installation: ${BRIDGE_PACKAGE} cannot enumerate OAuth providers`,
      { cause },
    )
  }
  if (!Array.isArray(providers) || !providers.every(provider => typeof provider === 'string')) {
    throw new Error(
      `${PACKAGE_NAME}: incompatible DSH installation: ${BRIDGE_PACKAGE} returned an invalid OAuth provider directory`,
    )
  }
  const absentProviders = REQUIRED_PROVIDERS.filter(provider => !providers.includes(provider))
  if (absentProviders.length > 0) {
    throw new Error(
      `${PACKAGE_NAME}: incompatible DSH installation: ${BRIDGE_PACKAGE} does not support OAuth provider(s) `
      + `${absentProviders.join(', ')}`,
    )
  }
  return bridge
}

/**
 * Load the OAuth bridge through DSH's profile module fallback.
 * @returns the validated bridge supplied by the active DSH installation.
 */
export async function loadPiAiOAuthBridge(): Promise<PiAiOAuthBridge> {
  let candidate: unknown
  try {
    candidate = await import(BRIDGE_PACKAGE)
  } catch (cause) {
    throw new Error(
      `${PACKAGE_NAME}: incompatible DSH installation: cannot load ${BRIDGE_PACKAGE}; `
      + 'install a DSH version with the pi-ai OAuth bridge',
      { cause },
    )
  }
  return resolvePiAiOAuthBridge(candidate)
}
