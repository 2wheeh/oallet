import { type Wallet as CoreWallet, Json } from '@oallet/core'
import {
  type Address,
  createWalletClient,
  type Hex,
  isAddressEqual,
  isHex,
  numberToHex,
} from 'viem'
import type * as Connection from '../connection/connection.js'
import {
  ChainNotConfiguredError,
  ConnectionDisposedError,
  ConnectionNotFoundError,
  InvalidParamsError,
  InvalidProfileError,
  ProviderDisconnectedError,
  StaleConnectionError,
  UnauthorizedError,
  UnsupportedMethodError,
} from '../errors/errors.js'
import * as Identity from '../identity/identity.js'
import type * as Profile from '../profile/eoa.js'
import * as Runtime from '../runtime/create.js'

export type Controls = {
  readonly connections: Connection.Collection
}

export type RequestResults = {
  readonly eth_requestAccounts: Connection.Instance
}

export type Instance = CoreWallet.Adapter<Controls, RequestResults> & {
  readonly profile: Profile.Definition
}

type ConnectionState = {
  status: 'active' | 'disposed' | 'stale'
  accounts: readonly Identity.Preset[]
  chainId: number
  connected: boolean
  handle: Connection.Instance
}

const readMethods = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getCode',
  'eth_getFilterChanges',
  'eth_getLogs',
  'eth_getProof',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'eth_newBlockFilter',
  'eth_newFilter',
  'eth_uninstallFilter',
  'net_version',
  'web3_clientVersion',
])

export function create(options: create.Options): Instance {
  const { profile } = options
  const runtime = Runtime.create({ chains: options.chains })
  let emit: CoreWallet.AdapterContext['emit'] = async () => undefined
  for (const chainId of profile.data.chains) runtime.get(chainId)
  const accounts = profile.data.accounts.map(Identity.account)
  const addresses = accounts.map((account) => account.address)
  const connections = new Map<string, ConnectionState>()
  let disposed = false
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

  const adapter: Instance = {
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
      const connection = getConnection(
        connections,
        profile,
        runtime,
        emit,
        input.origin,
        profile.data.defaultChainId,
      )
      ensureProviderConnected(connection)
      const requestChainId = resolveRequestChainId(input, connection, profile, runtime)
      if (input.method === 'eth_accounts') {
        return {
          type: 'return',
          value: connection.accounts.map((preset) => preset.address),
        }
      }
      if (input.method === 'eth_requestAccounts') {
        if (connection.accounts.length > 0) {
          return {
            type: 'return',
            value: connection.accounts.map((preset) => preset.address),
          }
        }
        return {
          type: 'interactive',
          async approve() {
            await connection.handle.setAccounts(profile.data.accounts)
            return addresses
          },
          controllerResult: () => connection.handle,
          data: { accounts: addresses, chainId: connection.chainId, type: 'connect' },
        }
      }
      if (input.method === 'eth_chainId') {
        return { type: 'return', value: numberToHex(requestChainId) }
      }
      if (input.method === 'wallet_addEthereumChain') {
        throw new UnsupportedMethodError(
          'wallet_addEthereumChain is not supported by this wallet',
        )
      }
      if (input.method === 'wallet_switchEthereumChain') {
        const chainId = chainIdParameter(input.params)
        if (!profile.data.chains.includes(chainId)) {
          throw new ChainNotConfiguredError(
            `Chain ${chainId} is not supported by ${profile.id}`,
          )
        }
        runtime.get(chainId)
        return {
          type: 'interactive',
          async approve() {
            await connection.handle.switchChain(chainId)
            return null
          },
          data: { chainId, type: 'switchChain' },
        }
      }
      if (input.method === 'personal_sign') {
        ensureAuthorizedConnection(connection)
        const [message, address] = tuple(input.params, 2)
        if (typeof message !== 'string' || typeof address !== 'string')
          invalidParams(input.method)
        const account = findAccount(accounts, address)
        ensureAuthorized(connection, account.address)
        return {
          type: 'interactive',
          approve: () =>
            account.signMessage({
              message: isHex(message) ? { raw: message } : message,
            }),
          data: { account: account.address, type: 'signMessage' },
        }
      }
      if (input.method === 'eth_signTypedData_v4') {
        ensureAuthorizedConnection(connection)
        const [address, encoded] = tuple(input.params, 2)
        if (typeof address !== 'string' || typeof encoded !== 'string')
          invalidParams(input.method)
        const account = findAccount(accounts, address)
        ensureAuthorized(connection, account.address)
        const typedData = parseJsonObject(encoded, input.method)
        return {
          type: 'interactive',
          approve: () => account.signTypedData(typedData as never),
          data: { account: account.address, type: 'signTypedData' },
        }
      }
      if (input.method === 'eth_sendTransaction') {
        ensureAuthorizedConnection(connection)
        const [transaction] = tuple(input.params, 1)
        if (
          !transaction ||
          typeof transaction !== 'object' ||
          Array.isArray(transaction)
        ) {
          invalidParams(input.method)
        }
        const request = transaction as Record<string, Json.Value>
        if (typeof request.from !== 'string') invalidParams(input.method)
        const account = findAccount(accounts, request.from)
        ensureAuthorized(connection, account.address)
        const binding = runtime.get(requestChainId)
        const transactionRequest = normalizeTransaction(request)
        if (
          transactionRequest.chainId !== undefined &&
          transactionRequest.chainId !== requestChainId
        ) {
          throw new ChainNotConfiguredError(
            `Transaction chain ${transactionRequest.chainId} does not match request chain ${requestChainId}`,
          )
        }
        return {
          type: 'interactive',
          async approve() {
            return createWalletClient({
              account,
              chain: binding.chain,
              transport: binding.transport,
            }).sendTransaction(transactionRequest as never)
          },
          data: {
            account: account.address,
            chainId: requestChainId,
            type: 'sendTransaction',
          },
        }
      }
      if (readMethods.has(input.method)) {
        const value = await runtime.request(requestChainId, {
          method: input.method,
          ...(input.params === undefined
            ? {}
            : { params: input.params as readonly unknown[] }),
        } as never)
        Json.assert(value)
        return { type: 'return', value }
      }
      throw new UnsupportedMethodError(`Method ${input.method} is not supported`)
    },
    async reset() {
      const before = new Map(
        [...connections].map(([origin, connection]) => [origin, view(connection)]),
      )
      for (const connection of connections.values()) {
        connection.connected = true
        connection.chainId = profile.data.defaultChainId
        connection.accounts = []
      }
      for (const origin of [...connections.keys()].sort()) {
        await emitDiff(
          emit,
          origin,
          before.get(origin) as ConnectionView,
          view(connections.get(origin) as ConnectionState),
        )
      }
    },
    async restore(snapshot) {
      const entries = parseSnapshot(snapshot, profile, runtime)
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
          existing.chainId = entry.chainId
          existing.connected = entry.connected
          continue
        }
        if (existing) existing.status = 'stale'
        connections.set(
          entry.origin,
          createConnection(
            profile,
            runtime,
            emit,
            entry.origin,
            entry.chainId,
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
          before.get(origin) ?? baselineView(profile),
          connections.has(origin)
            ? view(connections.get(origin) as ConnectionState)
            : baselineView(profile),
        )
      }
    },
    snapshot() {
      return {
        connections: [...connections]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([origin, connection]) => ({
            accounts: connection.accounts.map((account) => account.id),
            chainId: connection.chainId,
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
        accounts: connection?.accounts.map((preset) => preset.address) ?? [],
        chainId: numberToHex(connection?.chainId ?? profile.data.defaultChainId),
        connected: connection?.connected ?? true,
      }
    },
    validateSnapshot(snapshot) {
      parseSnapshot(snapshot, profile, runtime)
    },
  }
  return adapter
}

export declare namespace create {
  type Options = {
    readonly chains: readonly Runtime.ChainBinding[]
    readonly profile: Profile.Definition
  }
  type ReturnType = Instance
}

function getConnection(
  connections: Map<string, ConnectionState>,
  profile: Profile.Definition,
  runtime: Runtime.Instance,
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
  chainId: number,
) {
  let connection = connections.get(origin)
  if (!connection) {
    connection = createConnection(profile, runtime, emit, origin, chainId, [])
    connections.set(origin, connection)
  }
  return connection
}

function createConnection(
  profile: Pick<Profile.Definition, 'data' | 'id'>,
  runtime: Runtime.Instance,
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
  chainId: number,
  initialAccounts: readonly Identity.Preset[],
  connected: boolean = true,
  id: string = crypto.randomUUID(),
): ConnectionState {
  const connection: ConnectionState = {
    status: 'active',
    accounts: [...initialAccounts],
    chainId,
    connected,
    handle: undefined as never,
  }
  connection.handle = Object.freeze({
    async disconnect() {
      ensureActive(connection)
      if (!connection.connected) return
      connection.connected = false
      await emit({
        connectionId: connection.handle.id,
        data: { code: 4900, message: 'The provider is disconnected' },
        name: 'disconnect',
        origin,
      })
    },
    id,
    origin,
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
          data: nextAccounts.map((account) => account.address),
          name: 'accountsChanged',
          origin,
        })
      }
    },
    async switchChain(nextChainId) {
      ensureActive(connection)
      if (!profile.data.chains.includes(nextChainId)) {
        throw new ChainNotConfiguredError(
          `Chain ${nextChainId} is not supported by ${profile.id}`,
        )
      }
      runtime.get(nextChainId)
      if (connection.chainId === nextChainId) return
      connection.chainId = nextChainId
      if (connection.connected) {
        await emit({
          connectionId: connection.handle.id,
          data: numberToHex(nextChainId),
          name: 'chainChanged',
          origin,
        })
      }
    },
    async reconnect() {
      ensureActive(connection)
      if (connection.connected) return
      connection.connected = true
      await emit({
        connectionId: connection.handle.id,
        data: { chainId: numberToHex(connection.chainId) },
        name: 'connect',
        origin,
      })
    },
    walletId: profile.id,
  })
  return connection
}

function ensureActive(connection: ConnectionState) {
  if (connection.status === 'disposed')
    throw new ConnectionDisposedError('This connection handle is disposed')
  if (connection.status === 'stale')
    throw new StaleConnectionError('This connection handle is stale')
}

type ConnectionView = {
  readonly accounts: readonly Address[]
  readonly chainId: number
  readonly connectionId?: string | undefined
  readonly connected: boolean
}

function view(connection: ConnectionState): ConnectionView {
  return {
    accounts: connection.accounts.map((account) => account.address),
    chainId: connection.chainId,
    connectionId: connection.handle.id,
    connected: connection.connected,
  }
}

function baselineView(profile: Pick<Profile.Definition, 'data'>): ConnectionView {
  return {
    accounts: [],
    chainId: profile.data.defaultChainId,
    connected: true,
  }
}

async function emitDiff(
  emit: CoreWallet.AdapterContext['emit'],
  origin: string,
  before: ConnectionView,
  after: ConnectionView,
) {
  if (!after.connected) {
    if (before.connected) {
      await emit({
        ...((after.connectionId ?? before.connectionId)
          ? { connectionId: after.connectionId ?? before.connectionId }
          : {}),
        data: { code: 4900, message: 'The provider is disconnected' },
        name: 'disconnect',
        origin,
      })
    }
    return
  }
  if (!before.connected) {
    await emit({
      ...((after.connectionId ?? before.connectionId)
        ? { connectionId: after.connectionId ?? before.connectionId }
        : {}),
      data: { chainId: numberToHex(after.chainId) },
      name: 'connect',
      origin,
    })
  }
  if (before.chainId !== after.chainId) {
    await emit({
      ...((after.connectionId ?? before.connectionId)
        ? { connectionId: after.connectionId ?? before.connectionId }
        : {}),
      data: numberToHex(after.chainId),
      name: 'chainChanged',
      origin,
    })
  }
  if (
    before.accounts.length !== after.accounts.length ||
    before.accounts.some((account, index) => account !== after.accounts[index])
  ) {
    await emit({
      ...((after.connectionId ?? before.connectionId)
        ? { connectionId: after.connectionId ?? before.connectionId }
        : {}),
      data: after.accounts,
      name: 'accountsChanged',
      origin,
    })
  }
}

function ensureAuthorizedConnection(connection: ConnectionState) {
  if (connection.accounts.length === 0)
    throw new UnauthorizedError('The origin has not connected this wallet')
}

function ensureProviderConnected(connection: ConnectionState) {
  if (!connection.connected) {
    throw new ProviderDisconnectedError(
      'The provider is disconnected from all configured chains',
    )
  }
}

function ensureAuthorized(connection: ConnectionState, address: Address) {
  if (!connection.accounts.some((preset) => isAddressEqual(preset.address, address))) {
    throw new UnauthorizedError(`Account ${address} is not authorized for this origin`)
  }
}

type SnapshotConnection = {
  readonly accounts: readonly Identity.Preset[]
  readonly chainId: number
  readonly connected: boolean
  readonly id: string
  readonly origin: string
}

function parseSnapshot(
  snapshot: Json.Value,
  profile: Profile.Definition,
  runtime: Runtime.Instance,
): readonly SnapshotConnection[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new InvalidProfileError('EVM wallet snapshot must be an object')
  }
  const record = snapshot as Record<string, Json.Value>
  if (record.schemaVersion !== 1 || !Array.isArray(record.connections)) {
    throw new InvalidProfileError('EVM wallet snapshot version is not supported')
  }
  const origins = new Set<string>()
  const ids = new Set<string>()
  return record.connections.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidProfileError('EVM wallet snapshot contains an invalid connection')
    }
    const entry = value as Record<string, Json.Value>
    if (
      typeof entry.id !== 'string' ||
      typeof entry.origin !== 'string' ||
      typeof entry.connected !== 'boolean' ||
      typeof entry.chainId !== 'number' ||
      !Array.isArray(entry.accounts) ||
      !entry.accounts.every((account) => typeof account === 'string')
    ) {
      throw new InvalidProfileError(
        'EVM wallet snapshot contains invalid connection fields',
      )
    }
    if (origins.has(entry.origin) || ids.has(entry.id)) {
      throw new InvalidProfileError(
        'EVM wallet snapshot connection identifiers must be unique',
      )
    }
    origins.add(entry.origin)
    ids.add(entry.id)
    runtime.get(entry.chainId)
    if (!profile.data.chains.includes(entry.chainId)) {
      throw new InvalidProfileError(
        `Snapshot chain ${entry.chainId} is not supported by ${profile.id}`,
      )
    }
    const accountIds = entry.accounts as string[]
    const accounts = accountIds.map((id) => {
      const account = profile.data.accounts.find((candidate) => candidate.id === id)
      if (!account) {
        throw new InvalidProfileError(
          `Snapshot account ${id} is not part of ${profile.id}`,
        )
      }
      return account
    })
    if (new Set(accounts).size !== accounts.length) {
      throw new InvalidProfileError('Snapshot accounts must be unique')
    }
    return {
      accounts,
      chainId: entry.chainId,
      connected: entry.connected,
      id: entry.id,
      origin: entry.origin,
    }
  })
}

function tuple(
  params: Json.Value | undefined,
  minimumLength: number,
): readonly Json.Value[] {
  if (!Array.isArray(params) || params.length < minimumLength) invalidParams('request')
  return params
}

function resolveRequestChainId(
  input: CoreWallet.Input,
  connection: ConnectionState,
  profile: Profile.Definition,
  runtime: Runtime.Instance,
) {
  if (input.chainId === undefined) return connection.chainId
  const match = /^eip155:(\d+)$/.exec(input.chainId)
  const chainId = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new InvalidParamsError(
      `Request chain ${input.chainId} is not a valid EIP-155 chain`,
    )
  }
  if (!profile.data.chains.includes(chainId)) {
    throw new ChainNotConfiguredError(
      `Chain ${chainId} is not supported by ${profile.id}`,
    )
  }
  runtime.get(chainId)
  return chainId
}

function invalidParams(method: string): never {
  throw new InvalidParamsError(`Method ${method} received invalid parameters`)
}

function chainIdParameter(params: Json.Value | undefined) {
  const [parameter] = tuple(params, 1)
  if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
    invalidParams('wallet_switchEthereumChain')
  }
  const chainId = (parameter as Record<string, Json.Value>).chainId
  if (typeof chainId !== 'string' || !/^0x[0-9a-f]+$/i.test(chainId)) {
    invalidParams('wallet_switchEthereumChain')
  }
  return Number(BigInt(chainId))
}

function findAccount(accounts: ReturnType<typeof Identity.account>[], address: string) {
  const account = accounts.find((candidate) =>
    isAddressEqual(candidate.address, address as Address),
  )
  if (!account)
    throw new UnauthorizedError(`Account ${address} is not exposed by this wallet`)
  return account
}

function parseJsonObject(value: string, method: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      invalidParams(method)
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof InvalidParamsError) throw error
    throw new InvalidParamsError(`Method ${method} received invalid JSON`, {
      cause: error,
    })
  }
}

function normalizeTransaction(transaction: Record<string, Json.Value>) {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(transaction)) {
    if (key === 'from' || value === null) continue
    if (
      ['gas', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value'].includes(key)
    ) {
      if (typeof value !== 'string' || !isHex(value)) invalidParams('eth_sendTransaction')
      normalized[key] = BigInt(value)
      continue
    }
    if (key === 'nonce') {
      if (typeof value !== 'string' || !isHex(value)) invalidParams('eth_sendTransaction')
      normalized[key] = Number(BigInt(value))
      continue
    }
    if (key === 'chainId') {
      if (typeof value !== 'string' || !isHex(value)) invalidParams('eth_sendTransaction')
      normalized[key] = Number(BigInt(value))
      continue
    }
    if (key === 'type' && typeof value === 'string') {
      const types: Record<string, string> = {
        '0x0': 'legacy',
        '0x1': 'eip2930',
        '0x2': 'eip1559',
        '0x3': 'eip4844',
      }
      normalized[key] = types[value] ?? value
      continue
    }
    normalized[key] = value
  }
  return normalized as {
    chainId?: number | undefined
    data?: Hex | undefined
    to?: Address | undefined
  }
}
