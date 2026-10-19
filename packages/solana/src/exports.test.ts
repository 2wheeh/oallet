import { expect, test } from 'vitest'

import * as exports from './exports.js'

test('exports the public Solana namespaces', () => {
  expect(Object.keys(exports).sort()).toEqual([
    'Connection',
    'Errors',
    'Identity',
    'Profile',
    'Wallet',
  ])
})
