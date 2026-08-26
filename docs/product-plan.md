# Oallet 기획서

> **Oallet** /wallet/ — Programmable wallets for testing dApps.

## 1. 문서 상태

- 상태: Draft
- 제품명: Oallet
- 고객: wallet integration을 제공하는 dApp 및 SDK 팀
- 비고객: wallet 구현 팀
- 첫 test runner: Playwright
- 첫 release 범위: Chromium, EVM EOA, EIP-6963, WalletConnect
- 다음 범위: Solana, Cosmos
- 후속 범위: EVM Account Abstraction semantic profile
- versioning: MVP 완료 전에는 배포 버전을 정하지 않는다

## 2. 한 줄 정의

Oallet은 실제 extension이나 모바일 기기를 설치하지 않고도 dApp과 wallet SDK가 표준 discovery, 연결, 승인, 서명, 실제 EOA transaction 제출, 오류 및 WalletConnect session lifecycle을 소스 변경 없이 E2E로 검증하게 해주는 programmable wallet testing runtime이다.

## 3. 제품 경계

### 3.1 Oallet이 검증하는 것

Oallet의 테스트 대상은 wallet 구현이 아니라 dApp과 SDK의 wallet integration이다.

- dApp이 표준 discovery로 wallet을 발견하는가
- connector가 실제 provider와 session을 올바르게 구성하는가
- pending, approve, reject, error를 올바르게 처리하는가
- signature와 transaction hash를 이후 SDK 흐름으로 올바르게 전달하는가
- account, chain, disconnect, reconnect event를 올바르게 반영하는가
- WalletConnect namespace와 session lifecycle을 올바르게 처리하는가

### 3.2 Oallet이 검증하지 않는 것

- 실제 MetaMask, Phantom, Keplr UI의 회귀
- wallet 내부 구현의 정확성
- bundler, paymaster 또는 node 자체의 적합성
- 실제 자산이 있는 사용자 key를 이용한 live transaction
- 특정 framework store를 직접 조작한 뒤의 UI 상태

Oallet이 만드는 것은 mock connector가 아니라 dApp이 원래 사용하는 connector가 발견하고 호출하는 mock wallet이다.

## 4. 문제

dApp의 wallet E2E 테스트는 보통 다음 중 하나를 선택한다.

1. 애플리케이션 소스에서 환경 변수로 분기하여 mock connector를 넣는다.
2. MetaMask, Phantom 등의 실제 extension을 설치하고 UI를 자동화한다.
3. wallet 연결 이후의 애플리케이션 상태를 직접 조작한다.
4. WalletConnect 모바일 연결은 수동 테스트로 남긴다.

각 접근에는 분명한 한계가 있다.

- mock connector는 실제 discovery와 connector 구현을 우회한다.
- extension UI 자동화는 selector, browser, extension version 및 timing 변화에 취약하다.
- 애플리케이션 상태 조작은 wallet protocol integration을 테스트하지 않는다.
- 모바일 WalletConnect는 CI에서 느리고 수동 절차가 남는다.
- EVM, Solana, Cosmos의 mock 방식이 서로 달라 테스트 경험이 파편화된다.
- 가짜 transaction hash는 viem, wagmi 등의 실제 receipt 흐름을 검증하지 못한다.

## 5. 제품 목표와 비목표

### 5.1 주요 목표

- production bundle에 Oallet을 import하지 않는다.
- dApp 소스에 mock connector 분기를 추가하지 않는다.
- dApp이 사용하는 표준 discovery와 protocol surface를 그대로 통과한다.
- EOA signature는 실제 deterministic test key로 생성한다.
- EOA transaction은 configured test RPC에 실제로 제출하고 실제 hash를 반환한다.
- WalletConnect는 실제 Reown relay, pairing, proposal, session, request 흐름을 통과한다.
- approve, reject, account change, chain change, disconnect를 테스트 코드에서 제어한다.
- 모든 wallet request와 state transition을 구조화된 trace로 제공한다.
- runner-neutral Controller와 얇은 Playwright Adapter를 유지한다.
- 공통 control plane을 유지하면서 protocol payload는 ecosystem 고유 타입을 보존한다.

### 5.2 비목표

- 실제 wallet extension의 UI를 복제하지 않는다.
- MetaMask나 Phantom의 이름만 붙인 일반 mock preset을 제공하지 않는다.
- MVP에서 legacy `window.ethereum`을 제공하지 않는다.
- Oallet이 Anvil, Starskiff, Prool, Surfpool 또는 Cosmos node lifecycle을 소유하지 않는다.
- MVP에서 custom signer나 실제 사용자 private key를 입력받지 않는다.
- RPC가 없을 때 가짜 EOA transaction hash나 receipt를 만들지 않는다.
- 모든 ecosystem을 하나의 공통 transaction/signature Interface로 평탄화하지 않는다.
- WalletConnect relay가 없을 때 semantic fallback으로 조용히 내려가지 않는다.

## 6. 핵심 원칙

### 6.1 Mock connector가 아니라 mock wallet

Oallet은 wagmi connector나 DelightKit Source를 애플리케이션에 공급하지 않는다. 브라우저와 WalletConnect transport에 표준 wallet surface를 노출하고 dApp이 원래 사용하는 discovery 및 Adapter가 이를 발견하게 한다.

테스트 대상에 포함되는 경로:

- EIP-6963 provider discovery
- injected EIP-1193 connector
- WalletConnect dApp client와 namespace negotiation
- connector grouping, reconnect 및 session restoration
- 이후 Solana Wallet Standard와 Cosmos extension integration

### 6.2 고객은 dApp과 SDK 팀

Oallet은 wallet 팀을 위한 wallet conformance tool이 아니다.

- Oallet: canonical wallet behavior로 dApp/SDK를 검증한다.
- Duroo AA Playground: canonical dApp request로 wallet 구현을 검증한다.

두 방향은 artifact를 공유할 수 있지만 제품 책임은 분리한다.

### 6.3 공통화는 control plane까지만

공통화하는 것:

- discovery
- connect/disconnect
- approve/reject
- account와 chain 변경
- pending request queue
- snapshot/reset
- trace와 test isolation

공통화하지 않는 것:

- EIP-1193 method payload
- Solana Wallet Standard feature input/output
- Cosmos Amino/Direct signer payload
- ecosystem별 signature, transaction, error type

공통 request는 discriminated union으로 표현하고 native payload를 유지한다.

```ts
const request = await wallet.nextRequest()

switch (request.protocol) {
  case 'eip1193':
    request.method
    break
  case 'solana-wallet-standard':
    request.feature
    break
  case 'cosmos-keplr':
    request.operation
    break
}
```

### 6.4 Profile과 Runtime binding 분리

Profile은 wallet이 어떻게 보이는지와 어떻게 행동하는지를 설명하는 순수 data다. Runtime binding은 이번 테스트에서 어떤 RPC, relay, browser, extractor를 사용하는지 설명한다.

```ts
const profile = profiles.evm.eoa({
  identity: identities.alice,
  chains: [localChain],
  capabilities: {
    personalSign: true,
    typedData: true,
    sendTransaction: true,
  },
})
```

```ts
const environment = createEnvironment({
  wallets: [profile],
  runtime: {
    evm: {
      chains: {
        [localChain.id]: {
          chain: localChain,
          transport: http(process.env.RPC_URL),
        },
      },
    },
    walletConnect: {
      projectId: process.env.WALLETCONNECT_PROJECT_ID,
      pairing: qrScanner(),
    },
  },
})
```

Profile은 JSON 직렬화와 fingerprint 계산이 가능해야 한다. viem `Transport`, Playwright `Page`, WalletConnect `projectId` 같은 runtime object는 Profile에 들어가지 않는다.

### 6.5 관찰 가능한 동작을 먼저 모델링

Oallet은 dApp이 관찰할 수 있는 계약을 모델링한다.

- request와 response
- error code와 error shape
- account, chain 및 connection event
- pending, approved, rejected 상태
- session persistence와 expiry
- transaction submission과 hash

AA는 첫 release 범위가 아니다. 후속 semantic AA profile은 JSON-RPC 계약과 상태 전이를 모델링하며 실제 EntryPoint 실행을 주장하지 않는다.

## 7. Identity와 Account

### 7.1 Deterministic preset

MVP에서는 Oallet이 공개된 test-only identity preset만 제공한다.

```ts
identities.alice
identities.bob
```

Identity는 완성된 address가 아니라 mnemonic과 account index를 소유한다.

```ts
type IdentityPreset = {
  mnemonic: string
  accountIndex: number
}
```

초기 mnemonic은 Anvil 기본 mnemonic을 재사용한다.

```text
test test test test test test test test test test test junk
```

- Alice는 account index `0`
- Bob은 account index `1`
- EVM은 Anvil 기본 derivation과 address가 정확히 일치한다.
- Solana는 동일 source에서 Solana derivation으로 Ed25519 signer를 만든다.
- Cosmos는 chain의 coin type과 derivation 설정으로 secp256k1 signer를 만든다.
- Cosmos address의 Bech32 prefix는 chain config가 결정한다.

첫 release 이후 기존 preset key와 address는 변경하지 않고 identity를 append만 한다.

### 7.2 Custom signer와 funding

- MVP public Interface에는 custom signer 입력이 없다.
- Oallet 내부 Adapter는 viem, Solana Kit, CosmJS의 native signer Interface를 사용한다.
- preset address funding은 test infra의 책임이다.
- Oallet은 account balance를 자동 변경하거나 faucet을 호출하지 않는다.
- live/public network 실행은 MVP에서 지원하거나 문서화하지 않는다.

### 7.3 Multiple accounts

하나의 wallet instance는 여러 preset account를 소유할 수 있다.

```ts
evmWallet({
  id: 'test-wallet',
  accounts: [identities.alice, identities.bob],
  selectedAccounts: [identities.alice],
})
```

Wallet이 소유하는 account 목록과 origin/session에 승인한 account 목록은 분리한다.

## 8. Wallet Environment와 Connection

### 8.1 Multiple wallets

Oallet의 최상위 테스트 입력은 하나의 wallet이 아니라 `WalletEnvironment`다.

```ts
environment({
  wallets: [
    evmWallet({ id: 'alice-wallet', identity: identities.alice }),
    evmWallet({ id: 'bob-wallet', identity: identities.bob }),
  ],
})
```

MVP부터 여러 EIP-6963 wallet을 동시에 announce할 수 있어야 한다.

### 8.2 Wallet과 transport

Injected와 WalletConnect는 별도 ecosystem이 아니라 동일 wallet instance가 노출하는 transport다.

공유되는 것:

- identity와 소유 account
- supported chain capability
- signer
- execution endpoint registry

connection/session별로 분리되는 것:

- origin
- transport
- authorized accounts
- authorized chains
- selected/default chain
- permission과 session lifecycle

### 8.3 Origin model

Connection permission은 origin별로 관리한다.

```ts
Map<WalletId, Map<Origin, PermissionState>>
```

- 동일 BrowserContext의 여러 top-level origin을 지원한다.
- 한 origin의 승인이 다른 origin에 새지 않는다.
- cross-origin iframe wallet injection은 MVP 범위가 아니다.
- channel envelope에는 처음부터 `origin`과 `frameId`를 포함한다.

### 8.4 Handle model

Injected 연결 승인은 origin-scoped `ConnectionHandle`을 반환한다.

```ts
const connectRequest = await wallet.nextRequest('eth_requestAccounts')
const connection = await connectRequest.approve()

const signRequest = await connection.nextRequest('personal_sign')
await signRequest.approve()
```

WalletConnect 연결은 `SessionHandle`을 반환한다.

```ts
await using walletConnect = await Client.create({
  environment,
  projectId,
  walletId: wallet.id,
})
const proposal = await walletConnect.pair({ uri: await Qr.scan(locator) })
const session = await proposal.approve()

const request = await wallet.requests.next('personal_sign')
await request.approve()
```

`wallet.nextRequest()`는 연결 전 요청과 모든 connection을 관찰하는 aggregate escape hatch다.

## 9. Runtime Architecture

### 9.1 기본 구조

Node sidecar나 daemon은 제품의 전제 조건이 아니다. 기본 Runtime은 Playwright process 안의 test-scoped Controller다.

```text
Playwright test process
  └─ WalletController
       ├─ preset signers
       ├─ request queue
       ├─ state/snapshot/trace
       └─ WalletKit
             ↕ versioned channel
BrowserContext
  └─ protocol browser adapters
```

Controller 자체는 runner-neutral이며 Playwright가 lifecycle과 channel만 연결한다.

### 9.2 Controller 책임

- account와 connection state
- approval queue와 FIFO ordering
- signing
- safe RPC forwarding
- transaction preparation과 submission
- WalletKit pairing/session/request 처리
- snapshot/reset
- exhaustive trace

### 9.3 Browser Adapter 책임

- 표준 discovery 등록
- native request를 wire envelope로 직렬화
- Controller response/error를 native 형태로 복원
- account, chain, disconnect event 방출

Browser Adapter는 wallet state나 signing key를 소유하지 않는다.

### 9.4 Channel

Browser와 Controller는 versioned JSON-safe envelope로 통신한다.

```ts
type WireRequest = {
  version: 1
  requestId: string
  walletId: string
  protocol: 'eip1193' | 'solana-wallet-standard' | 'cosmos-keplr'
  operation: string
  payload: JsonValue
  context: {
    origin: string
    frameId?: string
  }
}
```

Codec 규칙:

- `bigint`: decimal string
- binary: base64 또는 hex
- EVM quantity: native hex 유지
- Error: code, message, data, cause envelope
- class instance와 function은 channel을 통과하지 않는다.

### 9.5 Lifecycle policy

Core는 lifecycle을 강제하지 않는다. Playwright Adapter는 안전한 기본값을 제공한다.

```ts
test.use({
  walletLifecycle: 'test',
})
```

- `test`: 테스트 종료 시 자동 reset
- `worker`: worker 동안 state 유지
- `manual`: 프로젝트가 reset/snapshot/restore 관리

### 9.6 Playwright composition

Oallet은 built-in `context`와 `page` fixture를 override하지 않는다. 기존 fixture에 합성 가능한 automatic installation fixture를 제공한다.

```ts
import { test as base } from './existing-fixtures'
import { createOalletFixture } from 'oallet/playwright'

export const test = base.extend(
  createOalletFixture({
    environment: async ({ starskiff }) =>
      createEnvironment({
        wallets: [aliceWallet],
        runtime: {
          evm: {
            chains: {
              [starskiff.chain.id]: {
                chain: starskiff.chain,
                transport: http(starskiff.rpcUrl),
              },
            },
          },
        },
      }),
  }),
)
```

- environment resolver는 기존 Playwright fixture dependency를 받을 수 있다.
- static environment는 shorthand로 지원한다.
- 이미 navigation된 page가 있으면 조용히 reload하지 않고 fail-fast한다.

## 10. Request Control

### 10.1 Manual by default

사용자 영향 request는 기본적으로 test code가 직접 승인하거나 거절한다.

```ts
const pending = wallet.nextRequest('eth_sendTransaction')

await page.getByText('Swap').click()

const request = await pending
expect(request.params.value).toBe('0x0')

const hash = await request.approve()
```

기본 manual 대상:

- connect
- account/chain authorization
- chain switch/add
- signing
- transaction submission
- WalletConnect session proposal

Read-only RPC와 조회 method는 자동 처리한다.

### 10.2 Auto-approve scope

Global policy나 Profile option 대신 특정 wallet instance에 명시적인 임시 scope를 연다.

```ts
const stopAutoApprove = wallet.startAutoApprove()

try {
  await runSmokeFlow(page)
} finally {
  stopAutoApprove()
}
```

규칙:

- 활성화 이후 새로 들어오는 모든 interactive request를 승인한다.
- 이미 pending인 request는 건드리지 않는다.
- connect, sign, transaction, chain switch, WC proposal에 동일하게 적용한다.
- `stop()`은 idempotent다.
- test teardown 시 남은 scope를 자동 정리한다.
- multiple wallet environment에서는 선택한 wallet에만 적용한다.

### 10.3 Ordering과 cancellation

- 동시에 들어온 interactive request는 모두 pending으로 수신한다.
- 기본적으로 FIFO 순서로만 결정 가능하다.
- out-of-order response는 후속 vendor/concurrency profile에서만 지원한다.
- manual approval에는 별도 고정 timeout을 두지 않는다.
- Playwright test cancellation/teardown이 pending request를 종료한다.
- `wallet.requests.next()`는 `AbortSignal`을 받아 Playwright timeout과 teardown에 연결할 수 있다.
- page close와 disconnect는 관련 pending request를 native error로 종료한다.

### 10.4 Control stream과 trace 분리

Control stream에는 사용자 결정이 필요한 request만 들어간다. 다음은 exhaustive trace에만 기록한다.

- `eth_chainId`, `eth_accounts`
- read-only RPC
- receipt polling
- 자동 처리된 request
- internal WalletConnect lifecycle telemetry

### 10.5 Unsupported method

Profile에 선언되지 않은 wallet method는 pending으로 남기지 않고 protocol-native unsupported error를 즉시 반환한다.

MVP는 custom method handler를 제공하지 않는다. Typed registry와 runtime extension은 실제 consumer 요구가 생긴 뒤 추가한다.

## 11. EVM EOA

### 11.1 Discovery

MVP는 EIP-6963만 공식 지원한다.

- 여러 wallet을 동시에 announce할 수 있다.
- name, RDNS, icon 등 discovery metadata는 userland에서 설정 가능하다.
- `window.ethereum` legacy injection은 요구가 생기면 별도 Adapter로 추가한다.
- Oallet은 MetaMask, Rabby 등의 브랜드 fidelity를 주장하지 않는다.

### 11.2 초기 wallet surface

Oallet 직접 처리:

- `eth_requestAccounts`
- `eth_accounts`
- `eth_chainId`
- `wallet_switchEthereumChain`
- `personal_sign`
- `eth_signTypedData_v4`
- `eth_sendTransaction`

MVP에서 `wallet_addEthereumChain`과 `eth_sign`은 지원하지 않는다.

### 11.3 Safe EIP-1193 RPC proxy

Configured execution route가 있으면 EIP-1193 provider는 일반 read RPC를 viem `Transport`로 전달한다.

기본 허용:

- call, estimate, balance, code
- block, logs, fee
- transaction과 receipt 조회

기본 차단:

- `anvil_*`
- `hardhat_*`
- `evm_*`
- `debug_*`
- `admin_*`
- `miner_*`
- `personal_unlockAccount`, `personal_newAccount`, `personal_sendTransaction` 등 node keystore method
- 알 수 없는 write/admin method

`personal_sign`은 Oallet signer가 직접 처리한다. MVP read allowlist는 고정되어 있으며 custom method extension은 제공하지 않는다.

### 11.4 Supported chain과 execution route

Profile의 supported chain metadata와 viem runtime binding은 서로 다른 값이지만, MVP에서는 모든 supported chain에 실행 가능한 binding을 요구한다.

```ts
const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [ethereum.id, localChain.id],
  id: 'alice',
  name: 'Alice',
})

const wallet = Wallet.create({
  profile,
  chains: [
    { chain: ethereum, transport: ethereumTransport },
    { chain: localChain, transport: localTransport },
  ],
})
```

- supported chain은 discovery, authorization, request routing, switching, signing에 사용한다.
- 각 supported chain은 environment 생성 시점에 하나의 viem `Chain`과 `Transport` binding을 가져야 한다.
- 직접 EIP-1193 요청은 origin connection의 active chain을 사용한다.
- WalletConnect의 CAIP-2 chain context는 해당 chain으로 요청을 라우팅하지만 active chain을 바꾸거나 `chainChanged`를 발생시키지 않는다.
- 명시적인 `wallet_switchEthereumChain`만 승인 후 active chain을 변경한다.
- Oallet은 가짜 hash나 receipt를 만들지 않는다.

### 11.5 `wallet_addEthereumChain`

MVP에서는 즉시 `4200 Unsupported Method`로 거절한다. dApp이 전달한 chain metadata나 `rpcUrls`를 저장하거나 Controller endpoint로 사용하지 않는다. 동적 chain 추가가 실제 고객 테스트를 막는다는 증거가 생기면, 미리 등록된 viem `Transport`만 활성화하는 별도 승인 흐름으로 설계한다.

### 11.6 실제 transaction 제출

`eth_sendTransaction` 승인 흐름:

1. `from`이 connection에 승인된 preset account인지 검증한다.
2. nonce, gas, fee를 configured RPC에서 준비한다.
3. preset key로 실제 transaction을 서명한다.
4. `eth_sendRawTransaction`으로 제출한다.
5. RPC가 반환한 실제 transaction hash를 dApp에 즉시 반환한다.

MVP는 legacy(`0x0`), EIP-2930(`0x1`), EIP-1559(`0x2`) transaction을 지원한다. EIP-4844 blob transaction(`0x3`)과 알 수 없는 type은 승인 queue에 넣기 전에 `-32602 Invalid Params`로 거절한다.

Oallet은 receipt까지 기다리거나 자동 mine하지 않는다. Inclusion, confirmation, receipt polling은 dApp SDK와 test infra의 책임이다.

## 12. WalletConnect

### 12.1 실제 protocol 사용

WalletConnect MVP는 `@reown/walletkit`을 wrapping한 실제 wallet peer다.

```text
dApp client
  ↕ Reown relay
Oallet WalletKit peer
  ↕
WalletController
```

- WalletConnect transport를 구성하려면 `projectId`가 필수다.
- Oallet은 공용 project ID를 제공하지 않는다.
- test용 project ID를 production과 분리하도록 문서화한다.
- project ID 또는 relay가 없으면 fail-fast한다.
- injected나 semantic mode로 몰래 fallback하지 않는다.

### 12.2 QR pairing

Oallet은 Reown component selector를 핵심 seam으로 삼지 않는다. visible page/modal에서 QR을 찾아 `wc:` URI를 decode하는 generic visual scanner를 primary로 사용한다.

```ts
const proposal = await walletConnect.pair({
  uri: await Qr.scan(page.getByTestId('walletconnect-qr')),
})
```

- QR scan과 pairing은 테스트가 명시적으로 조합한다.
- scanner는 `wc:` URI만 pairing 대상으로 인정한다.
- 여러 QR이 있으면 custom locator/extractor로 범위를 좁힐 수 있다.
- raw URI의 symmetric key는 result와 trace에서 redact한다.

### 12.3 Pairing Flow DX

검증이 필요한 테스트:

```ts
const proposal = await walletConnect.pair({ uri: await Qr.scan(locator) })
expect(proposal.requiredNamespaces).toMatchObject(...)

const session = await proposal.approve()
```

Smoke test:

```ts
const session = await (
  await walletConnect.pair({ uri: await Qr.scan(locator) })
).approve()
```

거절 테스트:

```ts
const proposal = await walletConnect.pair({ uri: await Qr.scan(locator) })
await proposal.reject()
```

`pair()`는 기본 30초 안에 proposal을 기다리며 테스트별로 `timeout`을 덮어쓸 수 있다.

### 12.4 Namespace negotiation

`proposal.approve()`는 Profile capability를 기준으로 namespace를 생성한다.

- required chain/method/event 중 하나라도 미지원이면 승인하지 않는다.
- optional namespace는 지원 가능한 교집합만 승인한다.
- 테스트는 proposal의 required/optional namespace를 승인 전에 검사할 수 있다.
- custom namespace를 승인하려면 명시적인 approval payload를 전달한다.
- 승인과 거절 lifecycle을 trace에 기록한다.

### 12.5 Session lifecycle

MVP `SessionHandle`은 승인된 `namespaces`와 idempotent `disconnect()`만 제공한다.
session request는 별도 queue를 만들지 않고 해당 wallet의 request queue로 전달한다.

namespace update, expiry, session metadata, page reload restoration은 실제 고객 테스트
수요가 확인된 뒤 추가하는 후속 범위다.

### 12.6 CI 정책

- 모든 PR: WalletKit Adapter unit/contract test
- main/nightly: 실제 relay canary
- release candidate: 실제 relay suite 필수 통과
- relay 장애는 일반 PR을 막지 않지만 별도 상태로 드러낸다.
- consumer dogfood는 nightly 또는 release-candidate 단계에서 수행한다.

## 13. Error Model

dApp에는 protocol-native error를 그대로 전달하고 trace에서만 공통 envelope로 투영한다.

```ts
await request.reject(errors.evm.userRejected())
await proposal.reject(errors.walletConnect.unsupportedChains())
```

dApp이 받는 값:

- EVM: EIP-1193/JSON-RPC code, message, data
- WalletConnect: SDK-compatible session/request error
- Solana: Wallet Standard 호환 error
- Cosmos: provider-native error

Trace 내부는 `category`, `protocol`, `raw`, `cause`를 가진 normalized envelope를 사용한다.

## 14. Snapshot과 Reset

### 14.1 Core API

```ts
await wallet.reset()
const snapshot = await wallet.snapshot()
await wallet.restore(snapshot)
```

Snapshot은 JSON 직렬화 가능하지만 내부 필드를 직접 수정하는 공개 state schema는 아니다.

- Oallet version과 Profile fingerprint 포함
- incompatible snapshot fail-fast
- secret/private key 제외
- pending request가 있는 상태의 snapshot은 기본적으로 금지
- test code는 snapshot 편집 대신 `setAccounts`, `switchChain`, `disconnect` command 사용

### 14.2 Snapshot 범위

Oallet snapshot에 포함:

- wallet account/selection state
- origin permission
- injected connection metadata
- chain selection
- internal counters와 trace cursor

포함하지 않음:

- active WalletConnect cryptographic session과 symmetric key
- RPC node balances, nonce, contracts, blocks, receipts
- pending Promise와 handler

WalletConnect restore는 같은 Controller lifecycle 안에서 검증한다. Chain snapshot과 restore는 test infra 책임이다.

## 15. Trace와 Assertions

### 15.1 Trace

모든 protocol traffic과 state transition을 항상 구조화해서 수집한다.

최소 포함 항목:

- discovery와 connection
- raw request와 response
- control decision
- state transition
- emitted event
- RPC submission과 transaction hash
- WalletConnect topic/request ID
- timing과 error cause

Playwright Adapter는 성공 시 trace를 메모리에 유지하고 실패 시 JSON과 text summary를 `testInfo.attach()`로 자동 첨부한다.

항상 redact:

- private key와 mnemonic
- WalletConnect symmetric key
- raw pairing URI

### 15.2 Assertion 경계

Oallet은 protocol-level matcher만 제공한다.

```ts
await expect(wallet).toHaveReceivedRequest('personal_sign')
await expect(wallet).toHaveSubmittedTransaction({ chainId: 31_337 })
await expect(connection).toHaveEmitted('accountsChanged')
await expect(session).toBeActive()
```

dApp UI, React/wagmi store, modal DOM은 Playwright `expect(page...)`로 검증한다.

## 16. Source-free Integration의 의미

Oallet이 보장하는 source-free integration:

- production bundle에 Oallet을 import하지 않는다.
- 환경 변수로 mock connector를 선택하지 않는다.
- application state를 테스트 전용 코드로 덮어쓰지 않는다.
- Playwright fixture와 browser initialization에서만 Oallet을 설정한다.

단, dApp은 실제 사용자에게 제공하는 connector와 transport를 원래부터 포함해야 한다.

- EIP-6963 wallet을 테스트하려면 dApp이 EIP-6963 discovery를 지원해야 한다.
- WalletConnect를 테스트하려면 dApp에 WalletConnect client와 QR UI가 있어야 한다.
- 실제 receipt 흐름을 테스트하려면 dApp public client와 Oallet execution route가 같은 test infra를 바라봐야 한다.
- test RPC URL을 기존 test configuration/env로 제공하는 것은 source-free 원칙과 충돌하지 않는다.

## 17. Package 구성

실제 구현 package:

```text
@oallet/core
@oallet/evm
@oallet/walletconnect
@oallet/playwright

후속:
@oallet/solana
@oallet/cosmos
```

Umbrella package:

```text
oallet
  ├─ oallet/core
  ├─ oallet/evm
  ├─ oallet/walletconnect
  ├─ oallet/playwright
  ├─ oallet/solana
  └─ oallet/cosmos
```

사용자는 umbrella subpath와 개별 package 중 하나를 선택한다.

```ts
import { createEnvironment } from 'oallet/core'
import { identities, profiles } from 'oallet/evm'
import { createOalletFixture } from 'oallet/playwright'
```

- `@oallet/core`는 runner와 ecosystem SDK를 모른다.
- 각 Adapter package는 protocol-native dependency를 소유한다.
- `@oallet/playwright`는 stable Playwright primitive만 사용하는 얇은 Adapter다.
- `@playwright/test`는 bundled dependency가 아니라 peer dependency다.
- stable package만 umbrella에 포함한다.
- 첫 release 이후 공식 package는 lockstep version으로 배포한다.

## 18. Solana와 Cosmos 확장 원칙

첫 release 직후 Solana와 Cosmos를 같은 control plane 위에 추가한다.

### 18.1 Protocol-native 책임

- EVM `eth_sendTransaction`: Oallet wallet이 submit
- Solana `signAndSendTransaction`: Oallet wallet이 submit
- Solana `signTransaction`: Oallet은 sign만 수행
- Cosmos `signDirect`/`signAmino`: Oallet은 OfflineSigner 역할만 수행하고 dApp이 broadcast

모든 ecosystem에 동일한 submission 추상화를 강제하지 않는다.

### 18.2 Solana

- Solana Wallet Standard discovery
- Standard Connect, Disconnect, Events
- signMessage
- signTransaction
- signAllTransactions
- signAndSendTransaction
- legacy/versioned transaction capability
- Solana Kit native signer/runtime types

### 18.3 Cosmos

- `window.keplr` compatible surface
- `enable`
- `experimentalSuggestChain`
- `getKey`
- `getOfflineSigner`
- `getOfflineSignerOnlyAmino`
- `signAmino`
- `signDirect`
- key store change event
- chain별 coin type, derivation, Bech32 prefix

## 19. Account Abstraction 후속 범위

AA는 첫 release와 Solana/Cosmos보다 우선하지 않는다.

초기 AA 지원은 semantic profile이다.

- EIP-5792 capability response
- bundle ID와 calls status transition
- approve/reject/error lifecycle
- 4337 account와 7702 delegated account의 관찰 가능한 차이
- passkey-like signature shape와 ERC-1271 expected response

이는 실제 EntryPoint, bundler, paymaster 실행을 증명하지 않는다. Execution-backed AA는 별도 후속 fidelity로만 검토한다.

## 20. Dogfood와 Conformance

### 20.1 Repo 내부 release fixture

Oallet repo 내부에 최소 reference dApp을 둔다.

- direct EIP-1193 consumer
- wagmi consumer
- viem receipt flow
- Reown WalletConnect QR consumer
- 이후 Solana Kit/CosmJS consumer

이 fixture가 release gate다.

### 20.2 External dogfood

다음 repo는 nightly 또는 release-candidate canary로 사용한다.

- DelightKit: EVM, Solana, Cosmos, WalletConnect
- Duroo AA Playground: EVM AA, WalletConnect
- Trust Connect SDK: EVM, Solana, WalletConnect

External repo 상태가 일반 Oallet release를 직접 막지는 않지만 실패를 별도 canary로 드러낸다.

### 20.3 Duroo와의 관계

- Duroo: canonical dApp request로 wallet 구현 검증
- Oallet: canonical wallet behavior로 dApp 구현 검증

장기 공유 후보:

- request와 error fixture
- capability profile
- expected state transition
- conformance report schema
- EIP-5792 scenario 정의

## 21. MVP 완료 기준

첫 release는 다음 열 가지를 모두 통과해야 한다.

1. Wagmi dApp이 소스 분기 없이 EIP-6963 Oallet wallet을 발견한다.
2. Alice를 연결하고 실제 `personal_sign`과 typed-data signature를 생성한다.
3. 사용자 제공 test RPC로 실제 EOA transaction을 제출한다.
4. dApp의 viem/wagmi가 실제 hash로 receipt를 조회한다.
5. Reown QR에서 URI를 추출하고 실제 relay로 pairing한다.
6. required/optional namespace를 검사한 뒤 proposal을 승인하거나 거절한다.
7. WalletConnect를 통해 동일 Alice가 실제 signature와 transaction을 생성한다.
8. account/chain 변경, disconnect, page reload restore를 검증한다.
9. reset, snapshot, restore를 검증한다.
10. 실패한 Playwright test에 redacted wallet trace artifact가 자동 첨부된다.

MVP 공식 browser는 Chromium이다. Firefox와 WebKit은 막지 않지만 release matrix에 포함하지 않는다.

## 22. Roadmap

### Phase 1 — EVM EOA + WalletConnect MVP

- runner-neutral Controller
- versioned browser channel
- EIP-6963 multiple wallet discovery
- multiple account와 origin-scoped connection
- EVM manual approval과 auto-approve scope
- viem-native execution route
- actual EOA signing/submission
- WalletKit actual relay peer
- QR scanner와 direct proposal pairing
- snapshot/reset/trace/assertions

### Phase 2 — Solana

- Wallet Standard Adapter
- deterministic Solana identity derivation
- Kit-native signer
- sign/sign-and-send flow
- Trust Connect SDK와 DelightKit dogfood

### Phase 3 — Cosmos

- Keplr-compatible Adapter
- chain별 derivation과 Bech32
- Amino/Direct signer
- DelightKit dogfood

### Phase 4 — AA semantic profiles

- EIP-5792 lifecycle
- 4337/7702 observable behavior
- passkey and ERC-1271 response fixtures
- Duroo artifact 공유

### 후속 검토

- legacy `window.ethereum`
- Firefox/WebKit 공식 matrix
- custom signer와 live execution
- active WalletConnect session의 portable snapshot
- execution-backed AA
- Cypress/WebDriver Adapter
- vendor quirk profile

## 23. 성공 지표

- production source의 mock 분기 없이 최초 wallet E2E가 동작하는 시간
- 실제 hash와 receipt를 검증하는 EOA test 비율
- WalletConnect 수동 모바일 테스트를 자동화한 비율
- CI flaky retry 비율
- 실패 원인을 trace만으로 분류할 수 있는 비율
- 실제 wallet integration bug를 재현 fixture로 전환하는 시간
- DelightKit, Duroo, Trust Connect SDK에서 제거된 mock connector/source branch 수
- 지원 Profile 수보다 Profile당 검증된 scenario 수

## 24. 주요 위험

### 24.1 표준과 실제 wallet의 차이

표준 behavior와 vendor quirk를 구분한다. 브랜드 preset은 실제 관찰 자료와 version metadata가 생긴 뒤에만 제공한다.

### 24.2 지나친 범용화

공통 control과 trace만 통합하고 protocol payload와 signer Interface는 ecosystem 고유 타입을 유지한다.

### 24.3 WalletConnect 운영 의존성

실제 relay와 project ID는 protocol fidelity를 주지만 CI determinism을 낮춘다. Live relay suite를 per-PR unit test와 분리한다.

### 24.4 QR UI 변경

Reown 내부 selector 대신 generic visual QR decoding을 사용한다. Custom locator와 extractor는 escape hatch다.

### 24.5 RPC와 dApp public client 불일치

Oallet execution route와 dApp public client가 다른 node를 바라보면 receipt 테스트가 실패한다. Oallet은 endpoint를 숨겨서 rewrite하지 않고 setup requirement와 trace를 명확히 제공한다.

### 24.6 Test state leakage

Playwright Adapter는 test isolation을 기본으로 제공한다. Worker/manual lifecycle은 명시적으로 선택한다.

### 24.7 Profile 신뢰 과장

Oallet은 branded wallet fidelity나 실제 AA execution을 수행하지 않은 상태에서 이를 주장하지 않는다.

## 25. 확정된 결정

- 고객은 dApp과 SDK 팀이며 wallet 팀은 고객이 아니다.
- MVP는 EVM EOA와 WalletConnect다.
- Solana와 Cosmos는 첫 release 직후 진행한다.
- AA는 후속 semantic profile이며 초기 우선순위가 아니다.
- mock connector가 아니라 표준 wallet surface를 노출한다.
- EIP-6963만 MVP에서 지원하고 legacy `window.ethereum`은 제외한다.
- EOA signature와 transaction submission은 실제로 수행한다.
- transaction이 성공하면 반드시 RPC가 반환한 실제 hash를 돌려준다.
- node lifecycle과 funding은 test infra 책임이다.
- custom signer와 live key는 MVP에서 제외한다.
- preset identity는 Anvil mnemonic과 account index를 기반으로 한다.
- WalletConnect는 실제 Reown relay와 WalletKit peer를 사용한다.
- WalletConnect transport를 활성화하려면 runtime에 `projectId`가 필수다.
- QR은 generic visual scanner로 획득한다.
- session proposal은 manual이 기본이며 Profile capability로 엄격히 검증한다.
- Controller는 runner-neutral이고 Playwright Adapter는 얇게 유지한다.
- Browser Adapter는 dumb protocol facade다.
- Profile은 serializable data이고 runtime binding과 분리한다.
- interactive request는 manual이 기본이다.
- auto approval은 `wallet.autoApprove(callback)`의 callback lifetime으로만 제공한다.
- multiple wallet, multiple account, multiple top-level origin을 MVP에서 지원한다.
- active chain은 wallet-global이 아니라 origin connection별 상태다. WalletConnect request의 chain context는 별도의 요청 단위 값이다.
- snapshot은 EVM origin connection의 accounts, active chain, connected 상태를 포함하지만 active WalletConnect cryptographic session은 포함하지 않는다.
- trace는 항상 수집하고 실패 시 Playwright artifact로 자동 첨부한다.
- Oallet assertion은 protocol-level까지만 제공한다.
- 공식 package는 첫 release 이후 lockstep version을 사용한다.
- MVP 공식 browser는 Chromium이다.

## 26. 남은 구현 질문

- Browser–Controller channel codec의 exact schema
- Playwright automatic fixture ordering과 pre-navigation 감지 방식
- trace JSON schema와 Playwright matcher 이름
- Solana와 Cosmos의 exact derivation path
- 첫 release package build와 bundling 도구
