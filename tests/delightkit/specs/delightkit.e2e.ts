import { Environment } from '@oallet/core'
import { Identity, Profile, Wallet } from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { test as base, expect, type Locator } from '@playwright/test'
import { custom, type Hex, isHex, recoverMessageAddress, size } from 'viem'
import { mainnet } from 'viem/chains'

const projectId = process.env.VITE_WC_PROJECT_ID
const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [mainnet.id],
  id: 'delightkit-wallet',
  name: 'Oallet DelightKit Wallet',
})
const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.create({
          chains: [
            {
              chain: mainnet,
              transport: custom({
                request() {
                  throw new Error('This consumer canary does not use RPC')
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

test('projects an approved WalletConnect account and signs through DelightKit', async ({
  oallet,
  page,
}) => {
  if (!projectId) throw new Error('Missing VITE_WC_PROJECT_ID')
  await using walletConnect = await Client.create({
    environment: oallet,
    projectId,
    walletId: profile.id,
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Connect WalletConnect' }).click()
  const qr = page.getByTestId('walletconnect-qr')
  await expect(qr).toBeVisible()
  const proposal = await walletConnect.pair({ uri: await scanQr(qr) })
  expect(proposal.optionalNamespaces.eip155?.methods).toContain('personal_sign')
  const session = await proposal.approve()

  await expect(page.getByTestId('wagmi-status')).toHaveText('connected')
  await expect(page.getByTestId('delight-account')).toHaveText(Identity.alice.address)

  await page.getByRole('button', { name: 'Sign message' }).click()
  const request = await oallet.wallet(profile.id).requests.next('personal_sign')
  await request.approve()
  const signature = await readHex(page.getByTestId('message-signature'), 65)
  await expect(
    recoverMessageAddress({ message: 'Hello from DelightKit', signature }),
  ).resolves.toBe(Identity.alice.address)

  await session.disconnect()
  await expect(page.getByTestId('wagmi-status')).toHaveText('disconnected')
  await expect(page.getByTestId('delight-account')).toBeEmpty()
})

async function scanQr(locator: Locator) {
  let uri: string | undefined
  await expect(async () => {
    uri = await Qr.scan(locator)
  }).toPass({ intervals: [100, 250, 500], timeout: 15_000 })
  if (!uri) throw new Error('Expected a WalletConnect QR URI')
  return uri
}

async function readHex(locator: Locator, byteSize: number): Promise<Hex> {
  await expect(locator).not.toBeEmpty()
  const value = await locator.textContent()
  const valid = isHex(value)
  expect(valid).toBe(true)
  if (!valid) throw new Error('Expected a hex value')
  expect(size(value)).toBe(byteSize)
  return value
}
