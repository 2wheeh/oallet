# @oallet/evm

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @oallet/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`e562522`](https://github.com/2wheeh/oallet/commit/e5625227a93178ff279269faa3b9c7a48df09768)]:
  - @oallet/core@0.4.0

## 0.3.1

### Patch Changes

- [#7](https://github.com/2wheeh/oallet/pull/7) [`2bc46ad`](https://github.com/2wheeh/oallet/commit/2bc46ad868829256d91d500f956b64bc5de99880) Thanks [@2wheeh](https://github.com/2wheeh)! - Narrow observed request methods, parameters, approval data, and approval results from adapter-provided request definitions.
- Updated dependencies [[`2bc46ad`](https://github.com/2wheeh/oallet/commit/2bc46ad868829256d91d500f956b64bc5de99880)]:
  - @oallet/core@0.3.1

## 0.3.0

### Minor Changes

- [#8](https://github.com/2wheeh/oallet/pull/8) [`9b63832`](https://github.com/2wheeh/oallet/commit/9b63832e1f99b2f906e0b89ae62ca966a2d0af7c) Thanks [@2wheeh](https://github.com/2wheeh)! - Add `Transport.unavailable()` for wallet tests that intentionally have no RPC path and should fail fast on unexpected RPC usage.

### Patch Changes

- [#11](https://github.com/2wheeh/oallet/pull/11) [`873c21b`](https://github.com/2wheeh/oallet/commit/873c21b94e830397e64db6af932aaca0a00294ff) Thanks [@2wheeh](https://github.com/2wheeh)! - Add `Wallet.eoa()` to compose an EOA profile and its viem chain transports in one
  wallet setup call.
- Updated dependencies []:
  - @oallet/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @oallet/core@0.2.1

## 0.2.0

### Minor Changes

- [`f098247`](https://github.com/2wheeh/oallet/commit/f098247049b383e5562334128bbdbefee73081d3) Thanks [@2wheeh](https://github.com/2wheeh)! - Keep injected provider sessions active across same-document navigation, allow profiles
  to declare a wallet-family RDNS, avoid installing WalletConnect through the umbrella
  package unless requested, and stamp snapshots with the producing core package version.

### Patch Changes

- Updated dependencies [[`f098247`](https://github.com/2wheeh/oallet/commit/f098247049b383e5562334128bbdbefee73081d3)]:
  - @oallet/core@0.2.0

## 0.1.0

### Minor Changes

- [`53850cd`](https://github.com/2wheeh/oallet/commit/53850cd306c68acfbcfa65e876196278b3e795da) Thanks [@2wheeh](https://github.com/2wheeh)! - Release the initial deterministic wallet runtime for EVM, browser injection,
  Playwright approval control, and real WalletConnect relay testing.

### Patch Changes

- Updated dependencies [[`53850cd`](https://github.com/2wheeh/oallet/commit/53850cd306c68acfbcfa65e876196278b3e795da)]:
  - @oallet/core@0.1.0
