import { EventEmitter } from 'node:events'
import { Environment, Profile, type Wallet } from '@oallet/core'
import { expect, test, vi } from 'vitest'

import { create, createWithPeer, type Peer } from './create.js'

function setup(lifecycle: Parameters<typeof createWithPeer>[2] = {}) {
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
    profile,
    prepare(input) {
      if (input.method === 'eth_requestAccounts') {
        return {
          type: 'interactive',
          approve: () => ['0x0000000000000000000000000000000000000001'],
          data: { type: 'connect' },
        }
      }
      if (input.method === 'eth_chainId') return { type: 'return', value: '0x1' }
      if (input.method === 'wallet_switchEthereumChain') {
        return { type: 'interactive', approve: () => null, data: { type: 'switchChain' } }
      }
      return {
        type: 'interactive',
        approve: () => '0xsigned',
        data: { type: 'sign' },
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
  const respondSessionRequest = vi.fn(async () => undefined)
  const peer = {
    approveSession,
    disconnectSession: vi.fn(async () => undefined),
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
  return { approveSession, client, environment, events, peer, respondSessionRequest }
}

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

function proposal(options: { id?: number; pairingTopic?: string } = {}) {
  const id = options.id ?? 1
  return {
    id,
    params: {
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      id,
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:10'],
          events: ['accountsChanged', 'unsupportedEvent'],
          methods: ['eth_sendTransaction', 'unsupported_method'],
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
  await expect(first).rejects.toMatchObject({ code: 'OALLET_WC_PAIRING_TIMEOUT' })

  const second = client.pair({ uri: 'wc:second@2?relay-protocol=irn&symKey=secret' })
  events.emit('session_proposal', proposal({ pairingTopic: 'first' }))
  events.emit('session_proposal', proposal({ pairingTopic: 'second' }))
  await expect(second).resolves.toBeDefined()
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

test('bounds a hung pairing cleanup before allowing another pairing', async () => {
  vi.useFakeTimers()
  try {
    const { client, events, peer } = setup()
    vi.mocked(peer.pair).mockImplementationOnce(() => new Promise(() => undefined))
    const pairing = client.pair({
      timeout: 1,
      uri: 'wc:hung@2?relay-protocol=irn&symKey=secret',
    })
    const pairingResult = pairing.catch((cause: unknown) => cause)

    await vi.advanceTimersByTimeAsync(5_001)
    const error = await pairingResult
    expect(error).toMatchObject({
      code: 'OALLET_WC_PAIRING_TIMEOUT',
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
