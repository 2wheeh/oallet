import { Environment } from '@oallet/core'
import { Instance, Pool } from 'prool'
import { createPublicClient, http, parseEther, toHex } from 'viem'
import { anvil } from 'viem/chains'
import { expect, test } from 'vitest'

import * as Identity from '../identity/exports.js'
import * as Profile from '../profile/exports.js'
import * as Wallet from './exports.js'

test('submits a real signed transaction through consumer-owned prool infrastructure', async () => {
  const pool = Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 })
  const lease = await pool.acquire()

  try {
    const transport = http(lease.instance.url)
    const profile = Profile.eoa({
      accounts: [Identity.alice],
      chains: [anvil.id],
      id: 'wallet',
      name: 'Wallet',
    })
    const environment = Environment.create({
      wallets: [Wallet.create({ chains: [{ chain: anvil, transport }], profile })],
    })
    const hash = await environment.wallet('wallet').autoApprove(async () => {
      await environment.dispatch({
        method: 'eth_requestAccounts',
        origin: 'https://app.example',
        walletId: 'wallet',
      })
      return environment.dispatch<`0x${string}`>({
        method: 'eth_sendTransaction',
        origin: 'https://app.example',
        params: [
          { from: Identity.alice.address, to: Identity.bob.address, value: '0x1' },
        ],
        walletId: 'wallet',
      })
    })

    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    const receipt = await createPublicClient({
      chain: anvil,
      transport,
    }).waitForTransactionReceipt({
      hash,
    })
    expect(receipt.status).toBe('success')
  } finally {
    await lease.release()
    await pool.close()
  }
}, 30_000)

test('submits legacy, EIP-2930, and EIP-1559 transactions', async () => {
  const pool = Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 })
  const lease = await pool.acquire()

  try {
    const transport = http(lease.instance.url)
    const profile = Profile.eoa({
      accounts: [Identity.alice],
      chains: [anvil.id],
      id: 'wallet',
      name: 'Wallet',
    })
    const transactions = [
      {
        expectedType: 'legacy',
        request: { gasPrice: '0x77359400', type: '0x0' },
      },
      {
        expectedType: 'eip2930',
        request: { accessList: [], gasPrice: '0x77359400', type: '0x1' },
      },
      {
        expectedType: 'eip1559',
        request: {
          maxFeePerGas: '0xb2d05e00',
          maxPriorityFeePerGas: '0x3b9aca00',
          type: '0x2',
        },
      },
    ] as const

    for (const transaction of transactions) {
      const environment = Environment.create({
        wallets: [Wallet.create({ chains: [{ chain: anvil, transport }], profile })],
      })
      const hash = await environment.wallet('wallet').autoApprove(async () => {
        await environment.dispatch({
          method: 'eth_requestAccounts',
          origin: 'https://app.example',
          walletId: 'wallet',
        })
        return environment.dispatch<`0x${string}`>({
          method: 'eth_sendTransaction',
          origin: 'https://app.example',
          params: [
            {
              ...transaction.request,
              from: Identity.alice.address,
              to: Identity.bob.address,
              value: '0x1',
            },
          ],
          walletId: 'wallet',
        })
      })
      const client = createPublicClient({ chain: anvil, transport })
      const receipt = await client.waitForTransactionReceipt({ hash })
      const submitted = await client.getTransaction({ hash })

      expect(receipt.status).toBe('success')
      expect(submitted.type).toBe(transaction.expectedType)
      await environment.dispose()
    }
  } finally {
    await lease.release()
    await pool.close()
  }
}, 30_000)

test('propagates an insufficient-funds RPC failure to approval and response', async () => {
  const pool = Pool.create({ instance: Instance.anvil({ chainId: anvil.id }), limit: 1 })
  const lease = await pool.acquire()

  try {
    const profile = Profile.eoa({
      accounts: [Identity.alice],
      chains: [anvil.id],
      id: 'wallet',
      name: 'Wallet',
    })
    const environment = Environment.create({
      wallets: [
        Wallet.create({
          chains: [{ chain: anvil, transport: http(lease.instance.url) }],
          profile,
        }),
      ],
    })
    await environment.wallet('wallet').autoApprove(() =>
      environment.dispatch({
        method: 'eth_requestAccounts',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    )
    const response = environment.dispatch({
      method: 'eth_sendTransaction',
      origin: 'https://app.example',
      params: [
        {
          from: Identity.alice.address,
          to: Identity.bob.address,
          value: toHex(parseEther('10001')),
        },
      ],
      walletId: 'wallet',
    })
    const responseError = response.catch((error: unknown) => error)
    const request = await environment
      .wallet('wallet')
      .requests.next('eth_sendTransaction')

    await expect(request.approve()).rejects.toThrow(/insufficient funds/i)
    expect(await responseError).toBeInstanceOf(Error)
    await environment.dispose()
  } finally {
    await lease.release()
    await pool.close()
  }
}, 30_000)
