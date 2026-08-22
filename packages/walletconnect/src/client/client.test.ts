import { EventEmitter } from 'node:events'
import { Environment, Profile, type Wallet } from '@oallet/core'
import { expect, test, vi } from 'vitest'

import { create, createWithPeer, type Peer } from './create.js'

function setup() {
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
  }
  const environment = Environment.create({ wallets: [adapter] })
  const events = new EventEmitter()
  const approveSession = vi.fn(async (input: { id: number; namespaces: unknown }) => ({
    acknowledged: true,
    controller: 'controller',
    expiry: Date.now() + 60_000,
    namespaces: input.namespaces,
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
  }))
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
  const client = createWithPeer({ environment, projectId: 'test-project' }, peer)
  return { approveSession, client, environment, events, peer, respondSessionRequest }
}

test('pairs from a QR source and strictly intersects proposal namespaces', async () => {
  const { approveSession, client, events, peer } = setup()
  const flow = client.pairFromQr({
    scan: async () => 'wc:pairing@2?relay-protocol=irn&symKey=secret',
    walletId: 'wallet',
  })
  const proposalPromise = flow.nextSessionProposal()
  events.emit('session_proposal', proposal())
  const sessionProposal = await proposalPromise

  expect(sessionProposal.requiredNamespaces.eip155?.methods).toEqual(['personal_sign'])
  const session = await sessionProposal.approveSession()

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
  expect(session.topic).toBe('session-topic')
})

test('routes session requests through the wallet approval queue', async () => {
  const { client, environment, events, respondSessionRequest } = setup()
  const flow = client.pair({
    uri: 'wc:pairing@2?relay-protocol=irn&symKey=secret',
    walletId: 'wallet',
  })
  const proposalPromise = flow.nextSessionProposal()
  events.emit('session_proposal', proposal())
  await (await proposalPromise).approveSession()

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
  const request = await environment.wallet('wallet').requests.next()
  expect(request.origin).toBe('walletconnect://session-topic')
  await request.approve()

  await vi.waitFor(() => {
    expect(respondSessionRequest).toHaveBeenCalledWith({
      response: { id: 42, jsonrpc: '2.0', result: '0xsigned' },
      topic: 'session-topic',
    })
  })
})

function proposal() {
  return {
    id: 1,
    params: {
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      id: 1,
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:1', 'eip155:10'],
          events: ['accountsChanged', 'unsupportedEvent'],
          methods: ['eth_sendTransaction', 'unsupported_method'],
        },
      },
      pairingTopic: 'pairing',
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

  await expect(create({ environment, projectId: ' ' })).rejects.toMatchObject({
    code: 'OALLET_WC_PROJECT_ID_REQUIRED',
  })
})
