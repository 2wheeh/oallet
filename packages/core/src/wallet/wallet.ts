import type * as Json from '../json/json.js'
import type * as Profile from '../profile/profile.js'
import type * as Request from '../request/request.js'

export type Input = {
  readonly chainId?: string | undefined
  readonly method: string
  readonly origin: string
  readonly params?: Json.Value | undefined
}

export type Immediate = {
  readonly type: 'return'
  readonly value: Json.Value
}

export type Interactive = {
  readonly type: 'interactive'
  readonly data: Json.Value
  approve(): Json.Value | Promise<Json.Value>
  controllerResult?(response: Json.Value): unknown
  reject?(reason: Error): void | Promise<void>
}

export type Preparation = Immediate | Interactive

export type ProviderEventName =
  | 'accountsChanged'
  | 'chainChanged'
  | 'connect'
  | 'disconnect'

export type ProviderEvent = {
  readonly connectionId?: string | undefined
  readonly data?: Json.Value | undefined
  readonly name: ProviderEventName
  readonly origin: string
}

export type AdapterContext = {
  emit(event: ProviderEvent): Promise<void>
}

export type Adapter<Controls extends object = object, Results extends object = object> = {
  readonly controls?: Controls | undefined
  readonly profile: Profile.Definition
  readonly requestResults?: Results | undefined
  bind?(context: AdapterContext): void
  dispose?(): void | Promise<void>
  prepare(input: Input): Preparation | Promise<Preparation>
  reset(): void | Promise<void>
  restore(snapshot: Json.Value): void | Promise<void>
  snapshot(): Json.Value | Promise<Json.Value>
  state?(origin: string): Json.Value
  validateSnapshot(snapshot: Json.Value): void
}

export type Instance<
  Controls extends object = object,
  Results extends object = object,
> = Controls & {
  readonly profile: Profile.Definition
  readonly requests: Request.Queue<Results>
  autoApprove<Result>(callback: () => Result | Promise<Result>): Promise<Result>
}
