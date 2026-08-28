import type { Chain, Transport } from 'viem'

import { ChainNotConfiguredError, DuplicateChainError } from '../errors/errors.js'

export type ChainBinding = {
  readonly chain: Chain
  readonly transport: Transport
}

export type Instance = {
  readonly chains: readonly Chain[]
  get(chainId: number): ChainBinding
  request(
    chainId: number,
    request: {
      readonly method: string
      readonly params?: readonly unknown[] | undefined
    },
  ): Promise<unknown>
}

export function assertUniqueBindings(chains: readonly ChainBinding[]): void {
  const chainIds = new Set<number>()
  for (const binding of chains) {
    if (chainIds.has(binding.chain.id)) {
      throw new DuplicateChainError(
        `Chain ${binding.chain.id} is configured more than once`,
      )
    }
    chainIds.add(binding.chain.id)
  }
}

export function create(options: create.Options): Instance {
  assertUniqueBindings(options.chains)
  const bindings = new Map<number, ChainBinding>()
  for (const binding of options.chains) {
    bindings.set(binding.chain.id, binding)
  }
  return {
    chains: Object.freeze(options.chains.map(({ chain }) => chain)),
    get(chainId) {
      const binding = bindings.get(chainId)
      if (!binding)
        throw new ChainNotConfiguredError(`Chain ${chainId} has no runtime binding`)
      return binding
    },
    async request(chainId, request) {
      const binding = bindings.get(chainId)
      if (!binding)
        throw new ChainNotConfiguredError(`Chain ${chainId} has no runtime binding`)
      return binding.transport({ chain: binding.chain }).request(request as never)
    },
  }
}

export declare namespace create {
  type Options = {
    readonly chains: readonly ChainBinding[]
  }
  type ReturnType = Instance
}
