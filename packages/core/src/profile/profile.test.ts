import { expect, test } from 'vitest'

import * as Profile from './exports.js'

test('defines an immutable serializable profile with a stable fingerprint', () => {
  const first = Profile.define({
    data: { chains: [1, 31337], mode: 'eoa' },
    id: 'primary',
    kind: 'eip155:eoa',
    name: 'Primary Wallet',
  })
  const second = Profile.define({
    name: 'Primary Wallet',
    kind: 'eip155:eoa',
    id: 'primary',
    data: { mode: 'eoa', chains: [1, 31337] },
  })

  expect(first).toEqual(second)
  expect(first.fingerprint).toMatch(/^oallet_[0-9a-f]{16}$/)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.data)).toBe(true)
})

test('rejects invalid profile identifiers and non-json data', () => {
  expect(() =>
    Profile.define({ data: {}, id: ' ', kind: 'eip155:eoa', name: 'Wallet' }),
  ).toThrow(Profile.InvalidError)
  const untrustedInput = {
    data: { callback: () => undefined },
    id: 'wallet',
    kind: 'eip155:eoa',
    name: 'Wallet',
  } as unknown as Profile.define.Options

  expect(() => Profile.define(untrustedInput)).toThrow(Profile.InvalidError)
})

test('accepts repeated non-cyclic values', () => {
  const shared = { value: 1 }
  const profile = Profile.define({
    data: { left: shared, right: shared },
    id: 'wallet',
    kind: 'test',
    name: 'Test',
  })

  expect(profile.data).toEqual({ left: { value: 1 }, right: { value: 1 } })
})

test('preserves a user-defined profile kind as a string literal', () => {
  const profile = Profile.define({
    data: { feature: 'custom' },
    id: 'custom-wallet',
    kind: 'acme:custom-wallet',
    name: 'Custom Wallet',
  })
  const kind: 'acme:custom-wallet' = profile.kind

  expect(kind).toBe('acme:custom-wallet')
})
