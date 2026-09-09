import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: { deps: { inline: [/dsh-client-ui-primitives/] } },
    include: ['tests/**/*.spec.{ts,tsx}'],
  },
})
