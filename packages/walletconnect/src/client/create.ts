import { type Environment, Json, type Profile } from '@oallet/core'
import { WalletKit, type WalletKitTypes } from '@reown/walletkit'
import { Core } from '@walletconnect/core'
import { formatJsonRpcError, formatJsonRpcResult } from '@walletconnect/jsonrpc-utils'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'

import {
  InvalidUriError,
  PairingInProgressError,
  ProjectIdRequiredError,
  ProposalSettledError,
  ProposalTimeoutError,
  UnsupportedNamespacesError,
} from '../errors/errors.js'
import type * as Pairing from '../pairing/pairing.js'
import type * as Session from '../session/session.js'

type WalletKitInstance = InstanceType<typeof WalletKit>
type SessionStruct = Awaited<ReturnType<WalletKitInstance['approveSession']>>
type SessionRequest = WalletKitTypes.SessionRequest

export type Peer = Pick<
  WalletKitInstance,
  | 'approveSession'
  | 'disconnectSession'
  | 'getActiveSessions'
  | 'off'
  | 'on'
  | 'pair'
  | 'rejectSession'
  | 'respondSessionRequest'
>

export type Instance = {
  readonly sessions: readonly Session.Instance[]
  pair(options: pair.Options): Pairing.Flow
  pairFromQr(options: pairFromQr.Options): Pairing.Flow
  reset(): Promise<void>
}

type SessionState = {
  connected: boolean
  session: SessionStruct
  walletId: string
}

const walletIdProperty = 'dev.oallet.walletId'
const defaultMethods = [
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
]
const defaultEvents = ['accountsChanged', 'chainChanged']

export async function create(options: create.Options): Promise<Instance> {
  validateProjectId(options.projectId)
  const core = new Core({
    projectId: options.projectId,
    ...(options.customStoragePrefix === undefined
      ? {}
      : { customStoragePrefix: options.customStoragePrefix }),
    ...(options.relayUrl === undefined ? {} : { relayUrl: options.relayUrl }),
  })
  const peer = await WalletKit.init({
    core: core as WalletKitTypes.Options['core'],
    metadata: options.metadata ?? {
      description: 'Deterministic test wallet peer',
      icons: [],
      name: 'Oallet',
      url: 'https://oallet.dev',
    },
  })
  return createWithPeer(options, peer)
}

export declare namespace create {
  type Options = {
    readonly customStoragePrefix?: string | undefined
    readonly environment: Environment.Instance
    readonly metadata?: WalletKitTypes.Metadata | undefined
    readonly projectId: string
    readonly relayUrl?: string | undefined
  }
  type ReturnType = Instance
}

export function createWithPeer(options: create.Options, peer: Peer): Instance {
  validateProjectId(options.projectId)
  const { environment } = options
  const sessions = new Map<string, SessionState>()
  let pairingActive = false

  for (const session of Object.values(peer.getActiveSessions())) {
    const walletId = session.sessionProperties?.[walletIdProperty]
    if (walletId && environment.profiles.some((profile) => profile.id === walletId)) {
      sessions.set(session.topic, { connected: false, session, walletId })
    }
  }

  const instance: Instance = {
    get sessions() {
      return [...sessions.values()].map((state) => sessionHandle(state, peer, sessions))
    },
    pair(pairOptions) {
      return startPairing(Promise.resolve(pairOptions.uri), pairOptions)
    },
    pairFromQr(pairOptions) {
      return startPairing(Promise.resolve().then(pairOptions.scan), pairOptions)
    },
    async reset() {
      const reason = getSdkError('USER_DISCONNECTED')
      await Promise.all(
        [...sessions].map(async ([topic]) => {
          await peer.disconnectSession({ reason, topic })
          sessions.delete(topic)
        }),
      )
    },
  }

  peer.on('session_request', (event) => {
    void routeSessionRequest(event)
  })
  peer.on('session_delete', (event) => {
    sessions.delete(event.topic)
  })

  return instance

  function startPairing(
    uriPromise: Promise<string>,
    pairOptions: pair.Options | pairFromQr.Options,
  ): Pairing.Flow {
    if (pairingActive)
      throw new PairingInProgressError('Only one pairing flow may be active per client')
    environment.wallet(pairOptions.walletId)
    pairingActive = true
    let cleaned = false
    let resolveProposal: (event: Pairing.Proposal.Event) => void = () => undefined
    const eventPromise = new Promise<Pairing.Proposal.Event>((resolve) => {
      resolveProposal = resolve
    })
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      pairingActive = false
      peer.off('session_proposal', onProposal)
    }
    const onProposal = (event: Pairing.Proposal.Event) => {
      peer.off('session_proposal', onProposal)
      resolveProposal(event)
    }
    peer.on('session_proposal', onProposal)
    const pairingPromise = (async () => {
      const uri = await uriPromise
      if (!uri.startsWith('wc:'))
        throw new InvalidUriError('Pairing URI must use the wc: scheme')
      await peer.pair({ uri })
      return eventPromise
    })()
    let proposalPromise: Promise<Pairing.Proposal> | undefined

    return {
      nextSessionProposal(nextOptions = {}) {
        proposalPromise ??= timeout(
          pairingPromise,
          nextOptions.timeout ?? 30_000,
          new ProposalTimeoutError(
            'Timed out waiting for a WalletConnect session proposal',
          ),
        )
          .then((event) => proposalHandle(event, pairOptions))
          .finally(cleanup)
        return proposalPromise
      },
    }
  }

  function proposalHandle(
    event: Pairing.Proposal.Event,
    pairOptions: pair.Options | pairFromQr.Options,
  ): Pairing.Proposal {
    let proposalSettled = false
    return {
      id: event.id,
      optionalNamespaces: event.params.optionalNamespaces,
      requiredNamespaces: event.params.requiredNamespaces,
      async approveSession(approveOptions = {}) {
        if (proposalSettled)
          throw new ProposalSettledError('Session proposal is already settled')
        proposalSettled = true
        const supportedNamespaces =
          pairOptions.namespaces ??
          supportedNamespacesFor(environment.wallet(pairOptions.walletId).profile)
        let namespaces: Session.Namespaces
        try {
          namespaces = buildApprovedNamespaces({
            proposal: event.params,
            supportedNamespaces: supportedNamespaces as never,
          })
        } catch (cause) {
          throw new UnsupportedNamespacesError('Required namespaces are not supported', {
            cause,
          })
        }
        const session = await peer.approveSession({
          id: event.id,
          namespaces: namespaces as never,
          sessionProperties: {
            ...event.params.sessionProperties,
            ...approveOptions.sessionProperties,
            [walletIdProperty]: pairOptions.walletId,
          },
        })
        const state = { connected: false, session, walletId: pairOptions.walletId }
        sessions.set(session.topic, state)
        await ensureConnected(state)
        return sessionHandle(state, peer, sessions)
      },
      async rejectSession() {
        if (proposalSettled)
          throw new ProposalSettledError('Session proposal is already settled')
        proposalSettled = true
        await peer.rejectSession({ id: event.id, reason: getSdkError('USER_REJECTED') })
      },
    }
  }

  async function routeSessionRequest(event: SessionRequest) {
    const state = sessions.get(event.topic)
    if (!state) {
      await peer.respondSessionRequest({
        response: formatJsonRpcError(
          event.id,
          getSdkError('USER_DISCONNECTED', `Unknown session ${event.topic}`),
        ),
        topic: event.topic,
      })
      return
    }
    try {
      await ensureConnected(state)
      await selectChain(state, event.params.chainId)
      Json.assert(event.params.request.params)
      const result = await environment.dispatch({
        method: event.params.request.method,
        origin: sessionOrigin(event.topic),
        params: event.params.request.params,
        walletId: state.walletId,
      })
      await peer.respondSessionRequest({
        response: formatJsonRpcResult(event.id, result),
        topic: event.topic,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await peer.respondSessionRequest({
        response: formatJsonRpcError(event.id, { code: 5000, message }),
        topic: event.topic,
      })
    }
  }

  async function ensureConnected(state: SessionState) {
    if (state.connected) return
    const stop = environment.wallet(state.walletId).startAutoApprove()
    try {
      await environment.dispatch({
        method: 'eth_requestAccounts',
        origin: sessionOrigin(state.session.topic),
        walletId: state.walletId,
      })
      state.connected = true
    } finally {
      stop()
    }
  }

  async function selectChain(state: SessionState, caipChainId: string) {
    const match = /^eip155:(\d+)$/.exec(caipChainId)
    if (!match) return
    const chainId = Number(match[1])
    const origin = sessionOrigin(state.session.topic)
    const activeChain = await environment.dispatch<string>({
      method: 'eth_chainId',
      origin,
      walletId: state.walletId,
    })
    if (Number(BigInt(activeChain)) === chainId) return
    const stop = environment.wallet(state.walletId).startAutoApprove()
    try {
      await environment.dispatch({
        method: 'wallet_switchEthereumChain',
        origin,
        params: [{ chainId: `0x${chainId.toString(16)}` }],
        walletId: state.walletId,
      })
    } finally {
      stop()
    }
  }
}

export declare namespace pair {
  type Options = {
    readonly namespaces?: Session.Namespaces | undefined
    readonly uri: string
    readonly walletId: string
  }
}

export declare namespace pairFromQr {
  type Options = {
    readonly namespaces?: Session.Namespaces | undefined
    readonly scan: () => string | Promise<string>
    readonly walletId: string
  }
}

function supportedNamespacesFor(profile: Profile.Definition): Session.Namespaces {
  if (profile.kind !== 'eip155:eoa' || !isObject(profile.data)) {
    throw new UnsupportedNamespacesError(
      `Profile ${profile.id} has no default WalletConnect namespace`,
    )
  }
  const chains = profile.data.chains
  const accounts = profile.data.accounts
  if (!Array.isArray(chains) || !Array.isArray(accounts)) {
    throw new UnsupportedNamespacesError(
      `Profile ${profile.id} has invalid EVM namespace data`,
    )
  }
  const chainIds = chains.map((chainId) => {
    if (typeof chainId !== 'number') {
      throw new UnsupportedNamespacesError(
        `Profile ${profile.id} contains an invalid chain`,
      )
    }
    return `eip155:${chainId}`
  })
  const addresses = accounts.map((account) => {
    if (!isObject(account) || typeof account.address !== 'string') {
      throw new UnsupportedNamespacesError(
        `Profile ${profile.id} contains an invalid account`,
      )
    }
    return account.address
  })
  return {
    eip155: {
      accounts: chainIds.flatMap((chainId) =>
        addresses.map((address) => `${chainId}:${address}`),
      ),
      chains: chainIds,
      events: defaultEvents,
      methods: defaultMethods,
    },
  }
}

function sessionHandle(
  state: SessionState,
  peer: Peer,
  sessions: Map<string, SessionState>,
): Session.Instance {
  return {
    namespaces: state.session.namespaces,
    topic: state.session.topic,
    async disconnect() {
      await peer.disconnectSession({
        reason: getSdkError('USER_DISCONNECTED'),
        topic: state.session.topic,
      })
      sessions.delete(state.session.topic)
    },
  }
}

function sessionOrigin(topic: string) {
  return `walletconnect://${topic}`
}

function isObject(value: unknown): value is Record<string, Json.Value> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateProjectId(projectId: string) {
  if (!projectId.trim())
    throw new ProjectIdRequiredError('WalletConnect requires a projectId')
}

function timeout<Value>(
  promise: Promise<Value>,
  duration: number,
  error: Error,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), duration)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        clearTimeout(timer)
        reject(cause)
      },
    )
  })
}
