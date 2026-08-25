# Vendored DelightKit packages

These tarballs were built from DelightKit commit
`07a85eaf8b6905e1009453af1f2774b7df64f097` and are intentionally committed so
the consumer fixture does not depend on a sibling checkout.

The fixture uses the minimal WalletConnect + EVM closure:

- `@delight-labs/delightkit`
- `@delight-labs/delightkit-core`
- `@delight-labs/delightkit-cosmos` (WalletConnect peer dependency)
- `@delight-labs/delightkit-evm`
- `@delight-labs/delightkit-walletconnect`

Rebuild DelightKit before refreshing the tarballs, then run `pnpm pack
--pack-destination <oallet>/tests/delightkit/vendor` in each package directory.
