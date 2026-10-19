import { expect, test } from 'vitest'

import { account, presets } from './identity.js'

// Anvil mnemonic, empty passphrase, m/44'/501'/index'/0'.
// Alice and Bob independently verified with solana-keygen pubkey 'prompt://?key=index/0'.
const addresses = [
  'oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96',
  'AqynRZwvVqUPRwRJXvm6odUb3t93fDjnWe3p6BeuUFxD',
  'CqMbRgMuEhQi9BUS8xP44Wk5nENm48FqJnfjEi4eNb1k',
  '9Tj3srBSxH7RFRCm8uharreY7ZBS49XSfpwCeYa7Xaqp',
  '6gYw7q94fJdEwL8WkT1a6LHBdTMbix1aciALwEWPx3Wp',
  '7EeV8eiRuGoR8bFHCjdCRGQd1RM5sR2dAkdiTEtC9ko7',
  'F9fVg2LeE2RhM6CfNn888hbjqovZDEWY3vm2hEkvX3Nh',
  '26roUwgM5T6bccX41hakjiW4fDiKFSao1RyoFsAxr6e6',
  '5mCGtMUD21HEvWJxKGKS6HEAH7ezzy12MWGs4bPgcJwV',
  '2yaW8VAMLhQiornz1BgcSWDUSH2jC2dmB8RWnTJi8Yab',
] as const

test.for(presets)('derives $id from the shared mnemonic', async (preset) => {
  expect(preset.address).toBe(addresses[preset.index])
  expect((await account(preset)).address).toBe(addresses[preset.index])
})
