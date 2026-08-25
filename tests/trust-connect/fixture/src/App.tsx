import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  mainnet as bitcoinMainnet,
  createBIP122,
} from '@trustwallet/connect-bip122-react'
import { createEIP155, useSignMessage } from '@trustwallet/connect-eip155-react'
import {
  TrustConnectProvider,
  useConnections,
  useTrustModal,
} from '@trustwallet/connect-react'
import { createSolana, mainnet as solanaMainnet } from '@trustwallet/connect-solana-react'
// @ts-expect-error The published root declaration does not resolve its extensionless service re-export.
import { createWalletConnect } from '@trustwallet/connect-walletconnect'
import { mainnet } from 'viem/chains'

export const projectId = import.meta.env.VITE_WC_PROJECT_ID?.trim() as string | undefined

const queryClient = new QueryClient()
const eip155 = createEIP155({
  chains: [mainnet],
  rpcUrls: { 'eip155:1': ['https://ethereum-rpc.publicnode.com'] },
})
const solana = createSolana({ chain: solanaMainnet })
const bitcoin = createBIP122({ chain: bitcoinMainnet })
const walletConnect = createWalletConnect({
  metadata: {
    description: 'Oallet Trust Connect consumer fixture',
    icons: [],
    name: 'Oallet Trust Connect fixture',
    url: globalThis.location.origin,
  },
  projectId: projectId ?? 'missing-project-id',
})

export function App() {
  if (!projectId) {
    return <p data-testid="configuration-error">Missing VITE_WC_PROJECT_ID</p>
  }
  return (
    <TrustConnectProvider
      config={{
        namespaces: [eip155, solana, bitcoin],
        services: [walletConnect],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Consumer />
      </QueryClientProvider>
    </TrustConnectProvider>
  )
}

function Consumer() {
  const { open } = useTrustModal()
  const { connections } = useConnections()
  const signMessage = useSignMessage()
  const eip155Connection = connections.eip155

  return (
    <main>
      <h1>Trust Connect consumer fixture</h1>
      <button onClick={() => open()} type="button">
        Open Trust Modal
      </button>
      <output data-testid="eip155-status">
        {eip155Connection?.status ?? 'disconnected'}
      </output>
      <output data-testid="eip155-account">{eip155Connection?.address}</output>
      <output data-testid="solana-status">
        {connections.solana?.status ?? 'disconnected'}
      </output>
      <output data-testid="bip122-status">
        {connections.bip122?.status ?? 'disconnected'}
      </output>
      <button
        disabled={eip155Connection?.status !== 'connected'}
        onClick={() => signMessage.mutate({ message: 'Hello from Trust Connect' })}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{signMessage.data}</output>
    </main>
  )
}
