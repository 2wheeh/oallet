import { defineLibrary } from '@oallet/config/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig([
  defineLibrary({
    name: 'library',
    // Keep the .js and .d.ts paths declared in package exports.
    fixedExtension: false,
    // Browser.attach reads the packaged runtime with node:fs/promises.
    platform: 'node',
  }),
  {
    name: 'browser',
    clean: false,
    dts: false,
    entry: { runtime: 'src/browser/runtime.ts' },
    failOnWarn: 'ci-only',
    format: 'iife',
    // Browser.attach calls this export inside its init-script wrapper.
    globalName: 'oalletRuntime',
    outDir: 'dist/browser',
    platform: 'browser',
    target: 'es2022',
  },
])
