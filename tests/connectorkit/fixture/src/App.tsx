import {
  AppProvider,
  getDefaultConfig,
  useConnectWallet,
  useDisconnectWallet,
  useTransactionSigner,
  useWallet,
  useWalletConnectors,
} from '@solana/connector/react'
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { useState } from 'react'

const rpcUrl = new URL(location.href).searchParams.get('rpc')
if (!rpcUrl) throw new Error('The ConnectorKit fixture requires an rpc query parameter')
const connection = new Connection(rpcUrl, 'confirmed')

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
  const [transactionLamports, setTransactionLamports] = useState('1')
  const [transactionSignature, setTransactionSignature] = useState('')
  const [transactionStatus, setTransactionStatus] = useState('idle')
  const [transactionTo, setTransactionTo] = useState('')
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
      <input
        data-testid="transaction-to-input"
        onChange={(event) => setTransactionTo(event.target.value)}
        value={transactionTo}
      />
      <input
        data-testid="transaction-lamports-input"
        onChange={(event) => setTransactionLamports(event.target.value)}
        value={transactionLamports}
      />
      <button
        disabled={!signerReady || !signer || !wallet.account || !transactionTo}
        onClick={async () => {
          if (!signer || !wallet.account) return
          setTransactionStatus('signing')
          const latestBlockhash = await connection.getLatestBlockhash('confirmed')
          const transaction = new Transaction({
            feePayer: new PublicKey(wallet.account),
            recentBlockhash: latestBlockhash.blockhash,
          }).add(
            SystemProgram.transfer({
              fromPubkey: new PublicKey(wallet.account),
              lamports: Number(transactionLamports),
              toPubkey: new PublicKey(transactionTo),
            }),
          )
          const signed = await signer.signTransaction(transaction)
          if (!(signed instanceof Transaction)) {
            throw new Error('ConnectorKit returned an unexpected transaction type')
          }
          const signature = await connection.sendRawTransaction(signed.serialize())
          await connection.confirmTransaction(
            { signature, ...latestBlockhash },
            'confirmed',
          )
          setTransactionSignature(signature)
          setTransactionStatus('confirmed')
        }}
        type="button"
      >
        Send transaction
      </button>
      <output data-testid="transaction-signature">{transactionSignature}</output>
      <output data-testid="transaction-status">{transactionStatus}</output>
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
