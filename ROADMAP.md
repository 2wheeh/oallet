# Roadmap to first release

> Oallet gives dApp and SDK teams deterministic wallets that exercise real wallet
> surfaces without application-side mock connectors.

## Framework and public interface

- [x] Set up the pnpm workspace for `oallet`, `@oallet/core`, `@oallet/evm`,
      `@oallet/walletconnect`, and `@oallet/playwright`
- [x] Keep `oallet` as the umbrella package with subpath re-exports
- [x] Define serializable wallet Profiles separately from runtime bindings
- [x] Define stable handle types for wallets, connections, requests, pairings, and
      sessions
- [x] Give every Oallet error a stable `OALLET_*` code
- [x] Treat public interfaces and persisted state as clean breaks before the first
      release

## Controller and browser boundary

- [x] Implement one runner-neutral Controller as the authoritative state owner
- [x] Keep the Browser Adapter as a dumb versioned protocol facade
- [x] Expose EIP-6963 wallets before application code executes
- [x] Support multiple wallets, accounts, pages, and top-level origins
- [x] Scope authorization and active chain state to each connection or session
- [x] Add a thin Playwright fixture without depending on Playwright from core
- [ ] Make unsupported browser and protocol versions fail fast

## Request lifecycle

- [x] Queue interactive requests for explicit test-controlled approval or rejection
- [x] Preserve deterministic request ordering and cancellation
- [x] Add wallet-scoped `startAutoApprove()` with an idempotent stop function
- [x] Apply auto-approval to all interactive requests created within its scope
- [x] Separate the control stream from immutable diagnostic traces
- [x] Reject unsupported methods instead of silently synthesizing responses

## EVM EOA wallet

- [x] Derive Alice, Bob, and remaining presets from the standard Anvil mnemonic
- [x] Implement account request, chain switch/add, personal signing, typed-data
      signing, and transaction submission
- [x] Use viem `Chain` and `Transport` as the public EVM runtime boundary
- [x] Proxy safe read RPC methods and block node administration methods
- [x] Sign and submit real EOA transactions to consumer-provided test infrastructure
- [x] Return the RPC-provided transaction hash immediately
- [ ] Verify receipt polling through unmodified viem and Wagmi application flows

## WalletConnect

- [x] Wrap `@reown/walletkit` as the controlled wallet peer
- [x] Require a consumer-provided `projectId` whenever WalletConnect is enabled
- [x] Pair through the real Reown relay without an injected fallback
- [x] Decode `wc:` URIs from visible QR codes with a generic scanner
- [x] Provide chainable `PairingFlow` helpers for pairing, proposal inspection,
      approval, and rejection
- [x] Validate required namespaces strictly and approve supported optional
      intersections
- [x] Route session requests through the same approval and EVM execution machinery
- [ ] Cover session update, disconnect, expiry, and same-test page reload restoration
- [ ] Run real-relay canaries as a release gate rather than on every pull request

## State and diagnostics

- [x] Provide explicit reset APIs for test-, worker-, and project-scoped lifecycles
- [x] Snapshot and restore deterministic wallet, connection, and approval state
- [x] Exclude active WalletConnect sessions from portable snapshots initially
- [x] Redact private keys, mnemonics, WalletConnect keys, and sensitive payloads
- [x] Attach structured wallet traces to failed Playwright tests
- [ ] Provide assertions over observable wallet behavior rather than internals

## Dogfood and release gate

- [ ] Add a repository-owned direct EIP-1193 fixture dApp
- [ ] Add Wagmi and viem transaction-and-receipt fixtures
- [ ] Add a Reown WalletConnect QR fixture
- [ ] Dogfood EVM and WalletConnect against DelightKit
- [ ] Dogfood EVM, Solana, and WalletConnect against Trust Connect SDK
- [ ] Reuse Duroo AA Playground artifacts for later AA conformance work
- [ ] Pass the EVM EOA and WalletConnect MVP acceptance matrix on Chromium
- [ ] Publish the first release only after real relay and real transaction canaries pass

## Post-release chain adapters

- [ ] Add a Wallet Standard Solana Adapter with deterministic identity derivation
- [ ] Use Solana Kit-native transaction and signing interfaces
- [ ] Add a Keplr-compatible Cosmos Adapter with Amino and Direct signing
- [ ] Configure Cosmos derivation, coin type, and Bech32 prefix per chain
- [ ] Keep chain node lifecycle and account funding owned by consumer test infrastructure

## Later fidelity

- [ ] Evaluate project references when workspace typecheck performance warrants it
- [ ] Add semantic EIP-5792 profiles for 4337 and 7702 observable behavior
- [ ] Add passkey-like and ERC-1271 response fixtures without claiming onchain AA
- [ ] Evaluate execution-backed AA only as a separate fidelity tier
- [ ] Evaluate legacy `window.ethereum`, Firefox, WebKit, and additional test runners
- [ ] Add custom signers and guarded live-network execution only when demand is proven
