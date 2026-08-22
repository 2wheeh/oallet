import { type Environment, Json, type Profile } from '@oallet/core'
import type { BrowserContext } from '@playwright/test'

import {
  AlreadyAttachedError,
  ExistingPageError,
  InvalidRequestError,
  UnsupportedFrameError,
} from '../errors/errors.js'

const bindingName = '__oallet_request_v1__'
const attachedContexts = new WeakSet<BrowserContext>()

type BrowserProfile = {
  readonly icon?: string | undefined
  readonly id: string
  readonly kind: string
  readonly name: string
}

export type Handle = {
  readonly environment: Environment.Instance
  readonly profiles: readonly Profile.Definition[]
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
  try {
    await context.exposeBinding(bindingName, async (source, payload: unknown) => {
      if (source.frame !== source.page.mainFrame()) {
        throw new UnsupportedFrameError(
          'Oallet only accepts requests from top-level frames',
        )
      }
      const request = parseRequest(payload)
      const origin = new URL(source.frame.url()).origin
      if (origin === 'null') {
        throw new InvalidRequestError('Wallet requests require an http or https origin')
      }
      return environment.dispatch({
        method: request.method,
        origin,
        ...(request.params === undefined ? {} : { params: request.params }),
        walletId: request.walletId,
      })
    })
    const profiles: BrowserProfile[] = environment.profiles.map(
      ({ icon, id, kind, name }) => ({
        ...(icon === undefined ? {} : { icon }),
        id,
        kind,
        name,
      }),
    )
    await context.addInitScript(browserBootstrap, profiles)
  } catch (error) {
    attachedContexts.delete(context)
    throw error
  }
  return { environment, profiles: environment.profiles }
}

export declare namespace attach {
  type Options = {
    readonly context: BrowserContext
    readonly environment: Environment.Instance
  }
  type ReturnType = Handle
}

function parseRequest(value: unknown): {
  method: string
  params?: Json.Value | undefined
  walletId: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidRequestError('Browser request must be an object')
  }
  const request = value as Record<string, unknown>
  if (typeof request.walletId !== 'string' || typeof request.method !== 'string') {
    throw new InvalidRequestError('Browser request requires walletId and method')
  }
  if (request.params !== undefined) {
    try {
      Json.assert(request.params)
    } catch (cause) {
      throw new InvalidRequestError('Browser request params must be JSON data', { cause })
    }
  }
  return {
    method: request.method,
    ...(request.params === undefined ? {} : { params: request.params as Json.Value }),
    walletId: request.walletId,
  }
}

function browserBootstrap(profiles: readonly BrowserProfile[]) {
  if (globalThis.window !== globalThis.window.top) return
  const bridge = (
    globalThis as typeof globalThis & {
      __oallet_request_v1__(request: {
        method: string
        params?: unknown
        walletId: string
      }): Promise<unknown>
    }
  ).__oallet_request_v1__
  const fallbackIcon =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="black"/><circle cx="16" cy="16" r="6" fill="white"/></svg>'

  for (const profile of profiles) {
    if (profile.kind !== 'eip155:eoa') continue
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    let connected = false
    const emit = (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
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
        const result = await bridge({
          method: request.method,
          ...(request.params === undefined ? {} : { params: request.params }),
          walletId: profile.id,
        })
        if (request.method === 'eth_requestAccounts') {
          connected = true
          emit('accountsChanged', result)
          const chainId = await bridge({ method: 'eth_chainId', walletId: profile.id })
          emit('connect', { chainId })
        }
        if (
          request.method === 'wallet_switchEthereumChain' ||
          request.method === 'wallet_addEthereumChain'
        ) {
          const chainId = await bridge({ method: 'eth_chainId', walletId: profile.id })
          emit('chainChanged', chainId)
        }
        return result
      },
    }
    const detail = Object.freeze({
      info: Object.freeze({
        icon: profile.icon ?? fallbackIcon,
        name: profile.name,
        rdns: `dev.oallet.${profile.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
        uuid: crypto.randomUUID(),
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
    queueMicrotask(announce)
  }
}
