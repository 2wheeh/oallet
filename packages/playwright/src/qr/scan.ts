import type { Locator } from '@playwright/test'
import { PNG } from 'pngjs'
import decodeQR from 'qr/decode.js'

import { QrNotFoundError } from '../errors/errors.js'

const defaultTimeout = 15_000
const retryInterval = 100

export async function scan(
  target: scan.Target,
  options: scan.Options = {},
): Promise<string> {
  const deadline = Date.now() + (options.timeout ?? defaultTimeout)
  let cause: unknown
  let remaining: number

  do {
    try {
      const bytes = await target.screenshot()
      const image = PNG.sync.read(bytes)
      const input = { data: image.data, height: image.height, width: image.width }
      try {
        return decodeQR(input)
      } catch {
        return decodeQR(input, { cropToSquare: true })
      }
    } catch (error) {
      cause = error
    }

    remaining = deadline - Date.now()
    if (remaining > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(retryInterval, remaining)),
      )
    }
  } while (remaining > 0)

  throw new QrNotFoundError('Could not decode a QR code from the target screenshot', {
    cause,
  })
}

export declare namespace scan {
  type Options = {
    readonly timeout?: number | undefined
  }
  type Target = Pick<Locator, 'screenshot'>
  type ReturnType = string
}
