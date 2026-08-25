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
  const provider = (blockNumber: Hex) => ({
    async request({ method }: { method: string }) {
      if (method === 'eth_blockNumber') return blockNumber
      throw new Error(`Unexpected RPC method: ${method}`)
    },
  })
  const environment = Environment.create({
    wallets: [
      Wallet.create({
        chains: [
          { chain: mainnet, transport: custom(provider('0x2a')) },
          { chain: anvil, transport: custom(provider('0x7a69')) },
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

test('routes a scoped request without changing the active chain', async () => {
  const { environment } = setup()

  await expect(
    environment.dispatch({
      chainId: 'eip155:31337',
      method: 'eth_blockNumber',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x1')
})

test('presents a scoped transaction on its request chain', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'eth_requestAccounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  )
  const response = environment.dispatch({
    chainId: 'eip155:31337',
    method: 'eth_sendTransaction',
    origin: 'https://app.example',
    params: [{ from: Identity.alice.address, to: Identity.bob.address, value: '0x1' }],
    walletId: 'wallet',
  })
  const responseResult = response.catch((error: unknown) => error)
  const request = await wallet.requests.next('eth_sendTransaction')

  try {
    expect(request.chainId).toBe('eip155:31337')
    expect(request.data).toMatchObject({ chainId: anvil.id })
    await expect(
      environment.dispatch({
        method: 'eth_chainId',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    ).resolves.toBe('0x1')
  } finally {
    request.reject()
  }
  expect(await responseResult).toMatchObject({ providerCode: 4001 })
})

test.each(['0x3', '0x4'])(
  'rejects unsupported transaction type %s before requesting approval',
  async (type) => {
    const { environment, wallet } = setup()
    await wallet.autoApprove(() =>
      environment.dispatch({
        method: 'eth_requestAccounts',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    )
    const response = environment.dispatch({
      method: 'eth_sendTransaction',
      origin: 'https://app.example',
      params: [
        {
          from: Identity.alice.address,
          to: Identity.bob.address,
          type,
          value: '0x1',
        },
      ],
      walletId: 'wallet',
    })
    const observed = await Promise.race([
      response.catch((error: unknown) => error),
      wallet.requests.next('eth_sendTransaction'),
    ])

    if (observed instanceof Error) {
      expect(observed).toBeInstanceOf(Errors.InvalidParamsError)
    } else if (isRequestHandle(observed)) {
      observed.reject()
      await expect(response).rejects.toMatchObject({ providerCode: 4001 })
      throw new Error('Unsupported transaction reached the approval queue')
    } else {
      throw new Error('Transaction produced an unknown result')
    }
  },
)

test.each([
  ['numeric type', { type: 2 }],
  ['unsafe nonce', { nonce: '0x20000000000000' }],
  ['malformed sender', { from: '0x1234' }],
  ['malformed recipient', { to: '0x1234' }],
  ['malformed data', { data: 'hello' }],
  ['non-hex quantity', { value: '1' }],
] as const)(
  'rejects a transaction with %s before requesting approval',
  async (_case, invalidFields) => {
    const { environment, wallet } = setup()
    await wallet.autoApprove(() =>
      environment.dispatch({
        method: 'eth_requestAccounts',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    )
    const response = environment.dispatch({
      method: 'eth_sendTransaction',
      origin: 'https://app.example',
      params: [
        {
          from: Identity.alice.address,
          to: Identity.bob.address,
          ...invalidFields,
        },
      ],
      walletId: 'wallet',
    })
    const observed = await Promise.race([
      response.catch((error: unknown) => error),
      wallet.requests.next('eth_sendTransaction'),
    ])

    if (isRequestHandle(observed)) {
      observed.reject()
      await response.catch(() => undefined)
    }
    expect(observed).toBeInstanceOf(Errors.InvalidParamsError)
  },
)

function isRequestHandle(value: unknown): value is { reject(): void } {
  return value !== null && typeof value === 'object' && 'reject' in value
}

test('rejects an unauthorized transaction sender before requesting approval', async () => {
  const { environment, wallet } = setup()
  const connectResponse = environment.dispatch({
    method: 'eth_requestAccounts',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('eth_requestAccounts')).approve()
  await connectResponse
  await connection.setAccounts([Identity.alice])

  await expect(
    environment.dispatch({
      method: 'eth_sendTransaction',
      origin: 'https://app.example',
      params: [{ from: Identity.bob.address, to: Identity.alice.address, value: '0x1' }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
})

test('rejects a transaction chain that conflicts with its request chain', async () => {
  const { environment, wallet } = setup()
  await wallet.autoApprove(() =>
    environment.dispatch({
      method: 'eth_requestAccounts',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  )

  await expect(
    environment.dispatch({
      chainId: 'eip155:1',
      method: 'eth_sendTransaction',
      origin: 'https://app.example',
      params: [
        {
          chainId: '0x7a69',
          from: Identity.alice.address,
          to: Identity.bob.address,
          value: '0x1',
        },
      ],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.ChainNotConfiguredError)
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
