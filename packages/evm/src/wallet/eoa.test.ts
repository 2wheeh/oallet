import { Environment } from '@oallet/core'
import { custom, type Hex } from 'viem'
import { anvil, mainnet } from 'viem/chains'
import { expect, test } from 'vitest'

import * as Errors from '../errors/exports.js'
import * as Identity from '../identity/exports.js'
import * as Wallet from './exports.js'

const provider = (blockNumber: Hex) => ({
  async request({ method }: { method: string }) {
    if (method === 'eth_blockNumber') return blockNumber
    throw new Error(`Unexpected RPC method: ${method}`)
  },
})

test('composes an EOA profile and multi-chain runtime into one wallet', async () => {
  const wallet = Wallet.eoa({
    accounts: [Identity.alice, Identity.bob],
    chains: [
      { chain: mainnet, transport: custom(provider('0x2a')) },
      { chain: anvil, transport: custom(provider('0x7a69')) },
    ],
    id: 'wallet',
    name: 'Wallet',
  })
  const environment = Environment.create({ wallets: [wallet] })

  expect(wallet.profile).toMatchObject({
    data: {
      accounts: [Identity.alice, Identity.bob],
      chains: [mainnet.id, anvil.id],
      defaultChainId: mainnet.id,
    },
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Wallet',
  })
  await expect(
    environment.dispatch({
      chainId: `eip155:${anvil.id}`,
      method: 'eth_blockNumber',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
})

test('forwards profile metadata and an explicit default chain', () => {
  const wallet = Wallet.eoa({
    accounts: [Identity.alice],
    chains: [
      { chain: mainnet, transport: custom(provider('0x2a')) },
      { chain: anvil, transport: custom(provider('0x7a69')) },
    ],
    defaultChainId: anvil.id,
    icon: 'data:image/svg+xml,<svg/>',
    id: 'wallet',
    name: 'Wallet',
    rdns: 'io.example.wallet',
  })

  expect(wallet.profile).toMatchObject({
    data: { defaultChainId: anvil.id },
    icon: 'data:image/svg+xml,<svg/>',
    rdns: 'io.example.wallet',
  })
})

test('preserves the runtime duplicate-chain error contract', () => {
  expect(() =>
    Wallet.eoa({
      accounts: [Identity.alice],
      chains: [
        { chain: mainnet, transport: custom(provider('0x2a')) },
        { chain: mainnet, transport: custom(provider('0x2b')) },
      ],
      id: 'wallet',
      name: 'Wallet',
    }),
  ).toThrow(Errors.DuplicateChainError)
})

test('preserves profile validation for an invalid default chain', () => {
  expect(() =>
    Wallet.eoa({
      accounts: [Identity.alice],
      chains: [{ chain: mainnet, transport: custom(provider('0x2a')) }],
      defaultChainId: anvil.id,
      id: 'wallet',
      name: 'Wallet',
    }),
  ).toThrow(Errors.InvalidProfileError)
})
