import { Environment } from '@oallet/core'
import { Identity, Profile, Wallet } from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { test as base, expect, type Locator } from '@playwright/test'
import { custom, type Hex, isHex, recoverMessageAddress, size } from 'viem'
import { anvil } from 'viem/chains'

const projectId = process.env.VITE_WC_PROJECT_ID

const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [anvil.id],
  id: 'walletconnect-wallet',
  name: 'Oallet WalletConnect Wallet',
})

const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.create({
          chains: [
            {
              chain: anvil,
              transport: custom({
                request() {
                  throw new Error('This WalletConnect canary does not use RPC')
                },
              }),
            },
          ],
          profile,
        }),
      ],
    }),
})

test.skip(!projectId, 'Set VITE_WC_PROJECT_ID to run the real-relay canary')

test('Wagmi pairs, signs, and disconnects through the real relay', async ({
  oallet,
  page,
}) => {
  if (!projectId) throw new Error('Missing VITE_WC_PROJECT_ID')
  await using walletConnect = await Client.create({
    environment: oallet,
    projectId,
    walletId: profile.id,
  })

  await page.goto('http://127.0.0.1:4174')
  await page.getByRole('button', { name: 'Connect WalletConnect' }).click()
  const qr = page.getByTestId('walletconnect-qr')
  await expect(qr).toBeVisible()

  const proposal = await walletConnect.pair({
    timeout: 60_000,
    uri: await scanQr(qr),
  })
  const namespace =
    proposal.requiredNamespaces.eip155 ?? proposal.optionalNamespaces.eip155
  expect(namespace?.methods).toContain('personal_sign')
  const session = await proposal.approve()

  await expect(page.getByTestId('status')).toHaveText('connected')
  await expect(page.getByTestId('account')).toHaveText(Identity.alice.address)

  await page.getByTestId('message-input').fill('Hello over WalletConnect')
  await page.getByTestId('sign-message').click()
  const request = await oallet.wallet(profile.id).requests.next('personal_sign')
  await request.approve()
  const signature = await readHex(page.getByTestId('message-signature'), 65)
  await expect(
    recoverMessageAddress({
      message: 'Hello over WalletConnect',
      signature,
    }),
  ).resolves.toBe(Identity.alice.address)

  await session.disconnect()
  await expect(page.getByTestId('status')).toHaveText('disconnected')
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

async function scanQr(locator: Locator) {
  let uri: string | undefined
  await expect(async () => {
    uri = await Qr.scan(locator)
  }).toPass({ intervals: [100, 250, 500], timeout: 5_000 })
  if (!uri) throw new Error('Expected a WalletConnect QR URI')
  return uri
}
