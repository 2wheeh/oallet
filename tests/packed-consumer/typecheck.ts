import { Environment } from '@oallet/core'
import { Identity, Profile, Transport, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import { Client } from '@oallet/walletconnect'
import * as CoreEntry from 'oallet/core'
import * as EvmEntry from 'oallet/evm'
import * as PlaywrightEntry from 'oallet/playwright'
import * as WalletConnectEntry from 'oallet/walletconnect'
import { anvil } from 'viem/chains'

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
          transport: Transport.unavailable(),
        },
      ],
      profile,
    }),
  ],
})

const publicSurface = {
  clientCreate: Client.create,
  coreEnvironment: CoreEntry.Environment,
  environment,
  evmProfile: EvmEntry.Profile,
  evmTransport: EvmEntry.Transport,
  fixtureExtend: Fixture.extend,
  playwrightFixture: PlaywrightEntry.Fixture,
  walletConnectClient: WalletConnectEntry.Client,
}

void publicSurface
await environment.dispose()
