import { Profile } from '@oallet/core'

import { InvalidProfileError } from '../errors/errors.js'
import type * as Identity from '../identity/identity.js'

export type Chain =
  | 'solana:devnet'
  | 'solana:localnet'
  | 'solana:mainnet'
  | 'solana:testnet'

export type Data = {
  readonly accounts: readonly Identity.Preset[]
  readonly chains: readonly Chain[]
}

export type Definition = Profile.Definition<Data, 'solana:keypair'>

const supportedChains = new Set<Chain>([
  'solana:devnet',
  'solana:localnet',
  'solana:mainnet',
  'solana:testnet',
])

export function keypair(options: keypair.Options): Definition {
  if (options.accounts.length === 0) {
    throw new InvalidProfileError('At least one account is required')
  }
  if (
    new Set(options.accounts.map((account) => account.address)).size !==
    options.accounts.length
  ) {
    throw new InvalidProfileError('Accounts must be unique')
  }
  if (options.chains.length === 0) {
    throw new InvalidProfileError('At least one chain is required')
  }
  if (new Set(options.chains).size !== options.chains.length) {
    throw new InvalidProfileError('Chain identifiers must be unique')
  }
  if (!options.chains.every((chain) => supportedChains.has(chain))) {
    throw new InvalidProfileError('Profile contains an unsupported Solana chain')
  }
  return Profile.define({
    data: { accounts: options.accounts, chains: options.chains },
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    id: options.id,
    kind: 'solana:keypair',
    name: options.name,
    ...(options.rdns === undefined ? {} : { rdns: options.rdns }),
  })
}

export declare namespace keypair {
  type Options = {
    readonly accounts: readonly Identity.Preset[]
    readonly chains: readonly Chain[]
    readonly icon?: string | undefined
    readonly id: string
    readonly name: string
    readonly rdns?: string | undefined
  }
  type ReturnType = Definition
}
