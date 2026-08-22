import { PNG } from 'pngjs'
import encodeQR from 'qr'
import { expect, test } from 'vitest'

import * as Qr from './exports.js'

test('decodes a visible QR screenshot', async () => {
  const value = 'wc:example@2?relay-protocol=irn&symKey=secret'
  const matrix = encodeQR(value, 'raw', { border: 4 })
  const scale = 6
  const image = new PNG({
    height: matrix.length * scale,
    width: matrix[0].length * scale,
  })
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const dark = matrix[Math.floor(y / scale)][Math.floor(x / scale)]
      const offset = (y * image.width + x) * 4
      image.data[offset] = dark ? 0 : 255
      image.data[offset + 1] = dark ? 0 : 255
      image.data[offset + 2] = dark ? 0 : 255
      image.data[offset + 3] = 255
    }
  }
  const screenshot = PNG.sync.write(image)

  await expect(Qr.scan({ screenshot: async () => screenshot })).resolves.toBe(value)
})
