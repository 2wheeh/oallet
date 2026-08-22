import type { WalletKitTypes } from '@reown/walletkit'

import type * as Session from '../session/session.js'

export type Proposal = {
  readonly id: number
  readonly optionalNamespaces: Readonly<Record<string, RequestedNamespace>>
  readonly requiredNamespaces: Readonly<Record<string, RequestedNamespace>>
  approveSession(options?: Proposal.ApproveOptions): Promise<Session.Instance>
  rejectSession(): Promise<void>
}

export declare namespace Proposal {
  type ApproveOptions = {
    readonly sessionProperties?: Readonly<Record<string, string>> | undefined
  }
  type Event = WalletKitTypes.SessionProposal
}

export type RequestedNamespace = {
  readonly chains?: readonly string[] | undefined
  readonly events: readonly string[]
  readonly methods: readonly string[]
}

export type Flow = {
  nextSessionProposal(options?: Flow.NextOptions): Promise<Proposal>
}

export declare namespace Flow {
  type NextOptions = {
    readonly timeout?: number | undefined
  }
}
