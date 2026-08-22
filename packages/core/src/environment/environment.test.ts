import { expect, test } from 'vitest'
import * as Profile from '../profile/exports.js'
import type * as Wallet from '../wallet/exports.js'
import * as Environment from './exports.js'

function testWallet(): Wallet.Adapter {
  let value = 0
  const profile = Profile.define({ data: {}, id: 'wallet', kind: 'test', name: 'Wallet' })
  return {
    profile,
    async prepare(request) {
      if (request.method === 'read') return { type: 'return', value }
      return {
        type: 'interactive',
        approve() {
          value += 1
          return value
        },
        data: { next: value + 1 },
      }
    },
    reset() {
      value = 0
    },
    restore(snapshot) {
      value = snapshot as number
    },
    snapshot() {
      return value
    },
  }
}

test('holds an interactive request until the test approves it', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    params: [],
    walletId: 'wallet',
  })

  const request = await wallet.requests.next()

  expect(request.method).toBe('write')
  expect(request.origin).toBe('https://app.example')
  expect(request.data).toEqual({ next: 1 })
  await expect(request.approve()).resolves.toBe(1)
  await expect(result).resolves.toBe(1)
  expect(request.status).toBe('approved')
})

test('rejects a pending request with an owned error', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const request = await environment.wallet('wallet').requests.next()

  request.reject()

  await expect(result).rejects.toBeInstanceOf(Environment.RequestRejectedError)
  expect(request.status).toBe('rejected')
})

test('auto-approves only while the wallet scope is active', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')
  const stop = wallet.startAutoApprove()

  await expect(
    environment.dispatch({
      method: 'write',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe(1)

  stop()
  stop()
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const request = await wallet.requests.next()
  await request.approve()

  await expect(result).resolves.toBe(2)
})

test('snapshots, restores, and resets adapter state explicitly', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')
  const stop = wallet.startAutoApprove()

  await environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const snapshot = await environment.snapshot()
  await environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  await environment.restore(snapshot)

  await expect(
    environment.dispatch({
      method: 'read',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe(1)

  await environment.reset()
  await expect(
    environment.dispatch({
      method: 'read',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe(0)
  stop()
})

test('isolates request queues between wallets', async () => {
  const one = testWallet()
  const two = {
    ...testWallet(),
    profile: Profile.define({ data: {}, id: 'two', kind: 'test', name: 'Two' }),
  }
  const environment = Environment.create({ wallets: [one, two] })
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'two',
  })

  const request = await environment.wallet('two').requests.next()
  await request.approve()

  await expect(result).resolves.toBe(1)
})

test('exposes diagnostics as an immutable snapshot', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })

  await environment.dispatch({
    method: 'read',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const trace = environment.trace

  expect(Object.isFrozen(trace)).toBe(true)
  expect(trace.map((entry) => entry.phase)).toEqual(['received', 'prepared', 'returned'])
})
