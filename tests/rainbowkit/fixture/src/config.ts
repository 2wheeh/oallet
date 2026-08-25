import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { mainnet } from 'wagmi/chains'

export const projectId = import.meta.env.VITE_WC_PROJECT_ID?.trim() as string | undefined

export const config = getDefaultConfig({
  appName: 'Oallet RainbowKit fixture',
  chains: [mainnet],
  projectId: projectId ?? 'missing-project-id',
  wallets: [{ groupName: 'Wallets', wallets: [walletConnectWallet] }],
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
