import type { Json } from '@oallet/core'

export const bindingName = '__oallet_bridge_v1__'

export type BrowserProfile = {
  readonly icon?: string | undefined
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly rdns?: string | undefined
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

export type BridgeMessage = RegisterMessage | RequestMessage

export type RequestResponse = {
  readonly error?: {
    readonly code: number
    readonly data?: Json.Value | undefined
    readonly message: string
  }
  readonly protocolVersion: 1
  readonly requestId: string
  readonly result?: Json.Value | undefined
}

export type BrowserGlobals = typeof globalThis & {
  __oallet_bridge_v1__(message: BridgeMessage): Promise<unknown>
  __oallet_emit_v1__?: (
    providerSessionId: string,
    name: string,
    data?: unknown,
  ) => boolean
}
