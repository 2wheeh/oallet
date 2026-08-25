# WalletConnect pairing cancellation 조사

조사일: 2026-08-25

## 결론

현재 WalletConnect/Reown/Wagmi 웹 생태계에서 dApp의 QR 모달 닫힘은
`AbortSignal`로 wallet peer까지 전파되는 protocol cancellation이 아니다.

- `@walletconnect/ethereum-provider`는 내장 모달이 닫히면 dApp 쪽 `connect()`
  Promise를 `Connection request reset` 오류로 reject한다.
- 그때 호출하는 `UniversalProvider.abortPairingAttempt()`는 현재 명시적인 no-op이다.
- 따라서 모달 닫힘 자체는 wallet에 session proposal rejection, pairing deletion 또는
  session deletion을 보내지 않는다.
- wallet이 이미 proposal을 받았다면 명시적으로 `rejectSession()`하지 않는 한 pending
  proposal은 기본 5분 expiry까지 남을 수 있다.
- 더 나쁘게는 modal close가 이미 시작된 `UniversalProvider.connect()`를 취소하지 않기
  때문에 wallet이 나중에 승인하면 provider 내부에는 session이 생길 수 있다. 바깥
  EthereumProvider/Wagmi 호출만 이미 실패한 상태가 된다.

그러므로 Oallet `Client.pair()` MVP에는 ecosystem parity를 이유로 public
`AbortSignal`을 넣을 근거가 없다. Q13은 **기본 timeout + 호출자 override**로 유지하는
것이 맞다. 내부 구현은 timeout 때 listener를 정리하고, `await using`의 terminal
`dispose()`가 남은 pairing/resource를 정리해야 한다.

## 확인한 package graph

| 역할 | 설치 버전 | 로컬 근거 |
| --- | --- | --- |
| React binding | `wagmi@3.7.6` | `node_modules/.pnpm/wagmi@3.7.6_*/node_modules/wagmi` |
| WalletConnect connector | `@wagmi/connectors@8.1.0` | `node_modules/.pnpm/@wagmi+connectors@8.1.0_*/node_modules/@wagmi/connectors` |
| dApp provider | `@walletconnect/ethereum-provider@2.23.10` | `node_modules/.pnpm/@walletconnect+ethereum-provider@2.23.10_*/node_modules/@walletconnect/ethereum-provider` |
| provider core | `@walletconnect/universal-provider@2.23.10` | `node_modules/.pnpm/@walletconnect+universal-provider@2.23.10_*/node_modules/@walletconnect/universal-provider` |
| wallet peer | `@reown/walletkit@1.5.6` | `node_modules/.pnpm/@reown+walletkit@1.5.6_*/node_modules/@reown/walletkit` |

## 실제 dApp 모달 닫힘

`EthereumProvider.connect()`는 `showQrModal`이 켜져 있을 때 modal state를 구독한다.
session이 아직 없고 modal이 닫히면 다음 두 동작을 한다.

1. `this.signer.abortPairingAttempt()` 호출
2. dApp 쪽 Promise를 `Connection request reset. Please try again.`으로 reject

그 뒤 `finally`에서 modal을 닫는다. 이는
[공식 EthereumProvider 소스](https://github.com/WalletConnect/walletconnect-monorepo/blob/v2.0/providers/ethereum-provider/src/EthereumProvider.ts#L198-L288)와 설치된
`node_modules/.pnpm/@walletconnect+ethereum-provider@2.23.10_*/node_modules/@walletconnect/ethereum-provider/dist/index.js:1`에서 동일하게 확인된다.

그러나 현재 `UniversalProvider.abortPairingAttempt()` 구현은 경고만 남기는 no-op이다.
[공식 UniversalProvider 소스](https://github.com/WalletConnect/walletconnect-monorepo/blob/v2.0/providers/universal-provider/src/UniversalProvider.ts#L349-L352), 설치된
`node_modules/.pnpm/@walletconnect+universal-provider@2.23.10_*/node_modules/@walletconnect/universal-provider/dist/index.cjs:1`.

즉 이 흐름에서 "abort"라는 이름은 현재 실제 peer cancellation을 의미하지 않는다.
`EthereumProvider`의 `ConnectOps`에도 `signal`이 없다.
`node_modules/.pnpm/@walletconnect+ethereum-provider@2.23.10_*/node_modules/@walletconnect/ethereum-provider/dist/types/EthereumProvider.d.ts:32`.

`EthereumProvider`가 만든 outer Promise를 먼저 reject해도 그 안에서 시작한
`this.signer.connect()` Promise에는 취소가 전파되지 않는다. `UniversalProvider.pair()`는
계속 `approval()`을 기다린 뒤 승인되면 `this.session`을 설정한다.
[공식 UniversalProvider pairing 흐름](https://github.com/WalletConnect/walletconnect-monorepo/blob/v2.0/providers/universal-provider/src/UniversalProvider.ts#L235-L270).
따라서 modal close 후 늦은 wallet 승인은 dApp UI/Wagmi state와 provider 내부 session이
어긋나는 orphan-like state를 만들 수 있다. 이는 upstream 소스에서 도출한 inference다.

현재 Oallet Wagmi fixture는 `showQrModal: false`이고 `display_uri`를 받아 React가 QR
`<img>`를 직접 렌더링한다. 따라서 앱이 그 이미지를 숨기거나 자체 modal을 닫는 것은
더욱 명확하게 local UI state 변경일 뿐이다.
`tests/walletconnect-wagmi/fixture/src/App.tsx`.

## Wagmi connector의 취소 동작

설치된 Wagmi WalletConnect connector는 `connect()`에서
`EthereumProvider.connect()`를 그대로 기다린다. provider의 오류 메시지가
`user rejected` 또는 `connection request reset`이면 Wagmi의
`UserRejectedRequestError`로 바꾼다. 별도의 abort 또는 pairing-delete 호출은 없다.

- 로컬:
  `node_modules/.pnpm/@wagmi+connectors@8.1.0_*/node_modules/@wagmi/connectors/src/walletConnect.ts:133`
- 공식:
  [Wagmi WalletConnect connector](https://github.com/wevm/wagmi/blob/main/packages/connectors/src/walletConnect.ts)

Wagmi core `connect()` parameter에도 `AbortSignal`이 없고 connector의 Promise를 기다릴
뿐이다.
`node_modules/.pnpm/@wagmi+core@3.6.4_*/node_modules/@wagmi/core/src/actions/connect.ts:17`.

따라서 Wagmi에서 보이는 `UserRejectedRequestError`는 dApp의 local connect 결과다.
wallet peer가 proposal rejection을 수신했다는 증거가 아니다.

## 서로 다른 종료 사건

### 1. Local modal close

- dApp UI가 닫힌다.
- `showQrModal: true`인 EthereumProvider에서는 local `connect()`가 reject된다.
- current `abortPairingAttempt()`가 no-op이므로 peer message는 보내지 않는다.
- 이미 시작된 approval wait도 멈추지 않는다.
- `showQrModal: false`인 custom UI는 앱이 별도 protocol method를 호출하지 않는 한
  protocol state를 전혀 바꾸지 않는다.

### 2. Pairing delete

Pairing은 session과 분리된 communication channel이다. Pairing API의 명시적인
`disconnect({ topic })`는 pairing을 제거하고 상대 peer는 `pairing_delete`를 관찰할 수
있다. 이것은 modal close와 별개의 protocol action이다.

- [Reown Pairing API: disconnect 및 pairing events](https://docs.reown.com/advanced/api/core/pairing#usage)
- 설치 type:
  `node_modules/.pnpm/@walletconnect+types@2.23.7/node_modules/@walletconnect/types/dist/types/core/pairing.d.ts:77`

### 3. Pairing expiry

pairing은 자체 expiry를 가지며 SDK expirer가 제거하면 `pairing_expire`가 발생한다.
이는 시간이 지나 생기는 cleanup이며 사용자가 modal을 닫았다는 신호가 아니다.
공식 Pairing API는 `pairing_delete`와 `pairing_expire`를 별도 event로 정의한다.
[Reown Pairing API events](https://docs.reown.com/advanced/api/core/pairing#listeners-for-pairing-related-events).

### 4. Session proposal rejection

wallet이 URI로 pair한 뒤 `session_proposal`을 받으면 UI에서 approve 또는 reject해야 한다.
peer-visible rejection은 wallet의 명시적인 `rejectSession({ id, reason })`이다.
[공식 WalletKit usage](https://github.com/WalletConnect/walletconnect-docs/blob/main/docs/walletkit/web/usage.mdx#session-rejection).

WalletKit 1.5.6의 public surface도 `pair`, `approveSession`, `rejectSession`을 분리하며
`pair()`에는 `{ uri, activatePairing? }`만 받는다. `AbortSignal`은 없다.

- `node_modules/.pnpm/@reown+walletkit@1.5.6_*/node_modules/@reown/walletkit/dist/types/types/engine.d.ts:10`
- `node_modules/.pnpm/@reown+walletkit@1.5.6_*/node_modules/@reown/walletkit/dist/types/client.d.ts:18`

proposal은 approve/reject되지 않으면 기본 5분 후 만료된다. 그 뒤 같은 proposal ID로
approve/reject하면 proposal이 없다는 오류가 난다.
[공식 WalletKit usage](https://github.com/WalletConnect/walletconnect-docs/blob/main/docs/walletkit/web/usage.mdx#session-approval).
`proposal_expire`는 별도의 lifecycle event다.
[WalletConnect Sign events spec](https://github.com/WalletConnect/walletconnect-specs/blob/main/docs/specs/clients/sign/session-events.md#proposal_expire).

### 5. Session disconnect

session은 proposal이 승인된 뒤에만 존재한다. 그 뒤의 `disconnectSession()`은 상대에게
`session_delete`를 보내는 별도 action이다.
[공식 WalletKit session disconnect](https://github.com/WalletConnect/walletconnect-docs/blob/main/docs/walletkit/web/usage.mdx#session-disconnect).
따라서 승인 전 modal close를 session disconnect로 모델링할 수도 없다.

## Oallet `Client.pair()`에 미치는 영향

현재 Oallet은 `peer.pair({ uri })`와 `session_proposal` listener를 묶고 기본 30초
timeout을 둔다.
`packages/walletconnect/src/client/create.ts:136`.

새 API는 다음 형태가 적합하다.

```ts
const proposal = await walletConnect.pair({
  uri,
  timeout: 60_000,
})
```

`timeout`은 WalletConnect protocol의 proposal expiry를 재정의하지 않는다. 테스트가
relay 응답을 기다리는 local wait budget이다. 그래서 ecosystem의 5분 proposal expiry와
별개로 짧은 기본값이 필요하다.

timeout 또는 pairing failure 때 지켜야 할 내부 조건은 다음과 같다.

- `session_proposal` listener를 항상 제거한다.
- client를 다시 쓸 수 있도록 pairing-in-progress guard를 해제한다.
- 늦게 도착한 proposal이 이미 끝난 `pair()` 호출에 resolve되지 않게 한다.
- scope가 풀리면 `await using`이 `dispose()`를 호출해 남은 pairing, listener, relay
  resource를 terminal cleanup한다.
- timeout을 wallet의 `proposal.reject()`와 동일시하지 않는다. proposal을 실제로 받은
  뒤 고객 테스트가 거절을 표현할 때만 `proposal.reject()`를 사용한다.

public `signal?: AbortSignal`은 나중에 추가할 수 있지만 그 의미는 반드시 **local wait
cancellation**이어야 한다. peer-visible rejection/deletion을 약속하면 안 된다. 실제로
호출자가 modal close, test-runner cancellation 또는 경쟁 pairing 중단을 제어해야 하는
테스트가 생겼을 때 다음처럼 timeout과 함께 추가할 수 있다.

```ts
await walletConnect.pair({ uri, timeout: 30_000, signal })
```

현재는 그런 고객 테스트가 없고 upstream API들도 signal을 전달하지 않으므로 MVP에는
노출하지 않는다. 내부 timeout/dispose 경로는 향후 signal도 같은 cleanup primitive를
사용할 수 있게 구현한다.

## Q13 결정

**B 유지: 기본 timeout을 제공하고 override를 허용한다.**

```ts
const proposal = await client.pair({ uri })
const slowRelayProposal = await client.pair({ uri, timeout: 60_000 })
```

`AbortSignal`은 ecosystem 관례가 아니며 modal dismiss의 peer semantics도 아니다.
필요성이 증명되면 timeout을 대체하는 C가 아니라 B에 추가되는 orthogonal option으로
도입한다.
