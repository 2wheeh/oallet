import { mainnet } from 'viem/chains'
import { expect, test } from 'vitest'

import { unavailable } from './unavailable.js'

test('fails immediately with the unexpected RPC method', async () => {
  const transport = unavailable()

  await expect(
    transport({ chain: mainnet }).request({ method: 'eth_blockNumber' }),
  ).rejects.toEqual(
    expect.objectContaining({
      cause: expect.objectContaining({
        code: 'OALLET_EVM_RPC_UNAVAILABLE',
        message:
          'RPC method eth_blockNumber is unavailable because no RPC endpoint is configured',
        name: 'Evm.RpcUnavailableError',
      }),
    }),
  )
})
