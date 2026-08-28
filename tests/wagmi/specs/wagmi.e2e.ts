import { Environment } from '@oallet/core'
import { Identity, Wallet } from '@oallet/evm'
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
import { anvil, mainnet } from 'viem/chains'

let lease: Awaited<ReturnType<ReturnType<typeof Pool.create>['acquire']>>
let pool: ReturnType<typeof Pool.create>

const walletId = 'alice'

const typedData = {
  domain: { chainId: anvil.id, name: 'Oallet fixture', version: '1' },
  message: { contents: 'Hello from Wagmi' },
  primaryType: 'Message',
  types: { Message: [{ name: 'contents', type: 'string' }] },
} as const

const test = Fixture.extend(base, {
  environment: () => {
    return Environment.create({
      wallets: [
        Wallet.eoa({
          accounts: [Identity.alice, Identity.bob],
          chains: [
            { chain: anvil, transport: http(lease.instance.url) },
            { chain: mainnet, transport: http(lease.instance.url) },
          ],
          id: walletId,
          name: 'Oallet Test Wallet',
        }),
      ],
    })
  },
})

test.beforeAll(async () => {
  pool = Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 })
  lease = await pool.acquire()
})

test.afterAll(async () => {
  await lease.release()
  await pool.close()
})

test('Wagmi discovers Oallet and completes a real EOA flow', async ({ oallet, page }) => {
  await oallet.wallet(walletId).autoApprove(async () => {
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
  })
})

test('Wagmi surfaces a native connection rejection', async ({ oallet, page }) => {
  await page.goto(`/?rpc=${encodeURIComponent(lease.instance.url)}`)
  await page.getByRole('button', { name: 'Connect Oallet Test Wallet' }).click()
  const request = await oallet.wallet(walletId).requests.next('eth_requestAccounts')

  request.reject({ code: 4001, message: 'User rejected connection' })

  await expect(page.getByTestId('connect-error')).toContainText('"code":4001')
  await expect(page.getByTestId('connect-error')).toContainText(
    'User rejected connection',
  )
  await expect(page.getByTestId('status')).toHaveText('disconnected')
})

test('Wagmi follows account restore, reload, and reset', async ({ oallet, page }) => {
  await page.goto(`/?rpc=${encodeURIComponent(lease.instance.url)}`)
  await page.getByRole('button', { name: 'Connect Oallet Test Wallet' }).click()
  const request = await oallet.wallet(walletId).requests.next('eth_requestAccounts')
  const connection = await request.approve()

  await expect(page.getByTestId('account')).toHaveText(Identity.alice.address)
  const snapshot = await oallet.snapshot()

  await connection.setAccounts([Identity.bob])

  await expect(page.getByTestId('account')).toHaveText(Identity.bob.address)

  await oallet.restore(snapshot)

  await expect(page.getByTestId('account')).toHaveText(Identity.alice.address)

  await connection.setAccounts([Identity.bob])

  await page.reload()

  await expect(page.getByTestId('account')).toHaveText(Identity.bob.address)

  await connection.switchChain(mainnet.id)

  await expect(page.getByTestId('chain')).toHaveText(String(mainnet.id))

  await connection.disconnect()

  await expect(page.getByTestId('status')).toHaveText('disconnected')

  await connection.reconnect()

  await expect(page.getByTestId('status')).toHaveText('connected')
  await expect(page.getByTestId('account')).toHaveText(Identity.bob.address)
  const resetEvent = page.evaluate(async () => {
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
    return new Promise<unknown>((resolve) => {
      detail.provider.on('accountsChanged', async (event) => {
        resolve({
          accounts: await detail.provider.request({ method: 'eth_accounts' }),
          event,
        })
      })
    })
  })

  await oallet.reset()

  await expect(resetEvent).resolves.toEqual({ accounts: [], event: [] })
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
