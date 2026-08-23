import { Environment } from '@oallet/core'
import { custom, type Hex, recoverMessageAddress } from 'viem'
import { anvil, mainnet } from 'viem/chains'
import { expect, test } from 'vitest'

import * as Errors from '../errors/exports.js'
import * as Identity from '../identity/exports.js'
import * as Profile from '../profile/exports.js'
import * as Runtime from '../runtime/exports.js'
import * as Wallet from './exports.js'

function setup() {
  const profile = Profile.eoa({
    accounts: [Identity.alice, Identity.bob],
    chains: [mainnet.id, anvil.id],
    id: 'wallet',
    name: 'Wallet',
  })
  const provider = {
    async request({ method }: { method: string }) {
      if (method === 'eth_blockNumber') return '0x2a'
      throw new Error(`Unexpected RPC method: ${method}`)
    },
  }
  const runtime = Runtime.create({
    chains: [
      { chain: mainnet, transport: custom(provider) },
      { chain: anvil, transport: custom(provider) },
    ],
  })
  const environment = Environment.create({
    wallets: [Wallet.create({ profile, runtime })],
  })
  return { environment, wallet: environment.wallet('wallet') }
}

test('authorizes accounts manually and scopes connections by origin', async () => {
  const { environment, wallet } = setup()
  const connection = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://one.example',
    walletId: 'wallet',
  })

  await (await wallet.requests.next()).approve()

  await expect(connection).resolves.toEqual([
    Identity.alice.address,
    Identity.bob.address,
  ])
  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://one.example',
      walletId: 'wallet',
    }),
  ).resolves.toEqual([Identity.alice.address, Identity.bob.address])
  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://two.example',
      walletId: 'wallet',
    }),
  ).resolves.toEqual([])
})

test('signs personal messages only after authorization', async () => {
  const { environment, wallet } = setup()
  await expect(
    environment.dispatch({
      method: 'personal_sign',
      origin: 'https://app.example',
      params: ['0x68656c6c6f', Identity.alice.address],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)

  const stop = wallet.startAutoApprove()
  await environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  stop()

  const signature = environment.dispatch<Hex>({
    method: 'personal_sign',
    origin: 'https://app.example',
    params: ['0x68656c6c6f', Identity.alice.address],
    walletId: 'wallet',
  })
  await (await wallet.requests.next()).approve()

  await expect(
    recoverMessageAddress({
      message: { raw: '0x68656c6c6f' },
      signature: await signature,
    }),
  ).resolves.toBe(Identity.alice.address)
})

test('keeps active chain state scoped to each origin', async () => {
  const { environment, wallet } = setup()
  const stop = wallet.startAutoApprove()
  await environment.dispatch({
    method: 'wallet_switchEthereumChain',
    origin: 'https://one.example',
    params: [{ chainId: '0x7a69' }],
    walletId: 'wallet',
  })
  stop()

  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://one.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://two.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x1')
})

test('proxies allowlisted reads and rejects unknown methods', async () => {
  const { environment } = setup()

  await expect(
    environment.dispatch({
      method: 'eth_blockNumber',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x2a')
  await expect(
    environment.dispatch({
      method: 'anvil_setBalance',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnsupportedMethodError)
})
