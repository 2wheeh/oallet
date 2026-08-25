import encodeQR from 'qr'
import { useEffect, useMemo, useState } from 'react'
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSignMessage,
} from 'wagmi'

import { projectId } from './wagmi.js'

export function App() {
  const connection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const signMessage = useSignMessage()
  const [message, setMessage] = useState('')
  const [pairingUri, setPairingUri] = useState<string>()
  const connector = connectors[0]

  useEffect(() => {
    if (!connector) return
    const onMessage = (event: { data?: unknown; type: string }) => {
      if (event.type === 'display_uri' && typeof event.data === 'string') {
        setPairingUri(event.data)
      }
    }
    connector.emitter.on('message', onMessage)
    return () => connector.emitter.off('message', onMessage)
  }, [connector])

  const qr = useMemo(
    () => (pairingUri ? encodeQR(pairingUri, 'svg', { ecc: 'quartile' }) : ''),
    [pairingUri],
  )
  const qrSource = useMemo(
    () => (qr ? `data:image/svg+xml,${encodeURIComponent(qr)}` : undefined),
    [qr],
  )

  if (!projectId) {
    return <p data-testid="configuration-error">Missing VITE_WC_PROJECT_ID</p>
  }

  return (
    <main>
      <h1>WalletConnect Wagmi consumer fixture</h1>
      <button
        disabled={!connector || connect.isPending}
        onClick={() => connector && connect.mutate({ connector })}
        type="button"
      >
        Connect WalletConnect
      </button>
      <button
        disabled={connection.status !== 'connected'}
        onClick={() => disconnect.mutate()}
        type="button"
      >
        Disconnect
      </button>
      <output data-testid="status">{connection.status}</output>
      <output data-testid="account">{connection.address}</output>
      {qrSource ? (
        <img
          alt="WalletConnect pairing QR code"
          data-testid="walletconnect-qr"
          src={qrSource}
        />
      ) : null}
      <label>
        Message
        <input
          data-testid="message-input"
          onChange={(event) => setMessage(event.target.value)}
          value={message}
        />
      </label>
      <button
        data-testid="sign-message"
        disabled={connection.status !== 'connected' || message.length === 0}
        onClick={() => signMessage.mutate({ message })}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{signMessage.data}</output>
    </main>
  )
}
