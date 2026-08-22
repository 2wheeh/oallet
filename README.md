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
import { Identity, Profile, Runtime, Wallet } from 'oallet/evm'
import { Browser, Fixture, Qr } from 'oallet/playwright'
import { Client } from 'oallet/walletconnect'
```

Direct `@oallet/*` package imports expose the same namespace-based API.

## EVM and Playwright

```ts
import { test as base } from '@playwright/test'
import { Environment } from 'oallet/core'
import { Identity, Profile, Runtime, Wallet } from 'oallet/evm'
import { Fixture } from 'oallet/playwright'
import { http } from 'viem'
import { anvil } from 'viem/chains'

const profile = Profile.eoa({
  accounts: [Identity.alice, Identity.bob],
  chains: [anvil.id],
  id: 'test-wallet',
  name: 'Oallet',
})

const runtime = Runtime.create({
  chains: [{ chain: anvil, transport: http(process.env.ANVIL_RPC_URL) }],
})

const environment = Environment.create({
  wallets: [Wallet.create({ profile, runtime })],
})

export const test = base.extend<Fixture.Value>(Fixture.create({ environment }))
```

Interactive requests are manual by default:

```ts
const result = page.getByRole('button', { name: 'Connect' }).click()
const request = await environment.wallet('test-wallet').requests.next()
await request.approve()
await result
```

Use a bounded auto-approval scope when the interaction itself is not under test:

```ts
const stop = environment.wallet('test-wallet').startAutoApprove()
try {
  await page.getByRole('button', { name: 'Connect' }).click()
} finally {
  stop()
}
```

Call `environment.reset()` explicitly at the lifecycle boundary selected by the test
infrastructure. `environment.snapshot()` and `environment.restore(snapshot)` preserve
deterministic wallet and origin state; active WalletConnect sessions are intentionally
not part of that portable snapshot.

## WalletConnect

WalletConnect uses the real Reown relay path. A `projectId` is mandatory; use a
separate test project ID rather than sharing production credentials.

```ts
import { Qr } from 'oallet/playwright'
import { Client } from 'oallet/walletconnect'

const walletConnect = await Client.create({
  customStoragePrefix: `oallet-${test.info().workerIndex}`,
  environment,
  projectId: process.env.REOWN_TEST_PROJECT_ID!,
})

const proposal = await walletConnect
  .pairFromQr({
    scan: () => Qr.scan(page.getByTestId('walletconnect-qr')),
    walletId: 'test-wallet',
  })
  .nextSessionProposal()

expect(proposal.requiredNamespaces.eip155?.methods).toContain('personal_sign')
const session = await proposal.approveSession()

const request = await environment.wallet('test-wallet').requests.next()
await request.approve()

await session.disconnect()
```

Required namespaces are validated strictly. Optional namespaces are reduced to the
supported chain, method, event, and account intersection. `walletConnect.reset()`
disconnects sessions explicitly. Real-relay canaries require
`REOWN_TEST_PROJECT_ID` and remain a release gate rather than a default unit test.

## Validation

```sh
pnpm check
```

The EVM integration suite launches Anvil through `prool`, submits a signed EOA
transaction, returns the RPC hash, and waits for its receipt through an unmodified
viem public client.
