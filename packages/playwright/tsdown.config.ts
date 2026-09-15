import { defineLibrary } from '@oallet/config/tsdown'
import { build, defineConfig } from 'tsdown'

export default defineConfig(
  defineLibrary({
    fixedExtension: false,
    platform: 'node',
    hooks: {
      'build:done': async () => {
        await build({ config: 'tsdown.browser.config.ts' })
      },
    },
  }),
)
