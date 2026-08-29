import { Environment } from '@oallet/core'
import { Identity, Profile, Transport, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import { Profile as SolanaProfile } from '@oallet/solana'
import { Client } from '@oallet/walletconnect'
import { Environment as BundledEnvironment } from 'oallet/core'
import {
  Profile as BundledProfile,
  Transport as BundledTransport,
  Wallet as BundledWallet,
} from 'oallet/evm'
import { Fixture as BundledFixture } from 'oallet/playwright'
import { Profile as BundledSolanaProfile } from 'oallet/solana'
import { Client as BundledClient } from 'oallet/walletconnect'
import { anvil } from 'viem/chains'
import pkg from './node_modules/@oallet/core/package.json' with { type: 'json' }

if (BundledEnvironment !== Environment) throw new Error('core entrypoints diverged')
if (BundledProfile !== Profile) throw new Error('EVM entrypoints diverged')
if (BundledTransport !== Transport) throw new Error('EVM transport entrypoints diverged')
if (BundledWallet !== Wallet) throw new Error('EVM wallet entrypoints diverged')
if (BundledFixture !== Fixture) throw new Error('Playwright entrypoints diverged')
if (BundledSolanaProfile !== SolanaProfile) {
  throw new Error('Solana entrypoints diverged')
}
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
