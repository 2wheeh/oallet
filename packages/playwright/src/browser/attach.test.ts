import { Environment, Profile, type Wallet } from '@oallet/core'
import { chromium } from '@playwright/test'
import { expect, test } from 'vitest'

import * as Browser from './exports.js'

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
      return {
        accounts: await detail.provider.request({ method: 'eth_requestAccounts' }),
        name: detail.info.name,
      }
    })
    const request = await environment.wallet('wallet').requests.next()
    await request.approve()

    await expect(result).resolves.toEqual({
      accounts: ['0x0000000000000000000000000000000000000001'],
      name: 'Oallet Test Wallet',
    })
    expect(origins).toEqual(['https://app.example', 'https://app.example'])
  } finally {
    await context.close()
    await browser.close()
  }
}, 30_000)
