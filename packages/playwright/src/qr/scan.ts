import type { Locator } from '@playwright/test'
import { PNG } from 'pngjs'
import decodeQR from 'qr/decode.js'

import { QrNotFoundError } from '../errors/errors.js'

export async function scan(target: scan.Target): Promise<string> {
  try {
    const bytes = await target.screenshot()
    const image = PNG.sync.read(bytes)
    return decodeQR({ data: image.data, height: image.height, width: image.width })
  } catch (cause) {
    throw new QrNotFoundError('Could not decode a QR code from the target screenshot', {
      cause,
    })
  }
}

export declare namespace scan {
  type Target = Pick<Locator, 'screenshot'>
  type ReturnType = string
}
