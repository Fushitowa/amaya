import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portal = mode === 'portal'
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: portal ? 5174 : 5173,
      strictPort: true,
    },
    preview: {
      host: '0.0.0.0',
    },
    build: {
      outDir: portal ? 'dist/portal' : 'dist/customer',
      emptyOutDir: true,
    },
  }
})
