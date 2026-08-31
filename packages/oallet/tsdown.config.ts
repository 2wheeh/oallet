import { defineLibrary } from '@oallet/config/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig(
  defineLibrary({
    entry: {
      core: 'src/core.ts',
      evm: 'src/evm.ts',
      playwright: 'src/playwright.ts',
      solana: 'src/solana.ts',
      walletconnect: 'src/walletconnect.ts',
    },
  }),
)
