import { DelightProvider } from '@delight-labs/delightkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'

import { App } from './App.js'
import { delightClient, wagmiConfig } from './runtime.js'

const queryClient = new QueryClient()
const root = document.getElementById('root')
if (!root) throw new Error('Missing React root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <DelightProvider client={delightClient}>
          <App />
        </DelightProvider>
      </WagmiProvider>
    </QueryClientProvider>
  </StrictMode>,
)
