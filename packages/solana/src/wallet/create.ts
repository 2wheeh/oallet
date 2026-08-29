import type { Wallet as CoreWallet, Json } from '@oallet/core'
import {
  createSignableMessage,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
} from '@solana/kit'

import type * as Connection from '../connection/connection.js'
import {
  ConnectionDisposedError,
  ConnectionNotFoundError,
  InvalidParamsError,
  InvalidProfileError,
  StaleConnectionError,
  UnauthorizedError,
  UnsupportedMethodError,
  WalletDisconnectedError,
} from '../errors/errors.js'
import * as Identity from '../identity/identity.js'
import type * as Profile from '../profile/keypair.js'

export type Controls = {
  readonly connections: Connection.Collection
}

export type RequestResults = {
  readonly 'standard:connect': Connection.Instance
}

export type Instance = CoreWallet.Adapter<Controls, RequestResults> & {
  readonly profile: Profile.Definition
}

type AccountView = {
  readonly address: string
  readonly chains: readonly Profile.Chain[]
  readonly features: readonly ['solana:signMessage', 'solana:signTransaction']
  readonly label: string
  readonly publicKey: readonly number[]
}

type ConnectionState = {
  accounts: readonly Identity.Preset[]
  connected: boolean
  handle: Connection.Instance
  status: 'active' | 'disposed' | 'stale'
}

export function create(options: create.Options): Instance {
  const { profile } = options
  const connections = new Map<string, ConnectionState>()
  const signerByAddress = new Map(
    profile.data.accounts.map((preset) => [preset.address, Identity.account(preset)]),
  )
  let disposed = false
  let emit: CoreWallet.AdapterContext['emit'] = async () => undefined
  const controls: Controls = Object.freeze({
    connections: Object.freeze({
      get(origin: string) {
        if (disposed) {
          throw new ConnectionDisposedError(`Wallet ${profile.id} is disposed`)
        }
        const connection = connections.get(origin)
        if (!connection) {
          throw new ConnectionNotFoundError(
            `Wallet ${profile.id} has no connection for ${origin}`,
          )
        }
        return connection.handle
      },
    }),
  })

  return {
    bind(context) {
      emit = context.emit
    },
    controls,
    dispose() {
      disposed = true
      for (const connection of connections.values()) connection.status = 'disposed'
      connections.clear()
    },
    profile,
    async prepare(input) {
      const connection = getConnection(connections, profile, emit, input.origin)
      if (input.method === 'standard:connect') {
        const silent = connectSilent(input.params)
        if (silent) {
          if (!connection.connected && connection.accounts.length > 0) {
            await connection.handle.reconnect()
          }
          return {
            type: 'return',
            value: accountViews(
              connection.connected ? connection.accounts : [],
              profile.data.chains,
            ),
          }
        }
        if (connection.connected && connection.accounts.length > 0) {
          return {
            type: 'return',
            value: accountViews(connection.accounts, profile.data.chains),
          }
        }
        return {
          type: 'interactive',
          async approve() {
            if (!connection.connected) await connection.handle.reconnect()
            await connection.handle.setAccounts(profile.data.accounts)
            return accountViews(connection.accounts, profile.data.chains)
          },
          controllerResult: () => connection.handle,
          data: {
            accounts: profile.data.accounts.map((account) => account.address),
            chains: profile.data.chains,
            type: 'connect',
          },
        }
      }
      if (input.method === 'standard:disconnect') {
        await connection.handle.disconnect()
        return { type: 'return', value: null }
      }
      if (input.method === 'solana:signMessage') {
        ensureConnected(connection)
        const requests = messageRequests(input.params)
        const accounts = requests.map(({ address }) => {
          const account = profile.data.accounts.find(
            (candidate) => candidate.address === address,
          )
          if (!account) {
            throw new UnauthorizedError(
              `Account ${address} is not exposed by this wallet`,
            )
          }
          if (!connection.accounts.includes(account)) {
            throw new UnauthorizedError(
              `Account ${address} is not authorized for this origin`,
            )
          }
          return account
        })
        return {
          type: 'interactive',
          async approve() {
            return Promise.all(
              requests.map(async ({ message }, index) => {
                const account = accounts[index] as Identity.Preset
                const signer = await signerByAddress.get(account.address)
                if (!signer) {
                  throw new UnauthorizedError(`Account ${account.address} has no signer`)
                }
                const [signatures] = await signer.signMessages([
                  createSignableMessage(Uint8Array.from(message)),
                ])
                const signature = signatures?.[signer.address]
                if (!signature) throw new Error('Solana signer returned no signature')
                return {
                  signature: [...signature],
                  signedMessage: message,
                }
              }),
            )
          },
          data: {
            accounts: accounts.map((account) => account.address),
            messages: requests.map(({ message }) => message),
            type: 'signMessage',
          },
        }
      }
      if (input.method === 'solana:signTransaction') {
        ensureConnected(connection)
        const requests = transactionRequests(input.params, profile.data.chains)
        const accounts = requests.map(({ address }) => {
          const account = profile.data.accounts.find(
            (candidate) => candidate.address === address,
          )
          if (!account) {
            throw new UnauthorizedError(
              `Account ${address} is not exposed by this wallet`,
            )
          }
          if (!connection.accounts.includes(account)) {
            throw new UnauthorizedError(
              `Account ${address} is not authorized for this origin`,
            )
          }
          return account
        })
        return {
          type: 'interactive',
          async approve() {
            return Promise.all(
              requests.map(async ({ transaction }, index) => {
                const account = accounts[index] as Identity.Preset
                const signer = await signerByAddress.get(account.address)
                if (!signer) {
                  throw new UnauthorizedError(`Account ${account.address} has no signer`)
                }
                const decoded = getTransactionDecoder().decode(
                  Uint8Array.from(transaction),
                )
                const signed = await partiallySignTransaction([signer.keyPair], decoded)
                return {
                  signedTransaction: [...getTransactionEncoder().encode(signed)],
                }
              }),
            )
          },
          data: {
            accounts: accounts.map((account) => account.address),
            chains: requests.map(({ chain }) => chain),
            transactions: requests.map(({ transaction }) => transaction),
            type: 'signTransaction',
          },
        }
      }
      throw new UnsupportedMethodError(`Method ${input.method} is not supported`)
    },
    async reset() {
      const before = new Map(
        [...connections].map(([origin, connection]) => [origin, view(connection)]),
      )
      for (const connection of connections.values()) {
        connection.accounts = []
        connection.connected = true
      }
      for (const origin of [...connections.keys()].sort()) {
        await emitDiff(
          emit,
          origin,
          before.get(origin) as ConnectionView,
          view(connections.get(origin) as ConnectionState),
          profile,
        )
      }
    },
    async restore(snapshot) {
      const entries = parseSnapshot(snapshot, profile)
      const before = new Map(
        [...connections].map(([origin, connection]) => [origin, view(connection)]),
      )
      const restoredOrigins = new Set(entries.map((entry) => entry.origin))
      for (const [origin, connection] of connections) {
        if (!restoredOrigins.has(origin)) {
          connection.status = 'stale'
          connections.delete(origin)
        }
      }
      for (const entry of entries) {
        const existing = connections.get(entry.origin)
        if (existing?.handle.id === entry.id) {
          existing.accounts = entry.accounts
          existing.connected = entry.connected
          continue
        }
        if (existing) existing.status = 'stale'
        connections.set(
          entry.origin,
          createConnection(
            profile,
            emit,
            entry.origin,
            entry.accounts,
            entry.connected,
            entry.id,
          ),
        )
      }
      const origins = new Set([...before.keys(), ...entries.map((entry) => entry.origin)])
      for (const origin of [...origins].sort()) {
        await emitDiff(
          emit,
          origin,
          before.get(origin) ?? baselineView(),
          connections.has(origin)
            ? view(connections.get(origin) as ConnectionState)
            : baselineView(),
          profile,
        )
      }
    },
    snapshot() {
      return {
        connections: [...connections]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([origin, connection]) => ({
            accounts: connection.accounts.map((account) => account.id),
            connected: connection.connected,
            id: connection.handle.id,
            origin,
          })),
        schemaVersion: 1,
      }
    },
    state(origin) {
      const connection = connections.get(origin)
      return {
        accounts: accountViews(
          connection?.connected ? connection.accounts : [],
          profile.data.chains,
        ),
        connected: connection?.connected ?? true,
      }
    },
    validateSnapshot(snapshot) {
      parseSnapshot(snapshot, profile)
    },
  }
}

export declare namespace create {
  type Options = {
    readonly profile: Profile.Definition
  }
  type ReturnType = Instance
}

function getConnection(
  connections: Map<string, ConnectionState>,
  profile: Profile.Definition,
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
) {
  let connection = connections.get(origin)
  if (!connection) {
    connection = createConnection(profile, emit, origin, [])
    connections.set(origin, connection)
  }
  return connection
}

function createConnection(
  profile: Pick<Profile.Definition, 'data' | 'id'>,
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
  initialAccounts: readonly Identity.Preset[],
  connected = true,
  id: string = crypto.randomUUID(),
): ConnectionState {
  const connection: ConnectionState = {
    accounts: [...initialAccounts],
    connected,
    handle: undefined as never,
    status: 'active',
  }
  connection.handle = Object.freeze({
    async disconnect() {
      ensureActive(connection)
      if (!connection.connected) return
      connection.connected = false
      await emit({
        connectionId: connection.handle.id,
        data: [],
        name: 'disconnect',
        origin,
      })
    },
    id,
    origin,
    async reconnect() {
      ensureActive(connection)
      if (connection.connected) return
      connection.connected = true
      await emit({
        connectionId: connection.handle.id,
        data: accountViews(connection.accounts, profile.data.chains),
        name: 'connect',
        origin,
      })
    },
    async setAccounts(nextAccounts) {
      ensureActive(connection)
      for (const account of nextAccounts) {
        if (!profile.data.accounts.includes(account)) {
          throw new UnauthorizedError(
            `Account ${account.address} is not part of wallet ${profile.id}`,
          )
        }
      }
      if (new Set(nextAccounts).size !== nextAccounts.length) {
        throw new InvalidParamsError('Connection accounts must be unique')
      }
      const changed =
        connection.accounts.length !== nextAccounts.length ||
        connection.accounts.some((account, index) => account !== nextAccounts[index])
      connection.accounts = [...nextAccounts]
      if (changed && connection.connected) {
        await emit({
          connectionId: connection.handle.id,
          data: accountViews(nextAccounts, profile.data.chains),
          name: 'accountsChanged',
          origin,
        })
      }
    },
    walletId: profile.id,
  })
  return connection
}

function accountViews(
  accounts: readonly Identity.Preset[],
  chains: readonly Profile.Chain[],
): readonly AccountView[] {
  return accounts.map((account) => ({
    address: account.address,
    chains,
    features: ['solana:signMessage', 'solana:signTransaction'],
    label: account.id,
    publicKey: [...getBase58Encoder().encode(account.address)],
  }))
}

function connectSilent(params: Json.Value | undefined) {
  if (params === undefined) return false
  if (!Array.isArray(params) || params.length > 1) invalidParams('standard:connect')
  const [value] = params
  if (value === undefined) return false
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidParams('standard:connect')
  }
  const silent = (value as Record<string, Json.Value>).silent
  if (silent !== undefined && typeof silent !== 'boolean') {
    invalidParams('standard:connect')
  }
  return silent === true
}

function messageRequests(params: Json.Value | undefined) {
  if (!Array.isArray(params) || params.length === 0) {
    invalidParams('solana:signMessage')
  }
  return params.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidParams('solana:signMessage')
    }
    const input = value as Record<string, Json.Value>
    if (
      typeof input.address !== 'string' ||
      !Array.isArray(input.message) ||
      !input.message.every(
        (byte) =>
          Number.isInteger(byte) && typeof byte === 'number' && byte >= 0 && byte <= 255,
      )
    ) {
      invalidParams('solana:signMessage')
    }
    return { address: input.address, message: input.message as number[] }
  })
}

function transactionRequests(
  params: Json.Value | undefined,
  supportedChains: readonly Profile.Chain[],
) {
  if (!Array.isArray(params) || params.length === 0) {
    invalidParams('solana:signTransaction')
  }
  return params.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidParams('solana:signTransaction')
    }
    const input = value as Record<string, Json.Value>
    if (
      typeof input.address !== 'string' ||
      typeof input.chain !== 'string' ||
      !supportedChains.includes(input.chain as Profile.Chain) ||
      !Array.isArray(input.transaction) ||
      !input.transaction.every(
        (byte) =>
          typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255,
      )
    ) {
      invalidParams('solana:signTransaction')
    }
    return {
      address: input.address,
      chain: input.chain as Profile.Chain,
      transaction: input.transaction as number[],
    }
  })
}

function ensureActive(connection: ConnectionState) {
  if (connection.status === 'disposed') {
    throw new ConnectionDisposedError('This connection handle is disposed')
  }
  if (connection.status === 'stale') {
    throw new StaleConnectionError('This connection handle is stale')
  }
}

function ensureConnected(connection: ConnectionState) {
  if (!connection.connected) {
    throw new WalletDisconnectedError('The wallet is disconnected from this origin')
  }
}

type ConnectionView = {
  readonly accounts: readonly Identity.Preset[]
  readonly connected: boolean
  readonly connectionId?: string | undefined
}

function view(connection: ConnectionState): ConnectionView {
  return {
    accounts: connection.accounts,
    connected: connection.connected,
    connectionId: connection.handle.id,
  }
}

function baselineView(): ConnectionView {
  return { accounts: [], connected: true }
}

async function emitDiff(
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
  before: ConnectionView,
  after: ConnectionView,
  profile: Pick<Profile.Definition, 'data'>,
) {
  const connectionId = after.connectionId ?? before.connectionId
  if (!after.connected) {
    if (before.connected) {
      await emit({
        ...(connectionId ? { connectionId } : {}),
        data: [],
        name: 'disconnect',
        origin,
      })
    }
    return
  }
  if (!before.connected) {
    await emit({
      ...(connectionId ? { connectionId } : {}),
      data: accountViews(after.accounts, profile.data.chains),
      name: 'connect',
      origin,
    })
  }
  if (
    before.accounts.length !== after.accounts.length ||
    before.accounts.some((account, index) => account !== after.accounts[index])
  ) {
    await emit({
      ...(connectionId ? { connectionId } : {}),
      data: accountViews(after.accounts, profile.data.chains),
      name: 'accountsChanged',
      origin,
    })
  }
}

type SnapshotConnection = {
  readonly accounts: readonly Identity.Preset[]
  readonly connected: boolean
  readonly id: string
  readonly origin: string
}

function parseSnapshot(
  snapshot: Json.Value,
  profile: Profile.Definition,
): readonly SnapshotConnection[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new InvalidProfileError('Solana wallet snapshot must be an object')
  }
  const record = snapshot as Record<string, Json.Value>
  if (record.schemaVersion !== 1 || !Array.isArray(record.connections)) {
    throw new InvalidProfileError('Solana wallet snapshot version is not supported')
  }
  const origins = new Set<string>()
  const ids = new Set<string>()
  return record.connections.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidProfileError('Solana snapshot contains an invalid connection')
    }
    const entry = value as Record<string, Json.Value>
    if (
      typeof entry.id !== 'string' ||
      typeof entry.origin !== 'string' ||
      typeof entry.connected !== 'boolean' ||
      !Array.isArray(entry.accounts) ||
      !entry.accounts.every((account) => typeof account === 'string')
    ) {
      throw new InvalidProfileError('Solana snapshot contains invalid connection fields')
    }
    if (origins.has(entry.origin) || ids.has(entry.id)) {
      throw new InvalidProfileError(
        'Solana snapshot connection identifiers must be unique',
      )
    }
    origins.add(entry.origin)
    ids.add(entry.id)
    const accounts = entry.accounts.map((accountId) => {
      const account = profile.data.accounts.find(
        (candidate) => candidate.id === accountId,
      )
      if (!account) {
        throw new InvalidProfileError(
          `Snapshot account ${accountId} is not part of ${profile.id}`,
        )
      }
      return account
    })
    if (new Set(accounts).size !== accounts.length) {
      throw new InvalidProfileError('Snapshot accounts must be unique')
    }
    return {
      accounts,
      connected: entry.connected,
      id: entry.id,
      origin: entry.origin,
    }
  })
}

function invalidParams(method: string): never {
  throw new InvalidParamsError(`Method ${method} received invalid parameters`)
}
