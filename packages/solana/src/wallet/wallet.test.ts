import { Environment } from '@oallet/core'
import {
  AccountRole,
  appendTransactionMessageInstruction,
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
import { expect, test, vi } from 'vitest'

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

test.for([
  { chain: 'solana:localnet', version: 'legacy' },
  { chain: undefined, version: 'legacy' },
  { chain: 'solana:localnet', version: 0 },
  { chain: undefined, version: 0 },
] as const)(
  'signs a $version transaction with chain $chain',
  async ({ chain, version }) => {
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
        createTransactionMessage({ version }),
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
    const [output] = await wallet.autoApprove(() =>
      environment.dispatch<readonly { readonly signedTransaction: readonly number[] }[]>({
        method: 'solana:signTransaction',
        origin: 'https://app.example',
        params: [
          {
            address: Identity.alice.address,
            ...(chain === undefined ? {} : { chain }),
            transaction: [...transaction],
          },
        ],
        walletId: 'wallet',
      }),
    )
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
  },
)

test.for(['solana:devnet', '', null, 1])(
  'rejects an explicitly unsupported or invalid transaction chain: %s',
  async (chain) => {
    const { environment, wallet } = setup()
    await wallet.autoApprove(() =>
      environment.dispatch({
        method: 'standard:connect',
        origin: 'https://app.example',
        params: [],
        walletId: 'wallet',
      }),
    )

    await expect(
      environment.dispatch({
        method: 'solana:signTransaction',
        origin: 'https://app.example',
        params: [{ address: Identity.alice.address, chain, transaction: [1] }],
        walletId: 'wallet',
      }),
    ).rejects.toBeInstanceOf(Errors.InvalidParamsError)
  },
)

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

test.for([
  { name: 'empty bytes', transactions: [[]] },
  { name: 'truncated bytes', transactions: [[1]] },
  {
    name: 'an account that is not a required signer',
    transactions: [transactionBytes(Identity.bob)],
  },
  {
    name: 'an invalid transaction after a valid one',
    transactions: [transactionBytes(), [1]],
  },
])('rejects $name before requesting approval', async ({ transactions }) => {
  const { environment, wallet } = setup()
  await connect(environment, wallet)
  const response = environment.dispatch({
    method: 'solana:signTransaction',
    origin: 'https://app.example',
    walletId: 'wallet',
    params: transactions.map((transaction) => ({
      address: Identity.alice.address,
      transaction,
    })),
  })
  const abort = new AbortController()
  try {
    const observed = await Promise.race([
      response.catch((error: unknown) => error),
      wallet.requests.next('solana:signTransaction', { signal: abort.signal }),
    ])
    if (
      observed &&
      typeof observed === 'object' &&
      'reject' in observed &&
      typeof observed.reject === 'function'
    ) {
      observed.reject()
      await response.catch(() => undefined)
    }
    expect(observed).toBeInstanceOf(Errors.InvalidParamsError)
    expect(observed).toMatchObject({ providerCode: -32602 })
  } finally {
    abort.abort()
  }
})

test('allows another required signer to remain unsigned', async () => {
  const { environment, wallet } = setup()
  await connect(environment, wallet)
  const [output] = await wallet.autoApprove(() =>
    environment.dispatch<readonly { readonly signedTransaction: readonly number[] }[]>({
      method: 'solana:signTransaction',
      origin: 'https://app.example',
      walletId: 'wallet',
      params: [
        {
          address: Identity.alice.address,
          transaction: transactionBytes(Identity.alice, Identity.bob),
        },
      ],
    }),
  )
  const transaction = getTransactionDecoder().decode(
    Uint8Array.from(output?.signedTransaction ?? []),
  )
  expect(transaction.signatures[Identity.bob.address]).toBeNull()
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
      Uint8Array.from(transaction.signatures[Identity.alice.address] ?? []).buffer,
      Uint8Array.from(transaction.messageBytes).buffer,
    ),
  ).resolves.toBe(true)
})

test.for(['solana:signMessage', 'solana:signTransaction'] as const)(
  'wraps cryptographic failures from %s with their cause',
  async (method) => {
    const { environment, wallet } = setup()
    await connect(environment, wallet)
    const cause = new Error('Signing backend failed')
    const sign = vi.spyOn(crypto.subtle, 'sign').mockRejectedValueOnce(cause)
    try {
      await expect(
        wallet.autoApprove(() =>
          environment.dispatch({
            method,
            origin: 'https://app.example',
            walletId: 'wallet',
            params: [
              method === 'solana:signMessage'
                ? { address: Identity.alice.address, message: [1, 2, 3] }
                : { address: Identity.alice.address, transaction: transactionBytes() },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        name: 'Solana.SigningError',
        code: 'OALLET_SOLANA_SIGNING_FAILED',
        cause,
      })
    } finally {
      sign.mockRestore()
    }
  },
)

test.for([true, false])(
  'preserves selected accounts when reconnecting with silent=%s',
  async (silent) => {
    const { environment, wallet } = setup()
    const connection = await connect(environment, wallet)
    await connection.setAccounts([Identity.bob])
    await expect(
      environment.dispatch({
        method: 'standard:disconnect',
        origin: 'https://app.example',
        params: [],
        walletId: 'wallet',
      }),
    ).resolves.toBeNull()
    await expect(
      environment.dispatch({
        method: 'solana:signMessage',
        origin: 'https://app.example',
        walletId: 'wallet',
        params: [{ address: Identity.bob.address, message: [1] }],
      }),
    ).rejects.toBeInstanceOf(Errors.WalletDisconnectedError)
    const events: Environment.ProviderEvent[] = []
    environment[Environment.controller].subscribe((event) => {
      events.push(event)
    })
    const response = environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [{ silent }],
      walletId: 'wallet',
    })
    if (!silent) {
      const request = await wallet.requests.next('standard:connect')
      const accounts = request.data
      const approved = await request.approve()
      await response
      expect(accounts).toMatchObject({ accounts: [Identity.bob.address] })
      expect(approved).toBe(connection)
    }
    await expect(response).resolves.toMatchObject([{ address: Identity.bob.address }])
    expect(events.map((event) => ({ name: event.name, data: event.data }))).toEqual([
      {
        name: 'connect',
        data: expect.arrayContaining([
          expect.objectContaining({ address: Identity.bob.address }),
        ]),
      },
    ])
  },
)

test('isolates authorization, account changes, and disconnects by origin', async () => {
  const { environment, wallet } = setup()
  const first = await connect(environment, wallet, 'https://one.example')
  await expect(
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://two.example',
      params: [{ silent: true }],
      walletId: 'wallet',
    }),
  ).resolves.toEqual([])
  await expect(
    environment.dispatch({
      method: 'solana:signMessage',
      origin: 'https://two.example',
      params: [{ address: Identity.alice.address, message: [1] }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  const second = await connect(environment, wallet, 'https://two.example')
  const events: Environment.ProviderEvent[] = []
  environment[Environment.controller].subscribe((event) => {
    events.push(event)
  })
  await first.setAccounts([Identity.bob])
  await expect(
    environment.dispatch({
      method: 'solana:signMessage',
      origin: 'https://one.example',
      params: [{ address: Identity.alice.address, message: [1] }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  await expect(
    wallet.autoApprove(() =>
      environment.dispatch({
        method: 'solana:signMessage',
        origin: 'https://two.example',
        params: [{ address: Identity.alice.address, message: [1] }],
        walletId: 'wallet',
      }),
    ),
  ).resolves.toHaveLength(1)
  await first.disconnect()
  await expect(
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://two.example',
      params: [{ silent: true }],
      walletId: 'wallet',
    }),
  ).resolves.toMatchObject([
    { address: Identity.alice.address },
    { address: Identity.bob.address },
  ])
  expect(wallet.connections.get('https://two.example')).toBe(second)
  expect(events.map((event) => [event.origin, event.name])).toEqual([
    ['https://one.example', 'accountsChanged'],
    ['https://one.example', 'disconnect'],
  ])
})

test('restores selected accounts and disconnected state without replacing the handle', async () => {
  const { environment, wallet } = setup()
  const connection = await connect(environment, wallet)
  await connection.setAccounts([Identity.bob])
  await connection.disconnect()
  const snapshot = await environment.snapshot()
  await connection.reconnect()
  await connection.setAccounts([Identity.alice])
  await environment.restore(snapshot)
  expect(wallet.connections.get('https://app.example')).toBe(connection)
  await expect(
    environment.dispatch({
      method: 'solana:signMessage',
      origin: 'https://app.example',
      params: [{ address: Identity.bob.address, message: [1] }],
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Errors.WalletDisconnectedError)
  await connection.reconnect()
  await expect(
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://app.example',
      params: [],
      walletId: 'wallet',
    }),
  ).resolves.toMatchObject([{ address: Identity.bob.address }])
})

test('invalidates removed handles after restore and live handles after disposal', async () => {
  const { environment, wallet } = setup()
  const empty = await environment.snapshot()
  const connection = await connect(environment, wallet)
  await environment.restore(empty)
  await expect(connection.setAccounts([Identity.bob])).rejects.toBeInstanceOf(
    Errors.StaleConnectionError,
  )
  expect(() => wallet.connections.get('https://app.example')).toThrow(
    Errors.ConnectionNotFoundError,
  )
  const replacement = await connect(environment, wallet)
  expect(replacement.id).not.toBe(connection.id)
  await environment.dispose()
  await expect(replacement.reconnect()).rejects.toBeInstanceOf(
    Errors.ConnectionDisposedError,
  )
  expect(() => wallet.connections.get('https://app.example')).toThrow(
    Errors.ConnectionDisposedError,
  )
})

test('reset removes authorization for every origin and permits a fresh approval', async () => {
  const { environment, wallet } = setup()
  const first = await connect(environment, wallet, 'https://one.example')
  const second = await connect(environment, wallet, 'https://two.example')
  await first.setAccounts([Identity.bob])
  await second.disconnect()
  await environment.reset()
  for (const origin of ['https://one.example', 'https://two.example']) {
    await expect(
      environment.dispatch({
        method: 'standard:connect',
        origin,
        params: [{ silent: true }],
        walletId: 'wallet',
      }),
    ).resolves.toEqual([])
    await expect(
      environment.dispatch({
        method: 'solana:signMessage',
        origin,
        params: [{ address: Identity.bob.address, message: [1] }],
        walletId: 'wallet',
      }),
    ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  }
  expect(await connect(environment, wallet, 'https://one.example')).toBe(first)
  await expect(
    environment.dispatch({
      method: 'standard:connect',
      origin: 'https://one.example',
      params: [],
      walletId: 'wallet',
    }),
  ).resolves.toMatchObject([
    { address: Identity.alice.address },
    { address: Identity.bob.address },
  ])
})

async function connect(
  environment: ReturnType<typeof setup>['environment'],
  wallet: ReturnType<typeof setup>['wallet'],
  origin = 'https://app.example',
) {
  const response = environment.dispatch({
    method: 'standard:connect',
    origin,
    params: [],
    walletId: 'wallet',
  })
  const connection = await (await wallet.requests.next('standard:connect')).approve()
  await response
  return connection
}

function transactionBytes(payer = Identity.alice, otherSigner?: Identity.Preset) {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (message) => setTransactionMessageFeePayer(payer.address, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash('11111111111111111111111111111111'),
          lastValidBlockHeight: 100n,
        },
        message,
      ),
  )
  return [
    ...getTransactionEncoder().encode(
      compileTransaction(
        otherSigner
          ? appendTransactionMessageInstruction(
              {
                programAddress: Identity.charlie.address,
                accounts: [
                  { address: otherSigner.address, role: AccountRole.READONLY_SIGNER },
                ],
              },
              message,
            )
          : message,
      ),
    ),
  ]
}
