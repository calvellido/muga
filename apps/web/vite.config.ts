import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Where the app is served from: "/" locally, "/muga/" on https://calvellido.es/muga/.
const base = process.env.MUGA_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Muga",
        short_name: "Muga",
        description: "Control your internet radios from the browser.",
        lang: "en",
        // An installed app opens, and stays, where it was installed from.
        id: base,
        start_url: base,
        scope: base,
        display: "standalone",
        theme_color: "#0e4f3c",
        background_color: "#0c1210",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache the app shell only. Radio requests go straight to the network.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  server: {
    host: "localhost",
    port: 5173,
  },
  preview: {
    host: "localhost",
    port: 4173,
  },
});
