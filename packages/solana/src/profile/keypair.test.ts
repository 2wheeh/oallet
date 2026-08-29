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
  expect(JSON.stringify(profile)).not.toContain('oallet:solana:alice')
})

test('exposes deterministic public identity presets', () => {
  expect(Identity.presets).toHaveLength(10)
  expect(Identity.alice.address).toBe('6G4TD6tNaQ9byuykMu6ninArmaNBmwpADDp8tUaMcfg2')
  expect(Identity.bob.address).toBe('HjK7iKXDHNuHMUNjYuZ6Se1ER63nxRrFb1hGH3S6oKpz')
})
