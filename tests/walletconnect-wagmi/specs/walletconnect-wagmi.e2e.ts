import { Environment } from '@oallet/core'
import { Identity, Profile, Wallet } from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { test as base, expect, type Locator } from '@playwright/test'
import { SignClient } from '@walletconnect/sign-client'
import { Instance, Pool } from 'prool'
import {
  createPublicClient,
  defineChain,
  type Hex,
  http,
  isAddressEqual,
  isHex,
  recoverMessageAddress,
  size,
} from 'viem'
import { anvil } from 'viem/chains'

const projectId = process.env.VITE_WC_PROJECT_ID
const secondary = defineChain({
  ...anvil,
  id: 31_338,
  name: 'Anvil Secondary',
})
let pools: readonly [ReturnType<typeof Pool.create>, ReturnType<typeof Pool.create>]
let leases: readonly [
  Awaited<ReturnType<ReturnType<typeof Pool.create>['acquire']>>,
  Awaited<ReturnType<ReturnType<typeof Pool.create>['acquire']>>,
]

const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [anvil.id, secondary.id],
  id: 'walletconnect-wallet',
  name: 'Oallet WalletConnect Wallet',
})

const test = Fixture.extend(base, {
  environment: () =>
    Environment.create({
      wallets: [
        Wallet.create({
          chains: [
            { chain: anvil, transport: http(leases[0].instance.url) },
            { chain: secondary, transport: http(leases[1].instance.url) },
          ],
          profile,
        }),
      ],
    }),
})

test.skip(!projectId, 'Set VITE_WC_PROJECT_ID to run the real-relay canary')

test.beforeAll(async () => {
  pools = [
    Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 }),
    Pool.create({ instance: Instance.anvil({ chainId: secondary.id }), limit: 1 }),
  ]
  leases = [await pools[0].acquire(), await pools[1].acquire()]
})

test.afterAll(async () => {
  await Promise.all(leases.map((lease) => lease.release()))
  await Promise.all(pools.map((pool) => pool.close()))
})

test('Wagmi pairs, signs, and disconnects through the real relay', async ({
  oallet,
  page,
}) => {
  if (!projectId) throw new Error('Missing VITE_WC_PROJECT_ID')
  await using walletConnect = await Client.create({
    environment: oallet,
    projectId,
    walletId: profile.id,
  })

  await page.goto('http://127.0.0.1:4174')
  await page.getByRole('button', { name: 'Connect WalletConnect' }).click()
  const qr = page.getByTestId('walletconnect-qr')
  await expect(qr).toBeVisible()

  const proposal = await walletConnect.pair({
    timeout: 60_000,
    uri: await scanQr(qr),
  })
  const namespace =
    proposal.requiredNamespaces.eip155 ?? proposal.optionalNamespaces.eip155
  expect(namespace?.methods).toContain('personal_sign')
  const session = await proposal.approve()

  await expect(page.getByTestId('status')).toHaveText('connected')
  await expect(page.getByTestId('account')).toHaveText(Identity.alice.address)

  await page.getByTestId('message-input').fill('Hello over WalletConnect')
  await page.getByTestId('sign-message').click()
  const request = await oallet.wallet(profile.id).requests.next('personal_sign')
  await request.approve()
  const signature = await readHex(page.getByTestId('message-signature'), 65)
  await expect(
    recoverMessageAddress({
      message: 'Hello over WalletConnect',
      signature,
    }),
  ).resolves.toBe(Identity.alice.address)

  await session.disconnect()
  await expect(page.getByTestId('status')).toHaveText('disconnected')
})

test('routes a real relay transaction by request chain and switches only on approval', async ({
  oallet,
}) => {
  if (!projectId) throw new Error('Missing VITE_WC_PROJECT_ID')
  await using walletConnect = await Client.create({
    environment: oallet,
    projectId,
    walletId: profile.id,
  })
  const dapp = await SignClient.init({
    customStoragePrefix: `oallet-multichain-${crypto.randomUUID()}`,
    metadata: {
      description: 'Oallet multichain protocol fixture',
      icons: [],
      name: 'Oallet multichain dApp',
      url: 'https://multichain.example',
    },
    projectId,
  })

  try {
    const connection = await dapp.connect({
      optionalNamespaces: {
        eip155: {
          chains: [`eip155:${anvil.id}`, `eip155:${secondary.id}`],
          events: ['chainChanged'],
          methods: ['eth_sendTransaction', 'wallet_switchEthereumChain'],
        },
      },
    })
    if (!connection.uri) throw new Error('Expected a WalletConnect pairing URI')
    const proposal = await walletConnect.pair({
      timeout: 60_000,
      uri: connection.uri,
    })
    const dappSessionPromise = connection.approval()
    const walletSession = await proposal.approve()
    const dappSession = await dappSessionPromise
    const chainEvents: Array<{ chainId: string; data: unknown }> = []
    dapp.on('session_event', (event) => {
      if (event.params.event.name === 'chainChanged') {
        chainEvents.push({
          chainId: event.params.chainId,
          data: event.params.event.data,
        })
      }
    })

    const transactionPromise = dapp.request<Hex>({
      chainId: `eip155:${secondary.id}`,
      request: {
        method: 'eth_sendTransaction',
        params: [
          {
            from: Identity.alice.address,
            to: Identity.bob.address,
            value: '0x1',
          },
        ],
      },
      topic: dappSession.topic,
    })
    const transactionRequest = await oallet
      .wallet(profile.id)
      .requests.next('eth_sendTransaction')

    expect(transactionRequest.chainId).toBe(`eip155:${secondary.id}`)
    await expect(
      oallet.dispatch({
        method: 'eth_chainId',
        origin: transactionRequest.origin,
        walletId: profile.id,
      }),
    ).resolves.toBe('0x7a69')
    await transactionRequest.approve()
    const hash = await transactionPromise
    const publicClient = createPublicClient({
      chain: secondary,
      transport: http(leases[1].instance.url),
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    const transaction = await publicClient.getTransaction({ hash })
    expect(receipt.status).toBe('success')
    expect(isAddressEqual(transaction.from, Identity.alice.address)).toBe(true)
    expect(chainEvents).toEqual([])

    const switchPromise = dapp.request({
      chainId: `eip155:${anvil.id}`,
      request: {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x7a6a' }],
      },
      topic: dappSession.topic,
    })
    const switchRequest = await oallet
      .wallet(profile.id)
      .requests.next('wallet_switchEthereumChain')
    expect(switchRequest.chainId).toBe(`eip155:${anvil.id}`)
    await switchRequest.approve()
    await switchPromise

    await expect
      .poll(() => chainEvents)
      .toEqual([{ chainId: `eip155:${secondary.id}`, data: '0x7a6a' }])
    await expect(
      oallet.dispatch({
        method: 'eth_chainId',
        origin: switchRequest.origin,
        walletId: profile.id,
      }),
    ).resolves.toBe('0x7a6a')

    await walletSession.disconnect()
  } finally {
    await dapp.core.relayer.transportClose()
  }
})

async function readHex(locator: Locator, byteSize: number): Promise<Hex> {
  await expect(locator).not.toBeEmpty()
  const value = await locator.textContent()
  const valid = isHex(value)
  expect(valid).toBe(true)
  if (!valid) throw new Error('Expected a hex value')
  expect(size(value)).toBe(byteSize)
  return value
}

async function scanQr(locator: Locator) {
  let uri: string | undefined
  await expect(async () => {
    uri = await Qr.scan(locator)
  }).toPass({ intervals: [100, 250, 500], timeout: 15_000 })
  if (!uri) throw new Error('Expected a WalletConnect QR URI')
  return uri
}
