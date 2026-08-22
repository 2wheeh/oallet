import type * as Json from '../json/json.js'

export type Phase =
  | 'approved'
  | 'failed'
  | 'prepared'
  | 'received'
  | 'rejected'
  | 'returned'

export type Entry = {
  readonly data?: Json.Value | undefined
  readonly method: string
  readonly origin: string
  readonly phase: Phase
  readonly timestamp: number
  readonly walletId: string
}
