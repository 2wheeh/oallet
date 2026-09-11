import { Environment } from '@oallet/core'
import { Fixture } from '@oallet/playwright'
import { Identity, Profile, Wallet } from '@oallet/solana'
import { test as base, expect } from '@playwright/test'
import { createSolanaRpc, getBase58Encoder, signature } from '@solana/kit'
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
  const rpc = createSolanaRpc(surfnet.rpcUrl)
  await page.goto(`/?rpc=${encodeURIComponent(surfnet.rpcUrl)}`)
  await expect(page.getByTestId('wallet-names')).toContainText(profile.name)

  await page.getByRole('button', { name: 'Connect Oallet', exact: true }).click()
  const request = await oallet.wallet(profile.id).requests.next('standard:connect')
  await request.approve()

  await expect(page.getByTestId('wallet-status')).toHaveText('connected')
  await expect(page.getByTestId('wallet-account')).toHaveText(Identity.alice.address)

  await page.getByRole('button', { name: 'Sign message' }).click()
  await (await oallet.wallet(profile.id).requests.next('solana:signMessage')).approve()
  const messageSignature = page.getByTestId('message-signature')
  await expect(messageSignature).not.toBeEmpty()
  const signatureBytes = Uint8Array.from(
    (await messageSignature.innerText()).split(',').map(Number),
  )
  expect(signatureBytes).toHaveLength(64)
  const publicKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(getBase58Encoder().encode(Identity.alice.address)).buffer,
    'Ed25519',
    false,
    ['verify'],
  )
  await expect(
    crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signatureBytes.buffer,
      new TextEncoder().encode('Oallet ConnectorKit fixture').buffer,
    ),
  ).resolves.toBe(true)

  const { value: balanceBefore } = await rpc
    .getBalance(Identity.bob.address, { commitment: 'confirmed' })
    .send()
  await page.getByTestId('transaction-to-input').fill(Identity.bob.address)
  await page.getByTestId('transaction-lamports-input').fill('1')
  await page.getByRole('button', { name: 'Send transaction' }).click()
  await (
    await oallet.wallet(profile.id).requests.next('solana:signTransaction')
  ).approve()
  await expect(page.getByTestId('transaction-status')).toHaveText('submitted', {
    timeout: 15_000,
  })
  const transactionSignature = signature(
    await page.getByTestId('transaction-signature').innerText(),
  )
  await expect
    .poll(
      () =>
        rpc
          .getTransaction(transactionSignature, {
            commitment: 'confirmed',
            encoding: 'json',
            maxSupportedTransactionVersion: 0,
          })
          .send(),
      { timeout: 15_000 },
    )
    .toMatchObject({ meta: { err: null } })
  await expect
    .poll(
      () => rpc.getBalance(Identity.bob.address, { commitment: 'confirmed' }).send(),
      { timeout: 15_000 },
    )
    .toMatchObject({ value: balanceBefore + 1n })

  await page.getByRole('button', { name: 'Disconnect Oallet', exact: true }).click()
  await expect(page.getByTestId('wallet-status')).toHaveText('disconnected')
})
