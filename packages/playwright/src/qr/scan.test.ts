import { PNG } from 'pngjs'
import encodeQR from 'qr'
import { expect, test } from 'vitest'

import * as Qr from './exports.js'

test('decodes a visible QR screenshot', async () => {
  const value = 'wc:example@2?relay-protocol=irn&symKey=secret'
  const screenshot = renderQr(value)

  await expect(Qr.scan({ screenshot: async () => screenshot })).resolves.toBe(value)
})

test('decodes a QR inside a wider screenshot', async () => {
  const value = 'wc:example@2?relay-protocol=irn&symKey=secret'
  const qr = PNG.sync.read(renderQr(value))
  const image = new PNG({ width: qr.width + 200, height: qr.height })
  image.data.fill(255)
  for (let y = 0; y < qr.height; y++) {
    qr.data.copy(
      image.data,
      (y * image.width + 100) * 4,
      y * qr.width * 4,
      (y + 1) * qr.width * 4,
    )
  }

  await expect(
    Qr.scan({ screenshot: async () => PNG.sync.write(image) }, { timeout: 0 }),
  ).resolves.toBe(value)
})

test('decodes an inverted QR screenshot', async () => {
  const value = 'wc:example@2?relay-protocol=irn&symKey=secret'
  const image = PNG.sync.read(renderQr(value))
  for (let offset = 0; offset < image.data.length; offset++) {
    if (offset % 4 !== 3) image.data[offset] = 255 - (image.data[offset] ?? 0)
  }

  await expect(
    Qr.scan({ screenshot: async () => PNG.sync.write(image) }, { timeout: 0 }),
  ).resolves.toBe(value)
})

test('reports a decode error for a valid image without a QR', async () => {
  const image = new PNG({ width: 100, height: 100 })
  image.data.fill(255)

  await expect(
    Qr.scan({ screenshot: async () => PNG.sync.write(image) }, { timeout: 0 }),
  ).rejects.toMatchObject({ code: 'OALLET_PLAYWRIGHT_QR_DECODE_FAILED' })
})

test('retries while a QR screenshot is not ready to decode', async () => {
  const value = 'wc:example@2?relay-protocol=irn&symKey=secret'
  const screenshot = renderQr(value)
  let attempts = 0

  await expect(
    Qr.scan({
      async screenshot() {
        attempts += 1
        return attempts === 1 ? Buffer.from('not an image') : screenshot
      },
    }),
  ).resolves.toBe(value)
  expect(attempts).toBe(2)
})

test('distinguishes a target that cannot be captured', async () => {
  const cause = new Error('locator did not become visible')

  await expect(
    Qr.scan(
      {
        screenshot: async () => {
          throw cause
        },
      },
      { timeout: 0 },
    ),
  ).rejects.toMatchObject({
    cause,
    code: 'OALLET_PLAYWRIGHT_QR_TARGET_UNAVAILABLE',
    name: 'Playwright.QrTargetUnavailableError',
  })
})

test('distinguishes a visible target whose pixels cannot be decoded', async () => {
  await expect(
    Qr.scan({ screenshot: async () => Buffer.from('not an image') }, { timeout: 0 }),
  ).rejects.toMatchObject({
    code: 'OALLET_PLAYWRIGHT_QR_DECODE_FAILED',
    name: 'Playwright.QrDecodeError',
  })
})

function renderQr(value: string) {
  const matrix = encodeQR(value, 'raw', { border: 4 })
  const firstRow = matrix[0]
  if (!firstRow) throw new Error('QR matrix must not be empty')
  const scale = 6
  const image = new PNG({
    height: matrix.length * scale,
    width: firstRow.length * scale,
  })
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const row = matrix[Math.floor(y / scale)]
      if (!row) throw new Error('QR row must be within the image bounds')
      const dark = row[Math.floor(x / scale)]
      const offset = (y * image.width + x) * 4
      image.data[offset] = dark ? 0 : 255
      image.data[offset + 1] = dark ? 0 : 255
      image.data[offset + 2] = dark ? 0 : 255
      image.data[offset + 3] = 255
    }
  }
  return PNG.sync.write(image)
}
