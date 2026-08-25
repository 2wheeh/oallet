import { Hooks } from '@delight-labs/delightkit'
import encodeQR from 'qr'
import { useSyncExternalStore } from 'react'
import { useConnect, useConnection, useConnectors, useSignMessage } from 'wagmi'

import { projectId, walletConnectClient } from './runtime.js'

const idleWalletConnectSnapshot = {
  revision: 0,
  scopes: [],
  status: 'idle' as const,
}

export function App() {
  const delightConnection = Hooks.useConnection({ namespace: 'eip155' })
  const wagmiConnection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const signMessage = useSignMessage()
  const connector = connectors[0]
  const walletConnectSnapshot = useSyncExternalStore(
    walletConnectClient?.store.subscribe ?? (() => () => undefined),
    walletConnectClient?.store.getSnapshot ?? getIdleSnapshot,
    walletConnectClient?.store.getSnapshot ?? getIdleSnapshot,
  )

  if (!projectId || !walletConnectClient) {
    return <p data-testid="configuration-error">Missing VITE_WC_PROJECT_ID</p>
  }

  return (
    <main>
      <h1>DelightKit consumer fixture</h1>
      <button
        disabled={!connector || connect.isPending}
        onClick={() => connector && connect.mutate({ connector })}
        type="button"
      >
        Connect WalletConnect
      </button>
      <output data-testid="wagmi-status">{wagmiConnection.status}</output>
      <output data-testid="delight-account">
        {delightConnection?.accounts[0]?.address}
      </output>
      {walletConnectSnapshot.uri ? (
        <div data-testid="walletconnect-qr">
          <Qr value={walletConnectSnapshot.uri} />
        </div>
      ) : null}
      <button
        disabled={wagmiConnection.status !== 'connected'}
        onClick={() => signMessage.mutate({ message: 'Hello from DelightKit' })}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{signMessage.data}</output>
    </main>
  )
}

function getIdleSnapshot() {
  return idleWalletConnectSnapshot
}

function Qr({ value }: { value: string }) {
  const svg = encodeQR(value, 'svg', { ecc: 'quartile' })
  return (
    <img
      alt="WalletConnect pairing URI"
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
    />
  )
}
