import { expect, test } from 'vitest'

import * as Identity from '../identity/exports.js'
import * as Profile from './exports.js'

test('defines a serializable Solana keypair profile', () => {
  const profile = Profile.keypair({
    accounts: [Identity.alice, Identity.bob],
    chains: ['solana:localnet', 'solana:devnet'],
    id: 'browser-wallet',
    name: 'Browser Wallet',
  })

  expect(profile.kind).toBe('solana:keypair')
  expect(profile.data).toEqual({
    accounts: [Identity.alice, Identity.bob],
    chains: ['solana:localnet', 'solana:devnet'],
  })
  expect(JSON.stringify(profile)).not.toContain('test test')
})

test('exposes deterministic public identity presets', () => {
  expect(Identity.presets).toHaveLength(10)
  expect(Identity.alice.address).toBe('oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96')
  expect(Identity.bob.address).toBe('AqynRZwvVqUPRwRJXvm6odUb3t93fDjnWe3p6BeuUFxD')
})

test('rejects an invalid preset before creating its asynchronous signer', () => {
  expect(() =>
    Profile.keypair({
      accounts: [{ ...Identity.alice, address: Identity.bob.address }],
      chains: ['solana:localnet'],
      id: 'wallet',
      name: 'Wallet',
    }),
  ).toThrowError(expect.objectContaining({ code: 'OALLET_SOLANA_PROFILE_INVALID' }))
})
