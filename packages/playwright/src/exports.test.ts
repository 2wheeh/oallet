import { expect, test } from 'vitest'

import * as exports from './exports.js'

test('exports runner integration namespaces', () => {
  expect(Object.keys(exports).sort()).toEqual(['Browser', 'Errors', 'Fixture', 'Qr'])
  expect(Object.keys(exports.Errors).sort()).toEqual([
    'AlreadyAttachedError',
    'DeliveryError',
    'ExistingPageError',
    'InvalidRequestError',
    'QrDecodeError',
    'QrNotFoundError',
    'QrTargetUnavailableError',
    'UnsupportedFrameError',
  ])
})
