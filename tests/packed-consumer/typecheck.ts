import { Environment } from '@oallet/core'
import { Identity, Transport, Wallet } from '@oallet/evm'
import { Fixture } from '@oallet/playwright'
import {
  Identity as SolanaIdentity,
  Profile as SolanaProfile,
  Wallet as SolanaWallet,
} from '@oallet/solana'
import { Client } from '@oallet/walletconnect'
import * as CoreEntry from 'oallet/core'
import * as EvmEntry from 'oallet/evm'
import * as PlaywrightEntry from 'oallet/playwright'
import * as SolanaEntry from 'oallet/solana'
import * as WalletConnectEntry from 'oallet/walletconnect'
import { anvil } from 'viem/chains'

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
const solanaProfile = SolanaProfile.keypair({
  accounts: [SolanaIdentity.alice],
  chains: ['solana:localnet'],
  id: 'packed-solana-wallet',
  name: 'Packed Solana Wallet',
})
const solanaEnvironment = Environment.create({
  wallets: [SolanaWallet.create({ profile: solanaProfile })],
})

const publicSurface = {
  clientCreate: Client.create,
  coreEnvironment: CoreEntry.Environment,
  environment,
  evmProfile: EvmEntry.Profile,
  evmTransport: EvmEntry.Transport,
  evmWallet: EvmEntry.Wallet,
  fixtureExtend: Fixture.extend,
  playwrightFixture: PlaywrightEntry.Fixture,
  solanaEnvironment,
  solanaProfile: SolanaEntry.Profile,
  walletConnectClient: WalletConnectEntry.Client,
}

void publicSurface
await environment.dispose()
await solanaEnvironment.dispose()
