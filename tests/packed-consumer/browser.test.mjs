import { Environment } from '@oallet/core'
import { Identity, Transport, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import {
  Identity as SolanaIdentity,
  Profile as SolanaProfile,
  Wallet as SolanaWallet,
} from '@oallet/solana'
import { test as base, expect } from '@playwright/test'
import { getBase58Encoder } from '@solana/kit'
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
        SolanaWallet.create({
          profile: SolanaProfile.keypair({
            accounts: [SolanaIdentity.alice],
            chains: ['solana:localnet'],
            id: 'packed-solana-wallet',
            name: 'Packed Solana Wallet',
          }),
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

test('the installed runtime discovers a Solana wallet and signs on HTTP pages', async ({
  context,
  oallet,
  page,
}) => {
  await context.route('http://packed-consumer.example/**', (route) =>
    route.fulfill({ body: '<!doctype html>', contentType: 'text/html' }),
  )
  await page.goto('http://packed-consumer.example/')
  const output = await oallet.wallet('packed-solana-wallet').autoApprove(() =>
    page.evaluate(async () => {
      let wallet
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (value) => {
              wallet = value
            },
          },
        }),
      )
      if (!wallet) throw new Error('Solana wallet was not discovered')
      const {
        accounts: [account],
      } = await wallet.features['standard:connect'].connect()
      const [signed] = await wallet.features['solana:signMessage'].signMessage({
        account,
        message: new TextEncoder().encode('Packed Solana wallet'),
      })
      return {
        address: account.address,
        signature: [...signed.signature],
        signedMessage: [...signed.signedMessage],
      }
    }),
  )
  expect(output.address).toBe(SolanaIdentity.alice.address)
  expect(output.signature).toHaveLength(64)
  const message = new TextEncoder().encode('Packed Solana wallet')
  expect(output.signedMessage).toEqual([...message])
  const publicKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(getBase58Encoder().encode(SolanaIdentity.alice.address)),
    'Ed25519',
    false,
    ['verify'],
  )
  await expect(
    crypto.subtle.verify(
      'Ed25519',
      publicKey,
      Uint8Array.from(output.signature),
      message,
    ),
  ).resolves.toBe(true)
})
