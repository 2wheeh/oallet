import { Environment } from '@oallet/core'
import { Fixture } from '@oallet/playwright'
import { Identity, Profile, Wallet } from '@oallet/solana'
import { test as base, expect } from '@playwright/test'
import { Surfnet } from '@solana/surfpool'

let surfnet: Surfnet

const profile = Profile.keypair({
  accounts: [Identity.alice],
  chains: ['solana:localnet'],
  id: 'connectorkit-wallet',
  name: 'Oallet ConnectorKit Wallet',
})

const test = Fixture.extend(base, {
  environment: () => Environment.create({ wallets: [Wallet.create({ profile })] }),
})

test.beforeAll(() => {
  surfnet = Surfnet.startWithConfig({ offline: true })
  surfnet.fundSolMany([
    { address: Identity.alice.address, lamports: 1_000_000_000 },
    { address: Identity.bob.address, lamports: 1_000_000_000 },
  ])
})

test.afterAll(() => {
  surfnet.stop()
})

test('discovers and connects Oallet through ConnectorKit', async ({ oallet, page }) => {
  await page.goto(`/?rpc=${encodeURIComponent(surfnet.rpcUrl)}`)
  await expect(page.getByTestId('wallet-names')).toContainText(profile.name)

  await page.getByRole('button', { name: 'Connect Oallet', exact: true }).click()
  const request = await oallet.wallet(profile.id).requests.next('standard:connect')
  await request.approve()

  await expect(page.getByTestId('wallet-status')).toHaveText('connected')
  await expect(page.getByTestId('wallet-account')).toHaveText(Identity.alice.address)

  await page.getByRole('button', { name: 'Sign message' }).click()
  await (await oallet.wallet(profile.id).requests.next('solana:signMessage')).approve()
  await expect(page.getByTestId('message-signature')).toHaveText('64')

  const balanceBefore = await getBalance(Identity.bob.address)
  await page.getByTestId('transaction-to-input').fill(Identity.bob.address)
  await page.getByTestId('transaction-lamports-input').fill('1')
  await page.getByRole('button', { name: 'Send transaction' }).click()
  await (
    await oallet.wallet(profile.id).requests.next('solana:signTransaction')
  ).approve()
  await expect(page.getByTestId('transaction-status')).toHaveText('submitted', {
    timeout: 15_000,
  })
  const signature = await page.getByTestId('transaction-signature').textContent()
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/)
  if (!signature) throw new Error('Expected a transaction signature')
  await expect
    .poll(
      async () => {
        const transaction = await rpc<{
          readonly meta: { readonly err: unknown }
        } | null>('getTransaction', [
          signature,
          {
            commitment: 'confirmed',
            encoding: 'json',
            maxSupportedTransactionVersion: 0,
          },
        ])
        return transaction ? transaction.meta.err : 'pending'
      },
      { timeout: 15_000 },
    )
    .toBeNull()
  await expect
    .poll(() => getBalance(Identity.bob.address), { timeout: 15_000 })
    .toBe(balanceBefore + 1)

  await page.getByRole('button', { name: 'Disconnect Oallet', exact: true }).click()
  await expect(page.getByTestId('wallet-status')).toHaveText('disconnected')
})

async function getBalance(address: string): Promise<number> {
  const result = await rpc<{ readonly value: number }>('getBalance', [address])
  return result.value
}

async function rpc<Result>(method: string, params: readonly unknown[]): Promise<Result> {
  const response = await fetch(surfnet.rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const payload = (await response.json()) as {
    readonly error?: { readonly message: string }
    readonly result?: Result
  }
  if (payload.error) throw new Error(payload.error.message)
  if (payload.result === undefined) throw new Error(`Missing ${method} RPC result`)
  return payload.result
}
