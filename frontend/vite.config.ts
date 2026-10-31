import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: { '/api': env.API_PROXY || 'http://localhost:8000' },
      watch: env.WATCH_POLLING ? { usePolling: true } : undefined,
    },
  }
})
