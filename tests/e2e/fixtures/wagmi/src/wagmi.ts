import { createConfig, http } from 'wagmi'
import { anvil, mainnet } from 'wagmi/chains'

const rpcUrl = new URL(location.href).searchParams.get('rpc')
if (!rpcUrl) throw new Error('The Wagmi fixture requires an rpc query parameter')

export const config = createConfig({
  chains: [anvil, mainnet],
  transports: { [anvil.id]: http(rpcUrl), [mainnet.id]: http(rpcUrl) },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
