---
'@oallet/playwright': patch
'@oallet/solana': patch
---

Fixed Wallet Standard transaction signing without an explicit chain and account
change notifications when restoring authorization during page initialization.
Invalid Solana identity presets now fail during profile creation with a stable error code.
