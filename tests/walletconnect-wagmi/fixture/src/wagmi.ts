import { createConfig, http } from 'wagmi'
import { anvil } from 'wagmi/chains'
import { walletConnect } from 'wagmi/connectors/walletConnect'

export const projectId = import.meta.env.VITE_WC_PROJECT_ID?.trim() as string | undefined

export const config = createConfig({
  chains: [anvil],
  connectors: projectId
    ? [
        walletConnect({
          metadata: {
            description: 'Oallet WalletConnect consumer fixture',
            icons: [],
            name: 'Oallet fixture dApp',
            url: globalThis.location.origin,
          },
          projectId,
          showQrModal: false,
        }),
      ]
    : [],
  transports: { [anvil.id]: http('http://127.0.0.1:8545') },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
