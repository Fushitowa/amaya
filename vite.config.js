import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portal = mode === 'portal'
  return {
    plugins: [react()],
    server: {
      port: portal ? 5174 : 5173,
      strictPort: true,
    },
    build: {
      outDir: portal ? 'dist/portal' : 'dist/customer',
      emptyOutDir: true,
    },
  }
})
