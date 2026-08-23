import type { Environment } from '@oallet/core'
import type { BrowserContext, TestInfo } from '@playwright/test'

import { attach } from '../browser/attach.js'

export type Value = {
  readonly oallet: Environment.Instance
}

type FunctionReturn<FunctionType extends (...args: never[]) => unknown> =
  FunctionType extends (...args: never[]) => infer Result ? Result : never

export function create(options: create.Options) {
  const fixture = async (
    { context }: { context: BrowserContext },
    use: (environment: Environment.Instance) => Promise<void>,
    testInfo: TestInfo,
  ) => {
    const environment =
      typeof options.environment === 'function'
        ? await options.environment(testInfo)
        : options.environment
    await attach({ context, environment })
    await use(environment)
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('oallet-trace.json', {
        body: JSON.stringify(redact(environment.trace), null, 2),
        contentType: 'application/json',
      })
    }
  }
  return {
    oallet: [fixture, { auto: true }] as [typeof fixture, { auto: true }],
  }
}

export declare namespace create {
  type Options = {
    readonly environment:
      | Environment.Instance
      | ((testInfo: TestInfo) => Environment.Instance | Promise<Environment.Instance>)
  }
  type ReturnType = FunctionReturn<typeof create>
}

function redact(value: unknown, key = ''): unknown {
  if (/mnemonic|private.?key|secret|sym.?key/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string')
    return value.replace(/symKey=[^&]+/gi, 'symKey=[REDACTED]')
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, item]) => [
        nestedKey,
        redact(item, nestedKey),
      ]),
    )
  }
  return value
}
