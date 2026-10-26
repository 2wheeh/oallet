---
'@oallet/core': minor
'@oallet/solana': minor
---

Added `Identity.mnemonic` and `Identity.names` to `oallet/core`. EVM and Solana presets
now share the Anvil mnemonic and identity order, preserving EVM addresses and deriving
Solana accounts at `m/44'/501'/index'/0'` with an empty BIP39 passphrase.

```ts
import { Identity } from 'oallet/core'

const mnemonic = Identity.mnemonic
const firstIdentity = Identity.names[0] // alice
```

Solana addresses from the earlier unreleased name-hash implementation change; fund
the current preset addresses and recreate snapshots using the new profiles.
