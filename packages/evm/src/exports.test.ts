import { expect, test } from 'vitest'

import * as exports from './exports.js'

test('exports the public EVM namespaces', () => {
  expect(Object.keys(exports).sort()).toEqual([
    'Errors',
    'Identity',
    'Profile',
    'Runtime',
    'Wallet',
  ])
})
