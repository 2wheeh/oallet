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
    validateSnapshot(snapshot) {
      if (typeof snapshot !== 'number') throw new Error('Snapshot must be a number')
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

  const request = await wallet.requests.next('write')

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
  const request = await environment.wallet('wallet').requests.next('write')

  request.reject()

  await expect(result).rejects.toBeInstanceOf(Environment.RequestRejectedError)
  expect(request.status).toBe('rejected')
})

test('rejects a request with a protocol-native provider error', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const request = await environment.wallet('wallet').requests.next('write')

  request.reject({
    code: 4100,
    data: { capability: 'sign' },
    message: 'Not authorized',
  })

  await expect(result).rejects.toMatchObject({
    data: { capability: 'sign' },
    message: 'Not authorized',
    providerCode: 4100,
  })
})

test('auto-approves only inside the wallet callback scope', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')

  await wallet.autoApprove(async () => {
    await expect(
      environment.dispatch({
        method: 'write',
        origin: 'https://app.example',
        walletId: 'wallet',
      }),
    ).resolves.toBe(1)
  })

  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const request = await wallet.requests.next('write')
  await request.approve()

  await expect(result).resolves.toBe(2)
})

test('validates the next FIFO request without skipping it', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')
  const first = environment.dispatch({
    method: 'first',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const second = environment.dispatch({
    method: 'second',
    origin: 'https://app.example',
    walletId: 'wallet',
  })

  await expect(wallet.requests.next('second')).rejects.toBeInstanceOf(
    Environment.UnexpectedRequestError,
  )
  await (await wallet.requests.next('first')).approve()
  await (await wallet.requests.next('second')).approve()

  await expect(first).resolves.toBe(1)
  await expect(second).resolves.toBe(2)
})

test('ends the auto-approve scope when its callback throws', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')

  await expect(
    wallet.autoApprove(async () => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')

  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  const request = await wallet.requests.next('write')
  await request.approve()

  await expect(result).resolves.toBe(1)
})

test('snapshots, restores, and resets adapter state explicitly', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const wallet = environment.wallet('wallet')

  await wallet.autoApprove(async () => {
    await environment.dispatch({
      method: 'write',
      origin: 'https://app.example',
      walletId: 'wallet',
    })
  })
  const snapshot = await environment.snapshot()
  expect(snapshot.producedBy).toBe('0.1.0')
  await wallet.autoApprove(async () => {
    await environment.dispatch({
      method: 'write',
      origin: 'https://app.example',
      walletId: 'wallet',
    })
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

  const request = await environment.wallet('two').requests.next('write')
  await request.approve()

  await expect(result).resolves.toBe(1)
})

test('exposes a versioned, redacted, immutable trace artifact', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })

  await environment.dispatch({
    method: 'read',
    origin: 'https://app.example',
    params: [{ privateKey: 'do-not-leak' }],
    walletId: 'wallet',
  })
  const trace = environment.trace

  expect(Object.isFrozen(trace)).toBe(true)
  expect(trace.schemaVersion).toBe(1)
  expect(trace.environmentId).toEqual(expect.any(String))
  expect(trace.events.map((event) => event.type)).toEqual([
    'request.received',
    'request.returned',
  ])
  expect(trace.events.map((event) => event.sequence)).toEqual([1, 2])
  expect(trace.events[0]).toMatchObject({
    method: 'read',
    params: [{ privateKey: '[REDACTED]' }],
  })
})

test('rejects snapshots while an interactive request is pending', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const result = environment.dispatch({
    method: 'write',
    origin: 'https://app.example',
    walletId: 'wallet',
  })
  await environment.wallet('wallet').requests.next('write')

  await expect(environment.snapshot()).rejects.toBeInstanceOf(
    Environment.PendingRequestError,
  )

  await environment.reset()
  await expect(result).rejects.toBeInstanceOf(Environment.ResetError)
})

test('rejects a snapshot from a different profile fingerprint', async () => {
  const source = Environment.create({ wallets: [testWallet()] })
  const snapshot = await source.snapshot()
  const changed = testWallet()
  const environment = Environment.create({
    wallets: [
      {
        ...changed,
        profile: Profile.define({
          data: { variant: true },
          id: 'wallet',
          kind: 'test',
          name: 'Wallet',
        }),
      },
    ],
  })

  await expect(environment.restore(snapshot)).rejects.toBeInstanceOf(
    Environment.InvalidSnapshotError,
  )
})

test('rejects malformed snapshot metadata', async () => {
  const environment = Environment.create({ wallets: [testWallet()] })
  const snapshot = await environment.snapshot()

  await expect(
    environment.restore({ ...snapshot, producedBy: undefined } as never),
  ).rejects.toBeInstanceOf(Environment.InvalidSnapshotError)
  await expect(
    environment.restore({
      ...snapshot,
      profiles: { ...snapshot.profiles, extra: 'unexpected' },
    }),
  ).rejects.toBeInstanceOf(Environment.InvalidSnapshotError)
})

test('preflights every wallet before restoring any state', async () => {
  const first = testWallet()
  const second = {
    ...testWallet(),
    profile: Profile.define({ data: {}, id: 'two', kind: 'test', name: 'Two' }),
  }
  const environment = Environment.create({ wallets: [first, second] })
  await environment.wallet('wallet').autoApprove(() =>
    environment.dispatch({
      method: 'write',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  )
  const snapshot = await environment.snapshot()
  const invalid = {
    ...snapshot,
    wallets: { ...snapshot.wallets, two: 'invalid' },
  }

  await expect(environment.restore(invalid)).rejects.toThrow('Snapshot must be a number')

  await expect(
    environment.dispatch({
      method: 'read',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).resolves.toBe(1)
})

test('disposes every wallet in reverse order and aggregates failures', async () => {
  const calls: string[] = []
  const one = {
    ...testWallet(),
    dispose() {
      calls.push('one')
      throw new Error('one failed')
    },
  }
  const two = {
    ...testWallet(),
    dispose() {
      calls.push('two')
      throw new Error('two failed')
    },
    profile: Profile.define({ data: {}, id: 'two', kind: 'test', name: 'Two' }),
  }
  const environment = Environment.create({ wallets: [one, two] })

  const disposal = environment.dispose()

  await expect(disposal).rejects.toBeInstanceOf(AggregateError)
  expect(calls).toEqual(['two', 'one'])
  await expect(
    environment.dispatch({
      method: 'read',
      origin: 'https://app.example',
      walletId: 'wallet',
    }),
  ).rejects.toBeInstanceOf(Environment.EnvironmentDisposedError)
})
