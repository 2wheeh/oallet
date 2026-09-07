import { Environment, Json, type Profile } from '@oallet/core'
import { WalletKit, type WalletKitTypes } from '@reown/walletkit'
import { Core } from '@walletconnect/core'
import { formatJsonRpcError, formatJsonRpcResult } from '@walletconnect/jsonrpc-utils'
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils'

import {
  ClientDisposedError,
  InvalidUriError,
  PairingCleanupError,
  PairingInProgressError,
  PairingResetError,
  PairingStartError,
  PairingTimeoutError,
  ProjectIdRequiredError,
  ProposalSettledError,
  UnsupportedNamespacesError,
} from '../errors/errors.js'
import type * as Pairing from '../pairing/pairing.js'
import type * as Session from '../session/session.js'

type WalletKitInstance = InstanceType<typeof WalletKit>
type CoreInstance = InstanceType<typeof Core>
type SessionStruct = Awaited<ReturnType<WalletKitInstance['approveSession']>>
type SessionRequest = WalletKitTypes.SessionRequest
type EnvironmentPort = Pick<Environment.Instance, 'dispatch'> & {
  readonly [Environment.controller]: Pick<
    Environment.Controller,
    'subscribe' | 'traceWalletConnect'
  >
  wallet(
    id: string,
  ): Pick<ReturnType<Environment.Instance['wallet']>, 'autoApprove' | 'profile'>
}

export type Peer = Pick<
  WalletKitInstance,
  | 'approveSession'
  | 'disconnectSession'
  | 'emitSessionEvent'
  | 'off'
  | 'on'
  | 'pair'
  | 'rejectSession'
  | 'respondSessionRequest'
>

export type Instance = AsyncDisposable & {
  dispose(): Promise<void>
  pair(options: pair.Options): Promise<Pairing.Proposal>
  reset(): Promise<void>
}

type PairingAttempt = {
  readonly connectionId: string
  pairing: Promise<void>
  pairingSettled: boolean
  readonly reject: (reason: unknown) => void
  readonly topic: string
}

type ProposalState = {
  readonly connectionId: string
  readonly event: Pairing.Proposal.Event
  settled: boolean
}

type SessionState = {
  chainId?: string | undefined
  connected: boolean
  readonly connectionId: string
  disconnecting?: Promise<void> | undefined
  disconnected: boolean
  readonly requests: AbortController
  readonly session: SessionStruct
}

type Resource = {
  cleanupPairing(topic: string): Promise<void>
  dispose(): Promise<void>
  readonly peer: Peer
}

type ResourceFactory = (projectId: string) => Promise<Resource>

const cleanupBudget = 5_000
const resourceCleanupReserve = 1_000
const defaultPairingTimeout = 30_000
const defaultMethods = [
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
]
const defaultEvents = ['accountsChanged', 'chainChanged']

export async function create(options: create.Options): Promise<Instance> {
  validateProjectId(options.projectId)
  options.environment.wallet(options.walletId)
  const resource = await createResource(options.projectId)
  return createWithResource(options, resource)
}

export declare namespace create {
  type Options = {
    readonly environment: EnvironmentPort
    readonly projectId: string
    readonly walletId: string
  }
  type ReturnType = Instance
}

const createResource: ResourceFactory = async (projectId) => {
  const storageId = crypto.randomUUID()
  const core = new Core({ customStoragePrefix: storageId, projectId })
  try {
    const peer = await WalletKit.init({
      core: core as WalletKitTypes.Options['core'],
      metadata: {
        description: 'Deterministic test wallet peer',
        icons: [],
        name: 'Oallet',
        url: 'https://oallet.dev',
      },
    })
    return {
      async cleanupPairing(topic) {
        await core.pairing.disconnect({ topic })
      },
      async dispose() {
        const errors = await cleanupCore(core, storageId)
        throwCollected(errors, 'Failed to dispose WalletConnect resources')
      },
      peer,
    }
  } catch (initializationError) {
    const cleanupErrors = await cleanupCore(core, storageId)
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [initializationError, ...cleanupErrors],
        'WalletConnect initialization and cleanup failed',
      )
    }
    throw initializationError
  }
}

/** Internal deterministic seam. It is intentionally absent from package exports. */
export function createWithPeer(
  options: create.Options,
  peer: Peer,
  lifecycle: {
    cleanupPairing?(topic: string): Promise<void>
    dispose?(): Promise<void>
  } = {},
): Instance {
  return createWithResource(options, {
    cleanupPairing: lifecycle.cleanupPairing ?? (async () => undefined),
    dispose: lifecycle.dispose ?? (async () => undefined),
    peer,
  })
}

function createWithResource(options: create.Options, resource: Resource): Instance {
  validateProjectId(options.projectId)
  const { environment, walletId } = options
  const wallet = environment.wallet(walletId)
  const { peer } = resource
  const operations = new Set<Promise<unknown>>()
  const proposals = new Set<ProposalState>()
  const sessions = new Map<string, SessionState>()
  let activePairing: PairingAttempt | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let resetting = false

  const onSessionRequest = (event: SessionRequest) => {
    void track(routeSessionRequest(event))
  }
  const onSessionDelete = (event: { topic: string }) => {
    const state = sessions.get(event.topic)
    if (!state || state.disconnected) return
    state.disconnected = true
    state.requests.abort()
    sessions.delete(event.topic)
    trace({
      connectionId: state.connectionId,
      reason: 'peer',
      type: 'walletconnect.session.disconnected',
      walletId,
    })
  }
  peer.on('session_request', onSessionRequest)
  peer.on('session_delete', onSessionDelete)
  const unsubscribeProviderEvents = environment[Environment.controller].subscribe(
    (event) => track(routeProviderEvent(event)),
  )

  const instance: Instance = {
    [Symbol.asyncDispose]() {
      return instance.dispose()
    },
    dispose() {
      disposal ??= disposeClient()
      return disposal
    },
    pair(pairOptions) {
      assertActive()
      if (activePairing || resetting)
        throw new PairingInProgressError('Only one pairing may be active per client')
      return startPairing(pairOptions)
    },
    async reset() {
      assertActive()
      if (resetting)
        throw new PairingInProgressError(
          'WalletConnect client reset is already in progress',
        )
      resetting = true
      try {
        const errors = await cleanup('reset', false)
        trace({ type: 'walletconnect.client.reset', walletId })
        throwCollected(errors, 'WalletConnect client reset encountered cleanup failures')
      } finally {
        resetting = false
      }
    },
  }

  return instance

  function assertActive() {
    if (disposed) throw new ClientDisposedError('WalletConnect client is disposed')
  }

  function trace(input: Parameters<Environment.Controller['traceWalletConnect']>[0]) {
    environment[Environment.controller].traceWalletConnect(input)
  }

  function startPairing(pairOptions: pair.Options): Promise<Pairing.Proposal> {
    const { uri } = pairOptions
    const topic = pairingTopic(uri)
    const connectionId = crypto.randomUUID()
    let rejectAttempt: (reason: unknown) => void = () => undefined
    let resolveProposal: (event: Pairing.Proposal.Event) => void = () => undefined
    const attempt: PairingAttempt = {
      connectionId,
      pairing: Promise.resolve(),
      pairingSettled: false,
      reject: (reason) => rejectAttempt(reason),
      topic,
    }
    activePairing = attempt
    trace({
      connectionId,
      type: 'walletconnect.pairing.started',
      walletId,
    })

    const proposalEvent = new Promise<Pairing.Proposal.Event>((resolve, reject) => {
      resolveProposal = resolve
      rejectAttempt = reject
    })
    const onProposal = (event: Pairing.Proposal.Event) => {
      if (event.params.pairingTopic === topic) resolveProposal(event)
    }
    peer.on('session_proposal', onProposal)
    attempt.pairing = Promise.resolve()
      .then(() => peer.pair({ uri }))
      .then(
        () => {
          attempt.pairingSettled = true
        },
        (cause: unknown) => {
          attempt.pairingSettled = true
          throw new PairingStartError('Failed to start WalletConnect pairing', { cause })
        },
      )
    const finishAttempt = withTimeout(
      Promise.all([attempt.pairing, proposalEvent]).then(([, event]) => event),
      pairOptions.timeout ?? defaultPairingTimeout,
      () =>
        new PairingTimeoutError(
          attempt.pairingSettled
            ? 'Timed out waiting for a WalletConnect session proposal'
            : 'Timed out starting WalletConnect pairing',
          { stage: attempt.pairingSettled ? 'proposal' : 'pairing' },
        ),
    )
    void finishAttempt.then(
      () => peer.off('session_proposal', onProposal),
      () => peer.off('session_proposal', onProposal),
    )
    return finishAttempt.then(
      (event) => {
        if (activePairing === attempt) activePairing = undefined
        const state = { connectionId, event, settled: false }
        proposals.add(state)
        trace({
          connectionId,
          type: 'walletconnect.proposal.received',
          walletId,
        })
        return proposalHandle(state)
      },
      async (error: unknown) => {
        let failure = error
        try {
          if (
            !(error instanceof PairingResetError || error instanceof ClientDisposedError)
          ) {
            try {
              await withTimeout(
                attempt.pairing
                  .catch(() => undefined)
                  .then(() => resource.cleanupPairing(topic)),
                cleanupBudget,
                new Error('Timed out cleaning up WalletConnect pairing'),
              )
            } catch (cleanupError) {
              failure = new PairingCleanupError(
                'Failed to clean up WalletConnect pairing after pairing failed',
                {
                  cause: new AggregateError(
                    [error, cleanupError],
                    'WalletConnect pairing and cleanup failed',
                  ),
                },
              )
            }
          }
          trace({
            connectionId,
            reason: pairingFailureReason(error),
            stage: pairingFailureStage(failure),
            type: 'walletconnect.pairing.failed',
            walletId,
          })
          throw failure
        } finally {
          if (activePairing === attempt) activePairing = undefined
        }
      },
    )
  }

  function proposalHandle(state: ProposalState): Pairing.Proposal {
    const { event } = state
    return {
      optionalNamespaces: event.params.optionalNamespaces,
      requiredNamespaces: event.params.requiredNamespaces,
      async approve(approveOptions = {}) {
        assertActive()
        settleProposal(state)
        return await track(approveProposal(state, approveOptions))
      },
      async reject() {
        assertActive()
        settleProposal(state)
        return await track(rejectProposal(state))
      },
    }
  }

  async function approveProposal(
    state: ProposalState,
    approveOptions: Pairing.Proposal.ApproveOptions,
  ) {
    const supportedNamespaces =
      approveOptions.namespaces ?? supportedNamespacesFor(wallet.profile)
    let namespaces: Session.Namespaces
    try {
      namespaces = buildApprovedNamespaces({
        proposal: state.event.params,
        supportedNamespaces: supportedNamespaces as never,
      })
    } catch (cause) {
      throw new UnsupportedNamespacesError('Required namespaces are not supported', {
        cause,
      })
    }
    const session = await peer.approveSession({
      id: state.event.id,
      namespaces: namespaces as never,
    })
    const sessionState: SessionState = {
      connected: false,
      connectionId: state.connectionId,
      disconnected: false,
      requests: new AbortController(),
      session,
    }
    sessions.set(session.topic, sessionState)
    try {
      await ensureConnected(sessionState)
    } catch (connectionError) {
      try {
        await disconnectSession(sessionState, 'session')
      } catch (cleanupError) {
        throw new AggregateError(
          [connectionError, cleanupError],
          'WalletConnect session approval and cleanup failed',
        )
      }
      throw connectionError
    }
    trace({
      connectionId: state.connectionId,
      type: 'walletconnect.proposal.approved',
      walletId,
    })
    return sessionHandle(sessionState)
  }

  async function rejectProposal(state: ProposalState) {
    await peer.rejectSession({
      id: state.event.id,
      reason: getSdkError('USER_REJECTED'),
    })
    trace({
      connectionId: state.connectionId,
      type: 'walletconnect.proposal.rejected',
      walletId,
    })
  }

  function track<Value>(operation: Promise<Value>): Promise<Value> {
    operations.add(operation)
    void operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation),
    )
    return operation
  }

  function settleProposal(state: ProposalState) {
    if (state.settled)
      throw new ProposalSettledError('Session proposal is already settled')
    state.settled = true
    proposals.delete(state)
  }

  function sessionHandle(state: SessionState): Session.Instance {
    return {
      namespaces: state.session.namespaces,
      disconnect() {
        assertActive()
        state.disconnecting ??= disconnectSession(state, 'session')
        return state.disconnecting
      },
    }
  }

  async function disconnectSession(
    state: SessionState,
    reason: 'dispose' | 'reset' | 'session',
  ) {
    if (state.disconnected) return
    state.disconnected = true
    state.requests.abort()
    sessions.delete(state.session.topic)
    trace({
      connectionId: state.connectionId,
      reason,
      type: 'walletconnect.session.disconnected',
      walletId,
    })
    await peer.disconnectSession({
      reason: getSdkError('USER_DISCONNECTED'),
      topic: state.session.topic,
    })
  }

  async function cleanup(
    reason: 'dispose' | 'reset',
    includeResource: boolean,
  ): Promise<unknown[]> {
    const errors: unknown[] = []
    const tasks: Promise<unknown>[] = []
    const attempt = activePairing
    if (attempt) {
      activePairing = undefined
      attempt.reject(
        reason === 'reset'
          ? new PairingResetError('WalletConnect pairing was reset')
          : new ClientDisposedError('WalletConnect client is disposed'),
      )
      tasks.push(
        attempt.pairing
          .catch(() => undefined)
          .then(() => resource.cleanupPairing(attempt.topic)),
      )
    }
    for (const state of proposals) {
      state.settled = true
      proposals.delete(state)
      trace({
        connectionId: state.connectionId,
        type: 'walletconnect.proposal.rejected',
        walletId,
      })
      tasks.push(
        peer.rejectSession({
          id: state.event.id,
          reason: getSdkError('USER_REJECTED'),
        }),
      )
    }
    tasks.push(...operations)
    for (const state of sessions.values()) {
      state.disconnecting ??= disconnectSession(state, reason)
      tasks.push(state.disconnecting)
    }
    const peerCleanup = async () => {
      await collectSettled(tasks, errors)
      const sessionTasks: Promise<unknown>[] = []
      for (const state of sessions.values()) {
        state.disconnecting ??= disconnectSession(state, reason)
        sessionTasks.push(state.disconnecting)
      }
      await collectSettled(sessionTasks, errors)
    }
    const startedAt = Date.now()
    try {
      await withTimeout(
        peerCleanup(),
        includeResource ? cleanupBudget - resourceCleanupReserve : cleanupBudget,
        new Error('Timed out cleaning up WalletConnect peer state'),
      )
    } catch (error) {
      errors.push(error)
    }
    if (includeResource) {
      const remaining = Math.max(0, cleanupBudget - (Date.now() - startedAt))
      try {
        await withTimeout(
          Promise.resolve().then(() => resource.dispose()),
          remaining,
          new Error('Timed out disposing WalletConnect resources'),
        )
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }

  async function disposeClient() {
    disposed = true
    unsubscribeProviderEvents()
    peer.off('session_request', onSessionRequest)
    peer.off('session_delete', onSessionDelete)
    const errors = await cleanup('dispose', true)
    trace({ type: 'walletconnect.client.disposed', walletId })
    throwCollected(errors, 'WalletConnect client disposal encountered cleanup failures')
  }

  async function routeSessionRequest(event: SessionRequest) {
    const state = sessions.get(event.topic)
    if (!state || disposed) {
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
      Json.assert(event.params.request.params)
      const result = await environment.dispatch({
        chainId: event.params.chainId,
        method: event.params.request.method,
        origin: sessionOrigin(state.connectionId),
        params: event.params.request.params,
        signal: state.requests.signal,
        walletId,
      })
      await peer.respondSessionRequest({
        response: formatJsonRpcResult(event.id, result),
        topic: event.topic,
      })
    } catch (error) {
      if (state.disconnected || state.requests.signal.aborted) return
      await peer.respondSessionRequest({
        response: formatSessionRequestError(event.id, error),
        topic: event.topic,
      })
    }
  }

  async function routeProviderEvent(event: Environment.ProviderEvent) {
    if (disposed || event.walletId !== walletId) return
    if (event.name !== 'accountsChanged' && event.name !== 'chainChanged') return
    const state = [...sessions.values()].find(
      (candidate) => sessionOrigin(candidate.connectionId) === event.origin,
    )
    if (!state?.connected || state.disconnected) return
    const namespace = state.session.namespaces.eip155
    if (!namespace?.events.includes(event.name)) return

    const chainId =
      event.name === 'chainChanged'
        ? eip155ChainId(event.data)
        : (state.chainId ?? namespace.chains?.[0])
    if (!chainId || !namespace.chains?.includes(chainId)) return
    state.chainId = chainId
    await peer.emitSessionEvent({
      chainId,
      event: {
        ...(event.data === undefined ? {} : { data: event.data }),
        name: event.name,
      },
      topic: state.session.topic,
    })
  }

  async function ensureConnected(state: SessionState) {
    if (state.connected) return
    await wallet.autoApprove(async () => {
      await environment.dispatch({
        method: 'eth_requestAccounts',
        origin: sessionOrigin(state.connectionId),
        signal: state.requests.signal,
        walletId,
      })
      state.connected = true
    })
  }
}

function eip155ChainId(value: Json.Value | undefined): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  try {
    return `eip155:${Number(BigInt(value))}`
  } catch {
    return undefined
  }
}

export declare namespace pair {
  type Options = {
    readonly timeout?: number | undefined
    readonly uri: string
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

function pairingTopic(uri: string) {
  const match = /^wc:([^@?]+)@/.exec(uri)
  if (!match?.[1]) throw new InvalidUriError('Pairing URI must be a WalletConnect URI')
  return match[1]
}

function sessionOrigin(connectionId: string) {
  return `walletconnect://${connectionId}`
}

function formatSessionRequestError(
  id: number,
  error: unknown,
): ReturnType<typeof formatJsonRpcError> {
  const candidate =
    error && typeof error === 'object'
      ? (error as { code?: unknown; data?: unknown; providerCode?: unknown })
      : undefined
  const code =
    typeof candidate?.providerCode === 'number'
      ? candidate.providerCode
      : typeof candidate?.code === 'number'
        ? candidate.code
        : 5000
  return {
    error: {
      code,
      ...(Json.isValue(candidate?.data) ? { data: candidate.data } : {}),
      message: error instanceof Error ? error.message : String(error),
    },
    id,
    jsonrpc: '2.0',
    // WalletConnect narrows error data to string, while JSON-RPC and Oallet allow JSON.
  } as ReturnType<typeof formatJsonRpcError>
}

function isObject(value: unknown): value is Record<string, Json.Value> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateProjectId(projectId: string) {
  if (!projectId.trim())
    throw new ProjectIdRequiredError('WalletConnect requires a projectId')
}

function pairingFailureReason(error: unknown) {
  if (error instanceof PairingTimeoutError) return 'timeout' as const
  if (error instanceof PairingResetError) return 'reset' as const
  if (error instanceof ClientDisposedError) return 'dispose' as const
  return 'error' as const
}

function pairingFailureStage(error: unknown) {
  if (error instanceof PairingCleanupError) return error.stage
  if (error instanceof PairingTimeoutError) return error.stage
  return 'pairing' as const
}

function withTimeout<Value>(
  promise: Promise<Value>,
  duration: number,
  error: Error | (() => Error),
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(typeof error === 'function' ? error() : error),
      duration,
    )
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

async function collectSettled(tasks: readonly Promise<unknown>[], errors: unknown[]) {
  if (tasks.length === 0) return
  const results = await Promise.allSettled(tasks)
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason)
  }
}

function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length > 0) throw new AggregateError(errors, message)
}

async function cleanupCore(core: CoreInstance, storageId: string): Promise<unknown[]> {
  const errors: unknown[] = []
  try {
    core.heartbeat.stop()
  } catch (error) {
    errors.push(error)
  }
  try {
    Reflect.deleteProperty(globalThis, `_walletConnectCore_${storageId}`)
    Reflect.deleteProperty(globalThis, `_walletConnectCore_${storageId}_count`)
  } catch (error) {
    errors.push(error)
  }
  const cleanup = [
    Promise.resolve()
      .then(() => core.relayer.transportClose())
      .catch((error: unknown) => {
        errors.push(error)
      }),
    Promise.resolve()
      .then(async () => {
        const keys = await core.storage.getKeys()
        const removals = await Promise.allSettled(
          keys
            .filter((key) => key.includes(storageId))
            .map((key) => core.storage.removeItem(key)),
        )
        for (const removal of removals) {
          if (removal.status === 'rejected') errors.push(removal.reason)
        }
      })
      .catch((error: unknown) => {
        errors.push(error)
      }),
  ]
  try {
    await withTimeout(
      Promise.all(cleanup),
      cleanupBudget,
      new Error('Timed out cleaning up WalletConnect Core resources'),
    )
  } catch (error) {
    errors.push(error)
  }
  return errors
}
