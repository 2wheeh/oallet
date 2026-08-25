import { Environment, Profile, type Wallet } from '@oallet/core'
import { chromium, devices } from '@playwright/test'
import { expect, test } from 'vitest'

import { DeliveryError } from '../errors/errors.js'
import * as Browser from './exports.js'

test('announces a provider when the initial document lacks crypto.randomUUID', async () => {
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
  })
  const adapter: Wallet.Adapter = {
    profile,
    prepare() {
      return { type: 'return', value: null }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(devices['Desktop Chrome'])
  const pageErrors: Error[] = []
  context.on('page', (page) => {
    page.on('pageerror', (error) => pageErrors.push(error))
  })
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    const uuid = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) =>
            resolve(event.detail.info.uuid)) as EventListener)
          window.dispatchEvent(new Event('eip6963:requestProvider'))
        }),
    )

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)

test('announces an EIP-6963 provider before app code and bridges requests to the controller', async () => {
  const origins: string[] = []
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
  })
  const adapter: Wallet.Adapter = {
    profile,
    prepare(input) {
      origins.push(input.origin)
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x7a69' }
      return {
        type: 'interactive',
        approve: () => ['0x0000000000000000000000000000000000000001'],
        data: { type: 'connect' },
      }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    const result = page.evaluate(async () => {
      const detail = await new Promise<{
        info: { name: string }
        provider: { request(input: { method: string }): Promise<unknown> }
      }>((resolve) => {
        window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
          resolve(event.detail)
        }) as EventListener)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
      })
      Object.assign(window, { __oalletTestProvider: detail.provider })
      return {
        accounts: await detail.provider.request({ method: 'eth_requestAccounts' }),
        name: detail.info.name,
      }
    })
    const request = await environment
      .wallet('wallet')
      .requests.next('eth_requestAccounts')
    await request.approve()

    await expect(result).resolves.toEqual({
      accounts: ['0x0000000000000000000000000000000000000001'],
      name: 'Oallet Test Wallet',
    })
    expect(origins).toEqual(['https://app.example'])

    const rejected = page.evaluate(async () => {
      const provider = (
        window as typeof window & {
          __oalletTestProvider: {
            request(input: { method: string }): Promise<unknown>
          }
        }
      ).__oalletTestProvider
      try {
        await provider.request({ method: 'personal_sign' })
        return null
      } catch (error) {
        return {
          code: (error as Error & { code?: number }).code,
          message: (error as Error).message,
        }
      }
    })
    const signRequest = await environment.wallet('wallet').requests.next('personal_sign')
    signRequest.reject({ code: 4001, message: 'User rejected signing' })

    await expect(rejected).resolves.toEqual({
      code: 4001,
      message: 'User rejected signing',
    })

    const abandoned = page
      .evaluate(() => {
        const provider = (
          window as typeof window & {
            __oalletTestProvider: {
              request(input: { method: string }): Promise<unknown>
            }
          }
        ).__oalletTestProvider
        return provider.request({ method: 'personal_sign' })
      })
      .catch((error: unknown) => error)
    const abandonedRequest = await environment
      .wallet('wallet')
      .requests.next('personal_sign')

    await page.reload()

    expect(abandonedRequest.status).toBe('cancelled')
    await expect(abandonedRequest.approve()).rejects.toBeInstanceOf(
      Environment.RequestExpiredError,
    )
    await expect(abandoned).resolves.toBeInstanceOf(Error)
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)

test('delivers controller account changes to the active provider', async () => {
  type Controls = {
    readonly connection: {
      setAccounts(accounts: readonly string[]): Promise<void>
    }
  }
  let emit: (event: {
    readonly data: readonly string[]
    readonly name: 'accountsChanged'
    readonly origin: string
  }) => Promise<void>
  const profile = Profile.define({
    data: {},
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Oallet Test Wallet',
  })
  const controls: Controls = {
    connection: {
      setAccounts(accounts) {
        return emit({
          data: accounts,
          name: 'accountsChanged',
          origin: 'https://app.example',
        })
      },
    },
  }
  const adapter: Wallet.Adapter<Controls> = {
    controls,
    bind(context) {
      emit = context.emit
    },
    profile,
    prepare(input) {
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x1' }
      return {
        type: 'interactive',
        approve: () => ['0x0000000000000000000000000000000000000001'],
        data: { type: 'connect' },
      }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    state: () => ({ accounts: [], chainId: '0x1', connected: true }),
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('https://app.example/**', (route) =>
    route.fulfill({
      body: '<!doctype html><title>Fixture</title>',
      contentType: 'text/html',
    }),
  )
  await Browser.attach({ context, environment })
  const page = await context.newPage()

  try {
    await page.goto('https://app.example/')
    const connect = page.evaluate(async () => {
      const detail = await new Promise<{
        provider: {
          on(event: string, listener: (value: unknown) => void): void
          request(input: { method: string }): Promise<unknown>
        }
      }>((resolve) => {
        window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
          resolve(event.detail)
        }) as EventListener)
        window.dispatchEvent(new Event('eip6963:requestProvider'))
      })
      const events: unknown[] = []
      detail.provider.on('accountsChanged', (accounts) => events.push(accounts))
      Object.assign(window, { __oalletTestEvents: events })
      return detail.provider.request({ method: 'eth_requestAccounts' })
    })
    await (
      await environment.wallet('wallet').requests.next('eth_requestAccounts')
    ).approve()
    await connect

    await environment
      .wallet('wallet')
      .connection.setAccounts(['0x0000000000000000000000000000000000000002'])

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __oalletTestEvents: readonly unknown[] })
              .__oalletTestEvents,
        ),
      )
      .toEqual([['0x0000000000000000000000000000000000000002']])
    expect(environment.trace.events.map((event) => event.type)).toContain(
      'provider.eventDelivered',
    )

    await page.evaluate(() => {
      delete (
        globalThis as typeof globalThis & {
          __oallet_emit_v1__?: unknown
        }
      ).__oallet_emit_v1__
    })

    await expect(
      environment
        .wallet('wallet')
        .connection.setAccounts(['0x0000000000000000000000000000000000000003']),
    ).rejects.toBeInstanceOf(DeliveryError)
    expect(environment.trace.events.at(-1)?.type).toBe('provider.deliveryFailed')
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)
