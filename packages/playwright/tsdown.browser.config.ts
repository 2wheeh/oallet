import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: false,
  copy: [
    { from: 'node_modules/mipd/LICENSE', rename: 'mipd.LICENSE' },
    { from: 'node_modules/uuid/LICENSE.md', rename: 'uuid.LICENSE.md' },
  ],
  deps: { alwaysBundle: ['mipd', 'uuid'], onlyBundle: ['mipd', 'uuid'] },
  dts: false,
  entry: { runtime: 'src/browser/runtime.ts' },
  failOnWarn: 'ci-only',
  format: 'iife',
  globalName: 'oalletRuntime',
  outDir: 'dist/browser',
  platform: 'browser',
  target: 'es2022',
})
