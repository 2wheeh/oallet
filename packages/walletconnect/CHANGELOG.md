# @oallet/walletconnect

## 0.5.0

### Minor Changes

- [#19](https://github.com/2wheeh/oallet/pull/19) [`d77b165`](https://github.com/2wheeh/oallet/commit/d77b165b56d6493998b96aaaf0c54a73d59f43ce) Thanks [@2wheeh](https://github.com/2wheeh)! - Clean up the WalletConnect timeout error and fixture resource interfaces.
  
  ```diff
  -new PairingTimeoutError(message, stage, { cause })
  +new PairingTimeoutError(message, { stage, cause })
  
  -type Fixture.extend.ManagedWalletConnect
  +type Fixture.extend.WalletConnectResource
  ```

### Patch Changes

- Updated dependencies []:
  - @oallet/core@0.5.0

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

- [#5](https://github.com/2wheeh/oallet/pull/5) [`178c54e`](https://github.com/2wheeh/oallet/commit/178c54ebd893efcb1083f33f1a0b56a60646dcf2) Thanks [@2wheeh](https://github.com/2wheeh)! - Avoid publishing the initial account connection before the WalletConnect session is
  ready, preventing approval from hanging on the relay.
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
