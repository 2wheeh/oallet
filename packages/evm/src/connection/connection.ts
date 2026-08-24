import type * as Identity from '../identity/identity.js'

export type Instance = {
  readonly id: string
  readonly origin: string
  readonly walletId: string
  disconnect(): Promise<void>
  reconnect(): Promise<void>
  setAccounts(accounts: readonly Identity.Preset[]): Promise<void>
  switchChain(chainId: number): Promise<void>
}

export type Collection = {
  get(origin: string): Instance
}
