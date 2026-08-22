import { expect, test } from 'vitest'

import * as Identity from '../identity/exports.js'
import * as Profile from './exports.js'

test('defines a serializable EOA profile from Anvil identity presets', () => {
  const profile = Profile.eoa({
    accounts: [Identity.alice, Identity.bob],
    chains: [1, 31337],
    id: 'browser-wallet',
    name: 'Browser Wallet',
  })

  expect(profile.kind).toBe('eip155:eoa')
  expect(profile.data).toEqual({
    accounts: [Identity.alice, Identity.bob],
    chains: [1, 31337],
    defaultChainId: 1,
  })
  expect(JSON.stringify(profile)).not.toContain('test test')
})

test('exposes the standard Anvil account set', () => {
  expect(Identity.presets).toHaveLength(10)
  expect(Identity.alice.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  expect(Identity.bob.address).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
})
