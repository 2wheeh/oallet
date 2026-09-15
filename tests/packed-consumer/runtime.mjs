import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert'
import { createHash } from 'node:crypto'
import { Environment } from '@oallet/core'
import { Identity, Profile, Transport, Wallet } from '@oallet/evm'
import { Browser, Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { chromium } from '@playwright/test'
import { Environment as BundledEnvironment } from 'oallet/core'
import {
  Profile as BundledProfile,
  Transport as BundledTransport,
  Wallet as BundledWallet,
} from 'oallet/evm'
import { Fixture as BundledFixture } from 'oallet/playwright'
import { Client as BundledClient } from 'oallet/walletconnect'
import { PNG } from 'pngjs'
import encodeQR from 'qr'
import { anvil } from 'viem/chains'
import pkg from './node_modules/@oallet/core/package.json' with { type: 'json' }

if (BundledEnvironment !== Environment) throw new Error('core entrypoints diverged')
if (BundledProfile !== Profile) throw new Error('EVM entrypoints diverged')
if (BundledTransport !== Transport) throw new Error('EVM transport entrypoints diverged')
if (BundledWallet !== Wallet) throw new Error('EVM wallet entrypoints diverged')
if (BundledFixture !== Fixture) throw new Error('Playwright entrypoints diverged')
if (BundledClient !== Client) throw new Error('WalletConnect entrypoints diverged')

const wallet = Wallet.eoa({
  accounts: [Identity.alice],
  chains: [
    {
      chain: anvil,
      transport: Transport.unavailable(),
    },
  ],
  id: 'packed-wallet',
  name: 'Packed Wallet',
})
const environment = Environment.create({
  wallets: [wallet],
})
const chainId = await environment.dispatch({
  method: 'eth_chainId',
  origin: 'https://packed-consumer.example',
  walletId: wallet.profile.id,
})
if (chainId !== '0x7a69') throw new Error(`Unexpected chain: ${chainId}`)
const snapshot = await environment.snapshot()
if (snapshot.producedBy !== pkg.version) {
  throw new Error(`Unexpected snapshot producer: ${snapshot.producedBy}`)
}
// Load the injected runtime from the installed tarball with no workspace sources.
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const pageErrors = []
  context.on('page', (page) => {
    page.on('pageerror', (error) => pageErrors.push(error.message))
  })
  await context.route('http://packed-consumer.example/**', (route) =>
    route.fulfill({
      body: `<!doctype html><script>
        window.addEventListener('eip6963:announceProvider', (event) => {
          window.providerDetail = event.detail;
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        window.chainId = window.providerDetail.provider.request({ method: 'eth_chainId' });
      </script>`,
      contentType: 'text/html',
    }),
  )
  const handle = await Browser.attach({ context, environment })
  const page = await context.newPage()
  await page.goto('http://packed-consumer.example/')
  const initial = await page.evaluate(async () => ({
    chainId: await window.chainId,
    nativeUuid: typeof crypto.randomUUID,
    secure: isSecureContext,
    uuid: window.providerDetail.info.uuid,
  }))
  strictEqual(initial.chainId, '0x7a69')
  strictEqual(initial.nativeUuid, 'undefined')
  strictEqual(initial.secure, false)
  await page.reload()
  notStrictEqual(await page.evaluate(() => window.providerDetail.info.uuid), initial.uuid)
  strictEqual(await page.evaluate(() => window.chainId), '0x7a69')
  deepStrictEqual(pageErrors, [])
  await handle.dispose()
  await context.close()
} finally {
  await browser.close()
  await environment.dispose()
}

// Exercise qr 0.7 through the published package, not just workspace sources
// or browser-test transforms.
const hash = (label) => createHash('sha256').update(`${label}-13`).digest('hex')
const uri = `wc:${hash('topic')}@2?relay-protocol=irn&symKey=${hash('key')}&expiryTimestamp=2000000000`
const raw = encodeQR(uri, 'raw', { ecc: 'quartile', border: 2 })
const width = raw.length * 6
const image = new PNG({ width, height: width })
image.data.fill(255)
for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    if (!raw[Math.floor(y / 6)][Math.floor(x / 6)]) continue
    const offset = (y * width + x) * 4
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0
  }
}
strictEqual(
  await Qr.scan({ screenshot: async () => PNG.sync.write(image) }, { timeout: 0 }),
  uri,
)
