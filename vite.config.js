import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portal = mode === 'portal'
  const host = process.env.VITE_HOST || '127.0.0.1'
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001'
  return {
    plugins: [react()],
    server: {
      host,
      port: portal ? 5174 : 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: portal ? 'dist/portal' : 'dist/customer',
      emptyOutDir: true,
    },
  }
})
