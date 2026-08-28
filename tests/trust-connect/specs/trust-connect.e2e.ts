import { Environment } from '@oallet/core'
import { Identity, Transport, Wallet } from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { test as base, expect, type Locator } from '@playwright/test'
import { type Hex, isHex, recoverMessageAddress, size } from 'viem'
import { mainnet } from 'viem/chains'

const projectId = process.env.VITE_WC_PROJECT_ID
const walletId = 'trust-connect-wallet'
const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.eoa({
          accounts: [Identity.alice],
          chains: [
            {
              chain: mainnet,
              transport: Transport.unavailable(),
            },
          ],
          id: walletId,
          name: 'Oallet Trust Connect Wallet',
        }),
      ],
    }),
})

test.skip(!projectId, 'Set VITE_WC_PROJECT_ID to run the real-relay canary')

test('approves only EVM from Trust Connect multi-namespace proposal', async ({
  oallet,
  page,
}) => {
  if (!projectId) throw new Error('Missing VITE_WC_PROJECT_ID')
  await using walletConnect = await Client.create({
    environment: oallet,
    projectId,
    walletId,
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Open Trust Modal' }).click()
  await page.getByRole('button', { name: /WalletConnect.*Connect/i }).click()
  const qr = page.getByRole('region', { name: 'WalletConnect QR code' })
  await expect(qr).toBeVisible()
  const proposal = await walletConnect.pair({ uri: await Qr.scan(qr) })
  expect(Object.keys(proposal.requiredNamespaces)).toEqual([])
  expect(Object.keys(proposal.optionalNamespaces).sort()).toEqual([
    'bip122',
    'eip155',
    'solana',
  ])
  const session = await proposal.approve()
  expect(Object.keys(session.namespaces)).toEqual(['eip155'])

  await expect(page.getByTestId('eip155-status')).toHaveText('connected')
  await expect(page.getByTestId('eip155-account')).toHaveText(Identity.alice.address)
  await expect(page.getByTestId('solana-status')).toHaveText('disconnected')
  await expect(page.getByTestId('bip122-status')).toHaveText('disconnected')

  await page.getByRole('button', { name: 'Sign message' }).click()
  const request = await oallet.wallet(walletId).requests.next('personal_sign')
  await request.approve()
  const signature = await readHex(page.getByTestId('message-signature'), 65)
  await expect(
    recoverMessageAddress({ message: 'Hello from Trust Connect', signature }),
  ).resolves.toBe(Identity.alice.address)

  await session.disconnect()
  await expect(page.getByTestId('eip155-status')).toHaveText('disconnected')
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
