# Oallet

Deterministic wallet surfaces for dApp and SDK end-to-end tests. Oallet keeps wallet
behavior outside application source code, injects standards-based browser discovery,
and routes approvals back to the test process.

## MVP scope

- EVM EOA profiles derived from the standard ten-account Anvil mnemonic
- Real signing and transaction submission through consumer-provided viem transports
- EIP-6963 injection before application code, without `window.ethereum` or an extension
- Manual approval queues, wallet-scoped auto approval, reset, snapshot, and restore
- A real `@reown/walletkit` peer for WalletConnect v2 pairing and session requests
- Playwright fixtures, failure traces, and visible QR decoding

Oallet does not own a chain node or fund accounts. The consuming test infrastructure
provides the RPC transport and funds the matching Alice, Bob, and other preset
addresses. This repository uses `prool` to manage Anvil during onchain integration
tests; consumers may use Prool, Starskiff, or an existing test network.

## Packages

The `oallet` umbrella package re-exports each package through a subpath:

```ts
import { Environment } from 'oallet/core'
import { Identity, Profile, Wallet } from 'oallet/evm'
import { Browser, Fixture, Qr } from 'oallet/playwright'
import { Client } from 'oallet/walletconnect'
```

Direct `@oallet/*` package imports expose the same namespace-based API.
`@oallet/walletconnect` is an optional peer of the umbrella package so EVM-only
installs do not pull in the Reown dependency graph. Install it explicitly when using
`oallet/walletconnect`.

## EVM and Playwright

```ts
import { test as base } from '@playwright/test'
import { Environment } from 'oallet/core'
import { Identity, Profile, Wallet } from 'oallet/evm'
import { Fixture } from 'oallet/playwright'
import { http } from 'viem'
import { anvil } from 'viem/chains'

const profile = Profile.eoa({
  accounts: [Identity.alice, Identity.bob],
  chains: [anvil.id],
  id: 'test-wallet',
  name: 'Oallet',
  rdns: 'dev.oallet.test-wallet',
})

export const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.create({
          chains: [
            { chain: anvil, transport: http(process.env.ANVIL_RPC_URL) },
          ],
          profile,
        }),
      ],
    }),
})
```

Set `rdns` to the wallet family's EIP-6963 reverse-domain identifier when tests need
to model the same wallet across multiple namespaces. Omit it to use the deterministic
`dev.oallet.<profile-id>` fallback.

Interactive requests are manual by default:

```ts
const result = page.getByRole('button', { name: 'Connect' }).click()
const request = await oallet
  .wallet('test-wallet')
  .requests.next('eth_requestAccounts')
await request.approve()
await result
```

Use a bounded auto-approval scope when the interaction itself is not under test:

```ts
await oallet.wallet('test-wallet').autoApprove(async () => {
  await page.getByRole('button', { name: 'Connect' }).click()
})
```

Call `oallet.reset()` explicitly at the lifecycle boundary selected by the test
infrastructure. `oallet.snapshot()` and `oallet.restore(snapshot)` preserve
deterministic wallet and origin state; active WalletConnect sessions are intentionally
not part of that portable snapshot.

Approving an injected connection request returns an origin-scoped connection handle to
the test while the dApp receives the protocol account list:

```ts
const request = await oallet
  .wallet('test-wallet')
  .requests.next('eth_requestAccounts')
const connection = await request.approve()

await connection.setAccounts([Identity.bob])
await connection.switchChain(anvil.id)
await connection.disconnect()
await connection.reconnect()
```

`oallet.trace` is a versioned, read-only artifact containing redacted request,
connection, provider-delivery, and environment lifecycle events. The Playwright
fixture attaches JSON and text forms automatically when a test fails.

## WalletConnect

WalletConnect uses the real Reown relay path. A `projectId` is mandatory; use a
separate test project ID rather than sharing production credentials.

```ts
import { Qr } from 'oallet/playwright'
import { Client } from 'oallet/walletconnect'

await using walletConnect = await Client.create({
  environment,
  projectId: process.env.VITE_WC_PROJECT_ID!,
  walletId: 'test-wallet',
})

const proposal = await walletConnect.pair({
  uri: await Qr.scan(page.getByTestId('walletconnect-qr')),
})

expect(proposal.requiredNamespaces.eip155?.methods).toContain('personal_sign')
const session = await proposal.approve()

const request = await environment
  .wallet('test-wallet')
  .requests.next('personal_sign')
await request.approve()

await session.disconnect()
```

For TypeScript projects targeting ES2022, include `"ESNext.Disposable"` in
`compilerOptions.lib` to type-check `await using`.

Required namespaces are validated strictly. Optional namespaces are reduced to the
supported chain, method, event, and account intersection. `await using` disposes the
test-scoped relay client; `dispose()` is available for explicit `try/finally` cleanup.
`walletConnect.reset()` clears in-flight pairing and sessions while keeping the client
reusable. Real-relay canaries require
`VITE_WC_PROJECT_ID` and remain a release gate rather than a default unit test.

## Validation

```sh
pnpm check
```

The EVM integration suite launches Anvil through `prool`, submits a signed EOA
transaction, returns the RPC hash, and waits for its receipt through an unmodified
viem public client.
