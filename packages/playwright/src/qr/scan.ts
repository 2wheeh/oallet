import type { Locator } from '@playwright/test'
import { PNG } from 'pngjs'
import decodeQR from 'qr/decode.js'

import { QrDecodeError, QrTargetUnavailableError } from '../errors/errors.js'

const defaultTimeout = 15_000
const retryInterval = 100

export async function scan(
  target: scan.Target,
  options: scan.Options = {},
): Promise<string> {
  const deadline = Date.now() + (options.timeout ?? defaultTimeout)
  let captureCause: unknown
  let decodeCause: unknown
  let captured = false
  let remaining: number

  do {
    let bytes: Buffer
    try {
      bytes = await target.screenshot({
        timeout: Math.max(1, deadline - Date.now()),
      })
      captured = true
    } catch (error) {
      captureCause = error
      remaining = deadline - Date.now()
      if (remaining > 0) {
        await delay(Math.min(retryInterval, remaining))
      }
      continue
    }
    try {
      const image = PNG.sync.read(bytes)
      const input = { data: image.data, height: image.height, width: image.width }
      try {
        return decodeQR(input)
      } catch {
        return decodeQR(input, { cropToSquare: true })
      }
    } catch (error) {
      decodeCause = error
    }

    remaining = deadline - Date.now()
    if (remaining > 0) {
      await delay(Math.min(retryInterval, remaining))
    }
  } while (remaining > 0)

  if (!captured) {
    throw new QrTargetUnavailableError(
      'Could not capture the QR target before the scan timed out',
      { cause: captureCause },
    )
  }
  throw new QrDecodeError('Captured the QR target but could not decode a QR code', {
    cause: decodeCause,
  })
}

function delay(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

export declare namespace scan {
  type Options = {
    readonly timeout?: number | undefined
  }
  type Target = Pick<Locator, 'screenshot'>
  type ReturnType = string
}
