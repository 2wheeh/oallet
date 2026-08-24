import { Environment } from '@oallet/core'
import { custom, type Hex, recoverMessageAddress } from 'viem'
import { anvil, mainnet } from 'viem/chains'
import { expect, test } from 'vitest'

import * as Errors from '../errors/exports.js'
import * as Identity from '../identity/exports.js'
import * as Profile from '../profile/exports.js'
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
  const environment = Environment.create({
    wallets: [
      Wallet.create({
        chains: [
          { chain: mainnet, transport: custom(provider) },
          { chain: anvil, transport: custom(provider) },
        ],
        profile,
      }),
    ],
  })
  return { environment, wallet: environment.wallet('wallet') }
}

test('returns the approved origin connection while the dapp receives accounts', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://one.example',
    walletId: 'wallet',
  })

  const request = await wallet.requests.next('eth_requestAccounts')
  const connection = await request.approve()

  expect(connection.origin).toBe('https://one.example')
  expect(wallet.connections.get('https://one.example')).toBe(connection)
  await expect(response).resolves.toEqual([Identity.alice.address, Identity.bob.address])
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

  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'eth_requestAccounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  )

  const signature = environment.dispatch<Hex>({
    method: 'personal_sign',
    origin: 'https://app.example',
    params: ['0x68656c6c6f', Identity.alice.address],
    walletId: 'wallet',
  })
  await (await wallet.requests.next('personal_sign')).approve()

  await expect(
    recoverMessageAddress({
      message: { raw: '0x68656c6c6f' },
      signature: await signature,
    }),
  ).resolves.toBe(Identity.alice.address)
})

test('changes the authorized accounts through the approved connection', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await response

  await connection.setAccounts([Identity.bob])

  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toEqual([Identity.bob.address])
  await expect(
    environment.dispatch({
      method: 'personal_sign',
      origin: 'https://app.example',
      params: ['0x68656c6c6f', Identity.alice.address],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
})

test('keeps active chain state scoped to each origin', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'wallet_switchEthereumChain',
      origin: 'https://one.example',
      params: [{ chainId: '0x7a69' }],
      walletId: 'wallet',
    }),
  )

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

test('switches the active chain through the approved connection', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await response

  await connection.switchChain(anvil.id)

  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
})

test('disconnects and reconnects provider access without losing wallet state', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await response
  await connection.setAccounts([Identity.bob])
  await connection.switchChain(anvil.id)

  await connection.disconnect()

  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.ProviderDisconnectedError)

  await connection.reconnect()

  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toEqual([Identity.bob.address])
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
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

test('rejects wallet_addEthereumChain instead of treating it as a switch', async () => {
  const { environment } = setup()

  await expect(
    environment.dispatch({
      method: 'wallet_addEthereumChain',
      origin: 'https://app.example',
      params: [{ chainId: '0x7a69' }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnsupportedMethodError)
})

test('restores connection state without replacing its handle', async () => {
  const { environment, wallet } = setup()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await response
  await connection.setAccounts([Identity.bob])
  await connection.switchChain(anvil.id)
  await connection.disconnect()
  const snapshot = await environment.snapshot()

  await connection.reconnect()
  await connection.setAccounts([Identity.alice])
  await connection.switchChain(mainnet.id)

  await environment.restore(snapshot)

  expect(wallet.connections.get('https://app.example')).toBe(connection)
  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.ProviderDisconnectedError)

  await connection.reconnect()
  await expect(
    environment.dispatch({
      method: 'eth_accounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toEqual([Identity.bob.address])
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
})

test('invalidates handles removed by restore and environment disposal', async () => {
  const { environment, wallet } = setup()
  const empty = await environment.snapshot()
  const response = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await response

  await environment.restore(empty)

  await expect(connection.setAccounts([Identity.bob])).rejects.toBeInstanceOf(
    Errors.StaleConnectionError,
  )

  const nextResponse = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const nextConnection = await (
    await wallet.requests.next('eth_requestAccounts')
  ).approve()
  await nextResponse
  await environment.dispose()

  await expect(nextConnection.setAccounts([Identity.bob])).rejects.toBeInstanceOf(
    Errors.ConnectionDisposedError,
  )
})
