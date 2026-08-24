import type { Environment } from '@oallet/core'
import type { BrowserContext, Fixtures, TestInfo, TestType } from '@playwright/test'

import { attach } from '../browser/attach.js'

type FixtureEnvironment = attach.Options['environment'] &
  Pick<Environment.Instance, 'dispose' | 'trace'>

export type Value<EnvironmentType extends FixtureEnvironment = FixtureEnvironment> = {
  readonly oallet: EnvironmentType
}

export function extend<
  TestArgs extends { context: BrowserContext },
  WorkerArgs extends object,
  EnvironmentType extends FixtureEnvironment,
>(base: TestType<TestArgs, WorkerArgs>, options: extend.Options<EnvironmentType>) {
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
  const fixtures = {
    oallet: [fixture, { auto: true }],
  } as unknown as Fixtures<
    Value<EnvironmentType>,
    Record<never, never>,
    TestArgs,
    WorkerArgs
  >
  return base.extend<Value<EnvironmentType>>(fixtures)
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

export declare namespace extend {
  type Options<EnvironmentType extends FixtureEnvironment> = {
    readonly environment: (
      testInfo: TestInfo,
    ) => EnvironmentType | Promise<EnvironmentType>
  }
  type ReturnType = TestType<{ oallet: FixtureEnvironment }, Record<never, never>>
}

async function attachTrace(testInfo: TestInfo, environment: FixtureEnvironment) {
  const trace = environment.trace
  await testInfo.attach('oallet-trace.json', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('oallet-trace.txt', {
    body: environment.trace.events
      .map((event) =>
        [
          new Date(event.timestamp).toISOString(),
          'walletId' in event ? event.walletId : undefined,
          'method' in event ? event.method : undefined,
          event.type,
        ]
          .filter(Boolean)
          .join(' '),
      )
      .join('\n'),
    contentType: 'text/plain',
  })
}
