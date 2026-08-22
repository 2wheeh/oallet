import * as Json from '../json/json.js'
import type * as Request from '../request/request.js'
import type * as Trace from '../trace/trace.js'
import type * as Wallet from '../wallet/wallet.js'
import {
  DuplicateWalletError,
  InvalidSnapshotError,
  RequestRejectedError,
  RequestSettledError,
  ResetError,
  WalletNotFoundError,
} from './errors.js'

export type DispatchInput = Wallet.Input & {
  readonly walletId: string
}

export type Snapshot = {
  readonly version: 1
  readonly wallets: Readonly<Record<string, Json.Value>>
}

export type Instance = {
  readonly profiles: readonly Wallet.Adapter['profile'][]
  readonly trace: readonly Trace.Entry[]
  dispatch<Result extends Json.Value = Json.Value>(input: DispatchInput): Promise<Result>
  reset(): Promise<void>
  restore(snapshot: Snapshot): Promise<void>
  snapshot(): Promise<Snapshot>
  wallet(id: string): Wallet.Instance
}

type MutableRequest = Request.Handle & {
  settleReset(): void
}

type WalletState = {
  adapter: Wallet.Adapter
  autoApproveScopes: number
  pending: Set<MutableRequest>
  queue: RequestQueue
}

class RequestQueue implements Request.Queue {
  #requests: Request.Handle[] = []
  #waiters: Array<(request: Request.Handle) => void> = []

  next(options: Request.Queue.NextOptions = {}): Promise<Request.Handle> {
    const request = this.#requests.shift()
    if (request) return Promise.resolve(request)
    if (options.signal?.aborted) return Promise.reject(options.signal.reason)
    return new Promise((resolve, reject) => {
      const waiter = (next: Request.Handle) => {
        options.signal?.removeEventListener('abort', abort)
        resolve(next)
      }
      const abort = () => {
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter)
        reject(options.signal?.reason)
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      this.#waiters.push(waiter)
    })
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

export function create(options: create.Options): Instance {
  const wallets = new Map<string, WalletState>()
  const trace: Trace.Entry[] = []
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

  const environment: Instance = {
    profiles: Object.freeze(options.wallets.map((wallet) => wallet.profile)),
    get trace() {
      return Object.freeze([...trace])
    },
    async dispatch<Result extends Json.Value = Json.Value>(input: DispatchInput) {
      const state = getWallet(wallets, input.walletId)
      record(trace, input, 'received')
      try {
        const preparation = await state.adapter.prepare(input)
        record(
          trace,
          input,
          'prepared',
          preparation.type === 'interactive' ? preparation.data : undefined,
        )
        if (preparation.type === 'return') {
          Json.assert(preparation.value)
          record(trace, input, 'returned', preparation.value)
          return preparation.value as Result
        }
        Json.assert(preparation.data)
        return (await settleInteractive(state, input, preparation, trace)) as Result
      } catch (error) {
        if (!(error instanceof RequestRejectedError) && !(error instanceof ResetError)) {
          record(trace, input, 'failed')
        }
        throw error
      }
    },
    async reset() {
      for (const state of wallets.values()) {
        state.autoApproveScopes = 0
        state.queue.clear()
        for (const request of [...state.pending]) request.settleReset()
        await state.adapter.reset()
      }
    },
    async restore(snapshot: Snapshot) {
      validateSnapshot(snapshot, wallets)
      await environment.reset()
      for (const [id, state] of wallets)
        await state.adapter.restore(snapshot.wallets[id] as Json.Value)
    },
    async snapshot() {
      const snapshots: Record<string, Json.Value> = {}
      for (const [id, state] of wallets) {
        const snapshot = await state.adapter.snapshot()
        Json.assert(snapshot)
        snapshots[id] = snapshot
      }
      return Json.freeze({ version: 1 as const, wallets: snapshots })
    },
    wallet(id: string) {
      const state = getWallet(wallets, id)
      return {
        profile: state.adapter.profile,
        requests: state.queue,
        startAutoApprove() {
          state.autoApproveScopes += 1
          let active = true
          return () => {
            if (!active) return
            active = false
            state.autoApproveScopes -= 1
          }
        },
      }
    },
  }
  return environment
}

export declare namespace create {
  type Options = {
    wallets: readonly Wallet.Adapter[]
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
  preparation: Wallet.Interactive,
  trace: Trace.Entry[],
): Promise<Json.Value> {
  return new Promise((resolve, reject) => {
    let status: Request.Status = 'pending'
    const handle: MutableRequest = {
      data: preparation.data,
      id: crypto.randomUUID(),
      method: input.method,
      origin: input.origin,
      ...(input.params === undefined ? {} : { params: input.params }),
      get status() {
        return status
      },
      walletId: input.walletId,
      async approve() {
        if (status !== 'pending')
          throw new RequestSettledError(`Request is already ${status}`)
        try {
          const value = await preparation.approve()
          Json.assert(value)
          status = 'approved'
          state.pending.delete(handle)
          record(trace, input, 'approved', value)
          resolve(value)
          return value
        } catch (error) {
          status = 'rejected'
          state.pending.delete(handle)
          reject(error)
          throw error
        }
      },
      reject(reason = new RequestRejectedError(`Request ${input.method} was rejected`)) {
        if (status !== 'pending')
          throw new RequestSettledError(`Request is already ${status}`)
        status = 'rejected'
        state.pending.delete(handle)
        Promise.resolve(preparation.reject?.(reason)).catch(() => undefined)
        record(trace, input, 'rejected')
        reject(reason)
      },
      settleReset() {
        if (status !== 'pending') return
        status = 'rejected'
        state.pending.delete(handle)
        reject(new ResetError(`Request ${input.method} was cancelled by reset`))
      },
    }
    state.pending.add(handle)
    if (state.autoApproveScopes > 0) void handle.approve().catch(() => undefined)
    else state.queue.push(handle)
  })
}

function record(
  trace: Trace.Entry[],
  input: DispatchInput,
  phase: Trace.Phase,
  data?: Json.Value,
) {
  trace.push(
    Object.freeze({
      ...(data === undefined ? {} : { data }),
      method: input.method,
      origin: input.origin,
      phase,
      timestamp: Date.now(),
      walletId: input.walletId,
    }),
  )
}

function validateSnapshot(snapshot: Snapshot, wallets: Map<string, WalletState>) {
  if (snapshot.version !== 1 || !Json.isValue(snapshot.wallets)) {
    throw new InvalidSnapshotError(
      'Snapshot must use the supported version and JSON values',
    )
  }
  const expected = [...wallets.keys()].sort()
  const actual = Object.keys(snapshot.wallets).sort()
  if (
    expected.length !== actual.length ||
    expected.some((id, index) => id !== actual[index])
  ) {
    throw new InvalidSnapshotError('Snapshot wallet set does not match the environment')
  }
}
