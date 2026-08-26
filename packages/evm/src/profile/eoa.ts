import { Profile } from '@oallet/core'

import { InvalidProfileError } from '../errors/errors.js'
import type * as Identity from '../identity/identity.js'

export type Data = {
  readonly accounts: readonly Identity.Preset[]
  readonly chains: readonly number[]
  readonly defaultChainId: number
}

export type Definition = Profile.Definition<Data, 'eip155:eoa'>

export function eoa(options: eoa.Options): Definition {
  if (options.accounts.length === 0)
    throw new InvalidProfileError('At least one account is required')
  if (
    new Set(options.accounts.map((account) => account.address.toLowerCase())).size !==
    options.accounts.length
  ) {
    throw new InvalidProfileError('Accounts must be unique')
  }
  if (options.chains.length === 0)
    throw new InvalidProfileError('At least one chain is required')
  if (new Set(options.chains).size !== options.chains.length) {
    throw new InvalidProfileError('Chain identifiers must be unique')
  }
  for (const chainId of options.chains) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new InvalidProfileError('Chain identifiers must be positive safe integers')
    }
  }
  const defaultChainId = options.defaultChainId ?? options.chains[0]
  if (defaultChainId === undefined || !options.chains.includes(defaultChainId)) {
    throw new InvalidProfileError('Default chain must be included in profile chains')
  }
  return Profile.define({
    data: { accounts: options.accounts, chains: options.chains, defaultChainId },
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    id: options.id,
    kind: 'eip155:eoa',
    name: options.name,
    ...(options.rdns === undefined ? {} : { rdns: options.rdns }),
  })
}

export declare namespace eoa {
  type Options = {
    readonly accounts: readonly Identity.Preset[]
    readonly chains: readonly number[]
    readonly defaultChainId?: number | undefined
    readonly icon?: string | undefined
    readonly id: string
    readonly name: string
    readonly rdns?: string | undefined
  }
  type ReturnType = Definition
}
