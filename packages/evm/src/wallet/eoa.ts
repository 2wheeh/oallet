import type { Chain, Transport } from 'viem'

import type * as Identity from '../identity/identity.js'
import * as Profile from '../profile/eoa.js'
import { assertUniqueBindings } from '../runtime/create.js'
import { create, type Instance } from './create.js'

export function eoa(options: eoa.Options): Instance {
  assertUniqueBindings(options.chains)
  const profile = Profile.eoa({
    accounts: options.accounts,
    chains: options.chains.map(({ chain }) => chain.id),
    ...(options.defaultChainId === undefined
      ? {}
      : { defaultChainId: options.defaultChainId }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    id: options.id,
    name: options.name,
    ...(options.rdns === undefined ? {} : { rdns: options.rdns }),
  })

  return create({ chains: options.chains, profile })
}

export declare namespace eoa {
  type Options = {
    readonly accounts: readonly Identity.Preset[]
    readonly chains: readonly {
      readonly chain: Chain
      readonly transport: Transport
    }[]
    readonly defaultChainId?: number | undefined
    readonly icon?: string | undefined
    readonly id: string
    readonly name: string
    readonly rdns?: string | undefined
  }
  type ReturnType = Instance
}
