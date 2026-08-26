import pkg from '../../package.json' with { type: 'json' }
import * as Json from '../json/json.js'
import type * as Request from '../request/request.js'
import type * as Trace from '../trace/trace.js'
import type * as Wallet from '../wallet/wallet.js'
import {
  DuplicateWalletError,
  EnvironmentDisposedError,
  InvalidSnapshotError,
  PendingRequestError,
  ProviderRpcError,
  RequestExpiredError,
  RequestRejectedError,
  RequestSettledError,
  ResetError,
  UnexpectedRequestError,
  WalletNotFoundError,
} from './errors.js'

export type DispatchInput = Wallet.Input & {
  readonly providerSessionId?: string | undefined
  readonly requestId?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly walletId: string
}

export type ProviderEvent = Wallet.ProviderEvent & {
  readonly walletId: string
}

export type Controller = {
  delivery(input: {
    readonly data?: Json.Value | undefined
    readonly delivered: boolean
    readonly name: string
    readonly origin: string
    readonly providerSessionId: string
    readonly walletId: string
  }): void
  state(walletId: string, origin: string): Json.Value | undefined
  subscribe(listener: (event: ProviderEvent) => void | Promise<void>): () => void
  traceWalletConnect(input: Trace.Input<Trace.WalletConnectEvent>): void
}

export const controller = Symbol('oallet.environment.controller')

export type Snapshot = {
  readonly producedBy: string
  readonly profiles: Readonly<Record<string, string>>
  readonly schemaVersion: 1
  readonly wallets: Readonly<Record<string, Json.Value>>
}

export type Instance<
  Controls extends object = object,
  Requests extends object = object,
> = {
  readonly [controller]: Controller
  readonly profiles: readonly Wallet.Adapter['profile'][]
  readonly trace: Trace.Artifact
  dispatch<Result extends Json.Value = Json.Value>(input: DispatchInput): Promise<Result>
  dispose(): Promise<void>
  reset(): Promise<void>
  restore(snapshot: Snapshot): Promise<void>
  snapshot(): Promise<Snapshot>
  wallet(id: string): Wallet.Instance<Controls, Requests>
}

type AdapterControls<Adapters extends readonly Wallet.Adapter[]> =
  Adapters[number] extends Wallet.Adapter<infer Controls, object> ? Controls : object

type AdapterRequests<Adapters extends readonly Wallet.Adapter[]> =
  Adapters[number] extends Wallet.Adapter<object, infer Requests> ? Requests : object

type MutableRequest = Request.Handle & {
  cancel(reason: Trace.RequestCancelled['reason']): void
}

type WalletState = {
  adapter: Wallet.Adapter
  autoApproveScopes: number
  pending: Set<MutableRequest>
  queue: RequestQueue
}

class RequestQueue {
  #requests: Request.Handle[] = []
  #waiters: Array<(request: Request.Handle) => void> = []

  next(
    expectedMethod?: string,
    options: Request.Queue.NextOptions = {},
  ): Promise<Request.Handle> {
    const request = this.#requests[0]
    if (request) return this.#take(request, expectedMethod)
    if (options.signal?.aborted) return Promise.reject(options.signal.reason)
    return new Promise((resolve, reject) => {
      const waiter = (next: Request.Handle) => {
        options.signal?.removeEventListener('abort', abort)
        this.#take(next, expectedMethod).then(resolve, reject)
      }
      const abort = () => {
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter)
        reject(options.signal?.reason)
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      this.#waiters.push(waiter)
    })
  }

  #take(request: Request.Handle, expectedMethod?: string) {
    if (expectedMethod !== undefined && request.method !== expectedMethod) {
      if (this.#requests[0] !== request) this.#requests.unshift(request)
      return Promise.reject(
        new UnexpectedRequestError(
          `Expected ${expectedMethod} but the next request is ${request.method}`,
        ),
      )
    }
    if (this.#requests[0] === request) this.#requests.shift()
    return Promise.resolve(request)
  }

  push(request: Request.Handle) {
    const waiter = this.#waiters.shift()
    if (waiter) waiter(request)
    else this.#requests.push(request)
  }

  clear() {
    this.#requests = []
  }
}

class Journal {
  readonly environmentId = crypto.randomUUID()
  readonly startedAt = Date.now()
  #events: Trace.Event[] = []

  get artifact(): Trace.Artifact {
    return Object.freeze({
      environmentId: this.environmentId,
      events: Object.freeze([...this.#events]),
      schemaVersion: 1,
      startedAt: this.startedAt,
    })
  }

  record(input: Trace.Input) {
    const value = redact({
      ...input,
      sequence: this.#events.length + 1,
      timestamp: Date.now(),
    })
    Json.assert(value)
    this.#events.push(Json.freeze(value) as Trace.Event)
  }
}

export function create<const Adapters extends readonly Wallet.Adapter[]>(
  options: create.Options<Adapters>,
): Instance<AdapterControls<Adapters>, AdapterRequests<Adapters>> {
  const wallets = new Map<string, WalletState>()
  const journal = new Journal()
  const listeners = new Set<(event: ProviderEvent) => void | Promise<void>>()
  let eventBuffer: ProviderEvent[] | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  const assertActive = () => {
    if (disposed) throw new EnvironmentDisposedError('Environment is disposed')
  }
  const publish = async (event: ProviderEvent) => {
    journal.record({
      ...(event.connectionId === undefined ? {} : { connectionId: event.connectionId }),
      ...(event.data === undefined ? {} : { data: event.data }),
      origin: event.origin,
      type: connectionEventType(event.name),
      walletId: event.walletId,
    })
    await Promise.all([...listeners].map((listener) => listener(event)))
  }
  const flush = async (events: readonly ProviderEvent[]) => {
    const errors: unknown[] = []
    for (const event of events) {
      try {
        await publish(event)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to deliver wallet state changes')
    }
  }
  for (const adapter of options.wallets) {
    if (wallets.has(adapter.profile.id)) {
      throw new DuplicateWalletError(`Wallet ${adapter.profile.id} is already registered`)
    }
    wallets.set(adapter.profile.id, {
      adapter,
      autoApproveScopes: 0,
      pending: new Set(),
      queue: new RequestQueue(),
    })
  }

  const environment: Instance<AdapterControls<Adapters>, AdapterRequests<Adapters>> = {
    [controller]: {
      delivery(input) {
        assertActive()
        journal.record({
          ...(input.data === undefined ? {} : { data: input.data }),
          name: input.name,
          origin: input.origin,
          providerSessionId: input.providerSessionId,
          type: input.delivered ? 'provider.eventDelivered' : 'provider.deliveryFailed',
          walletId: input.walletId,
        })
      },
      state(walletId, origin) {
        assertActive()
        return getWallet(wallets, walletId).adapter.state?.(origin)
      },
      subscribe(listener) {
        assertActive()
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      traceWalletConnect(input) {
        assertActive()
        journal.record(input)
      },
    },
    profiles: Object.freeze(options.wallets.map((wallet) => wallet.profile)),
    get trace() {
      return journal.artifact
    },
    async dispatch<Result extends Json.Value = Json.Value>(input: DispatchInput) {
      assertActive()
      const state = getWallet(wallets, input.walletId)
      const requestId = input.requestId ?? crypto.randomUUID()
      if (input.signal?.aborted) throw input.signal.reason
      journal.record({
        ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
        method: input.method,
        origin: input.origin,
        ...(input.params === undefined ? {} : { params: input.params }),
        ...(input.providerSessionId === undefined
          ? {}
          : { providerSessionId: input.providerSessionId }),
        requestId,
        type: 'request.received',
        walletId: input.walletId,
      })
      try {
        const preparation = await state.adapter.prepare(input)
        if (preparation.type === 'return') {
          Json.assert(preparation.value)
          journal.record({
            ...requestFields(input, requestId),
            result: preparation.value,
            type: 'request.returned',
          })
          return preparation.value as Result
        }
        Json.assert(preparation.data)
        return (await settleInteractive(
          state,
          input,
          requestId,
          preparation,
          journal,
        )) as Result
      } catch (error) {
        if (
          !(error instanceof ProviderRpcError) &&
          !(error instanceof RequestExpiredError) &&
          !(error instanceof RequestRejectedError) &&
          !(error instanceof ResetError)
        ) {
          journal.record({
            ...requestFields(input, requestId),
            error: errorDetails(error),
            type: 'request.failed',
          })
        }
        throw error
      }
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      disposal = (async () => {
        for (const state of wallets.values()) {
          state.autoApproveScopes = 0
          state.queue.clear()
          for (const request of [...state.pending]) request.cancel('disposed')
        }
        journal.record({ type: 'environment.disposed' })
        listeners.clear()
        const errors: unknown[] = []
        for (const state of [...wallets.values()].reverse()) {
          try {
            await state.adapter.dispose?.()
          } catch (error) {
            errors.push(error)
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'Failed to dispose Oallet environment')
        }
      })()
      return disposal
    },
    async reset() {
      assertActive()
      eventBuffer = []
      try {
        for (const state of wallets.values()) {
          state.autoApproveScopes = 0
          state.queue.clear()
          for (const request of [...state.pending]) request.cancel('reset')
          await state.adapter.reset()
        }
      } catch (error) {
        eventBuffer = undefined
        throw error
      }
      journal.record({ type: 'environment.reset' })
      const events = eventBuffer ?? []
      eventBuffer = undefined
      await flush(events)
    },
    async restore(snapshot: Snapshot) {
      assertActive()
      validateSnapshot(snapshot, wallets)
      for (const [id, state] of wallets) {
        state.adapter.validateSnapshot(snapshot.wallets[id] as Json.Value)
      }
      const previous = new Map<string, Json.Value>()
      for (const [id, state] of wallets) {
        const value = await state.adapter.snapshot()
        Json.assert(value)
        previous.set(id, value)
      }
      for (const state of wallets.values()) {
        state.autoApproveScopes = 0
        state.queue.clear()
        for (const request of [...state.pending]) request.cancel('restore')
      }
      eventBuffer = []
      try {
        for (const [id, state] of wallets) {
          await state.adapter.restore(snapshot.wallets[id] as Json.Value)
        }
      } catch (error) {
        eventBuffer = []
        const rollbackErrors: unknown[] = []
        for (const [id, state] of wallets) {
          try {
            await state.adapter.restore(previous.get(id) as Json.Value)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        eventBuffer = undefined
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            'Snapshot restore and rollback failed',
          )
        }
        throw error
      }
      journal.record({ type: 'environment.restored' })
      const events = eventBuffer ?? []
      eventBuffer = undefined
      await flush(events)
    },
    async snapshot() {
      assertActive()
      if ([...wallets.values()].some((state) => state.pending.size > 0)) {
        throw new PendingRequestError(
          'Cannot create a snapshot while wallet requests are pending',
        )
      }
      const snapshots: Record<string, Json.Value> = {}
      const profiles: Record<string, string> = {}
      for (const [id, state] of wallets) {
        const snapshot = await state.adapter.snapshot()
        Json.assert(snapshot)
        snapshots[id] = snapshot
        profiles[id] = fingerprint(state.adapter.profile)
      }
      const snapshot = Json.freeze({
        producedBy: pkg.version,
        profiles,
        schemaVersion: 1 as const,
        wallets: snapshots,
      })
      journal.record({ type: 'environment.snapshot' })
      return snapshot
    },
    wallet(id: string) {
      assertActive()
      const state = getWallet(wallets, id)
      return Object.assign({}, state.adapter.controls, {
        profile: state.adapter.profile,
        requests: state.queue,
        async autoApprove<Result>(callback: () => Result | Promise<Result>) {
          state.autoApproveScopes += 1
          try {
            return await callback()
          } finally {
            state.autoApproveScopes = Math.max(0, state.autoApproveScopes - 1)
          }
        },
      }) as unknown as Wallet.Instance<
        AdapterControls<Adapters>,
        AdapterRequests<Adapters>
      >
    },
  }
  for (const [walletId, state] of wallets) {
    state.adapter.bind?.({
      async emit(event) {
        const providerEvent = Object.freeze({ ...event, walletId })
        if (eventBuffer) eventBuffer.push(providerEvent)
        else await publish(providerEvent)
      },
    })
  }
  return environment
}

export declare namespace create {
  type Options<Adapters extends readonly Wallet.Adapter[] = readonly Wallet.Adapter[]> = {
    wallets: Adapters
  }
  type ReturnType = Instance
}

function getWallet(wallets: Map<string, WalletState>, id: string): WalletState {
  const state = wallets.get(id)
  if (!state) throw new WalletNotFoundError(`Wallet ${id} is not registered`)
  return state
}

function settleInteractive(
  state: WalletState,
  input: DispatchInput,
  requestId: string,
  preparation: Wallet.Interactive,
  journal: Journal,
): Promise<Json.Value> {
  return new Promise((resolve, reject) => {
    let status: Request.Status = 'pending'
    let cancellation: Trace.RequestCancelled['reason'] | undefined
    const assertPending = () => {
      if (status === 'cancelled' && cancellation === 'provider-session-ended') {
        throw new RequestExpiredError(`Request ${input.method} is no longer active`)
      }
      if (status !== 'pending') {
        throw new RequestSettledError(`Request is already ${status}`)
      }
    }
    const finish = () => {
      input.signal?.removeEventListener('abort', abort)
      state.pending.delete(handle)
    }
    const handle: MutableRequest = {
      ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
      data: preparation.data,
      id: requestId,
      method: input.method,
      origin: input.origin,
      ...(input.params === undefined ? {} : { params: input.params }),
      get status() {
        return status
      },
      walletId: input.walletId,
      async approve() {
        assertPending()
        try {
          const response = await preparation.approve()
          Json.assert(response)
          status = 'approved'
          finish()
          journal.record({
            ...requestFields(input, requestId),
            result: response,
            type: 'request.approved',
          })
          journal.record({
            ...requestFields(input, requestId),
            result: response,
            type: 'request.returned',
          })
          resolve(response)
          return preparation.controllerResult?.(response) ?? response
        } catch (error) {
          status = 'rejected'
          finish()
          reject(error)
          throw error
        }
      },
      reject(reason = new RequestRejectedError(`Request ${input.method} was rejected`)) {
        assertPending()
        const error =
          reason instanceof Error
            ? reason
            : new ProviderRpcError(reason.code, reason.message, reason.data)
        status = 'rejected'
        finish()
        Promise.resolve(preparation.reject?.(error)).catch(() => undefined)
        journal.record({
          ...requestFields(input, requestId),
          error: errorDetails(error),
          type: 'request.rejected',
        })
        reject(error)
      },
      cancel(reason) {
        if (status !== 'pending') return
        status = 'cancelled'
        cancellation = reason
        finish()
        journal.record({
          ...requestFields(input, requestId),
          reason,
          type: 'request.cancelled',
        })
        reject(
          reason === 'provider-session-ended'
            ? new RequestExpiredError(`Request ${input.method} is no longer active`)
            : new ResetError(`Request ${input.method} was cancelled by ${reason}`),
        )
      },
    }
    const abort = () => handle.cancel('provider-session-ended')
    state.pending.add(handle)
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()
    if (state.autoApproveScopes > 0) void handle.approve().catch(() => undefined)
    else state.queue.push(handle)
  })
}

function requestFields(input: DispatchInput, requestId: string) {
  return {
    ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    method: input.method,
    origin: input.origin,
    ...(input.providerSessionId === undefined
      ? {}
      : { providerSessionId: input.providerSessionId }),
    requestId,
    walletId: input.walletId,
  }
}

function errorDetails(error: unknown): Trace.Error {
  if (!(error instanceof Error)) {
    return { message: String(error), name: 'Error' }
  }
  const providerError = error as Error & {
    code?: unknown
    data?: unknown
    providerCode?: unknown
  }
  const code =
    typeof providerError.providerCode === 'number'
      ? providerError.providerCode
      : providerError.code
  return {
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(Json.isValue(providerError.data) ? { data: providerError.data } : {}),
    message: error.message,
    name: error.name,
  }
}

function connectionEventType(
  name: Wallet.ProviderEventName,
): Trace.ConnectionEvent['type'] {
  const types = {
    accountsChanged: 'connection.accountsChanged',
    chainChanged: 'connection.chainChanged',
    connect: 'connection.connected',
    disconnect: 'connection.disconnected',
  } as const satisfies Record<Wallet.ProviderEventName, Trace.ConnectionEvent['type']>
  return types[name]
}

function redact(value: unknown, key = ''): unknown {
  if (/mnemonic|private.?key|secret|sym.?key/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    return value.replace(/symKey=[^&]+/gi, 'symKey=[REDACTED]')
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, item]) => [
        nestedKey,
        redact(item, nestedKey),
      ]),
    )
  }
  return value
}

function validateSnapshot(snapshot: Snapshot, wallets: Map<string, WalletState>) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.producedBy !== 'string' ||
    !snapshot.wallets ||
    typeof snapshot.wallets !== 'object' ||
    Array.isArray(snapshot.wallets) ||
    !Json.isValue(snapshot.wallets) ||
    !snapshot.profiles ||
    typeof snapshot.profiles !== 'object' ||
    Array.isArray(snapshot.profiles) ||
    !Object.values(snapshot.profiles).every(
      (fingerprint) => typeof fingerprint === 'string',
    )
  ) {
    throw new InvalidSnapshotError(
      'Snapshot must use the supported version and JSON values',
    )
  }
  const expected = [...wallets.keys()].sort()
  const walletIds = Object.keys(snapshot.wallets).sort()
  const profileIds = Object.keys(snapshot.profiles).sort()
  if (
    expected.length !== walletIds.length ||
    expected.length !== profileIds.length ||
    expected.some((id, index) => id !== walletIds[index] || id !== profileIds[index])
  ) {
    throw new InvalidSnapshotError(
      'Snapshot wallet and profile sets do not match the environment',
    )
  }
  for (const [id, state] of wallets) {
    if (snapshot.profiles[id] !== fingerprint(state.adapter.profile)) {
      throw new InvalidSnapshotError(
        `Snapshot profile fingerprint does not match wallet ${id}`,
      )
    }
  }
}

function fingerprint(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${fingerprint(record[key])}`)
    .join(',')}}`
}
