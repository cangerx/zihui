import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../backend/public/admin',
    emptyOutDir: true,
  },
  base: '/admin/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://your-admin-domain.example.com',
        changeOrigin: true,
      },
    },
  },
})
