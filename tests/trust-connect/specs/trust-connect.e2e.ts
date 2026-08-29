import { Environment } from '@oallet/core'
import {
  Identity as EvmIdentity,
  Transport as EvmTransport,
  Wallet as EvmWallet,
} from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import {
  Identity as SolanaIdentity,
  Profile as SolanaProfile,
  Wallet as SolanaWallet,
} from '@oallet/solana'
import { Client } from '@oallet/walletconnect'
import { test as base, expect, type Locator } from '@playwright/test'
import { getBase58Encoder } from '@solana/kit'
import { type Hex, isHex, recoverMessageAddress, size } from 'viem'
import { mainnet } from 'viem/chains'

const projectId = process.env.VITE_WC_PROJECT_ID
const walletId = 'trust-connect-wallet'
const solanaProfile = SolanaProfile.keypair({
  accounts: [SolanaIdentity.alice],
  chains: ['solana:mainnet'],
  id: 'trust-connect-solana-wallet',
  name: 'Oallet Trust Connect Solana Wallet',
})
const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        EvmWallet.eoa({
          accounts: [EvmIdentity.alice],
          chains: [
            {
              chain: mainnet,
              transport: EvmTransport.unavailable(),
            },
          ],
          id: walletId,
          name: 'Oallet Trust Connect Wallet',
        }),
        SolanaWallet.create({ profile: solanaProfile }),
      ],
    }),
})

test('connects and signs through Trust Connect Wallet Standard discovery', async ({
  oallet,
  page,
}) => {
  await page.goto('/')
  const connect = page.getByRole('button', { name: 'Connect Oallet Solana' })
  await expect(connect).toBeEnabled()
  await connect.click()
  const connectRequest = await oallet
    .wallet(solanaProfile.id)
    .requests.next('standard:connect')
  await connectRequest.approve()

  await expect(page.getByTestId('solana-status')).toHaveText('connected')
  await expect(page.getByTestId('solana-account')).toHaveText(
    SolanaIdentity.alice.address,
  )
  await page.getByRole('button', { name: 'Sign Solana message' }).click()
  const signRequest = await oallet
    .wallet(solanaProfile.id)
    .requests.next('solana:signMessage')
  await signRequest.approve()

  const signature = await readBytes(page.getByTestId('solana-message-signature'), 64)
  const publicKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(getBase58Encoder().encode(SolanaIdentity.alice.address)).buffer,
    'Ed25519',
    false,
    ['verify'],
  )
  await expect(
    crypto.subtle.verify(
      'Ed25519',
      publicKey,
      Uint8Array.from(signature).buffer,
      new TextEncoder().encode('Hello from Trust Connect Solana').buffer,
    ),
  ).resolves.toBe(true)
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
  await expect(page.getByTestId('eip155-account')).toHaveText(EvmIdentity.alice.address)
  await expect(page.getByTestId('solana-status')).toHaveText('disconnected')
  await expect(page.getByTestId('bip122-status')).toHaveText('disconnected')

  await page.getByRole('button', { name: 'Sign message' }).click()
  const request = await oallet.wallet(walletId).requests.next('personal_sign')
  await request.approve()
  const signature = await readHex(page.getByTestId('message-signature'), 65)
  await expect(
    recoverMessageAddress({ message: 'Hello from Trust Connect', signature }),
  ).resolves.toBe(EvmIdentity.alice.address)

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

async function readBytes(locator: Locator, byteSize: number): Promise<Uint8Array> {
  await expect(locator).not.toBeEmpty()
  const value = await locator.textContent()
  const bytes = Uint8Array.from((value ?? '').split(',').map(Number))
  expect(bytes).toHaveLength(byteSize)
  return bytes
}
