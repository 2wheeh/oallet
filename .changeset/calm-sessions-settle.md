---
'@oallet/walletconnect': patch
---

Avoid publishing the initial account connection before the WalletConnect session is
ready, preventing approval from hanging on the relay.
