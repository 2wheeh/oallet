import { Identity } from '@oallet/core'
import { mnemonicToSeedSync } from '@scure/bip39'
import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  type KeyPairSigner,
} from '@solana/kit'
import { HDKey } from 'micro-key-producer/slip10.js'

import { InvalidProfileError } from '../errors/errors.js'

export type Preset = {
  readonly address: Address
  readonly id: string
  readonly index: number
  readonly source: 'oallet'
}

const master = HDKey.fromMasterSeed(mnemonicToSeedSync(Identity.mnemonic, ''))

function derive(index: number) {
  return master.derive(`m/44'/501'/${index}'/0'`)
}

export const presets: readonly Preset[] = Object.freeze(
  Identity.names.map((id, index) =>
    Object.freeze({
      address: getAddressDecoder().decode(derive(index).publicKeyRaw),
      id,
      index,
      source: 'oallet' as const,
    }),
  ),
)

export const [alice, bob, charlie, dave, eve, frank, grace, heidi, ivan, judy] =
  presets as [
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
    Preset,
  ]

export function assertPreset(preset: Preset): void {
  const expected = presets[preset.index]
  if (!expected || expected.id !== preset.id || expected.address !== preset.address) {
    throw new InvalidProfileError(`Unknown Solana identity preset ${preset.id}`)
  }
}

export async function account(preset: Preset): Promise<KeyPairSigner> {
  assertPreset(preset)
  return createKeyPairSignerFromPrivateKeyBytes(derive(preset.index).privateKey)
}
