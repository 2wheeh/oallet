import type * as Json from '../json/json.js'

export type Status = 'approved' | 'cancelled' | 'pending' | 'rejected'

export type Rejection = {
  readonly code: number
  readonly data?: Json.Value | undefined
  readonly message: string
}

export type Handle<Result = unknown> = {
  readonly chainId?: string | undefined
  readonly data: Json.Value
  readonly id: string
  readonly method: string
  readonly origin: string
  readonly params?: Json.Value | undefined
  readonly status: Status
  readonly walletId: string
  approve(): Promise<Result>
  reject(reason?: Error | Rejection): void
}

export type ResultFor<
  Results extends object,
  Method extends string,
> = Method extends keyof Results ? Results[Method] : Json.Value

export type Queue<Results extends object = object> = {
  next<Method extends string>(
    expectedMethod: Method,
    options?: Queue.NextOptions,
  ): Promise<Handle<ResultFor<Results, Method>>>
  next(expectedMethod?: undefined, options?: Queue.NextOptions): Promise<Handle>
}

export declare namespace Queue {
  type NextOptions = {
    signal?: AbortSignal | undefined
  }
}
