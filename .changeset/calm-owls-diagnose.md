---
'@oallet/core': minor
'@oallet/playwright': minor
'@oallet/walletconnect': minor
---

Make WalletConnect E2E failures easier to localize: distinguish unavailable QR targets
from undecodable pixels, report pairing start/proposal wait/cleanup stages with stable
errors and trace fields, and optionally manage the WalletConnect client through the
Playwright fixture without hiding proposal approval decisions.
