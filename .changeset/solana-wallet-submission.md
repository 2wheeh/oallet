---
'@oallet/core': patch
'@oallet/playwright': minor
'@oallet/solana': minor
---

Added Wallet Standard `solana:signAndSendTransaction` with explicit chain RPC bindings
and raw signature-byte responses. An optional commitment waits for confirmation;
timeouts and cancellation reject pending submissions and confirmation waits.

```ts
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'

Wallet.create({
  profile,
  chains: [{
    chain: 'solana:localnet',
    rpc: createSolanaRpc('http://127.0.0.1:8899'),
    rpcSubscriptions: createSolanaRpcSubscriptions('ws://127.0.0.1:8900'),
  }],
  transactionTimeoutMs: 30_000,
})
```

Existing signing-only wallets retain their features. Adapter inputs now expose the
request's existing abort signal so RPC operations can honor provider cancellation.
