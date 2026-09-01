# @oallet/playwright

## 0.4.0

### Minor Changes

- [#17](https://github.com/2wheeh/oallet/pull/17) [`e562522`](https://github.com/2wheeh/oallet/commit/e5625227a93178ff279269faa3b9c7a48df09768) Thanks [@2wheeh](https://github.com/2wheeh)! - Make WalletConnect E2E failures easier to localize: distinguish unavailable QR targets
  from undecodable pixels, report pairing start/proposal wait/cleanup stages with stable
  errors and trace fields, and optionally manage the WalletConnect client through the
  Playwright fixture without hiding proposal approval decisions.

### Patch Changes

- Updated dependencies [[`e562522`](https://github.com/2wheeh/oallet/commit/e5625227a93178ff279269faa3b9c7a48df09768)]:
  - @oallet/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`2bc46ad`](https://github.com/2wheeh/oallet/commit/2bc46ad868829256d91d500f956b64bc5de99880)]:
  - @oallet/core@0.3.1

## 0.3.0

### Patch Changes

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

- [#3](https://github.com/2wheeh/oallet/pull/3) [`7693bbe`](https://github.com/2wheeh/oallet/commit/7693bbe2f6d0aee1314248c28d88307c6a14a9d5) Thanks [@2wheeh](https://github.com/2wheeh)! - Retry QR screenshots until they are ready to decode and handle rectangular captures
  without requiring consumer-side Playwright polling.
- Updated dependencies [[`f098247`](https://github.com/2wheeh/oallet/commit/f098247049b383e5562334128bbdbefee73081d3)]:
  - @oallet/core@0.2.0

## 0.1.0

### Minor Changes

- [`53850cd`](https://github.com/2wheeh/oallet/commit/53850cd306c68acfbcfa65e876196278b3e795da) Thanks [@2wheeh](https://github.com/2wheeh)! - Release the initial deterministic wallet runtime for EVM, browser injection,
  Playwright approval control, and real WalletConnect relay testing.

### Patch Changes

- Updated dependencies [[`53850cd`](https://github.com/2wheeh/oallet/commit/53850cd306c68acfbcfa65e876196278b3e795da)]:
  - @oallet/core@0.1.0
