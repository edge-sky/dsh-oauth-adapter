import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../lib/authorization-fallback.js'

const roots: Context[] = []

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await root.fiber.dispose()
})

describe('authorization fallback', () => {
  it('mounts the official service when the Host does not provide one', async () => {
    const root = new Context()
    roots.push(root)
    await root.plugin({
      name: 'test-credentials',
      apply(ctx: Context) { ctx.provide('credentials', {} as never) },
    })

    await apply(root)

    expect(root.get('authorization')).toBeInstanceOf(AuthorizationService)
  })

  it('reuses a service that an earlier Host row already provided', async () => {
    const root = new Context()
    roots.push(root)
    const provided = {} as AuthorizationService
    await root.plugin({
      name: 'test-host-authorization',
      apply(ctx: Context) { ctx.provide('authorization', provided) },
    })

    await apply(root)

    expect(root.get('authorization')).toBe(provided)
  })
})
