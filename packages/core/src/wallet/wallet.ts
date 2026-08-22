import type * as Json from '../json/json.js'
import type * as Profile from '../profile/profile.js'
import type * as Request from '../request/request.js'

export type Input = {
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
  reject?(reason: Error): void | Promise<void>
}

export type Preparation = Immediate | Interactive

export type Adapter = {
  readonly profile: Profile.Definition
  prepare(input: Input): Preparation | Promise<Preparation>
  reset(): void | Promise<void>
  restore(snapshot: Json.Value): void | Promise<void>
  snapshot(): Json.Value | Promise<Json.Value>
}

export type Instance = {
  readonly profile: Profile.Definition
  readonly requests: Request.Queue
  startAutoApprove(): () => void
}
