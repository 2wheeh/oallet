import { Environment, Profile, type Wallet } from '@oallet/core'
import type { BrowserContext, TestInfo, TestType } from '@playwright/test'
import { expect, test, vi } from 'vitest'

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

test('creates a WalletConnect fixture lazily and disposes it after use', async () => {
  let fixtures: Record<string, unknown> = {}
  const base = {
    extend(value: unknown) {
      fixtures = value as Record<string, unknown>
      return this
    },
  } as unknown as TestType<{ context: BrowserContext }, Record<never, never>>
  const environment = testEnvironment()
  const dispose = vi.fn(async () => undefined)
  const createWalletConnect = vi.fn(async () => ({ dispose }))
  extend(base, {
    environment: () => environment,
    walletConnect: createWalletConnect,
  })
  expect(createWalletConnect).not.toHaveBeenCalled()

  const run = fixtures.walletConnect as (
    args: { oallet: typeof environment },
    use: (value: { dispose(): Promise<void> }) => Promise<void>,
    testInfo: TestInfo,
  ) => Promise<void>
  await run(
    { oallet: environment },
    async (walletConnect) => {
      expect(walletConnect.dispose).toBe(dispose)
    },
    {} as TestInfo,
  )

  expect(createWalletConnect).toHaveBeenCalledWith(
    { oallet: environment },
    expect.anything(),
  )
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('does not swallow an undefined failure from the test body', async () => {
  let fixtures: Record<string, unknown> = {}
  const base = {
    extend(value: unknown) {
      fixtures = value as Record<string, unknown>
      return this
    },
  } as unknown as TestType<{ context: BrowserContext }, Record<never, never>>
  const environment = testEnvironment()
  const dispose = vi.fn(async () => undefined)
  extend(base, {
    environment: () => environment,
    walletConnect: async () => ({ dispose }),
  })
  const run = fixtures.walletConnect as (
    args: { oallet: typeof environment },
    use: (value: { dispose(): Promise<void> }) => Promise<void>,
    testInfo: TestInfo,
  ) => Promise<void>

  await expect(
    run({ oallet: environment }, async () => Promise.reject(undefined), {} as TestInfo),
  ).rejects.toBeUndefined()
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('does not swallow an undefined failure from client disposal', async () => {
  let fixtures: Record<string, unknown> = {}
  const base = {
    extend(value: unknown) {
      fixtures = value as Record<string, unknown>
      return this
    },
  } as unknown as TestType<{ context: BrowserContext }, Record<never, never>>
  const environment = testEnvironment()
  const dispose = vi.fn(async () => Promise.reject(undefined))
  extend(base, {
    environment: () => environment,
    walletConnect: async () => ({ dispose }),
  })
  const run = fixtures.walletConnect as (
    args: { oallet: typeof environment },
    use: (value: { dispose(): Promise<void> }) => Promise<void>,
    testInfo: TestInfo,
  ) => Promise<void>

  await expect(
    run({ oallet: environment }, async () => undefined, {} as TestInfo),
  ).rejects.toBeUndefined()
  expect(dispose).toHaveBeenCalledTimes(1)
})

test('includes WalletConnect correlation and failure stage in text traces', async () => {
  let fixture: unknown
  const base = {
    extend(value: unknown) {
      fixture = (value as { oallet: unknown }).oallet
      return this
    },
  } as unknown as TestType<{ context: BrowserContext }, Record<never, never>>
  const environment = testEnvironment()
  environment[Environment.controller].traceWalletConnect({
    connectionId: 'connection-1',
    reason: 'timeout',
    stage: 'proposal',
    type: 'walletconnect.pairing.failed',
    walletId: 'wallet',
  })
  environment[Environment.controller].traceWalletConnect({
    chainId: 'eip155:1',
    connectionId: 'connection-1',
    method: 'personal_sign',
    outcome: 'error',
    rpcRequestId: 42,
    type: 'walletconnect.response.failed',
    walletId: 'wallet',
  })
  extend(base, { environment: () => environment })
  const [run] = fixture as readonly [
    (
      args: { context: BrowserContext },
      use: () => Promise<void>,
      testInfo: TestInfo,
    ) => Promise<void>,
  ]
  const attachments = new Map<string, string>()
  const testInfo = {
    attach(name: string, options: { body: string | Buffer }) {
      attachments.set(name, options.body.toString())
      return Promise.resolve()
    },
  } as unknown as TestInfo
  const context = { pages: () => [{}] } as unknown as BrowserContext

  await expect(run({ context }, async () => undefined, testInfo)).rejects.toBeInstanceOf(
    ExistingPageError,
  )
  expect(attachments.get('oallet-trace.txt')).toContain(
    'walletconnect.pairing.failed walletId=wallet connectionId=connection-1 stage=proposal reason=timeout',
  )
  expect(attachments.get('oallet-trace.txt')).toContain(
    'walletconnect.response.failed walletId=wallet connectionId=connection-1 method=personal_sign chainId=eip155:1 rpcRequestId=42 outcome=error',
  )
})

function testEnvironment() {
  const adapter: Wallet.Adapter = {
    dispose() {},
    prepare: () => ({ type: 'return', value: null }),
    profile: Profile.define({ data: {}, id: 'wallet', kind: 'test', name: 'Wallet' }),
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  return Environment.create({ wallets: [adapter] })
}
