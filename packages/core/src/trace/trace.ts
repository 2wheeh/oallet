import type * as Json from '../json/json.js'

export type Error = {
  readonly code?: string | number | undefined
  readonly data?: Json.Value | undefined
  readonly message: string
  readonly name: string
}

type Base = {
  readonly sequence: number
  readonly timestamp: number
  readonly type: string
}

type RequestBase = Base & {
  readonly method: string
  readonly origin: string
  readonly providerSessionId?: string | undefined
  readonly requestId: string
  readonly walletId: string
}

export type RequestReceived = RequestBase & {
  readonly params?: Json.Value | undefined
  readonly type: 'request.received'
}

export type RequestApproved = RequestBase & {
  readonly result: Json.Value
  readonly type: 'request.approved'
}

export type RequestRejected = RequestBase & {
  readonly error: Error
  readonly type: 'request.rejected'
}

export type RequestReturned = RequestBase & {
  readonly result: Json.Value
  readonly type: 'request.returned'
}

export type RequestFailed = RequestBase & {
  readonly error: Error
  readonly type: 'request.failed'
}

export type RequestCancelled = RequestBase & {
  readonly reason: 'disposed' | 'provider-session-ended' | 'reset' | 'restore'
  readonly type: 'request.cancelled'
}

type ConnectionBase = Base & {
  readonly connectionId?: string | undefined
  readonly data?: Json.Value | undefined
  readonly origin: string
  readonly walletId: string
}

export type ConnectionEvent = ConnectionBase & {
  readonly type:
    | 'connection.accountsChanged'
    | 'connection.chainChanged'
    | 'connection.connected'
    | 'connection.disconnected'
}

export type ProviderEvent = Base & {
  readonly data?: Json.Value | undefined
  readonly name: string
  readonly origin: string
  readonly providerSessionId: string
  readonly type: 'provider.deliveryFailed' | 'provider.eventDelivered'
  readonly walletId: string
}

export type EnvironmentEvent = Base & {
  readonly type:
    | 'environment.disposed'
    | 'environment.reset'
    | 'environment.restored'
    | 'environment.snapshot'
}

export type Event =
  | ConnectionEvent
  | EnvironmentEvent
  | ProviderEvent
  | RequestApproved
  | RequestCancelled
  | RequestFailed
  | RequestReceived
  | RequestRejected
  | RequestReturned

export type Input<EventType extends Event = Event> = EventType extends Event
  ? Omit<EventType, 'sequence' | 'timestamp'>
  : never

export type Artifact = {
  readonly environmentId: string
  readonly events: readonly Event[]
  readonly schemaVersion: 1
  readonly startedAt: number
}
