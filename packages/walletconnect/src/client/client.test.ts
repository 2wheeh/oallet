import { EventEmitter } from 'node:events'
import { Environment, Profile, type Wallet } from '@oallet/core'
import { expect, test, vi } from 'vitest'

import { PairingTimeoutError } from '../errors/errors.js'
import { create, createWithPeer, type Peer } from './create.js'

test('constructs pairing timeouts from explicit stage options', () => {
  const cause = new Error('relay stalled')
  const error = new PairingTimeoutError('Pairing timed out', {
    cause,
    stage: 'pairing',
  })

  expect(error).toMatchObject({
    cause,
    code: 'OALLET_WC_PAIRING_TIMEOUT',
    stage: 'pairing',
  })
})

function setup(lifecycle: Parameters<typeof createWithPeer>[2] = {}) {
  let emitProviderEvent: Wallet.AdapterContext['emit'] = async () => undefined
  let activeChainId = '0x1'
  const approveConnection = vi.fn(async (_origin: string) => [
    '0x0000000000000000000000000000000000000001',
  ])
  const profile = Profile.define({
    data: {
      accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
      chains: [1, 31337],
      defaultChainId: 1,
    },
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Wallet',
  })
  const adapter: Wallet.Adapter = {
    bind(context) {
      emitProviderEvent = context.emit
    },
    profile,
    prepare(input) {
      if (input.method === 'eth_requestAccounts') {
        return {
          type: 'interactive',
          approve: () => approveConnection(input.origin),
          data: { type: 'connect' },
        }
      }
      if (input.method === 'eth_chainId') {
        return { type: 'return', value: activeChainId }
      }
      if (input.method === 'wallet_switchEthereumChain') {
        return {
          type: 'interactive',
          approve: async () => {
            const chainId = (input.params as [{ chainId: string }])[0].chainId
            activeChainId = chainId
            await emitProviderEvent({
              data: chainId,
              name: 'chainChanged',
              origin: input.origin,
            })
            return null
          },
          data: { type: 'switchChain' },
        }
      }
      return {
        type: 'interactive',
        approve: () => '0xsigned',
        data: {
          ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
          type: 'sign',
        },
      }
    },
    reset() {},
    restore() {},
    snapshot: () => null,
    validateSnapshot() {},
  }
  const environment = Environment.create({ wallets: [adapter] })
  const events = new EventEmitter()
  const approveSession = vi.fn(async (input: { id: number; namespaces: unknown }) =>
    approvedSession(input.namespaces),
  )
  const respondSessionRequest = vi.fn(async (): Promise<void> => undefined)
  const emitSessionEvent = vi.fn(async () => undefined)
  const peer = {
    approveSession,
    disconnectSession: vi.fn(async () => undefined),
    emitSessionEvent,
    getActiveSessions: () => ({}),
    off: events.off.bind(events),
    on: events.on.bind(events),
    pair: vi.fn(async () => undefined),
    rejectSession: vi.fn(async () => undefined),
    respondSessionRequest,
  } as unknown as Peer
  const client = createWithPeer(
    { environment, projectId: 'test-project', walletId: 'wallet' },
    peer,
    lifecycle,
  )
  return {
    approveConnection,
    approveSession,
    client,
    emitProviderEvent,
    emitSessionEvent,
    environment,
    events,
    peer,
    respondSessionRequest,
  }
}

test('does not publish the initial account connection before the session is ready', async () => {
  const { approveConnection, client, emitProviderEvent, emitSessionEvent, events } =
    setup()
  approveConnection.mockImplementationOnce(async (origin) => {
    await emitProviderEvent({
      data: ['0x0000000000000000000000000000000000000001'],
      name: 'accountsChanged',
      origin,
    })
    return ['0x0000000000000000000000000000000000000001']
  })
  emitSessionEvent.mockRejectedValueOnce(new Error('session is not ready'))
  const pairing = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())

  await expect((await pairing).approve()).resolves.toBeDefined()
  expect(emitSessionEvent).not.toHaveBeenCalled()
})

function approvedSession(namespaces: unknown) {
  return {
    acknowledged: true,
    controller: 'controller',
    expiry: Date.now() + 60_000,
    namespaces,
    pairingTopic: 'pairing',
    peer: {
      metadata: {
        description: 'dApp',
        icons: [],
        name: 'dApp',
        url: 'https://app.example',
      },
      publicKey: 'peer',
    },
    relay: { protocol: 'irn' },
    requiredNamespaces: {},
    optionalNamespaces: {},
    self: {
      metadata: {
        description: 'Oallet',
        icons: [],
        name: 'Oallet',
        url: 'https://oallet.dev',
      },
      publicKey: 'self',
    },
    topic: 'session-topic',
  }
}

test('pairs directly and strictly intersects proposal namespaces', async () => {
  const { approveSession, client, events, peer } = setup()
  const proposalPromise = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())
  const sessionProposal = await proposalPromise

  expect(sessionProposal.requiredNamespaces.eip155?.methods).toEqual(['personal_sign'])
  const session = await sessionProposal.approve()

  expect(peer.pair).toHaveBeenCalledWith({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  expect(approveSession.mock.calls[0]?.[0].namespaces).toEqual({
    eip155: {
      accounts: ['eip155:1:0x0000000000000000000000000000000000000001'],
      chains: ['eip155:1'],
      events: ['accountsChanged'],
      methods: ['personal_sign', 'eth_sendTransaction'],
    },
  })
  expect(session.namespaces.eip155?.accounts).toEqual([
    'eip155:1:0x0000000000000000000000000000000000000001',
  ])
})

test('routes session requests through the wallet approval queue', async () => {
  const { client, environment, events, respondSessionRequest } = setup()
  const proposalPromise = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())
  await (await proposalPromise).approve()

  events.emit('session_request', {
    id: 42,
    params: {
      chainId: 'eip155:1',
      request: {
        method: 'personal_sign',
        params: ['0x6869', '0x0000000000000000000000000000000000000001'],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
  const request = await environment.wallet('wallet').requests.next('personal_sign')
  expect(request.origin).toMatch(/^walletconnect:\/\/[0-9a-f-]+$/)
  await request.approve()

  await vi.waitFor(() => {
    expect(respondSessionRequest).toHaveBeenCalledWith({
      response: { id: 42, jsonrpc: '2.0', result: '0xsigned' },
      topic: 'session-topic',
    })
  })
})

test('routes an approved chain request without changing the active chain', async () => {
  const { client, emitSessionEvent, environment, events } = setup()
  const pairing = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit(
    'session_proposal',
    proposal({
      optionalChain: 'eip155:31337',
      optionalEvents: ['chainChanged'],
      optionalMethods: ['wallet_switchEthereumChain'],
    }),
  )
  await (await pairing).approve()

  events.emit('session_request', {
    id: 46,
    params: {
      chainId: 'eip155:31337',
      request: {
        method: 'personal_sign',
        params: ['0x6869', '0x0000000000000000000000000000000000000001'],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
  const request = await environment.wallet('wallet').requests.next('personal_sign')

  expect(request.chainId).toBe('eip155:31337')
  expect(request.data).toEqual({ chainId: 'eip155:31337', type: 'sign' })
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: request.origin,
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x1')
  expect(emitSessionEvent).not.toHaveBeenCalled()
  request.reject()
})

test('preserves provider errors when rejecting a session request', async () => {
  const { client, environment, events, respondSessionRequest } = setup()
  const pairing = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())
  await (await pairing).approve()

  events.emit('session_request', {
    id: 44,
    params: {
      chainId: 'eip155:1',
      request: {
        method: 'personal_sign',
        params: ['0x6869', '0x0000000000000000000000000000000000000001'],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
  const request = await environment.wallet('wallet').requests.next('personal_sign')
  request.reject({
    code: 4001,
    data: { reason: 'denied in wallet' },
    message: 'User rejected the request',
  })

  await vi.waitFor(() => {
    expect(respondSessionRequest).toHaveBeenCalledWith({
      response: {
        error: {
          code: 4001,
          data: { reason: 'denied in wallet' },
          message: 'User rejected the request',
        },
        id: 44,
        jsonrpc: '2.0',
      },
      topic: 'session-topic',
    })
  })
})

test('cancels pending requests when the peer deletes the session', async () => {
  const { client, environment, events, respondSessionRequest } = setup()
  const pairing = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())
  await (await pairing).approve()

  events.emit('session_request', {
    id: 45,
    params: {
      chainId: 'eip155:1',
      request: {
        method: 'personal_sign',
        params: ['0x6869', '0x0000000000000000000000000000000000000001'],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
  const request = await environment.wallet('wallet').requests.next('personal_sign')

  events.emit('session_delete', { topic: 'session-topic' })

  expect(request.status).toBe('cancelled')
  await expect(request.approve()).rejects.toMatchObject({
    code: 'OALLET_ENVIRONMENT_REQUEST_EXPIRED',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(respondSessionRequest).not.toHaveBeenCalled()
  expect(environment.trace.events).toContainEqual(
    expect.objectContaining({
      type: 'walletconnect.request.cancelled',
      rpcRequestId: 45,
    }),
  )
})

test('forwards wallet chain changes to the matching WalletConnect session', async () => {
  const { client, emitSessionEvent, environment, events } = setup()
  const proposalPromise = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit(
    'session_proposal',
    proposal({ optionalChain: 'eip155:31337', optionalEvents: ['chainChanged'] }),
  )
  await (await proposalPromise).approve()

  events.emit('session_request', {
    id: 43,
    params: {
      chainId: 'eip155:1',
      request: {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x7a69' }],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
  const request = await environment
    .wallet('wallet')
    .requests.next('wallet_switchEthereumChain')
  expect(request.chainId).toBe('eip155:1')
  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: request.origin,
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x1')
  await request.approve()

  await expect(
    environment.dispatch({
      method: 'eth_chainId',
      origin: request.origin,
      walletId: 'wallet',
    }),
  ).resolves.toBe('0x7a69')

  await vi.waitFor(() => {
    expect(emitSessionEvent).toHaveBeenCalledWith({
      chainId: 'eip155:31337',
      event: { data: '0x7a69', name: 'chainChanged' },
      topic: 'session-topic',
    })
  })
})

function proposal(
  options: {
    id?: number
    optionalChain?: string
    optionalEvents?: string[]
    optionalMethods?: string[]
    pairingTopic?: string
  } = {},
) {
  const id = options.id ?? 1
  return {
    id,
    params: {
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      id,
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:1', options.optionalChain ?? 'eip155:10'],
          events: options.optionalEvents ?? ['accountsChanged', 'unsupportedEvent'],
          methods: options.optionalMethods ?? [
            'eth_sendTransaction',
            'unsupported_method',
          ],
        },
      },
      pairingTopic: options.pairingTopic ?? 'pairing',
      proposer: {
        metadata: {
          description: 'dApp',
          icons: [],
          name: 'dApp',
          url: 'https://app.example',
        },
        publicKey: 'peer',
      },
      relays: [{ protocol: 'irn' }],
      requiredNamespaces: {
        eip155: {
          chains: ['eip155:1'],
          events: ['accountsChanged'],
          methods: ['personal_sign'],
        },
      },
    },
    verifyContext: {},
  }
}

test('requires an explicit WalletConnect project id before initializing Reown', async () => {
  const { environment } = setup()

  await expect(
    create({ environment, projectId: ' ', walletId: 'wallet' }),
  ).rejects.toMatchObject({
    code: 'OALLET_WC_PROJECT_ID_REQUIRED',
  })
})

test('allows only one active pairing and becomes ready after a timeout', async () => {
  const { client, events } = setup()
  const first = client.pair({
    timeout: 1,
    uri: 'wc:first@2?relay-protocol=irn&symKey=secret',
  })

  expect(() =>
    client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' }),
  ).toThrowError(expect.objectContaining({ code: 'OALLET_WC_PAIRING_IN_PROGRESS' }))
  await expect(first).rejects.toMatchObject({
    code: 'OALLET_WC_PAIRING_TIMEOUT',
    stage: 'proposal',
  })

  const second = client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ pairingTopic: 'first' }))
  events.emit('session_proposal', proposal({ pairingTopic: 'second' }))
  await expect(second).resolves.toBeDefined()
})

test('wraps a pairing start failure with a stable stage and error code', async () => {
  const { client, environment, peer } = setup()
  const cause = new Error('relay unavailable')
  vi.mocked(peer.pair).mockRejectedValueOnce(cause)

  await expect(
    client.pair({ uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret' }),
  ).rejects.toMatchObject({
    cause,
    code: 'OALLET_WC_PAIRING_START_FAILED',
    stage: 'pairing',
  })
  expect(environment.trace.events.at(-1)).toMatchObject({
    reason: 'error',
    stage: 'pairing',
    type: 'walletconnect.pairing.failed',
  })
})

test('reset cancels an active pairing and leaves the client reusable', async () => {
  const { client, events } = setup()
  const pairing = client.pair({ uri: 'wc:first@2?relay-protocol=irn&symKey=secret' })
  const pairingResult = expect(pairing).rejects.toMatchObject({
    code: 'OALLET_WC_PAIRING_RESET',
  })

  await client.reset()
  await pairingResult

  const next = client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ pairingTopic: 'second' }))
  await expect(next).resolves.toBeDefined()
})

test('proposal handles are single-use and reset invalidates unsettled proposals', async () => {
  const { client, events } = setup()
  const first = client.pair({ uri: 'wc:first@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ pairingTopic: 'first' }))
  const approved = await first
  await approved.reject()
  await expect(approved.reject()).rejects.toMatchObject({
    code: 'OALLET_WC_PROPOSAL_SETTLED',
  })

  const second = client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ id: 2, pairingTopic: 'second' }))
  const stale = await second
  await client.reset()
  await expect(stale.approve()).rejects.toMatchObject({
    code: 'OALLET_WC_PROPOSAL_SETTLED',
  })
})

test('session disconnect and client dispose are idempotent', async () => {
  const { client, events, peer } = setup()
  const pairing = client.pair({ uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal())
  const session = await (await pairing).approve()

  const disconnect = session.disconnect()
  expect(session.disconnect()).toBe(disconnect)
  await disconnect
  expect(peer.disconnectSession).toHaveBeenCalledTimes(1)

  const disposal = client.dispose()
  expect(client.dispose()).toBe(disposal)
  await disposal
  expect(() =>
    client.pair({ uri: 'wc:again@2?relay-protocol=irn&symKey=secret' }),
  ).toThrowError(expect.objectContaining({ code: 'OALLET_WC_CLIENT_DISPOSED' }))
})

test('disconnects an approved peer session when wallet connection fails', async () => {
  const { approveConnection, client, events, peer } = setup()
  approveConnection.mockRejectedValueOnce(new Error('wallet connection failed'))
  const pairing = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal())

  await expect((await pairing).approve()).rejects.toThrow('wallet connection failed')
  expect(peer.disconnectSession).toHaveBeenCalledWith({
    reason: expect.objectContaining({ code: 6000 }),
    topic: 'session-topic',
  })

  await client.dispose()
  expect(peer.disconnectSession).toHaveBeenCalledTimes(1)
})

test('records stable WalletConnect events without raw topics or URIs', async () => {
  const { client, environment, events } = setup()
  const pairing = client.pair({
    uri: 'wc:secret-topic@2?relay-protocol=irn&symKey=secret',
  })
  events.emit('session_proposal', proposal({ pairingTopic: 'secret-topic' }))
  const session = await (await pairing).approve()
  await session.disconnect()
  await client.dispose()

  const walletConnectEvents = environment.trace.events.filter((event) =>
    event.type.startsWith('walletconnect.'),
  )
  expect(walletConnectEvents.map((event) => event.type)).toEqual([
    'walletconnect.pairing.started',
    'walletconnect.proposal.received',
    'walletconnect.proposal.approved',
    'walletconnect.session.disconnecting',
    'walletconnect.session.disconnected',
    'walletconnect.client.disposed',
  ])
  expect(JSON.stringify(walletConnectEvents)).not.toContain('secret-topic')
  expect(JSON.stringify(walletConnectEvents)).not.toContain('symKey')
})

test('keeps the public handles minimal', async () => {
  const { client, events } = setup()
  expect(Object.keys(client).sort()).toEqual(['dispose', 'pair', 'reset'])

  const pairing = client.pair({ uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal())
  const sessionProposal = await pairing
  expect(Object.keys(sessionProposal).sort()).toEqual([
    'approve',
    'optionalNamespaces',
    'reject',
    'requiredNamespaces',
  ])

  const session = await sessionProposal.approve()
  expect(Object.keys(session).sort()).toEqual(['disconnect', 'namespaces'])
})

test('reset is best-effort, commits local cleanup, and reports all failures', async () => {
  const { client, events, peer } = setup()
  const first = client.pair({ uri: 'wc:first@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ pairingTopic: 'first' }))
  await (await first).approve()

  const second = client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ id: 2, pairingTopic: 'second' }))
  const stale = await second
  vi.mocked(peer.disconnectSession).mockRejectedValueOnce(new Error('disconnect failed'))
  vi.mocked(peer.rejectSession).mockRejectedValueOnce(new Error('reject failed'))

  const error = await client.reset().catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).errors).toHaveLength(2)
  await expect(stale.reject()).rejects.toMatchObject({
    code: 'OALLET_WC_PROPOSAL_SETTLED',
  })

  const third = client.pair({ uri: 'wc:third@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ id: 3, pairingTopic: 'third' }))
  await (await third).reject()
})

test('await using disposes the test-scoped client', async () => {
  const { client, events } = setup()
  expect(events.listenerCount('session_request')).toBe(1)

  {
    await using resource = client
    expect(resource).toBe(client)
  }

  expect(events.listenerCount('session_request')).toBe(0)
  expect(() =>
    client.pair({ uri: 'wc:again@2?relay-protocol=irn&symKey=secret' }),
  ).toThrowError(expect.objectContaining({ code: 'OALLET_WC_CLIENT_DISPOSED' }))
})

test('accepts explicit supported namespaces at the approval boundary', async () => {
  const { approveSession, client, events } = setup()
  const pairing = client.pair({ uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal())
  const sessionProposal = await pairing

  await sessionProposal.approve({
    namespaces: {
      eip155: {
        accounts: ['eip155:1:0x0000000000000000000000000000000000000001'],
        chains: ['eip155:1'],
        events: ['accountsChanged'],
        methods: ['personal_sign'],
      },
    },
  })

  expect(approveSession.mock.calls[0]?.[0].namespaces).toEqual({
    eip155: {
      accounts: ['eip155:1:0x0000000000000000000000000000000000000001'],
      chains: ['eip155:1'],
      events: ['accountsChanged'],
      methods: ['personal_sign'],
    },
  })
})

test('dispose cancels active work and makes every handle terminal', async () => {
  const { client, events } = setup()
  const pairing = client.pair({ uri: 'wc:pending@2?relay-protocol=irn&symKey=secret' })
  const pairingResult = expect(pairing).rejects.toMatchObject({
    code: 'OALLET_WC_CLIENT_DISPOSED',
  })

  await client.dispose()
  await pairingResult
  expect(events.listenerCount('session_proposal')).toBe(0)
  await expect(client.reset()).rejects.toMatchObject({
    code: 'OALLET_WC_CLIENT_DISPOSED',
  })
})

test('dispose waits for an in-flight approval and disconnects its late session', async () => {
  const { approveSession, client, events, peer } = setup()
  let finishApproval: (() => void) | undefined
  approveSession.mockImplementationOnce(
    (input: { id: number; namespaces: unknown }) =>
      new Promise((resolve) => {
        finishApproval = () => resolve(approvedSession(input.namespaces))
      }),
  )
  const pairing = client.pair({ uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal())
  const approval = (await pairing).approve()

  const disposal = client.dispose()
  finishApproval?.()
  await Promise.all([approval, disposal])

  expect(peer.disconnectSession).toHaveBeenCalledTimes(1)
})

test('reports a hung pairing cleanup separately before allowing another pairing', async () => {
  vi.useFakeTimers()
  try {
    const { client, environment, events, peer } = setup()
    vi.mocked(peer.pair).mockImplementationOnce(() => new Promise(() => undefined))
    const pairing = client.pair({
      timeout: 1,
      uri: 'wc:hung@2?relay-protocol=irn&symKey=secret',
    })
    const pairingResult = pairing.catch((cause: unknown) => cause)

    await vi.advanceTimersByTimeAsync(5_001)
    const error = await pairingResult
    expect(error).toMatchObject({
      code: 'OALLET_WC_PAIRING_CLEANUP_FAILED',
      stage: 'cleanup',
    })
    expect(environment.trace.events.at(-1)).toMatchObject({
      reason: 'timeout',
      stage: 'cleanup',
      type: 'walletconnect.pairing.failed',
    })

    const next = client.pair({ uri: 'wc:next@2?relay-protocol=irn&symKey=secret' })
    events.emit('session_proposal', proposal({ pairingTopic: 'next' }))
    await expect(next).resolves.toBeDefined()
  } finally {
    vi.useRealTimers()
  }
})

test('reserves disposal time even when peer cleanup hangs', async () => {
  vi.useFakeTimers()
  try {
    const disposeResource = vi.fn(async () => undefined)
    const { client, events, peer } = setup({ dispose: disposeResource })
    const pairing = client.pair({
      uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
    })
    events.emit('session_proposal', proposal())
    await (await pairing).approve()
    vi.mocked(peer.disconnectSession).mockImplementationOnce(
      () => new Promise(() => undefined),
    )

    const disposal = client.dispose()
    const disposalResult = disposal.catch((cause: unknown) => cause)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(disposeResource).toHaveBeenCalledTimes(1)
    expect(await disposalResult).toBeInstanceOf(AggregateError)
  } finally {
    vi.useRealTimers()
  }
})

async function connect(context: ReturnType<typeof setup>) {
  const pairing = context.client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
  })
  context.events.emit('session_proposal', proposal())
  return (await pairing).approve()
}

function receiveRequest(context: ReturnType<typeof setup>, id = 42) {
  context.events.emit('session_request', {
    id,
    params: {
      chainId: 'eip155:1',
      request: {
        method: 'personal_sign',
        params: ['0x6869', '0x0000000000000000000000000000000000000001'],
      },
    },
    topic: 'session-topic',
    verifyContext: {},
  })
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('reports disconnect completion only after the peer call and allows retry after failure', async () => {
  const context = setup()
  const session = await connect(context)
  const pending = deferred()
  vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)

  const first = session.disconnect()
  expect(session.disconnect()).toBe(first)
  expect(context.environment.trace.events.at(-1)?.type).toBe(
    'walletconnect.session.disconnecting',
  )
  const failure = expect(first).rejects.toThrow('relay failed')
  pending.reject(new Error('relay failed'))
  await failure
  expect(context.environment.trace.events.at(-1)?.type).toBe(
    'walletconnect.session.disconnectFailed',
  )

  const retry = session.disconnect()
  expect(retry).not.toBe(first)
  expect(session.disconnect()).toBe(retry)
  await retry
  expect(context.peer.disconnectSession).toHaveBeenCalledTimes(2)
  expect(context.environment.trace.events.at(-1)?.type).toBe(
    'walletconnect.session.disconnected',
  )
  await context.client.dispose()
  expect(context.peer.disconnectSession).toHaveBeenCalledTimes(2)
})

test.each(['reset', 'dispose'] as const)(
  'retries a failed session disconnect during %s',
  async (operation) => {
    const context = setup()
    const session = await connect(context)
    vi.mocked(context.peer.disconnectSession).mockRejectedValueOnce(
      new Error('relay failed'),
    )
    await expect(session.disconnect()).rejects.toThrow('relay failed')

    await context.client[operation]()
    expect(context.peer.disconnectSession).toHaveBeenCalledTimes(2)
    expect(context.environment.trace.events).toContainEqual(
      expect.objectContaining({
        type: 'walletconnect.session.disconnected',
        reason: operation,
      }),
    )
    await context.client.dispose()
  },
)

test.each(['reset', 'dispose'] as const)(
  '%s retries a disconnect that fails while cleanup is waiting',
  async (operation) => {
    const context = setup()
    const session = await connect(context)
    const pending = deferred()
    vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
    const disconnect = session.disconnect()
    const originalFailure = expect(disconnect).rejects.toThrow('original attempt failed')
    const cleanup = context.client[operation]()
    const cleanupResult = cleanup.catch((error: unknown) => error)

    pending.reject(new Error('original attempt failed'))

    await originalFailure
    expect(await cleanupResult).toBeUndefined()
    expect(context.peer.disconnectSession).toHaveBeenCalledTimes(2)
    expect(context.environment.trace.events).toContainEqual(
      expect.objectContaining({
        type: 'walletconnect.session.disconnected',
        reason: operation,
      }),
    )
    await context.client.dispose()
  },
)

test.each(['reset', 'dispose'] as const)(
  '%s does not retry an existing disconnect after its cleanup deadline',
  async (operation) => {
    vi.useFakeTimers()
    try {
      const context = setup()
      const session = await connect(context)
      const pending = deferred()
      vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
      const disconnect = session.disconnect().catch((error: unknown) => error)
      const cleanup = context.client[operation]().catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(operation === 'dispose' ? 4_000 : 5_000)
      expect(await cleanup).toBeInstanceOf(AggregateError)

      pending.reject(new Error('late failure'))
      await disconnect
      await vi.advanceTimersByTimeAsync(0)

      expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1)
      if (operation === 'reset') await context.client.dispose()
      else await expect(context.client.dispose()).rejects.toBeInstanceOf(AggregateError)
    } finally {
      vi.useRealTimers()
    }
  },
)

test.each([
  ['reset', false],
  ['reset', true],
  ['dispose', false],
  ['dispose', true],
] as const)(
  '%s reports its own failed attempt without retrying it (existing disconnect: %s)',
  async (operation, existing) => {
    const context = setup()
    const session = await connect(context)
    const pending = deferred()
    if (existing) {
      vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
    }
    const failure = new Error('cleanup attempt failed')
    vi.mocked(context.peer.disconnectSession).mockRejectedValueOnce(failure)
    const original = existing
      ? session.disconnect().catch((error: unknown) => error)
      : undefined
    const cleanup = context.client[operation]().catch((error: unknown) => error)
    if (existing) pending.reject(new Error('original attempt failed'))

    await original
    const error = await cleanup
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([failure])
    expect(context.peer.disconnectSession).toHaveBeenCalledTimes(existing ? 2 : 1)
    if (operation === 'reset') await context.client.dispose()
    else await expect(context.client.dispose()).rejects.toBe(error)
  },
)

test.each(['reset', 'dispose'] as const)(
  '%s does not repeat an existing disconnect that succeeds',
  async (operation) => {
    const context = setup()
    const session = await connect(context)
    const pending = deferred()
    vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
    const disconnect = session.disconnect()
    const cleanup = context.client[operation]()
    pending.resolve()

    await disconnect
    await cleanup
    expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1)
    await context.client.dispose()
  },
)

test.each(['reset', 'dispose'] as const)(
  '%s keeps the original cleanup deadline when its retry hangs',
  async (operation) => {
    vi.useFakeTimers()
    try {
      const disposeResource = vi.fn(async () => undefined)
      const context = setup({ dispose: disposeResource })
      const session = await connect(context)
      const pending = deferred()
      const retry = deferred()
      vi.mocked(context.peer.disconnectSession)
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(retry.promise)
      const disconnect = session.disconnect().catch((error: unknown) => error)
      const cleanup = context.client[operation]().catch((error: unknown) => error)
      const budget = operation === 'dispose' ? 4_000 : 5_000
      await vi.advanceTimersByTimeAsync(budget - 500)
      pending.reject(new Error('original attempt failed'))
      await disconnect
      await vi.advanceTimersByTimeAsync(0)
      expect(context.peer.disconnectSession).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(500)
      expect(await cleanup).toBeInstanceOf(AggregateError)
      if (operation === 'dispose') expect(disposeResource).toHaveBeenCalledTimes(1)
      retry.resolve()
      await vi.advanceTimersByTimeAsync(0)
      if (operation === 'reset') await context.client.dispose()
    } finally {
      vi.useRealTimers()
    }
  },
)

test('a peer delete completes local disconnect while the relay call remains pending', async () => {
  const context = setup()
  const session = await connect(context)
  const pending = deferred()
  vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
  const disconnect = session.disconnect()
  await vi.waitFor(() => expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1))

  context.events.emit('session_delete', { topic: 'session-topic' })

  let completed = false
  void disconnect.then(() => {
    completed = true
  })
  await vi.waitFor(() => expect(completed).toBe(true))
  await session.disconnect()
  expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1)
  await context.client.dispose()
})

test.each(['reset', 'dispose'] as const)(
  'a peer delete completes %s without waiting for a hung relay call',
  async (operation) => {
    vi.useFakeTimers()
    try {
      const context = setup()
      await connect(context)
      vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(deferred().promise)
      let result: 'completed' | 'failed' | undefined
      const cleanup = context.client[operation]().then(
        () => {
          result = 'completed'
        },
        () => {
          result = 'failed'
        },
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1)

      context.events.emit('session_delete', { topic: 'session-topic' })
      await vi.advanceTimersByTimeAsync(0)

      expect(result).toBe('completed')
      await cleanup
      await context.client.dispose()
      expect(context.events.listenerCount('session_delete')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  },
)

test.each(['resolve', 'reject'] as const)(
  'a peer-confirmed disconnect stays terminal when the SDK call will %s after disposal',
  async (completion) => {
    const context = setup()
    const session = await connect(context)
    const pending = deferred()
    vi.mocked(context.peer.disconnectSession).mockReturnValueOnce(pending.promise)
    const disconnect = session.disconnect()
    await vi.waitFor(() =>
      expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1),
    )
    context.events.emit('session_delete', { topic: 'session-topic' })

    await disconnect
    expect(
      context.environment.trace.events.filter(
        (event) => event.type === 'walletconnect.session.disconnected',
      ),
    ).toEqual([expect.objectContaining({ reason: 'peer' })])
    await context.client.dispose()
    const events = [...context.environment.trace.events]

    if (completion === 'resolve') pending.resolve()
    else pending.reject(new Error('topic already deleted'))
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(context.environment.trace.events).toEqual(events)
    expect(() => session.disconnect()).toThrow('WalletConnect client is disposed')
    expect(context.peer.disconnectSession).toHaveBeenCalledTimes(1)
  },
)

test.each(['result', 'error'] as const)(
  'records SDK call completion for a %s response without claiming delivery',
  async (outcome) => {
    const context = setup()
    await connect(context)
    const pending = deferred()
    context.respondSessionRequest.mockReturnValueOnce(pending.promise)
    receiveRequest(context)
    const request = await context.environment
      .wallet('wallet')
      .requests.next('personal_sign')
    if (outcome === 'result') await request.approve()
    else request.reject({ code: 4001, message: 'User rejected' })

    await vi.waitFor(() => {
      expect(context.environment.trace.events.at(-1)).toMatchObject({
        type: 'walletconnect.response.started',
        rpcRequestId: 42,
        outcome,
      })
    })
    pending.resolve()
    await vi.waitFor(() => {
      expect(context.environment.trace.events.at(-1)).toMatchObject({
        type: 'walletconnect.response.completed',
        rpcRequestId: 42,
        outcome,
      })
    })
    expect(context.respondSessionRequest).toHaveBeenCalledTimes(1)
    await context.client.dispose()
  },
)

test.each(['result', 'error'] as const)(
  'traces a rejected SDK call for a %s response without attempting a second response',
  async (outcome) => {
    const context = setup()
    await connect(context)
    context.respondSessionRequest.mockRejectedValueOnce(
      new Error('secret-topic symKey=secret'),
    )
    receiveRequest(context)
    const request = await context.environment
      .wallet('wallet')
      .requests.next('personal_sign')
    if (outcome === 'result') await request.approve()
    else request.reject({ code: 4001, message: 'User rejected' })

    await vi.waitFor(() => {
      expect(context.environment.trace.events.at(-1)).toMatchObject({
        type: 'walletconnect.response.failed',
        chainId: 'eip155:1',
        method: 'personal_sign',
        rpcRequestId: 42,
        outcome,
      })
    })
    const events = context.environment.trace.events.filter(
      (event) => 'rpcRequestId' in event,
    )
    expect(events.map((event) => event.type)).toEqual([
      'walletconnect.request.received',
      'walletconnect.response.started',
      'walletconnect.response.failed',
    ])
    expect(
      new Set(events.map((event) => 'connectionId' in event && event.connectionId)).size,
    ).toBe(1)
    expect(context.respondSessionRequest).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(events)
    for (const secret of [
      'session-topic',
      'secret-topic',
      'symKey',
      '0xsigned',
      '0x6869',
    ]) {
      expect(text).not.toContain(secret)
    }
    await context.client.dispose()
  },
)

test.each(['received', 'approval', 'result'] as const)(
  'attempts an SDK error response for a request interrupted at %s when disconnect fails',
  async (stage) => {
    const context = setup()
    const session = await connect(context)
    vi.mocked(context.peer.disconnectSession).mockRejectedValueOnce(
      new Error('relay failed'),
    )
    receiveRequest(context)
    if (stage !== 'received') {
      const request = await context.environment
        .wallet('wallet')
        .requests.next('personal_sign')
      // Start approval without yielding, so disconnect races with result dispatch.
      if (stage === 'result') void request.approve().catch(() => undefined)
    }
    await expect(session.disconnect()).rejects.toThrow('relay failed')

    await vi.waitFor(() => {
      expect(context.respondSessionRequest).toHaveBeenCalledWith({
        topic: 'session-topic',
        response: {
          id: 42,
          jsonrpc: '2.0',
          error: expect.objectContaining({ code: 6000 }),
        },
      })
    })
    expect(context.respondSessionRequest).toHaveBeenCalledTimes(1)
    expect(context.environment.trace.events).toContainEqual(
      expect.objectContaining({
        type: 'walletconnect.request.cancelled',
        rpcRequestId: 42,
      }),
    )
    // Failed disconnects must not reactivate the wallet approval queue.
    receiveRequest(context, 43)
    await vi.waitFor(() => expect(context.respondSessionRequest).toHaveBeenCalledTimes(2))
    expect(
      context.environment.trace.events.filter(
        (event) => event.type === 'request.received' && event.method === 'personal_sign',
      ),
    ).toHaveLength(stage === 'received' ? 0 : 1)
    await session.disconnect()
    await context.client.dispose()
  },
)

test.each(['resolve', 'reject'] as const)(
  'observes an in-flight response that will %s after disconnect',
  async (completion) => {
    const context = setup()
    const session = await connect(context)
    const pending = deferred()
    context.respondSessionRequest.mockReturnValueOnce(pending.promise)
    receiveRequest(context)
    const request = await context.environment
      .wallet('wallet')
      .requests.next('personal_sign')
    await request.approve()
    await vi.waitFor(() => expect(context.respondSessionRequest).toHaveBeenCalledTimes(1))
    await session.disconnect()
    if (completion === 'resolve') pending.resolve()
    else pending.reject(new Error('transport closed'))

    await vi.waitFor(() =>
      expect(context.environment.trace.events.at(-1)).toMatchObject({
        type:
          completion === 'resolve'
            ? 'walletconnect.response.completed'
            : 'walletconnect.response.failed',
        rpcRequestId: 42,
      }),
    )
    expect(context.respondSessionRequest).toHaveBeenCalledTimes(1)
    await context.client.dispose()
  },
)

test('correlates concurrent requests with the same method even when sends finish out of order', async () => {
  const context = setup()
  await connect(context)
  const firstSend = deferred()
  context.respondSessionRequest.mockReturnValueOnce(firstSend.promise)
  receiveRequest(context, 41)
  receiveRequest(context, 42)
  const wallet = context.environment.wallet('wallet')
  await (await wallet.requests.next('personal_sign')).approve()
  await vi.waitFor(() => expect(context.respondSessionRequest).toHaveBeenCalledTimes(1))
  await (await wallet.requests.next('personal_sign')).approve()
  await vi.waitFor(() =>
    expect(context.environment.trace.events.at(-1)).toMatchObject({
      type: 'walletconnect.response.completed',
      rpcRequestId: 42,
    }),
  )
  firstSend.resolve()
  await vi.waitFor(() =>
    expect(context.environment.trace.events.at(-1)).toMatchObject({
      type: 'walletconnect.response.completed',
      rpcRequestId: 41,
    }),
  )

  for (const rpcRequestId of [41, 42]) {
    expect(
      context.environment.trace.events
        .filter((event) => 'rpcRequestId' in event && event.rpcRequestId === rpcRequestId)
        .map((event) => event.type),
    ).toEqual([
      'walletconnect.request.received',
      'walletconnect.response.started',
      'walletconnect.response.completed',
    ])
  }
  await context.client.dispose()
})
