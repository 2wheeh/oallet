import { useState } from 'react'
import type { Address } from 'viem'
import {
  useConnect,
  useConnection,
  useConnectors,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
  useWaitForTransactionReceipt,
} from 'wagmi'

export function App() {
  const connection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const signMessage = useSignMessage()
  const signTypedData = useSignTypedData()
  const sendTransaction = useSendTransaction()
  const [message, setMessage] = useState('')
  const [typedData, setTypedData] = useState('')
  const [transactionTo, setTransactionTo] = useState('')
  const [transactionValue, setTransactionValue] = useState('')
  const receipt = useWaitForTransactionReceipt({ hash: sendTransaction.data })
  const connected = connection.status === 'connected'

  return (
    <main>
      <h1>Wagmi consumer fixture</h1>
      <div data-testid="connectors">
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect.mutate({ connector })}
            type="button"
          >
            Connect {connector.name}
          </button>
        ))}
      </div>
      <output data-testid="account">{connection.address}</output>
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
        disabled={!connected || message.length === 0}
        onClick={() => signMessage.mutate({ message })}
        type="button"
      >
        Sign message
      </button>
      <output data-testid="message-signature">{signMessage.data}</output>
      <label>
        Typed data
        <textarea
          data-testid="typed-data-input"
          onChange={(event) => setTypedData(event.target.value)}
          value={typedData}
        />
      </label>
      <button
        data-testid="sign-typed-data"
        disabled={!connected || typedData.length === 0}
        onClick={() => {
          const parameters = JSON.parse(typedData) as Parameters<
            typeof signTypedData.mutate
          >[0]
          signTypedData.mutate(parameters)
        }}
        type="button"
      >
        Sign typed data
      </button>
      <output data-testid="typed-data-signature">{signTypedData.data}</output>
      <label>
        Recipient
        <input
          data-testid="transaction-to-input"
          onChange={(event) => setTransactionTo(event.target.value)}
          value={transactionTo}
        />
      </label>
      <label>
        Value (wei)
        <input
          data-testid="transaction-value-input"
          inputMode="numeric"
          onChange={(event) => setTransactionValue(event.target.value)}
          value={transactionValue}
        />
      </label>
      <button
        data-testid="send-transaction"
        disabled={
          !connected || transactionTo.length === 0 || transactionValue.length === 0
        }
        onClick={() =>
          sendTransaction.mutate({
            to: transactionTo as Address,
            value: BigInt(transactionValue),
          })
        }
        type="button"
      >
        Send transaction
      </button>
      <output data-testid="transaction-hash">{sendTransaction.data}</output>
      <output data-testid="receipt">{receipt.data?.status}</output>
    </main>
  )
}
