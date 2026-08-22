import { expect, test } from 'vitest'

import * as exports from './exports.js'

test('exports runner integration namespaces', () => {
  expect(Object.keys(exports).sort()).toEqual(['Browser', 'Errors', 'Fixture', 'Qr'])
})
