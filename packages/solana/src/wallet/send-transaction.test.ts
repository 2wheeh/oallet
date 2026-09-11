import { Environment, type Json } from '@oallet/core'
import {
  AccountRole,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Encoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'
import { afterEach, expect, test, vi } from 'vitest'

import * as Errors from '../errors/exports.js'
import * as Identity from '../identity/identity.js'
import * as Profile from '../profile/exports.js'
import * as Wallet from './exports.js'

const environments: { dispose(): Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(environments.splice(0).map((environment) => environment.dispose()))
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function rpcBinding(chain: Profile.Chain = 'solana:localnet') {
  let submitted: Transaction | undefined
  const send = vi.fn(async () => {
    if (!submitted) throw new Error('No submitted transaction')
    return getSignatureFromTransaction(submitted)
  })
  const submit = vi.fn((wire: string) => {
    submitted = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    return { send }
  })
  const status = vi.fn(async () => ({
    context: { slot: 1n },
    value: [{ confirmationStatus: 'finalized', err: null }],
  }))
  const getSignatureStatuses = vi.fn(() => ({ send: status }))
  const notification = deferred<{ value: { err: unknown } }>()
  const subscribe = vi.fn(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
    return (async function* () {
      const cancelled = deferred<null>()
      const abort = () => cancelled.resolve(null)
      abortSignal.addEventListener('abort', abort, { once: true })
      try {
        if (abortSignal.aborted) return
        const result = await Promise.race([notification.promise, cancelled.promise])
        if (result) yield result
      } finally {
        abortSignal.removeEventListener('abort', abort)
      }
    })()
  })
  const signatureNotifications = vi.fn(() => ({ subscribe }))
  const binding = {
    chain,
    rpc: { sendTransaction: submit, getSignatureStatuses },
    rpcSubscriptions: { signatureNotifications },
  } as unknown as Wallet.ChainBinding
  return {
    binding,
    getSignatureStatuses,
    notification,
    send,
    signatureNotifications,
    status,
    submit,
    subscribe,
    submitted: () => submitted,
  }
}

function setup(
  options: {
    chains?: readonly Wallet.ChainBinding[]
    transactionTimeoutMs?: number
    profileChains?: readonly Profile.Chain[]
  } = {},
) {
  const rpc = rpcBinding()
  const profile = Profile.keypair({
    accounts: [Identity.alice, Identity.bob],
    chains: options.profileChains ?? ['solana:localnet'],
    id: 'wallet',
    name: 'Wallet',
  })
  const adapter = Wallet.create({
    profile,
    chains: options.chains ?? [rpc.binding],
    ...(options.transactionTimeoutMs === undefined
      ? {}
      : { transactionTimeoutMs: options.transactionTimeoutMs }),
  })
  const environment = Environment.create({ wallets: [adapter] })
  environments.push(environment)
  const wallet = environment.wallet('wallet')
  const connect = () =>
    wallet.autoApprove(() =>
      environment.dispatch({
        method: 'standard:connect',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    )
  const dispatch = (params: Json.Value = [input()], signal?: AbortSignal) =>
    environment.dispatch({
      method: 'solana:signAndSendTransaction',
      origin: 'https://app.example',
      walletId: 'wallet',
      params,
      ...(signal === undefined ? {} : { signal }),
    })
  return { adapter, connect, dispatch, environment, profile, rpc, wallet }
}

function transaction(
  version: 'legacy' | 0 = 'legacy',
  payer = Identity.alice,
  otherSigner?: Identity.Preset,
) {
  const message = pipe(
    createTransactionMessage({ version }),
    (message) => setTransactionMessageFeePayer(payer.address, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash('11111111111111111111111111111111'),
          lastValidBlockHeight: 123n,
        },
        message,
      ),
  )
  return compileTransaction(
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
  )
}

function input(options?: Wallet.SendOptions, tx = transaction()) {
  return {
    address: Identity.alice.address,
    chain: 'solana:localnet',
    transaction: [...getTransactionEncoder().encode(tx)],
    ...(options === undefined ? {} : { options }),
  }
}

test.for(['legacy', 0] as const)(
  'submits a signed %s transaction only after approval and returns signature bytes',
  async (version) => {
    const { connect, dispatch, rpc, wallet } = setup()
    await connect()
    const original = transaction(version)
    const response = dispatch([input(undefined, original)])
    const request = await wallet.requests.next('solana:signAndSendTransaction')
    expect(request.data).toMatchObject({ type: 'signAndSendTransaction', options: [{}] })
    expect(rpc.submit).not.toHaveBeenCalled()
    const output = await request.approve()
    await expect(response).resolves.toEqual(output)
    const signed = rpc.submitted()
    if (!signed) throw new Error('No submitted transaction')
    expect(signed.messageBytes).toEqual(original.messageBytes)
    expect(output).toEqual([
      { signature: [...getBase58Encoder().encode(getSignatureFromTransaction(signed))] },
    ])
    const signer = await Identity.account(Identity.alice)
    await expect(
      crypto.subtle.verify(
        'Ed25519',
        signer.keyPair.publicKey,
        Uint8Array.from(signed.signatures[signer.address] ?? []).buffer,
        Uint8Array.from(signed.messageBytes).buffer,
      ),
    ).resolves.toBe(true)
    expect(rpc.signatureNotifications).not.toHaveBeenCalled()
    expect(rpc.getSignatureStatuses).not.toHaveBeenCalled()
  },
)

test('rejection does not submit or confirm', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  const response = dispatch()
  const failed = expect(response).rejects.toThrow('User declined')
  await (await wallet.requests.next('solana:signAndSendTransaction')).reject(
    new Error('User declined'),
  )
  await failed
  expect(rpc.submit).not.toHaveBeenCalled()
  expect(rpc.subscribe).not.toHaveBeenCalled()
})

test.for(['processed', 'confirmed', 'finalized'] as const)(
  'waits for explicit %s commitment after RPC submission',
  async (commitment) => {
    const { connect, dispatch, rpc, wallet } = setup()
    await connect()
    rpc.status.mockResolvedValue({ context: { slot: 1n }, value: [null] } as never)
    const result = vi.fn()
    const response = wallet
      .autoApprove(() => dispatch([input({ commitment })]))
      .then(result)
    await vi.waitFor(() => expect(rpc.status).toHaveBeenCalled())
    expect(result).not.toHaveBeenCalled()
    expect(rpc.signatureNotifications).toHaveBeenCalledWith(expect.any(String), {
      commitment,
    })
    expect(rpc.submit).toHaveBeenCalledWith(expect.any(String), {
      encoding: 'base64',
      preflightCommitment: commitment,
    })
    rpc.notification.resolve({ value: { err: null } })
    await response
    expect(result).toHaveBeenCalledOnce()
    expect(rpc.subscribe.mock.calls[0]?.[0].abortSignal.aborted).toBe(true)
  },
)

test('forwards all send options and honors explicit preflight commitment independently', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  await wallet.autoApprove(() =>
    dispatch([
      input({
        commitment: 'confirmed',
        preflightCommitment: 'processed',
        minContextSlot: 12,
        maxRetries: 0,
        skipPreflight: true,
      }),
    ]),
  )
  expect(rpc.submit).toHaveBeenCalledWith(expect.any(String), {
    encoding: 'base64',
    preflightCommitment: 'processed',
    minContextSlot: 12n,
    maxRetries: 0n,
    skipPreflight: true,
  })
})

test('preflight commitment alone does not request confirmation', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  await wallet.autoApprove(() =>
    dispatch([input({ preflightCommitment: 'processed', skipPreflight: false })]),
  )
  expect(rpc.submit).toHaveBeenCalledWith(expect.any(String), {
    encoding: 'base64',
    preflightCommitment: 'processed',
    skipPreflight: false,
  })
  expect(rpc.subscribe).not.toHaveBeenCalled()
})

test.for([
  {},
  { chain: 'solana:devnet' },
  { chain: null },
  { chain: '' },
  { chain: 'solana:localnet', options: null },
  ...[
    { commitment: 'invalid' },
    { preflightCommitment: 'invalid' },
    { maxRetries: -1 },
    { maxRetries: 1.5 },
    { minContextSlot: Number.MAX_SAFE_INTEGER + 1 },
    { skipPreflight: 1 },
  ].map((options) => ({ chain: 'solana:localnet', options })),
])('rejects invalid chain/options before submission: %j', async (patch) => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  const { chain: _, ...withoutChain } = input()
  await expect(
    wallet.autoApprove(() => dispatch([{ ...withoutChain, ...patch }])),
  ).rejects.toBeInstanceOf(Errors.InvalidParamsError)
  expect(rpc.submit).not.toHaveBeenCalled()
})

test('validates authorization, signer membership, and disconnected state', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await expect(dispatch()).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  await connect()
  await expect(
    dispatch([{ ...input(), address: Identity.charlie.address }]),
  ).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  await expect(
    dispatch([{ ...input(), address: Identity.bob.address }]),
  ).rejects.toBeInstanceOf(Errors.InvalidParamsError)
  await wallet.connections.get('https://app.example').setAccounts([Identity.bob])
  await expect(dispatch()).rejects.toBeInstanceOf(Errors.UnauthorizedError)
  await wallet.connections.get('https://app.example').disconnect()
  await expect(dispatch()).rejects.toBeInstanceOf(Errors.WalletDisconnectedError)
  expect(rpc.submit).not.toHaveBeenCalled()
})

test('a signing-only wallet retains its features and rejects sending without RPC configuration', async () => {
  const { adapter, connect, dispatch } = setup({ chains: [] })
  expect(adapter.state?.('')).toMatchObject({
    features: ['solana:signMessage', 'solana:signTransaction'],
  })
  await connect()
  await expect(dispatch()).rejects.toBeInstanceOf(Errors.ChainNotConfiguredError)
})

test('advertises sending on both the wallet and authorized accounts', async () => {
  const { adapter, connect } = setup()
  const accounts = await connect()
  expect(adapter.state?.('')).toMatchObject({
    features: expect.arrayContaining(['solana:signAndSendTransaction']),
  })
  expect(accounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        features: expect.arrayContaining(['solana:signAndSendTransaction']),
      }),
    ]),
  )
})

test('requires unique bindings for every configured profile chain', () => {
  const binding = rpcBinding().binding
  expect(() => setup({ chains: [binding, binding] })).toThrow(Errors.InvalidProfileError)
  expect(() =>
    setup({ profileChains: ['solana:localnet', 'solana:devnet'], chains: [binding] }),
  ).toThrow(Errors.ChainNotConfiguredError)
  expect(() => setup({ chains: [rpcBinding('solana:devnet').binding] })).toThrow(
    Errors.InvalidProfileError,
  )
})

test('routes a batch to its requested chains in input order', async () => {
  const local = rpcBinding()
  const devnet = rpcBinding('solana:devnet')
  const { connect, dispatch, wallet } = setup({
    profileChains: ['solana:localnet', 'solana:devnet'],
    chains: [local.binding, devnet.binding],
  })
  await connect()
  await wallet.autoApprove(() =>
    dispatch([input(), { ...input(), chain: 'solana:devnet' }]),
  )
  expect(local.submit).toHaveBeenCalledOnce()
  expect(devnet.submit).toHaveBeenCalledOnce()
  expect(local.submit.mock.invocationCallOrder[0]).toBeLessThan(
    devnet.submit.mock.invocationCallOrder[0] as number,
  )
})

test('preserves existing cosigner signatures and returns the fee-payer signature', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  const bob = await Identity.account(Identity.bob)
  const partial = await partiallySignTransaction(
    [bob.keyPair],
    transaction('legacy', Identity.bob, Identity.alice),
  )
  const result = await wallet.autoApprove(() => dispatch([input(undefined, partial)]))
  expect(rpc.submitted()?.signatures[Identity.bob.address]).toEqual(
    partial.signatures[Identity.bob.address],
  )
  expect(result).toEqual([
    { signature: [...(partial.signatures[Identity.bob.address] ?? [])] },
  ])
})

test('does not submit transactions with missing cosigner signatures', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  await expect(
    wallet.autoApprove(() =>
      dispatch([input(undefined, transaction('legacy', Identity.alice, Identity.bob))]),
    ),
  ).rejects.toBeInstanceOf(Errors.SubmissionError)
  expect(rpc.submit).not.toHaveBeenCalled()
})

test('reports RPC submission failure separately from confirmation failure', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  const failure = new Error('RPC unavailable')
  rpc.send.mockRejectedValueOnce(failure)
  await expect(
    wallet.autoApprove(() => dispatch([input({ commitment: 'confirmed' })])),
  ).rejects.toMatchObject({ code: 'OALLET_SOLANA_SUBMISSION_FAILED', cause: failure })
  expect(rpc.subscribe).not.toHaveBeenCalled()
  rpc.status.mockRejectedValueOnce(failure)
  await expect(
    wallet.autoApprove(() => dispatch([input({ commitment: 'confirmed' })])),
  ).rejects.toMatchObject({ code: 'OALLET_SOLANA_CONFIRMATION_FAILED', cause: failure })
})

test('rejects an on-chain transaction error', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  rpc.status.mockResolvedValueOnce({
    context: { slot: 1n },
    value: [{ confirmationStatus: 'confirmed', err: 'AccountNotFound' }],
  } as never)
  await expect(
    wallet.autoApprove(() => dispatch([input({ commitment: 'confirmed' })])),
  ).rejects.toBeInstanceOf(Errors.ConfirmationError)
})

test('timeout rejects even when the SDK subscription completes normally on abort', async () => {
  const { connect, dispatch, rpc, wallet } = setup({ transactionTimeoutMs: 30 })
  await connect()
  rpc.status.mockResolvedValue({ context: { slot: 1n }, value: [null] } as never)
  await expect(
    wallet.autoApprove(() => dispatch([input({ commitment: 'confirmed' })])),
  ).rejects.toMatchObject({ name: 'TimeoutError' })
  expect(rpc.subscribe.mock.calls[0]?.[0].abortSignal.aborted).toBe(true)
})

test('times out a stalled submission even if the RPC ignores cancellation', async () => {
  const { connect, dispatch, rpc, wallet } = setup({ transactionTimeoutMs: 30 })
  await connect()
  rpc.send.mockImplementationOnce(() => new Promise(() => {}))
  await expect(wallet.autoApprove(() => dispatch())).rejects.toMatchObject({
    name: 'TimeoutError',
  })
})

test('an aborted provider request never succeeds after submission', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  rpc.status.mockResolvedValue({ context: { slot: 1n }, value: [null] } as never)
  const controller = new AbortController()
  const response = dispatch([input({ commitment: 'confirmed' })], controller.signal)
  const failedResponse = expect(response).rejects.toThrow()
  const request = await wallet.requests.next('solana:signAndSendTransaction')
  const approval = request.approve()
  const failedApproval = expect(approval).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(rpc.subscribe).toHaveBeenCalled())
  controller.abort()
  await Promise.all([failedResponse, failedApproval])
  expect(request.status).not.toBe('approved')
})

test('confirmed requests keep waiting when the transaction is only processed', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  rpc.status.mockResolvedValue({
    context: { slot: 1n },
    value: [{ confirmationStatus: 'processed', err: null }],
  })
  const settled = vi.fn()
  const response = wallet
    .autoApprove(() => dispatch([input({ commitment: 'confirmed' })]))
    .then(settled)
  await vi.waitFor(() => expect(rpc.status).toHaveBeenCalled())
  expect(settled).not.toHaveBeenCalled()
  rpc.notification.resolve({ value: { err: null } })
  await response
})

test('validates every transaction in a batch before requesting approval', async () => {
  const { connect, dispatch, rpc } = setup()
  await connect()
  await expect(
    dispatch([input(), { ...input(), transaction: [1] }]),
  ).rejects.toBeInstanceOf(Errors.InvalidParamsError)
  expect(rpc.submit).not.toHaveBeenCalled()
})

test('reports signing failure without submitting', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  const cause = new Error('Signer failed')
  const spy = vi.spyOn(crypto.subtle, 'sign').mockRejectedValueOnce(cause)
  try {
    await expect(wallet.autoApprove(() => dispatch())).rejects.toMatchObject({
      code: 'OALLET_SOLANA_SIGNING_FAILED',
      cause,
    })
    expect(rpc.submit).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})

test('rejects an RPC response naming a different transaction', async () => {
  const { connect, dispatch, rpc, wallet } = setup()
  await connect()
  rpc.send.mockResolvedValueOnce('1'.repeat(64) as never)
  await expect(wallet.autoApprove(() => dispatch())).rejects.toBeInstanceOf(
    Errors.SubmissionError,
  )
})

test.for(['reset', 'dispose'] as const)(
  'cancels pending confirmation on environment %s',
  async (method) => {
    const { connect, dispatch, rpc, wallet, environment } = setup()
    await connect()
    rpc.status.mockResolvedValue({ context: { slot: 1n }, value: [null] } as never)
    const response = dispatch([input({ commitment: 'confirmed' })])
    const failedResponse = expect(response).rejects.toThrow()
    const request = await wallet.requests.next('solana:signAndSendTransaction')
    const failedApproval = expect(request.approve()).rejects.toMatchObject({
      name: 'AbortError',
    })
    await vi.waitFor(() => expect(rpc.subscribe).toHaveBeenCalled())
    await environment[method]()
    await Promise.all([failedResponse, failedApproval])
    expect(request.status).not.toBe('approved')
  },
)

test('cancels pending confirmation when restoring a snapshot', async () => {
  const { connect, dispatch, rpc, wallet, environment } = setup()
  await connect()
  const snapshot = await environment.snapshot()
  rpc.status.mockResolvedValue({ context: { slot: 1n }, value: [null] } as never)
  const response = dispatch([input({ commitment: 'confirmed' })])
  const failedResponse = expect(response).rejects.toThrow()
  const request = await wallet.requests.next('solana:signAndSendTransaction')
  const failedApproval = expect(request.approve()).rejects.toMatchObject({
    name: 'AbortError',
  })
  await vi.waitFor(() => expect(rpc.status).toHaveBeenCalled())
  const subscriptionSignal = rpc.subscribe.mock.calls[0]?.[0].abortSignal
  expect(subscriptionSignal?.aborted).toBe(false)

  await environment.restore(snapshot)

  expect(subscriptionSignal?.aborted).toBe(true)
  await Promise.all([failedResponse, failedApproval])
  expect(request.status).not.toBe('approved')
})
