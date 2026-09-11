import { Identity } from '@oallet/core'
import type { Address } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'

export type Preset = {
  readonly address: Address
  readonly id: string
  readonly index: number
  readonly source: 'anvil'
}

export const presets: readonly Preset[] = Object.freeze(
  Identity.names.map((id, index) =>
    Object.freeze({
      address: mnemonicToAccount(Identity.mnemonic, { addressIndex: index }).address,
      id,
      index,
      source: 'anvil' as const,
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

export function account(preset: Preset) {
  return mnemonicToAccount(Identity.mnemonic, { addressIndex: preset.index })
}
