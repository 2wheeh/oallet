import type { WalletKitTypes } from '@reown/walletkit'

import type * as Session from '../session/session.js'

export type Proposal = {
  readonly optionalNamespaces: Proposal.Namespaces
  readonly requiredNamespaces: Proposal.Namespaces
  approve(options?: Proposal.ApproveOptions): Promise<Session.Instance>
  reject(): Promise<void>
}

export declare namespace Proposal {
  type ApproveOptions = {
    readonly namespaces?: Session.Namespaces | undefined
  }
  type Event = WalletKitTypes.SessionProposal
  type Namespace = {
    readonly chains?: readonly string[] | undefined
    readonly events: readonly string[]
    readonly methods: readonly string[]
  }
  type Namespaces = Readonly<Record<string, Namespace>>
}
