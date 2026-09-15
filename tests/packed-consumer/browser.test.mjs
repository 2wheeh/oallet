import { Environment } from '@oallet/core'
import { Identity, Transport, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import { test as base, expect } from '@playwright/test'
import { anvil } from 'viem/chains'

const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.eoa({
          accounts: [Identity.alice],
          chains: [{ chain: anvil, transport: Transport.unavailable() }],
          id: 'packed-wallet',
          name: 'Packed Wallet',
        }),
      ],
    }),
})

test('the installed package injects its browser runtime on HTTP pages', async ({
  context,
  page,
}) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await context.route('http://packed-consumer.example/**', (route) =>
    route.fulfill({
      body: `<!doctype html><script>
        window.providerDetail = new Promise((resolve) => {
          window.addEventListener('eip6963:announceProvider', (event) => {
            resolve(event.detail);
          });
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        window.chainId = window.providerDetail.then(({ provider }) =>
          provider.request({ method: 'eth_chainId' })
        );
      </script>`,
      contentType: 'text/html',
    }),
  )
  await page.goto('http://packed-consumer.example/')
  const initial = await page.evaluate(async () => ({
    chainId: await window.chainId,
    nativeUuid: typeof crypto.randomUUID,
    secure: isSecureContext,
    uuid: (await window.providerDetail).info.uuid,
  }))
  expect(initial.chainId).toBe('0x7a69')
  expect(initial.nativeUuid).toBe('undefined')
  expect(initial.secure).toBe(false)
  await page.reload()
  expect(
    await page.evaluate(async () => (await window.providerDetail).info.uuid),
  ).not.toBe(initial.uuid)
  expect(await page.evaluate(() => window.chainId)).toBe('0x7a69')
  expect(pageErrors).toEqual([])
})
