import { type Wallet as CoreWallet, Json } from '@oallet/core'
import {
  type Address,
  createWalletClient,
  type Hex,
  isAddressEqual,
  isHex,
  numberToHex,
} from 'viem'

import {
  ChainNotConfiguredError,
  InvalidParamsError,
  InvalidProfileError,
  UnauthorizedError,
  UnsupportedMethodError,
} from '../errors/errors.js'
import * as Identity from '../identity/identity.js'
import type * as Profile from '../profile/eoa.js'
import type * as Runtime from '../runtime/create.js'

export type Instance = CoreWallet.Adapter & {
  readonly profile: Profile.Definition
}

type Connection = {
  chainId: number
  connected: boolean
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
  const { profile, runtime } = options
  for (const chainId of profile.data.chains) runtime.get(chainId)
  const accounts = profile.data.accounts.map(Identity.account)
  const addresses = accounts.map((account) => account.address)
  const connections = new Map<string, Connection>()

  const adapter: Instance = {
    profile,
    async prepare(input) {
      const connection = getConnection(
        connections,
        input.origin,
        profile.data.defaultChainId,
      )
      if (input.method === 'eth_accounts') {
        return { type: 'return', value: connection.connected ? addresses : [] }
      }
      if (input.method === 'eth_requestAccounts') {
        if (connection.connected) return { type: 'return', value: addresses }
        return {
          type: 'interactive',
          approve() {
            connection.connected = true
            return addresses
          },
          data: { accounts: addresses, chainId: connection.chainId, type: 'connect' },
        }
      }
      if (input.method === 'eth_chainId') {
        return { type: 'return', value: numberToHex(connection.chainId) }
      }
      if (
        input.method === 'wallet_switchEthereumChain' ||
        input.method === 'wallet_addEthereumChain'
      ) {
        const chainId = chainIdParameter(input.params)
        if (!profile.data.chains.includes(chainId)) {
          throw new ChainNotConfiguredError(
            `Chain ${chainId} is not supported by ${profile.id}`,
          )
        }
        runtime.get(chainId)
        return {
          type: 'interactive',
          approve() {
            connection.chainId = chainId
            return null
          },
          data: { chainId, type: 'switchChain' },
        }
      }
      if (input.method === 'personal_sign') {
        ensureConnected(connection)
        const [message, address] = tuple(input.params, 2)
        if (typeof message !== 'string' || typeof address !== 'string')
          invalidParams(input.method)
        const account = findAccount(accounts, address)
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
        ensureConnected(connection)
        const [address, encoded] = tuple(input.params, 2)
        if (typeof address !== 'string' || typeof encoded !== 'string')
          invalidParams(input.method)
        const account = findAccount(accounts, address)
        const typedData = parseJsonObject(encoded, input.method)
        return {
          type: 'interactive',
          approve: () => account.signTypedData(typedData as never),
          data: { account: account.address, type: 'signTypedData' },
        }
      }
      if (input.method === 'eth_sendTransaction') {
        ensureConnected(connection)
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
        const binding = runtime.get(connection.chainId)
        const transactionRequest = normalizeTransaction(request)
        if (
          transactionRequest.chainId !== undefined &&
          transactionRequest.chainId !== connection.chainId
        ) {
          throw new ChainNotConfiguredError(
            `Transaction chain ${transactionRequest.chainId} does not match active chain ${connection.chainId}`,
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
            chainId: connection.chainId,
            type: 'sendTransaction',
          },
        }
      }
      if (readMethods.has(input.method)) {
        const value = await runtime.request(connection.chainId, {
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
    reset() {
      connections.clear()
    },
    restore(snapshot) {
      if (!Array.isArray(snapshot))
        throw new InvalidProfileError('EVM wallet snapshot must be an array')
      connections.clear()
      for (const entry of snapshot) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new InvalidProfileError(
            'EVM wallet snapshot contains an invalid connection',
          )
        }
        const { chainId, connected, origin } = entry as Record<string, Json.Value>
        if (
          typeof origin !== 'string' ||
          typeof connected !== 'boolean' ||
          typeof chainId !== 'number'
        ) {
          throw new InvalidProfileError(
            'EVM wallet snapshot contains invalid connection fields',
          )
        }
        runtime.get(chainId)
        if (!profile.data.chains.includes(chainId)) {
          throw new InvalidProfileError(
            `Snapshot chain ${chainId} is not supported by ${profile.id}`,
          )
        }
        connections.set(origin, { chainId, connected })
      }
    },
    snapshot() {
      return [...connections]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([origin, connection]) => ({ origin, ...connection }))
    },
  }
  return adapter
}

export declare namespace create {
  type Options = {
    readonly profile: Profile.Definition
    readonly runtime: Runtime.Instance
  }
  type ReturnType = Instance
}

function getConnection(
  connections: Map<string, Connection>,
  origin: string,
  chainId: number,
) {
  let connection = connections.get(origin)
  if (!connection) {
    connection = { chainId, connected: false }
    connections.set(origin, connection)
  }
  return connection
}

function ensureConnected(connection: Connection) {
  if (!connection.connected)
    throw new UnauthorizedError('The origin has not connected this wallet')
}

function tuple(
  params: Json.Value | undefined,
  minimumLength: number,
): readonly Json.Value[] {
  if (!Array.isArray(params) || params.length < minimumLength) invalidParams('request')
  return params
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
