# Oallet

Deterministic wallet surfaces for dApp and SDK end-to-end tests. Oallet keeps wallet
behavior outside application source code, injects standards-based browser discovery,
and routes approvals back to the test process.

## MVP scope

- EVM EOA profiles derived from the standard ten-account Anvil mnemonic
- Real signing and transaction submission through consumer-provided viem transports
- EIP-6963 injection before application code, without `window.ethereum` or an extension
- Solana Wallet Standard discovery with real Ed25519 message signing
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
import { Identity, Wallet } from 'oallet/evm'
import { Browser, Fixture, Qr } from 'oallet/playwright'
import * as Solana from 'oallet/solana'
import { Client } from 'oallet/walletconnect'
```

Direct `@oallet/*` package imports expose the same namespace-based API.
`@oallet/walletconnect` is an optional peer of the umbrella package so EVM-only
installs do not pull in the Reown dependency graph. Install it explicitly when using
`oallet/walletconnect`.

When several Oallet packages are used together, package namespace imports keep generic
module names such as `Client`, `Profile`, and `Wallet` attributable at the call site:

```ts
import * as Core from '@oallet/core'
import * as Evm from '@oallet/evm'
import * as OalletPlaywright from '@oallet/playwright'
import * as WalletConnect from '@oallet/walletconnect'

const wallet = Evm.Wallet.eoa({ /* ... */ })
const environment = Core.Environment.create({ /* ... */ })
const test = OalletPlaywright.Fixture.extend(base, { /* ... */ })
await using client = await WalletConnect.Client.create({ /* ... */ })
```

## Test identities

EVM and Solana share the public Anvil mnemonic
`test test test test test test test test test test test junk`, an empty BIP39
passphrase, and the identity order Alice, Bob, Charlie, Dave, Eve, Frank, Grace,
Heidi, Ivan, Judy. `Identity` from `oallet/core` exposes this `mnemonic` and `names`
list for consumer test infrastructure.

| Adapter | Derivation path for identity index `i` | Key type |
| --- | --- | --- |
| EVM | `m/44'/60'/0'/0/i` | secp256k1 |
| Solana | `m/44'/501'/i'/0'` | Ed25519 via SLIP-0010 |

For example, `Evm.Identity.alice` and `Solana.Identity.alice` both use index `0`.
They are separate keys derived from the same mnemonic, not convertible addresses.
The EVM addresses match Anvil's default accounts. The Solana path follows the
[Solana Cookbook](https://solana.com/developers/cookbook/wallets/restore-from-mnemonic)
and is also [supported by Phantom](https://help.phantom.com/articles/12988493966227).
Oallet explicitly uses this convention; Solana wallets also support other paths.

Solana presets replace the earlier name-hash preview addresses. Fund accounts using
the current `Identity.*.address` values and recreate snapshots made with the preview
profiles. Oallet does not fund these accounts; consumers provide that infrastructure.

## EVM and Playwright

```ts
import { test as base } from '@playwright/test'
import { Environment } from 'oallet/core'
import { Identity, Wallet } from 'oallet/evm'
import { Fixture } from 'oallet/playwright'
import { http } from 'viem'
import { anvil } from 'viem/chains'

export const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.eoa({
          accounts: [Identity.alice, Identity.bob],
          chains: [
            { chain: anvil, transport: http(process.env.ANVIL_RPC_URL) },
          ],
          id: 'test-wallet',
          name: 'Oallet',
          rdns: 'dev.oallet.test-wallet',
        }),
      ],
    }),
})
```

`Wallet.eoa()` is the default EOA setup path. The lower-level primitives remain
available when a test needs to define or reuse profile data separately from its RPC
runtime:

```ts
import { Profile } from 'oallet/evm'

const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [anvil.id],
  id: 'test-wallet',
  name: 'Oallet',
})
const wallet = Wallet.create({
  chains: [{ chain: anvil, transport: http(process.env.ANVIL_RPC_URL) }],
  profile,
})
```

Set `rdns` to the wallet family's EIP-6963 reverse-domain identifier when tests need
to model the same wallet across multiple namespaces. Omit it to use the deterministic
`dev.oallet.<profile-id>` fallback. This reproduces discovery identity metadata, not
vendor-specific wallet behavior or UI.

Interactive requests are manual by default. Use the request queue when the product
interaction is part of the contract under test: assert the method, parameters, or
normalized approval data before deciding the request.

```ts
const result = page.getByRole('button', { name: 'Connect' }).click()
const request = await oallet
  .wallet('test-wallet')
  .requests.next('eth_requestAccounts')
expect(request.data).toEqual({
  accounts: [Identity.alice.address, Identity.bob.address],
  chainId: anvil.id,
  type: 'connect',
})
await request.approve()
await result
```

Use a bounded auto-approval scope only when the interaction is setup for the behavior
under test:

```ts
await oallet.wallet('test-wallet').autoApprove(async () => {
  await page.getByRole('button', { name: 'Connect' }).click()
})
```

Oallet does not impose a manual request timeout. Let the test own that policy with an
`AbortSignal`, including the platform timeout helper when a fixed bound is useful:

```ts
const request = await oallet.wallet('test-wallet').requests.next('personal_sign', {
  signal: AbortSignal.timeout(5_000),
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

## Solana and Wallet Standard

Solana keypair wallets use the same `Environment.create({ wallets: [...] })` state
model as EVM wallets. The Playwright fixture registers them through Wallet Standard,
so applications discover the wallet without a wallet-specific `window` property.

```ts
import { Environment } from 'oallet/core'
import { Identity, Profile, Wallet } from 'oallet/solana'

const profile = Profile.keypair({
  accounts: [Identity.alice],
  chains: ['solana:localnet'],
  id: 'solana-wallet',
  name: 'Oallet Solana',
})

const environment = Environment.create({
  wallets: [Wallet.create({ profile })],
})
```

Wallets support `standard:connect`, `standard:disconnect`, `standard:events`,
`solana:signMessage`, and `solana:signTransaction` for legacy and version-0 wire
transactions. To also expose `solana:signAndSendTransaction`, inject a Kit RPC and
subscription client for every chain in the profile:

```ts
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'

const wallet = Wallet.create({
  profile,
  chains: [{
    chain: 'solana:localnet',
    rpc: createSolanaRpc('http://127.0.0.1:8899'),
    rpcSubscriptions: createSolanaRpcSubscriptions('ws://127.0.0.1:8900'),
  }],
  transactionTimeoutMs: 30_000,
})
```

Without RPC bindings, the wallet continues to offer signing only. Sign-and-send
requires an explicit chain and returns the transaction's signature as 64 raw bytes.
Omitting `options.commitment` returns after RPC acceptance; specifying `processed`,
`confirmed`, or `finalized` waits for that commitment. `preflightCommitment`,
`skipPreflight`, `maxRetries`, and `minContextSlot` control submission separately.
The original transaction message and blockhash are preserved. Confirmation is bounded
by `transactionTimeoutMs` per transaction after approval; timeout, request cancellation,
reset, restore, and disposal fail pending work. Submission does not guarantee confirmation,
and cancellation cannot retract a transaction already submitted to the network.

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

When every WalletConnect test uses the same client configuration, let the Playwright
fixture create the client lazily and dispose it after the test:

```ts
const createEnvironment = () =>
  Environment.create({
    wallets: [
      Wallet.eoa({
        accounts: [Identity.alice],
        chains: [
          { chain: anvil, transport: http(process.env.ANVIL_RPC_URL) },
        ],
        id: 'test-wallet',
        name: 'Oallet',
      }),
    ],
  })

const test = Fixture.extend(base, {
  environment: createEnvironment,
  walletConnect: ({ oallet }) =>
    Client.create({
      environment: oallet,
      projectId: process.env.VITE_WC_PROJECT_ID!,
      walletId: 'test-wallet',
    }),
})

test('connects', async ({ oallet, page, walletConnect }) => {
  const uri = await Qr.scan(page.getByTestId('walletconnect-qr'))
  const proposal = await walletConnect.pair({ uri })
  // Inspect, approve, or reject the proposal explicitly in the test.
})
```

The fixture manages only client creation and disposal. QR scanning, pairing, proposal
inspection, approval, rejection, and session disconnection remain explicit test steps.
`Qr.scan()` reports whether the target could not be captured or its captured pixels
could not be decoded. Pairing failures similarly identify pairing start, proposal wait,
and cleanup stages with stable error codes. Failure trace text includes the WalletConnect
connection ID, stage, and reason so a JSON trace is not required for initial triage.

For TypeScript projects targeting ES2022, include `"ESNext.Disposable"` in
`compilerOptions.lib` to type-check `await using`.

Required namespaces are validated strictly. Optional namespaces are reduced to the
supported chain, method, event, and account intersection. `await using` disposes the
test-scoped relay client; `dispose()` is available for explicit `try/finally` cleanup.
`walletConnect.reset()` clears in-flight pairing and sessions while keeping the client
reusable. Real-relay canaries require
`VITE_WC_PROJECT_ID` and remain a release gate rather than a default unit test.

`session.disconnect()` cancels local requests immediately. Failed disconnects stay
inactive and can be retried; disposal remains terminal.

WalletConnect response traces describe SDK calls, not relay delivery or dApp
settlement. Verify peer-observed outcomes in end-to-end tests.

## Validation

```sh
pnpm check
```

The EVM integration suite launches Anvil through `prool`, submits a signed EOA
transaction, returns the RPC hash, and waits for its receipt through an unmodified
viem public client.

The Solana ConnectorKit suite starts an isolated Surfnet through the Surfpool SDK,
funds the deterministic Oallet accounts, signs a System Program transfer through
Wallet Standard, submits it from the consuming dApp, and verifies the confirmed
transaction and balance change through Solana JSON-RPC.
