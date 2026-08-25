import { expect, test } from 'vitest'

import * as exports from './exports.js'

test('exports WalletConnect namespaces', () => {
  expect(Object.keys(exports).sort()).toEqual(['Client', 'Errors', 'Pairing', 'Session'])
  expect(Object.keys(exports.Errors).sort()).toEqual([
    'ClientDisposedError',
    'InvalidUriError',
    'PairingInProgressError',
    'PairingResetError',
    'PairingTimeoutError',
    'ProjectIdRequiredError',
    'ProposalSettledError',
    'UnsupportedNamespacesError',
  ])
})
