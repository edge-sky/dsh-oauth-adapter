import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('DSH Bundle', () => {
  it('loads the built host entry points against the declared DSH dependencies', async () => {
    for (const entry of ['index', 'authorization-fallback', 'invariant']) {
      const module = await import(new URL(`../lib/${entry}.js`, import.meta.url).href)
      expect(module).toBeDefined()
    }
  })

  it('publishes the declared profile patch', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string; inject?: string[] } }
      exports?: Record<string, unknown>
      files?: string[]
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client).toMatchObject({ platform: 'web' })
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./authorization-fallback')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')).toBe(
      "- insert:\n"
      + "    - id: dsh-oauth-authorization\n"
      + "      name: '@edge-sky/dsh-oauth-adapter/authorization-fallback'\n\n"
      + "    - id: dsh-oauth-adapter\n"
      + "      name: '@edge-sky/dsh-oauth-adapter'\n",
    )
  })

  it('uses bounded DSH peers and requires the authorization implementation', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    const peers = manifest.peerDependencies ?? {}
    for (const [name, range] of Object.entries(peers)) {
      if (name.startsWith('@deepseek-ai/dsh-')) {
        expect(range, name).toBe('>=0.1.5-rc.2 <0.1.6-0')
      }
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-authorization']).toBeUndefined()
    expect(manifest.devDependencies?.['@deepseek-ai/dsh-authorization']).toBe('0.1.5-rc.2')
    expect(manifest.peerDependenciesMeta?.['@deepseek-ai/dsh-authorization']).toBeUndefined()
  })

  it('builds both Host and browser artifacts without the removed compatibility bridge', () => {
    expect(readFileSync(resolve(root, 'lib/protocol.js'), 'utf8')).toContain(OAUTH_ROUTE_MARKER)
    expect(readFileSync(resolve(root, 'lib/authorization-fallback.js'), 'utf8')).toContain('AuthorizationService')
    expect(readFileSync(resolve(root, 'lib/client.js'), 'utf8')).toContain('__ModuleLoader__.load')
    expect(() => readFileSync(resolve(root, 'lib/compat.js'), 'utf8')).toThrow()
  })
})

const OAUTH_ROUTE_MARKER = '/_edge-sky/dsh-oauth'
