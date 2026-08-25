import { Client } from '@delight-labs/delightkit-core'
import { EvmSource } from '@delight-labs/delightkit-evm'
import {
  WalletConnectAdapter,
  WalletConnectClient,
} from '@delight-labs/delightkit-walletconnect'
import { createConfig, http } from '@wagmi/core'
import { mainnet } from 'viem/chains'

export const projectId = import.meta.env.VITE_WC_PROJECT_ID?.trim() as string | undefined

export const walletConnectClient = projectId
  ? WalletConnectClient.create({
      metadata: {
        description: 'Oallet DelightKit consumer fixture',
        icons: [],
        name: 'Oallet DelightKit fixture',
        url: globalThis.location.origin,
      },
      projectId,
      storageKey: 'oallet:dogfood:delightkit',
    })
  : undefined

export const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: walletConnectClient
    ? [WalletConnectAdapter.wagmi({ client: walletConnectClient })]
    : [],
  transports: { [mainnet.id]: http() },
})

export const delightClient = Client.create({
  sources: [EvmSource.create({ config: wagmiConfig })],
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
