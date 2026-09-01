import type { Environment } from '@oallet/core'
import type { BrowserContext, Fixtures, TestInfo, TestType } from '@playwright/test'

import { attach } from '../browser/attach.js'

type FixtureEnvironment = attach.Options['environment'] &
  Pick<Environment.Instance, 'dispose' | 'trace'>

export type Value<
  EnvironmentType extends FixtureEnvironment = FixtureEnvironment,
  WalletConnectType extends extend.ManagedWalletConnect = never,
> = { readonly oallet: EnvironmentType } & ([WalletConnectType] extends [never]
  ? object
  : { readonly walletConnect: WalletConnectType })

export function extend<
  TestArgs extends { context: BrowserContext },
  WorkerArgs extends object,
  EnvironmentType extends FixtureEnvironment,
  WalletConnectType extends extend.ManagedWalletConnect,
>(
  base: TestType<TestArgs, WorkerArgs>,
  options: extend.WalletConnectOptions<EnvironmentType, WalletConnectType>,
): TestType<TestArgs & Value<EnvironmentType, WalletConnectType>, WorkerArgs>

export function extend<
  TestArgs extends { context: BrowserContext },
  WorkerArgs extends object,
  EnvironmentType extends FixtureEnvironment,
>(
  base: TestType<TestArgs, WorkerArgs>,
  options: extend.Options<EnvironmentType>,
): TestType<TestArgs & Value<EnvironmentType>, WorkerArgs>

export function extend<
  TestArgs extends { context: BrowserContext },
  WorkerArgs extends object,
  EnvironmentType extends FixtureEnvironment,
  WalletConnectType extends extend.ManagedWalletConnect,
>(
  base: TestType<TestArgs, WorkerArgs>,
  options: extend.Options<EnvironmentType> &
    Partial<extend.WalletConnectOptions<EnvironmentType, WalletConnectType>>,
) {
  const fixture = async (
    { context }: TestArgs & WorkerArgs,
    use: (environment: EnvironmentType) => Promise<void>,
    testInfo: TestInfo,
  ) => {
    const environment = await options.environment(testInfo)
    let browser: attach.ReturnType
    try {
      browser = await attach({ context, environment })
    } catch (error) {
      const cleanupErrors: unknown[] = []
      try {
        await environment.dispose()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      await attachFailureArtifacts(testInfo, environment, cleanupErrors)
      throw error
    }
    let useFailed = false
    let useError: unknown
    try {
      await use(environment)
    } catch (error) {
      useFailed = true
      useError = error
    }
    const cleanupErrors: unknown[] = []
    for (const dispose of [() => browser.dispose(), () => environment.dispose()]) {
      try {
        await dispose()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (
      useFailed ||
      testInfo.status !== testInfo.expectedStatus ||
      cleanupErrors.length > 0
    ) {
      await attachFailureArtifacts(testInfo, environment, cleanupErrors)
    }
    if (useFailed) throw useError
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to dispose Oallet test resources')
    }
  }
  const fixtures: Record<string, unknown> = {
    oallet: [fixture, { auto: true }],
  }
  if (options.walletConnect) {
    const createWalletConnect = options.walletConnect
    fixtures.walletConnect = async (
      { oallet }: { oallet: EnvironmentType },
      use: (walletConnect: WalletConnectType) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      const walletConnect = await createWalletConnect({ oallet }, testInfo)
      await useManaged(walletConnect, use)
    }
  }
  return base.extend(
    fixtures as Fixtures<
      Value<EnvironmentType, WalletConnectType>,
      Record<never, never>,
      TestArgs,
      WorkerArgs
    >,
  ) as TestType<TestArgs & Value<EnvironmentType, WalletConnectType>, WorkerArgs>
}

async function useManaged<Value extends extend.ManagedWalletConnect>(
  value: Value,
  use: (value: Value) => Promise<void>,
) {
  let useFailed = false
  let useError: unknown
  try {
    await use(value)
  } catch (error) {
    useFailed = true
    useError = error
  }
  let cleanupFailed = false
  let cleanupError: unknown
  try {
    await value.dispose()
  } catch (error) {
    cleanupFailed = true
    cleanupError = error
  }
  if (useFailed && cleanupFailed) {
    throw new AggregateError(
      [useError, cleanupError],
      'WalletConnect test and client disposal both failed',
    )
  }
  if (useFailed) throw useError
  if (cleanupFailed) throw cleanupError
}

function traceField(name: string, value: unknown) {
  return value === undefined ? undefined : `${name}=${String(value)}`
}

function traceText(environment: FixtureEnvironment) {
  return environment.trace.events
    .map((event) =>
      [
        new Date(event.timestamp).toISOString(),
        event.type,
        traceField('walletId', 'walletId' in event ? event.walletId : undefined),
        traceField(
          'connectionId',
          'connectionId' in event ? event.connectionId : undefined,
        ),
        traceField('method', 'method' in event ? event.method : undefined),
        traceField('stage', 'stage' in event ? event.stage : undefined),
        traceField('reason', 'reason' in event ? event.reason : undefined),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join('\n')
}

export declare namespace extend {
  type ManagedWalletConnect = {
    dispose(): Promise<void>
  }
  type Options<EnvironmentType extends FixtureEnvironment> = {
    readonly environment: (
      testInfo: TestInfo,
    ) => EnvironmentType | Promise<EnvironmentType>
  }
  type WalletConnectOptions<
    EnvironmentType extends FixtureEnvironment,
    WalletConnectType extends ManagedWalletConnect,
  > = Options<EnvironmentType> & {
    readonly walletConnect: (
      fixtures: { readonly oallet: EnvironmentType },
      testInfo: TestInfo,
    ) => WalletConnectType | Promise<WalletConnectType>
  }
  type ReturnType = TestType<{ oallet: FixtureEnvironment }, Record<never, never>>
}

function errorText(error: unknown) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error)
}

async function attachFailureArtifacts(
  testInfo: TestInfo,
  environment: FixtureEnvironment,
  cleanupErrors: unknown[],
) {
  try {
    await attachTrace(testInfo, environment)
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length === 0) return
  try {
    await testInfo.attach('oallet-cleanup-errors.txt', {
      body: cleanupErrors.map(errorText).join('\n\n'),
      contentType: 'text/plain',
    })
  } catch (error) {
    cleanupErrors.push(error)
  }
}

async function attachTrace(testInfo: TestInfo, environment: FixtureEnvironment) {
  const trace = environment.trace
  await testInfo.attach('oallet-trace.json', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('oallet-trace.txt', {
    body: traceText(environment),
    contentType: 'text/plain',
  })
}
