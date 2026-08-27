import { custom, type Transport } from 'viem'

import { RpcUnavailableError } from '../errors/errors.js'

export function unavailable(): Transport {
  return custom(
    {
      async request({ method }: { method: string }): Promise<never> {
        throw new RpcUnavailableError(
          `RPC method ${method} is unavailable because no RPC endpoint is configured`,
        )
      },
    },
    {
      key: 'oallet-unavailable',
      name: 'Oallet unavailable RPC',
      retryCount: 0,
    },
  )
}
