/** Public test mnemonic shared by Oallet's chain-specific identity presets. */
export const mnemonic = 'test test test test test test test test test test test junk'

/** Stable identity order: an identity's index selects its chain-specific derivation. */
export const names = Object.freeze([
  'alice',
  'bob',
  'charlie',
  'dave',
  'eve',
  'frank',
  'grace',
  'heidi',
  'ivan',
  'judy',
] as const)
