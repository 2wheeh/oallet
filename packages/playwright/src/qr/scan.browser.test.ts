import { createHash } from 'node:crypto'
import { type Browser, chromium } from '@playwright/test'
import encodeQR from 'qr'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { scan } from './scan.js'

let browser: Browser
beforeAll(async () => {
  // Cold CI browser startup can exceed Vitest's default 10-second hook limit.
  // Let Playwright's launch deadline expire before the owning hook does.
  browser = await chromium.launch({ headless: true, timeout: 30_000 })
}, 40_000)
afterAll(async () => {
  await browser?.close()
})

// Long URIs can put finder-like patterns in the payload. These fixed seeds
// exercise those patterns at the fractional SVG scale used by the Wagmi fixture.
test.each(
  Array.from({ length: 64 }, (_, seed) =>
    [2, 4].map((border) => ({ seed, border })),
  ).flat(),
)(
  'decodes a rendered WalletConnect QR (seed $seed, border $border)',
  async ({ seed, border }) => {
    const hash = (label: string) =>
      createHash('sha256').update(`${label}-${seed}`).digest('hex')
    const value = `wc:${hash('topic')}@2?relay-protocol=irn&symKey=${hash('key')}&expiryTimestamp=2000000000`
    const svg = encodeQR(value, 'svg', { ecc: 'quartile', border })
    const page = await browser.newPage()
    try {
      await page.setContent(
        `<img width="320" height="320" src="data:image/svg+xml,${encodeURIComponent(svg)}" />`,
      )
      const target = page.locator('img')
      const bytes = await target.screenshot()
      await expect(scan({ screenshot: async () => bytes }, { timeout: 0 })).resolves.toBe(
        value,
      )
    } finally {
      await page.close()
    }
  },
)
