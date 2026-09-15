import type { Json } from '@oallet/core'
import { announceProvider, type EIP1193Provider, type EIP6963ProviderInfo } from 'mipd'
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

  for (const profile of profiles) {
    if (profile.kind !== 'eip155:eoa') continue
    const providerSessionId = uuid()
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
        // Let discovery consumers attach their provider listeners first.
        queueMicrotask(() => emit('connect', { chainId }))
      }
    })
  }
}
