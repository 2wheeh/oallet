---
"@oallet/core": minor
"@oallet/walletconnect": patch
"@oallet/playwright": patch
---

Retry failed WalletConnect disconnects and add correlated request, response, and disconnect traces.

```diff
 export type {
+  WalletConnectRequestEvent,
+  WalletConnectResponseEvent,
+  WalletConnectSessionDisconnect,
 } from './trace.js'
```
