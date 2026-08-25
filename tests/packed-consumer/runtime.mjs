import { Environment } from '@oallet/core'
import { Identity, Profile, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import { Environment as BundledEnvironment } from 'oallet/core'
import { Profile as BundledProfile } from 'oallet/evm'
import { Fixture as BundledFixture } from 'oallet/playwright'
import { Client as BundledClient } from 'oallet/walletconnect'
import { custom } from 'viem'
import { anvil } from 'viem/chains'

if (BundledEnvironment !== Environment) throw new Error('core entrypoints diverged')
if (BundledProfile !== Profile) throw new Error('EVM entrypoints diverged')
if (BundledFixture !== Fixture) throw new Error('Playwright entrypoints diverged')
if (BundledClient !== Client) throw new Error('WalletConnect entrypoints diverged')

const profile = Profile.eoa({
  accounts: [Identity.alice],
  chains: [anvil.id],
  id: 'packed-wallet',
  name: 'Packed Wallet',
})
const environment = Environment.create({
  wallets: [
    Wallet.create({
      chains: [
        {
          chain: anvil,
          transport: custom({ request: async () => '0x1' }),
        },
      ],
      profile,
    }),
  ],
})
const chainId = await environment.dispatch({
  method: 'eth_chainId',
  origin: 'https://packed-consumer.example',
  walletId: profile.id,
})
if (chainId !== '0x7a69') throw new Error(`Unexpected chain: ${chainId}`)
await environment.dispose()
