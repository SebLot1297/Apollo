import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.COMMANDGRID_API_PROXY ?? 'http://127.0.0.1:8000',
        ws: true,
      },
      '/health': process.env.COMMANDGRID_API_PROXY ?? 'http://127.0.0.1:8000',
      '/ready': process.env.COMMANDGRID_API_PROXY ?? 'http://127.0.0.1:8000',
    },
  },
})
