import { Environment, Json, type Profile } from '@oallet/core'
import type { BrowserContext, Frame, Page } from '@playwright/test'

import {
  AlreadyAttachedError,
  DeliveryError,
  ExistingPageError,
  InvalidRequestError,
  UnsupportedFrameError,
} from '../errors/errors.js'

const bindingName = '__oallet_bridge_v1__'
const attachedContexts = new WeakSet<BrowserContext>()

type BrowserProfile = {
  readonly data: Json.Value
  readonly icon?: string | undefined
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly rdns?: string | undefined
}

type ProviderSession = {
  readonly frame: Frame
  readonly origin: string
  readonly pending: Map<string, AbortController>
  readonly walletId: string
}

type RegisterMessage = {
  readonly protocolVersion: 1
  readonly providerSessionId: string
  readonly type: 'register'
  readonly walletId: string
}

type RequestMessage = {
  readonly method: string
  readonly params?: Json.Value | undefined
  readonly protocolVersion: 1
  readonly providerSessionId: string
  readonly requestId: string
  readonly type: 'request'
  readonly walletId: string
}

type BridgeMessage = RegisterMessage | RequestMessage

type RequestResponse = {
  readonly error?: {
    readonly code: number
    readonly data?: Json.Value | undefined
    readonly message: string
  }
  readonly protocolVersion: 1
  readonly requestId: string
  readonly result?: Json.Value | undefined
}

type EnvironmentPort = {
  readonly [Environment.controller]: Environment.Controller
  readonly profiles: readonly Profile.Definition[]
  dispatch(input: Environment.DispatchInput): Promise<Json.Value>
}

export type Handle = {
  readonly environment: EnvironmentPort
  readonly profiles: readonly Profile.Definition[]
  dispose(): Promise<void>
}

export async function attach(options: attach.Options): Promise<Handle> {
  const { context, environment } = options
  if (attachedContexts.has(context)) {
    throw new AlreadyAttachedError('This browser context already has an Oallet bridge')
  }
  if (context.pages().length > 0) {
    throw new ExistingPageError(
      'Attach Oallet before creating a page so discovery runs before app code',
    )
  }
  attachedContexts.add(context)
  const sessions = new Map<string, ProviderSession>()
  const endSession = (providerSessionId: string) => {
    const session = sessions.get(providerSessionId)
    if (!session) return
    sessions.delete(providerSessionId)
    for (const controller of session.pending.values()) controller.abort()
    session.pending.clear()
  }
  const endFrame = (frame: Frame) => {
    for (const [providerSessionId, session] of sessions) {
      if (session.frame === frame) endSession(providerSessionId)
    }
  }
  const observePage = (page: Page) => {
    page.on('close', () => endFrame(page.mainFrame()))
  }
  context.on('page', observePage)
  let unsubscribe: () => void = () => undefined
  try {
    await context.exposeBinding(bindingName, async (source, payload: unknown) => {
      if (source.frame !== source.page.mainFrame()) {
        throw new UnsupportedFrameError(
          'Oallet only accepts requests from top-level frames',
        )
      }
      const message = parseMessage(payload)
      const origin = frameOrigin(source.frame)
      if (message.type === 'register') {
        for (const [id, session] of sessions) {
          if (session.frame === source.frame && session.walletId === message.walletId) {
            endSession(id)
          }
        }
        sessions.set(message.providerSessionId, {
          frame: source.frame,
          origin,
          pending: new Map(),
          walletId: message.walletId,
        })
        return environment[Environment.controller].state(message.walletId, origin)
      }
      const session = sessions.get(message.providerSessionId)
      if (
        !session ||
        session.frame !== source.frame ||
        session.origin !== origin ||
        session.walletId !== message.walletId
      ) {
        throw new InvalidRequestError('Browser request provider session is not active')
      }
      const abort = new AbortController()
      session.pending.set(message.requestId, abort)
      try {
        const result = await environment.dispatch({
          method: message.method,
          origin,
          ...(message.params === undefined ? {} : { params: message.params }),
          providerSessionId: message.providerSessionId,
          requestId: message.requestId,
          signal: abort.signal,
          walletId: message.walletId,
        })
        return {
          protocolVersion: 1,
          requestId: message.requestId,
          result,
        } satisfies RequestResponse
      } catch (error) {
        return {
          error: providerError(error),
          protocolVersion: 1,
          requestId: message.requestId,
        } satisfies RequestResponse
      } finally {
        session.pending.delete(message.requestId)
      }
    })
    unsubscribe = environment[Environment.controller].subscribe(async (event) => {
      const targets = [...sessions].filter(
        ([, session]) =>
          session.walletId === event.walletId && session.origin === event.origin,
      )
      await Promise.all(
        targets.map(async ([providerSessionId, session]) => {
          if (session.frame.isDetached() || session.frame.page().isClosed()) {
            endSession(providerSessionId)
            return
          }
          let delivered: boolean
          try {
            delivered = await session.frame.evaluate(
              ({ name, providerSessionId, serializedData }) => {
                const deliver = (
                  globalThis as typeof globalThis & {
                    __oallet_emit_v1__?: (
                      providerSessionId: string,
                      name: string,
                      data?: unknown,
                    ) => boolean
                  }
                ).__oallet_emit_v1__
                return (
                  deliver?.(
                    providerSessionId,
                    name,
                    serializedData === undefined ? undefined : JSON.parse(serializedData),
                  ) ?? false
                )
              },
              {
                name: event.name,
                providerSessionId,
                ...(event.data === undefined
                  ? {}
                  : { serializedData: JSON.stringify(event.data) }),
              },
            )
          } catch (error) {
            if (
              !sessions.has(providerSessionId) ||
              session.frame.isDetached() ||
              session.frame.page().isClosed()
            ) {
              endSession(providerSessionId)
              return
            }
            environment[Environment.controller].delivery({
              data: {
                message: error instanceof Error ? error.message : String(error),
              },
              delivered: false,
              name: event.name,
              origin: event.origin,
              providerSessionId,
              walletId: event.walletId,
            })
            throw new DeliveryError(
              `Failed to deliver ${event.name} to provider session ${providerSessionId}`,
              { cause: error },
            )
          }
          if (!delivered) {
            environment[Environment.controller].delivery({
              data: { message: 'The provider did not acknowledge the event' },
              delivered: false,
              name: event.name,
              origin: event.origin,
              providerSessionId,
              walletId: event.walletId,
            })
            endSession(providerSessionId)
            throw new DeliveryError(
              `Provider session ${providerSessionId} did not acknowledge ${event.name}`,
            )
          }
          environment[Environment.controller].delivery({
            ...(event.data === undefined ? {} : { data: event.data }),
            delivered: true,
            name: event.name,
            origin: event.origin,
            providerSessionId,
            walletId: event.walletId,
          })
        }),
      )
    })
    const profiles: BrowserProfile[] = environment.profiles.map(
      ({ data, icon, id, kind, name, rdns }) => ({
        data,
        ...(icon === undefined ? {} : { icon }),
        id,
        kind,
        name,
        ...(rdns === undefined ? {} : { rdns }),
      }),
    )
    await context.addInitScript(browserBootstrap, JSON.stringify(profiles))
  } catch (error) {
    unsubscribe()
    attachedContexts.delete(context)
    throw error
  }
  let active = true
  return {
    async dispose() {
      if (!active) return
      active = false
      context.off('page', observePage)
      unsubscribe()
      for (const providerSessionId of [...sessions.keys()]) {
        endSession(providerSessionId)
      }
    },
    environment,
    profiles: environment.profiles,
  }
}

export declare namespace attach {
  type Options = {
    readonly context: BrowserContext
    readonly environment: EnvironmentPort
  }
  type ReturnType = Handle
}

function frameOrigin(frame: Frame) {
  const origin = new URL(frame.url()).origin
  if (origin === 'null') {
    throw new InvalidRequestError('Wallet requests require an http or https origin')
  }
  return origin
}

function parseMessage(value: unknown): BridgeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidRequestError('Browser bridge message must be an object')
  }
  const message = value as Record<string, unknown>
  if (message.protocolVersion !== 1) {
    throw new InvalidRequestError('Unsupported browser bridge protocol version')
  }
  if (
    typeof message.providerSessionId !== 'string' ||
    typeof message.walletId !== 'string'
  ) {
    throw new InvalidRequestError(
      'Browser bridge message requires providerSessionId and walletId',
    )
  }
  if (message.type === 'register') {
    return {
      protocolVersion: 1,
      providerSessionId: message.providerSessionId,
      type: 'register',
      walletId: message.walletId,
    }
  }
  if (
    message.type !== 'request' ||
    typeof message.requestId !== 'string' ||
    typeof message.method !== 'string'
  ) {
    throw new InvalidRequestError(
      'Browser request requires requestId, walletId, and method',
    )
  }
  if (message.params !== undefined) {
    try {
      Json.assert(message.params)
    } catch (cause) {
      throw new InvalidRequestError('Browser request params must be JSON data', { cause })
    }
  }
  return {
    method: message.method,
    ...(message.params === undefined ? {} : { params: message.params as Json.Value }),
    protocolVersion: 1,
    providerSessionId: message.providerSessionId,
    requestId: message.requestId,
    type: 'request',
    walletId: message.walletId,
  }
}

function providerError(error: unknown): NonNullable<RequestResponse['error']> {
  const candidate = error as {
    readonly code?: unknown
    readonly data?: unknown
    readonly message?: unknown
    readonly providerCode?: unknown
  }
  const code =
    typeof candidate.providerCode === 'number'
      ? candidate.providerCode
      : typeof candidate.code === 'number'
        ? candidate.code
        : -32603
  return {
    code,
    ...(Json.isValue(candidate.data) ? { data: candidate.data } : {}),
    message:
      typeof candidate.message === 'string'
        ? candidate.message
        : 'The wallet request failed',
  }
}

function browserBootstrap(profilesJson: string) {
  const profiles = JSON.parse(profilesJson) as readonly BrowserProfile[]
  if (globalThis.window !== globalThis.window.top) return
  if (!['http:', 'https:'].includes(globalThis.location.protocol)) return
  const randomUuid = () => {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes.at(6) ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes.at(8) ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  type Emit = (name: string, data?: unknown) => void
  const emitters = new Map<string, Emit>()
  const bridge = (
    globalThis as typeof globalThis & {
      __oallet_bridge_v1__(message: BridgeMessage): Promise<unknown>
      __oallet_emit_v1__?: (
        providerSessionId: string,
        name: string,
        data?: unknown,
      ) => boolean
    }
  ).__oallet_bridge_v1__
  ;(
    globalThis as typeof globalThis & {
      __oallet_emit_v1__?: (
        providerSessionId: string,
        name: string,
        data?: unknown,
      ) => boolean
    }
  ).__oallet_emit_v1__ = (providerSessionId, name, data) => {
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
      const providerSessionId = randomUuid()
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
        const requestId = randomUuid()
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
          'solana:signTransaction': Object.freeze({
            async signTransaction(
              ...inputs: readonly {
                readonly account: StandardAccount
                readonly chain: string
                readonly transaction: Uint8Array
              }[]
            ) {
              const result = await call(
                'solana:signTransaction',
                inputs.map((input) => ({
                  address: input.account.address,
                  chain: input.chain,
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
          accounts = toAccounts((state as { accounts: unknown }).accounts)
        }
      })
      announce()
      continue
    }
    if (profile.kind !== 'eip155:eoa') continue
    const providerSessionId = randomUuid()
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    let connected = true
    const emit = (event: string, data?: unknown) => {
      if (event === 'connect') connected = true
      if (event === 'disconnect') connected = false
      for (const listener of listeners.get(event) ?? []) listener(data)
    }
    emitters.set(providerSessionId, emit)
    let ready: Promise<void>
    const provider = {
      isConnected: () => connected,
      on(event: string, listener: (...args: unknown[]) => void) {
        const set = listeners.get(event) ?? new Set()
        set.add(listener)
        listeners.set(event, set)
        return provider
      },
      removeListener(event: string, listener: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(listener)
        return provider
      },
      async request(request: { method: string; params?: unknown }) {
        if (!request || typeof request.method !== 'string') {
          throw new Error('EIP-1193 request requires a method')
        }
        await ready
        const requestId = randomUuid()
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
        icon: profile.icon ?? fallbackIcon,
        name: profile.name,
        rdns:
          profile.rdns ??
          `dev.oallet.${profile.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
        uuid: providerSessionId,
      }),
      provider,
    })
    const announce = () =>
      globalThis.window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail,
        }),
      )
    globalThis.window.addEventListener('eip6963:requestProvider', announce)
    ready = bridge({
      protocolVersion: 1,
      providerSessionId,
      type: 'register',
      walletId: profile.id,
    }).then((state) => {
      if (state && typeof state === 'object' && 'connected' in state) {
        connected = state.connected === true
      }
      queueMicrotask(announce)
    })
  }
}
