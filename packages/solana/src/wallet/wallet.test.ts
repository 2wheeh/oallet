import { Environment } from '@oallet/core'
import {
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { expect, test } from 'vitest'

import * as Errors from '../errors/exports.js'
import * as Identity from '../identity/exports.js'
import * as Profile from '../profile/exports.js'
import * as Wallet from './exports.js'

function setup() {
  const profile = Profile.keypair({
    accounts: [Identity.alice, Identity.bob],
    chains: ['solana:localnet'],
    id: 'wallet',
    name: 'Wallet',
  })
  const environment = Environment.create({
    wallets: [Wallet.create({ profile })],
  })
  return { environment, profile, wallet: environment.wallet(profile.id) }
}

test('connects an origin and returns its approved accounts', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'standard:connect',
    origin: 'https://app.example',
    params: [],
    walletId: 'wallet',
  })
  const request = await wallet.requests.next('standard:connect')
  const connection = await request.approve()

  await expect(response).resolves.toMatchObject([
    {
      address: Identity.alice.address,
      chains: ['solana:localnet'],
      features: ['solana:signMessage', 'solana:signTransaction'],
    },
    {
      address: Identity.bob.address,
      chains: ['solana:localnet'],
      features: ['solana:signMessage', 'solana:signTransaction'],
    },
  ])
  expect(connection.origin).toBe('https://app.example')
  expect(wallet.connections.get('https://app.example')).toBe(connection)
})

test('returns no accounts for a silent connection before authorization', async () => {
  const { environment } = setup()

  await expect(
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [{ silent: true }],
      walletId: 'wallet',
    }),
  ).resolves.toEqual([])
})

test('signs an authorized message with Ed25519', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [],
      walletId: 'wallet',
    }),
  )
  const message = new TextEncoder().encode('Hello Solana')
  const response = environment.dispatch<
    readonly {
      readonly signature: readonly number[]
      readonly signedMessage: readonly number[]
    }[]
  >({
    method: 'solana:signMessage',
    origin: 'https://app.example',
    params: [{ address: Identity.alice.address, message: [...message] }],
    walletId: 'wallet',
  })
  await (await wallet.requests.next('solana:signMessage')).approve()
  const [output] = await response
  expect(output).toBeDefined()
  const signature = Uint8Array.from(output?.signature ?? [])
  expect(signature).toHaveLength(64)

  const publicKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(getBase58Encoder().encode(Identity.alice.address)).buffer,
    'Ed25519',
    false,
    ['verify'],
  )
  await expect(
    crypto.subtle.verify('Ed25519', publicKey, signature.buffer, message.buffer),
  ).resolves.toBe(true)
})

test('signs an authorized wire transaction with Ed25519', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [],
      walletId: 'wallet',
    }),
  )
  const unsignedTransaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayer(Identity.alice.address, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash('11111111111111111111111111111111'),
            lastValidBlockHeight: 100n,
          },
          message,
        ),
    ),
  )
  const transaction = getTransactionEncoder().encode(unsignedTransaction)
  const response = environment.dispatch<
    readonly { readonly signedTransaction: readonly number[] }[]
  >({
    method: 'solana:signTransaction',
    origin: 'https://app.example',
    params: [
      {
        address: Identity.alice.address,
        chain: 'solana:localnet',
        transaction: [...transaction],
      },
    ],
    walletId: 'wallet',
  })
  await (await wallet.requests.next('solana:signTransaction')).approve()
  const [output] = await response
  const signedTransaction = getTransactionDecoder().decode(
    Uint8Array.from(output?.signedTransaction ?? []),
  )
  const signature = signedTransaction.signatures[Identity.alice.address]
  expect(signature).not.toBeNull()

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
      Uint8Array.from(signature ?? []).buffer,
      Uint8Array.from(signedTransaction.messageBytes).buffer,
    ),
  ).resolves.toBe(true)
})

test('rejects signing before the origin is authorized', async () => {
  const { environment } = setup()

  await expect(
    environment.dispatch({
      method: 'solana:signMessage',
      origin: 'https://app.example',
      params: [{ address: Identity.alice.address, message: [1, 2, 3] }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
})

test('surfaces an explicit rejection for a pending signing request', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [],
      walletId: 'wallet',
    }),
  )
  const response = environment.dispatch({
    method: 'solana:signMessage',
    origin: 'https://app.example',
    params: [{ address: Identity.alice.address, message: [1, 2, 3] }],
    walletId: 'wallet',
  })
  const request = await wallet.requests.next('solana:signMessage')

  request.reject({ code: 4001, message: 'User rejected signing' })

  await expect(response).rejects.toMatchObject({
    message: 'User rejected signing',
    providerCode: 4001,
  })
  expect(request.status).toBe('rejected')
})
