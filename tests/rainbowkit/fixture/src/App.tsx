import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useSignMessage } from 'wagmi'

import { projectId } from './config.js'

export function App() {
  const account = useAccount()
  const signMessage = useSignMessage()

  if (!projectId) {
    return <p data-testid="configuration-error">Missing VITE_WC_PROJECT_ID</p>
  }

  return (
    <main>
      <h1>RainbowKit consumer fixture</h1>
      <ConnectButton showBalance={false} />
      <output data-testid="status">
        {account.isConnected ? 'connected' : 'disconnected'}
      </output>
      <output data-testid="account">{account.address}</output>
      <button
        disabled={!account.isConnected}
        onClick={() => signMessage.signMessage({ message: 'Hello from RainbowKit' })}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{signMessage.data}</output>
    </main>
  )
}
