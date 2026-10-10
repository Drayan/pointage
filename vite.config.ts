/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Sur GitHub Pages, l'app est servie sous /<nom-du-dépôt>/.
// Le workflow de déploiement fournit BASE_PATH ; en local, la racine.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Pointage 000',
        short_name: 'Pointage',
        description: 'Comptage des heures de travail jour/nuit, données gardées sur le téléphone.',
        lang: 'fr-BE',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F5F2',
        theme_color: '#F4F5F2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // modules facultatifs de jsPDF (rendu HTML/SVG), jamais utilisés ici
        globIgnores: ['**/html2canvas-*.js', '**/purify.es-*.js', '**/index.es-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
