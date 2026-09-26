import type { Json } from '@oallet/core'
import { announceProvider, type EIP1193Provider, type EIP6963ProviderInfo } from 'mipd'
import * as Provider from 'ox/Provider'
import { v4 as uuid } from 'uuid'

import {
  type BrowserGlobals,
  type BrowserProfile,
  bindingName,
  type RequestResponse,
} from './protocol.js'

export function bootstrap(profiles: readonly BrowserProfile[]) {
  if (globalThis.window !== globalThis.window.top) return
  if (!['http:', 'https:'].includes(globalThis.location.protocol)) return
  type Emit = (name: string, data?: unknown) => void
  const emitters = new Map<string, Emit>()
  const globals = globalThis as BrowserGlobals
  const bridge = globals[bindingName]
  globals.__oallet_emit_v1__ = (providerSessionId, name, data) => {
    const emit = emitters.get(providerSessionId)
    if (!emit) return false
    emit(name, data)
    return true
  }
  const fallbackIcon =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="black"/><circle cx="16" cy="16" r="6" fill="white"/></svg>'

  const walletStandardFallbackIcon =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIvPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjYiIGZpbGw9IndoaXRlIi8+PC9zdmc+'

  for (const profile of profiles) {
    if (profile.kind === 'solana:keypair') {
      const data =
        profile.data && typeof profile.data === 'object' && !Array.isArray(profile.data)
          ? (profile.data as Record<string, Json.Value>)
          : undefined
      const chains = Array.isArray(data?.chains)
        ? data.chains.filter((chain): chain is string => typeof chain === 'string')
        : []
      if (chains.length === 0) continue
      const providerSessionId = uuid()
      type StandardAccount = {
        readonly address: string
        readonly chains: readonly string[]
        readonly features: readonly string[]
        readonly label?: string | undefined
        readonly publicKey: Uint8Array
      }
      type StandardChange = { readonly accounts?: readonly StandardAccount[] }
      const listeners = new Set<(change: StandardChange) => void>()
      let accounts: readonly StandardAccount[] = []
      const toAccounts = (value: unknown): readonly StandardAccount[] => {
        if (!Array.isArray(value))
          throw new Error('Oallet returned invalid Solana accounts')
        return Object.freeze(
          value.map((candidate) => {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
              throw new Error('Oallet returned an invalid Solana account')
            }
            const account = candidate as Record<string, unknown>
            if (
              typeof account.address !== 'string' ||
              !Array.isArray(account.chains) ||
              !account.chains.every((chain) => typeof chain === 'string') ||
              !Array.isArray(account.features) ||
              !account.features.every((feature) => typeof feature === 'string') ||
              !Array.isArray(account.publicKey) ||
              !account.publicKey.every(
                (byte) =>
                  typeof byte === 'number' &&
                  Number.isInteger(byte) &&
                  byte >= 0 &&
                  byte <= 255,
              )
            ) {
              throw new Error('Oallet returned invalid Solana account fields')
            }
            return Object.freeze({
              address: account.address,
              chains: Object.freeze([...account.chains] as string[]),
              features: Object.freeze([...account.features] as string[]),
              ...(typeof account.label === 'string' ? { label: account.label } : {}),
              publicKey: new Uint8Array(account.publicKey),
            })
          }),
        )
      }
      const updateAccounts = (value: unknown) => {
        accounts = toAccounts(value)
        for (const listener of listeners) listener({ accounts })
      }
      emitters.set(providerSessionId, (event, data) => {
        if (event === 'accountsChanged' || event === 'connect') updateAccounts(data)
        if (event === 'disconnect') updateAccounts([])
      })
      const call = async (method: string, params?: Json.Value) => {
        await ready
        const requestId = uuid()
        const response = (await bridge({
          method,
          ...(params === undefined ? {} : { params }),
          protocolVersion: 1,
          providerSessionId,
          requestId,
          type: 'request',
          walletId: profile.id,
        })) as RequestResponse
        if (response.protocolVersion !== 1 || response.requestId !== requestId) {
          throw new Error('Oallet returned an invalid browser response')
        }
        if (response.error) {
          throw Object.assign(new Error(response.error.message), {
            code: response.error.code,
            ...(response.error.data === undefined ? {} : { data: response.error.data }),
          })
        }
        return response.result
      }
      const wallet = Object.freeze({
        get accounts() {
          return accounts
        },
        chains: Object.freeze(chains),
        features: Object.freeze({
          ...(profile.features?.includes('solana:signAndSendTransaction')
            ? {
                'solana:signAndSendTransaction': Object.freeze({
                  async signAndSendTransaction(
                    ...inputs: readonly {
                      readonly account: StandardAccount
                      readonly chain: string
                      readonly transaction: Uint8Array
                      readonly options?: {
                        readonly commitment?: 'processed' | 'confirmed' | 'finalized'
                        readonly preflightCommitment?:
                          | 'processed'
                          | 'confirmed'
                          | 'finalized'
                        readonly minContextSlot?: number
                        readonly maxRetries?: number
                        readonly skipPreflight?: boolean
                      }
                    }[]
                  ) {
                    const result = await call(
                      'solana:signAndSendTransaction',
                      inputs.map((input) => ({
                        address: input.account.address,
                        chain: input.chain,
                        transaction: [...input.transaction],
                        ...(input.options === undefined
                          ? {}
                          : { options: input.options }),
                      })),
                    )
                    if (!Array.isArray(result) || result.length !== inputs.length) {
                      throw new Error(
                        'Oallet returned invalid Solana transaction signatures',
                      )
                    }
                    return result.map((candidate) => {
                      if (
                        !candidate ||
                        typeof candidate !== 'object' ||
                        Array.isArray(candidate)
                      ) {
                        throw new Error(
                          'Oallet returned an invalid Solana transaction signature',
                        )
                      }
                      const signature = (candidate as Record<string, unknown>).signature
                      if (
                        !Array.isArray(signature) ||
                        signature.length !== 64 ||
                        !signature.every(
                          (byte) =>
                            typeof byte === 'number' &&
                            Number.isInteger(byte) &&
                            byte >= 0 &&
                            byte <= 255,
                        )
                      ) {
                        throw new Error(
                          'Oallet returned invalid Solana transaction signature bytes',
                        )
                      }
                      return Object.freeze({ signature: new Uint8Array(signature) })
                    })
                  },
                  supportedTransactionVersions: Object.freeze([
                    'legacy' as const,
                    0 as const,
                  ]),
                  version: '1.0.0',
                }),
              }
            : {}),
          'solana:signTransaction': Object.freeze({
            async signTransaction(
              ...inputs: readonly {
                readonly account: StandardAccount
                readonly chain?: string
                readonly transaction: Uint8Array
              }[]
            ) {
              const result = await call(
                'solana:signTransaction',
                inputs.map((input) => ({
                  address: input.account.address,
                  ...(input.chain === undefined ? {} : { chain: input.chain }),
                  transaction: [...input.transaction],
                })),
              )
              if (!Array.isArray(result)) {
                throw new Error('Oallet returned invalid signed Solana transactions')
              }
              return result.map((candidate) => {
                if (
                  !candidate ||
                  typeof candidate !== 'object' ||
                  Array.isArray(candidate)
                ) {
                  throw new Error('Oallet returned an invalid signed Solana transaction')
                }
                const output = candidate as Record<string, unknown>
                if (!Array.isArray(output.signedTransaction)) {
                  throw new Error('Oallet returned invalid signed transaction fields')
                }
                return Object.freeze({
                  signedTransaction: new Uint8Array(output.signedTransaction as number[]),
                })
              })
            },
            supportedTransactionVersions: Object.freeze(['legacy' as const, 0 as const]),
            version: '1.0.0',
          }),
          'solana:signMessage': Object.freeze({
            async signMessage(
              ...inputs: readonly {
                readonly account: StandardAccount
                readonly message: Uint8Array
              }[]
            ) {
              const result = await call(
                'solana:signMessage',
                inputs.map((input) => ({
                  address: input.account.address,
                  message: [...input.message],
                })),
              )
              if (!Array.isArray(result)) {
                throw new Error('Oallet returned invalid Solana signatures')
              }
              return result.map((candidate) => {
                if (
                  !candidate ||
                  typeof candidate !== 'object' ||
                  Array.isArray(candidate)
                ) {
                  throw new Error('Oallet returned an invalid Solana signature')
                }
                const output = candidate as Record<string, unknown>
                if (
                  !Array.isArray(output.signature) ||
                  !Array.isArray(output.signedMessage)
                ) {
                  throw new Error('Oallet returned invalid Solana signature fields')
                }
                return Object.freeze({
                  signature: new Uint8Array(output.signature as number[]),
                  signatureType: 'ed25519' as const,
                  signedMessage: new Uint8Array(output.signedMessage as number[]),
                })
              })
            },
            version: '1.1.0',
          }),
          'standard:connect': Object.freeze({
            async connect(input?: { readonly silent?: boolean }) {
              accounts = toAccounts(
                await call(
                  'standard:connect',
                  input === undefined ? [] : [input as Json.Value],
                ),
              )
              return { accounts }
            },
            version: '1.0.0',
          }),
          'standard:disconnect': Object.freeze({
            async disconnect() {
              await call('standard:disconnect')
              accounts = []
            },
            version: '1.0.0',
          }),
          'standard:events': Object.freeze({
            on(event: string, listener: (change: StandardChange) => void) {
              if (event !== 'change') throw new Error(`Unsupported event ${event}`)
              listeners.add(listener)
              return () => listeners.delete(listener)
            },
            version: '1.0.0',
          }),
        }),
        icon:
          profile.icon?.startsWith('data:image/') && profile.icon.includes(';base64,')
            ? profile.icon
            : walletStandardFallbackIcon,
        name: profile.name,
        version: '1.0.0',
      })
      const register = (api: unknown) => {
        if (!api || typeof api !== 'object' || !('register' in api)) return
        const registerWallet = (api as { register(wallet: unknown): void }).register
        registerWallet(wallet)
      }
      const announce = () => {
        const callback = (api: unknown) => register(api)
        globalThis.window.dispatchEvent(
          new CustomEvent('wallet-standard:register-wallet', { detail: callback }),
        )
      }
      globalThis.window.addEventListener('wallet-standard:app-ready', ((
        event: CustomEvent,
      ) => register(event.detail)) as EventListener)
      const ready = bridge({
        protocolVersion: 1,
        providerSessionId,
        type: 'register',
        walletId: profile.id,
      }).then((state) => {
        if (state && typeof state === 'object' && 'accounts' in state) {
          updateAccounts((state as { accounts: unknown }).accounts)
        }
      })
      announce()
      continue
    }
    if (profile.kind !== 'eip155:eoa') continue
    const providerSessionId = uuid()
    const emitter = Provider.createEmitter()
    let connected = true
    const emit = (event: string, data?: unknown) => {
      if (event === 'connect') connected = true
      if (event === 'disconnect') connected = false
      emitter.emit(event, data)
    }
    emitters.set(providerSessionId, emit)
    let ready: Promise<void>
    const provider = {
      isConnected: () => connected,
      on(event: string, listener: (...args: unknown[]) => void) {
        emitter.on(event, listener)
        return provider
      },
      removeListener(event: string, listener: (...args: unknown[]) => void) {
        emitter.removeListener(event, listener)
        return provider
      },
      async request(request: { method: string; params?: unknown }) {
        if (!request || typeof request.method !== 'string') {
          throw new Error('EIP-1193 request requires a method')
        }
        await ready
        const requestId = uuid()
        const response = (await bridge({
          method: request.method,
          ...(request.params === undefined
            ? {}
            : { params: request.params as Json.Value }),
          protocolVersion: 1,
          providerSessionId,
          requestId,
          type: 'request',
          walletId: profile.id,
        })) as RequestResponse
        if (response.protocolVersion !== 1 || response.requestId !== requestId) {
          throw new Error('Oallet returned an invalid browser response')
        }
        if (response.error) {
          throw Object.assign(new Error(response.error.message), {
            code: response.error.code,
            ...(response.error.data === undefined ? {} : { data: response.error.data }),
          })
        }
        return response.result
      },
    }
    const detail = Object.freeze({
      info: Object.freeze({
        icon: (profile.icon ?? fallbackIcon) as EIP6963ProviderInfo['icon'],
        name: profile.name,
        rdns:
          profile.rdns ??
          `dev.oallet.${profile.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
        uuid: providerSessionId,
      }),
      provider: provider as EIP1193Provider,
    })
    ready = bridge({
      protocolVersion: 1,
      providerSessionId,
      type: 'register',
      walletId: profile.id,
    }).then((state) => {
      if (state && typeof state === 'object' && 'connected' in state) {
        connected = state.connected === true
      }
      announceProvider(detail)
      if (
        connected &&
        state &&
        typeof state === 'object' &&
        'chainId' in state &&
        typeof state.chainId === 'string'
      ) {
        const { chainId } = state
        // Allow microtask-based listener setup during discovery, as used by Wagmi.
        // Later discovery requests do not replay this initial connection event.
        queueMicrotask(() => emit('connect', { chainId }))
      }
    })
  }
}
