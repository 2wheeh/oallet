---
'@oallet/playwright': minor
'@oallet/walletconnect': minor
---

Clean up the WalletConnect timeout error and fixture resource interfaces.

```diff
-new PairingTimeoutError(message, stage, { cause })
+new PairingTimeoutError(message, { stage, cause })

-type Fixture.extend.ManagedWalletConnect
+type Fixture.extend.WalletConnectResource
```
