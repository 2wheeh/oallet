import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from '@solana/kit'

export type Preset = {
  readonly address: Address
  readonly id: string
  readonly index: number
  readonly source: 'oallet'
}

const definitions = [
  ['alice', '6G4TD6tNaQ9byuykMu6ninArmaNBmwpADDp8tUaMcfg2'],
  ['bob', 'HjK7iKXDHNuHMUNjYuZ6Se1ER63nxRrFb1hGH3S6oKpz'],
  ['charlie', '3hpLz9b73ynqqFbpyMYDurG4ZE1Yyao8p7VT12tE3PfS'],
  ['dave', '5XvZRBMjNYkpBvNBRLmtni7kFa7suDx3134NkcWEP8wH'],
  ['eve', 'BqmictS97otfaTjaw3UiBc96XG59pPLqLiqoW3nrV8DM'],
  ['frank', '3nx3CRQHzJNXz84j8Vm6AomdASQhNphdCqPencEeA6eX'],
  ['grace', 'EH8bgnSyyUxBUHxGv8BwCLfDGs6GAWctDuzgRsAZigHG'],
  ['heidi', 'CtdL4a3b41PALCmmU8UZzKKNiPsSZwJupgoLaiqwMzrV'],
  ['ivan', 'E3zdpmtBMHAGFpaQJJRSzdLoBGASL55bAfMtBPz9YEZM'],
  ['judy', '8mwenSmnxtZiFxivEQeVhHg4x2McfwUr6BpG5M2fKU7X'],
] as const

export const presets: readonly Preset[] = Object.freeze(
  definitions.map(([id, address], index) =>
    Object.freeze({ address: address as Address, id, index, source: 'oallet' as const }),
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

export async function account(preset: Preset): Promise<KeyPairSigner> {
  const expected = presets[preset.index]
  if (!expected || expected.id !== preset.id || expected.address !== preset.address) {
    throw new Error(`Unknown Solana identity preset ${preset.id}`)
  }
  const seed = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`oallet:solana:${preset.id}`),
    ),
  )
  return createKeyPairSignerFromPrivateKeyBytes(seed)
}
