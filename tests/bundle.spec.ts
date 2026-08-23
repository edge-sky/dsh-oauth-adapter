import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('DSH Bundle', () => {
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

  it('permits newer compatible DSH runtimes without an upper version bound', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const peers = manifest.peerDependencies ?? {}
    for (const [name, range] of Object.entries(peers)) {
      expect(range, name).not.toMatch(/[<~^]/)
      expect(range, name).toMatch(/^>=/)
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-authorization']).toBe('>=0.1.1-rc.2')
  })

  it('builds both Host and browser artifacts without the removed compatibility bridge', () => {
    expect(readFileSync(resolve(root, 'lib/protocol.js'), 'utf8')).toContain(OAUTH_ROUTE_MARKER)
    expect(readFileSync(resolve(root, 'lib/authorization-fallback.js'), 'utf8')).toContain('AuthorizationService')
    expect(readFileSync(resolve(root, 'lib/client.js'), 'utf8')).toContain('__ModuleLoader__.load')
    expect(() => readFileSync(resolve(root, 'lib/compat.js'), 'utf8')).toThrow()
  })
})

const OAUTH_ROUTE_MARKER = '/_edge-sky/dsh-oauth'
