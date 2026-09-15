import { defineLibrary } from '@oallet/config/tsdown'
import { build, defineConfig } from 'tsdown'

export default defineConfig(
  defineLibrary({
    // Keep the .js and .d.ts paths declared in package exports.
    fixedExtension: false,
    // Browser.attach reads the packaged runtime with node:fs/promises.
    platform: 'node',
    hooks: {
      'build:done': async () => {
        await build({ config: 'tsdown.browser.config.ts' })
      },
    },
  }),
)
