import type { UserConfig } from 'tsdown'

export function defineLibrary(options: UserConfig = {}): UserConfig {
  return {
    clean: true,
    dts: true,
    entry: ['src/index.ts'],
    failOnWarn: 'ci-only',
    format: ['esm'],
    platform: 'neutral',
    sourcemap: true,
    target: 'es2022',
    unbundle: true,
    ...options,
  }
}
