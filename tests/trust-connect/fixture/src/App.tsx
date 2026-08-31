import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  mainnet as bitcoinMainnet,
  createBIP122,
} from '@trustwallet/connect-bip122-react'
import {
  createEIP155,
  useSignMessage as useEvmSignMessage,
} from '@trustwallet/connect-eip155-react'
import {
  TrustConnectProvider,
  useConnect,
  useConnections,
  useTrustModal,
} from '@trustwallet/connect-react'
import {
  createSolana,
  mainnet as solanaMainnet,
  useSignMessage as useSolanaSignMessage,
} from '@trustwallet/connect-solana-react'
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
const walletConnect = projectId
  ? createWalletConnect({
      metadata: {
        description: 'Oallet Trust Connect consumer fixture',
        icons: [],
        name: 'Oallet Trust Connect fixture',
        url: globalThis.location.origin,
      },
      projectId,
    })
  : undefined

export function App() {
  return (
    <TrustConnectProvider
      config={{
        namespaces: [eip155, solana, bitcoin],
        services: walletConnect ? [walletConnect] : [],
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
  const { connect: connectSolana, wallets: solanaWallets } = useConnect({
    namespaceId: 'solana',
  })
  const { connections } = useConnections()
  const signMessage = useEvmSignMessage()
  const solanaSignMessage = useSolanaSignMessage()
  const eip155Connection = connections.eip155
  const oalletSolana = solanaWallets.find(
    (wallet: (typeof solanaWallets)[number]) =>
      wallet.name === 'Oallet Trust Connect Solana Wallet',
  )

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
      <output data-testid="solana-account">{connections.solana?.address}</output>
      <button
        disabled={!oalletSolana}
        onClick={() => oalletSolana && connectSolana({ wallet: oalletSolana })}
        type="button"
      >
        Connect Oallet Solana
      </button>
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
      <button
        disabled={connections.solana?.status !== 'connected'}
        onClick={() =>
          solanaSignMessage.mutate({ message: 'Hello from Trust Connect Solana' })
        }
        type="button"
      >
        Sign Solana message
      </button>
      <output data-testid="solana-message-signature">
        {solanaSignMessage.data ? [...solanaSignMessage.data.signature].join(',') : ''}
      </output>
    </main>
  )
}
