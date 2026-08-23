import { createConfig, http } from 'wagmi'
import { anvil } from 'wagmi/chains'

const rpcUrl = new URL(location.href).searchParams.get('rpc')
if (!rpcUrl) throw new Error('The Wagmi fixture requires an rpc query parameter')

export const config = createConfig({
  chains: [anvil],
  transports: { [anvil.id]: http(rpcUrl) },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
