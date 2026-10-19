---
'@oallet/solana': patch
---

Fixed `solana:signTransaction` to reject malformed transactions and accounts that are
not required signers before approval. Signing failures now retain their cause in
`SigningError`, and interactive `standard:connect` preserves previously selected accounts.
