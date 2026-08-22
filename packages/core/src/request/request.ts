import type * as Json from '../json/json.js'

export type Status = 'approved' | 'pending' | 'rejected'

export type Handle<Result extends Json.Value = Json.Value> = {
  readonly data: Json.Value
  readonly id: string
  readonly method: string
  readonly origin: string
  readonly params?: Json.Value | undefined
  readonly status: Status
  readonly walletId: string
  approve(): Promise<Result>
  reject(reason?: Error): void
}

export type Queue = {
  next(options?: Queue.NextOptions): Promise<Handle>
}

export declare namespace Queue {
  type NextOptions = {
    signal?: AbortSignal | undefined
  }
}
