import { Environment } from '@oallet/core'
import { Instance, Pool } from 'prool'
import { createPublicClient, http } from 'viem'
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
