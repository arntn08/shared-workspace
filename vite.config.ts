import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/shared-workspace/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The main application bundle is currently larger than Workbox's 2 MiB default.
        // Allow it to be precached so the installed PWA remains available offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      },
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Shared Workspace',
        short_name: 'Workspace',
        description: 'Secure shared company dashboard',
        start_url: '/shared-workspace/',
        scope: '/shared-workspace/',
        display: 'standalone',
        background_color: '#0b0d10',
        theme_color: '#0b0d10',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
