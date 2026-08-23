import { Environment } from '@oallet/core'
import { Identity, Profile, Runtime, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import { test as base, expect, type Locator } from '@playwright/test'
import { Instance, Pool } from 'prool'
import {
  createPublicClient,
  type Hex,
  http,
  isAddressEqual,
  isHex,
  recoverMessageAddress,
  recoverTypedDataAddress,
  size,
} from 'viem'
import { anvil } from 'viem/chains'

let environment: Environment.Instance
let lease: Awaited<ReturnType<ReturnType<typeof Pool.create>['acquire']>>
let pool: ReturnType<typeof Pool.create>

const typedData = {
  domain: { chainId: anvil.id, name: 'Oallet fixture', version: '1' },
  message: { contents: 'Hello from Wagmi' },
  primaryType: 'Message',
  types: { Message: [{ name: 'contents', type: 'string' }] },
} as const

const test = base.extend<{ oallet: Environment.Instance }>({
  ...Fixture.create({ environment: () => environment }),
})

test.beforeAll(async () => {
  pool = Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 })
  lease = await pool.acquire()
  const runtime = Runtime.create({
    chains: [{ chain: anvil, transport: http(lease.instance.url) }],
  })
  const profile = Profile.eoa({
    accounts: [Identity.alice, Identity.bob],
    chains: [anvil.id],
    id: 'alice',
    name: 'Oallet Test Wallet',
  })
  environment = Environment.create({ wallets: [Wallet.create({ profile, runtime })] })
})

test.afterAll(async () => {
  await lease.release()
  await pool.close()
})

test('Wagmi discovers Oallet and completes a real EOA flow', async ({ oallet, page }) => {
  const stopAutoApprove = oallet.wallet('alice').startAutoApprove()

  try {
    await page.goto(`/?rpc=${encodeURIComponent(lease.instance.url)}`)
    await expect(
      page.getByRole('button', { name: 'Connect Oallet Test Wallet' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Connect Oallet Test Wallet' }).click()
    await expect(page.getByTestId('account')).toHaveText(Identity.alice.address)

    await page.getByTestId('message-input').fill('Hello from Wagmi')
    await page.getByTestId('sign-message').click()
    const messageSignature = await readHex(page.getByTestId('message-signature'), 65)
    await expect(
      recoverMessageAddress({
        message: 'Hello from Wagmi',
        signature: messageSignature,
      }),
    ).resolves.toBe(Identity.alice.address)

    await page.getByTestId('typed-data-input').fill(JSON.stringify(typedData))
    await page.getByTestId('sign-typed-data').click()
    const typedDataSignature = await readHex(page.getByTestId('typed-data-signature'), 65)
    await expect(
      recoverTypedDataAddress({
        ...typedData,
        signature: typedDataSignature,
      }),
    ).resolves.toBe(Identity.alice.address)

    await page.getByTestId('transaction-to-input').fill(Identity.bob.address)
    await page.getByTestId('transaction-value-input').fill('1')
    await page.getByTestId('send-transaction').click()
    const transactionHash = await readHex(page.getByTestId('transaction-hash'), 32)
    await expect(page.getByTestId('receipt')).toHaveText('success')
    const transaction = await createPublicClient({
      chain: anvil,
      transport: http(lease.instance.url),
    }).getTransaction({ hash: transactionHash })
    expect(isAddressEqual(transaction.from, Identity.alice.address)).toBe(true)
    expect(transaction.to && isAddressEqual(transaction.to, Identity.bob.address)).toBe(
      true,
    )
    expect(transaction.value).toBe(1n)
  } finally {
    stopAutoApprove()
  }
})

async function readHex(locator: Locator, byteSize: number): Promise<Hex> {
  await expect(locator).not.toBeEmpty()
  const value = await locator.textContent()
  const valid = isHex(value)
  expect(valid).toBe(true)
  if (!valid) throw new Error('Expected a hex value')
  expect(size(value)).toBe(byteSize)
  return value
}
