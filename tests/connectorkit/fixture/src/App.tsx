import {
  AppProvider,
  getDefaultConfig,
  useConnectWallet,
  useDisconnectWallet,
  useTransactionSigner,
  useWallet,
  useWalletConnectors,
} from '@solana/connector/react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { useState } from 'react'

const config = getDefaultConfig({
  appName: 'Oallet ConnectorKit fixture',
  autoConnect: false,
  enableMobile: false,
  network: 'localnet',
})

export function App() {
  return (
    <AppProvider connectorConfig={config}>
      <Consumer />
    </AppProvider>
  )
}

function Consumer() {
  const connectors = useWalletConnectors()
  const { connect, isConnecting } = useConnectWallet()
  const { disconnect, isDisconnecting } = useDisconnectWallet()
  const { ready: signerReady, signer } = useTransactionSigner()
  const wallet = useWallet()
  const [messageSignatureLength, setMessageSignatureLength] = useState(0)
  const [transactionSignatureLength, setTransactionSignatureLength] = useState(0)
  const oallet = connectors.find(
    (connector) => connector.name === 'Oallet ConnectorKit Wallet',
  )

  return (
    <main>
      <h1>ConnectorKit consumer fixture</h1>
      <output data-testid="wallet-names">
        {connectors.map((connector) => connector.name).join(',')}
      </output>
      <button
        disabled={!oallet || isConnecting}
        onClick={() => oallet && connect(oallet.id)}
        type="button"
      >
        Connect Oallet
      </button>
      <output data-testid="wallet-status">{wallet.status}</output>
      <output data-testid="wallet-account">{wallet.account}</output>
      <button
        disabled={!signerReady || !signer?.signMessage}
        onClick={async () => {
          const signature = await signer?.signMessage?.(
            new TextEncoder().encode('Oallet ConnectorKit fixture'),
          )
          setMessageSignatureLength(signature?.length ?? 0)
        }}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{messageSignatureLength}</output>
      <button
        disabled={!signerReady || !signer || !wallet.account}
        onClick={async () => {
          if (!signer || !wallet.account) return
          const transaction = new Transaction({
            feePayer: new PublicKey(wallet.account),
            recentBlockhash: '11111111111111111111111111111111',
          })
          const signed = await signer.signTransaction(transaction)
          if (!(signed instanceof Transaction)) {
            throw new Error('ConnectorKit returned an unexpected transaction type')
          }
          setTransactionSignatureLength(signed.signature?.length ?? 0)
        }}
        type="button"
      >
        Sign transaction
      </button>
      <output data-testid="transaction-signature">{transactionSignatureLength}</output>
      <button
        disabled={!wallet.isConnected || isDisconnecting}
        onClick={() => disconnect()}
        type="button"
      >
        Disconnect Oallet
      </button>
    </main>
  )
}
