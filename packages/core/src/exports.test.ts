import { expect, test } from 'vitest'

import * as root from './exports.js'

test('exports the exact core namespaces', () => {
  expect(Object.keys(root).sort()).toEqual([
    'Environment',
    'Errors',
    'Identity',
    'Json',
    'Profile',
    'Request',
    'Trace',
    'Wallet',
  ])
})
