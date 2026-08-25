import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: require.resolve('buffer/'),
      events: require.resolve('events/'),
    },
  },
  server: { host: '127.0.0.1', port: 4177 },
})
