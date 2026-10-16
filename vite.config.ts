import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/shared-workspace/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Shared Workspace',
        short_name: 'Workspace',
        description: 'Secure shared company dashboard',
        start_url: '/shared-workspace/',
        scope: '/shared-workspace/',
        display: 'standalone',
        background_color: '#faf8f5',
        theme_color: '#4a7fd4'
      }
    })
  ]
})
