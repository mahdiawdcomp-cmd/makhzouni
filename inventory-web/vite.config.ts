import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "offline-sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "pwa-icon.svg"],
      manifest: {
        name: "Makhzooni Inventory",
        short_name: "Makhzooni",
        description: "Inventory, invoices, vouchers, and customer statements",
        lang: "ar",
        dir: "rtl",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone", "browser"],
        start_url: "/",
        scope: "/",
        theme_color: "#0f766e",
        background_color: "#f8fafc",
        icons: [
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    host: true,   // listen on 0.0.0.0 — يخلي الموبايل يوصل عبر IP الشبكة
    port: 5173,
  },
})
