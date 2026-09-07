import { strictEqual } from 'node:assert'
import { createHash } from 'node:crypto'
import { Environment } from '@oallet/core'
import { Identity, Profile, Transport, Wallet } from '@oallet/evm'
import { Fixture, Qr } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
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
await environment.dispose()

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
