import type * as Json from '../json/json.js'

export type Status = 'approved' | 'cancelled' | 'pending' | 'rejected'

export type Rejection = {
  readonly code: number
  readonly data?: Json.Value | undefined
  readonly message: string
}

export type Definition<
  Params = Json.Value | undefined,
  Data = Json.Value,
  Approval = Json.Value,
> = {
  readonly approval: Approval
  readonly data: Data
  readonly params: Params
}

export type Handle<
  Approval = unknown,
  Method extends string = string,
  Params = Json.Value | undefined,
  Data = Json.Value,
> = {
  readonly chainId?: string | undefined
  readonly data: Data
  readonly id: string
  readonly method: Method
  readonly origin: string
  readonly status: Status
  readonly walletId: string
  approve(): Promise<Approval>
  reject(reason?: Error | Rejection): void
} & (undefined extends Params
  ? { readonly params?: Params | undefined }
  : { readonly params: Params })

export type ParamsFor<
  Requests extends object,
  Method extends string,
> = Method extends keyof Requests
  ? Requests[Method] extends Definition<infer Params, unknown, unknown>
    ? Params
    : Json.Value | undefined
  : Json.Value | undefined

export type DataFor<
  Requests extends object,
  Method extends string,
> = Method extends keyof Requests
  ? Requests[Method] extends Definition<unknown, infer Data, unknown>
    ? Data
    : Json.Value
  : Json.Value

export type ResultFor<
  Requests extends object,
  Method extends string,
> = Method extends keyof Requests
  ? Requests[Method] extends Definition<unknown, unknown, infer Approval>
    ? Approval
    : Requests[Method]
  : Json.Value

export type HandleFor<Requests extends object, Method extends string> = Handle<
  ResultFor<Requests, Method>,
  Method,
  ParamsFor<Requests, Method>,
  DataFor<Requests, Method>
>

export type Queue<Requests extends object = object> = {
  next<Method extends string>(
    expectedMethod: Method,
    options?: Queue.NextOptions,
  ): Promise<HandleFor<Requests, Method>>
  next(expectedMethod?: undefined, options?: Queue.NextOptions): Promise<Handle>
}

export declare namespace Queue {
  type NextOptions = {
    signal?: AbortSignal | undefined
  }
}
