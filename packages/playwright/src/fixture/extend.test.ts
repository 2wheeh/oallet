import { Environment, Profile, type Wallet } from '@oallet/core'
import type { BrowserContext, TestInfo, TestType } from '@playwright/test'
import { expect, test } from 'vitest'

import { ExistingPageError } from '../errors/errors.js'
import { extend } from './extend.js'

test('disposes the environment when browser attachment fails', async () => {
  let fixture: unknown
  const base = {
    extend(value: unknown) {
      fixture = (value as { oallet: unknown }).oallet
      return this
    },
  } as unknown as TestType<{ context: BrowserContext }, Record<never, never>>
  let disposed = false
  const adapter: Wallet.Adapter = {
    dispose() {
      disposed = true
    },
    prepare: () => ({ type: 'return', value: null }),
    profile: Profile.define({ data: {}, id: 'wallet', kind: 'test', name: 'Wallet' }),
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  extend(base, {
    environment: () => Environment.create({ wallets: [adapter] }),
  })
  const [run] = fixture as readonly [
    (
      args: { context: BrowserContext },
      use: () => Promise<void>,
      testInfo: TestInfo,
    ) => Promise<void>,
  ]
  const context = {
    pages: () => [{}],
  } as unknown as BrowserContext
  const testInfo = {
    attach: () => Promise.resolve(),
  } as unknown as TestInfo

  await expect(run({ context }, async () => undefined, testInfo)).rejects.toBeInstanceOf(
    ExistingPageError,
  )
  expect(disposed).toBe(true)
})
