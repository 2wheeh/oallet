import { Environment } from '@oallet/core'
import { Fixture } from '@oallet/playwright'
import { Identity, Profile, Wallet } from '@oallet/solana'
import { test as base, expect } from '@playwright/test'

const profile = Profile.keypair({
  accounts: [Identity.alice],
  chains: ['solana:localnet'],
  id: 'connectorkit-wallet',
  name: 'Oallet ConnectorKit Wallet',
})

const test = Fixture.extend(base, {
  environment: () => Environment.create({ wallets: [Wallet.create({ profile })] }),
})

test('discovers and connects Oallet through ConnectorKit', async ({ oallet, page }) => {
  await page.goto('/')
  await expect(page.getByTestId('wallet-names')).toContainText(profile.name)

  await page.getByRole('button', { name: 'Connect Oallet', exact: true }).click()
  const request = await oallet.wallet(profile.id).requests.next('standard:connect')
  await request.approve()

  await expect(page.getByTestId('wallet-status')).toHaveText('connected')
  await expect(page.getByTestId('wallet-account')).toHaveText(Identity.alice.address)

  await page.getByRole('button', { name: 'Sign message' }).click()
  await (await oallet.wallet(profile.id).requests.next('solana:signMessage')).approve()
  await expect(page.getByTestId('message-signature')).toHaveText('64')

  await page.getByRole('button', { name: 'Sign transaction' }).click()
  await (
    await oallet.wallet(profile.id).requests.next('solana:signTransaction')
  ).approve()
  await expect(page.getByTestId('transaction-signature')).toHaveText('64')

  await page.getByRole('button', { name: 'Disconnect Oallet', exact: true }).click()
  await expect(page.getByTestId('wallet-status')).toHaveText('disconnected')
})
